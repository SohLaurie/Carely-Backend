const pool = require('../../config/db')
const { createNotification } = require('../notifications/notifications.service')

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Generates a cryptographically simple 6-digit OTP string.
 */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

/**
 * Given a booking, computes the list of session dates to create.
 *
 * Day ID convention (matches frontend WEEKDAYS):
 *   0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
 *
 * JS Date.getDay() convention:
 *   0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
 *
 * Conversion: jsDay = (appDayId + 1) % 7
 */
function appDayToJsDay(appDayId) {
  return (appDayId + 1) % 7  // 0(Mon)→1, 6(Sun)→0
}

/**
 * Returns a Date advanced to the next occurrence of `targetJsDay`
 * on or after `fromDate`.
 */
function nextWeekday(fromDate, targetJsDay) {
  const d = new Date(fromDate)
  const diff = (targetJsDay - d.getDay() + 7) % 7
  d.setDate(d.getDate() + diff)
  return d
}

/**
 * Formats a Date as 'YYYY-MM-DD' for PostgreSQL DATE type.
 */
function toISODate(date) {
  const d = new Date(date)
  const yr = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${yr}-${mo}-${da}`
}

/**
 * Builds the full list of session descriptors for a booking.
 */
function buildSessionDescriptors(booking) {
  const {
    session_type,
    start_date,
    start_time,
    end_time,
    selected_days,
    duration_weeks,
    subtotal,
    service_fee,
    total_sessions,
  } = booking

  const sessions = []
  const baseDate = new Date(start_date)

  // Amount per session = subtotal / total_sessions (service fee split evenly too)
  const perSessionAmount = Math.round((subtotal + service_fee) / total_sessions)

  if (session_type === 'once') {
    sessions.push({
      session_number: 1,
      week_number: null,
      scheduled_date: toISODate(baseDate),
      scheduled_start_time: start_time,
      scheduled_end_time: end_time,
      session_amount: perSessionAmount,
      otp_code: generateOTP(),
    })
  } else {
    // Recurring: build schedule for each week and each selected day
    const sortedDays = [...selected_days].sort((a, b) => a - b)
    let sessionNumber = 1

    for (let w = 0; w < duration_weeks; w++) {
      const weekStart = new Date(baseDate)
      weekStart.setDate(baseDate.getDate() + w * 7)

      for (const appDayId of sortedDays) {
        const jsDay = appDayToJsDay(appDayId)
        const sessionDate = nextWeekday(weekStart, jsDay)

        sessions.push({
          session_number: sessionNumber,
          week_number: w + 1,
          scheduled_date: toISODate(sessionDate),
          scheduled_start_time: start_time,
          scheduled_end_time: end_time,
          session_amount: perSessionAmount,
          otp_code: generateOTP(),
        })
        sessionNumber++
      }
    }
  }

  return sessions
}

// ── Generate Sessions ──────────────────────────────────────────────────────────
/**
 * Creates all session rows for a booking inside a given DB client (transaction).
 * Called from bookings.service when provider accepts a booking.
 */
async function generateSessionsForBooking(dbClient, booking) {
  const descriptors = buildSessionDescriptors(booking)

  for (const s of descriptors) {
    await dbClient.query(
      `INSERT INTO sessions
         (booking_id, session_number, week_number,
          scheduled_date, scheduled_start_time, scheduled_end_time,
          session_amount, otp_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        booking.id,
        s.session_number,
        s.week_number,
        s.scheduled_date,
        s.scheduled_start_time,
        s.scheduled_end_time,
        s.session_amount,
        s.otp_code,
      ]
    )
  }

  return descriptors.length
}

// ── Get Sessions by Booking ────────────────────────────────────────────────────
async function getSessionsByBooking(bookingId, requesterId) {
  // Verify requester owns or is involved in this booking
  const { rows: bookingRows } = await pool.query(
    'SELECT booker_id, provider_id, payment_status FROM bookings WHERE id = $1',
    [bookingId]
  )
  if (bookingRows.length === 0) {
    const err = new Error('Booking not found.')
    err.status = 404
    throw err
  }

  const booking = bookingRows[0]
  const isOwner =
    booking.booker_id === requesterId || booking.provider_id === requesterId
  if (!isOwner) {
    const err = new Error('Access denied.')
    err.status = 403
    throw err
  }

  const { rows } = await pool.query(
    `SELECT
       id, booking_id, session_number, week_number,
       scheduled_date, scheduled_start_time, scheduled_end_time,
       session_amount, status,
       otp_verified_at, completion_marked_at, confirmation_deadline,
       interrupted_at, interruption_reason, partial_amount,
       dispute_reason, disputed_at,
       -- Only expose the OTP code when booking is paid (confirmed)
       CASE WHEN $2 = 'paid' THEN otp_code ELSE NULL END AS otp_code,
       created_at
     FROM sessions
     WHERE booking_id = $1
     ORDER BY session_number ASC`,
    [bookingId, booking.payment_status]
  )

  return rows
}

// ── Get Single Session ─────────────────────────────────────────────────────────
async function getSession(sessionId, requesterId) {
  const { rows } = await pool.query(
    `SELECT s.*,
       b.booker_id, b.provider_id, b.payment_status
     FROM sessions s
     JOIN bookings b ON b.id = s.booking_id
     WHERE s.id = $1`,
    [sessionId]
  )
  if (rows.length === 0) {
    const err = new Error('Session not found.')
    err.status = 404
    throw err
  }
  const row = rows[0]
  const isOwner = row.booker_id === requesterId || row.provider_id === requesterId
  if (!isOwner) {
    const err = new Error('Access denied.')
    err.status = 403
    throw err
  }
  // Hide OTP until paid
  if (row.payment_status !== 'paid') row.otp_code = null
  return row
}

// ── Verify OTP (Provider arrives) ─────────────────────────────────────────────
async function verifyOtp(sessionId, code, providerId) {
  const { rows } = await pool.query(
    `SELECT s.*, b.provider_id, b.payment_status
     FROM sessions s
     JOIN bookings b ON b.id = s.booking_id
     WHERE s.id = $1`,
    [sessionId]
  )
  if (rows.length === 0) {
    const err = new Error('Session not found.')
    err.status = 404
    throw err
  }
  const session = rows[0]

  if (session.provider_id !== providerId) {
    const err = new Error('Only the assigned provider can verify the OTP.')
    err.status = 403
    throw err
  }
  if (session.payment_status !== 'paid') {
    const err = new Error('Payment has not been confirmed for this booking yet.')
    err.status = 400
    throw err
  }
  if (session.status !== 'SCHEDULED') {
    const err = new Error(`Session is already ${session.status}. OTP verification is only allowed for SCHEDULED sessions.`)
    err.status = 400
    throw err
  }
  if (session.otp_code !== code.trim()) {
    const err = new Error('Invalid OTP code. Please ask the client to confirm the code.')
    err.status = 400
    throw err
  }

  // Compute confirmation deadline = now + 24h
  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000)

  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')

    const { rows: updated } = await dbClient.query(
      `UPDATE sessions
       SET status = 'ARRIVED',
           otp_verified_at = now(),
           confirmation_deadline = $2,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [sessionId, deadline.toISOString()]
    )

    await syncBookingStatus(dbClient, session.booking_id)

    await dbClient.query('COMMIT')

    // Notify household: provider has arrived, session in progress
    const bookerRow = await pool.query(
      `SELECT booker_id FROM bookings WHERE id = $1`, [session.booking_id]
    )
    if (bookerRow.rows[0]) {
      await createNotification(
        bookerRow.rows[0].booker_id,
        'session_started',
        'Your provider has arrived',
        'OTP confirmed — your session is now in progress. You can confirm completion after the service.',
        { sessionId, bookingId: session.booking_id }
      )
    }

    return updated[0]
  } catch (err) {
    await dbClient.query('ROLLBACK')
    throw err
  } finally {
    dbClient.release()
  }

  // Permanently consume 5 CC when booking is activated (non-blocking)
  try {
    const { consumeHeldCredits } = require('../carecredits/carecredits.service')
    await consumeHeldCredits(session.provider_id, session.booking_id)
  } catch (ccErr) {
    console.warn('[CareCred] consumeHeldCredits non-fatal error:', ccErr.message)
  }
}


// ── Confirm Session (Client confirms completion) ───────────────────────────────
async function confirmSession(sessionId, bookerId) {
  const { rows } = await pool.query(
    `SELECT s.*, b.booker_id
     FROM sessions s
     JOIN bookings b ON b.id = s.booking_id
     WHERE s.id = $1`,
    [sessionId]
  )
  if (rows.length === 0) {
    const err = new Error('Session not found.')
    err.status = 404
    throw err
  }
  const session = rows[0]

  if (session.booker_id !== bookerId) {
    const err = new Error('Only the client who made the booking can confirm completion.')
    err.status = 403
    throw err
  }
  if (!['SCHEDULED', 'ARRIVED', 'AWAITING_CONFIRMATION', 'COMPLETED'].includes(session.status)) {
    const err = new Error(`Cannot confirm a session with status ${session.status}.`)
    err.status = 400
    throw err
  }

  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')

    // Mark session completed
    await dbClient.query(
      `UPDATE sessions
       SET status = 'COMPLETED',
           completion_marked_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [sessionId]
    )

    // Check if all sessions in booking are now complete
    await syncBookingStatus(dbClient, session.booking_id)

    await dbClient.query('COMMIT')
  } catch (err) {
    await dbClient.query('ROLLBACK')
    throw err
  } finally {
    dbClient.release()
  }

  // Notify provider: client confirmed, escrow will be released
  const providerRow = await pool.query(
    `SELECT provider_id FROM bookings WHERE id = $1`, [session.booking_id]
  )
  if (providerRow.rows[0]) {
    await createNotification(
      providerRow.rows[0].provider_id,
      'session_confirmed',
      'Session confirmed — escrow released',
      'The client confirmed session completion. Your payment for this session will be released.',
      { sessionId, bookingId: session.booking_id }
    )
  }

  // Grant referral reward to referrer if applicable (non-blocking)
  try {
    const { addReferralReward } = require('../carecredits/carecredits.service')
    await addReferralReward(session.booking_id)
  } catch (ccErr) {
    console.warn('[CareCred] addReferralReward non-fatal error:', ccErr.message)
  }

  return { message: 'Session confirmed as completed. Escrow for this session will be released.' }
}


// ── Provider Complete Session (Provider marks job completed) ────────────────
async function providerCompleteSession(sessionId, providerId) {
  const { rows } = await pool.query(
    `SELECT s.*, b.provider_id, b.booker_id
     FROM sessions s
     JOIN bookings b ON b.id = s.booking_id
     WHERE s.id = $1`,
    [sessionId]
  )
  if (rows.length === 0) {
    const err = new Error('Session not found.')
    err.status = 404
    throw err
  }
  const session = rows[0]

  if (session.provider_id !== providerId) {
    const err = new Error('Only the assigned provider can complete this session.')
    err.status = 403
    throw err
  }

  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')

    const { rows: updated } = await dbClient.query(
      `UPDATE sessions
       SET status = 'COMPLETED',
           completion_marked_at = now(),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [sessionId]
    )

    await syncBookingStatus(dbClient, session.booking_id)

    await dbClient.query('COMMIT')

    // Notify household to confirm completion within 24h
    await createNotification(
      session.booker_id,
      'session_completed',
      'Provider marked session complete',
      'Your provider has marked the session as complete. Please confirm within 24 hours to release escrow.',
      { sessionId, bookingId: session.booking_id }
    )

    return { message: 'Job marked as complete.', session: updated[0] }
  } catch (err) {
    await dbClient.query('ROLLBACK')
    throw err
  } finally {
    dbClient.release()
  }
}

// ── Dispute Session ────────────────────────────────────────────────────────────
async function disputeSession(sessionId, userId, reason) {
  const { rows } = await pool.query(
    `SELECT s.*, b.booker_id, b.provider_id
     FROM sessions s
     JOIN bookings b ON b.id = s.booking_id
     WHERE s.id = $1`,
    [sessionId]
  )
  if (rows.length === 0) {
    const err = new Error('Session not found.')
    err.status = 404
    throw err
  }
  const session = rows[0]

  const isOwner = session.booker_id === userId || session.provider_id === userId
  if (!isOwner) {
    const err = new Error('Access denied.')
    err.status = 403
    throw err
  }
  if (['COMPLETED', 'DISPUTED', 'MISSED', 'SKIPPED'].includes(session.status)) {
    const err = new Error(`Cannot dispute a session that is already ${session.status}.`)
    err.status = 400
    throw err
  }

  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')

    await dbClient.query(
      `UPDATE sessions
       SET status = 'DISPUTED',
           dispute_reason = $2,
           disputed_by = $3,
           disputed_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [sessionId, reason || null, userId]
    )

    // Escalate booking to disputed
    await dbClient.query(
      `UPDATE bookings SET status = 'disputed', updated_at = now() WHERE id = $1`,
      [session.booking_id]
    )

    await dbClient.query('COMMIT')
  } catch (err) {
    await dbClient.query('ROLLBACK')
    throw err
  } finally {
    dbClient.release()
  }

  return { message: 'Dispute flagged. Our team will review and contact both parties within 24 hours.' }
}

// ── Skip Session (client skips one occurrence) ────────────────────────────────
async function skipSession(sessionId, bookerId) {
  const { rows } = await pool.query(
    `SELECT s.*, b.booker_id
     FROM sessions s
     JOIN bookings b ON b.id = s.booking_id
     WHERE s.id = $1`,
    [sessionId]
  )
  if (rows.length === 0) {
    const err = new Error('Session not found.')
    err.status = 404
    throw err
  }
  const session = rows[0]

  if (session.booker_id !== bookerId) {
    const err = new Error('Only the client can skip a session.')
    err.status = 403
    throw err
  }
  if (session.status !== 'SCHEDULED') {
    const err = new Error('Only SCHEDULED sessions can be skipped.')
    err.status = 400
    throw err
  }

  await pool.query(
    `UPDATE sessions
     SET status = 'SKIPPED', updated_at = now()
     WHERE id = $1`,
    [sessionId]
  )

  return { message: 'Session skipped. A prorated credit will be applied.' }
}

// ── Helper: time diff in hours ─────────────────────────────────────────────────
function timeDiffHours(startTime, endTime) {
  // startTime / endTime are 'HH:MM:SS' strings from PostgreSQL TIME columns
  const [sh, sm] = String(startTime).split(':').map(Number)
  const [eh, em] = String(endTime).split(':').map(Number)
  return Math.max(1, ((eh * 60 + em) - (sh * 60 + sm)) / 60)
}

// ── Report Unable to Complete (Provider flags emergency mid-session) ───────────
async function reportUnableToComplete(sessionId, providerId, reason) {
  const { rows } = await pool.query(
    `SELECT s.*, b.provider_id, b.booker_id
     FROM sessions s
     JOIN bookings b ON b.id = s.booking_id
     WHERE s.id = $1`,
    [sessionId]
  )
  if (rows.length === 0) {
    const err = new Error('Session not found.')
    err.status = 404
    throw err
  }
  const session = rows[0]

  if (session.provider_id !== providerId) {
    const err = new Error('Only the assigned provider can report an interruption.')
    err.status = 403
    throw err
  }
  if (session.status !== 'ARRIVED') {
    const err = new Error(
      `Session must be in ARRIVED state to report an interruption. Current status: ${session.status}`
    )
    err.status = 400
    throw err
  }

  // Calculate hours worked (minimum 1 hour, rounded down)
  const msWorked = Date.now() - new Date(session.otp_verified_at).getTime()
  const hoursWorked = Math.max(1, Math.floor(msWorked / 3600000))

  // Calculate partial amount: hours worked × rate per hour
  const scheduledHours = timeDiffHours(session.scheduled_start_time, session.scheduled_end_time)
  const ratePerHour = Math.round(session.session_amount / scheduledHours)
  const partialAmount = Math.min(hoursWorked * ratePerHour, session.session_amount)

  // Confirmation deadline: 24h from now
  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000)

  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')

    await dbClient.query(
      `UPDATE sessions
       SET status = 'INTERRUPTED',
           interrupted_at = now(),
           interruption_reason = $2,
           partial_amount = $3,
           confirmation_deadline = $4,
           updated_at = now()
       WHERE id = $1`,
      [sessionId, reason || null, partialAmount, deadline.toISOString()]
    )

    await syncBookingStatus(dbClient, session.booking_id)
    await dbClient.query('COMMIT')
  } catch (err) {
    await dbClient.query('ROLLBACK')
    throw err
  } finally {
    dbClient.release()
  }

  // Notify household immediately
  await createNotification(
    session.booker_id,
    'session_interrupted',
    'Provider reported an emergency',
    `Your provider had to leave early after ${hoursWorked} hour(s). ` +
      `They are owed ${partialAmount.toLocaleString()} XAF for time worked. ` +
      `You have 24 hours to confirm the partial payment or it will be processed automatically.`,
    { sessionId, bookingId: session.booking_id, partialAmount, hoursWorked }
  )

  return {
    message: 'Emergency reported. The household has been notified.',
    hoursWorked,
    partialAmount,
    confirmationDeadline: deadline,
  }
}

// ── Confirm Partial Payment (Household confirms after provider interruption) ───
async function confirmPartialPayment(sessionId, bookerId) {
  const { rows } = await pool.query(
    `SELECT s.*, b.booker_id, b.provider_id
     FROM sessions s
     JOIN bookings b ON b.id = s.booking_id
     WHERE s.id = $1`,
    [sessionId]
  )
  if (rows.length === 0) {
    const err = new Error('Session not found.')
    err.status = 404
    throw err
  }
  const session = rows[0]

  if (session.booker_id !== bookerId) {
    const err = new Error('Only the household who made the booking can confirm partial payment.')
    err.status = 403
    throw err
  }
  if (session.status !== 'INTERRUPTED') {
    const err = new Error(
      `Partial payment confirmation is only available for INTERRUPTED sessions. Current status: ${session.status}`
    )
    err.status = 400
    throw err
  }
  if (new Date(session.confirmation_deadline) < new Date()) {
    const err = new Error('The 24-hour confirmation window has passed. Payment was auto-processed.')
    err.status = 400
    throw err
  }

  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')

    await dbClient.query(
      `UPDATE sessions
       SET status = 'COMPLETED',
           completion_marked_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [sessionId]
    )

    await syncBookingStatus(dbClient, session.booking_id)
    await dbClient.query('COMMIT')
  } catch (err) {
    await dbClient.query('ROLLBACK')
    throw err
  } finally {
    dbClient.release()
  }

  // Trigger partial payout (non-blocking)
  try {
    const { releasePartialEscrow } = require('../payments/payments.service')
    await releasePartialEscrow(session.booking_id, session.partial_amount)
  } catch (payErr) {
    console.error('[PartialPay] releasePartialEscrow error:', payErr.message)
  }

  // Notify provider
  await createNotification(
    session.provider_id,
    'partial_payment_confirmed',
    'Partial payment confirmed',
    `The household confirmed your partial payment. ${(session.partial_amount || 0).toLocaleString()} XAF will be disbursed to you.`,
    { sessionId, bookingId: session.booking_id }
  )

  return {
    message: 'Partial payment confirmed. Escrow will be partially released.',
    partialAmount: session.partial_amount,
  }
}

// ── Auto-Release Expired Sessions ─────────────────────────────────────────────
/**
 * Called by a cron job (or manually via admin endpoint).
 *
 * Handles 3 cases per spec:
 * 1. ARRIVED + past deadline + neither party acted → MISSED (full refund to household — no proof of completion)
 * 2. INTERRUPTED + past deadline → auto partial payout (fires releasePartialEscrow)
 * 3. SCHEDULED + past end time + no OTP → MISSED (full refund to household)
 */
async function autoReleaseExpired() {
  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')

    // Case 1: ARRIVED + past deadline + no confirmation from either party → full refund to household
    // Spec: "Normal, neither party acts within 24h → full refund to household"
    const { rows: toRefund } = await dbClient.query(
      `UPDATE sessions
       SET status = 'MISSED',
           updated_at = now()
       WHERE status = 'ARRIVED'
         AND otp_verified_at IS NOT NULL
         AND confirmation_deadline < now()
       RETURNING id, booking_id, session_amount`
    )

    // Case 2: INTERRUPTED + past deadline → auto partial payout
    const { rows: toPartialPay } = await dbClient.query(
      `SELECT id, booking_id, partial_amount
       FROM sessions
       WHERE status = 'INTERRUPTED'
         AND confirmation_deadline < now()`
    )

    // Mark INTERRUPTED sessions as COMPLETED (partial pay fires after commit)
    if (toPartialPay.length > 0) {
      const ids = toPartialPay.map(r => r.id)
      await dbClient.query(
        `UPDATE sessions
         SET status = 'COMPLETED', completion_marked_at = now(), updated_at = now()
         WHERE id = ANY($1::uuid[])`,
        [ids]
      )
    }

    // Case 3: SCHEDULED + past end time + no OTP → MISSED
    const { rows: toMiss } = await dbClient.query(
      `UPDATE sessions
       SET status = 'MISSED', updated_at = now()
       WHERE status = 'SCHEDULED'
         AND (scheduled_date + scheduled_end_time::interval) < now()
         AND otp_verified_at IS NULL
       RETURNING id, booking_id`
    )

    // Sync booking statuses for all affected bookings
    const affectedBookingIds = [
      ...toRefund.map(r => r.booking_id),
      ...toPartialPay.map(r => r.booking_id),
      ...toMiss.map(r => r.booking_id),
    ]
    const uniqueIds = [...new Set(affectedBookingIds)]
    for (const bid of uniqueIds) {
      await syncBookingStatus(dbClient, bid)
    }

    await dbClient.query('COMMIT')

    // After commit: fire partial payouts for auto-resolved INTERRUPTED sessions
    if (toPartialPay.length > 0) {
      const { releasePartialEscrow } = require('../payments/payments.service')
      for (const s of toPartialPay) {
        try {
          await releasePartialEscrow(s.booking_id, s.partial_amount)
          console.log(`[AutoRelease] Partial escrow released for session ${s.id}: ${s.partial_amount} XAF`)
        } catch (payErr) {
          console.error(`[AutoRelease] Partial payout failed for session ${s.id}:`, payErr.message)
        }
      }
    }

    return {
      autoRefunded: toRefund.length,
      autoPartialPaid: toPartialPay.length,
      markedMissed: toMiss.length,
      affectedBookings: uniqueIds.length,
    }
  } catch (err) {
    await dbClient.query('ROLLBACK')
    throw err
  } finally {
    dbClient.release()
  }
}

// ── Sync Booking Status ────────────────────────────────────────────────────────
/**
 * Internal helper — recalculates booking.status from its session statuses.
 * Must be called within an existing DB transaction (dbClient).
 */
async function syncBookingStatus(dbClient, bookingId) {
  const { rows } = await dbClient.query(
    `SELECT status FROM sessions WHERE booking_id = $1`,
    [bookingId]
  )
  const statuses = rows.map(r => r.status)

  let newBookingStatus = null

  if (statuses.every(s => s === 'COMPLETED')) {
    newBookingStatus = 'completed'
  } else if (statuses.some(s => s === 'DISPUTED')) {
    newBookingStatus = 'disputed'
  } else if (statuses.some(s => ['ARRIVED', 'AWAITING_CONFIRMATION', 'INTERRUPTED'].includes(s))) {
    newBookingStatus = 'in_progress'
  }
  // Otherwise leave booking status as-is (accepted/confirmed)

  if (newBookingStatus) {
    await dbClient.query(
      `UPDATE bookings SET status = $2, updated_at = now() WHERE id = $1`,
      [bookingId, newBookingStatus]
    )
  }
}

module.exports = {
  generateSessionsForBooking,
  getSessionsByBooking,
  getSession,
  verifyOtp,
  confirmSession,
  providerCompleteSession,
  disputeSession,
  skipSession,
  autoReleaseExpired,
  reportUnableToComplete,
  confirmPartialPayment,
}

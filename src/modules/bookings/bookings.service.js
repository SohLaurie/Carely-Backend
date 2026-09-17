const pool = require('../../config/db')
const { generateSessionsForBooking } = require('../sessions/sessions.service')
const { createNotification } = require('../notifications/notifications.service')

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Calculates total_sessions count from booking parameters.
 */
function calcTotalSessions(sessionType, selectedDays, durationWeeks) {
  if (sessionType === 'once') return 1
  return (selectedDays?.length || 0) * (durationWeeks || 1)
}

// ── Create Booking ─────────────────────────────────────────────────────────────
async function createBooking(bookerId, data) {
  const {
    providerId,
    sessionType,
    startDate,
    startTime,
    endTime,
    durationWeeks,
    selectedDays,
    notes,
    subtotal,
    serviceFee,
    totalPrice,
    promoCode,
    promoReferralCodeId,
    promoReferrerId,
  } = data

  // Verify provider exists and is approved
  const { rows: providerRows } = await pool.query(
    `SELECT p.id, u.first_name, u.last_name
     FROM providers p
     JOIN users u ON u.id = p.id
     WHERE p.id = $1 AND p.approval_status = 'approved' AND p.is_available = true`,
    [providerId]
  )
  if (providerRows.length === 0) {
    const err = new Error('Provider not found, not approved, or currently unavailable.')
    err.status = 404
    throw err
  }

  // Prevent self-booking
  if (bookerId === providerId) {
    const err = new Error('You cannot book yourself.')
    err.status = 400
    throw err
  }

  // Verify provider availability for initial date/time
  const { checkAvailability } = require('../availability/availability.service')
  const avail = await checkAvailability(providerId, startDate, startTime, endTime)
  if (!avail.available) {
    const err = new Error(avail.reason)
    err.status = 409
    throw err
  }

  const totalSessions = calcTotalSessions(sessionType, selectedDays, durationWeeks)

  const { rows } = await pool.query(
    `INSERT INTO bookings
       (booker_id, provider_id, session_type, start_date, start_time, end_time,
        duration_weeks, selected_days, notes, subtotal, service_fee, total_price,
        total_sessions, status, payment_status)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', 'unpaid')
     RETURNING *`,
    [
      bookerId,
      providerId,
      sessionType,
      startDate,
      startTime,
      endTime,
      sessionType === 'once' ? 1 : (durationWeeks || 1),
      sessionType === 'once' ? null : selectedDays,
      notes || null,
      subtotal,
      serviceFee ?? 5,
      totalPrice,
      totalSessions,
    ]
  )

  const bookingId = rows[0].id

  // Apply promo code if provided and referral data is available
  if (promoCode && promoReferralCodeId && promoReferrerId) {
    try {
      const { applyPromoToBooking } = require('../carecredits/carecredits.service')
      await applyPromoToBooking(bookingId, bookerId, promoReferralCodeId, promoReferrerId)
    } catch (ccErr) {
      console.warn('[CareCred] applyPromoToBooking non-fatal error:', ccErr.message)
    }
  }

  // Notify the provider about the new booking request
  const bookerRow = await pool.query(
    `SELECT first_name, last_name FROM users WHERE id = $1`,
    [bookerId]
  )
  const bookerName = bookerRow.rows[0]
    ? `${bookerRow.rows[0].first_name} ${bookerRow.rows[0].last_name}`.trim()
    : 'A household'
  await createNotification(
    providerId,
    'booking_request',
    'New booking request',
    `${bookerName} has sent you a booking request for ${startDate}. Review and accept or decline.`,
    { bookingId }
  )

  return rows[0]
}


// ── List Bookings ──────────────────────────────────────────────────────────────
async function listBookings(userId, role) {
  let query
  let params

  if (role === 'admin') {
    query = `
      SELECT b.*,
        COALESCE((SELECT json_agg(s ORDER BY s.session_number) FROM sessions s WHERE s.booking_id = b.id), '[]'::json) AS sessions,
        json_build_object(
          'id', u.id, 'firstName', u.first_name, 'lastName', u.last_name, 'email', u.email, 'phone', u.phone
        ) AS booker,
        json_build_object(
          'id', pu.id, 'firstName', pu.first_name, 'lastName', pu.last_name,
          'photoUrl', p.photo_url, 'specialties', p.specialties, 'profession', p.profession, 'pricePerHour', p.price_per_hour
        ) AS provider
      FROM bookings b
      JOIN users u ON u.id = b.booker_id
      JOIN providers p ON p.id = b.provider_id
      JOIN users pu ON pu.id = p.id
      ORDER BY b.created_at DESC`
    params = []
  } else if (role === 'provider') {
    // Provider sees bookings directed at them + bookings they made as a client
    query = `
      SELECT b.*,
        COALESCE((SELECT json_agg(s ORDER BY s.session_number) FROM sessions s WHERE s.booking_id = b.id), '[]'::json) AS sessions,
        json_build_object(
          'id', u.id, 'firstName', u.first_name, 'lastName', u.last_name, 'phone', u.phone, 'email', u.email
        ) AS booker,
        json_build_object(
          'id', pu.id, 'firstName', pu.first_name, 'lastName', pu.last_name,
          'photoUrl', p.photo_url, 'specialties', p.specialties, 'profession', p.profession, 'pricePerHour', p.price_per_hour
        ) AS provider
      FROM bookings b
      JOIN users u ON u.id = b.booker_id
      JOIN providers p ON p.id = b.provider_id
      JOIN users pu ON pu.id = p.id
      WHERE b.provider_id = $1 OR b.booker_id = $1
      ORDER BY b.created_at DESC`
    params = [userId]
  } else {
    // Client sees only their own bookings
    query = `
      SELECT b.*,
        COALESCE((SELECT json_agg(s ORDER BY s.session_number) FROM sessions s WHERE s.booking_id = b.id), '[]'::json) AS sessions,
        json_build_object(
          'id', pu.id, 'firstName', pu.first_name, 'lastName', pu.last_name,
          'photoUrl', p.photo_url, 'specialties', p.specialties, 'profession', p.profession,
          'pricePerHour', p.price_per_hour, 'rating', p.rating, 'location', p.location
        ) AS provider
      FROM bookings b
      JOIN providers p ON p.id = b.provider_id
      JOIN users pu ON pu.id = p.id
      WHERE b.booker_id = $1
      ORDER BY b.created_at DESC`
    params = [userId]
  }

  const { rows } = await pool.query(query, params)
  return rows
}

// ── Get Single Booking (with sessions) ────────────────────────────────────────
async function getBooking(bookingId, userId, role) {
  const { rows } = await pool.query(
    `SELECT b.*,
       json_build_object(
         'id', u.id, 'firstName', u.first_name, 'lastName', u.last_name,
         'phone', u.phone, 'email', u.email
       ) AS booker,
       json_build_object(
         'id', pu.id, 'firstName', pu.first_name, 'lastName', pu.last_name,
         'photoUrl', p.photo_url, 'specialties', p.specialties, 'profession', p.profession,
         'pricePerHour', p.price_per_hour, 'rating', p.rating,
         'location', p.location
       ) AS provider
     FROM bookings b
     JOIN users u ON u.id = b.booker_id
     JOIN providers p ON p.id = b.provider_id
     JOIN users pu ON pu.id = p.id
     WHERE b.id = $1`,
    [bookingId]
  )

  if (rows.length === 0) {
    const err = new Error('Booking not found.')
    err.status = 404
    throw err
  }

  const booking = rows[0]
  const isOwner =
    booking.booker_id === userId ||
    booking.provider_id === userId ||
    role === 'admin'

  if (!isOwner) {
    const err = new Error('Access denied.')
    err.status = 403
    throw err
  }

  // Attach sessions (hide OTP until paid)
  const { rows: sessionRows } = await pool.query(
    `SELECT
       id, session_number, week_number, scheduled_date,
       scheduled_start_time, scheduled_end_time, session_amount, status,
       otp_verified_at, completion_marked_at, confirmation_deadline,
       dispute_reason, disputed_at,
       CASE WHEN $2 = 'paid' THEN otp_code ELSE NULL END AS otp_code
     FROM sessions
     WHERE booking_id = $1
     ORDER BY session_number ASC`,
    [bookingId, booking.payment_status]
  )

  booking.sessions = sessionRows
  return booking
}

// ── Accept Booking (Provider) ──────────────────────────────────────────────────
// Moves status to 'accepted' and generates all session rows with OTPs.
async function acceptBooking(bookingId, providerId) {
  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')

    const { rows } = await dbClient.query(
      'SELECT * FROM bookings WHERE id = $1 FOR UPDATE',
      [bookingId]
    )
    if (rows.length === 0) {
      const err = new Error('Booking not found.')
      err.status = 404
      throw err
    }
    const booking = rows[0]

    if (booking.provider_id !== providerId) {
      const err = new Error('This booking is not directed at you.')
      err.status = 403
      throw err
    }
    if (booking.status !== 'pending') {
      const err = new Error(`Booking is already ${booking.status}. Only pending bookings can be accepted.`)
      err.status = 400
      throw err
    }

    // Update booking status
    await dbClient.query(
      `UPDATE bookings SET status = 'accepted', updated_at = now() WHERE id = $1`,
      [bookingId]
    )

    // Generate session rows (OTPs created here, revealed to client after payment)
    const count = await generateSessionsForBooking(dbClient, booking)

    await dbClient.query('COMMIT')

    // Notify the household that their booking was accepted
    const providerRow = await pool.query(
      `SELECT u.first_name, u.last_name FROM users u WHERE u.id = $1`,
      [providerId]
    )
    const providerName = providerRow.rows[0]
      ? `${providerRow.rows[0].first_name} ${providerRow.rows[0].last_name}`.trim()
      : 'Your provider'
    await createNotification(
      booking.booker_id,
      'booking_accepted',
      'Booking accepted! Please pay to confirm',
      `${providerName} accepted your booking request. Complete the payment to confirm your sessions.`,
      { bookingId }
    )

    return {
      message: `Booking accepted. ${count} session(s) scheduled.`,
      bookingId,
      totalSessions: count,
    }
  } catch (err) {
    await dbClient.query('ROLLBACK')
    throw err
  } finally {
    dbClient.release()
  }

  // Hold 5 CC for this booking (non-blocking — do not fail accept on CC error)
  try {
    const { holdCreditsForBooking } = require('../carecredits/carecredits.service')
    await holdCreditsForBooking(providerId, bookingId)
  } catch (ccErr) {
    console.warn('[CareCred] holdCreditsForBooking non-fatal error:', ccErr.message)
  }
}


// ── Cancel Booking ─────────────────────────────────────────────────────────────
async function cancelBooking(bookingId, userId, role) {
  const { rows } = await pool.query(
    'SELECT * FROM bookings WHERE id = $1',
    [bookingId]
  )
  if (rows.length === 0) {
    const err = new Error('Booking not found.')
    err.status = 404
    throw err
  }
  const booking = rows[0]

  const isOwner = booking.booker_id === userId || booking.provider_id === userId
  if (!isOwner && role !== 'admin') {
    const err = new Error('Access denied.')
    err.status = 403
    throw err
  }

  const cancellableStatuses = ['pending', 'accepted', 'confirmed']
  if (!cancellableStatuses.includes(booking.status)) {
    const err = new Error(`A booking with status '${booking.status}' cannot be cancelled.`)
    err.status = 400
    throw err
  }

  await pool.query(
    `UPDATE bookings SET status = 'cancelled', updated_at = now() WHERE id = $1`,
    [bookingId]
  )

  // Also mark all SCHEDULED sessions as SKIPPED (they won't happen)
  await pool.query(
    `UPDATE sessions SET status = 'SKIPPED', updated_at = now()
     WHERE booking_id = $1 AND status = 'SCHEDULED'`,
    [bookingId]
  )

  // Notify the other party
  const cancellerRow = await pool.query(
    `SELECT first_name, last_name FROM users WHERE id = $1`, [userId]
  )
  const cancellerName = cancellerRow.rows[0]
    ? `${cancellerRow.rows[0].first_name} ${cancellerRow.rows[0].last_name}`.trim()
    : 'A party'

  const recipientId = booking.booker_id === userId ? booking.provider_id : booking.booker_id
  if (recipientId) {
    await createNotification(
      recipientId,
      'booking_cancelled',
      'Booking cancelled',
      `${cancellerName} has cancelled the booking. Any escrowed funds will be refunded.`,
      { bookingId }
    )
  }

  // Refund held CC if provider had accepted (non-blocking)
  if (booking.provider_id) {
    try {
      const { refundHeldCredits } = require('../carecredits/carecredits.service')
      await refundHeldCredits(booking.provider_id, bookingId)
    } catch (ccErr) {
      console.warn('[CareCred] refundHeldCredits non-fatal error:', ccErr.message)
    }
  }

  return { message: 'Booking cancelled successfully.' }
}


// ── Decline Booking (Provider) ─────────────────────────────────────────────────
// Provider explicitly rejects a pending booking (before accepting).
async function declineBooking(bookingId, providerId) {
  const { rows } = await pool.query(
    'SELECT * FROM bookings WHERE id = $1',
    [bookingId]
  )
  if (rows.length === 0) {
    const err = new Error('Booking not found.')
    err.status = 404
    throw err
  }
  const booking = rows[0]

  if (booking.provider_id !== providerId) {
    const err = new Error('This booking is not directed at you.')
    err.status = 403
    throw err
  }
  if (booking.status !== 'pending') {
    const err = new Error(`Only pending bookings can be declined. Current status: ${booking.status}`)
    err.status = 400
    throw err
  }

  await pool.query(
    `UPDATE bookings
     SET status = 'cancelled', declined_by_provider = true, updated_at = now()
     WHERE id = $1`,
    [bookingId]
  )

  // Notify the household
  const providerRow = await pool.query(
    `SELECT first_name, last_name FROM users WHERE id = $1`, [providerId]
  )
  const providerName = providerRow.rows[0]
    ? `${providerRow.rows[0].first_name} ${providerRow.rows[0].last_name}`.trim()
    : 'The provider'
  await createNotification(
    booking.booker_id,
    'booking_declined',
    'Booking request declined',
    `${providerName} is unable to take your booking. Please explore other verified caregivers.`,
    { bookingId }
  )

  return { message: 'Booking declined. The client will be notified.' }
}

// ── Confirm Booking After Payment ──────────────────────────────────────────────
// Called by payments service after successful escrow payment.
async function confirmBookingAfterPayment(bookingId) {
  const { rows } = await pool.query(
    `UPDATE bookings
     SET status = 'confirmed', payment_status = 'paid', updated_at = now()
     WHERE id = $1
     RETURNING booker_id, provider_id`,
    [bookingId]
  )
  if (rows.length > 0) {
    const { booker_id, provider_id } = rows[0]
    // Notify household
    await createNotification(
      booker_id,
      'payment_confirmed',
      'Payment confirmed — escrow secured',
      'Your payment is held securely in escrow. Your provider will arrive on the scheduled date.',
      { bookingId }
    )
    // Notify provider
    await createNotification(
      provider_id,
      'payment_received',
      'Payment received — booking confirmed',
      'The client completed payment. Your booking is confirmed. Check your schedule for the session details.',
      { bookingId }
    )
  }
}

module.exports = {
  createBooking,
  listBookings,
  getBooking,
  acceptBooking,
  declineBooking,
  cancelBooking,
  confirmBookingAfterPayment,
}

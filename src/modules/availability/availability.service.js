const pool = require('../../config/db')

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Converts JS Date.getDay() (0=Sun..6=Sat) to Carely day convention (0=Mon..6=Sun).
 */
function jsDayToAppDay(jsDay) {
  return (jsDay + 6) % 7
}

/**
 * Returns formatted 'YYYY-MM-DD'
 */
function toISODate(d) {
  if (!d) return ''
  if (typeof d === 'string') return d.split('T')[0]
  const yr = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${yr}-${mo}-${day}`
}

// ── Weekly Recurring Schedule ──────────────────────────────────────────────────

/**
 * Get provider's weekly working schedule.
 */
async function getProviderSchedule(providerId) {
  const { rows } = await pool.query(
    `SELECT id, day_of_week, start_time, end_time, is_active
     FROM provider_schedules
     WHERE provider_id = $1
     ORDER BY day_of_week ASC, start_time ASC`,
    [providerId]
  )
  return rows
}

/**
 * Set/replace provider's weekly schedule in a transaction.
 */
async function setProviderSchedule(providerId, scheduleEntries) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Remove existing schedule
    await client.query('DELETE FROM provider_schedules WHERE provider_id = $1', [providerId])

    const inserted = []
    for (const entry of scheduleEntries) {
      const { dayOfWeek, startTime, endTime, isActive = true } = entry
      const { rows } = await client.query(
        `INSERT INTO provider_schedules
           (provider_id, day_of_week, start_time, end_time, is_active)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, day_of_week, start_time, end_time, is_active`,
        [providerId, dayOfWeek, startTime, endTime, isActive]
      )
      inserted.push(rows[0])
    }

    await client.query('COMMIT')
    return inserted
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── Blocked Slots / Time Off ───────────────────────────────────────────────────

/**
 * Block a date or time slot (ad-hoc blackout / time off).
 */
async function blockSlot(providerId, { startDate, endDate, startTime, endTime, reason }) {
  const endD = endDate || startDate
  const { rows } = await pool.query(
    `INSERT INTO provider_blocked_slots
       (provider_id, start_date, end_date, start_time, end_time, reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [providerId, startDate, endD, startTime || null, endTime || null, reason || null]
  )
  return rows[0]
}

/**
 * List all blocked slots for a provider (optional date range filter).
 */
async function listBlockedSlots(providerId, { fromDate, toDate } = {}) {
  const conditions = ['provider_id = $1']
  const params = [providerId]
  let idx = 2

  if (fromDate) {
    conditions.push(`end_date >= $${idx}`)
    params.push(fromDate)
    idx++
  }
  if (toDate) {
    conditions.push(`start_date <= $${idx}`)
    params.push(toDate)
    idx++
  }

  const { rows } = await pool.query(
    `SELECT id, start_date, end_date, start_time, end_time, reason, created_at
     FROM provider_blocked_slots
     WHERE ${conditions.join(' AND ')}
     ORDER BY start_date ASC, start_time ASC`,
    params
  )
  return rows
}

/**
 * Release (unblock) a blocked slot.
 */
async function releaseSlot(providerId, slotId) {
  const { rowCount } = await pool.query(
    `DELETE FROM provider_blocked_slots
     WHERE id = $1 AND provider_id = $2`,
    [slotId, providerId]
  )
  if (rowCount === 0) {
    const err = new Error('Blocked slot not found or already released.')
    err.status = 404
    throw err
  }
  return { message: 'Slot unblocked successfully.' }
}

async function unblockDate(providerId, dateStr) {
  const { rowCount } = await pool.query(
    `DELETE FROM provider_blocked_slots
     WHERE provider_id = $1 AND start_date <= $2 AND end_date >= $2`,
    [providerId, dateStr]
  )
  return { message: 'Date unblocked successfully.', count: rowCount }
}


// ── Availability Check Engine ──────────────────────────────────────────────────

/**
 * Check if a provider is free for a specific date and time range.
 * Checks:
 *  1. Blocked slots (time-off)
 *  2. Booked sessions (active bookings)
 *  3. (Optional) Weekly schedule adherence
 */
async function checkAvailability(providerId, date, startTime, endTime) {
  const targetDate = toISODate(date)

  // 1. Check for overlapping blocked slots
  const { rows: blocks } = await pool.query(
    `SELECT id, reason, start_time, end_time
     FROM provider_blocked_slots
     WHERE provider_id = $1
       AND $2 BETWEEN start_date AND end_date
       AND (
         -- All day block
         (start_time IS NULL AND end_time IS NULL)
         OR
         -- Time range overlap: start_time < endTime AND end_time > startTime
         (start_time < $4::time AND end_time > $3::time)
       )`,
    [providerId, targetDate, startTime, endTime]
  )

  if (blocks.length > 0) {
    return {
      available: false,
      reason: blocks[0].reason
        ? `Provider is unavailable: ${blocks[0].reason}`
        : 'Provider has blocked this time slot.',
      conflictType: 'blocked',
    }
  }

  // 2. Check for overlapping booked sessions
  const { rows: sessions } = await pool.query(
    `SELECT s.id, s.session_number, s.scheduled_start_time, s.scheduled_end_time, s.status
     FROM sessions s
     JOIN bookings b ON b.id = s.booking_id
     WHERE b.provider_id = $1
       AND s.scheduled_date = $2
       AND s.status NOT IN ('MISSED', 'SKIPPED')
       AND b.status NOT IN ('cancelled')
       AND (s.scheduled_start_time < $4::time AND s.scheduled_end_time > $3::time)`,
    [providerId, targetDate, startTime, endTime]
  )

  if (sessions.length > 0) {
    return {
      available: false,
      reason: 'Provider is already booked for another session during this time.',
      conflictType: 'booked',
    }
  }

  // 3. Check weekly schedule (if provider has configured one)
  const d = new Date(targetDate)
  const appDay = jsDayToAppDay(d.getDay())

  const { rows: schedules } = await pool.query(
    `SELECT start_time, end_time
     FROM provider_schedules
     WHERE provider_id = $1 AND day_of_week = $2 AND is_active = true`,
    [providerId, appDay]
  )

  if (schedules.length > 0) {
    const fitsSchedule = schedules.some(
      s => s.start_time <= startTime && s.end_time >= endTime
    )
    if (!fitsSchedule) {
      return {
        available: false,
        reason: 'Requested time falls outside the provider regular working schedule.',
        conflictType: 'outside_schedule',
      }
    }
  }

  return { available: true }
}

// ── Calendar View Aggregator ───────────────────────────────────────────────────

/**
 * Computes month-level calendar state for provider dashboard.
 * Mirrors the frontend's CalendarWidget dayStates format:
 *   dayStates: { [dayNumber]: 'booked' | 'recurring' | 'blocked' }
 * Also returns detailed events list for each day.
 */
async function getProviderCalendar(providerId, year, month) {
  // Normalize year and month (month: 1-12)
  const yr = parseInt(year, 10)
  const mo = parseInt(month, 10)

  const startDate = `${yr}-${String(mo).padStart(2, '0')}-01`
  const lastDay = new Date(yr, mo, 0).getDate()
  const endDate = `${yr}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // 1. Fetch all sessions in this month
  const { rows: sessions } = await pool.query(
    `SELECT
       s.id, s.booking_id, s.session_number, s.week_number,
       s.scheduled_date, s.scheduled_start_time, s.scheduled_end_time,
       s.status, s.session_amount,
       b.session_type, b.booker_id,
       u.first_name AS client_first_name, u.last_name AS client_last_name
     FROM sessions s
     JOIN bookings b ON b.id = s.booking_id
     JOIN users u ON u.id = b.booker_id
     WHERE b.provider_id = $1
       AND s.scheduled_date BETWEEN $2 AND $3
       AND s.status NOT IN ('SKIPPED', 'MISSED')
       AND b.status NOT IN ('cancelled')
     ORDER BY s.scheduled_date ASC, s.scheduled_start_time ASC`,
    [providerId, startDate, endDate]
  )

  // 2. Fetch all blocked slots in this month
  const { rows: blocks } = await pool.query(
    `SELECT id, start_date, end_date, start_time, end_time, reason
     FROM provider_blocked_slots
     WHERE provider_id = $1
       AND start_date <= $3
       AND end_date >= $2
     ORDER BY start_date ASC`,
    [providerId, startDate, endDate]
  )

  // 3. Build dayStates mapping
  const dayStates = {}
  const eventsByDay = {}

  for (let d = 1; d <= lastDay; d++) {
    eventsByDay[d] = []
  }

  // Populate booked sessions
  for (const sess of sessions) {
    const sDateStr = toISODate(sess.scheduled_date)
    const dayNum = parseInt(sDateStr.split('-')[2], 10)

    const isRecurring = sess.session_type === 'recurring'
    if (!dayStates[dayNum]) {
      dayStates[dayNum] = isRecurring ? 'recurring' : 'booked'
    }

    if (eventsByDay[dayNum]) {
      eventsByDay[dayNum].push({
        type: 'session',
        id: sess.id,
        bookingId: sess.booking_id,
        sessionNumber: sess.session_number,
        sessionType: sess.session_type,
        time: `${sess.scheduled_start_time.slice(0, 5)} – ${sess.scheduled_end_time.slice(0, 5)}`,
        status: sess.status,
        clientName: `${sess.client_first_name} ${sess.client_last_name}`.trim(),
      })
    }
  }

  // Populate blocked slots
  for (const block of blocks) {
    const bStartStr = toISODate(block.start_date)
    const bEndStr = toISODate(block.end_date)

    for (let d = 1; d <= lastDay; d++) {
      const curDateStr = `${yr}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      if (curDateStr >= bStartStr && curDateStr <= bEndStr) {
        dayStates[d] = 'blocked'
        if (eventsByDay[d]) {
          eventsByDay[d].push({
            type: 'blocked',
            id: block.id,
            reason: block.reason || 'Unavailable',
            time: block.start_time
              ? `${block.start_time.slice(0, 5)} – ${block.end_time.slice(0, 5)}`
              : 'All day',
          })
        }
      }
    }
  }

  return {
    year: yr,
    month: mo,
    totalDays: lastDay,
    dayStates,
    eventsByDay,
    totalSessions: sessions.length,
    totalBlockedDays: Object.values(dayStates).filter(s => s === 'blocked').length,
  }
}

module.exports = {
  getProviderSchedule,
  setProviderSchedule,
  blockSlot,
  listBlockedSlots,
  releaseSlot,
  unblockDate,
  checkAvailability,
  getProviderCalendar,
}

const pool = require('../../config/db')

// ── Create a notification ──────────────────────────────────────────────────────
/**
 * Creates a notification for a user.
 * @param {string} userId    - The recipient's user ID
 * @param {string} type      - e.g. 'booking_request', 'booking_accepted', 'payment', etc.
 * @param {string} title     - Short headline
 * @param {string} body      - Longer description (optional)
 * @param {object} metadata  - Extra data (bookingId, sessionId, etc.) — optional
 */
async function createNotification(userId, type, title, body = null, metadata = null) {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, title, body, metadata ? JSON.stringify(metadata) : null]
    )
  } catch (err) {
    // Notifications are non-critical — log but don't throw
    console.warn('[Notifications] Failed to create notification:', err.message)
  }
}

// ── Get notifications for a user ───────────────────────────────────────────────
async function getNotifications(userId, { limit = 50, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, type, title, body, metadata, is_read, is_archived, created_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, Number(limit), Number(offset)]
  )
  return rows
}

// ── Mark one notification as read ──────────────────────────────────────────────
async function markRead(notifId, userId) {
  await pool.query(
    `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
    [notifId, userId]
  )
}

// ── Mark all notifications as read ─────────────────────────────────────────────
async function markAllRead(userId) {
  await pool.query(
    `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
    [userId]
  )
}

// ── Archive / unarchive one notification ───────────────────────────────────────
async function toggleArchive(notifId, userId) {
  await pool.query(
    `UPDATE notifications
     SET is_archived = NOT is_archived
     WHERE id = $1 AND user_id = $2`,
    [notifId, userId]
  )
}

// ── Delete one notification ────────────────────────────────────────────────────
async function deleteNotification(notifId, userId) {
  await pool.query(
    `DELETE FROM notifications WHERE id = $1 AND user_id = $2`,
    [notifId, userId]
  )
}

// ── Get unread count ───────────────────────────────────────────────────────────
async function getUnreadCount(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND is_read = false AND is_archived = false`,
    [userId]
  )
  return Number(rows[0]?.count || 0)
}

module.exports = {
  createNotification,
  getNotifications,
  markRead,
  markAllRead,
  toggleArchive,
  deleteNotification,
  getUnreadCount,
}

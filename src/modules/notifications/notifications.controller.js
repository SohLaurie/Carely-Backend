const notifService = require('./notifications.service')

// GET /api/notifications
async function listNotifications(req, res, next) {
  try {
    const { limit = 50, offset = 0 } = req.query
    const notifications = await notifService.getNotifications(req.user.id, {
      limit: Number(limit),
      offset: Number(offset),
    })
    const unreadCount = notifications.filter(n => !n.is_read && !n.is_archived).length
    res.json({ notifications, unreadCount })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/notifications/:id/read
async function markRead(req, res, next) {
  try {
    await notifService.markRead(req.params.id, req.user.id)
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/notifications/read-all
async function markAllRead(req, res, next) {
  try {
    await notifService.markAllRead(req.user.id)
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/notifications/:id/archive
async function toggleArchive(req, res, next) {
  try {
    await notifService.toggleArchive(req.params.id, req.user.id)
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
}

// DELETE /api/notifications/:id
async function deleteNotification(req, res, next) {
  try {
    await notifService.deleteNotification(req.params.id, req.user.id)
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  listNotifications,
  markRead,
  markAllRead,
  toggleArchive,
  deleteNotification,
}

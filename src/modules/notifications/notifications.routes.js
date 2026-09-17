const { Router } = require('express')
const auth = require('../../middleware/auth')
const ctrl = require('./notifications.controller')

const router = Router()

// All notification routes require authentication
router.use(auth)

/**
 * GET /api/notifications
 * List notifications for the current user (newest first).
 */
router.get('/', ctrl.listNotifications)

/**
 * PATCH /api/notifications/read-all
 * Mark ALL notifications for the current user as read.
 * Must be defined BEFORE /:id/read to avoid route collision.
 */
router.patch('/read-all', ctrl.markAllRead)

/**
 * PATCH /api/notifications/:id/read
 * Mark one notification as read.
 */
router.patch('/:id/read', ctrl.markRead)

/**
 * PATCH /api/notifications/:id/archive
 * Toggle archive state on one notification.
 */
router.patch('/:id/archive', ctrl.toggleArchive)

/**
 * DELETE /api/notifications/:id
 * Permanently delete one notification.
 */
router.delete('/:id', ctrl.deleteNotification)

module.exports = router

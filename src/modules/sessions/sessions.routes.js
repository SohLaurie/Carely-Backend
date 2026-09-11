const { Router } = require('express')
const { z } = require('zod')
const auth = require('../../middleware/auth')
const requireRole = require('../../middleware/requireRole')
const validate = require('../../middleware/validate')
const ctrl = require('./sessions.controller')

const router = Router()

// All session routes require authentication
router.use(auth)

/**
 * GET /api/sessions/:id
 * Get a single session detail.
 * Accessible by the booking's booker or provider.
 */
router.get('/:id', ctrl.getSession)

/**
 * POST /api/sessions/:id/verify-otp
 * Provider enters the OTP the client verbally shared on arrival.
 * Only the assigned provider can call this.
 */
router.post(
  '/:id/verify-otp',
  requireRole('provider'),
  validate(z.object({ code: z.string().length(6, 'OTP must be exactly 6 digits') })),
  ctrl.verifyOtp
)

/**
 * POST /api/sessions/:id/complete
 * Provider marks the session completed.
 */
router.post(
  '/:id/complete',
  requireRole('provider'),
  ctrl.providerCompleteSession
)

/**
 * POST /api/sessions/:id/confirm
 * Client explicitly confirms a session was completed.
 * Triggers escrow release for this session's amount.
 */
router.post('/:id/confirm', ctrl.confirmSession)

/**
 * POST /api/sessions/:id/dispute
 * Either party can flag a dispute on a session.
 * Freezes escrow and notifies admin.
 */
router.post(
  '/:id/dispute',
  validate(z.object({ reason: z.string().min(10, 'Please describe the issue in at least 10 characters') })),
  ctrl.disputeSession
)

/**
 * POST /api/sessions/:id/skip
 * Client skips a SCHEDULED session (prorated credit applied).
 */
router.post('/:id/skip', ctrl.skipSession)

/**
 * POST /api/sessions/auto-release
 * Admin / internal cron: auto-complete expired ARRIVED sessions
 * and mark overdue SCHEDULED sessions as MISSED.
 */
router.post('/auto-release', requireRole('admin'), ctrl.autoRelease)

module.exports = router

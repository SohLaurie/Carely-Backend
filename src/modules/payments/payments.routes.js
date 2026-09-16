const { Router } = require('express')
const { z } = require('zod')
const auth = require('../../middleware/auth')
const requireRole = require('../../middleware/requireRole')
const validate = require('../../middleware/validate')
const ctrl = require('./payments.controller')

const router = Router()

const initiateSchema = z.object({
  bookingId:    z.string().uuid('Invalid booking ID'),
  providerName: z.enum(['mtn', 'orange'], { errorMap: () => ({ message: "provider must be 'mtn' or 'orange'" }) }),
  phoneNumber:  z.string().min(8, 'Phone number is required'),
})

/**
 * POST /api/payments/initiate
 * Client initiates an escrow payment for an accepted booking via Campay.
 */
router.post('/initiate', auth, validate(initiateSchema), ctrl.initiatePayment)

/**
 * POST /api/payments/webhook
 * Campay webhook listener for payment status updates.
 */
router.post('/webhook', ctrl.handleWebhook)

/**
 * GET /api/payments/verify/:reference
 * Verify transaction status from Campay.
 */
router.get('/verify/:reference', auth, ctrl.verifyPayment)

/**
 * GET /api/payments/campay-status
 * Check Campay connection status and environment configuration (public/diagnostic).
 */
router.get('/campay-status', ctrl.getCampayStatus)

/**
 * GET /api/payments/:bookingId
 * Get the payment record for a booking (booker, provider, or admin).
 */
router.get('/:bookingId', auth, ctrl.getPaymentByBooking)

/**
 * POST /api/payments/:bookingId/release
 * Admin manually releases escrow to the provider.
 */
router.post('/:bookingId/release', auth, requireRole('admin'), ctrl.releaseEscrow)

/**
 * POST /api/payments/:bookingId/refund
 * Admin refunds escrow back to the client and cancels the booking.
 */
router.post('/:bookingId/refund', auth, requireRole('admin'), ctrl.refundPayment)

module.exports = router

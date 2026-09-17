const { Router } = require('express')
const { z } = require('zod')
const auth = require('../../middleware/auth')
const requireRole = require('../../middleware/requireRole')
const validate = require('../../middleware/validate')
const ctrl = require('./bookings.controller')

const router = Router()

// All booking routes require authentication
router.use(auth)

// ── Booking CRUD ───────────────────────────────────────────────────────────────

const createBookingSchema = z.object({
  providerId:   z.string().uuid('Invalid provider ID'),
  sessionType:  z.enum(['once', 'recurring']),
  startDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  startTime:    z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be HH:MM'),
  endTime:      z.string().regex(/^\d{2}:\d{2}$/, 'endTime must be HH:MM'),
  durationWeeks:z.number().int().min(1).max(52).optional(),
  selectedDays: z.array(z.number().int().min(0).max(6)).optional(),
  notes:        z.string().max(500).optional(),
  subtotal:     z.number().int().positive(),
  serviceFee:   z.number().int().min(0).optional(),
  totalPrice:   z.number().int().positive(),
  promoCode:    z.string().optional(),
  promoReferralCodeId: z.string().uuid().optional(),
  promoReferrerId:     z.string().uuid().optional(),
}).refine(
  data => data.sessionType === 'once' || (data.selectedDays && data.selectedDays.length > 0),
  { message: 'Recurring bookings must specify at least one selected day.', path: ['selectedDays'] }
)


/**
 * POST /api/bookings
 * Create a booking. Any authenticated user (client or provider-acting-as-client).
 */
router.post('/', validate(createBookingSchema), ctrl.createBooking)

/**
 * GET /api/bookings
 * List bookings for the current user (role-aware).
 */
router.get('/', ctrl.listBookings)

/**
 * GET /api/bookings/:id
 * Get a single booking with its sessions attached.
 */
router.get('/:id', ctrl.getBooking)

/**
 * GET /api/bookings/:id/sessions
 * List all sessions for a booking.
 */
router.get('/:id/sessions', ctrl.getSessionsByBooking)

/**
 * PATCH /api/bookings/:id/accept
 * Provider accepts the booking → generates all session rows with OTPs.
 */
router.patch('/:id/accept', requireRole('provider'), ctrl.acceptBooking)

/**
 * PATCH /api/bookings/:id/decline
 * Provider explicitly declines a pending booking.
 */
router.patch('/:id/decline', requireRole('provider'), ctrl.declineBooking)

/**
 * PATCH /api/bookings/:id/cancel
 * Cancel a booking (booker, provider, or admin).
 * Only pending/accepted/confirmed bookings can be cancelled.
 */
router.patch('/:id/cancel', ctrl.cancelBooking)

module.exports = router

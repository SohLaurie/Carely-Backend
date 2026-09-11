const { Router } = require('express')
const { z } = require('zod')
const auth = require('../../middleware/auth')
const requireRole = require('../../middleware/requireRole')
const validate = require('../../middleware/validate')
const ctrl = require('./availability.controller')

const router = Router()

// ── Validation Schemas ─────────────────────────────────────────────────────────

const scheduleSchema = z.object({
  schedule: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be HH:MM'),
      endTime:   z.string().regex(/^\d{2}:\d{2}$/, 'endTime must be HH:MM'),
      isActive:  z.boolean().optional(),
    }).refine(data => data.startTime < data.endTime, {
      message: 'startTime must be earlier than endTime',
      path: ['endTime'],
    })
  ),
})

const blockSlotSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD').optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be HH:MM').optional(),
  endTime:   z.string().regex(/^\d{2}:\d{2}$/, 'endTime must be HH:MM').optional(),
  reason:    z.string().max(255).optional(),
}).refine(
  data => {
    if ((data.startTime && !data.endTime) || (!data.startTime && data.endTime)) return false
    if (data.startTime && data.endTime && data.startTime >= data.endTime) return false
    return true
  },
  { message: 'Both startTime and endTime must be provided, and startTime must be before endTime.', path: ['endTime'] }
)

// ── Public Routes ──────────────────────────────────────────────────────────────

/**
 * GET /api/availability/check
 * Query: ?providerId=UUID&date=YYYY-MM-DD&startTime=HH:MM&endTime=HH:MM
 * Public check if a provider is free before submitting a booking.
 */
router.get('/check', ctrl.checkAvailability)

/**
 * GET /api/availability/provider/:providerId/schedule
 * Publicly view a provider's regular weekly schedule.
 */
router.get('/provider/:providerId/schedule', ctrl.getProviderSchedule)

/**
 * GET /api/availability/provider/:providerId/calendar
 * View a provider's aggregated calendar for a month (?year=2026&month=11).
 */
router.get('/provider/:providerId/calendar', ctrl.getProviderCalendar)

// ── Authenticated Provider Routes ──────────────────────────────────────────────

/**
 * GET /api/availability/my-calendar
 * Provider: get full calendar data with dayStates and booking events for current user.
 */
router.get('/my-calendar', auth, requireRole('provider'), ctrl.getMyCalendar)

/**
 * GET /api/availability/schedule
 * Provider: get own weekly working schedule.
 */
router.get('/schedule', auth, requireRole('provider'), ctrl.getMySchedule)

/**
 * PUT /api/availability/schedule
 * Provider: configure/update own weekly working schedule.
 */
router.put('/schedule', auth, requireRole('provider'), validate(scheduleSchema), ctrl.setMySchedule)

/**
 * GET /api/availability/blocked-slots
 * Provider: list own blocked time-off slots.
 */
router.get('/blocked-slots', auth, requireRole('provider'), ctrl.listMyBlockedSlots)

/**
 * POST /api/availability/block
 * Provider: block a date or time window (time off / blackout).
 */
router.post('/block', auth, requireRole('provider'), validate(blockSlotSchema), ctrl.blockSlot)

/**
 * DELETE /api/availability/block/:id
 * Provider: unblock/release a blocked time window.
 */
router.delete('/block/:id', auth, requireRole('provider'), ctrl.releaseSlot)

/**
 * DELETE /api/availability/block-date/:date
 * Provider: unblock/release any blocked time window covering a specific date.
 */
router.delete('/block-date/:date', auth, requireRole('provider'), ctrl.unblockDate)

module.exports = router

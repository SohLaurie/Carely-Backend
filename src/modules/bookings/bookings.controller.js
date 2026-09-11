const bookingsService = require('./bookings.service')
const sessionsController = require('../sessions/sessions.controller')

// POST /api/bookings
async function createBooking(req, res, next) {
  try {
    const booking = await bookingsService.createBooking(req.user.id, req.body)
    res.status(201).json({
      message: 'Booking request submitted. Waiting for provider to accept.',
      booking,
    })
  } catch (err) { next(err) }
}

// GET /api/bookings
async function listBookings(req, res, next) {
  try {
    const bookings = await bookingsService.listBookings(req.user.id, req.user.role)
    res.json({ bookings })
  } catch (err) { next(err) }
}

// GET /api/bookings/:id
async function getBooking(req, res, next) {
  try {
    const booking = await bookingsService.getBooking(
      req.params.id,
      req.user.id,
      req.user.role
    )
    res.json({ booking })
  } catch (err) { next(err) }
}

// PATCH /api/bookings/:id/accept
async function acceptBooking(req, res, next) {
  try {
    const result = await bookingsService.acceptBooking(req.params.id, req.user.id)
    res.json(result)
  } catch (err) { next(err) }
}

// PATCH /api/bookings/:id/decline
async function declineBooking(req, res, next) {
  try {
    const result = await bookingsService.declineBooking(req.params.id, req.user.id)
    res.json(result)
  } catch (err) { next(err) }
}

// PATCH /api/bookings/:id/cancel
async function cancelBooking(req, res, next) {
  try {
    const result = await bookingsService.cancelBooking(
      req.params.id,
      req.user.id,
      req.user.role
    )
    res.json(result)
  } catch (err) { next(err) }
}

// GET /api/bookings/:id/sessions  — delegate to sessions controller
const getSessionsByBooking = sessionsController.getSessionsByBooking

module.exports = {
  createBooking,
  listBookings,
  getBooking,
  acceptBooking,
  declineBooking,
  cancelBooking,
  getSessionsByBooking,
}

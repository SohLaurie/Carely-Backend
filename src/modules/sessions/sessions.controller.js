const sessionsService = require('./sessions.service')

// GET /api/bookings/:id/sessions
async function getSessionsByBooking(req, res, next) {
  try {
    const sessions = await sessionsService.getSessionsByBooking(
      req.params.id,
      req.user.id
    )
    res.json({ sessions })
  } catch (err) { next(err) }
}

// GET /api/sessions/:id
async function getSession(req, res, next) {
  try {
    const session = await sessionsService.getSession(req.params.id, req.user.id)
    res.json({ session })
  } catch (err) { next(err) }
}

// POST /api/sessions/:id/verify-otp
async function verifyOtp(req, res, next) {
  try {
    const session = await sessionsService.verifyOtp(
      req.params.id,
      req.body.code,
      req.user.id
    )
    res.json({
      message: 'OTP verified. Session is now in progress.',
      session,
    })
  } catch (err) { next(err) }
}

// POST /api/sessions/:id/confirm
async function confirmSession(req, res, next) {
  try {
    const result = await sessionsService.confirmSession(req.params.id, req.user.id)
    res.json(result)
  } catch (err) { next(err) }
}

// POST /api/sessions/:id/dispute
async function disputeSession(req, res, next) {
  try {
    const result = await sessionsService.disputeSession(
      req.params.id,
      req.user.id,
      req.body.reason
    )
    res.json(result)
  } catch (err) { next(err) }
}

// POST /api/sessions/:id/skip
async function skipSession(req, res, next) {
  try {
    const result = await sessionsService.skipSession(req.params.id, req.user.id)
    res.json(result)
  } catch (err) { next(err) }
}

// POST /api/sessions/auto-release  (admin / internal cron)
async function autoRelease(req, res, next) {
  try {
    const result = await sessionsService.autoReleaseExpired()
    res.json({ message: 'Auto-release complete.', ...result })
  } catch (err) { next(err) }
}

// POST /api/sessions/:id/complete (provider marks job complete)
async function providerCompleteSession(req, res, next) {
  try {
    const result = await sessionsService.providerCompleteSession(req.params.id, req.user.id)
    res.json(result)
  } catch (err) { next(err) }
}

// POST /api/sessions/:id/report-unable (provider reports emergency mid-session)
async function reportUnableToComplete(req, res, next) {
  try {
    const result = await sessionsService.reportUnableToComplete(
      req.params.id,
      req.user.id,
      req.body.reason
    )
    res.json(result)
  } catch (err) { next(err) }
}

// POST /api/sessions/:id/confirm-partial (household confirms partial payment)
async function confirmPartialPayment(req, res, next) {
  try {
    const result = await sessionsService.confirmPartialPayment(req.params.id, req.user.id)
    res.json(result)
  } catch (err) { next(err) }
}

module.exports = {
  getSessionsByBooking,
  getSession,
  verifyOtp,
  confirmSession,
  providerCompleteSession,
  reportUnableToComplete,
  confirmPartialPayment,
  disputeSession,
  skipSession,
  autoRelease,
}


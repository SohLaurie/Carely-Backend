const availabilityService = require('./availability.service')

// ── Weekly Schedule ────────────────────────────────────────────────────────────

async function getMySchedule(req, res, next) {
  try {
    const schedule = await availabilityService.getProviderSchedule(req.user.id)
    res.json({ schedule })
  } catch (err) { next(err) }
}

async function setMySchedule(req, res, next) {
  try {
    const schedule = await availabilityService.setProviderSchedule(req.user.id, req.body.schedule)
    res.json({ message: 'Weekly schedule updated.', schedule })
  } catch (err) { next(err) }
}

async function getProviderSchedule(req, res, next) {
  try {
    const schedule = await availabilityService.getProviderSchedule(req.params.providerId)
    res.json({ schedule })
  } catch (err) { next(err) }
}

// ── Blocked Slots ──────────────────────────────────────────────────────────────

async function blockSlot(req, res, next) {
  try {
    const slot = await availabilityService.blockSlot(req.user.id, req.body)
    res.status(201).json({ message: 'Slot blocked successfully.', slot })
  } catch (err) { next(err) }
}

async function listMyBlockedSlots(req, res, next) {
  try {
    const slots = await availabilityService.listBlockedSlots(req.user.id, req.query)
    res.json({ blockedSlots: slots })
  } catch (err) { next(err) }
}

async function releaseSlot(req, res, next) {
  try {
    const result = await availabilityService.releaseSlot(req.user.id, req.params.id)
    res.json(result)
  } catch (err) { next(err) }
}

async function unblockDate(req, res, next) {
  try {
    const result = await availabilityService.unblockDate(req.user.id, req.params.date)
    res.json(result)
  } catch (err) { next(err) }
}

// ── Calendar View ──────────────────────────────────────────────────────────────

async function getMyCalendar(req, res, next) {
  try {
    const now = new Date()
    const year = req.query.year || now.getFullYear()
    const month = req.query.month || (now.getMonth() + 1)

    const calendar = await availabilityService.getProviderCalendar(req.user.id, year, month)
    res.json({ calendar })
  } catch (err) { next(err) }
}

async function getProviderCalendar(req, res, next) {
  try {
    const now = new Date()
    const year = req.query.year || now.getFullYear()
    const month = req.query.month || (now.getMonth() + 1)

    const calendar = await availabilityService.getProviderCalendar(req.params.providerId, year, month)
    res.json({ calendar })
  } catch (err) { next(err) }
}

// ── Availability Check ─────────────────────────────────────────────────────────

async function checkAvailability(req, res, next) {
  try {
    const { providerId, date, startTime, endTime } = req.query
    if (!providerId || !date || !startTime || !endTime) {
      const err = new Error('providerId, date, startTime, and endTime are required query parameters.')
      err.status = 400
      throw err
    }

    const result = await availabilityService.checkAvailability(providerId, date, startTime, endTime)
    res.json(result)
  } catch (err) { next(err) }
}

module.exports = {
  getMySchedule,
  setMySchedule,
  getProviderSchedule,
  blockSlot,
  listMyBlockedSlots,
  releaseSlot,
  unblockDate,
  getMyCalendar,
  getProviderCalendar,
  checkAvailability,
}

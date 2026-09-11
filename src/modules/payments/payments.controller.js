const paymentsService = require('./payments.service')

async function initiatePayment(req, res, next) {
  try {
    const { bookingId, providerName, phoneNumber } = req.body
    const result = await paymentsService.initiatePayment(
      bookingId,
      { providerName, phoneNumber },
      req.user.id
    )
    res.status(201).json(result)
  } catch (err) { next(err) }
}

async function handleWebhook(req, res, next) {
  try {
    const result = await paymentsService.handleWebhook(req.body)
    res.json(result)
  } catch (err) { next(err) }
}

async function releaseEscrow(req, res, next) {
  try {
    const result = await paymentsService.releaseEscrow(req.params.bookingId)
    res.json(result)
  } catch (err) { next(err) }
}

async function refundPayment(req, res, next) {
  try {
    const result = await paymentsService.refundPayment(req.params.bookingId)
    res.json(result)
  } catch (err) { next(err) }
}

async function getPaymentByBooking(req, res, next) {
  try {
    const payment = await paymentsService.getPaymentByBooking(
      req.params.bookingId,
      req.user.id,
      req.user.role
    )
    res.json({ payment })
  } catch (err) { next(err) }
}

async function verifyPayment(req, res, next) {
  try {
    const result = await paymentsService.verifyPayment(req.params.reference)
    res.json(result)
  } catch (err) { next(err) }
}

module.exports = {
  initiatePayment,
  verifyPayment,
  handleWebhook,
  releaseEscrow,
  refundPayment,
  getPaymentByBooking,
}

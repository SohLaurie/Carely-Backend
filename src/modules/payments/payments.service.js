const pool = require('../../config/db')
const { confirmBookingAfterPayment } = require('../bookings/bookings.service')
const campayService = require('./campay.service')

// ── Initiate Payment (Escrow via Campay) ───────────────────────────────────────
async function initiatePayment(bookingId, { providerName, phoneNumber }, payerId) {
  // Verify booking exists, belongs to payer, is accepted, and not already paid
  const { rows: bookingRows } = await pool.query(
    `SELECT b.id, b.booker_id, b.status, b.payment_status, b.total_price,
            u.email AS booker_email, u.first_name, u.last_name
     FROM bookings b
     JOIN users u ON u.id = b.booker_id
     WHERE b.id = $1`,
    [bookingId]
  )
  if (bookingRows.length === 0) {
    const err = new Error('Booking not found.')
    err.status = 404
    throw err
  }
  const booking = bookingRows[0]

  if (booking.booker_id !== payerId) {
    const err = new Error('Only the person who created this booking can initiate payment.')
    err.status = 403
    throw err
  }
  if (booking.payment_status === 'paid' || booking.status === 'confirmed') {
    const err = new Error('This booking has already been paid.')
    err.status = 409
    throw err
  }
  if (booking.status !== 'accepted') {
    const err = new Error(`Payment can only be initiated for accepted bookings. Current status: ${booking.status}`)
    err.status = 400
    throw err
  }

  // Check for existing pending payment
  const { rows: existing } = await pool.query(
    `SELECT id FROM payments WHERE booking_id = $1 AND status NOT IN ('failed', 'refunded')`,
    [bookingId]
  )
  if (existing.length > 0) {
    const err = new Error('A payment is already in progress for this booking.')
    err.status = 409
    throw err
  }

  // Create payment record (pending)
  const { rows: [payment] } = await pool.query(
    `INSERT INTO payments (booking_id, amount, provider_name, phone_number, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING *`,
    [bookingId, booking.total_price, providerName, phoneNumber]
  )

  // Initialize payment via Campay API
  let campayResult
  try {
    const reference = `BK-${bookingId.slice(0, 8)}-${Date.now()}`
    campayResult = await campayService.collectPayment({
      amount: booking.total_price,
      currency: 'XAF',
      phone: phoneNumber,
      description: `Carely escrow payment for booking #${bookingId.slice(0, 8)}`,
      externalReference: reference,
    })
  } catch {
    await pool.query(
      `UPDATE payments SET status = 'failed', updated_at = now() WHERE id = $1`,
      [payment.id]
    )
    const err = new Error('Payment gateway error. Please try again.')
    err.status = 502
    throw err
  }

  // Update payment with Campay reference and mark as held in escrow
  const { rows: [updated] } = await pool.query(
    `UPDATE payments
     SET status = 'held_in_escrow',
         campay_ref = $2,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [payment.id, campayResult.reference]
  )

  // Confirm booking (sets payment_status = 'paid', status = 'confirmed')
  await confirmBookingAfterPayment(bookingId)

  return {
    message: 'Payment initialized successfully via Campay. Funds held in escrow.',
    payment: updated,
    campayRef: campayResult.reference,
    ussdCode: campayResult.ussdCode,
    operator: campayResult.operator,
  }
}

// ── Verify Payment from Campay ─────────────────────────────────────────────────
async function verifyPayment(reference) {
  const result = await campayService.getTransactionStatus(reference)

  if (result.status === 'SUCCESSFUL' || result.status === 'complete' || result.status === 'held_in_escrow') {
    const { rows } = await pool.query(
      `UPDATE payments
       SET status = 'held_in_escrow', updated_at = now()
       WHERE campay_ref = $1
       RETURNING *`,
      [reference]
    )
    if (rows.length > 0) {
      await confirmBookingAfterPayment(rows[0].booking_id)
      return { success: true, payment: rows[0], status: result.status }
    }
  }

  return result
}

// ── Webhook Handler (Campay) ───────────────────────────────────────────────────
async function handleWebhook(payload, signature) {
  const isVerified = campayService.verifyWebhookSignature(payload, signature)
  if (!isVerified) {
    const err = new Error('Invalid webhook signature.')
    err.status = 401
    throw err
  }

  const reference = payload.reference || payload.external_reference
  const status = payload.status

  if (!reference) {
    const err = new Error('Invalid webhook payload: missing reference.')
    err.status = 400
    throw err
  }

  const { rows } = await pool.query(
    `SELECT * FROM payments WHERE campay_ref = $1`,
    [reference]
  )
  if (rows.length === 0) {
    // Check if it's a provider 25 XAF subscription activation payment
    if (status === 'SUCCESSFUL' || status === 'successful') {
      const subRes = await pool.query(
        `UPDATE providers
         SET subscription_paid = true, updated_at = now()
         WHERE subscription_campay_ref = $1
         RETURNING id`,
        [reference]
      )
      if (subRes.rows.length > 0) {
        console.log(`🎉 [Campay Webhook] Provider ${subRes.rows[0].id} subscription activation confirmed!`)
      }
    }
    return { received: true }
  }

  const payment = rows[0]
  const isComplete =
    status === 'SUCCESSFUL' ||
    status === 'successful' ||
    status === 'complete' ||
    status === 'held_in_escrow'

  const isFailed =
    status === 'FAILED' ||
    status === 'failed' ||
    status === 'canceled'

  const newStatus = isComplete ? 'held_in_escrow' : isFailed ? 'failed' : null

  if (newStatus && newStatus !== payment.status) {
    await pool.query(
      `UPDATE payments SET status = $1, updated_at = now() WHERE id = $2`,
      [newStatus, payment.id]
    )

    if (newStatus === 'held_in_escrow') {
      await confirmBookingAfterPayment(payment.booking_id)
    }
  }

  return { received: true, status: newStatus || payment.status }
}

// ── Release Escrow (Admin) ─────────────────────────────────────────────────────
async function releaseEscrow(bookingId) {
  const { rows } = await pool.query(
    `SELECT * FROM payments WHERE booking_id = $1 AND status = 'held_in_escrow'`,
    [bookingId]
  )
  if (rows.length === 0) {
    const err = new Error('No escrowed payment found for this booking.')
    err.status = 404
    throw err
  }

  const { rows: [updated] } = await pool.query(
    `UPDATE payments
     SET status = 'released', escrow_released = true, released_at = now(), updated_at = now()
     WHERE booking_id = $1 AND status = 'held_in_escrow'
     RETURNING *`,
    [bookingId]
  )

  return {
    message: 'Escrow released. Funds transferred to provider.',
    payment: updated,
  }
}

// ── Refund (Admin) ─────────────────────────────────────────────────────────────
async function refundPayment(bookingId) {
  const { rows } = await pool.query(
    `SELECT * FROM payments WHERE booking_id = $1 AND status IN ('held_in_escrow', 'pending')`,
    [bookingId]
  )
  if (rows.length === 0) {
    const err = new Error('No refundable payment found for this booking.')
    err.status = 404
    throw err
  }

  const { rows: [updated] } = await pool.query(
    `UPDATE payments
     SET status = 'refunded', updated_at = now()
     WHERE booking_id = $1 AND status IN ('held_in_escrow', 'pending')
     RETURNING *`,
    [bookingId]
  )

  // Also cancel the booking
  await pool.query(
    `UPDATE bookings SET status = 'cancelled', payment_status = 'refunded', updated_at = now()
     WHERE id = $1`,
    [bookingId]
  )

  return {
    message: 'Payment refunded. Funds will be returned to the client within 24–48 hours.',
    payment: updated,
  }
}

// ── Get Payment for Booking ────────────────────────────────────────────────────
async function getPaymentByBooking(bookingId, userId, role) {
  const { rows: bookingRows } = await pool.query(
    `SELECT booker_id, provider_id FROM bookings WHERE id = $1`,
    [bookingId]
  )
  if (bookingRows.length === 0) {
    const err = new Error('Booking not found.')
    err.status = 404
    throw err
  }
  const booking = bookingRows[0]
  const isOwner = booking.booker_id === userId || booking.provider_id === userId
  if (!isOwner && role !== 'admin') {
    const err = new Error('Access denied.')
    err.status = 403
    throw err
  }

  const { rows } = await pool.query(
    `SELECT id, booking_id, amount, currency, provider_name, status,
            campay_ref, escrow_released, released_at, created_at, updated_at
     FROM payments WHERE booking_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [bookingId]
  )

  return rows[0] || null
}

module.exports = {
  initiatePayment,
  verifyPayment,
  handleWebhook,
  releaseEscrow,
  refundPayment,
  getPaymentByBooking,
}

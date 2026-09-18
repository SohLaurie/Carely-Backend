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
  } catch (gatewayErr) {
    await pool.query(
      `UPDATE payments SET status = 'failed', updated_at = now() WHERE id = $1`,
      [payment.id]
    )
    const err = new Error(gatewayErr.message || 'Payment gateway error. Please try again.')
    err.status = gatewayErr.status || 502
    throw err
  }

  // Check if sandbox test number
  const cleanPhone = String(phoneNumber || '').replace(/\D/g, '')
  const isSandboxNumber = (
    cleanPhone.endsWith('000001') ||
    cleanPhone.endsWith('000002') ||
    cleanPhone === '237670000001' ||
    cleanPhone === '237690000001' ||
    cleanPhone === '237699000000' ||
    cleanPhone === '237699123456' ||
    cleanPhone === '699123456'
  )

  // Simulation is strictly forbidden for real numbers
  if (campayResult.simulated && !isSandboxNumber) {
    await pool.query(
      `UPDATE payments SET status = 'failed', updated_at = now() WHERE id = $1`,
      [payment.id]
    )
    const err = new Error('Live payment failed: payment provider returned a simulation instead of dispatching USSD. Please verify Campay credentials.')
    err.status = 502
    throw err
  }

  // ONLY auto-confirm if sandbox simulation with sandbox number:
  if (campayResult.simulated && isSandboxNumber) {
    const { rows: [updated] } = await pool.query(
      `UPDATE payments
       SET status = 'held_in_escrow',
           campay_ref = $2,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [payment.id, campayResult.reference]
    )
    await confirmBookingAfterPayment(bookingId)
    return {
      message: 'Sandbox payment confirmed. Funds held in escrow.',
      payment: updated,
      campayRef: campayResult.reference,
      ussdCode: campayResult.ussdCode,
      operator: campayResult.operator,
      simulated: true,
      confirmed: true,
    }
  }

  // REAL PAYMENT: Keep payment as 'pending' and booking as 'accepted' / 'unpaid'
  // until user confirms USSD prompt on their phone!
  const { rows: [updated] } = await pool.query(
    `UPDATE payments
     SET status = 'pending',
         campay_ref = $2,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [payment.id, campayResult.reference]
  )

  return {
    message: 'USSD payment prompt sent to your phone. Please authorize payment.',
    payment: updated,
    campayRef: campayResult.reference,
    ussdCode: campayResult.ussdCode,
    operator: campayResult.operator,
    confirmed: false,
  }
}

// ── Verify Payment from Campay ─────────────────────────────────────────────────
async function verifyPayment(reference) {
  const result = await campayService.getTransactionStatus(reference)

  const statusUpper = String(result.status || '').toUpperCase()
  if (statusUpper === 'SUCCESSFUL' || statusUpper === 'COMPLETE' || statusUpper === 'HELD_IN_ESCROW' || statusUpper === 'PAID') {
    const { rows } = await pool.query(
      `UPDATE payments
       SET status = 'held_in_escrow', updated_at = now()
       WHERE campay_ref = $1 AND status != 'held_in_escrow'
       RETURNING *`,
      [reference]
    )
    if (rows.length > 0) {
      await confirmBookingAfterPayment(rows[0].booking_id)
      return { success: true, payment: rows[0], status: result.status, confirmed: true }
    }
  }

  return { success: false, status: result.status || 'PENDING', reference }
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
    const statusUpper = String(status || '').toUpperCase()
    if (statusUpper === 'SUCCESSFUL' || statusUpper === 'COMPLETE' || statusUpper === 'PAID') {
      const subRes = await pool.query(
        `UPDATE providers
         SET subscription_paid = true, updated_at = now()
         WHERE subscription_campay_ref = $1
         RETURNING id`,
        [reference]
      )
      if (subRes.rows.length > 0) {
        const provId = subRes.rows[0].id
        console.log(`🎉 [Campay Webhook] Provider ${provId} subscription activation confirmed!`)
        try {
          const { grantSubscriptionCredits } = require('../carecredits/carecredits.service')
          await grantSubscriptionCredits(provId)
        } catch (ccErr) {
          console.warn('[CareCred] grantSubscriptionCredits non-fatal error:', ccErr.message)
        }
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
    `SELECT p.*, b.provider_id, u.phone AS provider_phone, u.first_name AS provider_first_name, u.last_name AS provider_last_name
     FROM payments p
     JOIN bookings b ON b.id = p.booking_id
     JOIN users u ON u.id = b.provider_id
     WHERE p.booking_id = $1 AND p.status = 'held_in_escrow'`,
    [bookingId]
  )
  if (rows.length === 0) {
    const err = new Error('No escrowed payment found for this booking.')
    err.status = 404
    throw err
  }

  const payment = rows[0]
  const targetPhone = payment.provider_phone
  if (!targetPhone) {
    const err = new Error('Provider phone number not found for escrow release payout.')
    err.status = 400
    throw err
  }

  // Release funds to provider phone via Campay Mass Payout
  const ref = `ESCROW-REL-${bookingId.slice(0, 8)}-${Date.now()}`
  let payoutResult
  try {
    payoutResult = await campayService.disburseFunds({
      amount: payment.amount,
      currency: 'XAF',
      phone: targetPhone,
      description: `Carely escrow payout for booking #${bookingId.slice(0, 8)} to ${payment.provider_first_name || ''} ${payment.provider_last_name || ''}`.trim(),
      externalReference: ref,
    })
  } catch (payoutErr) {
    console.error(`❌ [Release Escrow] Payout failed:`, payoutErr.message)
    const err = new Error(`Escrow payout failed: ${payoutErr.message}. Payment remains held in escrow.`)
    err.status = 502
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
    message: `Escrow released. ${payment.amount} XAF transferred to provider (${targetPhone}).`,
    payment: updated,
    payoutRef: payoutResult?.reference || ref,
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

require('dotenv').config()
const pool = require('../src/config/db')
const campayService = require('../src/modules/payments/campay.service')

const BASE = 'http://localhost:5000/api'

async function req(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json()
  return { status: res.status, data }
}

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`   ✅ ${label}`)
  } else {
    console.error(`   ❌ FAIL: ${label} ${detail}`)
    process.exitCode = 1
  }
}

async function run() {
  console.log('\n══════════════════════════════════════════════════')
  console.log(' Carely Campay Payment Integration Tests')
  console.log('══════════════════════════════════════════════════\n')

  // 1. Direct Campay Token Test
  console.log('1️⃣  Direct Campay API Authentication...')
  const token = await campayService.getToken()
  assert('Campay token retrieved', !!token && typeof token === 'string')
  console.log(`   🔑 Token: ${token.slice(0, 25)}...`)

  // 2. Log in client & provider
  console.log('\n2️⃣  Carely Authentication...')
  const { data: clientAuth } = await req('POST', '/auth/login', {
    email: 'laurie@example.com',
    password: 'SecurePass1!',
  })
  const clientToken = clientAuth.accessToken

  const { data: providerAuth } = await req('POST', '/auth/login', {
    email: 'fatima@carely.cm',
    password: 'Provider1!',
  })
  const providerToken = providerAuth.accessToken
  const providerId = providerAuth.user.id
  console.log(`   ✅ Logged in client Laurie & provider Fatima (${providerId})`)

  // 3. Create and accept booking for testing Orange Money
  console.log('\n3️⃣  Create and accept booking (Orange Money)...')
  const { data: bRes } = await req('POST', '/bookings', {
    providerId,
    sessionType: 'once',
    startDate: '2026-11-28',
    startTime: '09:00',
    endTime: '12:00',
    subtotal: 8400,
    serviceFee: 500,
    totalPrice: 8900,
  }, clientToken)
  const bookingId = bRes.booking.id

  await req('PATCH', `/bookings/${bookingId}/accept`, null, providerToken)
  console.log(`   ✅ Booking created and accepted: ${bookingId}`)

  // 4. Initiate payment via Campay (Orange Money to 237691366621)
  console.log('\n4️⃣  Initiate Escrow Payment via Campay (POST /api/payments/initiate)...')
  const { status: sInit, data: dInit } = await req('POST', '/payments/initiate', {
    bookingId,
    providerName: 'orange',
    phoneNumber: '237691366621',
  }, clientToken)
  assert('Initiate payment → 201', sInit === 201)
  assert('  has campayRef', !!dInit.campayRef)
  assert('  has ussdCode (#150*50#)', dInit.ussdCode === '#150*50#')
  assert('  operator is Orange', dInit.operator === 'Orange')
  assert('  status is held_in_escrow', dInit.payment?.status === 'held_in_escrow')
  console.log(`   💳 Campay Reference: ${dInit.campayRef}`)
  console.log(`   📱 USSD Code: ${dInit.ussdCode} (Operator: ${dInit.operator})`)

  const paymentRef = dInit.campayRef

  // 5. Verify payment row in PostgreSQL
  console.log('\n5️⃣  Verify payment record in PostgreSQL...')
  const { rows: payRows } = await pool.query(
    'SELECT id, campay_ref, status, amount, provider_name, phone_number FROM payments WHERE booking_id = $1',
    [bookingId]
  )
  assert('  payment saved in DB', payRows.length > 0)
  assert('  campay_ref matches in DB', payRows[0].campay_ref === paymentRef)
  assert('  status is held_in_escrow', payRows[0].status === 'held_in_escrow')

  // 6. Get payment via API
  console.log('\n6️⃣  Fetch payment details (GET /api/payments/:bookingId)...')
  const { status: sGet, data: dGet } = await req('GET', `/payments/${bookingId}`, null, clientToken)
  assert('GET /payments/:bookingId → 200', sGet === 200)
  assert('  returns campay_ref', dGet.payment?.campay_ref === paymentRef)

  // 7. Verify transaction status with Campay API
  console.log('\n7️⃣  Verify transaction with Campay API (GET /api/payments/verify/:reference)...')
  const { status: sVer, data: dVer } = await req('GET', `/payments/verify/${paymentRef}`, null, clientToken)
  assert('GET /payments/verify/:reference → 200', sVer === 200)
  assert('  verification returned status', !!dVer.status)
  console.log(`   📡 Campay Gateway Status: ${dVer.status}`)

  // 8. Test Webhook handling
  console.log('\n8️⃣  Simulate Campay Webhook (POST /api/payments/webhook)...')
  const { status: sHook, data: dHook } = await req('POST', '/payments/webhook', {
    reference: paymentRef,
    status: 'SUCCESSFUL',
    amount: '10.00',
    currency: 'XAF',
    operator: 'Orange',
  })
  assert('Webhook received → 200', sHook === 200)
  assert('  webhook acknowledged', dHook.received === true)

  // 9. Verify booking is confirmed and marked paid
  console.log('\n9️⃣  Verify booking confirmation after payment...')
  const { data: fullBooking } = await req('GET', `/bookings/${bookingId}`, null, clientToken)
  assert('Booking is confirmed', fullBooking.booking?.status === 'confirmed')
  assert('Booking payment_status is paid', fullBooking.booking?.payment_status === 'paid')

  // 10. Test MTN Mobile Money USSD code (*126#)
  console.log('\n🔟 Test MTN Mobile Money Collect (*126#)...')
  const { data: bResMtn } = await req('POST', '/bookings', {
    providerId,
    sessionType: 'once',
    startDate: '2026-11-29',
    startTime: '14:00',
    endTime: '16:00',
    subtotal: 5000,
    serviceFee: 500,
    totalPrice: 5500,
  }, clientToken)
  const bookingIdMtn = bResMtn.booking.id
  await req('PATCH', `/bookings/${bookingIdMtn}/accept`, null, providerToken)

  const { status: sMtn, data: dMtn } = await req('POST', '/payments/initiate', {
    bookingId: bookingIdMtn,
    providerName: 'mtn',
    phoneNumber: '237671234567',
  }, clientToken)
  assert('Initiate MTN payment → 201', sMtn === 201)
  assert('  MTN USSD code is *126#', dMtn.ussdCode === '*126#')
  assert('  operator is MTN', dMtn.operator === 'MTN')
  console.log(`   📱 MTN USSD Code: ${dMtn.ussdCode} (Operator: ${dMtn.operator})`)

  console.log('\n══════════════════════════════════════════════════')
  if (process.exitCode === 1) {
    console.log(' ❌ Some tests failed — see details above')
  } else {
    console.log(' ✅ All Campay integration tests passed!')
  }
  console.log('══════════════════════════════════════════════════\n')

  await pool.end()
}

run().catch(err => {
  console.error('\n❌ Fatal test error:', err)
  process.exit(1)
})

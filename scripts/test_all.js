require('dotenv').config()
const pool = require('../src/config/db')

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
  console.log(' Carely Full API Verification')
  console.log('══════════════════════════════════════════════════\n')

  // ── Auth ─────────────────────────────────────────────────────────────────────
  console.log('── AUTH ─────────────────────────────────────────')

  const { status: s1, data: clientAuth } = await req('POST', '/auth/login', { email: 'laurie@example.com', password: 'SecurePass1!' })
  assert('Login client → 200', s1 === 200)
  const clientToken = clientAuth.accessToken

  const { status: s2, data: providerAuth } = await req('POST', '/auth/login', { email: 'fatima@carely.cm', password: 'Provider1!' })
  assert('Login provider (Fatima) → 200', s2 === 200)
  const providerToken = providerAuth.accessToken
  const providerId = providerAuth.user.id

  // Protected route without token → 401
  const { status: s3 } = await req('GET', '/users/me', null, null)
  assert('No token → 401', s3 === 401)

  // ── Users ─────────────────────────────────────────────────────────────────────
  console.log('\n── USERS ────────────────────────────────────────')

  const { status: s4, data: meData } = await req('GET', '/users/me', null, clientToken)
  assert('GET /users/me → 200', s4 === 200)
  assert('  includes providerProfile field', 'provider_profile' in meData.user)

  const { status: s5, data: patchData } = await req('PATCH', '/users/me', { city: 'Douala' }, clientToken)
  assert('PATCH /users/me → 200', s5 === 200)
  assert('  city updated', patchData.user.city === 'Douala')

  // Admin-only route with non-admin → 403
  const { status: s6 } = await req('GET', '/users', null, clientToken)
  assert('GET /users (non-admin) → 403', s6 === 403)

  // ── Providers ─────────────────────────────────────────────────────────────────
  console.log('\n── PROVIDERS ────────────────────────────────────')

  const { status: s7, data: listData } = await req('GET', '/providers')
  assert('GET /providers (public) → 200', s7 === 200)
  assert(`  returns at least 7 providers`, listData.providers.length >= 7, `(got ${listData.providers?.length})`)

  // Filter by specialty
  const { status: s8, data: nurseData } = await req('GET', '/providers?specialty=nursing')
  assert('GET /providers?specialty=nursing → 200', s8 === 200)
  assert('  only nurses returned', nurseData.providers.every(p => p.specialties.includes('nursing')))

  // Filter by city
  const { status: s9, data: cityData } = await req('GET', '/providers?city=Douala')
  assert('GET /providers?city=Douala → 200', s9 === 200)

  // Single provider with reviews
  const { status: s10, data: providerData } = await req('GET', `/providers/${providerId}`)
  assert('GET /providers/:id → 200', s10 === 200)
  assert('  has reviews array', Array.isArray(providerData.provider.reviews))

  // Provider gets own profile
  const { status: s11 } = await req('GET', '/providers/me', null, providerToken)
  assert('GET /providers/me (provider) → 200', s11 === 200)

  // Toggle availability
  const { status: s12, data: availData } = await req('PATCH', '/providers/me/availability', null, providerToken)
  assert('PATCH /providers/me/availability → 200', s12 === 200)
  assert('  returns isAvailable boolean', typeof availData.isAvailable === 'boolean')
  // Toggle back
  await req('PATCH', '/providers/me/availability', null, providerToken)

  // ── Payments ──────────────────────────────────────────────────────────────────
  console.log('\n── PAYMENTS ─────────────────────────────────────')

  // Create + accept a booking to test payment flow
  const { data: bookingRes } = await req('POST', '/bookings', {
    providerId,
    sessionType: 'once',
    startDate: '2026-10-01',
    startTime: '10:00',
    endTime:   '13:00',
    subtotal: 8900,
    serviceFee: 500,
    totalPrice: 9400,
  }, clientToken)
  const bookingId = bookingRes.booking.id

  await req('PATCH', `/bookings/${bookingId}/accept`, null, providerToken)

  const { status: s13, data: payData } = await req('POST', '/payments/initiate', {
    bookingId,
    providerName: 'mtn',
    phoneNumber: '+237699123456',
  }, clientToken)
  assert('POST /payments/initiate → 201 (escrow held)', s13 === 201)
  assert('  payment status = held_in_escrow', payData.payment?.status === 'held_in_escrow')
  assert('  campayRef present', !!payData.campayRef)

  // GET payment for booking
  const { status: s14, data: getPayData } = await req('GET', `/payments/${bookingId}`, null, clientToken)
  assert('GET /payments/:bookingId → 200', s14 === 200)
  assert('  payment status = held_in_escrow', getPayData.payment?.status === 'held_in_escrow')

  // Double-pay should fail
  const { status: s15 } = await req('POST', '/payments/initiate', {
    bookingId, providerName: 'mtn', phoneNumber: '+237699000000',
  }, clientToken)
  assert('Double payment → 409 conflict', s15 === 409)

  // ── Reviews ───────────────────────────────────────────────────────────────────
  console.log('\n── REVIEWS ──────────────────────────────────────')

  // Force booking to 'completed' state to allow review
  await pool.query(`UPDATE bookings SET status = 'completed' WHERE id = $1`, [bookingId])

  const { status: s16, data: reviewRes } = await req('POST', '/reviews', {
    bookingId,
    rating: 5,
    comment: 'Fatima was absolutely wonderful with my children. Highly recommended!',
    tags: ['Punctual', 'Professional', 'Experienced'],
  }, clientToken)
  assert('POST /reviews → 201', s16 === 201)
  assert('  review has rating 5', reviewRes.review?.rating === 5)

  // Check provider rating was updated
  const { data: updatedProvider } = await req('GET', `/providers/${providerId}`)
  assert('Provider rating updated after review', updatedProvider.provider.rating !== null)
  assert('  review_count incremented', updatedProvider.provider.review_count > 0)

  // Duplicate review → 409
  const { status: s17 } = await req('POST', '/reviews', {
    bookingId, rating: 3, comment: 'Second review attempt',
  }, clientToken)
  assert('Duplicate review → 409', s17 === 409)

  // GET provider reviews
  const { status: s18, data: reviewsData } = await req('GET', `/reviews/provider/${providerId}`)
  assert('GET /reviews/provider/:id → 200', s18 === 200)
  assert('  returns reviews array', Array.isArray(reviewsData.reviews))
  assert('  returns averageRating', reviewsData.averageRating !== undefined)

  // ── Role guard check ──────────────────────────────────────────────────────────
  console.log('\n── ROLE GUARDS ──────────────────────────────────')
  const { status: s19 } = await req('POST', '/sessions/auto-release', null, clientToken)
  assert('Non-admin cannot trigger auto-release → 403', s19 === 403)

  // Register a fresh pure client to verify role guard
  const freshEmail = `testclient_${Date.now()}@test.cm`
  const { data: freshReg } = await req('POST', '/auth/register', {
    firstName: 'Test', lastName: 'Client', email: freshEmail,
    phone: '+237699000099', password: 'TestPass1!',
  })
  const freshToken = freshReg.accessToken

  const { status: s20 } = await req('GET', '/providers/me', null, freshToken)
  assert('Pure client cannot GET /providers/me → 403', s20 === 403, `(got ${s20})`)

  console.log('\n══════════════════════════════════════════════════')
  if (process.exitCode === 1) {
    console.log(' ❌ Some tests failed — see above')
  } else {
    console.log(' ✅ All tests passed!')
  }
  console.log('══════════════════════════════════════════════════\n')

  await pool.end()
}

run().catch(err => { console.error('\n❌ Fatal error:', err.message); process.exit(1) })

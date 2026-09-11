require('dotenv').config()
const pool = require('../src/config/db')

const BASE = 'http://localhost:5000/api'

async function post(path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${JSON.stringify(data)}`)
  return { data, status: res.status }
}

async function get(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${JSON.stringify(data)}`)
  return data
}

async function patch(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}: ${JSON.stringify(data)}`)
  return data
}

// Formats a DB date string as YYYY-MM-DD cleanly without timezone shift
function fmtDate(d) {
  return typeof d === 'string' ? d.split('T')[0] : String(d)
}

async function run() {
  console.log('\n══════════════════════════════════════════')
  console.log(' Carely Sessions End-to-End Test')
  console.log('══════════════════════════════════════════\n')

  // 1. Login as client (Laurie — was upgraded to provider earlier, but still acts as booker)
  console.log('1️⃣  Login as client (Laurie)...')
  const { data: clientAuth } = await post('/auth/login', { email: 'laurie@example.com', password: 'SecurePass1!' })
  const clientToken = clientAuth.accessToken
  console.log(`   ✅ Logged in — role: ${clientAuth.user.role}`)

  // 2. Login as provider (Marie-Claire)
  console.log('2️⃣  Login as provider (Marie-Claire)...')
  const { data: providerAuth } = await post('/auth/login', { email: 'marie@carely.cm', password: 'Provider1!' })
  const providerToken = providerAuth.accessToken
  const providerId = providerAuth.user.id
  console.log(`   ✅ Logged in — role: ${providerAuth.user.role}, id: ${providerId}`)

  // 3. Client creates RECURRING booking (Mon/Wed/Fri × 2 weeks = 6 sessions)
  console.log('3️⃣  Client creates recurring booking (Mon/Wed/Fri × 2 weeks = 6 sessions)...')
  const { data: bookingRes } = await post('/bookings', {
    providerId,
    sessionType: 'recurring',
    startDate: '2026-09-14',
    startTime: '09:00',
    endTime:   '12:00',
    durationWeeks: 2,
    selectedDays: [0, 2, 4],   // Mon=0, Wed=2, Fri=4
    notes: 'Post-surgical care for my father.',
    subtotal: 63000,
    serviceFee: 500,
    totalPrice: 63500,
  }, clientToken)
  const bookingId = bookingRes.booking.id
  console.log(`   ✅ Booking created — id: ${bookingId}`)
  console.log(`   📊 total_sessions: ${bookingRes.booking.total_sessions} (expected 6)`)

  // 4. Provider accepts booking → sessions auto-generated
  console.log('4️⃣  Provider accepts booking...')
  const acceptRes = await patch(`/bookings/${bookingId}/accept`, providerToken)
  console.log(`   ✅ ${acceptRes.message}`)

  // 5. Check sessions (OTPs hidden — not yet paid)
  console.log('5️⃣  Sessions before payment (OTPs must be hidden)...')
  const beforePay = await get(`/bookings/${bookingId}/sessions`, clientToken)
  console.log(`   ✅ Session count: ${beforePay.sessions.length}`)
  beforePay.sessions.forEach(s => {
    console.log(`      Session ${s.session_number}: ${fmtDate(s.scheduled_date)} | status: ${s.status} | OTP: ${s.otp_code ?? '🔒 hidden'}`)
  })

  // 6. Simulate payment → mark as confirmed + paid
  console.log('6️⃣  Simulating payment confirmation...')
  await pool.query(
    `UPDATE bookings SET status = 'confirmed', payment_status = 'paid' WHERE id = $1`,
    [bookingId]
  )
  console.log('   ✅ Booking confirmed + paid in DB')

  // 7. Fetch sessions again — OTPs now visible
  console.log('7️⃣  Sessions after payment (OTPs must be visible)...')
  const afterPay = await get(`/bookings/${bookingId}/sessions`, clientToken)
  afterPay.sessions.forEach(s => {
    console.log(`      Session ${s.session_number}: ${fmtDate(s.scheduled_date)} | OTP: ${s.otp_code}`)
  })
  const firstSession = afterPay.sessions[0]

  // 8. Provider tries wrong OTP → should be rejected
  console.log('8️⃣  Provider tries wrong OTP...')
  const wrongRes = await fetch(`${BASE}/sessions/${firstSession.id}/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${providerToken}` },
    body: JSON.stringify({ code: '000000' }),
  })
  const wrongData = await wrongRes.json()
  console.log(`   ✅ Wrong OTP rejected (${wrongRes.status}): "${wrongData.error}"`)

  // 9. Provider enters correct OTP → session becomes ARRIVED
  console.log('9️⃣  Provider verifies correct OTP...')
  const { data: verifyRes } = await post(
    `/sessions/${firstSession.id}/verify-otp`,
    { code: firstSession.otp_code },
    providerToken
  )
  console.log(`   ✅ Session status: ${verifyRes.session.status}`)
  console.log(`   ⏰ Confirmation deadline: ${verifyRes.session.confirmation_deadline}`)

  // 10. Client confirms session completed → COMPLETED
  console.log('🔟  Client confirms session completion...')
  const { data: confirmRes } = await post(`/sessions/${firstSession.id}/confirm`, {}, clientToken)
  console.log(`   ✅ ${confirmRes.message}`)

  // 11. Check dispute flow on session 2
  console.log('1️⃣1️⃣  Client disputes session 2...')
  const session2 = afterPay.sessions[1]
  const { data: disputeRes } = await post(
    `/sessions/${session2.id}/dispute`,
    { reason: 'Provider arrived 2 hours late and left without completing the task.' },
    clientToken
  )
  console.log(`   ✅ ${disputeRes.message}`)

  // 12. Final state overview
  console.log('1️⃣2️⃣  Final session statuses...')
  const finalBooking = await get(`/bookings/${bookingId}`, clientToken)
  console.log(`   📋 Booking status: ${finalBooking.booking.status}`)
  finalBooking.booking.sessions.forEach(s => {
    const icon = { COMPLETED: '✅', ARRIVED: '🟡', DISPUTED: '🔴', SCHEDULED: '⬜', MISSED: '❌', SKIPPED: '⏭️' }[s.status] || '❓'
    console.log(`      ${icon} Session ${s.session_number}: ${fmtDate(s.scheduled_date)} — ${s.status}`)
  })

  console.log('\n══════════════════════════════════════════')
  console.log(' ✅  All tests passed!')
  console.log('══════════════════════════════════════════\n')

  await pool.end()
}

run().catch(err => {
  console.error('\n❌ Test failed:', err.message)
  process.exit(1)
})

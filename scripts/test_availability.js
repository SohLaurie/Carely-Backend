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
  console.log(' Carely Availability & Calendar System Tests')
  console.log('══════════════════════════════════════════════════\n')

  // 1. Authenticate as a provider (Fatima) and a client
  console.log('1️⃣  Authentication...')
  const { data: providerAuth } = await req('POST', '/auth/login', {
    email: 'fatima@carely.cm',
    password: 'Provider1!',
  })
  const providerToken = providerAuth.accessToken
  const providerId = providerAuth.user.id
  console.log(`   ✅ Logged in provider Fatima (ID: ${providerId})`)

  const { data: clientAuth } = await req('POST', '/auth/login', {
    email: 'laurie@example.com',
    password: 'SecurePass1!',
  })
  const clientToken = clientAuth.accessToken
  console.log('   ✅ Logged in client Laurie')

  // 2. Set weekly schedule for Fatima (Mon-Fri 08:00 - 16:00)
  console.log('\n2️⃣  Configure weekly recurring schedule (PUT /api/availability/schedule)...')
  const weeklySchedule = [
    { dayOfWeek: 0, startTime: '08:00', endTime: '16:00' }, // Mon
    { dayOfWeek: 1, startTime: '08:00', endTime: '16:00' }, // Tue
    { dayOfWeek: 2, startTime: '08:00', endTime: '16:00' }, // Wed
    { dayOfWeek: 3, startTime: '08:00', endTime: '16:00' }, // Thu
    { dayOfWeek: 4, startTime: '08:00', endTime: '16:00' }, // Fri
  ]
  const { status: sSet, data: dSet } = await req('PUT', '/availability/schedule', { schedule: weeklySchedule }, providerToken)
  assert('Set schedule → 200', sSet === 200)
  assert('  returns 5 schedule rows', dSet.schedule?.length === 5)

  // 3. Get schedule (provider me & public)
  console.log('\n3️⃣  Fetch weekly schedule...')
  const { status: sGet, data: dGet } = await req('GET', '/availability/schedule', null, providerToken)
  assert('GET /availability/schedule (provider) → 200', sGet === 200)
  assert('  has active days', dGet.schedule?.length === 5)

  const { status: sPub, data: dPub } = await req('GET', `/availability/provider/${providerId}/schedule`)
  assert('GET /availability/provider/:id/schedule (public) → 200', sPub === 200)

  // 4. Check availability before blocking
  console.log('\n4️⃣  Check availability for upcoming date (2026-11-20)...')
  const testDate = '2026-11-20' // Friday
  const { status: sChk1, data: dChk1 } = await req(
    'GET',
    `/availability/check?providerId=${providerId}&date=${testDate}&startTime=09:00&endTime=12:00`
  )
  assert('GET /availability/check → 200', sChk1 === 200)
  assert('  provider is available', dChk1.available === true)

  // 5. Block a slot on 2026-11-20 (e.g. personal appointment 09:00 - 13:00)
  console.log('\n5️⃣  Block slot (POST /api/availability/block)...')
  const { status: sBlk, data: dBlk } = await req('POST', '/availability/block', {
    startDate: testDate,
    startTime: '09:00',
    endTime: '13:00',
    reason: 'Medical appointment',
  }, providerToken)
  assert('Block slot → 201', sBlk === 201)
  assert('  slot created with reason', dBlk.slot?.reason === 'Medical appointment')
  const blockedSlotId = dBlk.slot.id

  // 6. Check availability again — must be unavailable due to block
  console.log('\n6️⃣  Check availability on blocked time window...')
  const { data: dChk2 } = await req(
    'GET',
    `/availability/check?providerId=${providerId}&date=${testDate}&startTime=10:00&endTime=12:00`
  )
  assert('Availability is false', dChk2.available === false)
  assert('  conflictType is blocked', dChk2.conflictType === 'blocked')
  console.log(`   💬 Conflict message: "${dChk2.reason}"`)

  // 7. Verify booking guard: Client tries to book the blocked slot
  console.log('\n7️⃣  Booking creation on blocked slot must be rejected (HTTP 409)...')
  const { status: sBookConflict, data: dBookConflict } = await req('POST', '/bookings', {
    providerId,
    sessionType: 'once',
    startDate: testDate,
    startTime: '10:00',
    endTime: '12:00',
    subtotal: 5600,
    serviceFee: 500,
    totalPrice: 6100,
  }, clientToken)
  assert('Booking attempt on blocked slot returns 409', sBookConflict === 409)
  console.log(`   💬 Rejection reason: "${dBookConflict.error}"`)

  // 8. Calendar View Aggregation
  console.log('\n8️⃣  Check aggregated calendar view (GET /api/availability/my-calendar)...')
  const { status: sCal, data: dCal } = await req(
    'GET',
    `/availability/my-calendar?year=2026&month=11`,
    null,
    providerToken
  )
  assert('GET /availability/my-calendar → 200', sCal === 200)
  const calendar = dCal.calendar
  assert('  has dayStates map', typeof calendar.dayStates === 'object')
  assert('  day 20 is marked as blocked', calendar.dayStates[20] === 'blocked')
  console.log(`   📅 Day 20 state: ${calendar.dayStates[20]}`)
  console.log(`   📦 Day 20 events:`, calendar.eventsByDay[20])

  // 9. Release/unblock the slot
  console.log('\n9️⃣  Release blocked slot (DELETE /api/availability/block/:id)...')
  const { status: sRel, data: dRel } = await req('DELETE', `/availability/block/${blockedSlotId}`, null, providerToken)
  assert('Release slot → 200', sRel === 200)
  assert('  success message returned', !!dRel.message)

  // 10. Check availability again — should be available again
  console.log('\n🔟  Verify availability after release...')
  const { data: dChk3 } = await req(
    'GET',
    `/availability/check?providerId=${providerId}&date=${testDate}&startTime=09:00&endTime=12:00`
  )
  assert('Provider is free again', dChk3.available === true)

  console.log('\n══════════════════════════════════════════════════')
  if (process.exitCode === 1) {
    console.log(' ❌ Some tests failed — see details above')
  } else {
    console.log(' ✅ All Availability & Calendar tests passed!')
  }
  console.log('══════════════════════════════════════════════════\n')

  await pool.end()
}

run().catch(err => {
  console.error('\n❌ Fatal test error:', err)
  process.exit(1)
})

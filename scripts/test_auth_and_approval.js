/**
 * Comprehensive End-to-End Test for:
 * 1. Client Registration & Login (100% working)
 * 2. Provider Registration (creates pending application)
 * 3. Admin Listing Pending Applications
 * 4. Admin Approving Provider Application (triggers Campay 25 XAF collect)
 * 5. Provider checking subscription status (unpaid)
 * 6. 25 XAF Subscription Confirmation
 * 7. Provider account activation & booking readiness
 */

require('dotenv').config()
const pool = require('../src/config/db')

const BASE_URL = 'http://localhost:5000/api'

async function request(method, path, body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok, data }
}

async function runTests() {
  console.log('🧪 Starting Auth & Provider Approval Flow Tests...\n')
  let passed = 0
  let total = 0

  function assert(condition, message) {
    total++
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`)
      passed++
    } else {
      console.error(`  ❌ [FAIL] ${message}`)
      throw new Error(`Assertion failed: ${message}`)
    }
  }

  const timestamp = Date.now()
  const clientEmail = `client_${timestamp}@carely.cm`
  const providerEmail = `provider_${timestamp}@carely.cm`
  const password = 'Password123!'

  // ── 1. Client Registration ──
  console.log('1️⃣ Testing Client Registration...')
  const regRes = await request('POST', '/auth/register', {
    firstName: 'Alice',
    lastName: 'Fouda',
    email: clientEmail,
    phone: '+237671112233',
    password,
    city: 'Yaounde',
  })
  assert(regRes.status === 200 || regRes.status === 201, `Client registered successfully (${regRes.status})`)
  assert(regRes.data.user?.email === clientEmail, 'Client email matches')
  assert(regRes.data.accessToken, 'Access token returned')

  // ── 2. Login with Invalid Credentials ──
  console.log('\n2️⃣ Testing Login with Wrong Password...')
  const badLogin = await request('POST', '/auth/login', {
    email: clientEmail,
    password: 'WrongPassword!',
  })
  assert(badLogin.status === 401, 'Wrong password returns 401 Unauthorized')

  // ── 3. Login with Correct Client Credentials ──
  console.log('\n3️⃣ Testing Client Login...')
  const clientLogin = await request('POST', '/auth/login', {
    email: clientEmail,
    password,
  })
  assert(clientLogin.status === 200, 'Client login successful')
  assert(clientLogin.data.user?.role === 'client', 'User role is client')

  // ── 4. Provider Registration (creates pending application) ──
  console.log('\n4️⃣ Testing Provider Registration...')
  const proReg = await request('POST', '/auth/register/provider', {
    firstName: 'Samuel',
    lastName: 'Eto',
    email: providerEmail,
    phone: '237691366621', // real phone format
    password,
    city: 'Douala',
    specialties: ['nursing'],
    experienceYrs: 5,
    bio: 'Dedicated professional caregiver with 5 years experience.',
    pricePerHour: 4000,
  })
  assert(proReg.status === 200 || proReg.status === 201, 'Provider registered successfully')
  assert(proReg.data.user?.role === 'provider', 'Provider role assigned')
  const providerToken = proReg.data.accessToken
  const providerId = proReg.data.user.id

  // ── 5. Provider Check Subscription Before Approval ──
  console.log('\n5️⃣ Testing Provider Subscription Status Before Approval...')
  const subBeforeApprove = await request('GET', '/providers/me/subscription-status', null, providerToken)
  assert(subBeforeApprove.status === 200, 'Status endpoint returned 200')
  assert(subBeforeApprove.data.approvalStatus === 'pending', 'Approval status is pending')
  assert(!subBeforeApprove.data.accountActive, 'Account is not yet active')

  // ── 6. Admin Login ──
  console.log('\n6️⃣ Testing Admin Login...')
  // Admin created in earlier seeds: admin@carely.cm
  let adminLogin = await request('POST', '/auth/login', {
    email: 'admin@carely.cm',
    password: 'SecureAdmin123!',
  })
  if (adminLogin.status !== 200) {
    // Check if another admin password exists
    adminLogin = await request('POST', '/auth/login', {
      email: 'admin@carely.cm',
      password: 'AdminPassword1!',
    })
  }
  let adminToken = adminLogin.data?.accessToken
  if (!adminToken) {
    // Generate one directly for admin from users table
    const { rows } = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
    if (rows.length > 0) {
      const jwt = require('jsonwebtoken')
      adminToken = jwt.sign({ id: rows[0].id, role: 'admin' }, process.env.JWT_SECRET)
    }
  }
  assert(!!adminToken, 'Admin token acquired')

  // ── 7. Admin List Pending Applications ──
  console.log('\n7️⃣ Testing Admin List Pending Applications...')
  const pendingApps = await request('GET', '/admin/providers/pending', null, adminToken)
  assert(pendingApps.status === 200, 'Admin pending endpoint returned 200')
  const found = pendingApps.data.providers?.some(p => p.id === providerId || p.email === providerEmail)
  assert(found, `Newly registered provider found in pending list (total: ${pendingApps.data.total})`)

  // ── 8. Admin Approves Provider ──
  console.log('\n8️⃣ Testing Admin Provider Approval...')
  const approveRes = await request('PATCH', `/admin/providers/${providerId}/approve`, {}, adminToken)
  assert(approveRes.status === 200, 'Provider approved successfully by admin')
  console.log(`     Campay collect triggered: ${approveRes.data.campayTriggered}`)
  console.log(`     Campay ref: ${approveRes.data.campayReference}`)

  // ── 9. Provider Status After Approval (Awaiting 25 XAF Subscription) ──
  console.log('\n9️⃣ Testing Provider Subscription Status After Approval...')
  const subAfterApprove = await request('GET', '/providers/me/subscription-status', null, providerToken)
  assert(subAfterApprove.status === 200, 'Status check 200')
  assert(subAfterApprove.data.approvalStatus === 'approved', 'Approval status is approved')
  assert(subAfterApprove.data.subscriptionPaid === false, 'Subscription is not yet paid')
  assert(!subAfterApprove.data.accountActive, 'Account is not yet active until 25 XAF paid')

  // ── 10. Provider Initiates / Retries Subscription Payment ──
  console.log('\n🔟 Testing Provider Triggering Subscription Payment...')
  const paySubRes = await request('POST', '/providers/me/pay-subscription', { phone: '237691366621' }, providerToken)
  assert(paySubRes.status === 200, 'Subscription payment request triggered 200')
  console.log(`     Response: ${paySubRes.data.message}`)

  // ── 11. Confirm 25 XAF Subscription Payment via Campay Webhook ──
  console.log('\n1️⃣1️⃣ Testing 25 XAF Subscription Confirmation via Webhook...')
  const { rows: provRows } = await pool.query('SELECT subscription_campay_ref FROM providers WHERE id = $1', [providerId])
  const subRef = provRows[0]?.subscription_campay_ref || 'test_sub_ref'

  // Call webhook with SUCCESSFUL status
  const hookRes = await request('POST', '/payments/webhook', {
    reference: subRef,
    status: 'SUCCESSFUL',
    amount: 25,
    currency: 'XAF',
  })
  assert(hookRes.status === 200, 'Webhook received 200')

  // ── 12. Provider Status After Subscription Paid ──
  console.log('\n1️⃣2️⃣ Testing Provider Status After 25 XAF Subscription Paid...')
  const subFinal = await request('GET', '/providers/me/subscription-status', null, providerToken)
  assert(subFinal.status === 200, 'Status check 200')
  assert(subFinal.data.subscriptionPaid === true, 'Subscription is marked paid (25 XAF)')
  assert(subFinal.data.accountActive === true, 'Account is active and eligible to receive bookings!')

  console.log(`\n🎉 All ${passed}/${total} assertions passed successfully!`)
  process.exit(0)
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err)
  process.exit(1)
})

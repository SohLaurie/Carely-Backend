require('dotenv').config()
const pool = require('../src/config/db')

const BASE = 'http://localhost:5000/api'

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
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
  console.log(' Carely Forgot & Reset Password Flow Tests')
  console.log('══════════════════════════════════════════════════\n')

  const testEmail = 'laurie@example.com'
  const oldPassword = 'SecurePass1!'
  const newPassword = 'BrandNewPass2!'

  // 1. Anti-enumeration: test with non-existent email
  console.log('1️⃣  Forgot password with non-existent email (anti-enumeration)...')
  const { status: sNon, data: dNon } = await req('POST', '/auth/forgot-password', {
    email: 'nonexistent_user_9999@carely.cm',
  })
  assert('Forgot password non-existent email → 200', sNon === 200)
  assert('  returns generic security message', dNon.message.includes('If an account with this email exists'))
  assert('  does NOT return a resetToken', dNon.resetToken === undefined)

  // 2. Forgot password with existing user email
  console.log('\n2️⃣  Forgot password with registered email...')
  const { status: sForgot, data: dForgot } = await req('POST', '/auth/forgot-password', {
    email: testEmail,
  })
  assert('Forgot password valid email → 200', sForgot === 200)
  assert('  returns security message', dForgot.message.includes('If an account with this email exists'))
  assert('  resetToken provided in dev mode', !!dForgot.resetToken)
  const token = dForgot.resetToken
  console.log(`   🔑 Token received: ${token.slice(0, 16)}...`)

  // Check DB state
  const { rows: dbRows } = await pool.query(
    'SELECT reset_password_token, reset_password_expires_at FROM users WHERE email = $1',
    [testEmail]
  )
  assert('  token stored in PostgreSQL', dbRows[0].reset_password_token === token)
  assert('  expiration set in future', new Date(dbRows[0].reset_password_expires_at) > new Date())

  // 3. Reset password with bogus token → 400
  console.log('\n3️⃣  Reset password with invalid token...')
  const { status: sBadToken, data: dBadToken } = await req('POST', '/auth/reset-password', {
    token: 'bogus_token_1234567890',
    newPassword,
  })
  assert('Invalid token rejected → 400', sBadToken === 400)
  console.log(`   💬 Error message: "${dBadToken.error}"`)

  // 4. Reset password with invalid password (fails complexity schema) → 400
  console.log('\n4️⃣  Reset password with weak password (< 8 chars)...')
  const { status: sWeak, data: dWeak } = await req('POST', '/auth/reset-password', {
    token,
    newPassword: 'weak',
  })
  assert('Weak password rejected → 400', sWeak === 400)

  // 5. Reset password with valid token and valid new password
  console.log('\n5️⃣  Reset password with valid token...')
  const { status: sReset, data: dReset } = await req('POST', '/auth/reset-password', {
    token,
    newPassword,
  })
  assert('Reset password successful → 200', sReset === 200)
  assert('  returns success message', dReset.message.includes('Password has been reset successfully'))

  // Verify DB cleared token
  const { rows: dbCleared } = await pool.query(
    'SELECT reset_password_token, reset_password_expires_at FROM users WHERE email = $1',
    [testEmail]
  )
  assert('  reset_password_token cleared to NULL', dbCleared[0].reset_password_token === null)
  assert('  reset_password_expires_at cleared to NULL', dbCleared[0].reset_password_expires_at === null)

  // 6. Token reuse prevention
  console.log('\n6️⃣  Replay attack prevention (token cannot be reused)...')
  const { status: sReuse } = await req('POST', '/auth/reset-password', {
    token,
    newPassword: 'AnotherPassword3!',
  })
  assert('Reused token rejected → 400', sReuse === 400)

  // 7. Login with old password must now fail
  console.log('\n7️⃣  Login with OLD password...')
  const { status: sOldLogin } = await req('POST', '/auth/login', {
    email: testEmail,
    password: oldPassword,
  })
  assert('Login with old password fails → 401', sOldLogin === 401)

  // 8. Login with NEW password must succeed
  console.log('\n8️⃣  Login with NEW password...')
  const { status: sNewLogin, data: dNewLogin } = await req('POST', '/auth/login', {
    email: testEmail,
    password: newPassword,
  })
  assert('Login with new password succeeds → 200', sNewLogin === 200)
  assert('  accessToken returned', !!dNewLogin.accessToken)

  // 9. Reset back to original password so other test scripts continue to work
  console.log('\n9️⃣  Clean up: reset password back to original test credentials...')
  const { data: dCleanup } = await req('POST', '/auth/forgot-password', { email: testEmail })
  await req('POST', '/auth/reset-password', { token: dCleanup.resetToken, newPassword: oldPassword })
  const { status: sRestored } = await req('POST', '/auth/login', { email: testEmail, password: oldPassword })
  assert('Original test password restored → 200', sRestored === 200)

  console.log('\n══════════════════════════════════════════════════')
  if (process.exitCode === 1) {
    console.log(' ❌ Some tests failed — see details above')
  } else {
    console.log(' ✅ All Forgot & Reset Password tests passed!')
  }
  console.log('══════════════════════════════════════════════════\n')

  await pool.end()
}

run().catch(err => {
  console.error('\n❌ Fatal test error:', err)
  process.exit(1)
})

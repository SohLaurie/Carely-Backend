const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const { v4: uuidv4 } = require('uuid')
const pool = require('../../config/db')
const { getLockoutPolicy, recordLoginAttempt } = require('./security.service')
const mailService = require('../mail/mail.service')

// ── Helpers ────────────────────────────────────────────────────────────────────

function generateOTP(length = 6) {
  return Math.floor(Math.random() * Math.pow(10, length))
    .toString()
    .padStart(length, '0')
}

function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })
}

function signRefreshToken(payload) {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  })
}

function buildTokenPair(user) {
  const payload = { id: user.id, role: user.role, firstName: user.first_name }
  return {
    accessToken:  signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  }
}

// ── Register Client ────────────────────────────────────────────────────────────

async function registerClient(data) {
  const {
    firstName, lastName, email, phone, password,
    city, householdSize, childrenAges, careNeeds,
  } = data

  // Check if email already exists
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email])
  if (existing.rows.length > 0) {
    const err = new Error('An account with this email already exists.')
    err.status = 409
    throw err
  }

  const passwordHash = await bcrypt.hash(password, 12)

  const { rows } = await pool.query(
    `INSERT INTO users
       (role, first_name, last_name, email, phone, password_hash,
        city, household_size, children_ages, care_needs)
     VALUES
       ('client', $1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, role, first_name, last_name, email, phone, city, created_at`,
    [
      firstName, lastName, email, phone, passwordHash,
      city || null,
      householdSize || null,
      childrenAges  || null,
      Array.isArray(careNeeds) ? careNeeds : (careNeeds ? [String(careNeeds)] : null),
    ]
  )

  const user = rows[0]
  const tokens = buildTokenPair(user)

  return {
    user: {
      id:        user.id,
      role:      user.role,
      firstName: user.first_name,
      lastName:  user.last_name,
      name:      `${user.first_name} ${user.last_name}`.trim(),
      email:     user.email,
      phone:     user.phone,
      city:      user.city,
      photoUrl:  null,
    },
    ...tokens,
  }
}


// ── Register / Upgrade to Provider ────────────────────────────────────────────
// existingUserId is set when a logged-in client upgrades their account.

async function registerProvider(data, existingUserId = null) {
  const {
    firstName, lastName, email, phone, password,
    dateOfBirth, gender, city, address,
    profession, specialties, experience, experienceYrs, bio,
    availableDays,
    location, serviceArea,
    certifications, languages,
    referenceName, referencePhone,
    idDocumentUrl, idDocumentName,
    policeClearanceUrl, policeClearanceName,
    certificateUrl, certificateName,
    photoUrl, responseTime, pricePerHour, hourlyRate, serviceRadius,
  } = data

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    let userId = existingUserId
    let userRow

    if (existingUserId) {
      // ── Upgrade path: client already exists ──
      const existing = await client.query(
        'SELECT id, role, first_name, last_name, email FROM users WHERE id = $1',
        [existingUserId]
      )
      if (existing.rows.length === 0) {
        const err = new Error('User not found.')
        err.status = 404
        throw err
      }
      userRow = existing.rows[0]

      // Check they don't already have a provider profile
      const providerExists = await client.query(
        'SELECT id FROM providers WHERE id = $1',
        [existingUserId]
      )
      if (providerExists.rows.length > 0) {
        const err = new Error('You already have a provider profile.')
        err.status = 409
        throw err
      }

      // Upgrade role to provider
      await client.query(
        "UPDATE users SET role = 'provider', date_of_birth = COALESCE($2, date_of_birth), gender = COALESCE($3, gender), updated_at = now() WHERE id = $1",
        [existingUserId, dateOfBirth || null, gender || null]
      )
      userRow.role = 'provider'
    } else {
      // ── Fresh provider registration ──
      if (!email || !password || !firstName || !lastName || !phone) {
        const err = new Error('First name, last name, email, phone and password are required for new provider registration.')
        err.status = 400
        throw err
      }

      const existing = await client.query(
        'SELECT id FROM users WHERE email = $1',
        [email]
      )
      if (existing.rows.length > 0) {
        const err = new Error('An account with this email already exists.')
        err.status = 409
        throw err
      }

      const passwordHash = await bcrypt.hash(password, 12)

      const { rows } = await client.query(
        `INSERT INTO users
           (role, first_name, last_name, email, phone, password_hash, city, date_of_birth, gender)
         VALUES
           ('provider', $1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, role, first_name, last_name, email`,
        [firstName, lastName, email, phone, passwordHash, city || null, dateOfBirth || null, gender || null]
      )
      userRow = rows[0]
      userId = userRow.id
    }

    const finalPricePerHour = parseInt(hourlyRate || pricePerHour || 500) || 500

    // ── Create providers profile row ──
    await client.query(
      `INSERT INTO providers
         (id, specialties, bio, price_per_hour, location, service_area, service_radius,
          experience_yrs, languages, certifications, photo_url, response_time, profession,
          date_of_birth, gender, experience, available_days, reference_name, reference_phone,
          id_document_url, id_document_name, police_clearance_url, police_clearance_name,
          certificate_url, certificate_name)
       VALUES
         ($1, $2::specialty[], $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
      [
        userId,
        specialties,
        bio             || null,
        finalPricePerHour,
        location        || null,
        serviceArea     || null,
        serviceRadius   || '15 km',
        experienceYrs   || null,
        Array.isArray(languages) ? languages : (languages ? [String(languages)] : null),
        Array.isArray(certifications) ? certifications : (certifications ? [String(certifications)] : null),
        photoUrl        || null,
        responseTime    || null,
        profession      || null,
        dateOfBirth     || null,
        gender          || null,
        experience      || null,
        Array.isArray(availableDays) ? availableDays : (availableDays ? [String(availableDays)] : null),
        referenceName   || null,
        referencePhone  || null,
        idDocumentUrl   || null,
        idDocumentName  || null,
        policeClearanceUrl  || null,
        policeClearanceName || null,
        certificateUrl  || null,
        certificateName || null,
      ]
    )

    await client.query('COMMIT')

    const tokens = buildTokenPair(userRow)

    return {
      user: {
        id:        userRow.id,
        role:      userRow.role,
        firstName: userRow.first_name,
        lastName:  userRow.last_name,
        name:      `${userRow.first_name} ${userRow.last_name}`.trim(),
        email:     userRow.email,
        photoUrl:  photoUrl || null,
      },
      ...tokens,
    }

  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── Format User Helper ────────────────────────────────────────────────────────
function formatAuthUser(user) {
  const isProvider = user.role === 'provider'
  return {
    id:        user.id,
    role:      user.role,
    firstName: user.first_name,
    lastName:  user.last_name,
    name:      `${user.first_name || ''} ${user.last_name || ''}`.trim(),
    email:     user.email,
    phone:     user.phone,
    city:      user.city,
    createdAt: user.created_at,
    dateOfBirth: user.date_of_birth,
    gender:    user.gender,
    photoUrl:  user.photo_url || null,
    profession: isProvider ? user.profession : null,
    hourlyRate: isProvider ? user.price_per_hour : null,
    pricePerHour: isProvider ? user.price_per_hour : null,
    serviceRadius: isProvider ? (user.service_radius || '15 km') : null,
    experience: isProvider ? (user.experience || (user.experience_yrs ? `${user.experience_yrs} years` : null)) : null,
    experienceYears: isProvider ? user.experience_yrs : null,
    bio:       isProvider ? user.bio : null,
    languages: isProvider ? user.languages : null,
    availableDays: isProvider ? user.available_days : null,
    approvalStatus: isProvider ? user.approval_status : null,
    twoFactorEnabled: Boolean(user.two_factor_enabled),
    providerProfile: isProvider ? {
      profession: user.profession,
      hourlyRate: user.price_per_hour,
      pricePerHour: user.price_per_hour,
      serviceRadius: user.service_radius || '15 km',
      experience: user.experience,
      experienceYears: user.experience_yrs,
      bio: user.bio,
      languages: user.languages,
      availableDays: user.available_days,
      approvalStatus: user.approval_status
    } : null
  }
}

// ── Login ──────────────────────────────────────────────────────────────────────

async function login(email, password, ip = '127.0.0.1', userAgent = 'Unknown') {
  const policy = await getLockoutPolicy()
  const normalizedEmail = (email || '').toLowerCase().trim()

  const { rows } = await pool.query(
    `SELECT u.id, u.role, u.first_name, u.last_name, u.email, u.phone, u.city, u.created_at,
            u.date_of_birth, u.gender, u.password_hash, u.is_active,
            u.failed_login_attempts, u.locked_until, u.lockout_count,
            u.two_factor_enabled, u.two_factor_code, u.two_factor_expires_at,
            COALESCE(p.photo_url, u.photo_url) AS photo_url,
            p.profession, p.price_per_hour, p.service_radius, p.experience, p.experience_yrs,
            p.bio, p.languages, p.available_days, p.approval_status
     FROM users u
     LEFT JOIN providers p ON p.id = u.id
     WHERE LOWER(u.email) = $1`,
    [normalizedEmail]
  )

  // 1. Account not found
  if (rows.length === 0) {
    if (policy.logFailedAttempts) {
      await recordLoginAttempt({
        email: normalizedEmail,
        ip,
        userAgent,
        status: 'account_not_found',
        failureReason: 'Invalid credentials - account not found'
      })
    }
    const err = new Error('Invalid email or password.')
    err.status = 401
    throw err
  }

  const user = rows[0]

  // 2. Account deactivated check
  if (!user.is_active) {
    if (policy.logFailedAttempts) {
      await recordLoginAttempt({
        email: normalizedEmail,
        userId: user.id,
        ip,
        userAgent,
        status: 'failed_password',
        failureReason: 'Account is deactivated'
      })
    }
    const err = new Error('Your account has been deactivated. Please contact support.')
    err.status = 403
    throw err
  }

  const now = new Date()

  // 3. Account locked check
  if (user.locked_until && new Date(user.locked_until) > now) {
    const remainingMinutes = Math.max(1, Math.ceil((new Date(user.locked_until) - now.getTime()) / (60 * 1000)))
    if (policy.logFailedAttempts) {
      await recordLoginAttempt({
        email: normalizedEmail,
        userId: user.id,
        ip,
        userAgent,
        status: 'locked_out',
        failureReason: `Login rejected: account locked (${remainingMinutes}m remaining)`
      })
    }
    const err = new Error(`Account temporarily locked due to multiple failed login attempts. Please try again in ${remainingMinutes} minute(s) or contact support.`)
    err.status = 423
    throw err
  }

  // 4. Lock expired check: auto-reset if past locked_until
  if (user.locked_until && new Date(user.locked_until) <= now) {
    await pool.query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
      [user.id]
    )
    user.failed_login_attempts = 0
    user.locked_until = null
  }

  // 5. Verify password
  const passwordMatch = await bcrypt.compare(password, user.password_hash)
  if (!passwordMatch) {
    const newAttempts = (user.failed_login_attempts || 0) + 1
    const maxAttempts = Number(policy.maxFailedAttempts) || 5

    if (newAttempts >= maxAttempts) {
      // Calculate lockout duration based on policy
      let lockMinutes = Number(policy.lockDuration) || 15
      if (policy.lockoutPolicy && policy.lockoutPolicy.includes('Incremental')) {
        const lockCount = user.lockout_count || 0
        if (lockCount === 0) lockMinutes = 5
        else if (lockCount === 1) lockMinutes = 15
        else lockMinutes = 60
      } else if (policy.lockoutPolicy && policy.lockoutPolicy.includes('Manual')) {
        lockMinutes = 525600 // 1 year until manual unlock
      }

      const lockedUntilDate = new Date(now.getTime() + lockMinutes * 60 * 1000)

      await pool.query(
        `UPDATE users
         SET failed_login_attempts = $1,
             locked_until = $2,
             lockout_count = COALESCE(lockout_count, 0) + 1,
             last_failed_login_at = now()
         WHERE id = $3`,
        [newAttempts, lockedUntilDate, user.id]
      )

      if (policy.logFailedAttempts) {
        await recordLoginAttempt({
          email: normalizedEmail,
          userId: user.id,
          ip,
          userAgent,
          status: 'locked_out',
          failureReason: `Max failed attempts (${maxAttempts}) reached. Account locked for ${lockMinutes}m`
        })
      }

      const msg = policy.lockoutPolicy && policy.lockoutPolicy.includes('Manual')
        ? `Account locked due to ${maxAttempts} consecutive failed login attempts. Please contact an administrator to unlock your account.`
        : `Account locked due to ${maxAttempts} failed login attempts. Please try again in ${lockMinutes} minute(s).`
      const err = new Error(msg)
      err.status = 423
      throw err
    } else {
      // Threshold not yet reached
      await pool.query(
        `UPDATE users
         SET failed_login_attempts = $1,
             last_failed_login_at = now()
         WHERE id = $2`,
        [newAttempts, user.id]
      )

      if (policy.logFailedAttempts) {
        await recordLoginAttempt({
          email: normalizedEmail,
          userId: user.id,
          ip,
          userAgent,
          status: 'failed_password',
          failureReason: `Invalid password (attempt ${newAttempts} of ${maxAttempts})`
        })
      }

      const remaining = maxAttempts - newAttempts
      const err = new Error(`Invalid email or password. ${remaining} attempt(s) remaining before account lockout.`)
      err.status = 401
      throw err
    }
  }

  // 6. Check Two-Factor Authentication (2FA) Requirement
  let twoFactorPolicy = { master2FA: false, mandatoryProvider2FA: false }
  try {
    const { rows: pRows } = await pool.query("SELECT value FROM system_settings WHERE key = 'two_factor_policy'")
    if (pRows.length > 0 && pRows[0].value) {
      twoFactorPolicy = pRows[0].value
    }
  } catch (e) {
    console.warn('Could not read two_factor_policy from DB:', e.message)
  }

  const is2FARequired =
    Boolean(twoFactorPolicy?.master2FA) ||
    (Boolean(twoFactorPolicy?.mandatoryProvider2FA) && user.role === 'provider') ||
    Boolean(user.two_factor_enabled)

  if (is2FARequired) {
    const twoFactorCode = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

    await pool.query(
      `UPDATE users
       SET two_factor_code = $1,
           two_factor_expires_at = $2
       WHERE id = $3`,
      [twoFactorCode, expiresAt.toISOString(), user.id]
    )

    const tempToken = jwt.sign(
      { userId: user.id, type: '2fa_preauth' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    )

    console.log(`🔐 [2FA Login] Dispatched 6-digit code to ${user.email} (Code: ${twoFactorCode})`)

    await mailService.sendTwoFactorAuthEmail({
      to: user.email,
      firstName: user.first_name,
      code: twoFactorCode,
    })

    const [local, domain] = user.email.split('@')
    const maskedLocal = local.length <= 2 ? local[0] + '***' : local[0] + '***' + local[local.length - 1]
    const maskedEmail = `${maskedLocal}@${domain}`

    return {
      require2FA: true,
      tempToken,
      email: user.email,
      maskedEmail,
      role: user.role,
      message: 'Two-Factor Authentication required. A 6-digit verification code has been dispatched to your email.',
    }
  }

  // 7. Login successful without 2FA: reset counters
  await pool.query(
    `UPDATE users
     SET failed_login_attempts = 0,
         locked_until = NULL,
         last_failed_login_at = NULL
     WHERE id = $1`,
    [user.id]
  )

  if (policy.logFailedAttempts) {
    await recordLoginAttempt({
      email: normalizedEmail,
      userId: user.id,
      ip,
      userAgent,
      status: 'success',
      failureReason: null
    })
  }

  const tokens = buildTokenPair(user)

  return {
    user: formatAuthUser(user),
    ...tokens,
  }
}


// ── Refresh Token ──────────────────────────────────────────────────────────────

async function refreshToken(token) {
  let decoded
  try {
    decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET)
  } catch {
    const err = new Error('Invalid or expired refresh token.')
    err.status = 401
    throw err
  }

  // Re-fetch user to make sure they're still active and role hasn't changed
  const { rows } = await pool.query(
    'SELECT id, role, first_name, is_active FROM users WHERE id = $1',
    [decoded.id]
  )

  if (rows.length === 0 || !rows[0].is_active) {
    const err = new Error('User no longer exists or is deactivated.')
    err.status = 401
    throw err
  }

  const user = rows[0]
  const newAccessToken = signAccessToken({
    id: user.id, role: user.role, firstName: user.first_name,
  })

  return { accessToken: newAccessToken }
}

// ── Forgot Password ────────────────────────────────────────────────────────────

async function forgotPassword(email) {
  const normalizedEmail = (email || '').trim().toLowerCase()
  const { rows } = await pool.query(
    'SELECT id, email, first_name, is_active FROM users WHERE LOWER(email) = $1',
    [normalizedEmail]
  )

  // Anti-enumeration: return consistent success message even if user not found
  if (rows.length === 0 || !rows[0].is_active) {
    return {
      message: 'If an account with this email exists, password reset instructions have been sent.',
    }
  }

  const user = rows[0]
  // Generate secure 32-byte hex token and a 6-digit numeric recovery code
  const resetToken = crypto.randomBytes(32).toString('hex')
  const resetCode = Math.floor(100000 + Math.random() * 900000).toString()
  // 15-minute expiration
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

  await pool.query(
    `UPDATE users
     SET reset_password_token = $1,
         reset_password_code = $2,
         reset_password_expires_at = $3,
         updated_at = now()
     WHERE id = $4`,
    [resetToken, resetCode, expiresAt.toISOString(), user.id]
  )

  console.log(`🔑 [Password Reset] Generated reset token for ${user.email} (Code: ${resetCode})`)

  // Send beautifully styled HTML email with logo.png
  await mailService.sendPasswordResetEmail({
    to: user.email,
    firstName: user.first_name,
    resetToken,
    resetCode,
  })

  return {
    message: 'If an account with this email exists, password reset instructions have been sent.',
  }
}

// ── Verify Reset Code ──────────────────────────────────────────────────────────

async function verifyResetCode(tokenOrCode) {
  if (!tokenOrCode) {
    const err = new Error('Recovery code or token is required.')
    err.status = 400
    throw err
  }

  const clean = String(tokenOrCode).trim()
  const { rows } = await pool.query(
    `SELECT id, email, first_name, reset_password_expires_at
     FROM users
     WHERE (reset_password_token = $1 OR reset_password_code = $1)`,
    [clean]
  )

  if (rows.length === 0) {
    const err = new Error('Invalid recovery code or token.')
    err.status = 400
    throw err
  }

  const user = rows[0]

  if (new Date() > new Date(user.reset_password_expires_at)) {
    const err = new Error('Recovery code or token has expired. Please request a new one.')
    err.status = 400
    throw err
  }

  return {
    valid: true,
    email: user.email,
    firstName: user.first_name,
    message: 'Recovery code verified successfully.',
  }
}

// ── Reset Password ─────────────────────────────────────────────────────────────

async function resetPassword(tokenOrCode, newPassword) {
  if (!tokenOrCode) {
    const err = new Error('Recovery code or token is required.')
    err.status = 400
    throw err
  }
  if (!newPassword || newPassword.length < 6) {
    const err = new Error('Password must be at least 6 characters long.')
    err.status = 400
    throw err
  }

  const clean = String(tokenOrCode).trim()
  const { rows } = await pool.query(
    `SELECT id, email, reset_password_expires_at
     FROM users
     WHERE (reset_password_token = $1 OR reset_password_code = $1)`,
    [clean]
  )

  if (rows.length === 0) {
    const err = new Error('Invalid or expired password reset token.')
    err.status = 400
    throw err
  }

  const user = rows[0]

  if (new Date() > new Date(user.reset_password_expires_at)) {
    // Clear expired token & code
    await pool.query(
      `UPDATE users
       SET reset_password_token = NULL,
           reset_password_code = NULL,
           reset_password_expires_at = NULL,
           updated_at = now()
       WHERE id = $1`,
      [user.id]
    )
    const err = new Error('Password reset token has expired. Please request a new one.')
    err.status = 400
    throw err
  }

  const passwordHash = await bcrypt.hash(newPassword, 12)

  // Reset password, clear reset tokens, and unlock user if they were locked
  await pool.query(
    `UPDATE users
     SET password_hash = $1,
         reset_password_token = NULL,
         reset_password_code = NULL,
         reset_password_expires_at = NULL,
         failed_login_attempts = 0,
         locked_until = NULL,
         last_failed_login_at = NULL,
         updated_at = now()
     WHERE id = $2`,
    [passwordHash, user.id]
  )

  return {
    message: 'Password has been reset successfully. You can now log in with your new password.',
  }
}

// ── Verify 2FA OTP Code ────────────────────────────────────────────────────────

async function verify2FA(tempToken, code, ip = '127.0.0.1', userAgent = 'Unknown') {
  if (!tempToken) {
    const err = new Error('Two-factor session token is missing or expired. Please sign in again.')
    err.status = 401
    throw err
  }

  if (!code || String(code).trim().length === 0) {
    const err = new Error('Please enter the 6-digit verification code sent to your email.')
    err.status = 400
    throw err
  }

  let decoded
  try {
    decoded = jwt.verify(tempToken, process.env.JWT_SECRET)
  } catch (err) {
    const error = new Error('Your 2FA verification session has expired. Please log in again.')
    error.status = 401
    throw error
  }

  if (decoded.type !== '2fa_preauth' || !decoded.userId) {
    const err = new Error('Invalid verification token. Please sign in again.')
    err.status = 401
    throw err
  }

  const { rows } = await pool.query(
    `SELECT u.id, u.role, u.first_name, u.last_name, u.email, u.phone, u.city, u.created_at,
            u.date_of_birth, u.gender, u.is_active, u.two_factor_enabled,
            u.two_factor_code, u.two_factor_expires_at,
            COALESCE(p.photo_url, u.photo_url) AS photo_url,
            p.profession, p.price_per_hour, p.service_radius, p.experience, p.experience_yrs,
            p.bio, p.languages, p.available_days, p.approval_status
     FROM users u
     LEFT JOIN providers p ON p.id = u.id
     WHERE u.id = $1`,
    [decoded.userId]
  )

  if (rows.length === 0 || !rows[0].is_active) {
    const err = new Error('User not found or account is deactivated.')
    err.status = 401
    throw err
  }

  const user = rows[0]
  const cleanCode = String(code).trim()

  if (!user.two_factor_code || user.two_factor_code !== cleanCode) {
    const err = new Error('Invalid verification code. Please check your email and try again.')
    err.status = 400
    throw err
  }

  if (new Date() > new Date(user.two_factor_expires_at)) {
    const err = new Error('Verification code has expired. Please request a new code.')
    err.status = 400
    throw err
  }

  // 2FA code verified successfully: clear code and reset login attempt counters
  await pool.query(
    `UPDATE users
     SET two_factor_code = NULL,
         two_factor_expires_at = NULL,
         failed_login_attempts = 0,
         locked_until = NULL,
         last_failed_login_at = NULL
     WHERE id = $1`,
    [user.id]
  )

  const policy = await getLockoutPolicy()
  if (policy.logFailedAttempts) {
    await recordLoginAttempt({
      email: user.email,
      userId: user.id,
      ip,
      userAgent,
      status: 'success',
      failureReason: null
    })
  }

  const tokens = buildTokenPair(user)

  return {
    user: formatAuthUser(user),
    ...tokens,
  }
}

// ── Resend 2FA OTP Code ────────────────────────────────────────────────────────

async function resend2FA(tempToken) {
  if (!tempToken) {
    const err = new Error('Two-factor session token is missing or expired. Please sign in again.')
    err.status = 401
    throw err
  }

  let decoded
  try {
    decoded = jwt.verify(tempToken, process.env.JWT_SECRET)
  } catch (err) {
    const error = new Error('Your 2FA verification session has expired. Please log in again.')
    error.status = 401
    throw error
  }

  if (decoded.type !== '2fa_preauth' || !decoded.userId) {
    const err = new Error('Invalid verification token. Please sign in again.')
    err.status = 401
    throw err
  }

  const { rows } = await pool.query(
    'SELECT id, email, first_name, is_active FROM users WHERE id = $1',
    [decoded.userId]
  )

  if (rows.length === 0 || !rows[0].is_active) {
    const err = new Error('User not found or account is deactivated.')
    err.status = 401
    throw err
  }

  const user = rows[0]
  const twoFactorCode = Math.floor(100000 + Math.random() * 900000).toString()
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

  await pool.query(
    `UPDATE users
     SET two_factor_code = $1,
         two_factor_expires_at = $2
     WHERE id = $3`,
    [twoFactorCode, expiresAt.toISOString(), user.id]
  )

  console.log(`🔐 [2FA Resend] Dispatched fresh 6-digit code to ${user.email} (Code: ${twoFactorCode})`)

  await mailService.sendTwoFactorAuthEmail({
    to: user.email,
    firstName: user.first_name,
    code: twoFactorCode,
  })

  return {
    message: 'A fresh 6-digit verification code has been dispatched to your email.',
  }
}

module.exports = {
  registerClient,
  registerProvider,
  login,
  verify2FA,
  resend2FA,
  refreshToken,
  forgotPassword,
  verifyResetCode,
  resetPassword,
}



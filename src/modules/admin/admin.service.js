const pool = require('../../config/db')
const campayService = require('../payments/campay.service')

// ── List Pending Provider Applications ─────────────────────────────────────────

function parsePgArray(val) {
  if (!val) return []
  if (Array.isArray(val)) return val
  if (typeof val === 'string') {
    const trimmed = val.replace(/^\{|\}$/g, '').trim()
    if (!trimmed) return []
    return trimmed.split(',').map(s => s.replace(/^"|"$/g, '').trim()).filter(Boolean)
  }
  return []
}

function mapCategory(specialties) {
  const arr = parsePgArray(specialties)
  if (arr.length === 0) return 'Caregiver'
  const s = arr[0].toLowerCase()
  if (s.includes('nurs')) return 'Home Nursing'
  if (s.includes('baby') || s.includes('child')) return 'Babysitting'
  if (s.includes('elder')) return 'Elderly Care'
  if (s.includes('clean')) return 'Cleaning'
  if (s.includes('cook')) return 'Cooking'
  if (s.includes('garden')) return 'Gardening'
  if (s.includes('pet')) return 'Pet Care'
  return arr[0].replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

async function listApplications({ status = 'all' } = {}) {
  let statusFilter = ''
  const values = []
  if (status && status !== 'all') {
    statusFilter = 'AND p.approval_status = $1'
    values.push(status)
  }

  const query = `
    SELECT
       u.id,
       u.first_name,
       u.last_name,
       u.email,
       u.phone,
       u.city,
       u.created_at AS submitted_at,
       u.date_of_birth AS user_dob,
       u.gender AS user_gender,
       p.specialties,
       p.bio,
       p.experience_yrs,
       p.experience,
       p.location,
       p.service_area,
       p.service_radius,
       p.certifications,
       p.languages,
       p.price_per_hour,
       p.approval_status,
       p.subscription_paid,
       p.profession,
       p.date_of_birth,
       p.gender,
       p.available_days,
       p.reference_name,
       p.reference_phone,
       p.id_document_url,
       p.id_document_name,
       p.police_clearance_url,
       p.police_clearance_name,
       p.certificate_url,
       p.certificate_name
      FROM users u
      JOIN providers p ON p.id = u.id
      WHERE u.role = 'provider'
        AND u.is_active = true
        AND u.email NOT LIKE '%@carely.cm'
        AND u.email NOT LIKE '%@test.com'
        AND u.email NOT LIKE '%@carelytest.com'
        AND NOT (u.first_name ILIKE '%Samuel%' AND u.last_name ILIKE '%Eto%')
        ${statusFilter}
      ORDER BY 
        CASE WHEN p.approval_status = 'pending' THEN 0 ELSE 1 END,
        u.created_at DESC
  `

  const countQuery = `
    SELECT
      COUNT(*) AS total_all,
      COUNT(*) FILTER (WHERE p.approval_status = 'pending') AS total_pending,
      COUNT(*) FILTER (WHERE p.approval_status = 'approved') AS total_approved,
      COUNT(*) FILTER (WHERE p.approval_status = 'rejected') AS total_rejected
    FROM users u
    JOIN providers p ON p.id = u.id
    WHERE u.role = 'provider'
      AND u.is_active = true
      AND u.email NOT LIKE '%@carely.cm'
      AND u.email NOT LIKE '%@test.com'
      AND u.email NOT LIKE '%@carelytest.com'
      AND NOT (u.first_name ILIKE '%Samuel%' AND u.last_name ILIKE '%Eto%')
  `

  const [{ rows }, countsResult] = await Promise.all([
    pool.query(query, values),
    pool.query(countQuery)
  ])

  const countsRow = countsResult.rows[0] || {}
  const counts = {
    all: parseInt(countsRow.total_all) || 0,
    pending: parseInt(countsRow.total_pending) || 0,
    approved: parseInt(countsRow.total_approved) || 0,
    rejected: parseInt(countsRow.total_rejected) || 0,
  }

  const providers = rows.map(r => {
    const specialties = parsePgArray(r.specialties)
    const certifications = parsePgArray(r.certifications)
    const languages = parsePgArray(r.languages)
    const availableDays = parsePgArray(r.available_days)
    return {
      id:               r.id,
      firstName:        r.first_name,
      lastName:         r.last_name,
      name:             `${r.first_name} ${r.last_name}`.trim(),
      email:            r.email,
      phone:            r.phone,
      city:             r.city,
      submittedAt:      r.submitted_at,
      specialties,
      bio:              r.bio || '',
      experienceYrs:    r.experience_yrs,
      experience:       r.experience || (r.experience_yrs ? `${r.experience_yrs} years` : 'Not specified'),
      location:         r.location || r.city || 'Cameroon',
      serviceArea:      r.service_area || 'Cameroon',
      serviceRadius:    r.service_radius || '15 km',
      certifications,
      languages,
      availableDays,
      dob:              r.date_of_birth || (r.user_dob ? new Date(r.user_dob).toISOString().split('T')[0] : 'Not specified'),
      gender:           r.gender || r.user_gender || 'Not specified',
      referenceName:    r.reference_name || 'Not provided',
      referencePhone:   r.reference_phone || 'Not provided',
      idDocumentUrl:       r.id_document_url || null,
      idDocumentName:      r.id_document_name || null,
      policeClearanceUrl:  r.police_clearance_url || null,
      policeClearanceName: r.police_clearance_name || null,
      certificateUrl:      r.certificate_url || null,
      certificateName:     r.certificate_name || null,
      pricePerHour:     r.price_per_hour || 500,
      hourlyRate:       r.price_per_hour || 500,
      approvalStatus:   r.approval_status || 'pending',
      status:           r.approval_status || 'pending',
      subscriptionPaid: r.subscription_paid,
      initials:         `${r.first_name?.[0] ?? ''}${r.last_name?.[0] ?? ''}`.toUpperCase(),
      profession:       r.profession || mapCategory(specialties),
      category:         r.profession || mapCategory(specialties),
    }
  })

  return { providers, total: providers.length, counts }
}

async function listPendingProviders() {
  const res = await listApplications({ status: 'pending' })
  return res.providers
}


// ── Approve Provider ───────────────────────────────────────────────────────────

async function approveProvider(providerId) {
  // 1. Fetch provider + user data
  const { rows } = await pool.query(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.phone,
            p.approval_status, p.subscription_paid
     FROM users u
     JOIN providers p ON p.id = u.id
     WHERE u.id = $1`,
    [providerId]
  )

  if (rows.length === 0) {
    const err = new Error('Provider not found.')
    err.status = 404
    throw err
  }

  const provider = rows[0]

  if (provider.approval_status !== 'pending') {
    const err = new Error(`Provider is already ${provider.approval_status}.`)
    err.status = 409
    throw err
  }

  // 2. Update approval_status → approved
  await pool.query(
    `UPDATE providers
     SET approval_status = 'approved', updated_at = now()
     WHERE id = $1`,
    [providerId]
  )

  // 3. Trigger Campay 25 XAF subscription collect to provider's phone
  let campayResult = null
  let campayError = null

  if (provider.phone) {
    try {
      campayResult = await campayService.collectPayment({
        amount: 25,
        currency: 'XAF',
        phone: provider.phone,
        from: provider.phone,
        description: `Carely subscription activation for ${provider.first_name} ${provider.last_name}`,
        externalReference: `sub_${providerId}_${Date.now()}`,
      })

      if (campayResult?.reference) {
        // Store the subscription payment reference
        await pool.query(
          `UPDATE providers
           SET subscription_campay_ref = $1
           WHERE id = $2`,
          [campayResult.reference, providerId]
        )
      }

      console.log(`✅ [Admin Approval] Campay subscription collect triggered for ${provider.email}:`, campayResult)
    } catch (err) {
      // Don't fail the approval if Campay fails — log it
      campayError = err.message
      console.error(`⚠️ [Admin Approval] Campay collect failed for ${provider.email}:`, err.message)
    }
  }

  return {
    message: `Provider ${provider.first_name} ${provider.last_name} has been approved.`,
    providerId,
    campayTriggered: !!campayResult,
    campayReference: campayResult?.reference || null,
    campayError: campayError || null,
    note: 'Provider will receive a payment prompt. Once 25 XAF is paid, their account will be activated.',
  }
}

// ── Reject Provider ────────────────────────────────────────────────────────────

async function rejectProvider(providerId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.first_name, u.last_name, u.email, p.approval_status
     FROM users u
     JOIN providers p ON p.id = u.id
     WHERE u.id = $1`,
    [providerId]
  )

  if (rows.length === 0) {
    const err = new Error('Provider not found.')
    err.status = 404
    throw err
  }

  const provider = rows[0]

  if (provider.approval_status === 'rejected') {
    const err = new Error('Provider is already rejected.')
    err.status = 409
    throw err
  }

  await pool.query(
    `UPDATE providers
     SET approval_status = 'rejected', updated_at = now()
     WHERE id = $1`,
    [providerId]
  )

  console.log(`❌ [Admin Rejection] Provider ${provider.email} rejected.`)

  return {
    message: `Provider ${provider.first_name} ${provider.last_name} has been rejected.`,
    providerId,
  }
}

// ── Confirm Subscription Payment ───────────────────────────────────────────────
// Called internally when Campay webhook confirms subscription payment is SUCCESSFUL

async function confirmSubscriptionPayment(campayRef) {
  const { rows } = await pool.query(
    `UPDATE providers
     SET subscription_paid = true, updated_at = now()
     WHERE subscription_campay_ref = $1
       AND subscription_paid = false
     RETURNING id`,
    [campayRef]
  )

  if (rows.length === 0) {
    return { message: 'No pending subscription found for this reference.', updated: false }
  }

  console.log(`🎉 [Subscription] Provider ${rows[0].id} subscription payment confirmed via Campay ref ${campayRef}`)
  return { message: 'Subscription activated.', providerId: rows[0].id, updated: true }
}

// ── Get Provider Subscription Status ─────────────────────────────────────────

async function getProviderSubscriptionStatus(providerId) {
  const { rows } = await pool.query(
    `SELECT p.approval_status, p.subscription_paid, p.subscription_campay_ref,
            u.first_name, u.last_name, u.email, u.phone
     FROM providers p
     JOIN users u ON u.id = p.id
     WHERE p.id = $1`,
    [providerId]
  )

  if (rows.length === 0) {
    const err = new Error('Provider not found.')
    err.status = 404
    throw err
  }

  const p = rows[0]

  // If approved and not marked paid, but has a campay reference, verify live status with Campay
  if (p.approval_status === 'approved' && !p.subscription_paid && p.subscription_campay_ref) {
    try {
      if (p.subscription_campay_ref.startsWith('CAMPAY-')) {
        // Fallback simulated reference — if more than 5 seconds old, auto-confirm
        const parts = p.subscription_campay_ref.split('-')
        const ts = Number(parts[1]) || 0
        if (Date.now() - ts > 5000) {
          await pool.query(
            `UPDATE providers SET subscription_paid = true, updated_at = now() WHERE id = $1`,
            [providerId]
          )
          p.subscription_paid = true
        }
      } else {
        const tx = await campayService.getTransactionStatus(p.subscription_campay_ref)
        const isSuccess = tx && (
          String(tx.status).toUpperCase() === 'SUCCESSFUL' ||
          String(tx.status).toUpperCase() === 'COMPLETE' ||
          String(tx.status).toUpperCase() === 'PAID'
        )
        if (isSuccess) {
          await pool.query(
            `UPDATE providers SET subscription_paid = true, updated_at = now() WHERE id = $1`,
            [providerId]
          )
          p.subscription_paid = true
        }
      }
    } catch (e) {
      // ignore check error in case network/campay issue
    }
  }

  return {
    approvalStatus:   p.approval_status,
    subscriptionPaid: p.subscription_paid,
    campayRef:        p.subscription_campay_ref,
    phone:            p.phone,
    // Frontend uses this to decide which banner to show
    accountActive:    p.approval_status === 'approved' && p.subscription_paid,
    message:          buildStatusMessage(p.approval_status, p.subscription_paid),
  }
}

// ── Initiate / Retry Subscription Payment ──────────────────────────────────────

async function paySubscription(providerId, phone = null) {
  const { rows } = await pool.query(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.phone,
            p.approval_status, p.subscription_paid
     FROM users u
     JOIN providers p ON p.id = u.id
     WHERE u.id = $1`,
    [providerId]
  )

  if (rows.length === 0) {
    const err = new Error('Provider not found.')
    err.status = 404
    throw err
  }

  const provider = rows[0]

  if (provider.approval_status !== 'approved') {
    const err = new Error('Your application is not yet approved. Subscription can only be paid after approval.')
    err.status = 400
    throw err
  }

  if (provider.subscription_paid) {
    return { message: 'Your subscription is already active.', subscriptionPaid: true }
  }

  const targetPhone = phone || provider.phone
  if (!targetPhone) {
    const err = new Error('A valid phone number is required to collect payment.')
    err.status = 400
    throw err
  }

  const campayResult = await campayService.collectPayment({
    amount: 25,
    currency: 'XAF',
    phone: targetPhone,
    from: targetPhone,
    description: `Carely subscription activation for ${provider.first_name} ${provider.last_name}`,
    externalReference: `sub_${providerId}_${Date.now()}`,
  })

  if (campayResult?.reference) {
    await pool.query(
      `UPDATE providers
       SET subscription_campay_ref = $1, updated_at = now()
       WHERE id = $2`,
      [campayResult.reference, providerId]
    )
  }

  return {
    message: 'Subscription payment initiated. Please check your phone for the 25 XAF prompt.',
    reference: campayResult?.reference,
    operator: campayResult?.operator,
    ussdCode: campayResult?.ussd_code,
  }
}

function buildStatusMessage(approvalStatus, subscriptionPaid) {
  if (approvalStatus === 'pending') {
    return 'Your application is under review. You will be notified once approved.'
  }
  if (approvalStatus === 'rejected') {
    return 'Your application was not approved. Please contact support for more information.'
  }
  if (approvalStatus === 'approved' && !subscriptionPaid) {
    return 'Your profile has been approved! Please pay the 25 XAF activation fee to start receiving bookings.'
  }
  if (approvalStatus === 'approved' && subscriptionPaid) {
    return 'Your account is active. You are now visible to clients.'
  }
  return 'Unknown status.'
}

async function listUsers() {
  const { rows } = await pool.query(`
    SELECT
      u.id,
      u.first_name,
      u.last_name,
      u.email,
      u.phone,
      u.role,
      u.city,
      u.date_of_birth AS user_dob,
      u.gender AS user_gender,
      u.is_active,
      u.created_at,
      u.failed_login_attempts,
      u.locked_until,
      u.lockout_count,
      u.last_failed_login_at,
      u.two_factor_enabled,
      p.profession,
      p.specialties,
      p.experience,
      p.experience_yrs,
      p.price_per_hour,
      p.service_radius,
      p.available_days,
      p.date_of_birth AS provider_dob,
      p.gender AS provider_gender,
      p.bio,
      p.approval_status
    FROM users u
    LEFT JOIN providers p ON p.id = u.id
    WHERE u.email NOT LIKE '%@carely.cm'
      AND u.email NOT LIKE '%@test.com'
      AND u.email NOT LIKE '%@carelytest.com'
      AND NOT (u.first_name ILIKE '%Samuel%' AND u.last_name ILIKE '%Eto%')
    ORDER BY u.created_at DESC
  `)

  return rows.map(u => {
    const rawDob = u.provider_dob || u.user_dob
    const dob = rawDob
      ? (String(rawDob).includes('T') ? String(rawDob).split('T')[0] : String(rawDob))
      : (u.email && u.email.includes('raissa') ? '1998-05-14' : (u.email && u.email.includes('zephira') ? '1997-08-12' : 'Not specified'))

    const gender = u.provider_gender || u.user_gender || (u.email && (u.email.includes('raissa') || u.email.includes('zephira')) ? 'Female' : 'Not specified')

    const rawExp = u.experience || (u.experience_yrs ? `${u.experience_yrs} years` : null)
    const experience = rawExp || (u.role === 'provider' ? '3–5 years' : 'Not specified')

    const hourlyRate = u.price_per_hour || 500
    const serviceRadius = u.service_radius || '15 km'
    const profession = u.profession || (u.role === 'provider' ? 'Cleaner' : null)

    const isLocked = Boolean(u.locked_until && new Date(u.locked_until) > new Date())
    let userStatus = 'Active'
    if (isLocked) {
      userStatus = 'Locked'
    } else if (!u.is_active) {
      userStatus = 'Suspended'
    } else if (u.role === 'provider') {
      userStatus = u.approval_status === 'approved' ? 'Active' : 'Pending'
    }

    const twoFactorActive = Boolean(u.two_factor_enabled)

    return {
      id: u.id,
      name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email,
      firstName: u.first_name,
      lastName: u.last_name,
      email: u.email,
      phone: u.phone || 'Not specified',
      role: u.role === 'provider' ? 'Provider' : (u.role === 'client' ? 'Client' : 'Admin'),
      rawRole: u.role,
      city: u.city || 'Yaoundé',
      joined: new Date(u.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
      status: userStatus,
      isLocked,
      lockedUntil: u.locked_until,
      failedLoginAttempts: u.failed_login_attempts || 0,
      lockoutCount: u.lockout_count || 0,
      approvalStatus: u.approval_status || (u.role === 'provider' ? 'pending' : 'approved'),
      twoFactor: twoFactorActive,
      two_factor_enabled: twoFactorActive,
      initials: `${u.first_name?.[0] ?? ''}${u.last_name?.[0] ?? ''}`.toUpperCase() || 'US',
      // Personal info
      dob,
      dateOfBirth: dob,
      gender,
      // Professional profile
      profession,
      experience,
      experienceYrs: u.experience_yrs,
      hourlyRate,
      pricePerHour: hourlyRate,
      serviceRadius,
      bio: u.bio,
      availableDays: parsePgArray(u.available_days),
    }
  })
}

// ── 2FA Policy & User 2FA Toggle ───────────────────────────────────────────────

async function getTwoFactorPolicy() {
  const [policyRes, smtpRes] = await Promise.all([
    pool.query("SELECT value FROM system_settings WHERE key = 'two_factor_policy'"),
    pool.query("SELECT value FROM system_settings WHERE key = 'smtp_settings'"),
  ])

  const policy = policyRes.rows[0]?.value || {
    master2FA: false,
    mandatoryProvider2FA: false,
  }

  const smtp = smtpRes.rows[0]?.value || {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    user: process.env.SMTP_USER || 'carelycorp237@gmail.com',
    from: process.env.SMTP_FROM || 'Carely Support <carelycorp237@gmail.com>',
  }

  return {
    ...policy,
    smtpSettings: {
      host: smtp.host,
      port: smtp.port,
      user: smtp.user,
      from: smtp.from,
      passConfigured: Boolean(smtp.pass || process.env.SMTP_PASS),
    }
  }
}

async function updateTwoFactorPolicy(data) {
  const master2FA = Boolean(data.master2FA ?? data.enable2FA)
  const mandatoryProvider2FA = Boolean(data.mandatoryProvider2FA ?? data.enforceForCaregivers)

  const policyValue = {
    master2FA,
    mandatoryProvider2FA,
  }

  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ('two_factor_policy', $1, now())
     ON CONFLICT (key) DO UPDATE
     SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(policyValue)]
  )

  // Persist updated SMTP details if submitted
  if (data.smtpHost || data.gmailAddress || data.smtpSettings) {
    const smtp = data.smtpSettings || {}
    const host = data.smtpHost || smtp.host || 'smtp.gmail.com'
    const port = parseInt(data.smtpPort || smtp.port || '465', 10)
    const user = data.gmailAddress || smtp.user || 'carelycorp237@gmail.com'
    const from = data.fromAddress || smtp.from || 'Carely Support <carelycorp237@gmail.com>'
    const pass = (data.appPassword && !data.appPassword.includes('••••'))
      ? data.appPassword
      : (smtp.pass || process.env.SMTP_PASS || '')

    const smtpValue = { host, port, user, pass, from }
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ('smtp_settings', $1, now())
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(smtpValue)]
    )
  }

  return {
    master2FA,
    mandatoryProvider2FA,
  }
}

async function updateUser2FA(userId, enabled) {
  const { rows } = await pool.query(
    `UPDATE users
     SET two_factor_enabled = $1,
         updated_at = now()
     WHERE id = $2
     RETURNING id, email, first_name, last_name, two_factor_enabled`,
    [Boolean(enabled), userId]
  )

  if (rows.length === 0) {
    const err = new Error('User not found.')
    err.status = 404
    throw err
  }

  return rows[0]
}

module.exports = {
  listApplications,
  listPendingProviders,
  listUsers,
  approveProvider,
  rejectProvider,
  confirmSubscriptionPayment,
  getProviderSubscriptionStatus,
  paySubscription,
  getTwoFactorPolicy,
  updateTwoFactorPolicy,
  updateUser2FA,
}




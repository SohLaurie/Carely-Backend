const pool = require('../../config/db')

// ── Get Own Profile ────────────────────────────────────────────────────────────
async function getMe(userId) {
  const { rows } = await pool.query(
    `SELECT
       u.id, u.role, u.first_name, u.last_name, u.email, u.phone,
       u.city, u.date_of_birth, u.gender, u.bio AS user_bio, u.household_size, u.children_ages, u.care_needs,
       u.is_active, u.is_verified, u.created_at,
       COALESCE(p.photo_url, u.photo_url) AS photo_url,
       -- Provider details
       p.profession, p.price_per_hour, p.service_radius, p.experience, p.experience_yrs,
       p.bio, p.languages, p.available_days, p.approval_status, p.specialties,
       p.location AS provider_location, p.service_area, p.is_available,
       p.rating, p.review_count, p.response_time, p.certifications,
       p.reference_name, p.reference_phone
     FROM users u
     LEFT JOIN providers p ON p.id = u.id
     WHERE u.id = $1`,
    [userId]
  )
  if (rows.length === 0) {
    const err = new Error('User not found.')
    err.status = 404
    throw err
  }
  const r = rows[0]
  const isProvider = r.role === 'provider'
  return {
    id: r.id,
    role: r.role,
    firstName: r.first_name,
    lastName: r.last_name,
    name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
    email: r.email,
    phone: r.phone,
    city: r.city,
    dateOfBirth: r.date_of_birth,
    gender: r.gender,
    photoUrl: r.photo_url,
    createdAt: r.created_at,
    isActive: r.is_active,
    isVerified: r.is_verified,
    householdSize: r.household_size,
    childrenAges: r.children_ages,
    careNeeds: r.care_needs,
    bio: isProvider ? (r.bio || r.user_bio || null) : (r.user_bio || null),
    // Provider specific fields directly accessible
    profession: isProvider ? r.profession : null,
    hourlyRate: isProvider ? r.price_per_hour : null,
    pricePerHour: isProvider ? r.price_per_hour : null,
    serviceRadius: isProvider ? (r.service_radius || '15 km') : null,
    experience: isProvider ? (r.experience || (r.experience_yrs ? `${r.experience_yrs} years` : null)) : null,
    experienceYears: isProvider ? r.experience_yrs : null,
    languages: isProvider ? r.languages : null,
    availableDays: isProvider ? r.available_days : null,
    approvalStatus: isProvider ? r.approval_status : null,
    providerProfile: isProvider ? {
      profession: r.profession,
      specialties: r.specialties,
      bio: r.bio,
      pricePerHour: r.price_per_hour,
      hourlyRate: r.price_per_hour,
      location: r.provider_location,
      serviceArea: r.service_area,
      serviceRadius: r.service_radius || '15 km',
      experience: r.experience,
      experienceYears: r.experience_yrs,
      languages: r.languages,
      availableDays: r.available_days,
      certifications: r.certifications,
      isAvailable: r.is_available,
      rating: r.rating,
      reviewCount: r.review_count,
      approvalStatus: r.approval_status,
      photoUrl: r.photo_url,
      referenceName: r.reference_name,
      referencePhone: r.reference_phone
    } : null
  }
}

// ── Update Own Profile ─────────────────────────────────────────────────────────
async function updateMe(userId, data) {
  // Update users table fields
  const userColMap = {
    firstName:     'first_name',
    lastName:      'last_name',
    phone:         'phone',
    city:          'city',
    dateOfBirth:   'date_of_birth',
    gender:        'gender',
    photoUrl:      'photo_url',
    bio:           'bio',
    householdSize: 'household_size',
    childrenAges:  'children_ages',
    careNeeds:     'care_needs',
  }

  const userFields = []
  const userValues = []
  let userIdx = 1

  for (const [key, col] of Object.entries(userColMap)) {
    if (data[key] !== undefined) {
      userFields.push(`${col} = $${userIdx}`)
      userValues.push(data[key])
      userIdx++
    }
  }

  if (userFields.length > 0) {
    userValues.push(userId)
    await pool.query(
      `UPDATE users SET ${userFields.join(', ')}, updated_at = now() WHERE id = $${userIdx}`,
      userValues
    )
  }

  // Update providers table fields if user is a provider
  const providerColMap = {
    profession:     'profession',
    bio:            'bio',
    serviceRadius:  'service_radius',
    experience:     'experience',
    languages:      'languages',
    availableDays:  'available_days',
    certifications: 'certifications',
    photoUrl:       'photo_url',
  }

  const pFields = []
  const pValues = []
  let pIdx = 1

  const price = data.hourlyRate !== undefined ? data.hourlyRate : data.pricePerHour
  if (price !== undefined) {
    pFields.push(`price_per_hour = $${pIdx}`)
    pValues.push(typeof price === 'string' ? parseInt(price, 10) : price)
    pIdx++
  }

  if (data.experienceYears !== undefined) {
    pFields.push(`experience_yrs = $${pIdx}`)
    pValues.push(typeof data.experienceYears === 'string' ? parseInt(data.experienceYears, 10) : data.experienceYears)
    pIdx++
  }

  for (const [key, col] of Object.entries(providerColMap)) {
    if (data[key] !== undefined) {
      pFields.push(`${col} = $${pIdx}`)
      pValues.push(data[key])
      pIdx++
    }
  }

  if (pFields.length > 0) {
    pValues.push(userId)
    await pool.query(
      `UPDATE providers SET ${pFields.join(', ')}, updated_at = now() WHERE id = $${pIdx}`,
      pValues
    )
  }

  return await getMe(userId)
}

// ── Deactivate Own Account ─────────────────────────────────────────────────────
async function deactivateMe(userId) {
  await pool.query(
    `UPDATE users SET is_active = false, updated_at = now() WHERE id = $1`,
    [userId]
  )
  return { message: 'Account deactivated. Contact support to reactivate.' }
}

// ── List All Users (Admin) ─────────────────────────────────────────────────────
async function listAll({ role, city, search, limit = 50, offset = 0 } = {}) {
  const conditions = []
  const values = []
  let idx = 1

  if (role) {
    conditions.push(`u.role = $${idx}`)
    values.push(role)
    idx++
  }
  if (city) {
    conditions.push(`u.city ILIKE $${idx}`)
    values.push(`%${city}%`)
    idx++
  }
  if (search) {
    conditions.push(`(u.first_name ILIKE $${idx} OR u.last_name ILIKE $${idx} OR u.email ILIKE $${idx})`)
    values.push(`%${search}%`)
    idx++
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  values.push(Number(limit))
  values.push(Number(offset))

  const { rows } = await pool.query(
    `SELECT
       u.id, u.role, u.first_name, u.last_name, u.email, u.phone,
       u.city, u.is_active, u.is_verified, u.created_at
     FROM users u
     ${where}
     ORDER BY u.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    values
  )

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) FROM users u ${where}`,
    values.slice(0, -2)
  )

  return { users: rows, total: parseInt(countRows[0].count) }
}

// ── Change User Role (Admin) ───────────────────────────────────────────────────
async function changeRole(targetUserId, newRole, adminId) {
  if (targetUserId === adminId) {
    const err = new Error('You cannot change your own role.')
    err.status = 400
    throw err
  }

  const validRoles = ['client', 'provider', 'admin']
  if (!validRoles.includes(newRole)) {
    const err = new Error(`Invalid role. Must be one of: ${validRoles.join(', ')}`)
    err.status = 400
    throw err
  }

  const { rows } = await pool.query(
    `UPDATE users SET role = $1, updated_at = now()
     WHERE id = $2
     RETURNING id, role, first_name, last_name, email`,
    [newRole, targetUserId]
  )
  if (rows.length === 0) {
    const err = new Error('User not found.')
    err.status = 404
    throw err
  }
  return rows[0]
}

// ── List Available Contacts for Discussions (Clients & Providers) ─────────────
async function listContacts(currentUserId, { search, role, limit = 50, offset = 0 } = {}) {
  const conditions = ['u.id != $1', 'u.is_active = true']
  const values = [currentUserId]
  let idx = 2

  if (role && role !== 'all') {
    conditions.push(`u.role = $${idx}`)
    values.push(role)
    idx++
  }

  if (search && search.trim()) {
    const q = search.trim()
    conditions.push(`(
      u.first_name ILIKE $${idx} OR
      u.last_name ILIKE $${idx} OR
      (u.first_name || ' ' || u.last_name) ILIKE $${idx} OR
      u.email ILIKE $${idx} OR
      u.city ILIKE $${idx} OR
      p.profession ILIKE $${idx} OR
      p.location ILIKE $${idx} OR
      $${idx + 1} = ANY(p.specialties::text[])
    )`)
    values.push(`%${q}%`)
    values.push(q)
    idx += 2
  }

  const where = `WHERE ${conditions.join(' AND ')}`
  values.push(Number(limit))
  values.push(Number(offset))

  const query = `
    SELECT
      u.id,
      u.role,
      u.first_name,
      u.last_name,
      u.email,
      u.phone,
      u.city,
      COALESCE(p.photo_url, u.photo_url) AS photo_url,
      p.profession,
      p.specialties,
      p.location AS provider_location,
      p.price_per_hour,
      p.rating,
      p.review_count,
      p.is_available,
      p.approval_status
    FROM users u
    LEFT JOIN providers p ON p.id = u.id
    ${where}
    ORDER BY 
      CASE WHEN u.role = 'provider' THEN 0 ELSE 1 END,
      p.rating DESC NULLS LAST,
      u.first_name ASC
    LIMIT $${idx} OFFSET $${idx + 1}
  `

  const { rows } = await pool.query(query, values)

  return rows.map(r => {
    const fullName = `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Carely User'
    let specialtiesArr = []
    if (Array.isArray(r.specialties)) {
      specialtiesArr = r.specialties
    } else if (typeof r.specialties === 'string') {
      specialtiesArr = r.specialties.replace(/[{}"']/g, '').split(',').map(s => s.trim()).filter(Boolean)
    }
    const profession = r.profession || specialtiesArr[0] || (r.role === 'provider' ? 'Care Provider' : 'Household Client')
    const specialty = specialtiesArr[0] || r.profession || (r.role === 'provider' ? 'caregiving' : 'client')
    const initials = `${r.first_name?.[0] || 'U'}${r.last_name?.[0] || 'C'}`.toUpperCase()
    return {
      id: r.id,
      userId: r.id,
      name: fullName,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      phone: r.phone,
      role: r.role,
      profession,
      specialty,
      location: r.provider_location || r.city || 'Yaoundé',
      city: r.city,
      pricePerHour: r.price_per_hour || (r.role === 'provider' ? 50 : null),
      rating: r.rating ? Number(r.rating).toFixed(1) : '5.0',
      reviewCount: r.review_count || 0,
      photo: r.photo_url || null,
      initials,
      isAvailable: r.is_available !== false,
      approvalStatus: r.approval_status || null
    }
  })
}

module.exports = { getMe, updateMe, deactivateMe, listAll, changeRole, listContacts }

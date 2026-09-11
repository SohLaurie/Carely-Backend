const pool = require('../../config/db')

// ── List Providers (public, filterable) ───────────────────────────────────────
async function listProviders({ specialty, city, available, minRating, maxPrice, search, status, limit = 50, offset = 0 } = {}) {
  const conditions = []
  const values = []
  let idx = 1

  if (status && status !== 'all') {
    conditions.push(`p.approval_status = $${idx}`)
    values.push(status)
    idx++
    if (status === 'approved') {
      conditions.push(`p.subscription_paid = true`)
    }
  } else if (status !== 'all') {
    conditions.push(`p.approval_status = 'approved'`)
    conditions.push(`p.subscription_paid = true`)
  }

  if (specialty && specialty !== 'all') {
    conditions.push(`($${idx} = ANY(p.specialties::text[]) OR p.profession ILIKE $${idx + 1})`)
    values.push(specialty)
    values.push(`%${specialty}%`)
    idx += 2
  }
  if (city) {
    conditions.push(`(u.city ILIKE $${idx} OR p.location ILIKE $${idx} OR p.service_area ILIKE $${idx})`)
    values.push(`%${city}%`)
    idx++
  }
  if (available === 'true' || available === true) {
    conditions.push(`p.is_available = true`)
  }
  if (minRating) {
    conditions.push(`p.rating >= $${idx}`)
    values.push(Number(minRating))
    idx++
  }
  if (maxPrice) {
    conditions.push(`p.price_per_hour <= $${idx}`)
    values.push(Number(maxPrice))
    idx++
  }
  if (search) {
    conditions.push(`(u.first_name ILIKE $${idx} OR u.last_name ILIKE $${idx} OR p.bio ILIKE $${idx} OR u.city ILIKE $${idx} OR p.profession ILIKE $${idx} OR p.location ILIKE $${idx})`)
    values.push(`%${search}%`)
    idx++
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  values.push(Number(limit))
  values.push(Number(offset))

  const { rows } = await pool.query(
    `SELECT
       p.id, u.first_name, u.last_name, u.email, u.phone, u.city,
       COALESCE(p.photo_url, u.photo_url) AS photo_url,
       p.specialties, p.profession, p.bio, p.price_per_hour,
       p.location, p.service_area, p.service_radius,
       p.experience_yrs, p.experience, p.languages,
       p.certifications, p.is_available,
       p.rating, p.review_count, p.response_time,
       p.approval_status, p.subscription_paid, p.created_at
     FROM providers p
     JOIN users u ON u.id = p.id
     ${where}
     ORDER BY p.rating DESC, p.review_count DESC, p.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    values
  )

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) FROM providers p JOIN users u ON u.id = p.id ${where}`,
    values.slice(0, -2)
  )

  const formatted = rows.map(r => ({
    ...r,
    specialties: Array.isArray(r.specialties)
      ? r.specialties
      : (typeof r.specialties === 'string'
          ? r.specialties.replace(/[{}]/g, '').split(',').map(s => s.trim()).filter(Boolean)
          : []),
    languages: Array.isArray(r.languages)
      ? r.languages
      : (typeof r.languages === 'string'
          ? r.languages.replace(/[{}]/g, '').split(',').map(s => s.trim()).filter(Boolean)
          : [])
  }))

  return { providers: formatted, total: parseInt(countRows[0].count) }
}

// ── Get Single Provider (public, with reviews) ────────────────────────────────
async function getProvider(providerId) {
  const { rows } = await pool.query(
    `SELECT
       p.id, u.first_name, u.last_name, u.email, u.phone, u.city,
       COALESCE(p.photo_url, u.photo_url) AS photo_url,
       p.specialties, p.profession, p.bio, p.price_per_hour,
       p.location, p.service_area, p.service_radius,
       p.experience_yrs, p.experience, p.languages,
       p.certifications, p.is_available,
       p.rating, p.review_count, p.response_time,
       p.approval_status, p.subscription_paid, p.created_at
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

  const provider = rows[0]
  provider.specialties = Array.isArray(provider.specialties)
    ? provider.specialties
    : (typeof provider.specialties === 'string'
        ? provider.specialties.replace(/[{}]/g, '').split(',').map(s => s.trim()).filter(Boolean)
        : [])
  provider.languages = Array.isArray(provider.languages)
    ? provider.languages
    : (typeof provider.languages === 'string'
        ? provider.languages.replace(/[{}]/g, '').split(',').map(s => s.trim()).filter(Boolean)
        : [])

  // Attach reviews
  const { rows: reviews } = await pool.query(
    `SELECT
       r.id, r.rating, r.comment, r.tags, r.created_at,
       u.first_name AS reviewer_first_name, u.last_name AS reviewer_last_name
     FROM reviews r
     JOIN users u ON u.id = r.reviewer_id
     WHERE r.provider_id = $1
     ORDER BY r.created_at DESC`,
    [providerId]
  )
  provider.reviews = reviews

  return provider
}

// ── Get Own Provider Profile ───────────────────────────────────────────────────
async function getMyProviderProfile(userId) {
  const { rows } = await pool.query(
    `SELECT p.*, u.first_name, u.last_name, u.email, u.phone, u.city
     FROM providers p
     JOIN users u ON u.id = p.id
     WHERE p.id = $1`,
    [userId]
  )
  if (rows.length === 0) {
    const err = new Error('Provider profile not found. Have you completed provider registration?')
    err.status = 404
    throw err
  }
  return rows[0]
}

// ── Update Own Provider Profile ────────────────────────────────────────────────
async function updateMyProviderProfile(userId, data) {
  const colMap = {
    bio:           'bio',
    pricePerHour:  'price_per_hour',
    hourlyRate:    'price_per_hour',
    location:      'location',
    serviceArea:   'service_area',
    serviceRadius: 'service_radius',
    profession:    'profession',
    experience:    'experience',
    experienceYrs: 'experience_yrs',
    languages:     'languages',
    certifications:'certifications',
    photoUrl:      'photo_url',
    responseTime:  'response_time',
    specialties:   'specialties',
  }

  const fields = []
  const values = []
  let idx = 1

  for (const [key, col] of Object.entries(colMap)) {
    if (data[key] !== undefined) {
      // Cast specialties array to the enum type
      if (col === 'specialties') {
        fields.push(`${col} = $${idx}::specialty[]`)
      } else {
        fields.push(`${col} = $${idx}`)
      }
      values.push(data[key])
      idx++
    }
  }

  if (fields.length === 0) {
    const err = new Error('No updatable fields provided.')
    err.status = 400
    throw err
  }

  values.push(userId)
  const { rows } = await pool.query(
    `UPDATE providers SET ${fields.join(', ')}, updated_at = now()
     WHERE id = $${idx}
     RETURNING *`,
    values
  )
  return rows[0]
}

// ── Toggle Availability ────────────────────────────────────────────────────────
async function toggleAvailability(userId) {
  const { rows } = await pool.query(
    `UPDATE providers
     SET is_available = NOT is_available, updated_at = now()
     WHERE id = $1
     RETURNING id, is_available`,
    [userId]
  )
  if (rows.length === 0) {
    const err = new Error('Provider profile not found.')
    err.status = 404
    throw err
  }
  return {
    isAvailable: rows[0].is_available,
    message: rows[0].is_available
      ? 'You are now available for bookings.'
      : 'You are now offline. You will not receive new booking requests.',
  }
}

module.exports = {
  listProviders,
  getProvider,
  getMyProviderProfile,
  updateMyProviderProfile,
  toggleAvailability,
}

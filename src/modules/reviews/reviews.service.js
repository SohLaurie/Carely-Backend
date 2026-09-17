const pool = require('../../config/db')
const { createNotification } = require('../notifications/notifications.service')

// ── Submit Review ──────────────────────────────────────────────────────────────
async function submitReview(reviewerId, { bookingId, rating, comment, tags }) {
  // Verify booking exists and is completed
  const { rows: bookingRows } = await pool.query(
    `SELECT id, booker_id, provider_id, status FROM bookings WHERE id = $1`,
    [bookingId]
  )
  if (bookingRows.length === 0) {
    const err = new Error('Booking not found.')
    err.status = 404
    throw err
  }
  const booking = bookingRows[0]

  if (booking.booker_id !== reviewerId) {
    const err = new Error('Only the client who made the booking can submit a review.')
    err.status = 403
    throw err
  }
  if (booking.status !== 'completed') {
    const err = new Error('You can only review a completed booking.')
    err.status = 400
    throw err
  }

  // Check for duplicate review
  const { rows: existing } = await pool.query(
    `SELECT id FROM reviews WHERE booking_id = $1`,
    [bookingId]
  )
  if (existing.length > 0) {
    const err = new Error('You have already submitted a review for this booking.')
    err.status = 409
    throw err
  }

  const dbClient = await pool.connect()
  try {
    await dbClient.query('BEGIN')

    // Insert review
    const { rows: [review] } = await dbClient.query(
      `INSERT INTO reviews (booking_id, reviewer_id, provider_id, rating, comment, tags)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [bookingId, reviewerId, booking.provider_id, rating, comment || null, tags || null]
    )

    // Recalculate provider rating from all reviews
    await recalcProviderRating(dbClient, booking.provider_id)

    await dbClient.query('COMMIT')

    // Notify the provider about the new review
    const reviewerRow = await pool.query(
      `SELECT first_name, last_name FROM users WHERE id = $1`, [reviewerId]
    )
    const reviewerName = reviewerRow.rows[0]
      ? `${reviewerRow.rows[0].first_name} ${reviewerRow.rows[0].last_name}`.trim()
      : 'A client'
    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating)
    await createNotification(
      booking.provider_id,
      'new_review',
      `New ${rating}-star review`,
      `${reviewerName} left you a review: ${stars}${comment ? ` — "${comment.slice(0, 80)}${comment.length > 80 ? '…' : ''}"` : ''}`,
      { bookingId, reviewerId }
    )

    return review
  } catch (err) {
    await dbClient.query('ROLLBACK')
    throw err
  } finally {
    dbClient.release()
  }
}

// ── Recalculate Provider Rating ────────────────────────────────────────────────
// Called after every new review. Updates rating and review_count atomically.
async function recalcProviderRating(dbClient, providerId) {
  await dbClient.query(
    `UPDATE providers
     SET
       rating = (
         SELECT ROUND(AVG(rating)::numeric, 1)
         FROM reviews
         WHERE provider_id = $1
       ),
       review_count = (
         SELECT COUNT(*) FROM reviews WHERE provider_id = $1
       ),
       updated_at = now()
     WHERE id = $1`,
    [providerId]
  )
}

// ── Get Reviews for Provider ───────────────────────────────────────────────────
async function getProviderReviews(providerId, { limit = 20, offset = 0 } = {}) {
  // Verify provider exists
  const { rows: pRows } = await pool.query(
    `SELECT id, rating, review_count FROM providers WHERE id = $1`,
    [providerId]
  )
  if (pRows.length === 0) {
    const err = new Error('Provider not found.')
    err.status = 404
    throw err
  }

  const { rows: reviews } = await pool.query(
    `SELECT
       r.id, r.rating, r.comment, r.tags, r.created_at,
       u.first_name AS reviewer_first_name,
       u.last_name  AS reviewer_last_name
     FROM reviews r
     JOIN users u ON u.id = r.reviewer_id
     WHERE r.provider_id = $1
     ORDER BY r.created_at DESC
     LIMIT $2 OFFSET $3`,
    [providerId, Number(limit), Number(offset)]
  )

  return {
    providerId,
    averageRating: pRows[0].rating,
    totalReviews:  pRows[0].review_count,
    reviews,
  }
}

module.exports = { submitReview, getProviderReviews }

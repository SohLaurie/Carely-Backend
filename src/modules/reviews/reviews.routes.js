const { Router } = require('express')
const { z } = require('zod')
const auth = require('../../middleware/auth')
const validate = require('../../middleware/validate')
const ctrl = require('./reviews.controller')

const router = Router()

const submitReviewSchema = z.object({
  bookingId: z.string().uuid('Invalid booking ID'),
  rating:    z.number().int().min(1).max(5, 'Rating must be between 1 and 5'),
  comment:   z.string().max(1000).optional(),
  tags:      z.array(z.string()).max(10).optional(),
})

/**
 * POST /api/reviews
 * Submit a review. Only the booking's client can review, and only after completion.
 * Auto-recalculates the provider's average rating.
 */
router.post('/', auth, validate(submitReviewSchema), ctrl.submitReview)

/**
 * GET /api/reviews/provider/:id
 * Public: get all reviews for a provider with their average rating.
 * Query: ?limit=20&offset=0
 */
router.get('/provider/:id', ctrl.getProviderReviews)

module.exports = router

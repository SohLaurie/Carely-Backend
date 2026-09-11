const { Router } = require('express')
const auth = require('../../middleware/auth')
const requireRole = require('../../middleware/requireRole')
const ctrl = require('./providers.controller')

const router = Router()

/**
 * GET /api/providers
 * Public: list approved providers with optional filters.
 * Query: ?specialty=nursing&city=Yaounde&available=true&minRating=4&maxPrice=4000&search=Marie&limit=20&offset=0
 */
router.get('/', ctrl.listProviders)

/**
 * GET /api/providers/me
 * Provider: get their own full provider profile.
 * Must be placed BEFORE /:id to avoid 'me' being treated as a UUID.
 */
router.get('/me', auth, requireRole('provider'), ctrl.getMyProviderProfile)

/**
 * PATCH /api/providers/me
 * Provider: update their own provider profile fields.
 */
router.patch('/me', auth, requireRole('provider'), ctrl.updateMyProviderProfile)

/**
 * PATCH /api/providers/me/availability
 * Provider: toggle their availability on/off.
 */
router.patch('/me/availability', auth, requireRole('provider'), ctrl.toggleAvailability)

/**
 * GET /api/providers/me/subscription-status
 * Provider: check their approval and subscription payment status.
 */
router.get('/me/subscription-status', auth, requireRole('provider'), ctrl.getSubscriptionStatus)

/**
 * POST /api/providers/me/pay-subscription
 * Provider: initiate 25 XAF subscription payment via Campay.
 */
router.post('/me/pay-subscription', auth, requireRole('provider'), ctrl.paySubscription)

/**
 * GET /api/providers/:id
 * Public: get a single provider profile with their reviews.
 */
router.get('/:id', ctrl.getProvider)

module.exports = router

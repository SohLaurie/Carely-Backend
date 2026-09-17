const { Router } = require('express')
const auth = require('../../middleware/auth')
const ctrl = require('./carecredits.controller')

const router = Router()

// GET /api/carecredits/wallet  — wallet balance + stats + referral code
router.get('/wallet', auth, ctrl.getMyWallet)

// POST /api/carecredits/validate-promo  — validate a promo/referral code
router.post('/validate-promo', auth, ctrl.validatePromo)

// POST /api/carecredits/purchase  — initiate Campay payment to buy CC
router.post('/purchase', auth, ctrl.purchaseCredits)

// GET /api/carecredits/purchase/verify/:ref?pendingCredits=XX — verify and credit CC
router.get('/purchase/verify/:ref', auth, ctrl.verifyPurchase)

// POST /api/carecredits/withdraw  — withdraw CC to mobile money
router.post('/withdraw', auth, ctrl.withdrawCredits)

module.exports = router

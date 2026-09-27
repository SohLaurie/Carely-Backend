const express  = require('express')
const auth      = require('../../middleware/auth')
const ctrl      = require('./assistant.controller')

const router = express.Router()

// ── Public: one-off guest chat (no DB persistence, no auth) ──────────────────
router.post('/guest', ctrl.guestMessage)

// ── Authenticated routes (JWT required) ──────────────────────────────────────
router.use(auth)

// Conversations (supports both /conversations and root / for resilience)
router.post  (['/', '/conversations'],                           ctrl.createConversation)
router.get   (['/', '/conversations'],                           ctrl.listConversations)
router.get   (['/:id/messages', '/conversations/:id/messages'], ctrl.getMessages)
router.post  (['/:id/messages', '/conversations/:id/messages'], ctrl.sendMessage)
router.delete(['/:id', '/conversations/:id'],                   ctrl.deleteConversation)
router.patch (['/:id', '/conversations/:id'],                   ctrl.renameConversation)

module.exports = router


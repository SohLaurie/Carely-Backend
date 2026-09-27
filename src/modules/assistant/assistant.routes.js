const express  = require('express')
const auth      = require('../../middleware/auth')
const ctrl      = require('./assistant.controller')

const router = express.Router()

// ── Public: one-off guest chat (no DB persistence, no auth) ──────────────────
router.post('/guest', ctrl.guestMessage)

// ── Authenticated routes (JWT required) ──────────────────────────────────────
router.use(auth)

// Conversations
router.post  ('/',                  ctrl.createConversation)
router.get   ('/',                  ctrl.listConversations)
router.get   ('/:id/messages',      ctrl.getMessages)
router.post  ('/:id/messages',      ctrl.sendMessage)
router.delete('/:id',               ctrl.deleteConversation)
router.patch ('/:id',               ctrl.renameConversation)

module.exports = router


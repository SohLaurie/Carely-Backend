/**
 * Carely Assistant Controller
 * Thin HTTP handlers — all identity from req.user (JWT), never req.body.
 */

const svc = require('./assistant.service')

// POST /api/assistant/guest  (public — no auth)
async function guestMessage(req, res, next) {
  try {
    const { content, history = [] } = req.body
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required.' })
    }
    // Fetch active providers for real platform recommendations
    const activeProviders = await svc.fetchActiveProviders()
    const systemPrompt = svc.buildSystemPrompt({
      userId: null,
      role: 'guest',
      wallet: null,
      referralCode: null,
      recentBookings: [],
      providerProfile: null,
    }, activeProviders)

    // Re-use the internal Gemini call via service
    const reply = await svc.callGeminiPublic(systemPrompt, history, content.trim())
    res.json({ role: 'assistant', content: reply })
  } catch (err) {
    next(err)
  }
}

// POST /api/assistant/conversations
async function createConversation(req, res, next) {
  try {
    const { firstMessage } = req.body
    const convo = await svc.createConversation(req.user.id, firstMessage)
    res.status(201).json(convo)
  } catch (err) {
    next(err)
  }
}

// GET /api/assistant/conversations
async function listConversations(req, res, next) {
  try {
    const convos = await svc.listConversations(req.user.id)
    res.json(convos)
  } catch (err) {
    next(err)
  }
}

// GET /api/assistant/conversations/:id/messages
async function getMessages(req, res, next) {
  try {
    const messages = await svc.getMessages(req.params.id, req.user.id)
    res.json(messages)
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
}

// POST /api/assistant/conversations/:id/messages
async function sendMessage(req, res, next) {
  try {
    const { content } = req.body
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required.' })
    }
    const reply = await svc.sendMessage(
      req.params.id,
      req.user.id,
      req.user.role,
      content.trim()
    )
    res.status(201).json(reply)
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
}

// DELETE /api/assistant/conversations/:id
async function deleteConversation(req, res, next) {
  try {
    await svc.deleteConversation(req.params.id, req.user.id)
    res.status(204).end()
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
}

// PATCH /api/assistant/conversations/:id
async function renameConversation(req, res, next) {
  try {
    const { title } = req.body
    await svc.renameConversation(req.params.id, req.user.id, title)
    res.json({ success: true })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
}

module.exports = {
  guestMessage,
  createConversation,
  listConversations,
  getMessages,
  sendMessage,
  deleteConversation,
  renameConversation,
}

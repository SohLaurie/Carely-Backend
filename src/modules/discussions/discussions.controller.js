const discussionsService = require('./discussions.service');

async function list(req, res, next) {
  try {
    const conversations = await discussionsService.listConversations(req.user.id);
    res.json({ conversations });
  } catch (err) {
    next(err);
  }
}

async function getOrCreate(req, res, next) {
  try {
    const { recipientId, caregiverId, providerId, otherUserId } = req.body;
    const targetId = recipientId || caregiverId || providerId || otherUserId;
    if (!targetId) {
      return res.status(400).json({ error: 'recipientId is required' });
    }
    const conversation = await discussionsService.getOrCreateConversation(req.user.id, targetId);
    res.json({ conversation });
  } catch (err) {
    next(err);
  }
}

async function getMessages(req, res, next) {
  try {
    const messages = await discussionsService.getConversationMessages(req.params.id, req.user.id);
    res.json({ messages });
  } catch (err) {
    next(err);
  }
}

async function send(req, res, next) {
  try {
    const message = await discussionsService.sendMessage(req.params.id, req.user.id, req.body);
    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
}

async function markRead(req, res, next) {
  try {
    const result = await discussionsService.markConversationAsRead(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function removeMessage(req, res, next) {
  try {
    const result = await discussionsService.deleteMessage(req.params.messageId, req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function removeConversation(req, res, next) {
  try {
    const result = await discussionsService.deleteConversation(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function clearChat(req, res, next) {
  try {
    const result = await discussionsService.clearConversationChat(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  getOrCreate,
  getMessages,
  send,
  markRead,
  removeMessage,
  removeConversation,
  clearChat
};

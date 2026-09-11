const express = require('express');
const auth = require('../../middleware/auth');
const ctrl = require('./discussions.controller');

const router = express.Router();

router.use(auth);

router.get('/', ctrl.list);
router.post('/', ctrl.getOrCreate);
router.get('/:id/messages', ctrl.getMessages);
router.post('/:id/messages', ctrl.send);
router.patch('/:id/read', ctrl.markRead);
router.delete('/:id/messages/:messageId', ctrl.removeMessage);
router.delete('/:id/clear', ctrl.clearChat);
router.delete('/:id', ctrl.removeConversation);

module.exports = router;

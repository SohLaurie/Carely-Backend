const pool = require('../../config/db');

function formatTime(isoStr) {
  if (!isoStr) return '09:00';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(isoStr) {
  if (!isoStr) return 'Today';
  const d = new Date(isoStr);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function listConversations(userId) {
  const query = `
    SELECT 
      c.id,
      c.participant1_id,
      c.participant2_id,
      c.participant1_deleted_at,
      c.participant2_deleted_at,
      c.created_at,
      c.updated_at,
      CASE WHEN c.participant1_id = $1 THEN c.participant1_deleted_at ELSE c.participant2_deleted_at END AS user_deleted_at,
      CASE WHEN c.participant1_id = $1 THEN c.participant2_id ELSE c.participant1_id END AS other_user_id,
      u.first_name,
      u.last_name,
      u.email,
      u.role,
      u.photo_url,
      p.profession,
      p.specialties,
      p.is_available,
      p.location AS provider_location,
      (
        SELECT json_build_object(
          'id', m.id,
          'text', m.text,
          'senderId', m.sender_id,
          'status', m.status,
          'attachmentType', m.attachment_type,
          'attachmentName', m.attachment_name,
          'createdAt', m.created_at
        )
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.created_at > COALESCE(CASE WHEN c.participant1_id = $1 THEN c.participant1_deleted_at ELSE c.participant2_deleted_at END, '1970-01-01'::timestamptz)
        ORDER BY m.created_at DESC
        LIMIT 1
      ) AS last_message,
      (
        SELECT COUNT(*)::int
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.receiver_id = $1
          AND m.status != 'read'
          AND m.created_at > COALESCE(CASE WHEN c.participant1_id = $1 THEN c.participant1_deleted_at ELSE c.participant2_deleted_at END, '1970-01-01'::timestamptz)
      ) AS unread_count
    FROM conversations c
    JOIN users u ON u.id = (CASE WHEN c.participant1_id = $1 THEN c.participant2_id ELSE c.participant1_id END)
    LEFT JOIN providers p ON p.id = u.id
    WHERE (c.participant1_id = $1 OR c.participant2_id = $1)
      AND (
        (CASE WHEN c.participant1_id = $1 THEN c.participant1_deleted_at ELSE c.participant2_deleted_at END) IS NULL
        OR (
          SELECT MAX(m.created_at) 
          FROM messages m 
          WHERE m.conversation_id = c.id
        ) > (CASE WHEN c.participant1_id = $1 THEN c.participant1_deleted_at ELSE c.participant2_deleted_at END)
      )
    ORDER BY c.updated_at DESC;
  `;

  const { rows } = await pool.query(query, [userId]);

  return rows.map(r => {
    const fullName = `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Carely User';
    const initials = `${r.first_name?.[0] || 'C'}${r.last_name?.[0] || 'U'}`.toUpperCase();
    const profession = r.profession || (Array.isArray(r.specialties) ? r.specialties[0] : r.specialties) || (r.role === 'provider' ? 'Care Provider' : 'Household Client');
    const lastMsgObj = r.last_message;
    const lastText = lastMsgObj ? (lastMsgObj.text || lastMsgObj.attachmentName || (lastMsgObj.attachmentType === 'image' ? 'Photo' : 'Attachment')) : null;

    return {
      id: r.id,
      caregiverId: r.other_user_id,
      participantId: r.other_user_id,
      name: fullName,
      initials,
      role: r.role,
      specialty: profession,
      profession,
      photo: r.photo_url || null,
      status: r.is_available === false ? 'offline' : 'online',
      lastSeen: r.is_available === false ? 'Offline' : 'Online',
      unreadCount: r.unread_count || 0,
      updatedAt: r.updated_at,
      lastMessage: lastText,
      lastMessageTime: lastMsgObj?.createdAt || null,
      lastMessageStatus: lastMsgObj?.status || 'delivered',
      lastSenderId: lastMsgObj?.senderId || null,
      lastAttachmentType: lastMsgObj?.attachmentType || null,
      lastAttachmentName: lastMsgObj?.attachmentName || null,
      messages: []
    };
  });
}

async function getOrCreateConversation(userId, otherUserId) {
  if (userId === otherUserId) {
    const err = new Error('Cannot start conversation with yourself.');
    err.status = 400;
    throw err;
  }

  const { rows: userRows } = await pool.query('SELECT id, first_name, last_name, role, photo_url FROM users WHERE id = $1', [otherUserId]);
  if (userRows.length === 0) {
    const err = new Error('User not found.');
    err.status = 404;
    throw err;
  }

  const p1 = userId < otherUserId ? userId : otherUserId;
  const p2 = userId < otherUserId ? otherUserId : userId;

  const { rows: existing } = await pool.query(
    'SELECT * FROM conversations WHERE participant1_id = $1 AND participant2_id = $2',
    [p1, p2]
  );

  let conversation;
  if (existing.length > 0) {
    conversation = existing[0];
  } else {
    const { rows: created } = await pool.query(
      'INSERT INTO conversations (participant1_id, participant2_id) VALUES ($1, $2) RETURNING *',
      [p1, p2]
    );
    conversation = created[0];
  }

  const list = await listConversations(userId);
  const matched = list.find(c => c.id === conversation.id);
  return matched || { id: conversation.id, participantId: otherUserId };
}

async function getConversationMessages(conversationId, userId) {
  const { rows: convRows } = await pool.query(
    'SELECT * FROM conversations WHERE id = $1 AND (participant1_id = $2 OR participant2_id = $2)',
    [conversationId, userId]
  );
  if (convRows.length === 0) {
    const err = new Error('Conversation not found or access denied.');
    err.status = 404;
    throw err;
  }

  const conv = convRows[0];
  const userDeletedAt = conv.participant1_id === userId
    ? conv.participant1_deleted_at
    : conv.participant2_deleted_at;

  // Mark all unread messages received by this user as read (only messages visible to this user)
  await pool.query(
    `UPDATE messages 
     SET status = 'read', read_at = now() 
     WHERE conversation_id = $1 
       AND receiver_id = $2 
       AND status != 'read'
       AND created_at > COALESCE($3, '1970-01-01'::timestamptz)`,
    [conversationId, userId, userDeletedAt]
  );

  const { rows } = await pool.query(
    `SELECT * FROM messages 
     WHERE conversation_id = $1 
       AND created_at > COALESCE($2, '1970-01-01'::timestamptz)
     ORDER BY created_at ASC`,
    [conversationId, userDeletedAt]
  );

  return rows.map(m => ({
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    receiverId: m.receiver_id,
    sender: m.sender_id === userId ? 'user' : 'caregiver',
    text: m.text || '',
    attachment: m.attachment_url ? {
      url: m.attachment_url,
      name: m.attachment_name || 'attachment',
      type: m.attachment_type || 'document',
      size: m.attachment_size || 0,
      mime: m.attachment_mime || ''
    } : null,
    status: m.status || 'delivered',
    readAt: m.read_at,
    time: formatTime(m.created_at),
    date: formatDate(m.created_at),
    createdAt: m.created_at
  }));
}

async function sendMessage(conversationId, senderId, { text, attachmentUrl, attachmentName, attachmentType, attachmentSize, attachmentMime }) {
  const { rows: convRows } = await pool.query(
    'SELECT * FROM conversations WHERE id = $1 AND (participant1_id = $2 OR participant2_id = $2)',
    [conversationId, senderId]
  );
  if (convRows.length === 0) {
    const err = new Error('Conversation not found or access denied.');
    err.status = 404;
    throw err;
  }

  const conv = convRows[0];
  const receiverId = conv.participant1_id === senderId ? conv.participant2_id : conv.participant1_id;

  if (!text?.trim() && !attachmentUrl) {
    const err = new Error('Message text or attachment is required.');
    err.status = 400;
    throw err;
  }

  const { rows: [msg] } = await pool.query(
    `INSERT INTO messages 
       (conversation_id, sender_id, receiver_id, text, attachment_url, attachment_name, attachment_type, attachment_size, attachment_mime, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'delivered')
       RETURNING *`,
    [
      conversationId,
      senderId,
      receiverId,
      text?.trim() || '',
      attachmentUrl || null,
      attachmentName || null,
      attachmentType || null,
      attachmentSize || null,
      attachmentMime || null
    ]
  );

  // If sender previously deleted/cleared this conversation, reset their deletion timestamp
  const isP1 = conv.participant1_id === senderId;
  if (isP1 && conv.participant1_deleted_at) {
    await pool.query('UPDATE conversations SET participant1_deleted_at = NULL, updated_at = now() WHERE id = $1', [conversationId]);
  } else if (!isP1 && conv.participant2_deleted_at) {
    await pool.query('UPDATE conversations SET participant2_deleted_at = NULL, updated_at = now() WHERE id = $1', [conversationId]);
  } else {
    await pool.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId]);
  }

  return {
    id: msg.id,
    conversationId: msg.conversation_id,
    senderId: msg.sender_id,
    receiverId: msg.receiver_id,
    sender: 'user',
    text: msg.text || '',
    attachment: msg.attachment_url ? {
      url: msg.attachment_url,
      name: msg.attachment_name || 'attachment',
      type: msg.attachment_type || 'document',
      size: msg.attachment_size || 0,
      mime: msg.attachment_mime || ''
    } : null,
    status: msg.status,
    readAt: msg.read_at,
    time: formatTime(msg.created_at),
    date: formatDate(msg.created_at),
    createdAt: msg.created_at
  };
}

async function markConversationAsRead(conversationId, userId) {
  const result = await pool.query(
    "UPDATE messages SET status = 'read', read_at = now() WHERE conversation_id = $1 AND receiver_id = $2 AND status != 'read'",
    [conversationId, userId]
  );
  return { updated: result.rowCount };
}

async function deleteMessage(messageId, userId) {
  const { rows } = await pool.query('SELECT * FROM messages WHERE id = $1', [messageId]);
  if (rows.length === 0) {
    const err = new Error('Message not found.');
    err.status = 404;
    throw err;
  }
  const msg = rows[0];
  if (msg.sender_id !== userId && msg.receiver_id !== userId) {
    const err = new Error('Access denied.');
    err.status = 403;
    throw err;
  }
  await pool.query('DELETE FROM messages WHERE id = $1', [messageId]);
  return { message: 'Message deleted.' };
}

async function deleteConversation(conversationId, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM conversations WHERE id = $1 AND (participant1_id = $2 OR participant2_id = $2)',
    [conversationId, userId]
  );
  if (rows.length === 0) {
    const err = new Error('Conversation not found.');
    err.status = 404;
    throw err;
  }

  const conv = rows[0];
  const isP1 = conv.participant1_id === userId;

  // Check if the other party has already deleted the conversation
  const otherDeleted = isP1
    ? conv.participant2_deleted_at !== null
    : conv.participant1_deleted_at !== null;

  if (otherDeleted) {
    // Both parties have deleted -> permanently delete conversation and messages from DB
    await pool.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
    return { message: 'Conversation deleted permanently for both parties.' };
  } else {
    // Only this party deleted -> mark deletion timestamp on their side (preserves for other party)
    if (isP1) {
      await pool.query('UPDATE conversations SET participant1_deleted_at = now(), updated_at = now() WHERE id = $1', [conversationId]);
    } else {
      await pool.query('UPDATE conversations SET participant2_deleted_at = now(), updated_at = now() WHERE id = $1', [conversationId]);
    }
    return { message: 'Conversation deleted on your side.' };
  }
}

async function clearConversationChat(conversationId, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM conversations WHERE id = $1 AND (participant1_id = $2 OR participant2_id = $2)',
    [conversationId, userId]
  );
  if (rows.length === 0) {
    const err = new Error('Conversation not found.');
    err.status = 404;
    throw err;
  }

  const conv = rows[0];
  const isP1 = conv.participant1_id === userId;

  // Set this participant's deletion timestamp to now so past messages are cleared on their side
  if (isP1) {
    await pool.query('UPDATE conversations SET participant1_deleted_at = now(), updated_at = now() WHERE id = $1', [conversationId]);
  } else {
    await pool.query('UPDATE conversations SET participant2_deleted_at = now(), updated_at = now() WHERE id = $1', [conversationId]);
  }

  return { message: 'Chat history cleared on your side.' };
}

module.exports = {
  listConversations,
  getOrCreateConversation,
  getConversationMessages,
  sendMessage,
  markConversationAsRead,
  deleteMessage,
  deleteConversation,
  clearConversationChat
};

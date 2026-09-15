-- Migration 021: Add WhatsApp-style deletion tracking per participant
-- Allows one participant to delete or clear a conversation on their side
-- without deleting it for the other party. The conversation and its messages
-- are only removed from the database when BOTH parties delete it.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS participant1_deleted_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS participant2_deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_p1_deleted ON conversations(participant1_id, participant1_deleted_at);
CREATE INDEX IF NOT EXISTS idx_conversations_p2_deleted ON conversations(participant2_id, participant2_deleted_at);

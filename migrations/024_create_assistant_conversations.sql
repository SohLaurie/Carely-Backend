-- ── Migration 024: Carely Assistant Conversations & Messages ─────────────────
-- Creates two tables to persist AI chat history per user.

-- Conversations table (one row per chat session)
CREATE TABLE IF NOT EXISTS assistant_conversations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL DEFAULT 'New Chat',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_conversations_user_id
  ON assistant_conversations(user_id);

CREATE INDEX IF NOT EXISTS idx_assistant_conversations_updated_at
  ON assistant_conversations(updated_at DESC);

-- Messages table (all messages within a conversation)
CREATE TABLE IF NOT EXISTS assistant_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role            VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_messages_conversation_id
  ON assistant_messages(conversation_id);

-- Migration 017: Create conversations and messages tables
-- Supports real-time discussions between households and care providers
-- with text, image, and document attachments, and WhatsApp-style read receipts.

CREATE TABLE IF NOT EXISTS conversations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  participant1_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant2_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT check_distinct_participants CHECK (participant1_id <> participant2_id),
  CONSTRAINT unique_conversation_pair UNIQUE (participant1_id, participant2_id)
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'conversations_updated_at'
  ) THEN
    CREATE TRIGGER conversations_updated_at
      BEFORE UPDATE ON conversations
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS messages (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID         NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text            TEXT,
  attachment_url  TEXT,
  attachment_name TEXT,
  attachment_type VARCHAR(50),  -- 'image' | 'document' | NULL
  attachment_size INTEGER,      -- size in bytes
  attachment_mime VARCHAR(100),
  status          VARCHAR(20)  NOT NULL DEFAULT 'delivered', -- 'sent' | 'delivered' | 'read'
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  DEFAULT now()
);

-- Indexes for rapid retrieval
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_status ON messages(receiver_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_p1 ON conversations(participant1_id);
CREATE INDEX IF NOT EXISTS idx_conversations_p2 ON conversations(participant2_id);

-- Migration 018: Add Login Attempts & Account Lockout Policy

-- 1. System Settings Table
CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default lockout policy if not present
INSERT INTO system_settings (key, value)
VALUES (
  'lockout_policy',
  '{
    "logFailedAttempts": true,
    "notifyOnLockout": true,
    "maxFailedAttempts": 5,
    "lockDuration": 15,
    "lockoutPolicy": "Incremental Delay (5m, 15m, 1h)"
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- 2. Add lockout columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lockout_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMPTZ DEFAULT NULL;

-- 3. Login attempts / security audit log table
CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ip_address VARCHAR(100),
  user_agent TEXT,
  status VARCHAR(50) NOT NULL,
  failure_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email);
CREATE INDEX IF NOT EXISTS idx_login_attempts_created_at ON login_attempts(created_at DESC);

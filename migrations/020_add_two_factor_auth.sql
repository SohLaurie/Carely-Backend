-- Migration 020: Add Two-Factor Authentication (2FA) support

-- 1. Add 2FA columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_code VARCHAR(10);
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_expires_at TIMESTAMPTZ;

-- 2. Seed default two_factor_policy in system_settings if not already present
INSERT INTO system_settings (key, value)
VALUES (
  'two_factor_policy',
  '{
    "master2FA": false,
    "mandatoryProvider2FA": false
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

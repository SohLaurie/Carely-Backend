-- Migration 019: Add reset_password_code to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reset_password_code VARCHAR(10);

CREATE INDEX IF NOT EXISTS idx_users_reset_password_code
  ON users(reset_password_code);

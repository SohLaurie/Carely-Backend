-- Migration 012: Add photo_url to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

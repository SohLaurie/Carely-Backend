-- Migration 013: Add profession column to providers table
ALTER TABLE providers ADD COLUMN IF NOT EXISTS profession VARCHAR(150);

-- Backfill existing providers without a profession
UPDATE providers
SET profession = 'Cleaner'
WHERE profession IS NULL;

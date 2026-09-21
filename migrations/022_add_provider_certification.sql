-- Migration 022: Add provider certification columns for Two-Tier Trust Model
ALTER TABLE providers ADD COLUMN IF NOT EXISTS certification_status VARCHAR(20) DEFAULT 'none';
ALTER TABLE providers ADD COLUMN IF NOT EXISTS is_certified BOOLEAN DEFAULT false;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS certification_paid BOOLEAN DEFAULT false;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS certification_campay_ref VARCHAR(100);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS certification_document_url VARCHAR(500);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS certification_document_name VARCHAR(255);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS certification_institution VARCHAR(255);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS certification_title VARCHAR(255);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS certification_notes TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS certification_applied_at TIMESTAMPTZ;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS certification_reviewed_at TIMESTAMPTZ;
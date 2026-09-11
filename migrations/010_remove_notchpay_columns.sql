-- Migration 010: Remove Notch Pay columns from payments table
-- Focus payments strictly on Campay integration

DROP INDEX IF EXISTS idx_payments_notchpay_ref;

ALTER TABLE payments
  DROP COLUMN IF EXISTS notchpay_ref,
  DROP COLUMN IF EXISTS notchpay_auth_url;

-- Ensure index on campay_ref
CREATE INDEX IF NOT EXISTS idx_payments_campay_ref
  ON payments(campay_ref);

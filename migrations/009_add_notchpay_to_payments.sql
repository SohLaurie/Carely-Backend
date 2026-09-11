-- Migration 009: Add Notch Pay columns to payments table

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS notchpay_ref VARCHAR(100),
  ADD COLUMN IF NOT EXISTS notchpay_auth_url TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_notchpay_ref
  ON payments(notchpay_ref);

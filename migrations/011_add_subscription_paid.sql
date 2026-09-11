-- Migration 011: Add subscription_paid flag to providers
-- Tracks whether an approved provider has paid their 25 XAF activation subscription

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS subscription_paid BOOLEAN NOT NULL DEFAULT false;

-- Index for quick lookup of approved-but-unpaid providers
CREATE INDEX IF NOT EXISTS idx_providers_subscription_paid
  ON providers (subscription_paid)
  WHERE subscription_paid = false;

-- Also add a campay_subscription_ref to track the subscription payment transaction
ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS subscription_campay_ref VARCHAR(100);

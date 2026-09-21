-- Migration 023: Add INTERRUPTED session support for partial payment logic
-- Adds the INTERRUPTED status to the session_status enum and supporting columns.

-- 1. Add INTERRUPTED to the session status enum
ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'INTERRUPTED';

-- 2. Add interruption tracking columns to sessions table
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS interrupted_at      TIMESTAMPTZ,  -- when provider flagged the emergency
  ADD COLUMN IF NOT EXISTS interruption_reason TEXT,         -- optional reason text from provider
  ADD COLUMN IF NOT EXISTS partial_amount      INTEGER;      -- XAF amount owed to provider for hours worked

-- 3. Add partial payout audit columns to payments table
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS partial_provider_amount  INTEGER,  -- XAF disbursed to provider
  ADD COLUMN IF NOT EXISTS partial_refund_amount    INTEGER;  -- XAF refunded to household

-- Migration 005: Create payments table
-- Tracks Campay (MTN/Orange) escrow payments for bookings.

CREATE TYPE payment_status AS ENUM (
  'pending',
  'held_in_escrow',
  'released',
  'refunded',
  'failed'
);

CREATE TABLE IF NOT EXISTS payments (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID            NOT NULL REFERENCES bookings(id),
  amount          INTEGER         NOT NULL,   -- XAF
  currency        VARCHAR(5)      DEFAULT 'XAF',
  provider_name   VARCHAR(30),               -- 'mtn' | 'orange'
  phone_number    VARCHAR(30),
  campay_ref      VARCHAR(100),              -- Campay external transaction reference
  status          payment_status  DEFAULT 'pending',
  escrow_released BOOLEAN         DEFAULT false,
  released_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ     DEFAULT now(),
  updated_at      TIMESTAMPTZ     DEFAULT now()
);

CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

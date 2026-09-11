-- Migration 003: Create bookings table
-- A booking is made BY any user (client or provider acting as client)
-- and directed AT a provider.

CREATE TYPE booking_type AS ENUM ('once', 'recurring');

CREATE TYPE booking_status AS ENUM (
  'pending',
  'accepted',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'disputed'
);

CREATE TABLE IF NOT EXISTS bookings (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The person making the booking (client or provider-as-client)
  booker_id       UUID            NOT NULL REFERENCES users(id),
  -- The provider being booked (cannot be the same as booker)
  provider_id     UUID            NOT NULL REFERENCES providers(id),
  session_type    booking_type    NOT NULL,
  start_date      DATE            NOT NULL,
  start_time      TIME            NOT NULL,
  end_time        TIME            NOT NULL,
  duration_weeks  SMALLINT        DEFAULT 1,
  selected_days   SMALLINT[],                 -- 0=Mon … 6=Sun
  notes           TEXT,
  subtotal        INTEGER         NOT NULL,   -- XAF
  service_fee     INTEGER         DEFAULT 500,
  total_price     INTEGER         NOT NULL,
  status          booking_status  DEFAULT 'pending',
  arrival_otp     VARCHAR(6),
  payment_status  VARCHAR(50)     DEFAULT 'unpaid',
  created_at      TIMESTAMPTZ     DEFAULT now(),
  updated_at      TIMESTAMPTZ     DEFAULT now(),

  -- A user cannot book themselves
  CONSTRAINT no_self_booking CHECK (booker_id != provider_id)
);

CREATE TRIGGER bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

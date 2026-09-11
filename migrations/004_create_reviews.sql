-- Migration 004: Create reviews table
-- A review can only be submitted once per completed booking.

CREATE TABLE IF NOT EXISTS reviews (
  id           UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   UUID      UNIQUE NOT NULL REFERENCES bookings(id),
  reviewer_id  UUID      NOT NULL REFERENCES users(id),
  provider_id  UUID      NOT NULL REFERENCES providers(id),
  rating       SMALLINT  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      TEXT,
  tags         TEXT[],   -- e.g. ['Punctual', 'Professional', 'Gentle with my parent']
  created_at   TIMESTAMPTZ DEFAULT now()
);

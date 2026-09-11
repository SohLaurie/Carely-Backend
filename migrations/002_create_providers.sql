-- Migration 002: Create providers table
-- Extends users (1-to-1). Created when a client upgrades to a provider account.

CREATE TYPE specialty AS ENUM (
  'nursing',
  'babysitting',
  'cleaning',
  'indoor_cleaning',
  'fridge_cleaning',
  'outdoor_cleaning',
  'gardening',
  'pet_care',
  'elderly_care',
  'laundry_ironing',
  'cooking'
);

CREATE TABLE IF NOT EXISTS providers (
  -- Same UUID as users.id (1-to-1 extension via FK)
  id              UUID          PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  specialties     specialty[]   NOT NULL,
  bio             TEXT,
  price_per_hour  INTEGER       NOT NULL,    -- in XAF
  location        VARCHAR(200),
  service_area    VARCHAR(200),
  experience_yrs  SMALLINT,
  languages       TEXT[],
  certifications  TEXT[],
  photo_url       TEXT,
  is_available    BOOLEAN       DEFAULT true,
  -- Aggregated from reviews (recalculated on each new review)
  rating          NUMERIC(2,1)  DEFAULT 0.0,
  review_count    INTEGER       DEFAULT 0,
  response_time   VARCHAR(20),
  -- Admin must approve before provider goes live
  approval_status VARCHAR(20)   DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  created_at      TIMESTAMPTZ   DEFAULT now(),
  updated_at      TIMESTAMPTZ   DEFAULT now()
);

CREATE TRIGGER providers_updated_at
  BEFORE UPDATE ON providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

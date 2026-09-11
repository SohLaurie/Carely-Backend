-- Migration 001: Create users table
-- Every person on the platform has one users record.
-- Role starts as 'client'; upgrading to provider changes it to 'provider'.

CREATE TYPE user_role AS ENUM ('client', 'provider', 'admin');

CREATE TABLE IF NOT EXISTS users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  role            user_role   NOT NULL DEFAULT 'client',
  first_name      VARCHAR(100) NOT NULL,
  last_name       VARCHAR(100) NOT NULL,
  email           VARCHAR(255) UNIQUE NOT NULL,
  phone           VARCHAR(30)  NOT NULL,
  password_hash   TEXT         NOT NULL,
  city            VARCHAR(100),
  -- Client profile extras (from household registration form)
  household_size  SMALLINT,
  children_ages   SMALLINT[],
  care_needs      TEXT[],
  -- Flags
  is_active       BOOLEAN     DEFAULT true,
  is_verified     BOOLEAN     DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Auto-update updated_at on every row update
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

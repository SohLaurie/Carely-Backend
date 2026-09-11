-- Migration 006: Sessions table + bookings table patch
-- Removes arrival_otp from bookings (moved to per-session OTP)
-- Adds total_sessions to bookings
-- Creates the sessions table

-- ── Patch bookings table ────────────────────────────────────────────────────────
ALTER TABLE bookings
  DROP COLUMN IF EXISTS arrival_otp,
  ADD COLUMN IF NOT EXISTS total_sessions INTEGER DEFAULT 1;

-- ── Session status enum ─────────────────────────────────────────────────────────
CREATE TYPE session_status AS ENUM (
  'SCHEDULED',
  'ARRIVED',
  'AWAITING_CONFIRMATION',
  'COMPLETED',
  'DISPUTED',
  'MISSED',
  'SKIPPED'
);

-- ── Sessions table ──────────────────────────────────────────────────────────────
-- Each row represents one working day within a booking.
-- OTP is unique per session: provider enters it on arrival to start the session.

CREATE TABLE IF NOT EXISTS sessions (
  id                    UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            UUID           NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  session_number        SMALLINT       NOT NULL,          -- 1, 2, 3 … N (order within booking)
  week_number           SMALLINT,                         -- which week (recurring only, NULL for once)

  -- Schedule
  scheduled_date        DATE           NOT NULL,
  scheduled_start_time  TIME           NOT NULL,
  scheduled_end_time    TIME           NOT NULL,

  -- Pricing slice for this session
  session_amount        INTEGER        NOT NULL,          -- XAF — provider earns this on completion

  -- OTP (generated at session creation, shown to client after payment confirmed)
  otp_code              VARCHAR(6)     NOT NULL,
  otp_verified_at       TIMESTAMPTZ,                      -- set when provider enters correct OTP

  -- Completion
  completion_marked_at  TIMESTAMPTZ,                      -- when session ended (manually or auto)
  -- deadline: otp_verified_at + 24h → auto-release trigger for escrow
  confirmation_deadline TIMESTAMPTZ,

  -- Status
  status                session_status DEFAULT 'SCHEDULED',

  -- Dispute
  dispute_reason        TEXT,
  disputed_by           UUID           REFERENCES users(id),
  disputed_at           TIMESTAMPTZ,

  created_at            TIMESTAMPTZ    DEFAULT now(),
  updated_at            TIMESTAMPTZ    DEFAULT now(),

  -- A session number must be unique within a booking
  UNIQUE (booking_id, session_number)
);

CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Migration 007: Provider Availability & Calendar System

-- ── 1. Recurring Weekly Schedule ───────────────────────────────────────────────
-- Defines regular working hours for each day of the week (0 = Mon, 6 = Sun).
CREATE TABLE IF NOT EXISTS provider_schedules (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  UUID        NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  day_of_week  SMALLINT    NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time   TIME        NOT NULL,
  end_time     TIME        NOT NULL,
  is_active    BOOLEAN     DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),

  UNIQUE (provider_id, day_of_week, start_time, end_time),
  CONSTRAINT valid_schedule_time_range CHECK (start_time < end_time)
);

CREATE TRIGGER provider_schedules_updated_at
  BEFORE UPDATE ON provider_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 2. Blocked Slots / Time Off ───────────────────────────────────────────────
-- Ad-hoc dates or time ranges where the provider is unavailable (holidays, personal, etc.).
CREATE TABLE IF NOT EXISTS provider_blocked_slots (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  UUID         NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  start_date   DATE         NOT NULL,
  end_date     DATE         NOT NULL,
  start_time   TIME,                                          -- NULL = entire day blocked
  end_time     TIME,                                          -- NULL = entire day blocked
  reason       VARCHAR(255),
  created_at   TIMESTAMPTZ  DEFAULT now(),

  CONSTRAINT valid_blocked_date_range CHECK (start_date <= end_date),
  CONSTRAINT valid_blocked_time_range CHECK (
    (start_time IS NULL AND end_time IS NULL) OR
    (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  )
);

CREATE INDEX IF NOT EXISTS idx_provider_schedules_provider
  ON provider_schedules(provider_id, day_of_week);

CREATE INDEX IF NOT EXISTS idx_provider_blocked_slots_provider
  ON provider_blocked_slots(provider_id, start_date, end_date);

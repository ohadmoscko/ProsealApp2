-- [Req #138] Vacation mode — freeze alerts and defer tasks during holidays
-- Adds vacation_mode flag to profiles table for per-user quiet mode

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS vacation_mode BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vacation_until TIMESTAMPTZ;

-- [Req #138] When vacation_mode is true, the frontend will:
-- 1. Suppress all escalation alerts and copilot nudges
-- 2. Move pending follow-ups to a "quiet drawer"
-- 3. Show a vacation banner in the dashboard

COMMENT ON COLUMN profiles.vacation_mode IS '[Req #138] Industrial quiet mode — pauses alerts during holidays';
COMMENT ON COLUMN profiles.vacation_until IS '[Req #138] Optional end date for auto-disabling vacation mode';

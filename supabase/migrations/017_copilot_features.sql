-- ============================================================
--  PROSEAL BRAIN — Migration 017: Copilot Features
--  Adds: strategic_rank, defer_reason_category, queued release,
--        auto-temperature SQL function, AI summary cache.
-- ============================================================

-- 1. Defer reason category enum
DO $$ BEGIN
  CREATE TYPE defer_reason_category AS ENUM (
    'client_abroad',       -- הלקוח בחו"ל
    'awaiting_technical',  -- ממתין לאישור טכני
    'price_objection',     -- יקר לו
    'busy_period',         -- תקופה עמוסה
    'other'                -- אחר
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Strategic rank on quotes (1=critical, 2=important, 3=routine, NULL=unranked)
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS strategic_rank smallint
    CHECK (strategic_rank IS NULL OR (strategic_rank >= 1 AND strategic_rank <= 3));

COMMENT ON COLUMN quotes.strategic_rank IS '1=critical deal, 2=important, 3=routine. Replaces financial amounts in CEO view.';

-- 3. Defer reason category on interactions
ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS defer_category defer_reason_category;

-- 4. Queued Release fields on interactions (weekend notes → released Sunday 08:00)
ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS release_status text DEFAULT 'immediate'
    CHECK (release_status IN ('immediate', 'pending', 'released')),
  ADD COLUMN IF NOT EXISTS release_at timestamptz;

-- 5. AI one-liner summary cache on quotes (for AI Intern accordion)
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS ai_summary_at timestamptz;

-- 6. Auto-temperature function: computes score based on (days since contact) x (status weight)
CREATE OR REPLACE FUNCTION compute_auto_temperature(
  p_days_since_contact integer,
  p_status quote_status,
  p_manual_temp integer
) RETURNS integer
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  staleness_factor numeric;
  status_weight numeric;
  auto_score numeric;
BEGIN
  -- Staleness factor (higher = colder)
  IF p_days_since_contact IS NULL OR p_days_since_contact <= 2 THEN
    staleness_factor := 0;
  ELSIF p_days_since_contact <= 4 THEN
    staleness_factor := 1;
  ELSIF p_days_since_contact <= 7 THEN
    staleness_factor := 2;
  ELSIF p_days_since_contact <= 14 THEN
    staleness_factor := 3;
  ELSE
    staleness_factor := 4;
  END IF;

  -- Status weight (how urgently it needs attention)
  CASE p_status
    WHEN 'follow_up' THEN status_weight := 1.5;
    WHEN 'open'      THEN status_weight := 1.2;
    WHEN 'new'       THEN status_weight := 1.0;
    WHEN 'waiting'   THEN status_weight := 0.6;
    ELSE                   status_weight := 0.3;
  END CASE;

  -- Auto score: start from manual, decay by staleness, boost by status
  auto_score := GREATEST(1, p_manual_temp - staleness_factor) * status_weight;

  -- Clamp to 1-5
  RETURN LEAST(5, GREATEST(1, ROUND(auto_score)));
END;
$$;

-- 7. Update the triage view with strategic_rank and auto_temperature
DROP VIEW IF EXISTS quotes_with_triage;
CREATE OR REPLACE VIEW quotes_with_triage AS
SELECT
  q.*,
  compute_auto_temperature(
    q.days_since_contact::integer,
    q.status,
    q.temperature
  ) AS auto_temperature,
  CASE
    WHEN q.days_since_contact IS NULL OR q.days_since_contact <= 3 THEN q.temperature
    WHEN q.days_since_contact >= 14 THEN GREATEST(1, q.temperature - 3)
    WHEN q.days_since_contact >= 7  THEN GREATEST(1, q.temperature - 2)
    WHEN q.days_since_contact >= 4  THEN GREATEST(1, q.temperature - 1)
    ELSE q.temperature
  END AS effective_temperature,
  CASE
    WHEN q.days_since_contact >= 14 THEN 'critical'
    WHEN q.days_since_contact >= 7  THEN 'stale'
    WHEN q.days_since_contact >= 4  THEN 'cooling'
    ELSE 'fresh'
  END AS staleness
FROM quotes q;

-- 8. Index for queued release queries
CREATE INDEX IF NOT EXISTS idx_interactions_release
  ON interactions (release_status, release_at)
  WHERE release_status = 'pending';

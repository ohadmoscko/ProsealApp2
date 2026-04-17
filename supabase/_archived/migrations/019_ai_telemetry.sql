-- ============================================================
--  PROSEAL BRAIN — Migration 019: AI Training Telemetry
--
--  Tracks CEO behavior in the AI accordion (expand, collapse,
--  pin, refresh, drill-down) for future model tuning.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_training_telemetry (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    UUID NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
  user_id     UUID REFERENCES profiles(id),
  action_type TEXT NOT NULL CHECK (action_type IN (
    'expand',       -- CEO expanded accordion row
    'collapse',     -- CEO collapsed accordion row
    'pin',          -- CEO pinned a quote
    'unpin',        -- CEO unpinned a quote
    'refresh',      -- CEO requested AI summary refresh
    'drill_down'    -- CEO clicked "open full quote" from accordion
  )),
  metadata    JSONB DEFAULT '{}'::jsonb,   -- extra context (e.g., temperature at time of action)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Minimal RLS: logged-in users can insert, admin can read all
ALTER TABLE ai_training_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can log telemetry" ON ai_training_telemetry
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admin can read telemetry" ON ai_training_telemetry
  FOR SELECT USING (is_admin());

CREATE INDEX IF NOT EXISTS idx_telemetry_quote ON ai_training_telemetry (quote_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_time  ON ai_training_telemetry (created_at DESC);

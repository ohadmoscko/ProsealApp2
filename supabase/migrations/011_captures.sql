-- ============================================================
--  PROSEAL BRAIN — Migration 011: Captures & Saved Filters
--  AI-assisted quick capture system
-- ============================================================

CREATE TYPE capture_status AS ENUM (
  'pending', 'processed', 'in_report', 'dismissed'
);

-- ============================================================
--  CAPTURES — AI-assisted quick capture (for report + quotes)
-- ============================================================
CREATE TABLE captures (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text              TEXT NOT NULL,                               -- what user typed
  ai_parsed             JSONB,                                      -- AI interpretation
  ai_response           TEXT,                                       -- AI reply text
  linked_quote_id       UUID REFERENCES quotes(id) ON DELETE SET NULL,
  linked_report_week_id UUID REFERENCES weeks(id) ON DELETE SET NULL,
  status                capture_status NOT NULL DEFAULT 'pending',
  created_by            UUID REFERENCES profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_captures_status ON captures (status);
CREATE INDEX idx_captures_week ON captures (linked_report_week_id) WHERE linked_report_week_id IS NOT NULL;
CREATE INDEX idx_captures_quote ON captures (linked_quote_id) WHERE linked_quote_id IS NOT NULL;
CREATE INDEX idx_captures_time ON captures (created_at DESC);

-- ============================================================
--  SAVED FILTERS — user-saved filter presets
-- ============================================================
CREATE TABLE saved_filters (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  filter_config JSONB NOT NULL,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  position      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_filters_user ON saved_filters (user_id, position);

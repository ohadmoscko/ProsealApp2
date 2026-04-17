-- ============================================================
--  PROSEAL BRAIN — Migration 013: Interaction Outcome + Client VIP
-- ============================================================

-- Outcome of a call/contact attempt
CREATE TYPE interaction_outcome AS ENUM (
  'reached',       -- שוחחנו
  'no_answer',     -- לא ענה
  'unavailable'    -- לא זמין
);

ALTER TABLE interactions ADD COLUMN IF NOT EXISTS outcome interaction_outcome;

-- Index for grouping consecutive failed attempts per quote
CREATE INDEX idx_interactions_outcome ON interactions (quote_id, created_at DESC)
  WHERE outcome IN ('no_answer', 'unavailable');

-- VIP/Strategic flag on clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_vip BOOLEAN NOT NULL DEFAULT false;

-- Track who set VIP and when (for audit trail)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS vip_set_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS vip_set_by UUID REFERENCES profiles(id);

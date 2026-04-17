-- ============================================================
--  PROSEAL BRAIN — Migration 021: Schema Extensions
--  Sprint 1 — Database foundation for all remaining requirements.
--
--  New enum values, new columns on clients/quotes/interactions,
--  updated triage view, and RPC helpers.
-- ============================================================

-- ============================================================
--  1. EXTEND quote_status ENUM
--  [Req #157] - Shipping managed as status
--  [Req #222] - "Approved verbally" status
--  [Req #240] - "Ongoing projects" status
-- ============================================================

ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'verbal_approval';  -- [Req #222]
ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'in_production';    -- [Req #240]
ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'shipped';          -- [Req #157]

-- ============================================================
--  2. NEW COLUMNS ON clients
--  [Req #101] - Customer style/tenure
--  [Req #104] - Graduated relationship strength (not binary)
--  [Req #105] - Preferred communication channel
--  [Req #170] - Manual "new customer" flag
-- ============================================================

-- [Req #105] - Preferred channel: WhatsApp or Email
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS preferred_channel TEXT DEFAULT 'whatsapp'
    CHECK (preferred_channel IN ('whatsapp', 'email', 'phone'));

-- [Req #101] - Customer style (veteran, recurring, new, one-time)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS customer_style TEXT DEFAULT 'new'
    CHECK (customer_style IN ('new', 'recurring', 'veteran', 'one_time'));

-- [Req #104] - Relationship strength (0-100 continuous score, not binary)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS relationship_strength INT DEFAULT 0
    CHECK (relationship_strength BETWEEN 0 AND 100);

-- [Req #170] - Manual "new customer" flag (manually set after relationship solidifies)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS is_new_customer BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN clients.preferred_channel IS '[Req #105] WhatsApp/email/phone marking';
COMMENT ON COLUMN clients.customer_style IS '[Req #101] veteran/recurring/new/one_time';
COMMENT ON COLUMN clients.relationship_strength IS '[Req #104] 0-100 graduated relationship score';
COMMENT ON COLUMN clients.is_new_customer IS '[Req #170] Manually set to false after relationship established';

-- ============================================================
--  3. NEW COLUMNS ON quotes
--  [Req #146] - Case ownership field
--  [Req #268] - Manual temperature override flag
--  [Req #121] - Win documentation (close_reason for won quotes)
-- ============================================================

-- [Req #146] - Owner/handler for future multi-user
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES profiles(id);

-- [Req #268] - Manual temperature override: when set, auto-decay is suppressed
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS temp_override BOOLEAN NOT NULL DEFAULT false;

-- [Req #121] - Win reason (mandatory documentation when status=won)
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS win_reason TEXT;

COMMENT ON COLUMN quotes.owner_id IS '[Req #146] Case owner for future multi-user expansion';
COMMENT ON COLUMN quotes.temp_override IS '[Req #268] When true, manual temp supersedes auto-decay';
COMMENT ON COLUMN quotes.win_reason IS '[Req #121] Mandatory close documentation on won deals';

-- ============================================================
--  4. NEW COLUMNS ON interactions
--  [Req #178] - Push vs Pull direction (team-initiated vs client-initiated)
--  [Req #239] - Micro-text memory anchor
--  [Req #112] - Milestone flag for highlighted timeline events
-- ============================================================

-- [Req #178] - Direction: did we reach out (push) or did the client call us (pull)?
ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'push'
    CHECK (direction IN ('push', 'pull'));

-- [Req #239] - Micro-text: 1-2 keyword memory anchor (not full notes)
ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS micro_text TEXT CHECK (char_length(micro_text) <= 60);

-- [Req #112] - Milestone flag: highlighted events in timeline (e.g., "new version sent")
ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS is_milestone BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN interactions.direction IS '[Req #178] push=we initiated, pull=client initiated';
COMMENT ON COLUMN interactions.micro_text IS '[Req #239] 1-2 keyword memory anchor';
COMMENT ON COLUMN interactions.is_milestone IS '[Req #112] Highlighted events in the timeline';

-- ============================================================
--  5. UPDATE TRIAGE VIEW
--  [Req #268] - Respect temp_override flag
--  [Req #118] - Add visual aging indicator fields
--  [Req #275] - Opacity/fade based on staleness for UI
-- ============================================================

DROP VIEW IF EXISTS quotes_with_triage;
CREATE OR REPLACE VIEW quotes_with_triage AS
SELECT
  q.*,
  -- [Req #268] - If temp_override is true, use manual temp directly
  CASE
    WHEN q.temp_override THEN q.temperature
    ELSE compute_auto_temperature(
      q.days_since_contact::integer,
      q.status,
      q.temperature
    )
  END AS auto_temperature,
  -- Effective temperature (legacy compatibility)
  CASE
    WHEN q.temp_override THEN q.temperature
    WHEN q.days_since_contact IS NULL OR q.days_since_contact <= 3 THEN q.temperature
    WHEN q.days_since_contact >= 14 THEN GREATEST(1, q.temperature - 3)
    WHEN q.days_since_contact >= 7  THEN GREATEST(1, q.temperature - 2)
    WHEN q.days_since_contact >= 4  THEN GREATEST(1, q.temperature - 1)
    ELSE q.temperature
  END AS effective_temperature,
  -- [Req #118] - Staleness classification
  CASE
    WHEN q.days_since_contact >= 14 THEN 'critical'
    WHEN q.days_since_contact >= 7  THEN 'stale'
    WHEN q.days_since_contact >= 4  THEN 'cooling'
    ELSE 'fresh'
  END AS staleness,
  -- [Req #275] - Opacity level for UI visual degradation (1.0 = full, 0.4 = faded)
  CASE
    WHEN q.days_since_contact IS NULL OR q.days_since_contact <= 7 THEN 1.0
    WHEN q.days_since_contact <= 14 THEN 0.85
    WHEN q.days_since_contact <= 30 THEN 0.65
    WHEN q.days_since_contact <= 60 THEN 0.5
    ELSE 0.4
  END::NUMERIC AS ui_opacity,
  -- [Req #161] - Waiting sub-reason: parse from latest defer_category
  (
    SELECT i.defer_category
    FROM interactions i
    WHERE i.quote_id = q.id AND i.defer_category IS NOT NULL AND i.deleted_at IS NULL
    ORDER BY i.created_at DESC
    LIMIT 1
  ) AS latest_defer_reason
FROM quotes q
WHERE q.deleted_at IS NULL;

-- ============================================================
--  6. FUNCTION: Compute relationship strength
--  [Req #104] - Auto-calculate based on interactions & tenure
--  [Req #106] - Auto-calculate relationship strength
-- ============================================================

CREATE OR REPLACE FUNCTION compute_relationship_strength(p_client_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_interaction_count INT;
  v_won_count INT;
  v_days_since_first_contact INT;
  v_score INT := 0;
BEGIN
  -- [Req #106] - Count total non-system interactions
  SELECT COUNT(*) INTO v_interaction_count
  FROM interactions i
    JOIN quotes q ON q.id = i.quote_id
  WHERE q.client_id = p_client_id
    AND i.type != 'system'
    AND i.deleted_at IS NULL;

  -- Count won deals
  SELECT COUNT(*) INTO v_won_count
  FROM quotes q
  WHERE q.client_id = p_client_id AND q.status = 'won' AND q.deleted_at IS NULL;

  -- Days since first interaction
  SELECT EXTRACT(DAY FROM (now() - MIN(i.created_at)))::INT INTO v_days_since_first_contact
  FROM interactions i
    JOIN quotes q ON q.id = i.quote_id
  WHERE q.client_id = p_client_id AND i.deleted_at IS NULL;

  -- Scoring formula: interactions (max 40) + won deals (max 30) + tenure (max 30)
  v_score := LEAST(40, v_interaction_count * 4);
  v_score := v_score + LEAST(30, v_won_count * 15);
  v_score := v_score + LEAST(30, COALESCE(v_days_since_first_contact, 0) / 10);

  RETURN LEAST(100, v_score);
END;
$$;

-- ============================================================
--  7. INDEXES for new columns
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_clients_preferred_channel ON clients (preferred_channel);
CREATE INDEX IF NOT EXISTS idx_clients_customer_style ON clients (customer_style);
CREATE INDEX IF NOT EXISTS idx_quotes_owner ON quotes (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_interactions_direction ON interactions (direction);
CREATE INDEX IF NOT EXISTS idx_interactions_milestone ON interactions (quote_id, created_at DESC) WHERE is_milestone = true;

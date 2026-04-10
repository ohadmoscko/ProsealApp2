-- ============================================================
--  PROSEAL BRAIN — Migration 018: Soft Deletes & Data Governance
--
--  1. Remove ON DELETE CASCADE from critical FK relationships
--  2. Add deleted_at columns for soft-delete audit trail
--  3. Create filtered views that hide soft-deleted rows
--  4. RLS policies: hide soft-deleted rows from non-admin users
-- ============================================================

-- ============================================================
--  1. DROP CASCADE constraints & replace with RESTRICT
-- ============================================================

-- quotes.client_id: was CASCADE, now RESTRICT (never auto-delete quotes)
ALTER TABLE quotes
  DROP CONSTRAINT IF EXISTS quotes_client_id_fkey;
ALTER TABLE quotes
  ADD CONSTRAINT quotes_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT;

-- interactions.quote_id: was CASCADE, now RESTRICT (never lose timeline)
ALTER TABLE interactions
  DROP CONSTRAINT IF EXISTS interactions_quote_id_fkey;
ALTER TABLE interactions
  ADD CONSTRAINT interactions_quote_id_fkey
  FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE RESTRICT;

-- ============================================================
--  2. Soft Delete columns
-- ============================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Indexes for soft-delete filtering
CREATE INDEX IF NOT EXISTS idx_clients_active    ON clients    (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_active     ON quotes     (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_interactions_active ON interactions (id) WHERE deleted_at IS NULL;

-- ============================================================
--  3. Filtered views (hide soft-deleted rows)
-- ============================================================

CREATE OR REPLACE VIEW active_clients AS
  SELECT * FROM clients WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW active_quotes AS
  SELECT * FROM quotes WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW active_interactions AS
  SELECT * FROM interactions WHERE deleted_at IS NULL;

-- Update the triage view to also exclude soft-deleted quotes
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
FROM quotes q
WHERE q.deleted_at IS NULL;

-- ============================================================
--  4. RLS policies: soft-deleted rows hidden by default
--     (Admins can still see them via direct table access)
-- ============================================================

DROP POLICY IF EXISTS "Hide soft-deleted quotes" ON quotes;
CREATE POLICY "Hide soft-deleted quotes" ON quotes
  FOR SELECT
  USING (deleted_at IS NULL OR is_admin());

DROP POLICY IF EXISTS "Hide soft-deleted clients" ON clients;
CREATE POLICY "Hide soft-deleted clients" ON clients
  FOR SELECT
  USING (deleted_at IS NULL OR is_admin());

DROP POLICY IF EXISTS "Hide soft-deleted interactions" ON interactions;
CREATE POLICY "Hide soft-deleted interactions" ON interactions
  FOR SELECT
  USING (deleted_at IS NULL OR is_admin());

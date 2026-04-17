-- ============================================================
--  PROSEAL BRAIN — Migration 022: Audit Log
--  [Req #65] - Full audit log: who did what, when
--
--  Generic audit trail for all mutating operations on
--  clients, quotes, and interactions.
-- ============================================================

-- [Req #65] - Audit log table
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name  TEXT NOT NULL,                -- 'clients', 'quotes', 'interactions'
  record_id   UUID NOT NULL,                -- PK of the affected row
  action      TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE', 'SOFT_DELETE')),
  changed_by  UUID REFERENCES profiles(id), -- who performed the action
  old_data    JSONB,                        -- previous state (NULL for INSERT)
  new_data    JSONB,                        -- new state (NULL for DELETE)
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE audit_log IS '[Req #65] Full audit trail for all data mutations';

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_log_table   ON audit_log (table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_time    ON audit_log (changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user    ON audit_log (changed_by) WHERE changed_by IS NOT NULL;

-- RLS: admin-only access
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- [Req #65] - Only admin can read audit log
CREATE POLICY "Admin reads audit log" ON audit_log
  FOR SELECT USING (is_admin());

-- [Req #65] - System (triggers) can insert via security definer functions
CREATE POLICY "System inserts audit log" ON audit_log
  FOR INSERT WITH CHECK (true);

-- ============================================================
--  TRIGGER FUNCTION: Generic audit logger
--  [Req #65] - Captures old/new state on every mutation
-- ============================================================

CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS TRIGGER
SECURITY DEFINER
LANGUAGE plpgsql AS $$
DECLARE
  v_action TEXT;
  v_old JSONB;
  v_new JSONB;
  v_record_id UUID;
  v_user UUID;
BEGIN
  -- Determine the acting user (from Supabase auth context)
  v_user := auth.uid();

  IF TG_OP = 'INSERT' THEN
    v_action := 'INSERT';
    v_old := NULL;
    v_new := to_jsonb(NEW);
    v_record_id := NEW.id;
  ELSIF TG_OP = 'UPDATE' THEN
    -- [Req #65] - Detect soft-delete vs regular update
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
      v_action := 'SOFT_DELETE';
    ELSE
      v_action := 'UPDATE';
    END IF;
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_record_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'DELETE';
    v_old := to_jsonb(OLD);
    v_new := NULL;
    v_record_id := OLD.id;
  END IF;

  -- [Req #65] - Insert audit record
  INSERT INTO audit_log (table_name, record_id, action, changed_by, old_data, new_data)
  VALUES (TG_TABLE_NAME, v_record_id, v_action, v_user, v_old, v_new);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
--  ATTACH AUDIT TRIGGERS to core tables
--  [Req #65] - Track all changes on clients, quotes, interactions
-- ============================================================

-- Clients audit
DROP TRIGGER IF EXISTS audit_clients ON clients;
CREATE TRIGGER audit_clients
  AFTER INSERT OR UPDATE OR DELETE ON clients
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- Quotes audit
DROP TRIGGER IF EXISTS audit_quotes ON quotes;
CREATE TRIGGER audit_quotes
  AFTER INSERT OR UPDATE OR DELETE ON quotes
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- Interactions audit
DROP TRIGGER IF EXISTS audit_interactions ON interactions;
CREATE TRIGGER audit_interactions
  AFTER INSERT OR UPDATE OR DELETE ON interactions
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

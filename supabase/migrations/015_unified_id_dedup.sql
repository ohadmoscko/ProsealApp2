-- ============================================================
--  PROSEAL BRAIN — Migration 015: Unified ID De-duplication
--  Adds computed unified_id column and unique constraint.
--  Format: [ERP_Number]-[Initials]-[Quote_Number]
-- ============================================================

-- 1. Add the unified_id column
ALTER TABLE quotes ADD COLUMN unified_id TEXT;

-- 2. Function to compute unified_id from client + quote
CREATE OR REPLACE FUNCTION compute_unified_id()
RETURNS TRIGGER AS $$
DECLARE
  v_erp TEXT;
  v_initials TEXT;
BEGIN
  SELECT COALESCE(c.erp_number, 'NO-ERP'), COALESCE(c.initials, 'XX')
    INTO v_erp, v_initials
    FROM clients c WHERE c.id = NEW.client_id;

  NEW.unified_id := v_erp || '-' || v_initials || '-' || NEW.quote_number;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Trigger: compute on every insert or update of client_id/quote_number
CREATE TRIGGER trg_compute_unified_id
  BEFORE INSERT OR UPDATE OF client_id, quote_number ON quotes
  FOR EACH ROW EXECUTE FUNCTION compute_unified_id();

-- 4. Backfill existing rows
UPDATE quotes SET unified_id = unified_id; -- triggers the BEFORE UPDATE

-- 5. Now enforce uniqueness
CREATE UNIQUE INDEX idx_quotes_unified_id ON quotes (unified_id);

-- 6. Helper RPC: find existing quote by unified ID components
CREATE OR REPLACE FUNCTION find_quote_by_unified_id(
  p_erp_number TEXT,
  p_initials TEXT,
  p_quote_number TEXT
) RETURNS UUID AS $$
DECLARE
  v_uid TEXT;
  v_quote_id UUID;
BEGIN
  v_uid := COALESCE(p_erp_number, 'NO-ERP') || '-' || COALESCE(p_initials, 'XX') || '-' || p_quote_number;
  SELECT id INTO v_quote_id FROM quotes WHERE unified_id = v_uid LIMIT 1;
  RETURN v_quote_id;
END;
$$ LANGUAGE plpgsql STABLE;

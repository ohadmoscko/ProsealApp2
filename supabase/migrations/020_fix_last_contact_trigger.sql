-- ============================================================
--  PROSEAL BRAIN — Migration 020: Fix last_contact_at trigger
--
--  Problem: the original trigger (010) only fired on INSERT and
--  simply copied NEW.created_at. This breaks when:
--    - An interaction is soft-deleted (deleted_at set)
--    - An interaction is updated (e.g. outcome change)
--    - An interaction is hard-deleted
--  In all three cases last_contact_at could become stale or wrong.
--
--  Fix: recalculate from MAX(created_at) on the active interactions
--  set, fire on INSERT OR UPDATE OR DELETE, and exclude system-type
--  interactions (they're automated, not real contact events).
-- ============================================================

-- Drop the old trigger first (name from migration 010)
DROP TRIGGER IF EXISTS on_interaction_insert ON interactions;

-- Rewrite the function: authoritative recalculation from source of truth
CREATE OR REPLACE FUNCTION update_quote_last_contact()
RETURNS TRIGGER AS $$
DECLARE
  target_quote_id UUID;
BEGIN
  -- Determine which quote to update based on the trigger operation
  IF TG_OP = 'DELETE' THEN
    target_quote_id := OLD.quote_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.quote_id IS DISTINCT FROM NEW.quote_id THEN
    -- Edge case: interaction moved between quotes — update both
    UPDATE quotes SET last_contact_at = (
      SELECT MAX(created_at)
      FROM interactions
      WHERE quote_id = OLD.quote_id
        AND deleted_at IS NULL
        AND type != 'system'
    )
    WHERE id = OLD.quote_id;
    target_quote_id := NEW.quote_id;
  ELSE
    target_quote_id := NEW.quote_id;
  END IF;

  -- Recalculate from the authoritative source:
  -- MAX(created_at) from non-deleted, non-system interactions
  UPDATE quotes SET last_contact_at = (
    SELECT MAX(created_at)
    FROM interactions
    WHERE quote_id = target_quote_id
      AND deleted_at IS NULL
      AND type != 'system'
  )
  WHERE id = target_quote_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- New trigger: fires on all DML events
CREATE TRIGGER on_interaction_change
  AFTER INSERT OR UPDATE OR DELETE ON interactions
  FOR EACH ROW EXECUTE FUNCTION update_quote_last_contact();

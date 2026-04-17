-- ============================================================
--  PROSEAL BRAIN — Migration 016: Temperature Decay View
--  Provides effective_temperature based on staleness of contact.
--  Used by Copilot Briefing / Smart Triage.
-- ============================================================

CREATE OR REPLACE VIEW quotes_with_triage AS
SELECT
  q.*,
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

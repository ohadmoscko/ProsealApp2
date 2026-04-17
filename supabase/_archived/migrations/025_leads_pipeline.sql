-- [Req #139] Leads (Pre-Sale) pipeline — separate from formal quotes
-- is_lead flag prevents leads from contaminating formal quote data

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS is_lead BOOLEAN NOT NULL DEFAULT false;

-- [Req #139] Index for fast lead/quote separation
CREATE INDEX IF NOT EXISTS idx_quotes_is_lead ON quotes (is_lead) WHERE deleted_at IS NULL;

COMMENT ON COLUMN quotes.is_lead IS '[Req #139] Pre-sale lead — separated from formal quote pipeline';

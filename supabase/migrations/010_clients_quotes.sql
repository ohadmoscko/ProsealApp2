-- ============================================================
--  PROSEAL BRAIN — Migration 010: Clients & Quotes
--  Adds quote management tables to existing schema
-- ============================================================

-- New enums
CREATE TYPE quote_status AS ENUM (
  'new', 'open', 'waiting', 'follow_up', 'won', 'lost', 'dormant'
);
CREATE TYPE interaction_type AS ENUM (
  'call', 'whatsapp', 'email', 'note', 'system'
);

-- ============================================================
--  CLIENTS — anonymized client records
-- ============================================================
CREATE TABLE clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE NOT NULL,          -- "C-5092 (י.י)" format
  erp_number  TEXT,                          -- ERP reference
  initials    TEXT,                          -- company initials
  temperature INT NOT NULL DEFAULT 3 CHECK (temperature BETWEEN 1 AND 5),
  tags        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ice-breaker tags
  notes       TEXT,                          -- micro-text for quick memory
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clients_code ON clients (code);
CREATE INDEX idx_clients_temperature ON clients (temperature DESC);

-- ============================================================
--  QUOTES — pricing quote tracker
-- ============================================================
CREATE TABLE quotes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number      TEXT NOT NULL,                        -- e.g. "Q-840"
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status            quote_status NOT NULL DEFAULT 'new',
  temperature       INT NOT NULL DEFAULT 3 CHECK (temperature BETWEEN 1 AND 5),
  local_file_path   TEXT,                                 -- path to PDF on office computer
  follow_up_date    DATE,                                 -- next action date
  follow_up_rule    TEXT,                                 -- custom rule for this quote
  loss_reason       TEXT,                                 -- if status=lost
  sales_ammo        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- strength points for calls
  opened_at         DATE NOT NULL DEFAULT CURRENT_DATE,
  last_contact_at   TIMESTAMPTZ,
  days_since_contact INT GENERATED ALWAYS AS (
    CASE
      WHEN last_contact_at IS NOT NULL
      THEN EXTRACT(DAY FROM (now() - last_contact_at))::INT
      ELSE NULL
    END
  ) STORED,
  created_by        UUID REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quotes_client ON quotes (client_id);
CREATE INDEX idx_quotes_status ON quotes (status);
CREATE INDEX idx_quotes_follow_up ON quotes (follow_up_date) WHERE follow_up_date IS NOT NULL;
CREATE INDEX idx_quotes_temperature ON quotes (temperature DESC);

-- ============================================================
--  INTERACTIONS — chronological timeline per quote
-- ============================================================
CREATE TABLE interactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id        UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  type            interaction_type NOT NULL DEFAULT 'note',
  content         TEXT NOT NULL CHECK (char_length(content) <= 2000),
  ice_breaker_tag TEXT,                     -- tag selected post-call
  defer_reason    TEXT,                     -- if action was deferred
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_interactions_quote ON interactions (quote_id);
CREATE INDEX idx_interactions_time ON interactions (created_at DESC);

-- ============================================================
--  TRIGGERS
-- ============================================================
CREATE TRIGGER set_updated_at_clients BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_quotes  BEFORE UPDATE ON quotes  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Update quote.last_contact_at when interaction is added
CREATE OR REPLACE FUNCTION update_quote_last_contact()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE quotes SET last_contact_at = NEW.created_at WHERE id = NEW.quote_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_interaction_insert
  AFTER INSERT ON interactions
  FOR EACH ROW EXECUTE FUNCTION update_quote_last_contact();

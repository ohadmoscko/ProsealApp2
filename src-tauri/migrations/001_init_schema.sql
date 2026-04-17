-- ============================================================
-- [Req #225, #245] PROSEAL BRAIN — Migration 001: Core Schema
-- SQLite port of Supabase migrations 010-014 (clients/quotes/interactions)
-- All UUIDs stored as TEXT (36-char canonical). All timestamps ISO-8601 UTC.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- [Req #292] CLIENTS — anonymized client records (local-only, no PII egress)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
    id           TEXT PRIMARY KEY CHECK (length(id) = 36),
    code         TEXT UNIQUE NOT NULL,                     -- e.g. "C-5092 (י.י)"
    erp_number   TEXT,
    initials     TEXT,
    phone        TEXT,                                     -- [migration 014]
    temperature  INTEGER NOT NULL DEFAULT 3 CHECK (temperature BETWEEN 1 AND 5),
    tags         TEXT NOT NULL DEFAULT '[]',               -- JSON array (ice-breaker tags)
    notes        TEXT,
    vip          INTEGER NOT NULL DEFAULT 0 CHECK (vip IN (0,1)),  -- [migration 013]
    deleted_at   TEXT,                                     -- [migration 018] soft delete
    created_by   TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_clients_code         ON clients(code);
CREATE INDEX IF NOT EXISTS idx_clients_temperature  ON clients(temperature DESC);
CREATE INDEX IF NOT EXISTS idx_clients_vip          ON clients(vip) WHERE vip = 1;
CREATE INDEX IF NOT EXISTS idx_clients_active       ON clients(id) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- [Req #157, #222, #240] QUOTES — extended status ladder
-- Status ENUM enforced via CHECK (SQLite has no native enums).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quotes (
    id                 TEXT PRIMARY KEY CHECK (length(id) = 36),
    quote_number       TEXT NOT NULL,
    client_id          TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    status             TEXT NOT NULL DEFAULT 'new'
                       CHECK (status IN (
                           'new','open','waiting','follow_up',
                           'verbal_approval','in_production','shipped',
                           'dormant','lost','won'
                       )),
    temperature        INTEGER NOT NULL DEFAULT 3 CHECK (temperature BETWEEN 1 AND 5),
    local_file_path    TEXT,
    follow_up_date     TEXT,                               -- YYYY-MM-DD
    follow_up_rule     TEXT,
    loss_reason        TEXT,
    sales_ammo         TEXT NOT NULL DEFAULT '[]',         -- JSON array
    opened_at          TEXT NOT NULL DEFAULT (date('now')),
    last_contact_at    TEXT,
    -- days_since_contact: computed on read in db.rs (SQLite lacks STORED generated cols across versions)
    ai_summary         TEXT,                               -- [migration 017]
    ai_summary_at      TEXT,
    deleted_at         TEXT,                               -- [migration 018]
    created_by         TEXT,
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_quotes_client      ON quotes(client_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status      ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_follow_up   ON quotes(follow_up_date) WHERE follow_up_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_temperature ON quotes(temperature DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_active      ON quotes(id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_quotes_number_client ON quotes(quote_number, client_id) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- INTERACTIONS — chronological timeline per quote
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interactions (
    id               TEXT PRIMARY KEY CHECK (length(id) = 36),
    quote_id         TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    type             TEXT NOT NULL DEFAULT 'note'
                     CHECK (type IN ('call','whatsapp','email','note','system')),
    content          TEXT NOT NULL CHECK (length(content) <= 2000),
    ice_breaker_tag  TEXT,
    defer_reason     TEXT,
    outcome          TEXT,                                 -- [migration 013]
    created_by       TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_interactions_quote ON interactions(quote_id);
CREATE INDEX IF NOT EXISTS idx_interactions_time  ON interactions(created_at DESC);

-- ------------------------------------------------------------
-- TRIGGERS — auto-bump updated_at + update quote.last_contact_at
-- ------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_clients_updated_at
AFTER UPDATE ON clients
FOR EACH ROW
BEGIN
    UPDATE clients SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_quotes_updated_at
AFTER UPDATE ON quotes
FOR EACH ROW
BEGIN
    UPDATE quotes SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

-- [migration 020 fix] Only set last_contact_at for user-initiated types
CREATE TRIGGER IF NOT EXISTS trg_interactions_last_contact
AFTER INSERT ON interactions
FOR EACH ROW
WHEN NEW.type IN ('call','whatsapp','email')
BEGIN
    UPDATE quotes
       SET last_contact_at = NEW.created_at
     WHERE id = NEW.quote_id;
END;

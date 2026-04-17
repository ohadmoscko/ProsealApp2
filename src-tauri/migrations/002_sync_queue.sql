-- ============================================================
-- [Req #302] PROSEAL BRAIN — Migration 002: Sync Queue & State
-- Timestamp-based conflict resolution for offline → optional cloud push.
-- SQLite is authoritative. Cloud = optional cold backup (per ADR-003).
-- ============================================================

-- ------------------------------------------------------------
-- sync_queue — append-only mutation log
-- Every INSERT / UPDATE / DELETE on core tables writes one row here
-- inside the same transaction (atomic local+queue write).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_queue (
    id                  TEXT PRIMARY KEY CHECK (length(id) = 36),
    table_name          TEXT NOT NULL,
    row_id              TEXT NOT NULL,
    operation           TEXT NOT NULL CHECK (operation IN ('insert','update','delete')),
    payload             TEXT NOT NULL,                                   -- JSON snapshot
    client_updated_at   TEXT NOT NULL,                                   -- ISO UTC at write time (#302 gate)
    attempts            INTEGER NOT NULL DEFAULT 0,
    last_error          TEXT,
    pushed_at           TEXT,                                            -- NULL = pending
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- [Req #302] Fast scan for pending push in background worker
CREATE INDEX IF NOT EXISTS idx_sync_queue_pending
    ON sync_queue(created_at)
    WHERE pushed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sync_queue_row
    ON sync_queue(table_name, row_id);

-- ------------------------------------------------------------
-- sync_state — per-table cursor for pull direction
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_state (
    table_name      TEXT PRIMARY KEY,
    last_pushed_at  TEXT,
    last_pulled_at  TEXT,
    cursor          TEXT                                                 -- opaque (e.g. max(updated_at))
);

INSERT OR IGNORE INTO sync_state (table_name) VALUES
    ('clients'),
    ('quotes'),
    ('interactions'),
    ('captures'),
    ('saved_filters'),
    ('audit_log'),
    ('leads');

-- ------------------------------------------------------------
-- app_meta — schema version, install id, encryption metadata
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

INSERT OR IGNORE INTO app_meta (key, value) VALUES
    ('schema_version', '2'),
    ('created_at', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

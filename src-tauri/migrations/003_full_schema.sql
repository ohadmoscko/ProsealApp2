-- ============================================================
-- [Req #225] Migration 003: Full schema extension
-- Ports remaining Supabase tables into local SQLite authoritative store.
-- Maps: 011 captures/saved_filters, 013 outcomes/vip, 015 unified_id,
--       017 copilot (ai_summary), 018 soft deletes, 019 ai_telemetry,
--       021 schema extensions, 022 audit_log, 023 ceo_feedback,
--       024 vacation, 025 leads.
-- ============================================================

-- ------------------------------------------------------------
-- [Req #138] profiles (local single-user, but kept for FK parity)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id               TEXT PRIMARY KEY CHECK (length(id) = 36),
    email            TEXT,
    display_name     TEXT,
    role             TEXT NOT NULL DEFAULT 'admin'
                     CHECK (role IN ('admin','viewer_commenter','contributor','readonly')),
    vacation_mode    INTEGER NOT NULL DEFAULT 0 CHECK (vacation_mode IN (0,1)),
    vacation_until   TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER IF NOT EXISTS trg_profiles_updated_at
AFTER UPDATE ON profiles FOR EACH ROW BEGIN
    UPDATE profiles SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

-- ------------------------------------------------------------
-- clients — extend with [Req #101,#104,#105,#170,#13] fields
-- ------------------------------------------------------------
ALTER TABLE clients ADD COLUMN is_vip INTEGER NOT NULL DEFAULT 0 CHECK (is_vip IN (0,1));
ALTER TABLE clients ADD COLUMN vip_set_at TEXT;
ALTER TABLE clients ADD COLUMN vip_set_by TEXT;
ALTER TABLE clients ADD COLUMN preferred_channel TEXT NOT NULL DEFAULT 'phone'
    CHECK (preferred_channel IN ('whatsapp','email','phone'));
ALTER TABLE clients ADD COLUMN customer_style TEXT NOT NULL DEFAULT 'new'
    CHECK (customer_style IN ('new','recurring','veteran','one_time'));
ALTER TABLE clients ADD COLUMN relationship_strength INTEGER NOT NULL DEFAULT 50
    CHECK (relationship_strength BETWEEN 0 AND 100);
ALTER TABLE clients ADD COLUMN is_new_customer INTEGER NOT NULL DEFAULT 1
    CHECK (is_new_customer IN (0,1));

-- ------------------------------------------------------------
-- quotes — extend with [Req #121,#139,#146,#268,#015] fields
-- ------------------------------------------------------------
ALTER TABLE quotes ADD COLUMN unified_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_quotes_unified_id ON quotes(unified_id) WHERE unified_id IS NOT NULL AND deleted_at IS NULL;
ALTER TABLE quotes ADD COLUMN is_lead INTEGER NOT NULL DEFAULT 0 CHECK (is_lead IN (0,1));
ALTER TABLE quotes ADD COLUMN win_reason TEXT;
ALTER TABLE quotes ADD COLUMN strategic_rank INTEGER CHECK (strategic_rank IS NULL OR strategic_rank BETWEEN 1 AND 3);
ALTER TABLE quotes ADD COLUMN owner_id TEXT;
ALTER TABLE quotes ADD COLUMN temp_override INTEGER NOT NULL DEFAULT 0 CHECK (temp_override IN (0,1));

-- ------------------------------------------------------------
-- interactions — extend with [Req #112,#148,#178,#239] fields
-- ------------------------------------------------------------
ALTER TABLE interactions ADD COLUMN defer_category TEXT
    CHECK (defer_category IS NULL OR defer_category IN ('client_abroad','awaiting_technical','price_objection','busy_period','other'));
ALTER TABLE interactions ADD COLUMN direction TEXT NOT NULL DEFAULT 'push'
    CHECK (direction IN ('push','pull'));
ALTER TABLE interactions ADD COLUMN micro_text TEXT;
ALTER TABLE interactions ADD COLUMN is_milestone INTEGER NOT NULL DEFAULT 0 CHECK (is_milestone IN (0,1));
ALTER TABLE interactions ADD COLUMN release_status TEXT NOT NULL DEFAULT 'immediate'
    CHECK (release_status IN ('immediate','pending','released'));
ALTER TABLE interactions ADD COLUMN release_at TEXT;
ALTER TABLE interactions ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_interactions_active ON interactions(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_interactions_release ON interactions(release_status, release_at) WHERE release_status = 'pending';

-- ------------------------------------------------------------
-- captures — [Req #011]
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS captures (
    id                    TEXT PRIMARY KEY CHECK (length(id) = 36),
    raw_text              TEXT NOT NULL,
    ai_parsed             TEXT,                                        -- JSON
    ai_response           TEXT,
    linked_quote_id       TEXT REFERENCES quotes(id) ON DELETE SET NULL,
    linked_report_week_id TEXT,
    status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','processed','in_report','dismissed')),
    created_by            TEXT,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_captures_status ON captures(status);
CREATE INDEX IF NOT EXISTS idx_captures_quote  ON captures(linked_quote_id) WHERE linked_quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_captures_time   ON captures(created_at DESC);

-- ------------------------------------------------------------
-- saved_filters — [Req #011]
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_filters (
    id             TEXT PRIMARY KEY CHECK (length(id) = 36),
    name           TEXT NOT NULL,
    filter_config  TEXT NOT NULL,                                      -- JSON
    user_id        TEXT NOT NULL,
    position       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_saved_filters_user ON saved_filters(user_id, position);

-- ------------------------------------------------------------
-- ai_training_telemetry — [Req #019]
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_training_telemetry (
    id           TEXT PRIMARY KEY CHECK (length(id) = 36),
    quote_id     TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    user_id      TEXT,
    action_type  TEXT NOT NULL
                 CHECK (action_type IN ('expand','collapse','pin','unpin','refresh','drill_down')),
    metadata     TEXT NOT NULL DEFAULT '{}',                           -- JSON
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_telemetry_quote ON ai_training_telemetry(quote_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_time  ON ai_training_telemetry(created_at DESC);

-- ------------------------------------------------------------
-- [Req #65] audit_log — full audit trail
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id           TEXT PRIMARY KEY CHECK (length(id) = 36),
    table_name   TEXT NOT NULL,
    record_id    TEXT NOT NULL,
    action       TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE','SOFT_DELETE')),
    changed_by   TEXT,
    old_data     TEXT,                                                 -- JSON
    new_data     TEXT,                                                 -- JSON
    changed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_record ON audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_time   ON audit_log(changed_at DESC);

-- ------------------------------------------------------------
-- [Req #204] ceo_feedback — feedback-to-action conversion
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ceo_feedback (
    id              TEXT PRIMARY KEY CHECK (length(id) = 36),
    report_week     TEXT NOT NULL,
    category_key    TEXT NOT NULL,
    item_index      INTEGER NOT NULL,
    feedback_type   TEXT NOT NULL
                    CHECK (feedback_type IN ('action','note','dismiss','escalate')),
    content         TEXT NOT NULL,
    action_status   TEXT NOT NULL DEFAULT 'open'
                    CHECK (action_status IN ('open','in_progress','done','cancelled')),
    assigned_to     TEXT,
    due_date        TEXT,
    created_by      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ceo_feedback_week ON ceo_feedback(report_week);
CREATE INDEX IF NOT EXISTS idx_ceo_feedback_status ON ceo_feedback(action_status);
CREATE TRIGGER IF NOT EXISTS trg_ceo_feedback_updated_at
AFTER UPDATE ON ceo_feedback FOR EACH ROW BEGIN
    UPDATE ceo_feedback SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

-- ------------------------------------------------------------
-- [Req #163] weeks / items / categories / comments (weekly report)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weeks (
    id           TEXT PRIMARY KEY CHECK (length(id) = 36),
    start_date   TEXT NOT NULL,
    end_date     TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','sent','read','responded')),
    ceo_goals    TEXT NOT NULL DEFAULT '',
    sent_at      TEXT,
    created_by   TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_weeks_start ON weeks(start_date DESC);

CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY CHECK (length(id) = 36),
    key         TEXT UNIQUE NOT NULL,
    label       TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS items (
    id            TEXT PRIMARY KEY CHECK (length(id) = 36),
    week_id       TEXT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
    category_id   TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    text          TEXT NOT NULL,
    note          TEXT NOT NULL DEFAULT '',
    importance    TEXT NOT NULL DEFAULT 'normal' CHECK (importance IN ('normal','medium','high')),
    tags          TEXT NOT NULL DEFAULT '[]',
    is_complete   INTEGER NOT NULL DEFAULT 0 CHECK (is_complete IN (0,1)),
    position      INTEGER NOT NULL DEFAULT 0,
    carried_from  TEXT,
    created_by    TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_items_week ON items(week_id, position);

CREATE TABLE IF NOT EXISTS comments (
    id          TEXT PRIMARY KEY CHECK (length(id) = 36),
    week_id     TEXT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
    item_id     TEXT REFERENCES items(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_week ON comments(week_id);

-- ------------------------------------------------------------
-- [Req #139] leads pipeline (pre-sale)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
    id              TEXT PRIMARY KEY CHECK (length(id) = 36),
    client_id       TEXT REFERENCES clients(id) ON DELETE SET NULL,
    source          TEXT,
    stage           TEXT NOT NULL DEFAULT 'new'
                    CHECK (stage IN ('new','qualified','contacted','converted','dropped')),
    notes           TEXT,
    converted_quote_id TEXT REFERENCES quotes(id) ON DELETE SET NULL,
    deleted_at      TEXT,
    created_by      TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage) WHERE deleted_at IS NULL;
CREATE TRIGGER IF NOT EXISTS trg_leads_updated_at
AFTER UPDATE ON leads FOR EACH ROW BEGIN
    UPDATE leads SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

-- Seed default profile for single-user desktop. ID matches auth.tsx LOCAL_USER_ID.
INSERT OR IGNORE INTO profiles (id, email, display_name, role)
VALUES ('00000000-0000-0000-0000-000000000001', 'local@proseal.local', 'Local User', 'admin');

-- Register tables with sync_state
INSERT OR IGNORE INTO sync_state (table_name) VALUES
    ('profiles'), ('weeks'), ('items'), ('categories'), ('comments'),
    ('ai_training_telemetry'), ('ceo_feedback');

UPDATE app_meta SET value = '3' WHERE key = 'schema_version';

-- ============================================================
--  PROSEAL BRAIN — כל המיגרציות (010-014) בסקריפט אחד
--  העתק והדבק ב-Supabase SQL Editor → Run
-- ============================================================

-- ============================================================
--  010: Clients & Quotes & Interactions
-- ============================================================

CREATE TYPE quote_status AS ENUM (
  'new', 'open', 'waiting', 'follow_up', 'won', 'lost', 'dormant'
);
CREATE TYPE interaction_type AS ENUM (
  'call', 'whatsapp', 'email', 'note', 'system'
);

CREATE TABLE clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE NOT NULL,
  erp_number  TEXT,
  initials    TEXT,
  temperature INT NOT NULL DEFAULT 3 CHECK (temperature BETWEEN 1 AND 5),
  tags        JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes       TEXT,
  is_vip      BOOLEAN NOT NULL DEFAULT false,
  vip_set_at  TIMESTAMPTZ,
  vip_set_by  UUID REFERENCES profiles(id),
  phone       TEXT,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clients_code ON clients (code);
CREATE INDEX idx_clients_temperature ON clients (temperature DESC);

CREATE TABLE quotes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number      TEXT NOT NULL,
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status            quote_status NOT NULL DEFAULT 'new',
  temperature       INT NOT NULL DEFAULT 3 CHECK (temperature BETWEEN 1 AND 5),
  local_file_path   TEXT,
  follow_up_date    DATE,
  follow_up_rule    TEXT,
  loss_reason       TEXT,
  sales_ammo        JSONB NOT NULL DEFAULT '[]'::jsonb,
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

CREATE TYPE interaction_outcome AS ENUM (
  'reached', 'no_answer', 'unavailable'
);

CREATE TABLE interactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id        UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  type            interaction_type NOT NULL DEFAULT 'note',
  content         TEXT NOT NULL CHECK (char_length(content) <= 2000),
  outcome         interaction_outcome,
  ice_breaker_tag TEXT,
  defer_reason    TEXT,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_interactions_quote ON interactions (quote_id);
CREATE INDEX idx_interactions_time ON interactions (created_at DESC);
CREATE INDEX idx_interactions_outcome ON interactions (quote_id, created_at DESC)
  WHERE outcome IN ('no_answer', 'unavailable');

-- ============================================================
--  011: Captures & Saved Filters
-- ============================================================

CREATE TYPE capture_status AS ENUM (
  'pending', 'processed', 'in_report', 'dismissed'
);

CREATE TABLE captures (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text              TEXT NOT NULL,
  ai_parsed             JSONB,
  ai_response           TEXT,
  linked_quote_id       UUID REFERENCES quotes(id) ON DELETE SET NULL,
  linked_report_week_id UUID REFERENCES weeks(id) ON DELETE SET NULL,
  status                capture_status NOT NULL DEFAULT 'pending',
  created_by            UUID REFERENCES profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_captures_status ON captures (status);
CREATE INDEX idx_captures_week ON captures (linked_report_week_id) WHERE linked_report_week_id IS NOT NULL;
CREATE INDEX idx_captures_quote ON captures (linked_quote_id) WHERE linked_quote_id IS NOT NULL;
CREATE INDEX idx_captures_time ON captures (created_at DESC);

CREATE TABLE saved_filters (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  filter_config JSONB NOT NULL,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  position      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_filters_user ON saved_filters (user_id, position);

-- ============================================================
--  012: RLS
-- ============================================================

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_admin_or_contributor()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contributor')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE POLICY clients_select ON clients FOR SELECT TO authenticated USING (true);
CREATE POLICY clients_insert ON clients FOR INSERT TO authenticated WITH CHECK (is_admin_or_contributor());
CREATE POLICY clients_update ON clients FOR UPDATE TO authenticated USING (is_admin_or_contributor());
CREATE POLICY clients_delete ON clients FOR DELETE TO authenticated USING (is_admin());

CREATE POLICY quotes_select ON quotes FOR SELECT TO authenticated USING (true);
CREATE POLICY quotes_insert ON quotes FOR INSERT TO authenticated WITH CHECK (is_admin_or_contributor());
CREATE POLICY quotes_update ON quotes FOR UPDATE TO authenticated USING (is_admin_or_contributor());
CREATE POLICY quotes_delete ON quotes FOR DELETE TO authenticated USING (is_admin());

CREATE POLICY interactions_select ON interactions FOR SELECT TO authenticated USING (true);
CREATE POLICY interactions_insert ON interactions FOR INSERT TO authenticated WITH CHECK (is_admin_or_contributor());
CREATE POLICY interactions_update ON interactions FOR UPDATE TO authenticated USING (is_admin_or_contributor());
CREATE POLICY interactions_delete ON interactions FOR DELETE TO authenticated USING (is_admin());

CREATE POLICY captures_select ON captures FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR is_admin());
CREATE POLICY captures_insert ON captures FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY captures_update ON captures FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR is_admin());
CREATE POLICY captures_delete ON captures FOR DELETE TO authenticated
  USING (is_admin());

CREATE POLICY saved_filters_select ON saved_filters FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY saved_filters_insert ON saved_filters FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY saved_filters_update ON saved_filters FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY saved_filters_delete ON saved_filters FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
--  Triggers
-- ============================================================

CREATE TRIGGER set_updated_at_clients BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_quotes  BEFORE UPDATE ON quotes  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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

-- ============================================================
--  דאטא לדוגמה — כדי שהמערכת תיראה חיה
-- ============================================================

INSERT INTO clients (code, erp_number, initials, temperature, phone, notes) VALUES
  ('C-5092 (י.י)',  'ERP-5092', 'י.י',  4, '0501234567', 'לקוח VIP ישן, מזמין הרבה'),
  ('C-3301 (א.ב)',  'ERP-3301', 'א.ב',  3, '0529876543', 'חברה קטנה, מחפשת מחירים'),
  ('C-8840 (ד.כ)',  'ERP-8840', 'ד.כ',  2, NULL,          'לקוח חדש מתעניין'),
  ('C-1120 (ר.מ)',  'ERP-1120', 'ר.מ',  5, '0541112233', 'פרויקט גדול רץ');

INSERT INTO quotes (quote_number, client_id, status, temperature, opened_at, follow_up_date, sales_ammo) VALUES
  ('Q-5092',  (SELECT id FROM clients WHERE code = 'C-5092 (י.י)'),  'follow_up', 4, '2026-03-20', '2026-04-03', '["מחיר מעולה בהשוואה למתחרים", "אספקה מהירה תוך 3 ימים"]'::jsonb),
  ('Q-3301',  (SELECT id FROM clients WHERE code = 'C-3301 (א.ב)'),  'open',      3, '2026-03-28', '2026-04-10', '["הנחת כמות אפשרית"]'::jsonb),
  ('Q-8840',  (SELECT id FROM clients WHERE code = 'C-8840 (ד.כ)'),  'new',       2, '2026-04-02', NULL,          '[]'::jsonb),
  ('Q-1120A', (SELECT id FROM clients WHERE code = 'C-1120 (ר.מ)'),  'waiting',   5, '2026-03-15', '2026-04-07', '["פרויקט אסטרטגי", "מרווח גבוה"]'::jsonb),
  ('Q-1120B', (SELECT id FROM clients WHERE code = 'C-1120 (ר.מ)'),  'open',      4, '2026-04-01', NULL,          '["תוספת לפרויקט קיים"]'::jsonb);

-- כמה אינטראקציות לדוגמה
INSERT INTO interactions (quote_id, type, content, outcome) VALUES
  ((SELECT id FROM quotes WHERE quote_number = 'Q-5092'), 'call', 'שוחחנו על ההצעה, מעוניין אבל רוצה אישור מנהל', 'reached'),
  ((SELECT id FROM quotes WHERE quote_number = 'Q-5092'), 'call', 'לא ענה', 'no_answer'),
  ((SELECT id FROM quotes WHERE quote_number = 'Q-5092'), 'call', 'לא ענה', 'no_answer'),
  ((SELECT id FROM quotes WHERE quote_number = 'Q-3301'), 'whatsapp', 'שלחתי הצעה מעודכנת', NULL),
  ((SELECT id FROM quotes WHERE quote_number = 'Q-1120A'), 'call', 'ביקש לחכות עד סוף השבוע, ממתין לאישור תקציב', 'reached'),
  ((SELECT id FROM quotes WHERE quote_number = 'Q-1120B'), 'email', 'נשלח מפרט טכני', NULL);

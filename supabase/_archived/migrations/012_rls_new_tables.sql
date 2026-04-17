-- ============================================================
--  PROSEAL BRAIN — Migration 012: RLS for new tables
-- ============================================================

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;

-- Helper: check if user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: check if user is admin or contributor
CREATE OR REPLACE FUNCTION is_admin_or_contributor()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contributor')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- CLIENTS: authenticated users can read, admin/contributor can write
CREATE POLICY clients_select ON clients FOR SELECT TO authenticated USING (true);
CREATE POLICY clients_insert ON clients FOR INSERT TO authenticated WITH CHECK (is_admin_or_contributor());
CREATE POLICY clients_update ON clients FOR UPDATE TO authenticated USING (is_admin_or_contributor());
CREATE POLICY clients_delete ON clients FOR DELETE TO authenticated USING (is_admin());

-- QUOTES: authenticated users can read, admin/contributor can write
CREATE POLICY quotes_select ON quotes FOR SELECT TO authenticated USING (true);
CREATE POLICY quotes_insert ON quotes FOR INSERT TO authenticated WITH CHECK (is_admin_or_contributor());
CREATE POLICY quotes_update ON quotes FOR UPDATE TO authenticated USING (is_admin_or_contributor());
CREATE POLICY quotes_delete ON quotes FOR DELETE TO authenticated USING (is_admin());

-- INTERACTIONS: authenticated users can read, admin/contributor can write
CREATE POLICY interactions_select ON interactions FOR SELECT TO authenticated USING (true);
CREATE POLICY interactions_insert ON interactions FOR INSERT TO authenticated WITH CHECK (is_admin_or_contributor());
CREATE POLICY interactions_update ON interactions FOR UPDATE TO authenticated USING (is_admin_or_contributor());
CREATE POLICY interactions_delete ON interactions FOR DELETE TO authenticated USING (is_admin());

-- CAPTURES: users see own captures, admin sees all
CREATE POLICY captures_select ON captures FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR is_admin());
CREATE POLICY captures_insert ON captures FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY captures_update ON captures FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR is_admin());
CREATE POLICY captures_delete ON captures FOR DELETE TO authenticated
  USING (is_admin());

-- SAVED_FILTERS: users manage own filters only
CREATE POLICY saved_filters_select ON saved_filters FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY saved_filters_insert ON saved_filters FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY saved_filters_update ON saved_filters FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY saved_filters_delete ON saved_filters FOR DELETE TO authenticated
  USING (user_id = auth.uid());

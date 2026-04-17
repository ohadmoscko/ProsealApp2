-- [Req #204] CEO feedback-to-action conversion
-- Allows CEO to respond to report items and convert them into tracked action items

-- Feedback type: how the CEO responded to a report item
CREATE TYPE ceo_feedback_type AS ENUM ('action', 'note', 'dismiss', 'escalate');

-- Status of the action item created from feedback
CREATE TYPE ceo_action_status AS ENUM ('open', 'in_progress', 'done', 'cancelled');

CREATE TABLE IF NOT EXISTS ceo_feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which report & item this feedback is for
  report_week   text        NOT NULL,      -- e.g. '2026-04-06'
  category_key  text        NOT NULL,      -- e.g. 'sales', 'operations'
  item_index    int         NOT NULL DEFAULT 0,  -- index in category.items array
  -- Feedback content
  feedback_type ceo_feedback_type NOT NULL DEFAULT 'note',
  content       text        NOT NULL DEFAULT '',  -- CEO's text response
  -- Action tracking
  action_status ceo_action_status NOT NULL DEFAULT 'open',
  assigned_to   text        NULL,          -- free text: name/role of assignee
  due_date      date        NULL,
  -- Metadata
  created_by    uuid        NOT NULL REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Index for quick lookup by report week
CREATE INDEX idx_ceo_feedback_week ON ceo_feedback(report_week);

-- RLS: only authenticated users (CEO/admin) can manage feedback
ALTER TABLE ceo_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read feedback"
  ON ceo_feedback FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert feedback"
  ON ceo_feedback FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Authenticated users can update own feedback"
  ON ceo_feedback FOR UPDATE TO authenticated
  USING (auth.uid() = created_by);

-- Auto-update updated_at
CREATE TRIGGER ceo_feedback_updated_at
  BEFORE UPDATE ON ceo_feedback
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

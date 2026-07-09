-- SAFE SQL for the flexible Automation Engine — run once in the Supabase SQL Editor.
-- Creates shared, cross-admin storage for automation rules and their run history.
-- The rule/run shape lives entirely in the JSONB `payload`, so adding new
-- triggers, conditions, or actions later NEVER requires another migration.

-- ── Rules ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_rules (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'automation_rules'
    AND policyname = 'Allow all operations on automation_rules'
  ) THEN
    CREATE POLICY "Allow all operations on automation_rules" ON automation_rules
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE automation_rules REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'automation_rules'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE automation_rules;
  END IF;
END $$;

-- ── Run history / error log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  rule_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'automation_runs'
    AND policyname = 'Allow all operations on automation_runs'
  ) THEN
    CREATE POLICY "Allow all operations on automation_runs" ON automation_runs
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS automation_runs_rule_id_idx ON automation_runs (rule_id);
CREATE INDEX IF NOT EXISTS automation_runs_created_at_idx ON automation_runs (created_at DESC);

ALTER TABLE automation_runs REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'automation_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE automation_runs;
  END IF;
END $$;

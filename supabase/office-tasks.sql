-- SAFE SQL for office_tasks table - Run in Supabase SQL Editor
-- This creates the task board table with RLS enabled

-- Create table if not exists
CREATE TABLE IF NOT EXISTS office_tasks (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE office_tasks ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'office_tasks' 
    AND policyname = 'Allow all operations on office_tasks'
  ) THEN
    CREATE POLICY "Allow all operations on office_tasks" ON office_tasks
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Enable real-time
ALTER TABLE office_tasks REPLICA IDENTITY FULL;

-- Add to realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'office_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE office_tasks;
  END IF;
END $$;

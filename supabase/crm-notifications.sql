-- SAFE SQL for crm_notifications table - Run in Supabase SQL Editor
-- This creates the notifications table for real-time cross-device notifications

-- Create table if not exists
CREATE TABLE IF NOT EXISTS crm_notifications (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE crm_notifications ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'crm_notifications' 
    AND policyname = 'Allow all operations on crm_notifications'
  ) THEN
    CREATE POLICY "Allow all operations on crm_notifications" ON crm_notifications
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Enable real-time
ALTER TABLE crm_notifications REPLICA IDENTITY FULL;

-- Add to realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'crm_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE crm_notifications;
  END IF;
END $$;

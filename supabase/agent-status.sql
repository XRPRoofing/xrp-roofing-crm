-- Agent availability status for call routing
-- Each agent has a status: online, offline, or busy
-- The TwiML generator queries this table to determine which agents to ring

CREATE TABLE IF NOT EXISTS agent_status (
  user_id UUID PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'busy')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable realtime so all CRM clients see status changes instantly
ALTER PUBLICATION supabase_realtime ADD TABLE agent_status;

-- Allow authenticated users to read all agent statuses
CREATE POLICY "Authenticated users can read agent status"
  ON agent_status FOR SELECT
  TO authenticated
  USING (true);

-- Allow users to update their own status
CREATE POLICY "Users can update own status"
  ON agent_status FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can upsert own status"
  ON agent_status FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Allow service role full access (for server-side TwiML queries)
ALTER TABLE agent_status ENABLE ROW LEVEL SECURITY;

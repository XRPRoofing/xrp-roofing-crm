-- Create proper invoices table for cross-device sync
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_email TEXT,
  client_phone TEXT,
  property_address TEXT,
  property_city TEXT,
  property_state TEXT,
  property_zip TEXT,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft',
  line_items JSONB NOT NULL DEFAULT '[]',
  payments JSONB NOT NULL DEFAULT '[]',
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax_rate NUMERIC NOT NULL DEFAULT 0,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  balance NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  payment_terms TEXT,
  warranty_notes TEXT,
  job_reference TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  sent_by TEXT,
  viewed_at TIMESTAMP WITH TIME ZONE,
  paid_at TIMESTAMP WITH TIME ZONE,
  activity JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (adjust based on your auth needs)
CREATE POLICY "Allow all operations on invoices" ON invoices
  FOR ALL USING (true) WITH CHECK (true);

-- Enable real-time
ALTER TABLE invoices REPLICA IDENTITY FULL;

-- Create index for common queries
CREATE INDEX idx_invoices_client ON invoices(client_name);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_updated ON invoices(updated_at DESC);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_invoices_updated_at ON invoices;
CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_invoices_updated_at();

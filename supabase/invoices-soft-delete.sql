-- SAFE SQL: Add soft delete support to invoices table
-- Run this in Supabase SQL Editor

-- Add is_deleted column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoices' AND column_name = 'is_deleted'
  ) THEN
    ALTER TABLE invoices ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Add deleted_at timestamp if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'invoices' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE invoices ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;
  END IF;
END $$;

-- Create index for filtering deleted records
CREATE INDEX IF NOT EXISTS idx_invoices_not_deleted ON invoices(is_deleted) WHERE is_deleted = FALSE;

-- Create view for active (non-deleted) invoices only
CREATE OR REPLACE VIEW active_invoices AS
SELECT * FROM invoices WHERE is_deleted = FALSE OR is_deleted IS NULL;

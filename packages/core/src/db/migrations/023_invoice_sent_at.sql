-- ---------------------------------------------------------------------------
-- 023: Add sent_at timestamp to invoices for email tracking
-- ---------------------------------------------------------------------------

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

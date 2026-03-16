-- ---------------------------------------------------------------------------
-- 022: Add invoice_payment_match notification type
-- ---------------------------------------------------------------------------

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'invoice_payment_match';

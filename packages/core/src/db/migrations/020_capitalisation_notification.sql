-- ---------------------------------------------------------------------------
-- 020: Add capitalisation_check notification type
-- ---------------------------------------------------------------------------

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'capitalisation_check';

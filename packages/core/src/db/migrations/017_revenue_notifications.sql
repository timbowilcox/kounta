-- Ledge: Migration 017 — Revenue Recognition Notification Types
-- Adds new notification types for revenue recognition insights.

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'monthly_recognition_summary';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'schedule_completion';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'large_deferred_balance';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'receipt_prompt';

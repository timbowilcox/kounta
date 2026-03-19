-- ---------------------------------------------------------------------------
-- 028: SQL Review Fixes — performance indexes, audit immutability, functional indexes
-- ---------------------------------------------------------------------------

-- ============================================================================
-- 1. Missing composite indexes for high-traffic query patterns
-- ============================================================================

-- line_items: critical for every balance calculation (inner loop of all statements)
CREATE INDEX IF NOT EXISTS idx_line_items_account_direction
  ON line_items (account_id, direction);

-- transactions: frequently filtered by ledger + status + date
CREATE INDEX IF NOT EXISTS idx_transactions_ledger_status_date
  ON transactions (ledger_id, status, date);

-- stripe_connections: lookup by ledger + status
CREATE INDEX IF NOT EXISTS idx_stripe_conn_ledger_status
  ON stripe_connections (ledger_id, status);

-- stripe_connections: lookup by user + status
CREATE INDEX IF NOT EXISTS idx_stripe_conn_user_status
  ON stripe_connections (user_id, status);

-- revenue_schedules: lookup by subscription + status (webhook processing)
CREATE INDEX IF NOT EXISTS idx_rev_sched_stripe_sub_status
  ON revenue_schedules (ledger_id, stripe_subscription_id, status);

-- revenue_schedule_entries: due entries lookup
CREATE INDEX IF NOT EXISTS idx_rev_entry_due
  ON revenue_schedule_entries (ledger_id, status, period_end);

-- revenue_schedule_entries: posted entries for metrics
CREATE INDEX IF NOT EXISTS idx_rev_entry_posted
  ON revenue_schedule_entries (ledger_id, status, posted_at);

-- recurring_entries: scheduler lookup for due entries
CREATE INDEX IF NOT EXISTS idx_recurring_entries_active_next
  ON recurring_entries (is_active, next_run_date);

-- recurring_entry_log: logs for a specific entry
CREATE INDEX IF NOT EXISTS idx_recurring_log_entry
  ON recurring_entry_log (recurring_entry_id, created_at);

-- email_log: rate-limiting lookups
CREATE INDEX IF NOT EXISTS idx_email_log_user_type
  ON email_log (user_id, email_type, sent_at);

-- notifications: list queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_ledger
  ON notifications (ledger_id, user_id, created_at DESC);

-- global_classifications: lookup by merchant name
CREATE INDEX IF NOT EXISTS idx_global_class_merchant
  ON global_classifications (canonical_merchant);

-- ledgers: owner + status (used by usage tracking, billing)
CREATE INDEX IF NOT EXISTS idx_ledgers_owner_status
  ON ledgers (owner_id, status);

-- users: Stripe customer lookup
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer
  ON users (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- users: creation date (onboarding emails)
CREATE INDEX IF NOT EXISTS idx_users_created_at
  ON users (created_at);

-- ============================================================================
-- 2. Functional indexes for case-insensitive lookups
-- ============================================================================

-- merchant_aliases: UPPER(alias) lookups
CREATE INDEX IF NOT EXISTS idx_merchant_aliases_alias_upper
  ON merchant_aliases (UPPER(alias));

-- classification_rules: UPPER(pattern) lookups for auto-generated exact rules
CREATE INDEX IF NOT EXISTS idx_classification_rules_pattern_upper
  ON classification_rules (ledger_id, UPPER(pattern))
  WHERE auto_generated = true AND rule_type = 'exact';

-- ============================================================================
-- 3. Audit entries immutability trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_entries is append-only: % operations are forbidden', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER trg_audit_no_delete
  BEFORE DELETE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

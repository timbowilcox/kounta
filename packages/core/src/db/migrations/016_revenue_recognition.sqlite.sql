-- 016: Revenue Recognition — schedules and entries for accrual-based
-- revenue spreading (ASC 606 simplified for SaaS subscriptions).

CREATE TABLE IF NOT EXISTS revenue_schedules (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  source_type TEXT NOT NULL DEFAULT 'stripe'
    CHECK (source_type IN ('stripe', 'manual', 'import')),
  source_ref TEXT,
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,
  customer_name TEXT,
  total_amount BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  recognition_start DATE NOT NULL,
  recognition_end DATE NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'monthly'
    CHECK (frequency IN ('daily', 'monthly')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled', 'paused')),
  amount_recognised BIGINT NOT NULL DEFAULT 0,
  amount_remaining BIGINT NOT NULL DEFAULT 0,
  deferred_revenue_account_id TEXT NOT NULL REFERENCES accounts(id),
  revenue_account_id TEXT NOT NULL REFERENCES accounts(id),
  description TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rev_sched_ledger
  ON revenue_schedules(ledger_id, status);
CREATE INDEX IF NOT EXISTS idx_rev_sched_stripe_sub
  ON revenue_schedules(stripe_subscription_id);

CREATE TABLE IF NOT EXISTS revenue_schedule_entries (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES revenue_schedules(id) ON DELETE CASCADE,
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  amount BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'posted', 'skipped')),
  transaction_id TEXT REFERENCES transactions(id),
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rev_entry_schedule
  ON revenue_schedule_entries(schedule_id);
CREATE INDEX IF NOT EXISTS idx_rev_entry_period
  ON revenue_schedule_entries(ledger_id, period_start, status);

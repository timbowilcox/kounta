-- --------------------------------------------------------------------------
-- 012: Recurring Journal Entries — automated periodic postings
-- (depreciation, amortisation, accruals, etc.)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recurring_entries (
  id              TEXT PRIMARY KEY,
  ledger_id       TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  line_items      JSONB NOT NULL,
  frequency       TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'annually')),
  day_of_month    INTEGER CHECK (day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 28)),
  next_run_date   DATE NOT NULL,
  last_run_date   DATE,
  auto_reverse    BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recurring_entries_ledger_active
  ON recurring_entries (ledger_id, is_active, next_run_date);

CREATE TABLE IF NOT EXISTS recurring_entry_log (
  id                      TEXT PRIMARY KEY,
  recurring_entry_id      TEXT NOT NULL REFERENCES recurring_entries(id) ON DELETE CASCADE,
  transaction_id         TEXT NOT NULL REFERENCES transactions(id),
  posted_date            DATE NOT NULL,
  reversal_transaction_id TEXT REFERENCES transactions(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recurring_entry_log_entry
  ON recurring_entry_log (recurring_entry_id);

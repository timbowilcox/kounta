-- --------------------------------------------------------------------------
-- 012: Recurring Journal Entries (SQLite)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recurring_entries (
  id              TEXT PRIMARY KEY,
  ledger_id       TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  line_items      TEXT NOT NULL,
  frequency       TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'annually')),
  day_of_month    INTEGER,
  next_run_date   TEXT NOT NULL,
  last_run_date   TEXT,
  auto_reverse    INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recurring_entries_ledger_active
  ON recurring_entries (ledger_id, is_active, next_run_date);

CREATE TABLE IF NOT EXISTS recurring_entry_log (
  id                      TEXT PRIMARY KEY,
  recurring_entry_id     TEXT NOT NULL REFERENCES recurring_entries(id) ON DELETE CASCADE,
  transaction_id         TEXT NOT NULL REFERENCES transactions(id),
  posted_date            TEXT NOT NULL,
  reversal_transaction_id TEXT REFERENCES transactions(id),
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recurring_entry_log_entry
  ON recurring_entry_log (recurring_entry_id);

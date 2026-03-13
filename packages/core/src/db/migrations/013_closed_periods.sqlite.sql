-- ---------------------------------------------------------------------------
-- 013: Closed Periods (SQLite)
--
-- Adds a closed_periods table to track period close history with audit trail.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS closed_periods (
  id              TEXT PRIMARY KEY,
  ledger_id       TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  period_end      TEXT NOT NULL, -- ISO date YYYY-MM-DD
  closed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  closed_by       TEXT NOT NULL REFERENCES users(id),
  reopened_at     TEXT,
  reopened_by     TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (ledger_id, period_end)
);

CREATE INDEX IF NOT EXISTS idx_closed_periods_ledger
  ON closed_periods (ledger_id, period_end);

-- ---------------------------------------------------------------------------
-- 013: Closed Periods
--
-- Adds a closed_periods table to track period close history with audit trail.
-- The existing closed_through column on ledgers is the enforcement mechanism;
-- this table provides history of who closed/reopened each period and when.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS closed_periods (
  id              TEXT PRIMARY KEY,
  ledger_id       TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  period_end      DATE NOT NULL,
  closed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by       TEXT NOT NULL REFERENCES users(id),
  reopened_at     TIMESTAMPTZ,
  reopened_by     TEXT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ledger_id, period_end)
);

CREATE INDEX IF NOT EXISTS idx_closed_periods_ledger
  ON closed_periods (ledger_id, period_end);

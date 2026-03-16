-- Migration 027 — Tier usage tracking (SQLite)
-- Adds plan_updated_at to users and creates a per-resource usage_tracking table.

-- ---------------------------------------------------------------------------
-- New column on users
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN plan_updated_at TEXT;

-- ---------------------------------------------------------------------------
-- Usage tracking per user per ledger per billing period
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS usage_tracking (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  ledger_id         TEXT REFERENCES ledgers(id),

  period_start      TEXT NOT NULL,
  period_end        TEXT NOT NULL,

  transactions_count INTEGER NOT NULL DEFAULT 0,
  invoices_count     INTEGER NOT NULL DEFAULT 0,
  customers_count    INTEGER NOT NULL DEFAULT 0,
  fixed_assets_count INTEGER NOT NULL DEFAULT 0,

  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  UNIQUE(user_id, ledger_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_period
  ON usage_tracking(user_id, period_start);

-- Migration 027 — Tier usage tracking
-- Adds plan_updated_at to users and creates a per-resource usage_tracking table.

-- ---------------------------------------------------------------------------
-- New column on users
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Usage tracking per user per ledger per billing period
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS usage_tracking (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  ledger_id         TEXT REFERENCES ledgers(id),

  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,

  transactions_count INTEGER NOT NULL DEFAULT 0,
  invoices_count     INTEGER NOT NULL DEFAULT 0,
  customers_count    INTEGER NOT NULL DEFAULT 0,
  fixed_assets_count INTEGER NOT NULL DEFAULT 0,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(user_id, ledger_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_period
  ON usage_tracking(user_id, period_start);

-- Auto-update updated_at
CREATE TRIGGER trg_usage_tracking_updated_at
  BEFORE UPDATE ON usage_tracking
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

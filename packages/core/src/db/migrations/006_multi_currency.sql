-- ---------------------------------------------------------------------------
-- 006 — Multi-currency support
--
-- Adds per-line-item currency tracking, exchange rates, and currency settings.
-- The existing balance constraint trigger on line_items.amount is NOT changed;
-- amount continues to hold the base-currency equivalent so debits == credits.
--
-- This migration is idempotent — safe to re-run on an existing database.
-- ---------------------------------------------------------------------------

-- ── New tables ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS currency_settings (
  id              TEXT PRIMARY KEY,
  ledger_id       TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  currency_code   TEXT NOT NULL,
  decimal_places  INTEGER NOT NULL DEFAULT 2 CHECK (decimal_places BETWEEN 0 AND 4),
  symbol          TEXT NOT NULL DEFAULT '',
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ledger_id, currency_code)
);

CREATE INDEX IF NOT EXISTS idx_currency_settings_ledger ON currency_settings (ledger_id);

-- Trigger: only create if it doesn't already exist
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_currency_settings_updated_at'
  ) THEN
    CREATE TRIGGER trg_currency_settings_updated_at
      BEFORE UPDATE ON currency_settings
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS exchange_rates (
  id              TEXT PRIMARY KEY,
  ledger_id       TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  from_currency   TEXT NOT NULL,
  to_currency     TEXT NOT NULL,
  rate            BIGINT NOT NULL CHECK (rate > 0),
  effective_date  DATE NOT NULL,
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'api', 'import')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ledger_id, from_currency, to_currency, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup
  ON exchange_rates (ledger_id, from_currency, to_currency, effective_date DESC);

-- ── Alter line_items ───────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'line_items' AND column_name = 'currency'
  ) THEN
    ALTER TABLE line_items ADD COLUMN currency TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'line_items' AND column_name = 'original_amount'
  ) THEN
    ALTER TABLE line_items ADD COLUMN original_amount BIGINT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'line_items' AND column_name = 'exchange_rate'
  ) THEN
    ALTER TABLE line_items ADD COLUMN exchange_rate BIGINT;
  END IF;
END $$;

-- Backfill existing rows: currency = ledger currency, original_amount = amount
UPDATE line_items li
SET currency = l.currency,
    original_amount = li.amount
FROM transactions t
JOIN ledgers l ON l.id = t.ledger_id
WHERE t.id = li.transaction_id
  AND li.currency IS NULL;

-- Now enforce NOT NULL (safe if already set)
DO $$ BEGIN
  ALTER TABLE line_items ALTER COLUMN currency SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE line_items ALTER COLUMN original_amount SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ── Alter accounts ─────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'accounts' AND column_name = 'currency'
  ) THEN
    ALTER TABLE accounts ADD COLUMN currency TEXT;
  END IF;
END $$;

-- ── Seed currency_settings for each existing ledger ────────────────────

INSERT INTO currency_settings (id, ledger_id, currency_code, decimal_places, symbol, enabled, created_at, updated_at)
SELECT
  gen_random_uuid()::text,
  id,
  currency,
  2,
  CASE currency
    WHEN 'USD' THEN '$'
    WHEN 'EUR' THEN '€'
    WHEN 'GBP' THEN '£'
    WHEN 'JPY' THEN '¥'
    WHEN 'AUD' THEN 'A$'
    WHEN 'CAD' THEN 'C$'
    WHEN 'CHF' THEN 'CHF'
    WHEN 'CNY' THEN '¥'
    WHEN 'INR' THEN '₹'
    WHEN 'BRL' THEN 'R$'
    ELSE currency
  END,
  true,
  now(),
  now()
FROM ledgers
ON CONFLICT (ledger_id, currency_code) DO NOTHING;

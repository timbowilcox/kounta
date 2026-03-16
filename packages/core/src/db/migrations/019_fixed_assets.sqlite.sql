-- ---------------------------------------------------------------------------
-- 019: Fixed Assets & Jurisdiction System
--
-- Adds jurisdiction-aware columns to ledgers and introduces fixed asset
-- tracking with multi-jurisdiction depreciation schedules.
-- ---------------------------------------------------------------------------

-- Jurisdiction columns on ledgers
ALTER TABLE ledgers ADD COLUMN jurisdiction TEXT NOT NULL DEFAULT 'AU';
ALTER TABLE ledgers ADD COLUMN tax_year_start TEXT NOT NULL DEFAULT '07-01';
ALTER TABLE ledgers ADD COLUMN tax_basis TEXT NOT NULL DEFAULT 'accrual';
ALTER TABLE ledgers ADD COLUMN tax_id TEXT;

-- Fixed assets table
CREATE TABLE IF NOT EXISTS fixed_assets (
  id                                TEXT PRIMARY KEY,
  ledger_id                         TEXT NOT NULL REFERENCES ledgers(id),
  jurisdiction                      TEXT NOT NULL DEFAULT 'AU',
  name                              TEXT NOT NULL,
  description                       TEXT,
  asset_number                      TEXT,
  asset_type                        TEXT,
  cost_amount                       INTEGER NOT NULL,
  currency                          TEXT NOT NULL DEFAULT 'AUD',
  purchase_date                     TEXT NOT NULL,
  depreciation_method               TEXT NOT NULL CHECK (depreciation_method IN (
    'straight_line', 'diminishing_value', 'declining_balance', 'prime_cost',
    'macrs', 'writing_down_allowance', 'aia', 'section_179',
    'bonus_depreciation', 'instant_writeoff', 'cca', 'none'
  )),
  useful_life_months                INTEGER,
  depreciation_rate                 REAL,
  salvage_value                     INTEGER NOT NULL DEFAULT 0,
  -- AU specific
  ato_effective_life_years          REAL,
  instant_writeoff_year             INTEGER,
  -- US specific
  macrs_property_class              TEXT,
  section_179_elected               INTEGER DEFAULT 0,
  bonus_depreciation_amount         INTEGER,
  bonus_depreciation_elected        INTEGER DEFAULT 0,
  -- UK specific
  capital_allowance_pool            TEXT CHECK (capital_allowance_pool IN ('main', 'special', 'single', 'aia')),
  aia_claimed                       INTEGER DEFAULT 0,
  aia_amount                        INTEGER,
  -- Account links
  asset_account_id                  TEXT NOT NULL REFERENCES accounts(id),
  accumulated_depreciation_account_id TEXT REFERENCES accounts(id),
  depreciation_expense_account_id   TEXT REFERENCES accounts(id),
  source_transaction_id             TEXT REFERENCES transactions(id),
  status                            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disposed', 'fully_depreciated')),
  disposal_date                     TEXT,
  disposal_proceeds                 INTEGER,
  disposal_transaction_id           TEXT REFERENCES transactions(id),
  created_at                        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Depreciation schedule
CREATE TABLE IF NOT EXISTS depreciation_schedule (
  id                      TEXT PRIMARY KEY,
  asset_id                TEXT NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  ledger_id               TEXT NOT NULL REFERENCES ledgers(id),
  jurisdiction            TEXT NOT NULL DEFAULT 'AU',
  period_date             TEXT NOT NULL,
  period_number           INTEGER NOT NULL,
  financial_year          TEXT NOT NULL,
  depreciation_amount     INTEGER NOT NULL,
  accumulated_depreciation INTEGER NOT NULL,
  net_book_value          INTEGER NOT NULL,
  transaction_id          TEXT REFERENCES transactions(id),
  posted_at               TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(asset_id, period_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fixed_assets_ledger
  ON fixed_assets(ledger_id);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_status
  ON fixed_assets(ledger_id, status);

CREATE INDEX IF NOT EXISTS idx_depreciation_pending
  ON depreciation_schedule(period_date, ledger_id);

CREATE INDEX IF NOT EXISTS idx_depreciation_asset
  ON depreciation_schedule(asset_id);

-- ---------------------------------------------------------------------------
-- 031: Bank data ingestion — manual CSV import (SQLite)
--   * mapping_profiles  — reusable per-bank column mappings
--   * bank_transactions.line_fingerprint — cross-channel dedup key
--   * bank_accounts.sync_cursor — Plaid /transactions/sync cursor
-- ---------------------------------------------------------------------------

-- Reusable per-bank column-mapping profiles for manual CSV import.
-- `mapping` holds the serialised CsvMapping (column indices, date format,
-- sign convention, amount mode).
CREATE TABLE IF NOT EXISTS mapping_profiles (
  id                TEXT PRIMARY KEY,
  ledger_id         TEXT NOT NULL REFERENCES ledgers(id),
  name              TEXT NOT NULL,
  mapping           TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(ledger_id, name)
);

CREATE INDEX IF NOT EXISTS idx_mapping_profiles_ledger
  ON mapping_profiles (ledger_id);

-- Cross-channel dedup fingerprint (date + amount + normalised description),
-- computed identically for Plaid/Basiq/manual rows so an overlapping manual
-- import does not double-count a feed transaction. Scoped by ledger account
-- via the bank_accounts.mapped_account_id join at query time.
ALTER TABLE bank_transactions ADD COLUMN line_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_fingerprint
  ON bank_transactions (ledger_id, line_fingerprint);

-- Plaid /transactions/sync cursor, persisted per bank account so each sync
-- resumes where the last one finished.
ALTER TABLE bank_accounts ADD COLUMN sync_cursor TEXT;

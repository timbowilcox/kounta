-- ---------------------------------------------------------------------------
-- 032: Review queue (SQLite)
--
-- A general, ledger-scoped escalation queue. Two types now:
--   * possible_duplicate_import — a held CSV candidate (same date+amount as a
--     bank-feed row, different description) awaiting user confirmation.
--   * removed_reconciled_txn — a feed `removed` event affecting a matched/posted
--     bank transaction, guarded for review (never silently mutated).
-- The `type` discriminator keeps future escalation types additive.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS review_items (
  id                    TEXT PRIMARY KEY,
  ledger_id             TEXT NOT NULL REFERENCES ledgers(id),
  type                  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'open',
  ref_key               TEXT NOT NULL,
  bank_account_id       TEXT,
  bank_transaction_id   TEXT,
  reason                TEXT NOT NULL,
  payload               TEXT NOT NULL DEFAULT '{}',
  resolution            TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  resolved_at           TEXT,
  UNIQUE(ledger_id, type, ref_key)
);

CREATE INDEX IF NOT EXISTS idx_review_items_ledger_status
  ON review_items (ledger_id, status);

-- ---------------------------------------------------------------------------
-- 032: Review queue (Postgres)
--
-- A general, ledger-scoped escalation queue. Two types now:
--   * possible_duplicate_import — a held CSV candidate awaiting confirmation.
--   * removed_reconciled_txn — a feed `removed` event affecting a matched/posted
--     bank transaction, guarded for review.
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
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at           TIMESTAMPTZ,
  UNIQUE(ledger_id, type, ref_key)
);

CREATE INDEX IF NOT EXISTS idx_review_items_ledger_status
  ON review_items (ledger_id, status);

CREATE TRIGGER trg_review_items_updated_at
  BEFORE UPDATE ON review_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

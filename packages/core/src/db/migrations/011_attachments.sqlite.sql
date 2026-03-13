-- ---------------------------------------------------------------------------
-- 011: Transaction Attachments (SQLite)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS transaction_attachments (
  id              TEXT PRIMARY KEY,
  transaction_id  TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  ledger_id       TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  storage_key     TEXT NOT NULL,
  uploaded_by     TEXT NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attachments_transaction
  ON transaction_attachments (transaction_id);

CREATE INDEX IF NOT EXISTS idx_attachments_ledger
  ON transaction_attachments (ledger_id);

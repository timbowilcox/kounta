-- ---------------------------------------------------------------------------
-- 011: Transaction Attachments — receipts, invoices, and supporting documents
--
-- Allows users to attach files (images, PDFs) to transactions for audit
-- readiness and record-keeping. Files are stored externally; this table
-- holds metadata and a storage_key pointer.
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
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_transaction
  ON transaction_attachments (transaction_id);

CREATE INDEX IF NOT EXISTS idx_attachments_ledger
  ON transaction_attachments (ledger_id);

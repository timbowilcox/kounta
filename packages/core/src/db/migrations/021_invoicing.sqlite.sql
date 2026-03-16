-- ---------------------------------------------------------------------------
-- 021: Invoicing — Accounts Receivable (SQLite)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invoices (
  id                      TEXT PRIMARY KEY,
  ledger_id               TEXT NOT NULL REFERENCES ledgers(id),
  invoice_number          TEXT NOT NULL,

  -- Customer
  customer_name           TEXT NOT NULL,
  customer_email          TEXT,
  customer_address        TEXT,

  -- Dates
  issue_date              TEXT NOT NULL,
  due_date                TEXT NOT NULL,

  -- Amounts (all in cents, ledger base currency)
  subtotal                INTEGER NOT NULL,
  tax_amount              INTEGER NOT NULL DEFAULT 0,
  total                   INTEGER NOT NULL,
  amount_paid             INTEGER NOT NULL DEFAULT 0,
  amount_due              INTEGER NOT NULL,
  currency                TEXT NOT NULL,

  -- Tax
  tax_rate                REAL,
  tax_label               TEXT,
  tax_inclusive            INTEGER NOT NULL DEFAULT 0,

  -- Status
  -- NOTE: No CHECK constraint here. SQLite cannot ALTER CHECK constraints,
  -- so adding new statuses (e.g. 'approved') would require dropping and
  -- recreating the table. Validation is enforced at the application layer.
  status                  TEXT NOT NULL DEFAULT 'draft',

  -- Payment tracking
  paid_date               TEXT,
  -- NOTE: payment_transaction_id is deprecated.
  -- Use invoice_payments.transaction_id instead.
  -- Column retained for backwards compatibility.
  payment_transaction_id  TEXT REFERENCES transactions(id),

  -- AR journal entry (posted when invoice is sent/approved)
  ar_transaction_id       TEXT REFERENCES transactions(id),

  -- Content
  notes                   TEXT,
  footer                  TEXT,

  -- Accounts
  revenue_account_id      TEXT REFERENCES accounts(id),
  ar_account_id           TEXT REFERENCES accounts(id),
  tax_account_id          TEXT REFERENCES accounts(id),

  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(ledger_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

  description       TEXT NOT NULL,
  quantity          REAL NOT NULL DEFAULT 1,
  unit_price        INTEGER NOT NULL,
  amount            INTEGER NOT NULL,

  -- Per-line tax override (optional — defaults to invoice-level tax)
  tax_rate          REAL,
  tax_amount        INTEGER NOT NULL DEFAULT 0,

  -- Optional account override per line
  account_id        TEXT REFERENCES accounts(id),

  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id                    TEXT PRIMARY KEY,
  invoice_id            TEXT NOT NULL REFERENCES invoices(id),

  amount                INTEGER NOT NULL,
  payment_date          TEXT NOT NULL,
  payment_method        TEXT,
  reference             TEXT,

  transaction_id        TEXT REFERENCES transactions(id),
  bank_transaction_id   TEXT,

  notes                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invoices_ledger
  ON invoices(ledger_id);

CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON invoices(ledger_id, status);

CREATE INDEX IF NOT EXISTS idx_invoices_due
  ON invoices(due_date);

CREATE INDEX IF NOT EXISTS idx_invoices_customer
  ON invoices(ledger_id, customer_name);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice
  ON invoice_line_items(invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice
  ON invoice_payments(invoice_id);

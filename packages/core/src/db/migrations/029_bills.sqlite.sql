-- ---------------------------------------------------------------------------
-- 029: Bills — Accounts Payable (SQLite)
-- ---------------------------------------------------------------------------

-- Vendors — supplier/vendor contact records
CREATE TABLE IF NOT EXISTS vendors (
  id                          TEXT PRIMARY KEY,
  ledger_id                   TEXT NOT NULL REFERENCES ledgers(id),
  name                        TEXT NOT NULL,
  email                       TEXT,
  phone                       TEXT,
  address                     TEXT,
  tax_id                      TEXT,
  payment_terms               TEXT NOT NULL DEFAULT 'net_30',
  default_expense_account_id  TEXT REFERENCES accounts(id),
  notes                       TEXT,
  is_active                   INTEGER NOT NULL DEFAULT 1,
  created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bills — accounts payable records
CREATE TABLE IF NOT EXISTS bills (
  id                      TEXT PRIMARY KEY,
  ledger_id               TEXT NOT NULL REFERENCES ledgers(id),
  bill_number             TEXT NOT NULL,

  -- Vendor
  vendor_id               TEXT REFERENCES vendors(id),
  vendor_name             TEXT NOT NULL,
  vendor_email            TEXT,

  -- Dates
  bill_date               TEXT NOT NULL,
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

  -- Status: draft, approved, partially_paid, paid, overdue, void
  status                  TEXT NOT NULL DEFAULT 'draft',

  -- Payment tracking
  paid_date               TEXT,

  -- AP journal entry (posted when bill is approved)
  ap_transaction_id       TEXT REFERENCES transactions(id),

  -- Content
  notes                   TEXT,
  reference               TEXT,

  -- Accounts
  expense_account_id      TEXT REFERENCES accounts(id),
  ap_account_id           TEXT REFERENCES accounts(id),
  tax_account_id          TEXT REFERENCES accounts(id),

  -- Payment terms
  payment_terms           TEXT,

  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(ledger_id, bill_number)
);

-- Bill line items
CREATE TABLE IF NOT EXISTS bill_line_items (
  id                TEXT PRIMARY KEY,
  bill_id           TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,

  description       TEXT NOT NULL,
  quantity          REAL NOT NULL DEFAULT 1,
  unit_price        INTEGER NOT NULL,
  amount            INTEGER NOT NULL,

  -- Per-line tax override (optional — defaults to bill-level tax)
  tax_rate          REAL,
  tax_amount        INTEGER NOT NULL DEFAULT 0,

  -- Optional account override per line (expense category)
  account_id        TEXT REFERENCES accounts(id),

  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bill payments
CREATE TABLE IF NOT EXISTS bill_payments (
  id                    TEXT PRIMARY KEY,
  bill_id               TEXT NOT NULL REFERENCES bills(id),

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
CREATE INDEX IF NOT EXISTS idx_vendors_ledger
  ON vendors(ledger_id);

CREATE INDEX IF NOT EXISTS idx_vendors_name
  ON vendors(ledger_id, name);

CREATE INDEX IF NOT EXISTS idx_bills_ledger
  ON bills(ledger_id);

CREATE INDEX IF NOT EXISTS idx_bills_status
  ON bills(ledger_id, status);

CREATE INDEX IF NOT EXISTS idx_bills_due
  ON bills(due_date);

CREATE INDEX IF NOT EXISTS idx_bills_vendor
  ON bills(ledger_id, vendor_name);

CREATE INDEX IF NOT EXISTS idx_bill_lines_bill
  ON bill_line_items(bill_id);

CREATE INDEX IF NOT EXISTS idx_bill_payments_bill
  ON bill_payments(bill_id);

-- Add bill/vendor tracking columns to usage_tracking
ALTER TABLE usage_tracking ADD COLUMN bills_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_tracking ADD COLUMN vendors_count INTEGER NOT NULL DEFAULT 0;

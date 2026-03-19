-- ---------------------------------------------------------------------------
-- 029: Bills — Accounts Payable (PostgreSQL)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendors (
  id                          UUID PRIMARY KEY,
  ledger_id                   UUID NOT NULL REFERENCES ledgers(id),
  name                        TEXT NOT NULL,
  email                       TEXT,
  phone                       TEXT,
  address                     TEXT,
  tax_id                      TEXT,
  payment_terms               TEXT NOT NULL DEFAULT 'net_30',
  default_expense_account_id  UUID REFERENCES accounts(id),
  notes                       TEXT,
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bills (
  id                      UUID PRIMARY KEY,
  ledger_id               UUID NOT NULL REFERENCES ledgers(id),
  bill_number             TEXT NOT NULL,
  vendor_id               UUID REFERENCES vendors(id),
  vendor_name             TEXT NOT NULL,
  vendor_email            TEXT,
  bill_date               TEXT NOT NULL,
  due_date                TEXT NOT NULL,
  subtotal                INTEGER NOT NULL,
  tax_amount              INTEGER NOT NULL DEFAULT 0,
  total                   INTEGER NOT NULL,
  amount_paid             INTEGER NOT NULL DEFAULT 0,
  amount_due              INTEGER NOT NULL,
  currency                TEXT NOT NULL,
  tax_rate                DOUBLE PRECISION,
  tax_label               TEXT,
  tax_inclusive            BOOLEAN NOT NULL DEFAULT FALSE,
  status                  TEXT NOT NULL DEFAULT 'draft',
  paid_date               TEXT,
  ap_transaction_id       UUID REFERENCES transactions(id),
  notes                   TEXT,
  reference               TEXT,
  expense_account_id      UUID REFERENCES accounts(id),
  ap_account_id           UUID REFERENCES accounts(id),
  tax_account_id          UUID REFERENCES accounts(id),
  payment_terms           TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ledger_id, bill_number)
);

CREATE TABLE IF NOT EXISTS bill_line_items (
  id                UUID PRIMARY KEY,
  bill_id           UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  description       TEXT NOT NULL,
  quantity          DOUBLE PRECISION NOT NULL DEFAULT 1,
  unit_price        INTEGER NOT NULL,
  amount            INTEGER NOT NULL,
  tax_rate          DOUBLE PRECISION,
  tax_amount        INTEGER NOT NULL DEFAULT 0,
  account_id        UUID REFERENCES accounts(id),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bill_payments (
  id                    UUID PRIMARY KEY,
  bill_id               UUID NOT NULL REFERENCES bills(id),
  amount                INTEGER NOT NULL,
  payment_date          TEXT NOT NULL,
  payment_method        TEXT,
  reference             TEXT,
  transaction_id        UUID REFERENCES transactions(id),
  bank_transaction_id   TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendors_ledger ON vendors(ledger_id);
CREATE INDEX IF NOT EXISTS idx_vendors_name ON vendors(ledger_id, name);
CREATE INDEX IF NOT EXISTS idx_bills_ledger ON bills(ledger_id);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(ledger_id, status);
CREATE INDEX IF NOT EXISTS idx_bills_due ON bills(due_date);
CREATE INDEX IF NOT EXISTS idx_bills_vendor ON bills(ledger_id, vendor_name);
CREATE INDEX IF NOT EXISTS idx_bill_lines_bill ON bill_line_items(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments(bill_id);

ALTER TABLE usage_tracking ADD COLUMN IF NOT EXISTS bills_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_tracking ADD COLUMN IF NOT EXISTS vendors_count INTEGER NOT NULL DEFAULT 0;

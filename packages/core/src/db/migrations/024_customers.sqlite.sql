-- ---------------------------------------------------------------------------
-- 024: Customer records and payment terms (SQLite)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customers (
  id              TEXT PRIMARY KEY,
  ledger_id       TEXT NOT NULL REFERENCES ledgers(id),
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  address         TEXT,
  tax_id          TEXT,
  payment_terms   TEXT DEFAULT 'net_30',
  notes           TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customers_ledger ON customers(ledger_id);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(ledger_id, name);
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(ledger_id, is_active);

-- Add customer_id and payment_terms to invoices
-- SQLite doesn't support IF NOT EXISTS on ALTER TABLE, so we use a try approach
ALTER TABLE invoices ADD COLUMN customer_id TEXT REFERENCES customers(id);
ALTER TABLE invoices ADD COLUMN payment_terms TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);

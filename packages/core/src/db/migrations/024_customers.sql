-- ---------------------------------------------------------------------------
-- 024: Customer records and payment terms
-- ---------------------------------------------------------------------------

-- Customers table — lightweight contact records for repeated invoicing
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
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_ledger ON customers(ledger_id);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(ledger_id, name);
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(ledger_id, is_active);

-- Add customer_id and payment_terms to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_id TEXT REFERENCES customers(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_terms TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);

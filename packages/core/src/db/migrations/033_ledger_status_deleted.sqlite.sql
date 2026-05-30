-- Ledge: Migration 033 — Add 'deleted' to the ledgers.status CHECK
-- SQLite cannot ALTER a CHECK constraint, so we recreate the table (cf. 030).
--
-- softDeleteLedger writes status='deleted', but the 001 CHECK allowed only
-- ('active','archived'), so the UPDATE threw before any audit write and the
-- delete failed. SAME class as 030 (audit_action): fix the schema, not the op.
--
-- ledgers (unlike audit_entries in 030) is REFERENCED by other tables
-- (accounts, api_keys, transactions, …). Foreign keys are disabled around the
-- swap so DROP TABLE does not cascade/abort; on a fresh empty DB (launch + the
-- test fixture, which strips PRAGMA) there are no rows to move and nothing to
-- cascade, so the recreate is schema-only either way.
--
-- The recreate drops every object attached to `ledgers`, so ALL of them must be
-- rebuilt: the column shape (001's 12 columns + 019's 4), the 001 owner index,
-- the 028 (owner_id, status) index, and the 001 updated_at trigger. Missing any
-- one would silently drop it from the schema.

PRAGMA foreign_keys=OFF;

CREATE TABLE ledgers_new (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'USD',
  template_id       TEXT REFERENCES templates(id),
  business_context  TEXT, -- JSON
  fiscal_year_start INTEGER NOT NULL DEFAULT 1 CHECK (fiscal_year_start BETWEEN 1 AND 12),
  accounting_basis  TEXT NOT NULL DEFAULT 'accrual' CHECK (accounting_basis IN ('accrual', 'cash')),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  owner_id          TEXT NOT NULL REFERENCES users(id),
  closed_through    TEXT, -- ISO date
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  jurisdiction      TEXT NOT NULL DEFAULT 'AU',
  tax_year_start    TEXT NOT NULL DEFAULT '07-01',
  tax_basis         TEXT NOT NULL DEFAULT 'accrual',
  tax_id            TEXT
);

INSERT INTO ledgers_new SELECT * FROM ledgers;
DROP TABLE ledgers;
ALTER TABLE ledgers_new RENAME TO ledgers;

CREATE INDEX IF NOT EXISTS idx_ledgers_owner ON ledgers (owner_id);
CREATE INDEX IF NOT EXISTS idx_ledgers_owner_status ON ledgers (owner_id, status);

CREATE TRIGGER IF NOT EXISTS trg_ledgers_updated_at AFTER UPDATE ON ledgers
BEGIN UPDATE ledgers SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id; END;

PRAGMA foreign_keys=ON;

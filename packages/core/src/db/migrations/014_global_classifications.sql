-- 014: Global crowdsourced classification intelligence
-- Privacy: No user IDs, ledger IDs, amounts, or dates stored.
-- Only aggregated canonical merchant → account mappings.

CREATE TABLE IF NOT EXISTS global_classifications (
  id TEXT PRIMARY KEY,
  canonical_merchant TEXT NOT NULL,
  account_type TEXT NOT NULL,
  account_name TEXT NOT NULL,
  suggested_account_code TEXT,
  is_personal_count INTEGER NOT NULL DEFAULT 0,
  is_business_count INTEGER NOT NULL DEFAULT 0,
  total_classifications INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0.0,
  updated_at TEXT NOT NULL DEFAULT (NOW())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_global_class_merchant_account
  ON global_classifications(canonical_merchant, account_name);

CREATE INDEX IF NOT EXISTS idx_global_class_merchant
  ON global_classifications(canonical_merchant);

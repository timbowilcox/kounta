-- ---------------------------------------------------------------------------
-- 008: Classification Rules Engine
--
-- Three-layer classification system for bank feed transactions:
--   1. Exact/contains/regex rules (user-defined or auto-generated)
--   2. Merchant alias normalisation (fuzzy matching)
--   3. AI classification (future — not in this migration)
-- ---------------------------------------------------------------------------

-- Classification rules — user-defined or auto-generated patterns
CREATE TABLE IF NOT EXISTS classification_rules (
  id                TEXT PRIMARY KEY,
  ledger_id         TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  priority          INTEGER NOT NULL DEFAULT 100,
  rule_type         TEXT NOT NULL CHECK (rule_type IN ('exact', 'contains', 'regex', 'amount_range')),
  field             TEXT NOT NULL CHECK (field IN ('description', 'merchant_name', 'category')),
  pattern           TEXT NOT NULL,
  target_account_id TEXT NOT NULL REFERENCES accounts(id),
  is_personal       BOOLEAN NOT NULL DEFAULT false,
  confidence        REAL NOT NULL DEFAULT 1.0,
  auto_generated    BOOLEAN NOT NULL DEFAULT false,
  hit_count         INTEGER NOT NULL DEFAULT 0,
  last_hit_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_classification_rules_ledger
  ON classification_rules (ledger_id, priority);

CREATE INDEX IF NOT EXISTS idx_classification_rules_lookup
  ON classification_rules (ledger_id, rule_type, field);

-- Merchant aliases — normalise bank description variants to canonical names
CREATE TABLE IF NOT EXISTS merchant_aliases (
  id              TEXT PRIMARY KEY,
  canonical_name  TEXT NOT NULL,
  alias           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(alias)
);

CREATE INDEX IF NOT EXISTS idx_merchant_aliases_alias
  ON merchant_aliases (alias);

CREATE INDEX IF NOT EXISTS idx_merchant_aliases_canonical
  ON merchant_aliases (canonical_name);

-- Add is_personal and suggested_account_id to bank_transactions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bank_transactions' AND column_name = 'is_personal'
  ) THEN
    ALTER TABLE bank_transactions ADD COLUMN is_personal BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bank_transactions' AND column_name = 'suggested_account_id'
  ) THEN
    ALTER TABLE bank_transactions ADD COLUMN suggested_account_id TEXT REFERENCES accounts(id);
  END IF;
END $$;

-- Seed merchant aliases for common SaaS vendors
INSERT INTO merchant_aliases (id, canonical_name, alias, created_at) VALUES
  -- AWS
  (gen_random_uuid()::text, 'AWS', 'AMAZON WEB SERVICES', now()),
  (gen_random_uuid()::text, 'AWS', 'AMZN WEB SVCS', now()),
  (gen_random_uuid()::text, 'AWS', 'AWS', now()),
  (gen_random_uuid()::text, 'AWS', 'AMZ*WEB', now()),
  -- Stripe
  (gen_random_uuid()::text, 'STRIPE', 'STRIPE', now()),
  (gen_random_uuid()::text, 'STRIPE', 'STRIPE PAYMENTS', now()),
  (gen_random_uuid()::text, 'STRIPE', 'STRIPE TRANSFER', now()),
  -- Vercel
  (gen_random_uuid()::text, 'VERCEL', 'VERCEL INC', now()),
  (gen_random_uuid()::text, 'VERCEL', 'VERCEL', now()),
  -- GitHub
  (gen_random_uuid()::text, 'GITHUB', 'GITHUB', now()),
  (gen_random_uuid()::text, 'GITHUB', 'GITHUB.COM', now()),
  (gen_random_uuid()::text, 'GITHUB', 'GH*GITHUB', now()),
  -- Google Cloud
  (gen_random_uuid()::text, 'GOOGLE CLOUD', 'GOOGLE*CLOUD', now()),
  (gen_random_uuid()::text, 'GOOGLE CLOUD', 'GOOGLE CLOUD', now()),
  (gen_random_uuid()::text, 'GOOGLE CLOUD', 'GCP', now()),
  -- Hetzner
  (gen_random_uuid()::text, 'HETZNER', 'HETZNER', now()),
  (gen_random_uuid()::text, 'HETZNER', 'HETZNER ONLINE', now()),
  (gen_random_uuid()::text, 'HETZNER', 'HETZNER CLOUD', now()),
  -- DigitalOcean
  (gen_random_uuid()::text, 'DIGITALOCEAN', 'DIGITALOCEAN', now()),
  (gen_random_uuid()::text, 'DIGITALOCEAN', 'DIGITALOCEAN.COM', now()),
  -- Notion
  (gen_random_uuid()::text, 'NOTION', 'NOTION.SO', now()),
  (gen_random_uuid()::text, 'NOTION', 'NOTION LABS', now()),
  -- Figma
  (gen_random_uuid()::text, 'FIGMA', 'FIGMA', now()),
  (gen_random_uuid()::text, 'FIGMA', 'FIGMA INC', now()),
  -- Slack
  (gen_random_uuid()::text, 'SLACK', 'SLACK TECHNOLOGIES', now()),
  (gen_random_uuid()::text, 'SLACK', 'SLACK.COM', now()),
  -- Zoom
  (gen_random_uuid()::text, 'ZOOM', 'ZOOM.US', now()),
  (gen_random_uuid()::text, 'ZOOM', 'ZOOM VIDEO', now()),
  -- Linear
  (gen_random_uuid()::text, 'LINEAR', 'LINEAR', now()),
  (gen_random_uuid()::text, 'LINEAR', 'LINEAR.APP', now()),
  -- Render
  (gen_random_uuid()::text, 'RENDER', 'RENDER', now()),
  (gen_random_uuid()::text, 'RENDER', 'RENDER.COM', now()),
  -- Supabase
  (gen_random_uuid()::text, 'SUPABASE', 'SUPABASE', now()),
  (gen_random_uuid()::text, 'SUPABASE', 'SUPABASE INC', now()),
  -- Railway
  (gen_random_uuid()::text, 'RAILWAY', 'RAILWAY', now()),
  (gen_random_uuid()::text, 'RAILWAY', 'RAILWAY.APP', now()),
  -- Netlify
  (gen_random_uuid()::text, 'NETLIFY', 'NETLIFY', now()),
  (gen_random_uuid()::text, 'NETLIFY', 'NETLIFY.COM', now()),
  -- Cloudflare
  (gen_random_uuid()::text, 'CLOUDFLARE', 'CLOUDFLARE', now()),
  (gen_random_uuid()::text, 'CLOUDFLARE', 'CLOUDFLARE INC', now()),
  -- Netflix
  (gen_random_uuid()::text, 'NETFLIX', 'NETFLIX.COM', now()),
  (gen_random_uuid()::text, 'NETFLIX', 'NETFLIX', now()),
  -- Spotify
  (gen_random_uuid()::text, 'SPOTIFY', 'SPOTIFY', now()),
  (gen_random_uuid()::text, 'SPOTIFY', 'SPOTIFY AB', now())
ON CONFLICT (alias) DO NOTHING;

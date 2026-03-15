-- ---------------------------------------------------------------------------
-- 018: OAuth 2.0 Authorization Server
--
-- Adds OAuth 2.0 support for MCP client authorization (Claude.ai, etc).
-- Enables token-based auth alongside existing API key auth.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS oauth_clients (
  id              TEXT PRIMARY KEY,
  client_id       TEXT UNIQUE NOT NULL,
  client_secret_hash TEXT,
  name            TEXT NOT NULL,
  redirect_uris   TEXT NOT NULL,
  scopes          TEXT NOT NULL DEFAULT '["ledger:read", "ledger:write", "bank-feeds:read"]',
  is_public       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  id                    TEXT PRIMARY KEY,
  code                  TEXT UNIQUE NOT NULL,
  client_id             TEXT NOT NULL,
  user_id               TEXT NOT NULL REFERENCES users(id),
  ledger_id             TEXT NOT NULL REFERENCES ledgers(id),
  redirect_uri          TEXT NOT NULL,
  scopes                TEXT NOT NULL,
  code_challenge        TEXT,
  code_challenge_method TEXT,
  state                 TEXT,
  expires_at            TEXT NOT NULL,
  used_at               TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id                TEXT PRIMARY KEY,
  access_token      TEXT UNIQUE NOT NULL,
  token_type        TEXT NOT NULL DEFAULT 'Bearer',
  refresh_token     TEXT UNIQUE,
  client_id         TEXT NOT NULL,
  user_id           TEXT NOT NULL REFERENCES users(id),
  ledger_id         TEXT NOT NULL REFERENCES ledgers(id),
  scopes            TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  refresh_expires_at TEXT,
  revoked_at        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_access
  ON oauth_tokens (access_token);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_refresh
  ON oauth_tokens (refresh_token);

CREATE INDEX IF NOT EXISTS idx_oauth_codes_code
  ON oauth_authorization_codes (code);

CREATE INDEX IF NOT EXISTS idx_oauth_clients_client_id
  ON oauth_clients (client_id);

-- Seed: Claude.ai as a known public client
INSERT OR IGNORE INTO oauth_clients (id, client_id, name, redirect_uris, scopes, is_public)
VALUES (
  '00000000-0000-7000-8000-000000000100',
  'claude-ai',
  'Claude.ai',
  '["https://claude.ai/oauth/callback"]',
  '["ledger:read", "ledger:write", "bank-feeds:read"]',
  1
);

-- Seed: Generic public MCP client (for local dev / other MCP clients)
INSERT OR IGNORE INTO oauth_clients (id, client_id, name, redirect_uris, scopes, is_public)
VALUES (
  '00000000-0000-7000-8000-000000000101',
  'mcp-public',
  'MCP Client',
  '["http://localhost"]',
  '["ledger:read", "ledger:write", "bank-feeds:read", "bank-feeds:write", "settings:read"]',
  1
);

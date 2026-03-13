-- ---------------------------------------------------------------------------
-- 007 — AI Financial Assistant conversations
--
-- Stores chat conversations between users and the AI assistant, scoped to
-- a user + ledger pair. Messages (including tool calls) are stored as JSONB.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ledger_id   TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  title       TEXT,
  messages    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_ledger
  ON conversations(user_id, ledger_id);

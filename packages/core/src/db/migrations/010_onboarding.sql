-- Migration 010: Onboarding state and checklist tables
-- Tracks conversational onboarding flow and progress checklist items

CREATE TABLE IF NOT EXISTS onboarding_state (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_type TEXT,
  business_age TEXT,
  payment_processor TEXT,
  bank_situation TEXT,
  business_structure TEXT,
  country TEXT,
  currency TEXT,
  completed_steps JSONB NOT NULL DEFAULT '[]',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS onboarding_checklist (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  dismissed BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(user_id, item)
);

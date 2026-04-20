-- Ledge: Migration 030 — Add 'revoked', 'deleted', and 'updated' to audit_action enum
--
-- Several engine code paths (revokeApiKey, deleteInvoiceDraft, updates) write
-- these actions, but the initial schema enum only included ('created',
-- 'reversed', 'archived'). The SQLite branch had a migration 002 that added
-- 'updated'; Postgres didn't. Consolidating all three missing values here.

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'updated';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'revoked';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'deleted';

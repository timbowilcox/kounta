-- Ledge: Migration 033 — Add 'deleted' to the ledger_status enum
--
-- softDeleteLedger writes status='deleted' (and DELETE /v1/ledgers/:ledgerId
-- depends on it), but the initial schema enum only included ('active',
-- 'archived'). SAME class as 030 (audit_action): the engine intent is correct;
-- the value was never added to the type, so the UPDATE threw on the constraint
-- before any audit write and the delete 500'd. Fix the schema, not the op.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so the
-- production runner applies this via a per-statement special-case
-- (packages/api/src/index.ts), exactly like 017/020/022/030. This file is the
-- source of truth for the value (the SQLite branch recreates the table CHECK).

ALTER TYPE ledger_status ADD VALUE IF NOT EXISTS 'deleted';

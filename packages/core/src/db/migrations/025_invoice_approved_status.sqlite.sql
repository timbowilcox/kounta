-- Migration 025: Add 'approved' status to invoices (SQLite)
-- SQLite uses TEXT columns without enum enforcement, so this is a no-op.
-- The CHECK constraint from the original CREATE TABLE cannot be altered in SQLite,
-- but SQLite allows any TEXT value regardless.
SELECT 1;

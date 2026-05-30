// ---------------------------------------------------------------------------
// The ordered migration lists the PRODUCTION runner applies.
//
// These are DERIVED from the single source of truth — REGISTERED_MIGRATIONS in
// @kounta/core (packages/core/src/db/migration-manifest.ts) — so the prod
// runner and every test fixture share one ordered list. Do NOT hand-edit the
// arrays here; add/remove a migration in the core manifest instead.
//
// This module stays side-effect-free (no server boot) so tests can import the
// real production list WITHOUT pulling in index.ts, whose module body calls
// main() and starts the server (that caused an EADDRINUSE unhandled error when
// two test files imported it). The migrations directory is NOT scanned at
// runtime. The anti-drift guard (packages/core/tests/migration-drift.test.ts)
// fails if a migration file exists that is neither REGISTERED nor an explicit
// PENDING exception (028/029/030).
//
// 028/029/030 are REGISTERED (they graduated from PENDING at launch); the
// manifest's PENDING set is now empty. The anti-drift guard
// (packages/core/tests/migration-drift.test.ts) still fails on any *.sql file
// that is neither REGISTERED nor PENDING, so a new unregistered migration can
// never silently drift out of this list.
// ---------------------------------------------------------------------------

import { registeredPgMigrationFiles, registeredSqliteMigrationFiles } from "@kounta/core";

/** Ordered list of PostgreSQL migrations applied in production. */
export const PG_MIGRATIONS: readonly string[] = registeredPgMigrationFiles();

/** Ordered list of SQLite migrations applied in production. */
export const SQLITE_MIGRATION_FILES: readonly string[] = registeredSqliteMigrationFiles();

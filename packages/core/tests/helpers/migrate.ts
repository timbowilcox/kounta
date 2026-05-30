// ---------------------------------------------------------------------------
// Shared test fixture — loads the registered SQLite migration set, in order.
//
// Why this exists: each test file used to hand-pick a subset of migrations in
// its own createTestDb(). That is exactly how `usage_tracking` (027) went
// missing in the API tests and tier checks silently failed open ("no such
// table: usage_tracking"). New tables become the next silent "no such table".
//
// The migration list is now derived from the SINGLE source of truth —
// REGISTERED_MIGRATIONS in src/db/migration-manifest.ts — so the fixture
// applies EXACTLY what production applies (no `readdirSync` divergence). A new
// migration is picked up automatically once it is registered; an unregistered
// file (e.g. the PENDING 028/029/030) is deliberately NOT applied here, so a
// green suite is real evidence of what prod runs.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteDatabase } from "../../src/db/sqlite.js";
import type { Database } from "../../src/db/database.js";
import { registeredSqliteMigrationFiles } from "../../src/db/migration-manifest.js";

const MIGRATIONS_DIR = resolve(__dirname, "../../src/db/migrations");

/**
 * The registered SQLite migration files in apply order. Derived from the
 * production manifest — NOT a directory scan.
 */
function sqliteMigrationFiles(): string[] {
  return registeredSqliteMigrationFiles();
}

/**
 * Read a migration and strip PRAGMA statements. sql.js applies its own PRAGMAs
 * at creation (WAL + foreign_keys); re-issuing journal_mode mid-session is a
 * no-op at best and noise at worst.
 */
function readMigration(file: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, file), "utf-8")
    .split("\n")
    .filter((line) => !line.trim().toUpperCase().startsWith("PRAGMA"))
    .join("\n");
}

/**
 * Create an in-memory SQLite database with every REGISTERED migration applied,
 * in order. This is the canonical test fixture — it mirrors the production
 * schema exactly, so prefer it over hand-rolled migration lists.
 */
export async function createFullTestDb(): Promise<Database> {
  const db = await SqliteDatabase.create();
  for (const file of sqliteMigrationFiles()) {
    await db.exec(readMigration(file));
  }
  return db;
}

/** The ordered list of migration filenames the fixture applies (for assertions). */
export function migrationFileList(): readonly string[] {
  return sqliteMigrationFiles();
}

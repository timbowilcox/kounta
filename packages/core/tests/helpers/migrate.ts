// ---------------------------------------------------------------------------
// Shared test fixture — loads the FULL SQLite migration set, in order.
//
// Why this exists: each test file used to hand-pick a subset of migrations in
// its own createTestDb(). That is exactly how `usage_tracking` (027) went
// missing in the API tests and tier checks silently failed open ("no such
// table: usage_tracking"). New tables become the next silent "no such table".
//
// Every new test should build its database from here so any future migration
// is picked up automatically — there is no per-test migration list to forget
// to update.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteDatabase } from "../../src/db/sqlite.js";
import type { Database } from "../../src/db/database.js";

const MIGRATIONS_DIR = resolve(__dirname, "../../src/db/migrations");

/**
 * All SQLite migration files in numeric order. We deliberately match only the
 * `*.sqlite.sql` variant — the bare `*.sql` files are the Postgres flavour.
 */
function sqliteMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sqlite.sql"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
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
 * Create an in-memory SQLite database with every migration applied, in order.
 * This is the canonical test fixture — prefer it over hand-rolled migration
 * lists so a new table never becomes a silent "no such table".
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

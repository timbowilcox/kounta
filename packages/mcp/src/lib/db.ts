// ---------------------------------------------------------------------------
// Database lifecycle: create a database, apply migrations, seed system user.
//
// Two modes:
//   1. DATABASE_URL set → connect to PostgreSQL (production)
//   2. No DATABASE_URL  → in-memory SQLite (local dev / stdio mode)
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteDatabase, PostgresDatabase, LedgerEngine } from "@ledge/core";
import type { Database } from "@ledge/core";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const SYSTEM_USER_ID = "00000000-0000-7000-8000-000000000000";

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

/** Read a migration SQL file from the core package. */
function loadMigrationSql(filename: string): string {
  const migrationPath = resolve(
    __dirname,
    `../../../core/src/db/migrations/${filename}`,
  );
  return readFileSync(migrationPath, "utf-8");
}

export interface InitResult {
  engine: LedgerEngine;
  db: Database;
  systemUserId: string;
}

// ---------------------------------------------------------------------------
// SQLite init (in-memory, for local dev / stdio mode)
// ---------------------------------------------------------------------------

async function initSqlite(): Promise<InitResult> {
  const db = await SqliteDatabase.create();

  // Apply schema — skip PRAGMA lines (already set by SqliteDatabase.create())
  const migration001 = loadMigrationSql("001_initial_schema.sqlite.sql");
  const schemaWithoutPragmas = migration001
    .split("\n")
    .filter((line) => !line.trim().startsWith("PRAGMA"))
    .join("\n");
  await db.exec(schemaWithoutPragmas);

  // Apply additional migrations
  const sqliteMigrations = [
    "002_audit_action_updated.sqlite.sql",
    "003_billing.sqlite.sql",
    "004_bank_feeds.sqlite.sql",
    "005_intelligence.sqlite.sql",
    "006_multi_currency.sqlite.sql",
    "007_conversations.sqlite.sql",
    "008_classification.sqlite.sql",
    "009_email.sqlite.sql",
    "010_onboarding.sqlite.sql",
    "011_attachments.sqlite.sql",
    "012_recurring_entries.sqlite.sql",
    "013_closed_periods.sqlite.sql",
    "014_global_classifications.sqlite.sql",
    "015_stripe_connect.sqlite.sql",
    "016_revenue_recognition.sqlite.sql",
  ];

  for (const file of sqliteMigrations) {
    try {
      const sql = loadMigrationSql(file);
      await db.exec(sql);
    } catch {
      // Some migration files may not exist for SQLite — skip
    }
  }

  // Seed system user
  await db.run(
    `INSERT INTO users (id, email, name, auth_provider, auth_provider_id)
     VALUES (?, ?, ?, ?, ?)`,
    [SYSTEM_USER_ID, "system@ledge.local", "System", "system", "system"],
  );

  const engine = new LedgerEngine(db);
  return { engine, db, systemUserId: SYSTEM_USER_ID };
}

// ---------------------------------------------------------------------------
// PostgreSQL init (production, connects to existing database)
// ---------------------------------------------------------------------------

/** Ensure the system user exists for MCP operations. */
async function ensureSystemUser(db: Database): Promise<void> {
  // Use ON CONFLICT DO NOTHING to avoid crashing when the API server
  // (which shares the same PostgreSQL database) has already created
  // the system user. A SELECT-first approach has a TOCTOU race condition.
  const result = await db.run(
    `INSERT INTO users (id, email, name, auth_provider, auth_provider_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (auth_provider, auth_provider_id) DO NOTHING`,
    [SYSTEM_USER_ID, "system@ledge.local", "System", "system", "system"],
  );
  if (result.changes > 0) {
    console.log("[mcp] Created system user for MCP operations");
  }
}

async function initPostgres(databaseUrl: string): Promise<InitResult> {
  const db = new PostgresDatabase(databaseUrl);

  // Verify connection
  await db.get("SELECT 1 as ok");
  console.log("[mcp] Connected to PostgreSQL");

  // The API server handles migrations. The MCP server assumes the schema
  // already exists. We only ensure the system user is present.
  await ensureSystemUser(db);

  const engine = new LedgerEngine(db);
  return { engine, db, systemUserId: SYSTEM_USER_ID };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Initialise the database for the MCP server.
 *
 * - If `DATABASE_URL` is set → connects to PostgreSQL (production).
 * - Otherwise → boots an in-memory SQLite with full schema (local dev).
 */
export async function initDatabase(): Promise<InitResult> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl) {
    return initPostgres(databaseUrl);
  }
  return initSqlite();
}

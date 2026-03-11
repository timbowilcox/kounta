// Script to update packages/api/src/index.ts with PostgreSQL migration support
const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "packages", "api", "src", "index.ts");

const newContent = `// ---------------------------------------------------------------------------
// @ledge/api — Server entry point.
//
// Creates a database (PostgreSQL or SQLite), applies migrations, initializes
// the engine, builds the Hono app, and starts the HTTP server.
//
// Environment variables:
//   PORT              — HTTP port (default: 3001)
//   DATABASE_URL      — PostgreSQL connection string (if set, uses PostgreSQL)
//   LEDGE_DATA_DIR    — Directory for persistent SQLite file (default: in-memory)
//   LEDGE_ADMIN_SECRET — Admin secret for bootstrap operations
// ---------------------------------------------------------------------------

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import type { Database } from "@ledge/core";
import { SqliteDatabase, PostgresDatabase, LedgerEngine } from "@ledge/core";
import { createApp } from "./app.js";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

const main = async () => {
  const databaseUrl = process.env["DATABASE_URL"];
  let db: Database;

  if (databaseUrl) {
    // PostgreSQL mode
    const pgDb = new PostgresDatabase(databaseUrl);
    await applyPostgresMigrations(pgDb);
    db = pgDb;
    console.log("Connected to PostgreSQL");
  } else {
    // SQLite mode
    const dataDir = process.env["LEDGE_DATA_DIR"];

    let sqliteDb: SqliteDatabase;

    if (dataDir) {
      // Persistent mode — load existing DB or create new one
      mkdirSync(dataDir, { recursive: true });
      const dbPath = join(dataDir, "ledge.db");

      if (existsSync(dbPath)) {
        const data = readFileSync(dbPath);
        sqliteDb = await SqliteDatabase.create(data);
        console.log(\`Loaded existing database from \${dbPath}\`);
      } else {
        sqliteDb = await SqliteDatabase.create();
        await applySqliteMigrations(sqliteDb);
        persistDatabase(sqliteDb, dbPath);
        console.log(\`Created new database at \${dbPath}\`);
      }

      // Persist on graceful shutdown
      const shutdown = () => {
        console.log("Persisting database before shutdown...");
        persistDatabase(sqliteDb, dbPath);
        process.exit(0);
      };
      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);

      // Periodic persistence every 60 seconds
      setInterval(() => {
        persistDatabase(sqliteDb, dbPath);
      }, 60_000).unref();
    } else {
      // In-memory mode (dev/test)
      sqliteDb = await SqliteDatabase.create();
      await applySqliteMigrations(sqliteDb);
      console.log("Running with in-memory database (data will not persist)");
    }

    db = sqliteDb;
  }

  const engine = new LedgerEngine(db);
  const app = createApp(engine);

  const port = parseInt(process.env["PORT"] ?? "3001", 10);

  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
    console.log(\`@ledge/api listening on http://0.0.0.0:\${info.port}\`);
  });
};

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

/** Resolve the migrations directory from known locations. */
const findMigrationsDir = (): string | undefined => {
  const possiblePaths = [
    // Docker layout: packages/core/migrations/
    join(process.cwd(), "packages", "core", "migrations"),
    // Development: relative to this file's source location
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "core", "src", "db", "migrations"),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) return p;
  }
  return undefined;
};

/** Ensure the system user exists for admin/dashboard operations. */
const ensureSystemUser = async (db: Database) => {
  const existing = await db.get("SELECT id FROM users WHERE id = ?", [SYSTEM_USER_ID]);
  if (!existing) {
    await db.run(
      "INSERT INTO users (id, email, name, auth_provider, auth_provider_id) VALUES (?, ?, ?, ?, ?)",
      [SYSTEM_USER_ID, "system@ledge.internal", "System", "system", "system"]
    );
    console.log("Created system user for admin operations");
  }
};

/** Apply PostgreSQL migrations if tables don't exist yet. Idempotent. */
const applyPostgresMigrations = async (db: PostgresDatabase) => {
  // Check if schema already exists
  const result = await db.get<{ exists: boolean }>(
    "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'ledgers') as exists"
  );

  if (result?.exists) {
    console.log("PostgreSQL schema already exists — skipping migration");
    await ensureSystemUser(db);

    // Ensure 'updated' audit action exists (idempotent)
    try {
      await db.exec("ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'updated'");
    } catch {
      /* already exists or not supported */
    }
    return;
  }

  const migrationsDir = findMigrationsDir();
  if (!migrationsDir) {
    console.warn("PostgreSQL migration files not found — schema must be applied manually");
    return;
  }

  const pgMigration = join(migrationsDir, "001_initial_schema.sql");
  if (existsSync(pgMigration)) {
    const sql = readFileSync(pgMigration, "utf-8");
    await db.exec(sql);
    console.log("Applied PostgreSQL migration: 001_initial_schema.sql");

    // Add 'updated' to audit_action enum
    try {
      await db.exec("ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'updated'");
      console.log("Added 'updated' to audit_action enum");
    } catch {
      /* already exists */
    }

    // Seed system user
    await ensureSystemUser(db);
  }
};

/** Apply all SQLite migrations in order. */
const applySqliteMigrations = async (db: SqliteDatabase) => {
  const migrationsDir = findMigrationsDir();
  if (!migrationsDir) {
    console.warn("Migration files not found — schema must be applied manually");
    return;
  }

  const migrationFiles = [
    "001_initial_schema.sqlite.sql",
    "002_audit_action_updated.sqlite.sql",
  ];

  for (const file of migrationFiles) {
    const filePath = join(migrationsDir, file);
    if (existsSync(filePath)) {
      const sql = readFileSync(filePath, "utf-8");
      await db.exec(sql);
      console.log(\`Applied migration: \${file}\`);
    }
  }
};

/** Write the database to disk. */
const persistDatabase = (db: SqliteDatabase, path: string) => {
  const data = db.export();
  writeFileSync(path, Buffer.from(data));
};

main().catch(console.error);

// Re-export the app factory for testing
export { createApp } from "./app.js";
`;

// Delete then write to avoid OneDrive EEXIST errors
try { fs.unlinkSync(filePath); } catch {}
fs.writeFileSync(filePath, newContent);
console.log("✓ Updated", filePath);
console.log("  Lines:", newContent.split("\n").length);

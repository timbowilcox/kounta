// ---------------------------------------------------------------------------
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
import { SqliteDatabase, PostgresDatabase, LedgerEngine, LocalFileStorage } from "@ledge/core";
import type { AttachmentStorage } from "@ledge/core";
import { createApp } from "./app.js";
import { checkAndSendDigests, checkAndSendMonthlyClose, checkOnboardingSequence, processRecurringEntries, processAllPendingRecognition } from "@ledge/core";

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
        console.log(`Loaded existing database from ${dbPath}`);
      } else {
        sqliteDb = await SqliteDatabase.create();
        await applySqliteMigrations(sqliteDb);
        persistDatabase(sqliteDb, dbPath);
        console.log(`Created new database at ${dbPath}`);
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

  // Initialize attachment storage if configured
  let storage: AttachmentStorage | undefined;
  const attachmentsDir = process.env["LEDGE_ATTACHMENTS_DIR"];
  if (attachmentsDir) {
    storage = new LocalFileStorage(attachmentsDir);
    console.log(`Attachment storage: ${attachmentsDir}`);
  }

  const app = createApp(engine, storage);

  const port = parseInt(process.env["PORT"] ?? "3001", 10);

  // ---------------------------------------------------------------------------
  // Email scheduler — hourly checks for digests, onboarding, monthly close
  // ---------------------------------------------------------------------------

  const runEmailScheduler = async () => {
    try {
      const digestCount = await checkAndSendDigests(engine);
      const monthlyCount = await checkAndSendMonthlyClose(engine);
      const onboardingCount = await checkOnboardingSequence(engine);
      const total = digestCount + monthlyCount + onboardingCount;
      if (total > 0) {
        console.log(`Email scheduler: sent ${digestCount} digests, ${monthlyCount} monthly close, ${onboardingCount} onboarding`);
      }
    } catch (err) {
      console.error("Email scheduler error:", err);
    }

    // Process recurring entries once per day at UTC midnight
    try {
      if (new Date().getUTCHours() === 0) {
        const result = await processRecurringEntries(engine);
        if (result.processed > 0 || result.failed > 0) {
          console.log(`Recurring entries: ${result.processed} processed, ${result.failed} failed`);
        }
      }
    } catch (err) {
      console.error("Recurring entries scheduler error:", err);
    }

    // Process revenue recognition once per day at UTC midnight
    try {
      if (new Date().getUTCHours() === 0) {
        const revResult = await processAllPendingRecognition(engine.getDb(), engine);
        if (revResult.processed > 0 || revResult.failed > 0) {
          console.log(`Revenue recognition: ${revResult.processed} processed, ${revResult.failed} failed`);
        }
      }
    } catch (err) {
      console.error("Revenue recognition scheduler error:", err);
    }
  };

  // Run once at startup (after a short delay to let the server warm up)
  setTimeout(runEmailScheduler, 10_000);

  // Then every hour
  setInterval(runEmailScheduler, 60 * 60 * 1000).unref();

  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
    console.log(`@ledge/api listening on http://0.0.0.0:${info.port}`);
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

/**
 * Apply PostgreSQL migrations using a tracking table.
 *
 * Each migration is recorded in `_migrations` after it runs.
 * On subsequent boots the runner skips already-applied migrations,
 * so no SQL file needs to be idempotent on its own.
 */
const applyPostgresMigrations = async (db: PostgresDatabase) => {
  const migrationsDir = findMigrationsDir();
  if (!migrationsDir) {
    console.warn("PostgreSQL migration files not found — schema must be applied manually");
    return;
  }

  // ── 1. Create the tracking table (always safe — IF NOT EXISTS) ──
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // ── 2. Back-fill tracking rows for databases that existed before
  //       the _migrations table was introduced.  We detect this by
  //       checking for the 'ledgers' table (created by 001).
  const schemaExists = await db.get<{ exists: boolean }>(
    "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'ledgers') as exists"
  );

  if (schemaExists?.exists) {
    // The DB already has tables — figure out which migrations were
    // already applied by probing for their anchor tables / columns.
    const probes: [string, string][] = [
      ["001_initial_schema.sql",  "SELECT 1 FROM information_schema.tables WHERE table_name = 'ledgers'"],
      ["002_audit_action_updated.sql", "SELECT 1 FROM pg_enum WHERE enumlabel = 'updated' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'audit_action')"],
      ["003_billing.sql",         "SELECT 1 FROM information_schema.tables WHERE table_name = 'usage_periods'"],
      ["004_bank_feeds.sql",      "SELECT 1 FROM information_schema.tables WHERE table_name = 'bank_connections'"],
      ["005_intelligence.sql",    "SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications'"],
      ["006_multi_currency.sql",  "SELECT 1 FROM information_schema.tables WHERE table_name = 'currency_settings'"],
      ["007_conversations.sql",   "SELECT 1 FROM information_schema.tables WHERE table_name = 'conversations'"],
      ["008_classification.sql",  "SELECT 1 FROM information_schema.tables WHERE table_name = 'classification_rules'"],
      ["009_email.sql",           "SELECT 1 FROM information_schema.tables WHERE table_name = 'email_preferences'"],
      ["010_onboarding.sql",      "SELECT 1 FROM information_schema.tables WHERE table_name = 'onboarding_state'"],
      ["011_attachments.sql",     "SELECT 1 FROM information_schema.tables WHERE table_name = 'transaction_attachments'"],
      ["012_recurring_entries.sql","SELECT 1 FROM information_schema.tables WHERE table_name = 'recurring_entries'"],
      ["013_closed_periods.sql",  "SELECT 1 FROM information_schema.tables WHERE table_name = 'closed_periods'"],
      ["014_global_classifications.sql", "SELECT 1 FROM information_schema.tables WHERE table_name = 'global_classifications'"],
      ["015_stripe_connect.sql",  "SELECT 1 FROM information_schema.tables WHERE table_name = 'stripe_connections'"],
      ["016_revenue_recognition.sql", "SELECT 1 FROM information_schema.tables WHERE table_name = 'revenue_schedules'"],
    ];

    for (const [migName, probeQuery] of probes) {
      const alreadyTracked = await db.get<{ name: string }>(
        "SELECT name FROM _migrations WHERE name = $1",
        [migName],
      );
      if (alreadyTracked) continue;

      const probeResult = await db.get(probeQuery);
      if (probeResult) {
        await db.run(
          "INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
          [migName],
        );
        console.log(`Back-filled _migrations: ${migName}`);
      }
    }
  }

  // ── 3. Ordered list of all PostgreSQL migrations ──
  const pgMigrations = [
    "001_initial_schema.sql",
    "002_audit_action_updated.sql",   // virtual — handled inline below
    "003_billing.sql",
    "004_bank_feeds.sql",
    "005_intelligence.sql",
    "006_multi_currency.sql",
    "007_conversations.sql",
    "008_classification.sql",
    "009_email.sql",
    "010_onboarding.sql",
    "011_attachments.sql",
    "012_recurring_entries.sql",
    "013_closed_periods.sql",
    "014_global_classifications.sql",
    "015_stripe_connect.sql",
    "016_revenue_recognition.sql",
  ];

  // ── 4. Apply each unapplied migration in order ──
  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (const migName of pgMigrations) {
    try {
      const alreadyApplied = await db.get<{ name: string }>(
        "SELECT name FROM _migrations WHERE name = $1",
        [migName],
      );
      if (alreadyApplied) { skipped++; continue; }

      // Special case: 002 is enum-only, no SQL file for PG
      if (migName === "002_audit_action_updated.sql") {
        try {
          await db.exec("ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'updated'");
        } catch { /* already exists */ }
        await db.run(
          "INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
          [migName],
        );
        console.log(`Applied PostgreSQL migration: ${migName}`);
        applied++;
        continue;
      }

      const migPath = join(migrationsDir, migName);
      if (!existsSync(migPath)) {
        console.warn(`Migration file not found, skipping: ${migName}`);
        skipped++;
        continue;
      }

      const sql = readFileSync(migPath, "utf-8");
      await db.exec(sql);

      await db.run(
        "INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
        [migName],
      );
      console.log(`Applied PostgreSQL migration: ${migName}`);
      applied++;
    } catch (err) {
      console.error(`Migration ${migName} failed (continuing):`, err);
      failed++;
    }
  }

  console.log(`Migrations: ${applied} applied, ${skipped} skipped, ${failed} failed`);

  // ── 5. Ensure system user exists ──
  try {
    await ensureSystemUser(db);
  } catch (err) {
    console.error("Failed to ensure system user (continuing):", err);
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

  for (const file of migrationFiles) {
    const filePath = join(migrationsDir, file);
    if (existsSync(filePath)) {
      const sql = readFileSync(filePath, "utf-8");
      await db.exec(sql);
      console.log(`Applied migration: ${file}`);
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

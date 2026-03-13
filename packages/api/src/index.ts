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
import { checkAndSendDigests, checkAndSendMonthlyClose, checkOnboardingSequence } from "@ledge/core";

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

    // Apply billing migration (003) if not yet applied
    const usageTableExists = await db.get<{ exists: boolean }>(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'usage_periods') as exists"
    );
    if (!usageTableExists?.exists) {
      const mgDir = findMigrationsDir();
      if (mgDir) {
        const billingMigration = join(mgDir, "003_billing.sql");
        if (existsSync(billingMigration)) {
          const sql = readFileSync(billingMigration, "utf-8");
          await db.exec(sql);
          console.log("Applied PostgreSQL migration: 003_billing.sql");
        }
      }
    }

    // Apply bank feeds migration (004) if not yet applied
    const bankConnectionsExists = await db.get<{ exists: boolean }>(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'bank_connections') as exists"
    );
    if (!bankConnectionsExists?.exists) {
      const mgDir = findMigrationsDir();
      if (mgDir) {
        const bankFeedsMigration = join(mgDir, "004_bank_feeds.sql");
        if (existsSync(bankFeedsMigration)) {
          const sql = readFileSync(bankFeedsMigration, "utf-8");
          await db.exec(sql);
          console.log("Applied PostgreSQL migration: 004_bank_feeds.sql");
        }
      }
    }

    // Apply intelligence migration (005) if not yet applied
    const notificationsExists = await db.get<{ exists: boolean }>(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'notifications') as exists"
    );
    if (!notificationsExists?.exists) {
      const mgDir = findMigrationsDir();
      if (mgDir) {
        const intelligenceMigration = join(mgDir, "005_intelligence.sql");
        if (existsSync(intelligenceMigration)) {
          const sql = readFileSync(intelligenceMigration, "utf-8");
          await db.exec(sql);
          console.log("Applied PostgreSQL migration: 005_intelligence.sql");
        }
      }
    }

    // Apply remaining migrations (006-009) idempotently
    const laterMigrations: [string, string][] = [
      ["ledger_currencies", "006_multi_currency.sql"],
      ["conversations", "007_conversations.sql"],
      ["classification_rules", "008_classification.sql"],
      ["email_preferences", "009_email.sql"],
      ["onboarding_state", "010_onboarding.sql"],
      ["transaction_attachments", "011_attachments.sql"],
    ];
    for (const [checkTable, fileName] of laterMigrations) {
      const tableExists = await db.get<{ exists: boolean }>(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '${checkTable}') as exists`
      );
      if (!tableExists?.exists) {
        const mgDir = findMigrationsDir();
        if (mgDir) {
          const migPath = join(mgDir, fileName);
          if (existsSync(migPath)) {
            const sql = readFileSync(migPath, "utf-8");
            await db.exec(sql);
            console.log(`Applied PostgreSQL migration: ${fileName}`);
          }
        }
      }
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

    // Apply billing migration
    const billingMigration = join(migrationsDir, "003_billing.sql");
    if (existsSync(billingMigration)) {
      const billingSql = readFileSync(billingMigration, "utf-8");
      await db.exec(billingSql);
      console.log("Applied PostgreSQL migration: 003_billing.sql");
    }

    // Apply bank feeds migration
    const bankFeedsMigration = join(migrationsDir, "004_bank_feeds.sql");
    if (existsSync(bankFeedsMigration)) {
      const bankFeedsSql = readFileSync(bankFeedsMigration, "utf-8");
      await db.exec(bankFeedsSql);
      console.log("Applied PostgreSQL migration: 004_bank_feeds.sql");
    }

    // Apply intelligence migration
    const intelligenceMigration = join(migrationsDir, "005_intelligence.sql");
    if (existsSync(intelligenceMigration)) {
      const intelligenceSql = readFileSync(intelligenceMigration, "utf-8");
      await db.exec(intelligenceSql);
      console.log("Applied PostgreSQL migration: 005_intelligence.sql");
    }

    // Apply remaining migrations (006-009)
    const laterFiles = [
      "006_multi_currency.sql",
      "007_conversations.sql",
      "008_classification.sql",
      "009_email.sql",
      "010_onboarding.sql",
      "011_attachments.sql",
    ];
    for (const fileName of laterFiles) {
      const migPath = join(migrationsDir, fileName);
      if (existsSync(migPath)) {
        const sql = readFileSync(migPath, "utf-8");
        await db.exec(sql);
        console.log(`Applied PostgreSQL migration: ${fileName}`);
      }
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
    "003_billing.sqlite.sql",
    "004_bank_feeds.sqlite.sql",
    "005_intelligence.sqlite.sql",
    "006_multi_currency.sqlite.sql",
    "007_conversations.sqlite.sql",
    "008_classification.sqlite.sql",
    "009_email.sqlite.sql",
    "010_onboarding.sqlite.sql",
    "011_attachments.sqlite.sql",
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

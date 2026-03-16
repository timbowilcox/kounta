// ---------------------------------------------------------------------------
// Tier configuration and usage tracking tests.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteDatabase } from "../db/sqlite.js";
import type { Database } from "../db/database.js";
import { generateId } from "../engine/id.js";
import {
  getTierConfig,
  hasFeature,
  getLimit,
  TIER_CONFIGS,
  getCurrentUsagePeriod,
  getOrCreateUsageRecord,
  incrementUsage,
  checkLimit,
  getUsageSummary,
} from "./index.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const migrationSql = readFileSync(
  resolve(__dirname, "../db/migrations/001_initial_schema.sqlite.sql"),
  "utf-8",
);

const billingSql = readFileSync(
  resolve(__dirname, "../db/migrations/003_billing.sqlite.sql"),
  "utf-8",
);

const customersSql = readFileSync(
  resolve(__dirname, "../db/migrations/024_customers.sqlite.sql"),
  "utf-8",
);

const fixedAssetsSql = readFileSync(
  resolve(__dirname, "../db/migrations/019_fixed_assets.sqlite.sql"),
  "utf-8",
);

const invoicingSql = readFileSync(
  resolve(__dirname, "../db/migrations/021_invoicing.sqlite.sql"),
  "utf-8",
);

const tierUsageSql = readFileSync(
  resolve(__dirname, "../db/migrations/027_tier_usage_tracking.sqlite.sql"),
  "utf-8",
);

const createTestDb = async (): Promise<Database> => {
  const db = await SqliteDatabase.create();
  const schemaWithoutPragmas = migrationSql
    .split("\n")
    .filter((line) => !line.trim().startsWith("PRAGMA"))
    .join("\n");
  db.exec(schemaWithoutPragmas);
  db.exec(billingSql);

  // Apply dependent migrations in order for limit checks
  try { db.exec(fixedAssetsSql); } catch { /* may not exist */ }
  try { db.exec(invoicingSql); } catch { /* may not exist */ }
  try { db.exec(customersSql); } catch { /* may not exist */ }

  db.exec(tierUsageSql);
  return db;
};

const createUser = async (db: Database, plan = "free"): Promise<string> => {
  const userId = generateId();
  await db.run(
    "INSERT INTO users (id, email, name, auth_provider, auth_provider_id, plan) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, `user-${userId}@test.com`, "Test User", "test", `test-${userId}`, plan],
  );
  return userId;
};

const createLedger = async (db: Database, ownerId: string): Promise<string> => {
  const ledgerId = generateId();
  await db.run(
    "INSERT INTO ledgers (id, name, currency, accounting_basis, fiscal_year_start, status, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [ledgerId, "Test Ledger", "USD", "accrual", 1, "active", ownerId],
  );
  return ledgerId;
};

// =========================================================================
// Config tests
// =========================================================================

describe("Tier Configuration", () => {
  it("getTierConfig('free') returns correct limits", () => {
    const config = getTierConfig("free");
    expect(config.name).toBe("Free");
    expect(config.limits.maxLedgers).toBe(1);
    expect(config.limits.maxTransactionsPerMonth).toBe(100);
    expect(config.limits.maxInvoicesPerMonth).toBe(5);
    expect(config.limits.maxCustomers).toBe(3);
    expect(config.limits.maxFixedAssets).toBe(3);
    expect(config.price).toBe(0);
  });

  it("getTierConfig('builder') has apiAccess: true", () => {
    const config = getTierConfig("builder");
    expect(config.features.apiAccess).toBe(true);
    expect(config.features.sdkAccess).toBe(true);
    expect(config.price).toBe(1900);
  });

  it("getTierConfig('unknown') falls back to free", () => {
    const config = getTierConfig("unknown");
    expect(config.name).toBe("Free");
    expect(config.limits.maxLedgers).toBe(1);
  });

  it("hasFeature('free', 'pdfExport') → false", () => {
    expect(hasFeature("free", "pdfExport")).toBe(false);
  });

  it("hasFeature('builder', 'pdfExport') → true", () => {
    expect(hasFeature("builder", "pdfExport")).toBe(true);
  });

  it("hasFeature('free', 'apiAccess') → false", () => {
    expect(hasFeature("free", "apiAccess")).toBe(false);
  });

  it("hasFeature('free', 'mcpAccess') → true", () => {
    expect(hasFeature("free", "mcpAccess")).toBe(true);
  });

  it("hasFeature('pro', 'revenueRecognition') → true", () => {
    expect(hasFeature("pro", "revenueRecognition")).toBe(true);
  });

  it("hasFeature('builder', 'revenueRecognition') → false", () => {
    expect(hasFeature("builder", "revenueRecognition")).toBe(false);
  });

  it("getLimit('free', 'maxLedgers') → 1", () => {
    expect(getLimit("free", "maxLedgers")).toBe(1);
  });

  it("getLimit('platform', 'maxLedgers') → null (unlimited)", () => {
    expect(getLimit("platform", "maxLedgers")).toBeNull();
  });

  it("getLimit('builder', 'maxTransactionsPerMonth') → 1000", () => {
    expect(getLimit("builder", "maxTransactionsPerMonth")).toBe(1000);
  });

  it("all tiers have consistent feature keys", () => {
    const freeKeys = Object.keys(TIER_CONFIGS.free.features).sort();
    for (const tier of ["builder", "pro", "platform"] as const) {
      const keys = Object.keys(TIER_CONFIGS[tier].features).sort();
      expect(keys).toEqual(freeKeys);
    }
  });
});

// =========================================================================
// Usage period tests
// =========================================================================

describe("Usage Period", () => {
  it("getCurrentUsagePeriod returns correct month bounds", () => {
    const { periodStart, periodEnd } = getCurrentUsagePeriod();
    const now = new Date();

    // Period start should be 1st of current month
    expect(periodStart).toMatch(/^\d{4}-\d{2}-01$/);

    // Period end should be last day of current month
    const expectedEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    expect(periodEnd).toBe(expectedEnd.toISOString().split("T")[0]);
  });
});

// =========================================================================
// Usage tracking tests (with database)
// =========================================================================

describe("Usage Tracking", () => {
  let db: Database;
  let userId: string;
  let ledgerId: string;

  beforeEach(async () => {
    db = await createTestDb();
    userId = await createUser(db, "free");
    ledgerId = await createLedger(db, userId);
  });

  it("getOrCreateUsageRecord creates a new record", async () => {
    const record = await getOrCreateUsageRecord(db, userId, ledgerId);
    expect(record).toBeDefined();
    expect(record.user_id).toBe(userId);
    expect(record.ledger_id).toBe(ledgerId);
    expect(record.transactions_count).toBe(0);
    expect(record.invoices_count).toBe(0);
  });

  it("getOrCreateUsageRecord returns existing record", async () => {
    const record1 = await getOrCreateUsageRecord(db, userId, ledgerId);
    const record2 = await getOrCreateUsageRecord(db, userId, ledgerId);
    expect(record1.id).toBe(record2.id);
  });

  it("incrementUsage increments atomically", async () => {
    await getOrCreateUsageRecord(db, userId, ledgerId);
    await incrementUsage(db, userId, ledgerId, "transactions_count");
    await incrementUsage(db, userId, ledgerId, "transactions_count");
    await incrementUsage(db, userId, ledgerId, "transactions_count");

    const record = await getOrCreateUsageRecord(db, userId, ledgerId);
    expect(record.transactions_count).toBe(3);
  });

  it("incrementUsage works for different fields", async () => {
    await incrementUsage(db, userId, ledgerId, "invoices_count");
    await incrementUsage(db, userId, ledgerId, "invoices_count");

    const record = await getOrCreateUsageRecord(db, userId, ledgerId);
    expect(record.invoices_count).toBe(2);
    expect(record.transactions_count).toBe(0);
  });

  it("checkLimit returns allowed: true when under limit", async () => {
    const result = await checkLimit(db, userId, ledgerId, "transactions");
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(100); // free tier
  });

  it("checkLimit returns allowed: false when at limit", async () => {
    // Manually set transactions to the limit
    await getOrCreateUsageRecord(db, userId, ledgerId);
    const { periodStart } = getCurrentUsagePeriod();
    await db.run(
      "UPDATE usage_tracking SET transactions_count = 100 WHERE user_id = ? AND ledger_id = ? AND period_start = ?",
      [userId, ledgerId, periodStart],
    );

    const result = await checkLimit(db, userId, ledgerId, "transactions");
    expect(result.allowed).toBe(false);
    expect(result.used).toBe(100);
    expect(result.limit).toBe(100);
  });

  it("checkLimit returns allowed: true when limit is null (unlimited)", async () => {
    // Upgrade user to platform
    await db.run("UPDATE users SET plan = 'platform' WHERE id = ?", [userId]);

    const result = await checkLimit(db, userId, ledgerId, "transactions");
    expect(result.allowed).toBe(true);
    expect(result.limit).toBeNull();
  });

  it("checkLimit for ledgers checks total ledger count", async () => {
    // Free tier allows 1 ledger, we already have 1
    const result = await checkLimit(db, userId, undefined, "ledgers");
    expect(result.allowed).toBe(false);
    expect(result.used).toBe(1);
    expect(result.limit).toBe(1);
  });

  it("checkLimit for ledgers allows builder with multiple ledgers", async () => {
    await db.run("UPDATE users SET plan = 'builder' WHERE id = ?", [userId]);
    const result = await checkLimit(db, userId, undefined, "ledgers");
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(3);
  });

  it("getUsageSummary aggregates across ledgers", async () => {
    // Create a second ledger
    await db.run("UPDATE users SET plan = 'builder' WHERE id = ?", [userId]);
    const ledger2 = await createLedger(db, userId);

    // Add usage to both ledgers
    await incrementUsage(db, userId, ledgerId, "transactions_count");
    await incrementUsage(db, userId, ledgerId, "transactions_count");
    await incrementUsage(db, userId, ledger2, "transactions_count");
    await incrementUsage(db, userId, ledgerId, "invoices_count");

    const summary = await getUsageSummary(db, userId);
    expect(summary.tier).toBe("builder");
    expect(summary.ledgerCount).toBe(2);
    expect(summary.transactions.used).toBe(3);
    expect(summary.transactions.limit).toBe(1000);
    expect(summary.transactions.remaining).toBe(997);
    expect(summary.invoices.used).toBe(1);
    expect(summary.invoices.limit).toBeNull(); // builder has unlimited invoices
    expect(summary.invoices.remaining).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Revenue Recognition tests
//
// Core invariants under test:
// 1. Schedule creation distributes amounts correctly across periods
// 2. Recognition processing posts balanced transactions
// 3. Schedule lifecycle (pause, cancel, resume, completion)
// 4. Metrics (MRR, deferred revenue balance) are calculated correctly
// 5. Edge cases (1-month schedule, odd division, rounding)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteDatabase } from "../src/db/sqlite.js";
import { LedgerEngine } from "../src/engine/index.js";
import type { Database } from "../src/db/database.js";
import {
  createRevenueSchedule,
  getRevenueSchedule,
  listRevenueSchedules,
  updateRevenueSchedule,
  cancelSchedule,
  processRevenueRecognition,
  getRevenueMetrics,
  getMrrHistory,
  ensureRevenueAccounts,
  monthsBetween,
  generateMonthlyPeriods,
} from "../src/revenue/index.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const loadMigration = (name: string): string =>
  readFileSync(resolve(__dirname, `../src/db/migrations/${name}`), "utf-8");

const createTestDb = async (): Promise<Database> => {
  const db = await SqliteDatabase.create();
  const schema = loadMigration("001_initial_schema.sqlite.sql");
  const schemaWithoutPragmas = schema
    .split("\n")
    .filter((line) => !line.trim().startsWith("PRAGMA"))
    .join("\n");
  await db.exec(schemaWithoutPragmas);
  // Apply additional migrations needed for account currency column and revenue tables
  await db.exec(loadMigration("006_multi_currency.sqlite.sql"));
  await db.exec(loadMigration("016_revenue_recognition.sqlite.sql"));
  return db;
};

const createSystemUser = async (db: Database): Promise<string> => {
  const userId = "00000000-0000-7000-8000-000000000001";
  await db.run(
    `INSERT INTO users (id, email, name, auth_provider, auth_provider_id)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, "system@test.com", "System", "test", "test-001"],
  );
  return userId;
};

/** Create a ledger with the required accounts for revenue recognition tests. */
const setupLedger = async (
  engine: LedgerEngine,
  ownerId: string,
): Promise<{
  ledgerId: string;
  deferredAccountId: string;
  revenueAccountId: string;
}> => {
  const ledger = await engine.createLedger({ name: "Test SaaS", ownerId });
  if (!ledger.ok) throw new Error("Failed to create ledger");
  const ledgerId = ledger.value.id;

  const deferred = await engine.createAccount({
    ledgerId,
    code: "2500",
    name: "Deferred Revenue",
    type: "liability",
  });
  if (!deferred.ok) throw new Error("Failed to create deferred revenue account");

  const revenue = await engine.createAccount({
    ledgerId,
    code: "4000",
    name: "Subscription Revenue",
    type: "revenue",
  });
  if (!revenue.ok) throw new Error("Failed to create revenue account");

  return {
    ledgerId,
    deferredAccountId: deferred.value.id,
    revenueAccountId: revenue.value.id,
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Revenue Recognition", () => {
  let db: Database;
  let engine: LedgerEngine;
  let ownerId: string;

  beforeEach(async () => {
    db = await createTestDb();
    engine = new LedgerEngine(db);
    ownerId = await createSystemUser(db);
  });

  // -----------------------------------------------------------------------
  // Date helpers
  // -----------------------------------------------------------------------

  describe("monthsBetween", () => {
    it("counts months inclusive of start and end", () => {
      expect(monthsBetween("2025-01-01", "2025-12-31")).toBe(12);
      expect(monthsBetween("2025-01-01", "2025-03-31")).toBe(3);
      expect(monthsBetween("2025-06-01", "2025-06-30")).toBe(1);
    });

    it("handles cross-year spans", () => {
      expect(monthsBetween("2024-11-01", "2025-02-28")).toBe(4);
    });
  });

  describe("generateMonthlyPeriods", () => {
    it("generates 12 monthly periods for a full year", () => {
      const periods = generateMonthlyPeriods("2025-01-01", "2025-12-31");
      expect(periods).toHaveLength(12);
      expect(periods[0]).toEqual({ periodStart: "2025-01-01", periodEnd: "2025-01-31" });
      expect(periods[11]).toEqual({ periodStart: "2025-12-01", periodEnd: "2025-12-31" });
    });

    it("handles February correctly", () => {
      const periods = generateMonthlyPeriods("2025-02-01", "2025-02-28");
      expect(periods).toHaveLength(1);
      expect(periods[0]).toEqual({ periodStart: "2025-02-01", periodEnd: "2025-02-28" });
    });
  });

  // -----------------------------------------------------------------------
  // Schedule creation
  // -----------------------------------------------------------------------

  describe("createRevenueSchedule", () => {
    it("creates a 12-month schedule for $1,200 — 12 entries of $100 each", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      const result = await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 120000, // $1,200.00
        recognitionStart: "2025-01-01",
        recognitionEnd: "2025-12-31",
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
        customerName: "Acme Corp",
        description: "Annual subscription",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const schedule = result.value;
      expect(schedule.totalAmount).toBe(120000);
      expect(schedule.amountRemaining).toBe(120000);
      expect(schedule.amountRecognised).toBe(0);
      expect(schedule.status).toBe("active");
      expect(schedule.entries).toHaveLength(12);

      // Each entry should be $100.00
      for (const entry of schedule.entries) {
        expect(entry.amount).toBe(10000);
        expect(entry.status).toBe("pending");
      }

      // Verify total sums correctly
      const totalEntryAmount = schedule.entries.reduce((sum, e) => sum + e.amount, 0);
      expect(totalEntryAmount).toBe(120000);
    });

    it("creates a 3-month schedule for $100 — last entry gets rounding remainder", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      const result = await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 10000, // $100.00
        recognitionStart: "2025-01-01",
        recognitionEnd: "2025-03-31",
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
        customerName: "Small Co",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const entries = result.value.entries;
      expect(entries).toHaveLength(3);

      // 10000 / 3 = 3333 per period, last gets 3334
      expect(entries[0]!.amount).toBe(3333);
      expect(entries[1]!.amount).toBe(3333);
      expect(entries[2]!.amount).toBe(3334); // remainder

      const total = entries.reduce((sum, e) => sum + e.amount, 0);
      expect(total).toBe(10000);
    });

    it("creates a 1-month schedule (no spreading needed)", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      const result = await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 5000,
        recognitionStart: "2025-03-01",
        recognitionEnd: "2025-03-31",
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.entries).toHaveLength(1);
      expect(result.value.entries[0]!.amount).toBe(5000);
    });

    it("handles odd division ($1,000 / 3 months = $333, $333, $334)", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      const result = await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 100000, // $1,000.00
        recognitionStart: "2025-01-01",
        recognitionEnd: "2025-03-31",
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const entries = result.value.entries;
      expect(entries[0]!.amount).toBe(33333);
      expect(entries[1]!.amount).toBe(33333);
      expect(entries[2]!.amount).toBe(33334); // remainder

      const total = entries.reduce((sum, e) => sum + e.amount, 0);
      expect(total).toBe(100000);
    });

    it("rejects schedule where end <= start", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      const result = await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 10000,
        recognitionStart: "2025-06-01",
        recognitionEnd: "2025-01-01",
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_INPUT");
    });

    it("rejects zero or negative total amount", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      const result = await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 0,
        recognitionStart: "2025-01-01",
        recognitionEnd: "2025-12-31",
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
      });

      expect(result.ok).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Recognition processing
  // -----------------------------------------------------------------------

  describe("processRevenueRecognition", () => {
    it("posts a transaction for due entries and updates amounts", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      // Create a 3-month schedule starting 2025-01-01
      const schedResult = await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 30000,
        recognitionStart: "2025-01-01",
        recognitionEnd: "2025-03-31",
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
        customerName: "Test Customer",
      });
      expect(schedResult.ok).toBe(true);
      if (!schedResult.ok) return;

      // Process as of end of January
      const result = await processRevenueRecognition(db, engine, ledgerId, "2025-01-31");
      expect(result.processed).toBe(1);
      expect(result.totalRecognised).toBe(10000);

      // Verify schedule was updated
      const updated = await getRevenueSchedule(db, schedResult.value.id);
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;

      expect(updated.value.amountRecognised).toBe(10000);
      expect(updated.value.amountRemaining).toBe(20000);
      expect(updated.value.status).toBe("active");

      // Verify entry was marked as posted
      const postedEntry = updated.value.entries.find((e) => e.status === "posted");
      expect(postedEntry).toBeDefined();
      expect(postedEntry!.transactionId).toBeTruthy();

      // Verify the posted transaction is balanced (debits === credits)
      const txn = await engine.getTransaction(postedEntry!.transactionId!);
      expect(txn.ok).toBe(true);
      if (!txn.ok) return;

      const debits = txn.value.lines
        .filter((l) => l.direction === "debit")
        .reduce((sum, l) => sum + l.amount, 0);
      const credits = txn.value.lines
        .filter((l) => l.direction === "credit")
        .reduce((sum, l) => sum + l.amount, 0);
      expect(debits).toBe(credits);
      expect(debits).toBe(10000);
    });

    it("completes schedule when all entries are processed", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      const schedResult = await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 30000,
        recognitionStart: "2025-01-01",
        recognitionEnd: "2025-03-31",
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
        customerName: "Complete Co",
      });
      expect(schedResult.ok).toBe(true);
      if (!schedResult.ok) return;

      // Process all three months
      await processRevenueRecognition(db, engine, ledgerId, "2025-01-31");
      await processRevenueRecognition(db, engine, ledgerId, "2025-02-28");
      await processRevenueRecognition(db, engine, ledgerId, "2025-03-31");

      const final = await getRevenueSchedule(db, schedResult.value.id);
      expect(final.ok).toBe(true);
      if (!final.ok) return;

      expect(final.value.status).toBe("completed");
      expect(final.value.amountRecognised).toBe(30000);
      expect(final.value.amountRemaining).toBe(0);

      // All entries should be posted
      for (const entry of final.value.entries) {
        expect(entry.status).toBe("posted");
        expect(entry.transactionId).toBeTruthy();
      }
    });

    it("does not process entries for future periods", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 30000,
        recognitionStart: "2025-01-01",
        recognitionEnd: "2025-03-31",
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
      });

      // Process as of Jan 15 — January period_end is Jan 31, so nothing is due
      const result = await processRevenueRecognition(db, engine, ledgerId, "2025-01-15");
      expect(result.processed).toBe(0);
    });

    it("is idempotent — does not double-process entries", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 30000,
        recognitionStart: "2025-01-01",
        recognitionEnd: "2025-03-31",
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
      });

      // Process January twice
      const first = await processRevenueRecognition(db, engine, ledgerId, "2025-01-31");
      expect(first.processed).toBe(1);

      const second = await processRevenueRecognition(db, engine, ledgerId, "2025-01-31");
      expect(second.processed).toBe(0); // already posted
    });
  });

  // -----------------------------------------------------------------------
  // Schedule lifecycle
  // -----------------------------------------------------------------------

  describe("cancelSchedule", () => {
    it("marks remaining entries as skipped, leaves posted entries unchanged", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      const schedResult = await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 30000,
        recognitionStart: "2025-01-01",
        recognitionEnd: "2025-03-31",
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
      });
      expect(schedResult.ok).toBe(true);
      if (!schedResult.ok) return;

      // Process January
      await processRevenueRecognition(db, engine, ledgerId, "2025-01-31");

      // Cancel
      const cancelled = await cancelSchedule(db, schedResult.value.id, "Customer churned");
      expect(cancelled.ok).toBe(true);
      if (!cancelled.ok) return;

      expect(cancelled.value.status).toBe("cancelled");

      // January entry should still be posted
      const postedEntries = cancelled.value.entries.filter((e) => e.status === "posted");
      expect(postedEntries).toHaveLength(1);

      // Feb and March entries should be skipped
      const skippedEntries = cancelled.value.entries.filter((e) => e.status === "skipped");
      expect(skippedEntries).toHaveLength(2);
    });
  });

  describe("pause / resume", () => {
    it("paused schedules skip processing", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      const schedResult = await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 30000,
        recognitionStart: "2025-01-01",
        recognitionEnd: "2025-03-31",
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
      });
      expect(schedResult.ok).toBe(true);
      if (!schedResult.ok) return;

      // Pause
      const paused = await updateRevenueSchedule(db, schedResult.value.id, { action: "pause" });
      expect(paused.ok).toBe(true);
      if (!paused.ok) return;
      expect(paused.value.status).toBe("paused");

      // Try to process — should skip paused schedule
      const result = await processRevenueRecognition(db, engine, ledgerId, "2025-01-31");
      expect(result.processed).toBe(0);

      // Resume
      const resumed = await updateRevenueSchedule(db, schedResult.value.id, { action: "resume" });
      expect(resumed.ok).toBe(true);
      if (!resumed.ok) return;
      expect(resumed.value.status).toBe("active");

      // Now processing should work
      const result2 = await processRevenueRecognition(db, engine, ledgerId, "2025-01-31");
      expect(result2.processed).toBe(1);
    });

    it("rejects pausing a non-active schedule", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      const schedResult = await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 30000,
        recognitionStart: "2025-01-01",
        recognitionEnd: "2025-03-31",
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
      });
      expect(schedResult.ok).toBe(true);
      if (!schedResult.ok) return;

      // Cancel first, then try to pause
      await cancelSchedule(db, schedResult.value.id);
      const result = await updateRevenueSchedule(db, schedResult.value.id, { action: "pause" });
      expect(result.ok).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Listing
  // -----------------------------------------------------------------------

  describe("listRevenueSchedules", () => {
    it("filters by status", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 10000,
        recognitionStart: "2025-01-01",
        recognitionEnd: "2025-03-31",
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
        customerName: "Active Co",
      });

      const sched2 = await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 20000,
        recognitionStart: "2025-01-01",
        recognitionEnd: "2025-06-30",
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
        customerName: "Cancelled Co",
      });
      if (sched2.ok) {
        await cancelSchedule(db, sched2.value.id);
      }

      const activeList = await listRevenueSchedules(db, ledgerId, { status: "active" });
      expect(activeList.data).toHaveLength(1);
      expect(activeList.data[0]!.customerName).toBe("Active Co");

      const cancelledList = await listRevenueSchedules(db, ledgerId, { status: "cancelled" });
      expect(cancelledList.data).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Metrics
  // -----------------------------------------------------------------------

  describe("getRevenueMetrics", () => {
    it("calculates MRR from active schedules", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      // Create a schedule that covers the current month
      const now = new Date();
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth();
      const startStr = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const endMonth = month + 11; // 12-month schedule
      const endYear = year + Math.floor(endMonth / 12);
      const endMo = (endMonth % 12) + 1;
      const lastDay = new Date(Date.UTC(endYear, endMo, 0)).getUTCDate();
      const endStr = `${endYear}-${String(endMo).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 120000, // $1,200
        recognitionStart: startStr,
        recognitionEnd: endStr,
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
        customerName: "MRR Test",
      });

      const metrics = await getRevenueMetrics(db, ledgerId);
      expect(metrics.mrr).toBe(10000); // $100/month
      expect(metrics.arr).toBe(120000); // $1,200/year
      expect(metrics.activeSchedules).toBe(1);
      expect(metrics.deferredRevenueBalance).toBe(120000);
    });

    it("deferred revenue balance equals sum of amount_remaining", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      const now = new Date();
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth();
      const startStr = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const endYear2 = month + 5 > 11 ? year + 1 : year;
      const endMo2 = ((month + 5) % 12) + 1;
      const lastDay2 = new Date(Date.UTC(endYear2, endMo2, 0)).getUTCDate();
      const endStr = `${endYear2}-${String(endMo2).padStart(2, "0")}-${String(lastDay2).padStart(2, "0")}`;

      await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 60000,
        recognitionStart: startStr,
        recognitionEnd: endStr,
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
      });

      await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 30000,
        recognitionStart: startStr,
        recognitionEnd: endStr,
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
      });

      const metrics = await getRevenueMetrics(db, ledgerId);
      expect(metrics.deferredRevenueBalance).toBe(90000);
    });
  });

  // -----------------------------------------------------------------------
  // Account auto-creation
  // -----------------------------------------------------------------------

  describe("ensureRevenueAccounts", () => {
    it("creates accounts when they do not exist", async () => {
      const ledger = await engine.createLedger({ name: "New Biz", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");

      const result = await ensureRevenueAccounts(db, engine, ledger.value.id);
      expect(result.deferredRevenueAccountId).toBeTruthy();
      expect(result.revenueAccountId).toBeTruthy();
      expect(result.serviceRevenueAccountId).toBeTruthy();

      // Verify accounts were created
      const accounts = await engine.listAccounts(ledger.value.id);
      if (!accounts.ok) throw new Error("Failed to list accounts");

      const codes = accounts.value.map((a) => a.code);
      expect(codes).toContain("2500");
      expect(codes).toContain("4000");
      expect(codes).toContain("4010");
    });

    it("does not duplicate accounts if they already exist", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      const result = await ensureRevenueAccounts(db, engine, ledgerId);
      expect(result.deferredRevenueAccountId).toBe(deferredAccountId);
      expect(result.revenueAccountId).toBe(revenueAccountId);
    });
  });

  // -----------------------------------------------------------------------
  // MRR History
  // -----------------------------------------------------------------------

  describe("getMrrHistory", () => {
    it("returns an array of monthly MRR entries", async () => {
      const { ledgerId, deferredAccountId, revenueAccountId } = await setupLedger(engine, ownerId);

      const now = new Date();
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth();
      const startStr = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const endMonth = month + 11;
      const endYear = year + Math.floor(endMonth / 12);
      const endMo = (endMonth % 12) + 1;
      const lastDay = new Date(Date.UTC(endYear, endMo, 0)).getUTCDate();
      const endStr = `${endYear}-${String(endMo).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: 120000,
        recognitionStart: startStr,
        recognitionEnd: endStr,
        deferredRevenueAccountId: deferredAccountId,
        revenueAccountId,
      });

      const history = await getMrrHistory(db, ledgerId, 6);
      expect(history).toHaveLength(6);

      // Current month should show MRR
      const currentEntry = history[history.length - 1]!;
      expect(currentEntry.mrr).toBe(10000);
    });
  });
});

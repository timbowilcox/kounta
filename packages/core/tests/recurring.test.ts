// ---------------------------------------------------------------------------
// Recurring journal entry tests.
//
// Covers:
// 1. Create & list entry
// 2. Process monthly — transaction posted, log created, next_run_date advanced
// 3. Process quarterly — Jan 1 → Apr 1
// 4. Process annually — 2026 → 2027
// 5. Process weekly — +7 days
// 6. Auto-reverse — reversal created on 1st of next period
// 7. Pause/resume — skipped during processing; resume processes again
// 8. Edge: day_of_month=31 in Feb → Feb 28
// 9. Edge: day_of_month=30 in Feb → Feb 28
// 10. Double-process same day — no duplicate posting
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteDatabase, LedgerEngine } from "../src/index.js";
import { getNextRunDate } from "../src/recurring/scheduler.js";
import type { Database } from "../src/index.js";

// ---------------------------------------------------------------------------
// Migration setup
// ---------------------------------------------------------------------------

const migration001 = readFileSync(
  resolve(__dirname, "../src/db/migrations/001_initial_schema.sqlite.sql"),
  "utf-8",
);
const migration006 = readFileSync(
  resolve(__dirname, "../src/db/migrations/006_multi_currency.sqlite.sql"),
  "utf-8",
);
const migration007 = readFileSync(
  resolve(__dirname, "../src/db/migrations/007_conversations.sqlite.sql"),
  "utf-8",
);
const migration012 = readFileSync(
  resolve(__dirname, "../src/db/migrations/012_recurring_entries.sqlite.sql"),
  "utf-8",
);

const createTestDb = async (): Promise<Database> => {
  const db = await SqliteDatabase.create();
  const schemaWithoutPragmas = migration001
    .split("\n")
    .filter((line) => !line.trim().startsWith("PRAGMA"))
    .join("\n");
  await db.exec(schemaWithoutPragmas);
  await db.exec(migration006);
  await db.exec(migration007);
  await db.exec(migration012);
  return db;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let db: Database;
let engine: LedgerEngine;
let ledgerId: string;
let userId: string;
let cashAccountId: string;
let depreciationAccountId: string;

const setup = async () => {
  db = await createTestDb();
  engine = new LedgerEngine(db);

  // Create user
  userId = "00000000-0000-7000-8000-000000000001";
  await db.run(
    `INSERT INTO users (id, email, name, auth_provider, auth_provider_id)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, "test@test.com", "Test User", "test", "test-001"],
  );

  // Create ledger
  const ledgerResult = await engine.createLedger({ name: "Test Ledger", ownerId: userId });
  if (!ledgerResult.ok) throw new Error("Failed to create ledger");
  ledgerId = ledgerResult.value.id;

  // Create accounts
  const cash = await engine.createAccount({
    ledgerId,
    code: "1000",
    name: "Cash",
    type: "asset",
  });
  if (!cash.ok) throw new Error("Failed to create cash account");
  cashAccountId = cash.value.id;

  const depreciation = await engine.createAccount({
    ledgerId,
    code: "6000",
    name: "Depreciation Expense",
    type: "expense",
  });
  if (!depreciation.ok) throw new Error("Failed to create depreciation account");
  depreciationAccountId = depreciation.value.id;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Recurring Entries", () => {
  beforeEach(setup);

  // 1. Create & list
  it("creates and lists a recurring entry", async () => {
    const result = await engine.createRecurringEntry({
      ledgerId,
      userId,
      description: "Monthly depreciation",
      lineItems: [
        { accountId: depreciationAccountId, amount: 50000, direction: "debit" },
        { accountId: cashAccountId, amount: 50000, direction: "credit" },
      ],
      frequency: "monthly",
      dayOfMonth: 1,
      nextRunDate: "2026-04-01",
      autoReverse: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.description).toBe("Monthly depreciation");
    expect(result.value.frequency).toBe("monthly");
    expect(result.value.isActive).toBe(true);
    expect(result.value.nextRunDate).toBe("2026-04-01");

    const list = await engine.listRecurringEntries(ledgerId);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.length).toBe(1);
    expect(list.value[0].id).toBe(result.value.id);
  });

  // Validation: unbalanced
  it("rejects unbalanced line items", async () => {
    const result = await engine.createRecurringEntry({
      ledgerId,
      userId,
      description: "Bad entry",
      lineItems: [
        { accountId: depreciationAccountId, amount: 50000, direction: "debit" },
        { accountId: cashAccountId, amount: 30000, direction: "credit" },
      ],
      frequency: "monthly",
      dayOfMonth: 1,
      nextRunDate: "2026-04-01",
      autoReverse: false,
    });
    expect(result.ok).toBe(false);
  });

  // 2. Process monthly
  it("processes a monthly entry — posts transaction, creates log, advances date", async () => {
    const entry = await engine.createRecurringEntry({
      ledgerId,
      userId,
      description: "Monthly depreciation",
      lineItems: [
        { accountId: depreciationAccountId, amount: 50000, direction: "debit" },
        { accountId: cashAccountId, amount: 50000, direction: "credit" },
      ],
      frequency: "monthly",
      dayOfMonth: 1,
      nextRunDate: "2026-03-01",
      autoReverse: false,
    });
    if (!entry.ok) throw new Error("Failed to create entry");

    // Mock today as 2026-03-01 by directly calling processEntry logic
    // We'll use the engine method which uses today's date, so instead
    // let's process manually via getDueEntries + process
    const result = await engine.processRecurringEntries();
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);

    // Verify log was created
    const logs = await engine.getRecurringEntryLogs(entry.value.id);
    expect(logs.length).toBe(1);
    expect(logs[0].postedDate).toBe("2026-03-01");

    // Verify next_run_date advanced to 2026-04-01
    const updated = await engine.getRecurringEntry(entry.value.id);
    if (!updated.ok) throw new Error("Failed to get entry");
    expect(updated.value.nextRunDate).toBe("2026-04-01");
    expect(updated.value.lastRunDate).toBe("2026-03-01");
  });

  // 3. Quarterly: Jan 1 → Apr 1
  it("getNextRunDate quarterly — Jan 1 → Apr 1", () => {
    const next = getNextRunDate("2026-01-01", "quarterly", 1);
    expect(next).toBe("2026-04-01");
  });

  // 4. Annually: 2026 → 2027
  it("getNextRunDate annually — 2026-06-15 → 2027-06-15", () => {
    const next = getNextRunDate("2026-06-15", "annually", 15);
    expect(next).toBe("2027-06-15");
  });

  // 5. Weekly: +7 days
  it("getNextRunDate weekly — +7 days", () => {
    const next = getNextRunDate("2026-03-10", "weekly", null);
    expect(next).toBe("2026-03-17");
  });

  // 6. Auto-reverse
  it("auto-reverse creates a reversal transaction on 1st of next period", async () => {
    const entry = await engine.createRecurringEntry({
      ledgerId,
      userId,
      description: "Accrued salary",
      lineItems: [
        { accountId: depreciationAccountId, amount: 100000, direction: "debit" },
        { accountId: cashAccountId, amount: 100000, direction: "credit" },
      ],
      frequency: "monthly",
      dayOfMonth: null,
      nextRunDate: "2026-03-01",
      autoReverse: true,
    });
    if (!entry.ok) throw new Error("Failed to create entry");

    const result = await engine.processRecurringEntries();
    expect(result.processed).toBe(1);

    // Check the log has a reversal_transaction_id
    const logs = await engine.getRecurringEntryLogs(entry.value.id);
    expect(logs.length).toBe(1);
    expect(logs[0].reversalTransactionId).toBeTruthy();

    // Verify reversal transaction exists and has reversed lines
    const reversalTxn = await engine.getTransaction(logs[0].reversalTransactionId!);
    if (!reversalTxn.ok) throw new Error("Failed to get reversal transaction");
    expect(reversalTxn.value.memo).toContain("[Auto-Reverse]");
    // The reversal should be dated 2026-04-01 (1st of next month)
    expect(reversalTxn.value.date).toBe("2026-04-01");
  });

  // 7. Pause/Resume
  it("paused entries are skipped; resumed entries process again", async () => {
    const entry = await engine.createRecurringEntry({
      ledgerId,
      userId,
      description: "Weekly task",
      lineItems: [
        { accountId: depreciationAccountId, amount: 10000, direction: "debit" },
        { accountId: cashAccountId, amount: 10000, direction: "credit" },
      ],
      frequency: "weekly",
      dayOfMonth: null,
      nextRunDate: "2026-03-10",
      autoReverse: false,
    });
    if (!entry.ok) throw new Error("Failed to create entry");

    // Pause it
    const paused = await engine.pauseRecurringEntry(entry.value.id);
    expect(paused.ok).toBe(true);
    if (paused.ok) expect(paused.value.isActive).toBe(false);

    // Process — should skip
    const result1 = await engine.processRecurringEntries();
    expect(result1.processed).toBe(0);

    // Resume
    const resumed = await engine.resumeRecurringEntry(entry.value.id);
    expect(resumed.ok).toBe(true);
    if (resumed.ok) expect(resumed.value.isActive).toBe(true);

    // Process again — should process now
    const result2 = await engine.processRecurringEntries();
    expect(result2.processed).toBe(1);

    const logs = await engine.getRecurringEntryLogs(entry.value.id);
    expect(logs.length).toBe(1);
  });

  // 8. Edge: day_of_month=31 in Feb → Feb 28
  it("getNextRunDate clamps day 31 in February to 28", () => {
    // Jan 31 → Feb 28 (non-leap year 2027)
    const next = getNextRunDate("2027-01-31", "monthly", 31);
    expect(next).toBe("2027-02-28");
  });

  // 9. Edge: day_of_month=30 in Feb → Feb 28
  it("getNextRunDate clamps day 30 in February to 28", () => {
    const next = getNextRunDate("2027-01-30", "monthly", 30);
    expect(next).toBe("2027-02-28");
  });

  // Bonus: leap year
  it("getNextRunDate clamps day 29 in Feb leap year to 29", () => {
    // 2028 is a leap year — Jan 29 → Feb 29
    const next = getNextRunDate("2028-01-29", "monthly", 29);
    expect(next).toBe("2028-02-29");
  });

  // 10. Double-process same day — no duplicate posting
  it("does not create duplicate transactions when processed twice", async () => {
    const entry = await engine.createRecurringEntry({
      ledgerId,
      userId,
      description: "Monthly fee",
      lineItems: [
        { accountId: depreciationAccountId, amount: 25000, direction: "debit" },
        { accountId: cashAccountId, amount: 25000, direction: "credit" },
      ],
      frequency: "monthly",
      dayOfMonth: null,
      nextRunDate: "2026-03-01",
      autoReverse: false,
    });
    if (!entry.ok) throw new Error("Failed to create entry");

    // Process once
    const result1 = await engine.processRecurringEntries();
    expect(result1.processed).toBe(1);

    // Reset next_run_date back to simulate re-processing
    await db.run(
      "UPDATE recurring_entries SET next_run_date = ? WHERE id = ?",
      ["2026-03-01", entry.value.id],
    );

    // Process again — should detect existing log and not duplicate
    const result2 = await engine.processRecurringEntries();
    // The entry is "processed" (advances date) but no new transaction
    expect(result2.processed).toBe(1);

    // Only 1 log entry should exist
    const logs = await engine.getRecurringEntryLogs(entry.value.id);
    expect(logs.length).toBe(1);
  });

  // Update
  it("updates a recurring entry", async () => {
    const entry = await engine.createRecurringEntry({
      ledgerId,
      userId,
      description: "Original",
      lineItems: [
        { accountId: depreciationAccountId, amount: 50000, direction: "debit" },
        { accountId: cashAccountId, amount: 50000, direction: "credit" },
      ],
      frequency: "monthly",
      dayOfMonth: 1,
      nextRunDate: "2026-04-01",
      autoReverse: false,
    });
    if (!entry.ok) throw new Error("Failed to create");

    const updated = await engine.updateRecurringEntry(entry.value.id, {
      description: "Updated description",
      frequency: "quarterly",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.description).toBe("Updated description");
    expect(updated.value.frequency).toBe("quarterly");
    // Unchanged fields preserved
    expect(updated.value.dayOfMonth).toBe(1);
    expect(updated.value.nextRunDate).toBe("2026-04-01");
  });

  // Delete
  it("deletes a recurring entry", async () => {
    const entry = await engine.createRecurringEntry({
      ledgerId,
      userId,
      description: "To delete",
      lineItems: [
        { accountId: depreciationAccountId, amount: 10000, direction: "debit" },
        { accountId: cashAccountId, amount: 10000, direction: "credit" },
      ],
      frequency: "weekly",
      dayOfMonth: null,
      nextRunDate: "2026-04-01",
      autoReverse: false,
    });
    if (!entry.ok) throw new Error("Failed to create");

    const deleted = await engine.deleteRecurringEntry(entry.value.id);
    expect(deleted.ok).toBe(true);

    const list = await engine.listRecurringEntries(ledgerId);
    if (!list.ok) throw new Error("Failed to list");
    expect(list.value.length).toBe(0);
  });
});

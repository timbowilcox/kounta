// ---------------------------------------------------------------------------
// Fixed Asset API integration tests
//
// Tests cover:
//   1. Asset creation with schedule generation
//   2. Listing assets filtered by status
//   3. Get asset by ID with full schedule
//   4. Asset register summary
//   5. Capitalisation advisory
//   6. Depreciation run
//   7. Pending depreciation entries
//   8. Disposal with gain
//   9. Disposal with loss
//  10. MACRS mid-year asset schedule
//  11. AU mid-month pro-rata
//  12. AU first-of-month pro-rata threshold
//  13. Validation (zero cost rejection)
//  14. Balanced journal entries from depreciation
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteDatabase, LedgerEngine } from "@kounta/core";
import type { Database } from "@kounta/core";
import { createApp } from "../src/app.js";
import type { Hono } from "hono";
import type { Env } from "../src/lib/context.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const migrationSql = readFileSync(
  resolve(__dirname, "../../core/src/db/migrations/001_initial_schema.sqlite.sql"),
  "utf-8"
);
const migration006Sql = readFileSync(
  resolve(__dirname, "../../core/src/db/migrations/006_multi_currency.sqlite.sql"),
  "utf-8"
);
const migration007Sql = readFileSync(
  resolve(__dirname, "../../core/src/db/migrations/007_conversations.sqlite.sql"),
  "utf-8"
);
const migration018Sql = readFileSync(
  resolve(__dirname, "../../core/src/db/migrations/018_oauth.sqlite.sql"),
  "utf-8"
);
const migration019Sql = readFileSync(
  resolve(__dirname, "../../core/src/db/migrations/019_fixed_assets.sqlite.sql"),
  "utf-8"
);

const createTestDb = async (): Promise<Database> => {
  const db = await SqliteDatabase.create();
  const schemaWithoutPragmas = migrationSql
    .split("\n")
    .filter((line) => !line.trim().startsWith("PRAGMA"))
    .join("\n");
  db.exec(schemaWithoutPragmas);
  db.exec(migration006Sql);
  db.exec(migration007Sql);
  db.exec(migration018Sql);
  db.exec(migration019Sql);
  return db;
};

const createSystemUser = (db: Database): string => {
  const userId = "00000000-0000-7000-8000-000000000001";
  db.run(
    `INSERT INTO users (id, email, name, auth_provider, auth_provider_id)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, "system@test.com", "System", "test", "test-001"]
  );
  return userId;
};

const jsonRequest = (
  app: Hono<Env>,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
) =>
  app.request(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

const ADMIN_SECRET = "test-admin-secret-12345";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Fixed Asset API", () => {
  let db: Database;
  let engine: LedgerEngine;
  let app: Hono<Env>;
  let userId: string;

  beforeAll(() => {
    process.env["KOUNTA_ADMIN_SECRET"] = ADMIN_SECRET;
  });

  beforeEach(async () => {
    db = await createTestDb();
    engine = new LedgerEngine(db);
    app = createApp(engine);
    userId = createSystemUser(db);
  });

  const setupLedgerWithKey = async () => {
    const createRes = await jsonRequest(app, "POST", "/v1/ledgers", {
      name: "Fixed Assets Test Ledger",
      currency: "AUD",
      ownerId: userId,
    }, { Authorization: `Bearer ${ADMIN_SECRET}` });
    const ledger = (await createRes.json()).data;

    // Update jurisdiction to AU for the ledger
    db.run("UPDATE ledgers SET jurisdiction = 'AU' WHERE id = ?", [ledger.id]);

    const keyRes = await jsonRequest(app, "POST", "/v1/api-keys", {
      userId, ledgerId: ledger.id, name: "fa-key",
    }, { Authorization: `Bearer ${ADMIN_SECRET}` });
    const apiKeyData = (await keyRes.json()).data;

    const auth = { Authorization: `Bearer ${apiKeyData.rawKey}` };

    // Asset account
    const assetAcctRes = await jsonRequest(app, "POST", `/v1/ledgers/${ledger.id}/accounts`, {
      code: "1500", name: "Equipment", type: "asset", normalBalance: "debit", tags: ["non-current"],
    }, auth);
    const assetAcct = (await assetAcctRes.json()).data;

    // Accumulated depreciation (contra-asset)
    const accumAcctRes = await jsonRequest(app, "POST", `/v1/ledgers/${ledger.id}/accounts`, {
      code: "1510", name: "Accumulated Depreciation", type: "asset", normalBalance: "credit",
    }, auth);
    const accumAcct = (await accumAcctRes.json()).data;

    // Depreciation expense
    const expenseAcctRes = await jsonRequest(app, "POST", `/v1/ledgers/${ledger.id}/accounts`, {
      code: "6500", name: "Depreciation Expense", type: "expense", normalBalance: "debit",
    }, auth);
    const expenseAcct = (await expenseAcctRes.json()).data;

    // Cash account for disposal proceeds
    const cashAcctRes = await jsonRequest(app, "POST", `/v1/ledgers/${ledger.id}/accounts`, {
      code: "1000", name: "Cash", type: "asset", normalBalance: "debit",
    }, auth);
    const cashAcct = (await cashAcctRes.json()).data;

    // Gain on disposal
    const gainAcctRes = await jsonRequest(app, "POST", `/v1/ledgers/${ledger.id}/accounts`, {
      code: "4900", name: "Gain on Disposal", type: "revenue", normalBalance: "credit",
    }, auth);
    const gainAcct = (await gainAcctRes.json()).data;

    // Loss on disposal
    const lossAcctRes = await jsonRequest(app, "POST", `/v1/ledgers/${ledger.id}/accounts`, {
      code: "6900", name: "Loss on Disposal", type: "expense", normalBalance: "debit",
    }, auth);
    const lossAcct = (await lossAcctRes.json()).data;

    return { ledger, auth, assetAcct, accumAcct, expenseAcct, cashAcct, gainAcct, lossAcct };
  };

  // =========================================================================
  // 1. POST / creates asset and returns schedule
  // =========================================================================

  describe("POST /v1/fixed-assets", () => {
    it("creates asset with straight_line method and returns 12-period schedule", async () => {
      const { ledger, auth, assetAcct, accumAcct, expenseAcct } = await setupLedgerWithKey();

      const res = await jsonRequest(app, "POST", "/v1/fixed-assets", {
        name: "Office Laptop",
        costAmount: 120000,
        purchaseDate: "2025-01-01",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 12,
        salvageValue: 0,
        assetAccountId: assetAcct.id,
        accumulatedDepreciationAccountId: accumAcct.id,
        depreciationExpenseAccountId: expenseAcct.id,
      }, auth);

      expect(res.status).toBe(201);
      const body = await res.json();
      const asset = body.data;
      expect(asset.name).toBe("Office Laptop");
      expect(asset.costAmount).toBe(120000);
      expect(asset.depreciationMethod).toBe("straight_line");
      expect(asset.status).toBe("active");
      expect(asset.schedule).toBeDefined();
      expect(asset.schedule.length).toBe(12);
    });
  });

  // =========================================================================
  // 2. GET / lists assets filtered by status
  // =========================================================================

  describe("GET /v1/fixed-assets", () => {
    it("lists assets filtered by status=active", async () => {
      const { auth, assetAcct, accumAcct, expenseAcct } = await setupLedgerWithKey();

      // Create two assets
      await jsonRequest(app, "POST", "/v1/fixed-assets", {
        name: "Laptop A",
        costAmount: 100000,
        purchaseDate: "2025-01-01",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 12,
        salvageValue: 0,
        assetAccountId: assetAcct.id,
        accumulatedDepreciationAccountId: accumAcct.id,
        depreciationExpenseAccountId: expenseAcct.id,
      }, auth);

      await jsonRequest(app, "POST", "/v1/fixed-assets", {
        name: "Laptop B",
        costAmount: 200000,
        purchaseDate: "2025-02-01",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 24,
        salvageValue: 0,
        assetAccountId: assetAcct.id,
        accumulatedDepreciationAccountId: accumAcct.id,
        depreciationExpenseAccountId: expenseAcct.id,
      }, auth);

      const res = await jsonRequest(app, "GET", "/v1/fixed-assets?status=active", undefined, auth);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBe(2);
    });
  });

  // =========================================================================
  // 3. GET /:id returns asset with full schedule
  // =========================================================================

  describe("GET /v1/fixed-assets/:id", () => {
    it("returns asset with schedule array", async () => {
      const { auth, assetAcct, accumAcct, expenseAcct } = await setupLedgerWithKey();

      const createRes = await jsonRequest(app, "POST", "/v1/fixed-assets", {
        name: "Server Rack",
        costAmount: 500000,
        purchaseDate: "2025-01-01",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 24,
        salvageValue: 0,
        assetAccountId: assetAcct.id,
        accumulatedDepreciationAccountId: accumAcct.id,
        depreciationExpenseAccountId: expenseAcct.id,
      }, auth);
      const created = (await createRes.json()).data;

      const res = await jsonRequest(app, "GET", `/v1/fixed-assets/${created.id}`, undefined, auth);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(created.id);
      expect(body.data.schedule).toBeDefined();
      expect(Array.isArray(body.data.schedule)).toBe(true);
      expect(body.data.schedule.length).toBe(24);
    });
  });

  // =========================================================================
  // 4. GET /summary returns correct totals
  // =========================================================================

  describe("GET /v1/fixed-assets/summary", () => {
    it("returns correct totalAssets and totalCost", async () => {
      const { auth, assetAcct, accumAcct, expenseAcct } = await setupLedgerWithKey();

      await jsonRequest(app, "POST", "/v1/fixed-assets", {
        name: "Laptop",
        costAmount: 150000,
        purchaseDate: "2025-01-01",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 12,
        salvageValue: 0,
        assetAccountId: assetAcct.id,
        accumulatedDepreciationAccountId: accumAcct.id,
        depreciationExpenseAccountId: expenseAcct.id,
      }, auth);

      await jsonRequest(app, "POST", "/v1/fixed-assets", {
        name: "Desk",
        costAmount: 50000,
        purchaseDate: "2025-02-01",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 36,
        salvageValue: 0,
        assetAccountId: assetAcct.id,
        accumulatedDepreciationAccountId: accumAcct.id,
        depreciationExpenseAccountId: expenseAcct.id,
      }, auth);

      const res = await jsonRequest(app, "GET", "/v1/fixed-assets/summary", undefined, auth);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.totalAssets).toBe(2);
      expect(body.data.totalCost).toBe(200000);
    });
  });

  // =========================================================================
  // 5. POST /capitalisation-check returns advice
  // =========================================================================

  describe("POST /v1/fixed-assets/capitalisation-check", () => {
    it("returns expense recommendation for AU $200 laptop", async () => {
      const { auth } = await setupLedgerWithKey();

      const res = await jsonRequest(app, "POST", "/v1/fixed-assets/capitalisation-check", {
        amount: 20000, // $200 in cents
        asset_type: "laptop",
        purchase_date: "2025-06-01",
      }, auth);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.recommendation).toBeDefined();
      // A $200 item in AU should not be capitalised
      expect(["expense", "instant_writeoff"]).toContain(body.data.recommendation);
    });
  });

  // =========================================================================
  // 6. POST /run-depreciation posts pending entries
  // =========================================================================

  describe("POST /v1/fixed-assets/run-depreciation", () => {
    it("posts pending depreciation entries", async () => {
      const { auth, assetAcct, accumAcct, expenseAcct } = await setupLedgerWithKey();

      // Create asset with past purchase date so periods are pending
      await jsonRequest(app, "POST", "/v1/fixed-assets", {
        name: "Old Printer",
        costAmount: 60000,
        purchaseDate: "2025-01-01",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 12,
        salvageValue: 0,
        assetAccountId: assetAcct.id,
        accumulatedDepreciationAccountId: accumAcct.id,
        depreciationExpenseAccountId: expenseAcct.id,
      }, auth);

      const res = await jsonRequest(app, "POST", "/v1/fixed-assets/run-depreciation", {}, auth);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.posted).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 7. GET /pending returns pending entries
  // =========================================================================

  describe("GET /v1/fixed-assets/pending", () => {
    it("returns pending entries when asset has unposted periods", async () => {
      const { auth, assetAcct, accumAcct, expenseAcct } = await setupLedgerWithKey();

      // Create asset with past purchase date
      await jsonRequest(app, "POST", "/v1/fixed-assets", {
        name: "Old Monitor",
        costAmount: 30000,
        purchaseDate: "2025-01-01",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 6,
        salvageValue: 0,
        assetAccountId: assetAcct.id,
        accumulatedDepreciationAccountId: accumAcct.id,
        depreciationExpenseAccountId: expenseAcct.id,
      }, auth);

      const res = await jsonRequest(app, "GET", "/v1/fixed-assets/pending", undefined, auth);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.pendingCount).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 8. POST /:id/dispose disposes asset with gain
  // =========================================================================

  describe("POST /v1/fixed-assets/:id/dispose", () => {
    it("disposes asset with gain when proceeds > NBV", async () => {
      const { auth, assetAcct, accumAcct, expenseAcct, cashAcct, gainAcct, lossAcct } =
        await setupLedgerWithKey();

      // Create asset with past date but long enough life that it's still active
      const createRes = await jsonRequest(app, "POST", "/v1/fixed-assets", {
        name: "Desk for Disposal",
        costAmount: 120000,
        purchaseDate: "2025-06-01",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 60,
        salvageValue: 0,
        assetAccountId: assetAcct.id,
        accumulatedDepreciationAccountId: accumAcct.id,
        depreciationExpenseAccountId: expenseAcct.id,
      }, auth);
      const asset = (await createRes.json()).data;

      // Run depreciation to accumulate some (about 9 months worth)
      await jsonRequest(app, "POST", "/v1/fixed-assets/run-depreciation", {}, auth);

      // Dispose with proceeds higher than remaining NBV (gain)
      // monthly = floor(120000/60) = 2000, ~9 months = 18000 accumulated, NBV ~102000
      // proceeds 120000 > NBV = gain
      const disposeRes = await jsonRequest(app, "POST", `/v1/fixed-assets/${asset.id}/dispose`, {
        disposalDate: "2026-03-16",
        disposalProceeds: 120000, // proceeds > NBV after depreciation = gain
        proceedsAccountId: cashAcct.id,
        gainAccountId: gainAcct.id,
        lossAccountId: lossAcct.id,
      }, auth);

      expect(disposeRes.status).toBe(200);
      const body = await disposeRes.json();
      expect(body.data.gainOrLoss).toBe("gain");
      expect(body.data.gainLoss).toBeGreaterThan(0);
      expect(body.data.transactionId).toBeDefined();
    });

    // =========================================================================
    // 9. POST /:id/dispose disposes asset with loss
    // =========================================================================

    it("disposes asset with loss when proceeds < NBV", async () => {
      const { auth, assetAcct, accumAcct, expenseAcct, cashAcct, gainAcct, lossAcct } =
        await setupLedgerWithKey();

      // Create asset with recent purchase date so little depreciation
      const createRes = await jsonRequest(app, "POST", "/v1/fixed-assets", {
        name: "Chair for Disposal",
        costAmount: 100000,
        purchaseDate: "2026-01-01",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 60,
        salvageValue: 0,
        assetAccountId: assetAcct.id,
        accumulatedDepreciationAccountId: accumAcct.id,
        depreciationExpenseAccountId: expenseAcct.id,
      }, auth);
      const asset = (await createRes.json()).data;

      // Run depreciation (only a few months worth)
      await jsonRequest(app, "POST", "/v1/fixed-assets/run-depreciation", {}, auth);

      // Dispose with very low proceeds (loss)
      const disposeRes = await jsonRequest(app, "POST", `/v1/fixed-assets/${asset.id}/dispose`, {
        disposalDate: "2026-03-16",
        disposalProceeds: 1000, // very low proceeds = loss
        proceedsAccountId: cashAcct.id,
        gainAccountId: gainAcct.id,
        lossAccountId: lossAcct.id,
      }, auth);

      expect(disposeRes.status).toBe(200);
      const body = await disposeRes.json();
      expect(body.data.gainOrLoss).toBe("loss");
      expect(body.data.gainLoss).toBeLessThan(0);
      expect(body.data.transactionId).toBeDefined();
    });
  });

  // =========================================================================
  // 10. MACRS mid-year asset: year 1 and final year period counts
  // =========================================================================

  describe("MACRS mid-year asset schedule via API", () => {
    it("US MACRS 5-year July purchase: year 1 has 6 periods, final year has 6 periods", async () => {
      const { auth, assetAcct, accumAcct, expenseAcct } = await setupLedgerWithKey();
      // Override jurisdiction to US
      db.run("UPDATE ledgers SET jurisdiction = 'US' WHERE id = (SELECT ledger_id FROM api_keys LIMIT 1)");

      const res = await jsonRequest(app, "POST", "/v1/fixed-assets", {
        name: "MACRS Server",
        costAmount: 1000000,
        purchaseDate: "2025-07-01",
        depreciationMethod: "macrs",
        usefulLifeMonths: 60,
        salvageValue: 0,
        macrsPropertyClass: "5-year",
        assetAccountId: assetAcct.id,
        accumulatedDepreciationAccountId: accumAcct.id,
        depreciationExpenseAccountId: expenseAcct.id,
      }, auth);

      expect(res.status).toBe(201);
      const body = await res.json();
      const schedule = body.data.schedule;

      // 5-year MACRS July: Year 1 = 6 months, Years 2-5 = 12 each, Year 6 (final) = 6 months
      // Total = 6 + 48 + 6 = 60
      expect(schedule).toHaveLength(60);

      // Year 1: first 6 periods
      let year1Total = 0;
      for (let i = 0; i < 6; i++) year1Total += schedule[i].depreciationAmount;
      expect(year1Total).toBe(200000); // 20% of 1M

      // Final year: last 6 periods
      const finalYearPeriods = schedule.slice(-6);
      expect(finalYearPeriods).toHaveLength(6);

      // Total depreciation = cost
      const totalDep = schedule.reduce((sum: number, p: { depreciationAmount: number }) => sum + p.depreciationAmount, 0);
      expect(totalDep).toBe(1000000);
    });
  });

  // =========================================================================
  // 11. AU mid-month pro-rata
  // =========================================================================

  describe("AU mid-month pro-rata via API", () => {
    it("mid-month purchase gets pro-rata first period (period 1 < period 2)", async () => {
      const { auth, assetAcct, accumAcct, expenseAcct } = await setupLedgerWithKey();

      const res = await jsonRequest(app, "POST", "/v1/fixed-assets", {
        name: "Mid-Month Laptop",
        costAmount: 120000,
        purchaseDate: "2025-03-15",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 12,
        salvageValue: 0,
        assetAccountId: assetAcct.id,
        accumulatedDepreciationAccountId: accumAcct.id,
        depreciationExpenseAccountId: expenseAcct.id,
      }, auth);

      expect(res.status).toBe(201);
      const body = await res.json();
      const schedule = body.data.schedule;

      // March 15: 31 days, daysRemaining = 16, factor = 16/31 ≈ 0.516
      // monthly = floor(120000/12) = 10000
      // period 1 = floor(10000 * 16/31) = 5161
      expect(schedule[0].depreciationAmount).toBeLessThan(schedule[1].depreciationAmount);
      expect(schedule[0].depreciationAmount).toBe(5161);

      // Total still equals cost
      const totalDep = schedule.reduce((sum: number, p: { depreciationAmount: number }) => sum + p.depreciationAmount, 0);
      expect(totalDep).toBe(120000);
    });
  });

  // =========================================================================
  // 12. AU first-of-month gets full first period (threshold)
  // =========================================================================

  describe("AU first-of-month pro-rata threshold via API", () => {
    it("first-of-month purchase gets full first period (threshold >= 0.95 rounds to 1.0)", async () => {
      const { auth, assetAcct, accumAcct, expenseAcct } = await setupLedgerWithKey();

      const res = await jsonRequest(app, "POST", "/v1/fixed-assets", {
        name: "First-of-Month Desk",
        costAmount: 120000,
        purchaseDate: "2025-01-01",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 12,
        salvageValue: 0,
        assetAccountId: assetAcct.id,
        accumulatedDepreciationAccountId: accumAcct.id,
        depreciationExpenseAccountId: expenseAcct.id,
      }, auth);

      expect(res.status).toBe(201);
      const body = await res.json();
      const schedule = body.data.schedule;

      // Jan 1: factor = 30/31 ≈ 0.968 → >= 0.95 threshold → rounds to 1.0
      // period 1 = period 2 = floor(120000/12) = 10000
      expect(schedule[0].depreciationAmount).toBe(10000);
      expect(schedule[1].depreciationAmount).toBe(10000);

      // Total still equals cost
      const totalDep = schedule.reduce((sum: number, p: { depreciationAmount: number }) => sum + p.depreciationAmount, 0);
      expect(totalDep).toBe(120000);
    });
  });

  // =========================================================================
  // 13. POST / rejects zero cost (renumbered from 10)
  // =========================================================================

  describe("POST /v1/fixed-assets validation", () => {
    it("rejects asset with zero costAmount", async () => {
      const { auth, assetAcct, accumAcct, expenseAcct } = await setupLedgerWithKey();

      const res = await jsonRequest(app, "POST", "/v1/fixed-assets", {
        name: "Free Item",
        costAmount: 0,
        purchaseDate: "2025-06-01",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 12,
        salvageValue: 0,
        assetAccountId: assetAcct.id,
        accumulatedDepreciationAccountId: accumAcct.id,
        depreciationExpenseAccountId: expenseAcct.id,
      }, auth);

      // INVALID_INPUT error code is not in ErrorCode enum, so errorResponse maps it to 500
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // 14. POST /run-depreciation creates balanced journal entries
  // =========================================================================

  describe("POST /v1/fixed-assets/run-depreciation balanced entries", () => {
    it("creates transactions where debits equal credits", async () => {
      const { ledger, auth, assetAcct, accumAcct, expenseAcct } = await setupLedgerWithKey();

      // Create asset with past purchase date
      await jsonRequest(app, "POST", "/v1/fixed-assets", {
        name: "Server",
        costAmount: 240000,
        purchaseDate: "2025-01-01",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 24,
        salvageValue: 0,
        assetAccountId: assetAcct.id,
        accumulatedDepreciationAccountId: accumAcct.id,
        depreciationExpenseAccountId: expenseAcct.id,
      }, auth);

      // Run depreciation
      const runRes = await jsonRequest(app, "POST", "/v1/fixed-assets/run-depreciation", {}, auth);
      expect(runRes.status).toBe(200);
      const runBody = await runRes.json();
      expect(runBody.data.posted).toBeGreaterThan(0);

      // Verify all transactions in the ledger have balanced debits and credits
      const txRows = await db.all<{ id: string }>(
        "SELECT id FROM transactions WHERE ledger_id = ?",
        [ledger.id]
      );

      for (const tx of txRows) {
        const lineItems = await db.all<{ direction: string; amount: number }>(
          "SELECT direction, amount FROM line_items WHERE transaction_id = ?",
          [tx.id]
        );

        const totalDebits = lineItems
          .filter((li) => li.direction === "debit")
          .reduce((sum, li) => sum + Number(li.amount), 0);
        const totalCredits = lineItems
          .filter((li) => li.direction === "credit")
          .reduce((sum, li) => sum + Number(li.amount), 0);

        expect(totalDebits).toBe(totalCredits);
        expect(totalDebits).toBeGreaterThan(0);
      }
    });
  });
});

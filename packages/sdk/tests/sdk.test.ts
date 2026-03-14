// ---------------------------------------------------------------------------
// SDK integration tests — exercises every module against the real Hono API.
//
// Uses the SDK's custom fetch option to route requests through Hono's
// in-memory handler, backed by an in-memory SQLite database.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteDatabase, LedgerEngine } from "@kounta/core";
import type { Database } from "@kounta/core";
import { createApp } from "../../api/src/app.js";
import { Kounta, KountaApiError, ErrorCode } from "../src/index.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const migration001 = readFileSync(
  resolve(__dirname, "../../core/src/db/migrations/001_initial_schema.sqlite.sql"),
  "utf-8",
);

const migration002 = readFileSync(
  resolve(__dirname, "../../core/src/db/migrations/002_audit_action_updated.sqlite.sql"),
  "utf-8",
);

const migration006 = readFileSync(
  resolve(__dirname, "../../core/src/db/migrations/006_multi_currency.sqlite.sql"),
  "utf-8",
);
const migration007 = readFileSync(
  resolve(__dirname, "../../core/src/db/migrations/007_conversations.sqlite.sql"),
  "utf-8",
);

const createTestDb = async (): Promise<Database> => {
  const db = await SqliteDatabase.create();
  const sql = [migration001, migration002, migration006, migration007]
    .join("\n")
    .split("\n")
    .filter((line) => !line.trim().startsWith("PRAGMA"))
    .join("\n");
  db.exec(sql);
  return db;
};

const ADMIN_SECRET = "test-admin-secret";

const createSystemUser = (db: Database): string => {
  const userId = "00000000-0000-7000-8000-000000000001";
  db.run(
    `INSERT INTO users (id, email, name, auth_provider, auth_provider_id)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, "sdk@test.com", "SDK User", "test", "test-sdk-001"],
  );
  return userId;
};

/**
 * Build a fetch function that dispatches directly to the Hono app,
 * bypassing the network entirely.
 */
const createLocalFetch = (app: ReturnType<typeof createApp>): typeof globalThis.fetch => {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const req = new Request(url, init);
    return app.fetch(req);
  };
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("@kounta/sdk", () => {
  let db: Database;
  let userId: string;
  let client: Kounta;
  let ledgerId: string;
  let apiKeyRaw: string;

  beforeAll(async () => {
    // Set admin secret so the adminAuth middleware recognises our token
    process.env["KOUNTA_ADMIN_SECRET"] = ADMIN_SECRET;

    db = await createTestDb();
    const engine = new LedgerEngine(db);
    const app = createApp(engine);

    // Use admin client first to bootstrap a ledger and API key
    userId = createSystemUser(db);

    const adminClient = new Kounta({
      apiKey: "unused",
      adminSecret: ADMIN_SECRET,
      baseUrl: "http://localhost",
      fetch: createLocalFetch(app),
    });

    // Create a ledger
    const ledger = await adminClient.ledgers.create({
      name: "SDK Test Ledger",
      ownerId: userId,
    });
    ledgerId = ledger.id;

    // Create an API key for the ledger
    const keyResult = await adminClient.apiKeys.create({
      userId,
      ledgerId,
      name: "sdk-test-key",
    });
    apiKeyRaw = keyResult.rawKey;

    // Now create the primary client using the API key
    client = new Kounta({
      apiKey: apiKeyRaw,
      adminSecret: ADMIN_SECRET,
      baseUrl: "http://localhost",
      fetch: createLocalFetch(app),
    });
  });

  // -------------------------------------------------------------------------
  // Ledgers
  // -------------------------------------------------------------------------

  describe("ledgers", () => {
    it("gets a ledger by ID", async () => {
      const ledger = await client.ledgers.get(ledgerId);
      expect(ledger.id).toBe(ledgerId);
      expect(ledger.name).toBe("SDK Test Ledger");
      expect(ledger.currency).toBe("USD");
      expect(ledger.status).toBe("active");
    });

    it("creates a ledger (admin)", async () => {
      const ledger = await client.ledgers.create({
        name: "Second Ledger",
        ownerId: userId,
        currency: "EUR",
      });
      expect(ledger.name).toBe("Second Ledger");
      expect(ledger.currency).toBe("EUR");
    });

    it("throws KountaApiError for inaccessible ledger", async () => {
      try {
        // API key is scoped to our test ledger, so accessing another ID → 403
        await client.ledgers.get("00000000-0000-7000-8000-000000000099");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(KountaApiError);
        const err = e as KountaApiError;
        expect(err.status).toBe(403);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Accounts
  // -------------------------------------------------------------------------

  describe("accounts", () => {
    it("creates an account", async () => {
      const acct = await client.accounts.create(ledgerId, {
        code: "1000",
        name: "Cash",
        type: "asset",
      });
      expect(acct.code).toBe("1000");
      expect(acct.name).toBe("Cash");
      expect(acct.type).toBe("asset");
      expect(acct.normalBalance).toBe("debit");
    });

    it("creates a second account", async () => {
      const acct = await client.accounts.create(ledgerId, {
        code: "4000",
        name: "Revenue",
        type: "revenue",
      });
      expect(acct.code).toBe("4000");
      expect(acct.normalBalance).toBe("credit");
    });

    it("lists accounts with balances", async () => {
      const accounts = await client.accounts.list(ledgerId);
      expect(accounts.length).toBeGreaterThanOrEqual(2);
      const cash = accounts.find((a) => a.code === "1000");
      expect(cash).toBeDefined();
      expect(cash!.balance).toBe(0);
    });

    it("gets a single account with balance", async () => {
      const accounts = await client.accounts.list(ledgerId);
      const cash = accounts.find((a) => a.code === "1000")!;

      const acct = await client.accounts.get(ledgerId, cash.id);
      expect(acct.id).toBe(cash.id);
      expect(acct.code).toBe("1000");
      expect(typeof acct.balance).toBe("number");
    });

    it("throws for duplicate account code", async () => {
      try {
        await client.accounts.create(ledgerId, {
          code: "1000",
          name: "Duplicate Cash",
          type: "asset",
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(KountaApiError);
        expect((e as KountaApiError).code).toBe(ErrorCode.DUPLICATE_ACCOUNT_CODE);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Transactions
  // -------------------------------------------------------------------------

  let transactionId: string;

  describe("transactions", () => {
    it("posts a balanced transaction", async () => {
      const txn = await client.transactions.post(ledgerId, {
        date: "2024-06-15",
        memo: "First sale",
        lines: [
          { accountCode: "1000", amount: 5000, direction: "debit" },
          { accountCode: "4000", amount: 5000, direction: "credit" },
        ],
      });
      transactionId = txn.id;
      expect(txn.memo).toBe("First sale");
      expect(txn.status).toBe("posted");
      expect(txn.lines).toHaveLength(2);

      // Debits must equal credits
      const debits = txn.lines.filter((l) => l.direction === "debit").reduce((s, l) => s + l.amount, 0);
      const credits = txn.lines.filter((l) => l.direction === "credit").reduce((s, l) => s + l.amount, 0);
      expect(debits).toBe(credits);
    });

    it("gets a transaction by ID", async () => {
      const txn = await client.transactions.get(ledgerId, transactionId);
      expect(txn.id).toBe(transactionId);
      expect(txn.lines).toHaveLength(2);
    });

    it("lists transactions (paginated)", async () => {
      // Post a second transaction
      await client.transactions.post(ledgerId, {
        date: "2024-06-16",
        memo: "Second sale",
        lines: [
          { accountCode: "1000", amount: 3000, direction: "debit" },
          { accountCode: "4000", amount: 3000, direction: "credit" },
        ],
      });

      const page = await client.transactions.list(ledgerId, { limit: 1 });
      expect(page.data).toHaveLength(1);
      // Should have a cursor for the next page
      expect(page.nextCursor).not.toBeNull();

      // Fetch second page
      const page2 = await client.transactions.list(ledgerId, {
        cursor: page.nextCursor!,
        limit: 10,
      });
      expect(page2.data.length).toBeGreaterThanOrEqual(1);
    });

    it("reverses a transaction", async () => {
      const reversal = await client.transactions.reverse(
        ledgerId,
        transactionId,
        "Customer refund",
      );
      expect(reversal.status).toBe("posted");
      expect(reversal.memo).toContain("Reversal");

      // The original should now be marked reversed
      const original = await client.transactions.get(ledgerId, transactionId);
      expect(original.status).toBe("reversed");
    });

    it("rejects unbalanced transaction", async () => {
      try {
        await client.transactions.post(ledgerId, {
          date: "2024-06-17",
          memo: "Unbalanced",
          lines: [
            { accountCode: "1000", amount: 1000, direction: "debit" },
            { accountCode: "4000", amount: 999, direction: "credit" },
          ],
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(KountaApiError);
        expect((e as KountaApiError).code).toBe(ErrorCode.UNBALANCED_TRANSACTION);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  describe("reports", () => {
    it("generates an income statement", async () => {
      const report = await client.reports.incomeStatement(
        ledgerId,
        "2024-01-01",
        "2024-12-31",
      );
      expect(report.statementType).toBe("pnl");
      expect(report.ledgerId).toBe(ledgerId);
      expect(report.currency).toBe("USD");
      expect(report.sections).toBeDefined();
      expect(typeof report.plainLanguageSummary).toBe("string");
    });

    it("generates a balance sheet", async () => {
      const report = await client.reports.balanceSheet(ledgerId, "2024-12-31");
      expect(report.statementType).toBe("balance_sheet");
      expect(report.sections).toBeDefined();
    });

    it("generates a cash-flow statement", async () => {
      const report = await client.reports.cashFlow(ledgerId, "2024-01-01", "2024-12-31");
      expect(report.statementType).toBe("cash_flow");
      expect(report.sections).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  describe("audit", () => {
    it("lists audit entries", async () => {
      const page = await client.audit.list(ledgerId, { limit: 5 });
      expect(page.data.length).toBeGreaterThan(0);

      const entry = page.data[0]!;
      expect(entry.ledgerId).toBe(ledgerId);
      expect(typeof entry.action).toBe("string");
      expect(typeof entry.entityType).toBe("string");
    });
  });

  // -------------------------------------------------------------------------
  // Imports
  // -------------------------------------------------------------------------

  describe("imports", () => {
    it("uploads a CSV import", async () => {
      const csv = "date,amount,payee\n2024-07-01,250.00,Acme Corp";
      const result = await client.imports.upload(ledgerId, {
        fileContent: csv,
        fileType: "csv",
        filename: "bank-july.csv",
      });

      expect(result.batch.sourceType).toBe("csv");
      expect(result.batch.filename).toBe("bank-july.csv");
      expect(result.batch.rowCount).toBe(1);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.payee).toBe("Acme Corp");
      expect(result.rows[0]!.amount).toBe(25000);
    });

    it("uploads an OFX import", async () => {
      const ofx = `
<STMTTRN>
<DTPOSTED>20240701
<TRNAMT>-50.00
<NAME>Coffee Shop
</STMTTRN>`;

      const result = await client.imports.upload(ledgerId, {
        fileContent: ofx,
        fileType: "ofx",
      });

      expect(result.batch.sourceType).toBe("ofx");
      expect(result.rows[0]!.amount).toBe(-5000);
    });

    it("gets an import batch by ID", async () => {
      const csv = "date,amount,payee\n2024-08-01,100.00,Vendor";
      const upload = await client.imports.upload(ledgerId, {
        fileContent: csv,
        fileType: "csv",
      });

      const batch = await client.imports.get(upload.batch.id);
      expect(batch.batch.id).toBe(upload.batch.id);
      expect(batch.rows).toHaveLength(1);
    });

    it("lists import batches", async () => {
      const page = await client.imports.list(ledgerId);
      expect(page.data.length).toBeGreaterThanOrEqual(2);
    });

    it("confirms matches", async () => {
      const csv = "date,amount,payee\n2024-09-01,100.00,TestCo";
      const upload = await client.imports.upload(ledgerId, {
        fileContent: csv,
        fileType: "csv",
      });

      const row = upload.rows[0]!;
      const result = await client.imports.confirmMatches(upload.batch.id, [
        { rowId: row.id, action: "reject" },
      ]);

      const updated = result.rows.find((r) => r.id === row.id);
      expect(updated!.matchStatus).toBe("unmatched");
    });

    it("throws for invalid CSV", async () => {
      try {
        await client.imports.upload(ledgerId, {
          fileContent: "garbage with no csv structure",
          fileType: "csv",
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(KountaApiError);
        expect((e as KountaApiError).code).toBe(ErrorCode.IMPORT_PARSE_ERROR);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  describe("templates", () => {
    it("lists all templates", async () => {
      const templates = await client.templates.list();
      expect(templates.length).toBeGreaterThanOrEqual(8);
      const saas = templates.find((t) => t.slug === "saas");
      expect(saas).toBeDefined();
      expect(saas!.chartOfAccounts.length).toBeGreaterThan(0);
    });

    it("gets a template by slug", async () => {
      const template = await client.templates.get("saas");
      expect(template.slug).toBe("saas");
      expect(template.name).toBeTruthy();
    });

    it("recommends templates", async () => {
      const recs = await client.templates.recommend({
        industry: "software",
        businessModel: "subscription",
      });
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0]!.score).toBeGreaterThan(0);
      expect(typeof recs[0]!.reason).toBe("string");
    });

    it("applies a template to a ledger (admin)", async () => {
      // Create a fresh ledger for template application
      const ledger = await client.ledgers.create({
        name: "Template Test",
        ownerId: userId,
      });

      const result = await client.templates.apply(ledger.id, "saas");
      expect(result.count).toBeGreaterThan(0);
      expect(result.accounts.length).toBe(result.count);
    });
  });

  // -------------------------------------------------------------------------
  // API Keys
  // -------------------------------------------------------------------------

  describe("apiKeys", () => {
    it("creates an API key (admin)", async () => {
      const key = await client.apiKeys.create({
        userId,
        ledgerId,
        name: "test-key-2",
      });
      expect(key.rawKey).toBeTruthy();
      expect(key.prefix).toBeTruthy();
      expect(key.name).toBe("test-key-2");
    });

    it("lists API keys for a ledger (admin)", async () => {
      const keys = await client.apiKeys.list(ledgerId);
      expect(keys.length).toBeGreaterThanOrEqual(2);
      // Raw key and hash should not be present in list results
      for (const key of keys) {
        expect(key).not.toHaveProperty("keyHash");
        expect(key).not.toHaveProperty("rawKey");
      }
    });

    it("revokes an API key (admin)", async () => {
      const created = await client.apiKeys.create({
        userId,
        ledgerId,
        name: "key-to-revoke",
      });

      const revoked = await client.apiKeys.revoke(created.id);
      expect(revoked.status).toBe("revoked");
      expect(revoked).not.toHaveProperty("keyHash");
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("KountaApiError has structured fields", async () => {
      try {
        await client.transactions.post(ledgerId, {
          date: "2024-01-01",
          memo: "Unbalanced",
          lines: [
            { accountCode: "1000", amount: 100, direction: "debit" },
            { accountCode: "4000", amount: 50, direction: "credit" },
          ],
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        const err = e as KountaApiError;
        expect(err.name).toBe("KountaApiError");
        expect(err.status).toBe(400);
        expect(err.code).toBe(ErrorCode.UNBALANCED_TRANSACTION);
        expect(err.message).toBeTruthy();
        expect(err instanceof Error).toBe(true);
      }
    });

    it("adminSecret is required for admin operations", async () => {
      const noAdmin = new Kounta({
        apiKey: apiKeyRaw,
        baseUrl: "http://localhost",
        fetch: async () => new Response("", { status: 200 }),
      });

      await expect(
        noAdmin.ledgers.create({ name: "Fail", ownerId: userId }),
      ).rejects.toThrow("adminSecret is required");
    });
  });

  // -------------------------------------------------------------------------
  // Client configuration
  // -------------------------------------------------------------------------

  describe("configuration", () => {
    it("strips trailing slashes from baseUrl", () => {
      const c = new Kounta({
        apiKey: "ldg_test",
        baseUrl: "https://api.example.com///",
      });
      expect(c._baseUrl).toBe("https://api.example.com");
    });

    it("defaults baseUrl to production", () => {
      const c = new Kounta({ apiKey: "ldg_test" });
      expect(c._baseUrl).toBe("https://api.kounta.ai");
    });

    it("exposes all modules", () => {
      const c = new Kounta({ apiKey: "ldg_test" });
      expect(c.ledgers).toBeDefined();
      expect(c.accounts).toBeDefined();
      expect(c.transactions).toBeDefined();
      expect(c.reports).toBeDefined();
      expect(c.audit).toBeDefined();
      expect(c.imports).toBeDefined();
      expect(c.templates).toBeDefined();
      expect(c.apiKeys).toBeDefined();
    });
  });
});

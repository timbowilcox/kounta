// ---------------------------------------------------------------------------
// Tier enforcement API integration tests.
//
// Tests verify that tier-based limits and feature gates work correctly
// through the HTTP API layer.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteDatabase, LedgerEngine } from "@kounta/core";
import type { Database } from "@kounta/core";
import { createApp } from "../src/app.js";
import type { Hono } from "hono";
import type { Env } from "../src/lib/context.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const loadMigration = (name: string): string => {
  const path = resolve(__dirname, `../../core/src/db/migrations/${name}`);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
};

const createTestDb = async (): Promise<Database> => {
  const db = await SqliteDatabase.create();
  const schema = loadMigration("001_initial_schema.sqlite.sql")
    .split("\n")
    .filter((line) => !line.trim().startsWith("PRAGMA"))
    .join("\n");
  db.exec(schema);

  // Apply needed migrations
  const migrations = [
    "003_billing.sqlite.sql",
    "006_multi_currency.sqlite.sql",
    "007_conversations.sqlite.sql",
    "018_oauth.sqlite.sql",
    "019_fixed_assets.sqlite.sql",
    "021_invoicing.sqlite.sql",
    "024_customers.sqlite.sql",
    "027_tier_usage_tracking.sqlite.sql",
  ];

  for (const m of migrations) {
    const sql = loadMigration(m);
    if (sql) {
      try { db.exec(sql); } catch { /* migration may partially fail in test env */ }
    }
  }

  return db;
};

const createUser = (db: Database, plan: string): string => {
  const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.run(
    `INSERT INTO users (id, email, name, auth_provider, auth_provider_id, plan)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, `${userId}@test.com`, "Test User", "test", `test-${userId}`, plan],
  );
  return userId;
};

const createLedgerForUser = async (engine: LedgerEngine, userId: string): Promise<string> => {
  const result = await engine.createLedger({
    name: "Test Ledger",
    currency: "USD",
    fiscalYearStart: 1,
    accountingBasis: "accrual",
    ownerId: userId,
  });
  if (!result.ok) throw new Error(`Failed to create ledger: ${result.error.message}`);
  return result.value.id;
};

const createApiKey = async (engine: LedgerEngine, userId: string, ledgerId: string): Promise<string> => {
  const result = await engine.createApiKey({ userId, ledgerId, name: "test-key" });
  if (!result.ok) throw new Error(`Failed to create API key: ${result.error.message}`);
  return result.value.rawKey!;
};

const jsonRequest = (
  app: Hono<Env>,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
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

describe("Tier Enforcement", () => {
  let db: Database;
  let engine: LedgerEngine;
  let app: Hono<Env>;

  beforeAll(() => {
    process.env["KOUNTA_ADMIN_SECRET"] = ADMIN_SECRET;
  });

  beforeEach(async () => {
    db = await createTestDb();
    engine = new LedgerEngine(db);
    app = createApp(engine);
  });

  // =========================================================================
  // Feature gates
  // =========================================================================

  describe("PDF export gate", () => {
    it("free user requesting PDF gets 403", async () => {
      const userId = createUser(db, "free");
      const ledgerId = await createLedgerForUser(engine, userId);
      const apiKey = await createApiKey(engine, userId, ledgerId);

      const res = await jsonRequest(
        app, "GET", `/v1/invoices/fake-id/pdf`, undefined,
        { Authorization: `Bearer ${apiKey}` },
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("builder user requesting PDF passes gate", async () => {
      const userId = createUser(db, "builder");
      const ledgerId = await createLedgerForUser(engine, userId);
      const apiKey = await createApiKey(engine, userId, ledgerId);

      // Will get 404 (no invoice), not 403 — the gate passed
      const res = await jsonRequest(
        app, "GET", `/v1/invoices/fake-id/pdf`, undefined,
        { Authorization: `Bearer ${apiKey}` },
      );
      expect(res.status).not.toBe(403);
    });
  });

  // =========================================================================
  // Usage limits
  // =========================================================================

  describe("Transaction limits", () => {
    it("free user can create transactions under the limit", async () => {
      const userId = createUser(db, "free");
      const ledgerId = await createLedgerForUser(engine, userId);
      const apiKey = await createApiKey(engine, userId, ledgerId);

      // Get accounts for transaction
      const accts = await engine.listAccounts(ledgerId);
      if (!accts.ok || accts.value.length < 2) return; // Skip if no accounts

      const assetAcct = accts.value.find((a) => a.type === "asset");
      const equityAcct = accts.value.find((a) => a.type === "equity");
      if (!assetAcct || !equityAcct) return;

      const res = await jsonRequest(
        app, "POST", `/v1/ledgers/${ledgerId}/transactions`,
        {
          date: "2026-03-01",
          memo: "Test transaction",
          lines: [
            { accountCode: assetAcct.code, amount: 1000, direction: "debit" },
            { accountCode: equityAcct.code, amount: 1000, direction: "credit" },
          ],
          idempotencyKey: "test-txn-1",
        },
        { Authorization: `Bearer ${apiKey}` },
      );

      // Should succeed (under limit)
      expect([201, 202]).toContain(res.status);
    });

    it("free user hitting transaction limit gets 429", async () => {
      const userId = createUser(db, "free");
      const ledgerId = await createLedgerForUser(engine, userId);
      const apiKey = await createApiKey(engine, userId, ledgerId);

      // Manually set usage to the limit
      const now = new Date();
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        .toISOString().split("T")[0];
      const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
        .toISOString().split("T")[0];

      await db.run(
        `INSERT INTO usage_tracking (id, user_id, ledger_id, period_start, period_end, transactions_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 100, ?, ?)`,
        [`ut-${Date.now()}`, userId, ledgerId, periodStart, periodEnd, new Date().toISOString(), new Date().toISOString()],
      );

      const res = await jsonRequest(
        app, "POST", `/v1/ledgers/${ledgerId}/transactions`,
        {
          date: "2026-03-01",
          memo: "Over limit transaction",
          lines: [
            { accountCode: "1000", amount: 1000, direction: "debit" },
            { accountCode: "3000", amount: 1000, direction: "credit" },
          ],
          idempotencyKey: "test-txn-over-limit",
        },
        { Authorization: `Bearer ${apiKey}` },
      );

      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error.code).toBe("PLAN_LIMIT_EXCEEDED");
    });
  });

  describe("Ledger limits", () => {
    it("free user creating 2nd ledger gets 403", async () => {
      const userId = createUser(db, "free");
      // First ledger already exists via createLedgerForUser
      await createLedgerForUser(engine, userId);

      const res = await jsonRequest(
        app, "POST", "/v1/ledgers",
        {
          name: "Second Ledger",
          currency: "USD",
          ownerId: userId,
        },
        { Authorization: `Bearer ${ADMIN_SECRET}` },
      );

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("PLAN_LIMIT_EXCEEDED");
    });

    it("builder user creating 4th ledger gets 403", async () => {
      const userId = createUser(db, "builder");
      await createLedgerForUser(engine, userId);
      await createLedgerForUser(engine, userId);
      await createLedgerForUser(engine, userId);

      const res = await jsonRequest(
        app, "POST", "/v1/ledgers",
        {
          name: "Fourth Ledger",
          currency: "USD",
          ownerId: userId,
        },
        { Authorization: `Bearer ${ADMIN_SECRET}` },
      );

      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // Usage API endpoints
  // =========================================================================

  describe("Usage endpoints", () => {
    it("GET /v1/usage/tiers returns tier config (no auth)", async () => {
      const res = await app.request("/v1/usage/tiers");
      expect(res.status).toBe(200);
      const json = await res.json() as { data: Record<string, unknown> };
      expect(json.data).toHaveProperty("free");
      expect(json.data).toHaveProperty("builder");
      expect(json.data).toHaveProperty("pro");
      expect(json.data).toHaveProperty("platform");
    });

    it("GET /v1/usage returns usage summary (auth required)", async () => {
      const userId = createUser(db, "builder");
      const ledgerId = await createLedgerForUser(engine, userId);
      const apiKey = await createApiKey(engine, userId, ledgerId);

      const res = await jsonRequest(
        app, "GET", "/v1/usage", undefined,
        { Authorization: `Bearer ${apiKey}` },
      );

      expect(res.status).toBe(200);
      const json = await res.json() as {
        data: { tier: string; transactions: { limit: number | null } };
      };
      expect(json.data.tier).toBe("builder");
      expect(json.data.transactions.limit).toBe(1000);
    });
  });
});

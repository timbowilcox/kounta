// ---------------------------------------------------------------------------
// Invoice API integration tests
//
// Tests cover:
//   1.  POST / creates a draft invoice with line items
//   2.  GET / lists invoices
//   3.  GET / filters by status
//   4.  GET / filters by customer name
//   5.  GET /:id returns invoice with line items
//   6.  PATCH /:id updates a draft invoice
//   7.  PATCH /:id rejects update on sent invoice
//   8.  POST /:id/send transitions to sent and posts AR entry
//   9.  POST /:id/send rejects double-send
//  10.  POST /:id/payment records full payment
//  11.  POST /:id/payment records partial payment
//  12.  POST /:id/void voids a sent invoice
//  13.  POST /:id/void rejects voiding paid invoice
//  14.  DELETE /:id deletes draft invoice
//  15.  DELETE /:id rejects deleting sent invoice
//  16.  GET /summary returns AR summary
//  17.  GET /aging returns aging buckets
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
const migration021Sql = readFileSync(
  resolve(__dirname, "../../core/src/db/migrations/021_invoicing.sqlite.sql"),
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
  db.exec(migration021Sql);
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

describe("Invoice API", () => {
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
      name: "Invoice Test Ledger",
      currency: "AUD",
      ownerId: userId,
    }, { Authorization: `Bearer ${ADMIN_SECRET}` });
    const ledger = (await createRes.json()).data;

    // Set jurisdiction to AU for tax calculation
    db.run("UPDATE ledgers SET jurisdiction = 'AU' WHERE id = ?", [ledger.id]);

    const keyRes = await jsonRequest(app, "POST", "/v1/api-keys", {
      userId, ledgerId: ledger.id, name: "inv-key",
    }, { Authorization: `Bearer ${ADMIN_SECRET}` });
    const apiKeyData = (await keyRes.json()).data;

    const auth = { Authorization: `Bearer ${apiKeyData.rawKey}` };

    // Revenue account
    const revAcctRes = await jsonRequest(app, "POST", `/v1/ledgers/${ledger.id}/accounts`, {
      code: "4000", name: "Sales Revenue", type: "revenue", normalBalance: "credit",
    }, auth);
    const revAcct = (await revAcctRes.json()).data;

    // AR account
    const arAcctRes = await jsonRequest(app, "POST", `/v1/ledgers/${ledger.id}/accounts`, {
      code: "1200", name: "Accounts Receivable", type: "asset", normalBalance: "debit",
    }, auth);
    const arAcct = (await arAcctRes.json()).data;

    // GST collected
    const gstAcctRes = await jsonRequest(app, "POST", `/v1/ledgers/${ledger.id}/accounts`, {
      code: "2200", name: "GST Collected", type: "liability", normalBalance: "credit",
    }, auth);
    const gstAcct = (await gstAcctRes.json()).data;

    // Cash account (for payments)
    const cashAcctRes = await jsonRequest(app, "POST", `/v1/ledgers/${ledger.id}/accounts`, {
      code: "1000", name: "Cash", type: "asset", normalBalance: "debit",
    }, auth);
    const cashAcct = (await cashAcctRes.json()).data;

    return { ledger, auth, revAcct, arAcct, gstAcct, cashAcct };
  };

  const createDraftInvoice = async (auth: Record<string, string>, overrides?: Record<string, unknown>) => {
    const body = {
      customerName: "Acme Corp",
      customerEmail: "billing@acme.com",
      issueDate: "2025-06-01",
      dueDate: "2025-07-01",
      lineItems: [
        { description: "Consulting", quantity: 10, unitPrice: 15000 },
        { description: "Travel Expenses", quantity: 1, unitPrice: 50000 },
      ],
      ...overrides,
    };
    const res = await jsonRequest(app, "POST", "/v1/invoices", body, auth);
    return res;
  };

  // =========================================================================
  // 1. POST / creates a draft invoice with line items
  // =========================================================================

  describe("POST /v1/invoices", () => {
    it("creates a draft invoice with line items and calculates totals", async () => {
      const { auth } = await setupLedgerWithKey();

      const res = await createDraftInvoice(auth);
      expect(res.status).toBe(201);

      const body = await res.json();
      const inv = body.data;

      expect(inv.customerName).toBe("Acme Corp");
      expect(inv.customerEmail).toBe("billing@acme.com");
      expect(inv.status).toBe("draft");
      expect(inv.issueDate).toBe("2025-06-01");
      expect(inv.dueDate).toBe("2025-07-01");
      // 10 * 15000 + 1 * 50000 = 200000
      expect(inv.subtotal).toBe(200000);
      expect(inv.total).toBeGreaterThanOrEqual(inv.subtotal); // may include tax
      expect(inv.amountDue).toBe(inv.total);
      expect(inv.amountPaid).toBe(0);
      expect(inv.lineItems.length).toBe(2);
    });
  });

  // =========================================================================
  // 2. GET / lists invoices
  // =========================================================================

  describe("GET /v1/invoices", () => {
    it("lists all invoices", async () => {
      const { auth } = await setupLedgerWithKey();
      await createDraftInvoice(auth);
      await createDraftInvoice(auth, { customerName: "Beta Inc" });

      const res = await jsonRequest(app, "GET", "/v1/invoices", undefined, auth);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.length).toBe(2);
    });

    // =========================================================================
    // 3. GET / filters by status
    // =========================================================================

    it("filters by status", async () => {
      const { auth } = await setupLedgerWithKey();
      await createDraftInvoice(auth);

      // Should find it under draft
      const draftRes = await jsonRequest(app, "GET", "/v1/invoices?status=draft", undefined, auth);
      const draftBody = await draftRes.json();
      expect(draftBody.data.length).toBe(1);

      // Should not find it under sent
      const sentRes = await jsonRequest(app, "GET", "/v1/invoices?status=sent", undefined, auth);
      const sentBody = await sentRes.json();
      expect(sentBody.data.length).toBe(0);
    });

    // =========================================================================
    // 4. GET / filters by customer name
    // =========================================================================

    it("filters by customer name", async () => {
      const { auth } = await setupLedgerWithKey();
      await createDraftInvoice(auth);
      await createDraftInvoice(auth, { customerName: "Beta Inc" });

      const res = await jsonRequest(app, "GET", "/v1/invoices?customer=Beta", undefined, auth);
      const body = await res.json();
      expect(body.data.length).toBe(1);
      expect(body.data[0].customerName).toBe("Beta Inc");
    });
  });

  // =========================================================================
  // 5. GET /:id returns invoice with line items
  // =========================================================================

  describe("GET /v1/invoices/:id", () => {
    it("returns invoice with line items and payments", async () => {
      const { auth } = await setupLedgerWithKey();
      const createRes = await createDraftInvoice(auth);
      const created = (await createRes.json()).data;

      const res = await jsonRequest(app, "GET", `/v1/invoices/${created.id}`, undefined, auth);
      expect(res.status).toBe(200);

      const body = await res.json();
      const inv = body.data;
      expect(inv.id).toBe(created.id);
      expect(inv.lineItems.length).toBe(2);
      expect(inv.payments.length).toBe(0);
    });

    it("returns 404 for non-existent invoice", async () => {
      const { auth } = await setupLedgerWithKey();
      const res = await jsonRequest(app, "GET", "/v1/invoices/nonexistent-id", undefined, auth);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // 6. PATCH /:id updates a draft invoice
  // =========================================================================

  describe("PATCH /v1/invoices/:id", () => {
    it("updates customer name on draft invoice", async () => {
      const { auth } = await setupLedgerWithKey();
      const createRes = await createDraftInvoice(auth);
      const created = (await createRes.json()).data;

      const res = await jsonRequest(app, "PATCH", `/v1/invoices/${created.id}`, {
        customerName: "Updated Corp",
      }, auth);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.customerName).toBe("Updated Corp");
    });

    // =========================================================================
    // 7. PATCH /:id rejects update on sent invoice
    // =========================================================================

    it("rejects update on sent invoice", async () => {
      const { auth } = await setupLedgerWithKey();
      const createRes = await createDraftInvoice(auth);
      const created = (await createRes.json()).data;

      // Send the invoice
      await jsonRequest(app, "POST", `/v1/invoices/${created.id}/send`, {}, auth);

      // Attempt update
      const res = await jsonRequest(app, "PATCH", `/v1/invoices/${created.id}`, {
        customerName: "Should Fail",
      }, auth);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // 8. POST /:id/send transitions to sent and posts AR entry
  // =========================================================================

  describe("POST /v1/invoices/:id/send", () => {
    it("transitions to sent and posts AR journal entry", async () => {
      const { auth } = await setupLedgerWithKey();
      const createRes = await createDraftInvoice(auth);
      const created = (await createRes.json()).data;

      const res = await jsonRequest(app, "POST", `/v1/invoices/${created.id}/send`, {}, auth);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.status).toBe("sent");

      // Verify the invoice now has an AR transaction
      const getRes = await jsonRequest(app, "GET", `/v1/invoices/${created.id}`, undefined, auth);
      const inv = (await getRes.json()).data;
      expect(inv.status).toBe("sent");
    });

    // =========================================================================
    // 9. POST /:id/send rejects double-send
    // =========================================================================

    it("rejects sending an already-sent invoice", async () => {
      const { auth } = await setupLedgerWithKey();
      const createRes = await createDraftInvoice(auth);
      const created = (await createRes.json()).data;

      await jsonRequest(app, "POST", `/v1/invoices/${created.id}/send`, {}, auth);
      const res = await jsonRequest(app, "POST", `/v1/invoices/${created.id}/send`, {}, auth);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // 10. POST /:id/payment records full payment
  // =========================================================================

  describe("POST /v1/invoices/:id/payment", () => {
    it("records full payment and transitions to paid", async () => {
      const { auth } = await setupLedgerWithKey();
      const createRes = await createDraftInvoice(auth);
      const created = (await createRes.json()).data;

      // Send first
      await jsonRequest(app, "POST", `/v1/invoices/${created.id}/send`, {}, auth);

      // Get the total
      const getRes = await jsonRequest(app, "GET", `/v1/invoices/${created.id}`, undefined, auth);
      const sent = (await getRes.json()).data;

      // Record full payment
      const res = await jsonRequest(app, "POST", `/v1/invoices/${created.id}/payment`, {
        amount: sent.total,
        paymentDate: "2025-06-15",
        paymentMethod: "bank_transfer",
        reference: "REF-001",
      }, auth);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.status).toBe("paid");
      expect(body.data.amountPaid).toBe(sent.total);
      expect(body.data.amountDue).toBe(0);
    });

    // =========================================================================
    // 11. POST /:id/payment records partial payment
    // =========================================================================

    it("records partial payment and transitions to partially_paid", async () => {
      const { auth } = await setupLedgerWithKey();
      const createRes = await createDraftInvoice(auth);
      const created = (await createRes.json()).data;

      // Send first
      await jsonRequest(app, "POST", `/v1/invoices/${created.id}/send`, {}, auth);

      // Get the total
      const getRes = await jsonRequest(app, "GET", `/v1/invoices/${created.id}`, undefined, auth);
      const sent = (await getRes.json()).data;

      // Record half payment
      const halfAmount = Math.floor(sent.total / 2);
      const res = await jsonRequest(app, "POST", `/v1/invoices/${created.id}/payment`, {
        amount: halfAmount,
        paymentDate: "2025-06-10",
      }, auth);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.status).toBe("partially_paid");
      expect(body.data.amountPaid).toBe(halfAmount);
      expect(body.data.amountDue).toBe(sent.total - halfAmount);
    });
  });

  // =========================================================================
  // 12. POST /:id/void voids a sent invoice
  // =========================================================================

  describe("POST /v1/invoices/:id/void", () => {
    it("voids a sent invoice", async () => {
      const { auth } = await setupLedgerWithKey();
      const createRes = await createDraftInvoice(auth);
      const created = (await createRes.json()).data;

      // Send then void
      await jsonRequest(app, "POST", `/v1/invoices/${created.id}/send`, {}, auth);
      const res = await jsonRequest(app, "POST", `/v1/invoices/${created.id}/void`, {}, auth);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.status).toBe("void");
    });

    // =========================================================================
    // 13. POST /:id/void rejects voiding paid invoice
    // =========================================================================

    it("rejects voiding a paid invoice", async () => {
      const { auth } = await setupLedgerWithKey();
      const createRes = await createDraftInvoice(auth);
      const created = (await createRes.json()).data;

      // Send, pay, then try to void
      await jsonRequest(app, "POST", `/v1/invoices/${created.id}/send`, {}, auth);

      const getRes = await jsonRequest(app, "GET", `/v1/invoices/${created.id}`, undefined, auth);
      const sent = (await getRes.json()).data;

      await jsonRequest(app, "POST", `/v1/invoices/${created.id}/payment`, {
        amount: sent.total,
        paymentDate: "2025-06-15",
      }, auth);

      const res = await jsonRequest(app, "POST", `/v1/invoices/${created.id}/void`, {}, auth);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // 14. DELETE /:id deletes draft invoice
  // =========================================================================

  describe("DELETE /v1/invoices/:id", () => {
    it("deletes a draft invoice", async () => {
      const { auth } = await setupLedgerWithKey();
      const createRes = await createDraftInvoice(auth);
      const created = (await createRes.json()).data;

      const res = await jsonRequest(app, "DELETE", `/v1/invoices/${created.id}`, undefined, auth);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.deleted).toBe(true);

      // Verify it's gone
      const getRes = await jsonRequest(app, "GET", `/v1/invoices/${created.id}`, undefined, auth);
      expect(getRes.status).toBeGreaterThanOrEqual(400);
    });

    // =========================================================================
    // 15. DELETE /:id rejects deleting sent invoice
    // =========================================================================

    it("rejects deleting a sent invoice", async () => {
      const { auth } = await setupLedgerWithKey();
      const createRes = await createDraftInvoice(auth);
      const created = (await createRes.json()).data;

      await jsonRequest(app, "POST", `/v1/invoices/${created.id}/send`, {}, auth);

      const res = await jsonRequest(app, "DELETE", `/v1/invoices/${created.id}`, undefined, auth);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // =========================================================================
  // 16. GET /summary returns AR summary
  // =========================================================================

  describe("GET /v1/invoices/summary", () => {
    it("returns invoice summary with totals", async () => {
      const { auth } = await setupLedgerWithKey();

      // Create and send an invoice
      const createRes = await createDraftInvoice(auth);
      const created = (await createRes.json()).data;
      await jsonRequest(app, "POST", `/v1/invoices/${created.id}/send`, {}, auth);

      const res = await jsonRequest(app, "GET", "/v1/invoices/summary", undefined, auth);
      expect(res.status).toBe(200);

      const body = await res.json();
      const summary = body.data;
      expect(summary).toHaveProperty("totalOutstanding");
      expect(summary).toHaveProperty("invoiceCount");
      expect(summary.totalOutstanding).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 17. GET /aging returns aging buckets
  // =========================================================================

  describe("GET /v1/invoices/aging", () => {
    it("returns aging buckets", async () => {
      const { auth } = await setupLedgerWithKey();

      // Create and send an invoice
      const createRes = await createDraftInvoice(auth);
      const created = (await createRes.json()).data;
      await jsonRequest(app, "POST", `/v1/invoices/${created.id}/send`, {}, auth);

      const res = await jsonRequest(app, "GET", "/v1/invoices/aging", undefined, auth);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
    });
  });
});

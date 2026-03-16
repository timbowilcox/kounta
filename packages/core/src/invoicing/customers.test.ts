// ---------------------------------------------------------------------------
// Customer CRUD & Payment Terms — Unit Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteDatabase } from "../db/sqlite.js";
import type { Database } from "../db/database.js";
import { LedgerEngine } from "../engine/index.js";
import {
  createCustomer,
  updateCustomer,
  getCustomer,
  listCustomers,
  deleteCustomer,
  getCustomerInvoiceIds,
} from "./customers.js";
import {
  calculateDueDate,
  getPaymentTermsLabel,
  PAYMENT_TERMS,
} from "./payment-terms.js";
import { createInvoice, sendInvoice } from "./engine.js";

// ---------------------------------------------------------------------------
// Shared test setup
// ---------------------------------------------------------------------------

const ledgerId = "00000000-0000-7000-8000-000000000200";
const userId = "00000000-0000-7000-8000-000000000001";
const arAccountId = "00000000-0000-7000-8000-000000000021";
const revenueAccountId = "00000000-0000-7000-8000-000000000022";

const applyMigrations = (db: Database) => {
  const m001 = readFileSync(
    resolve(__dirname, "../db/migrations/001_initial_schema.sqlite.sql"), "utf-8",
  );
  const m006 = readFileSync(
    resolve(__dirname, "../db/migrations/006_multi_currency.sqlite.sql"), "utf-8",
  );
  const m019 = readFileSync(
    resolve(__dirname, "../db/migrations/019_fixed_assets.sqlite.sql"), "utf-8",
  );
  const m021 = readFileSync(
    resolve(__dirname, "../db/migrations/021_invoicing.sqlite.sql"), "utf-8",
  );
  const m023 = readFileSync(
    resolve(__dirname, "../db/migrations/023_invoice_sent_at.sqlite.sql"), "utf-8",
  );
  const m024 = readFileSync(
    resolve(__dirname, "../db/migrations/024_customers.sqlite.sql"), "utf-8",
  );
  const schemaWithoutPragmas = m001
    .split("\n")
    .filter((line) => !line.trim().startsWith("PRAGMA"))
    .join("\n");
  db.exec(schemaWithoutPragmas);
  db.exec(m006);
  db.exec(m019);
  db.exec(m021);
  try { db.exec(m023); } catch { /* column may already exist */ }
  try { db.exec(m024); } catch { /* columns may already exist */ }
};

const seedTestData = async (db: Database) => {
  await db.run(
    `INSERT INTO users (id, email, name, auth_provider, auth_provider_id) VALUES (?, ?, ?, ?, ?)`,
    [userId, "test@test.com", "Test User", "test", "test-001"],
  );
  await db.run(
    `INSERT INTO ledgers (id, name, currency, owner_id, jurisdiction) VALUES (?, ?, ?, ?, ?)`,
    [ledgerId, "Test Ledger", "AUD", userId, "AU"],
  );
  await db.run(
    `INSERT INTO accounts (id, ledger_id, code, name, type, normal_balance) VALUES (?, ?, ?, ?, ?, ?)`,
    [arAccountId, ledgerId, "1100", "Accounts Receivable", "asset", "debit"],
  );
  await db.run(
    `INSERT INTO accounts (id, ledger_id, code, name, type, normal_balance) VALUES (?, ?, ?, ?, ?, ?)`,
    [revenueAccountId, ledgerId, "4000", "Revenue", "revenue", "credit"],
  );
};

// ---------------------------------------------------------------------------
// 1. Payment terms — calculateDueDate
// ---------------------------------------------------------------------------

describe("calculateDueDate", () => {
  it("due_on_receipt → same day as issue date", () => {
    expect(calculateDueDate("2026-03-01", "due_on_receipt")).toBe("2026-03-01");
  });

  it("net_7 → 7 days after issue date", () => {
    expect(calculateDueDate("2026-03-01", "net_7")).toBe("2026-03-08");
  });

  it("net_14 → 14 days after issue date", () => {
    expect(calculateDueDate("2026-01-15", "net_14")).toBe("2026-01-29");
  });

  it("net_15 → 15 days after issue date", () => {
    expect(calculateDueDate("2026-01-15", "net_15")).toBe("2026-01-30");
  });

  it("net_30 → 30 days after issue date", () => {
    expect(calculateDueDate("2026-01-01", "net_30")).toBe("2026-01-31");
  });

  it("net_45 → 45 days after issue date", () => {
    expect(calculateDueDate("2026-01-01", "net_45")).toBe("2026-02-15");
  });

  it("net_60 → 60 days after issue date", () => {
    expect(calculateDueDate("2026-01-01", "net_60")).toBe("2026-03-02");
  });

  it("net_90 → 90 days after issue date", () => {
    expect(calculateDueDate("2026-01-01", "net_90")).toBe("2026-04-01");
  });

  it("custom → returns issue date (caller provides due date)", () => {
    expect(calculateDueDate("2026-06-15", "custom")).toBe("2026-06-15");
  });

  it("crosses month boundary correctly", () => {
    expect(calculateDueDate("2026-01-28", "net_7")).toBe("2026-02-04");
  });

  it("crosses year boundary correctly", () => {
    expect(calculateDueDate("2025-12-15", "net_30")).toBe("2026-01-14");
  });
});

// ---------------------------------------------------------------------------
// 2. Payment terms — getPaymentTermsLabel
// ---------------------------------------------------------------------------

describe("getPaymentTermsLabel", () => {
  it("returns label for known codes", () => {
    expect(getPaymentTermsLabel("net_30")).toBe("Net 30");
    expect(getPaymentTermsLabel("due_on_receipt")).toBe("Due on receipt");
  });

  it("returns code itself for unknown codes", () => {
    expect(getPaymentTermsLabel("unknown_term")).toBe("unknown_term");
  });
});

// ---------------------------------------------------------------------------
// 3. PAYMENT_TERMS constant
// ---------------------------------------------------------------------------

describe("PAYMENT_TERMS", () => {
  it("has all expected payment terms codes", () => {
    const codes = PAYMENT_TERMS.map((t) => t.code);
    expect(codes).toContain("due_on_receipt");
    expect(codes).toContain("net_7");
    expect(codes).toContain("net_30");
    expect(codes).toContain("net_90");
    expect(codes).toContain("custom");
  });

  it("due_on_receipt has 0 days", () => {
    const term = PAYMENT_TERMS.find((t) => t.code === "due_on_receipt")!;
    expect(term.days).toBe(0);
  });

  it("custom has null days", () => {
    const term = PAYMENT_TERMS.find((t) => t.code === "custom")!;
    expect(term.days).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Customer CRUD — create
// ---------------------------------------------------------------------------

describe("createCustomer", () => {
  let db: Database;

  beforeEach(async () => {
    db = await SqliteDatabase.create();
    applyMigrations(db);
    await seedTestData(db);
  });

  it("creates a customer with minimal fields", async () => {
    const result = await createCustomer(db, ledgerId, { name: "Acme Corp" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.name).toBe("Acme Corp");
    expect(result.value.ledgerId).toBe(ledgerId);
    expect(result.value.paymentTerms).toBe("net_30"); // default
    expect(result.value.isActive).toBe(true);
    expect(result.value.email).toBeNull();
    expect(result.value.phone).toBeNull();
    expect(result.value.id).toBeTruthy();
  });

  it("creates a customer with all fields", async () => {
    const result = await createCustomer(db, ledgerId, {
      name: "Acme Corp",
      email: "billing@acme.com",
      phone: "+61 2 1234 5678",
      address: "123 Main St, Sydney NSW 2000",
      taxId: "ABN 12 345 678 901",
      paymentTerms: "net_60",
      notes: "Important client",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.name).toBe("Acme Corp");
    expect(result.value.email).toBe("billing@acme.com");
    expect(result.value.phone).toBe("+61 2 1234 5678");
    expect(result.value.address).toBe("123 Main St, Sydney NSW 2000");
    expect(result.value.taxId).toBe("ABN 12 345 678 901");
    expect(result.value.paymentTerms).toBe("net_60");
    expect(result.value.notes).toBe("Important client");
  });

  it("trims whitespace from name", async () => {
    const result = await createCustomer(db, ledgerId, { name: "  Acme Corp  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe("Acme Corp");
  });

  it("rejects empty name", async () => {
    const result = await createCustomer(db, ledgerId, { name: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects whitespace-only name", async () => {
    const result = await createCustomer(db, ledgerId, { name: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ---------------------------------------------------------------------------
// 5. Customer CRUD — get
// ---------------------------------------------------------------------------

describe("getCustomer", () => {
  let db: Database;

  beforeEach(async () => {
    db = await SqliteDatabase.create();
    applyMigrations(db);
    await seedTestData(db);
  });

  it("returns customer by id", async () => {
    const created = await createCustomer(db, ledgerId, { name: "Test Co" });
    if (!created.ok) throw new Error("create failed");

    const result = await getCustomer(db, created.value.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe("Test Co");
  });

  it("returns CUSTOMER_NOT_FOUND for nonexistent id", async () => {
    const result = await getCustomer(db, "nonexistent-id");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CUSTOMER_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// 6. Customer CRUD — update
// ---------------------------------------------------------------------------

describe("updateCustomer", () => {
  let db: Database;

  beforeEach(async () => {
    db = await SqliteDatabase.create();
    applyMigrations(db);
    await seedTestData(db);
  });

  it("updates name", async () => {
    const created = await createCustomer(db, ledgerId, { name: "Old Name" });
    if (!created.ok) throw new Error("create failed");

    const result = await updateCustomer(db, created.value.id, { name: "New Name" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe("New Name");
  });

  it("updates payment terms", async () => {
    const created = await createCustomer(db, ledgerId, { name: "Test Co" });
    if (!created.ok) throw new Error("create failed");

    const result = await updateCustomer(db, created.value.id, { paymentTerms: "net_60" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.paymentTerms).toBe("net_60");
  });

  it("updates multiple fields", async () => {
    const created = await createCustomer(db, ledgerId, { name: "Test Co" });
    if (!created.ok) throw new Error("create failed");

    const result = await updateCustomer(db, created.value.id, {
      email: "new@test.com",
      phone: "+61 400 000 000",
      notes: "Updated",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.email).toBe("new@test.com");
    expect(result.value.phone).toBe("+61 400 000 000");
    expect(result.value.notes).toBe("Updated");
  });

  it("can set fields to null", async () => {
    const created = await createCustomer(db, ledgerId, {
      name: "Test Co",
      email: "old@test.com",
    });
    if (!created.ok) throw new Error("create failed");

    const result = await updateCustomer(db, created.value.id, { email: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.email).toBeNull();
  });

  it("deactivates customer", async () => {
    const created = await createCustomer(db, ledgerId, { name: "Test Co" });
    if (!created.ok) throw new Error("create failed");

    const result = await updateCustomer(db, created.value.id, { isActive: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.isActive).toBe(false);
  });

  it("no-op update returns existing customer unchanged", async () => {
    const created = await createCustomer(db, ledgerId, { name: "Test Co" });
    if (!created.ok) throw new Error("create failed");

    const result = await updateCustomer(db, created.value.id, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe("Test Co");
  });

  it("returns CUSTOMER_NOT_FOUND for nonexistent id", async () => {
    const result = await updateCustomer(db, "nonexistent", { name: "X" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CUSTOMER_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// 7. Customer CRUD — list
// ---------------------------------------------------------------------------

describe("listCustomers", () => {
  let db: Database;

  beforeEach(async () => {
    db = await SqliteDatabase.create();
    applyMigrations(db);
    await seedTestData(db);
  });

  it("returns empty list for ledger with no customers", async () => {
    const result = await listCustomers(db, ledgerId);
    expect(result.data).toHaveLength(0);
    expect(result.cursor).toBeNull();
  });

  it("returns all customers for a ledger", async () => {
    await createCustomer(db, ledgerId, { name: "Alpha" });
    await createCustomer(db, ledgerId, { name: "Beta" });
    await createCustomer(db, ledgerId, { name: "Gamma" });

    const result = await listCustomers(db, ledgerId);
    expect(result.data).toHaveLength(3);
  });

  it("search filters by name", async () => {
    await createCustomer(db, ledgerId, { name: "Acme Corp" });
    await createCustomer(db, ledgerId, { name: "Beta Inc" });

    const result = await listCustomers(db, ledgerId, { search: "acme" });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.name).toBe("Acme Corp");
  });

  it("search filters by email", async () => {
    await createCustomer(db, ledgerId, { name: "A", email: "billing@acme.com" });
    await createCustomer(db, ledgerId, { name: "B", email: "billing@beta.com" });

    const result = await listCustomers(db, ledgerId, { search: "acme" });
    expect(result.data).toHaveLength(1);
  });

  it("isActive filter works", async () => {
    const c1 = await createCustomer(db, ledgerId, { name: "Active" });
    await createCustomer(db, ledgerId, { name: "Inactive" });
    if (c1.ok) {
      // The second one will be deactivated
    }
    // Deactivate one
    const all = await listCustomers(db, ledgerId);
    if (all.data.length === 2) {
      await updateCustomer(db, all.data[1]!.id, { isActive: false });
    }

    const active = await listCustomers(db, ledgerId, { isActive: true });
    expect(active.data).toHaveLength(1);
    expect(active.data[0]!.name).toBe("Active");
  });

  it("respects limit", async () => {
    await createCustomer(db, ledgerId, { name: "A" });
    await createCustomer(db, ledgerId, { name: "B" });
    await createCustomer(db, ledgerId, { name: "C" });

    const result = await listCustomers(db, ledgerId, { limit: 2 });
    expect(result.data).toHaveLength(2);
    expect(result.cursor).toBeTruthy(); // has more
  });

  it("does not return customers from other ledgers", async () => {
    await createCustomer(db, ledgerId, { name: "Mine" });

    const otherLedgerId = "00000000-0000-7000-8000-000000000999";
    await db.run(
      `INSERT INTO ledgers (id, name, currency, owner_id) VALUES (?, ?, ?, ?)`,
      [otherLedgerId, "Other Ledger", "USD", userId],
    );
    await createCustomer(db, otherLedgerId, { name: "Theirs" });

    const result = await listCustomers(db, ledgerId);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.name).toBe("Mine");
  });
});

// ---------------------------------------------------------------------------
// 8. Customer CRUD — delete
// ---------------------------------------------------------------------------

describe("deleteCustomer", () => {
  let db: Database;
  let engine: LedgerEngine;

  beforeEach(async () => {
    db = await SqliteDatabase.create();
    applyMigrations(db);
    await seedTestData(db);
    engine = new LedgerEngine(db);
  });

  it("hard deletes customer with no invoices", async () => {
    const created = await createCustomer(db, ledgerId, { name: "No Invoices" });
    if (!created.ok) throw new Error("create failed");

    const result = await deleteCustomer(db, created.value.id);
    expect(result.ok).toBe(true);

    // Should be gone from DB
    const check = await getCustomer(db, created.value.id);
    expect(check.ok).toBe(false);
  });

  it("soft deletes customer with non-draft invoices", async () => {
    const created = await createCustomer(db, ledgerId, { name: "Has Invoices" });
    if (!created.ok) throw new Error("create failed");

    // Create and send an invoice linked to this customer
    const inv = await createInvoice(db, ledgerId, userId, {
      customerId: created.value.id,
      customerName: "Has Invoices",
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lineItems: [{ description: "Service", quantity: 1, unitPrice: 10000 }],
      taxRate: 0,
      arAccountId,
      revenueAccountId,
    });
    if (!inv.ok) throw new Error("invoice create failed");
    await sendInvoice(db, engine, inv.value.id, ledgerId, userId);

    const result = await deleteCustomer(db, created.value.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Should still exist but be inactive
    const check = await getCustomer(db, created.value.id);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.value.isActive).toBe(false);
  });

  it("hard deletes customer with only draft invoices", async () => {
    const created = await createCustomer(db, ledgerId, { name: "Draft Only" });
    if (!created.ok) throw new Error("create failed");

    // Create a draft invoice (not sent)
    await createInvoice(db, ledgerId, userId, {
      customerId: created.value.id,
      customerName: "Draft Only",
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lineItems: [{ description: "Service", quantity: 1, unitPrice: 5000 }],
      taxRate: 0,
    });

    const result = await deleteCustomer(db, created.value.id);
    expect(result.ok).toBe(true);

    // Customer should be gone
    const check = await getCustomer(db, created.value.id);
    expect(check.ok).toBe(false);
  });

  it("returns CUSTOMER_NOT_FOUND for nonexistent id", async () => {
    const result = await deleteCustomer(db, "nonexistent-id");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CUSTOMER_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// 9. Invoice with customer_id — auto-fill behavior
// ---------------------------------------------------------------------------

describe("createInvoice with customerId", () => {
  let db: Database;

  beforeEach(async () => {
    db = await SqliteDatabase.create();
    applyMigrations(db);
    await seedTestData(db);
  });

  it("auto-fills customer name and email from customer record", async () => {
    const cust = await createCustomer(db, ledgerId, {
      name: "Auto Corp",
      email: "auto@corp.com",
      address: "456 Auto St",
      paymentTerms: "net_45",
    });
    if (!cust.ok) throw new Error("create customer failed");

    const inv = await createInvoice(db, ledgerId, userId, {
      customerId: cust.value.id,
      customerName: "", // empty → should be auto-filled from customer record
      issueDate: "2026-03-01",
      lineItems: [{ description: "Service", quantity: 1, unitPrice: 10000 }],
      taxRate: 0,
    });
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;

    expect(inv.value.customerId).toBe(cust.value.id);
    expect(inv.value.customerName).toBe("Auto Corp");
    expect(inv.value.customerEmail).toBe("auto@corp.com");
  });

  it("calculates due date from customer payment terms when dueDate not provided", async () => {
    const cust = await createCustomer(db, ledgerId, {
      name: "Terms Corp",
      paymentTerms: "net_45",
    });
    if (!cust.ok) throw new Error("create customer failed");

    const inv = await createInvoice(db, ledgerId, userId, {
      customerId: cust.value.id,
      customerName: "Terms Corp",
      issueDate: "2026-01-01",
      lineItems: [{ description: "Service", quantity: 1, unitPrice: 10000 }],
      taxRate: 0,
    });
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;

    // net_45 from Jan 1 = Feb 15
    expect(inv.value.dueDate).toBe("2026-02-15");
    expect(inv.value.paymentTerms).toBe("net_45");
  });

  it("stores customer_id on invoice", async () => {
    const cust = await createCustomer(db, ledgerId, { name: "Stored Co" });
    if (!cust.ok) throw new Error("create customer failed");

    const inv = await createInvoice(db, ledgerId, userId, {
      customerId: cust.value.id,
      customerName: "Stored Co",
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lineItems: [{ description: "X", quantity: 1, unitPrice: 100 }],
    });
    expect(inv.ok).toBe(true);
    if (inv.ok) {
      expect(inv.value.customerId).toBe(cust.value.id);
    }
  });

  it("explicit dueDate overrides payment terms calculation", async () => {
    const cust = await createCustomer(db, ledgerId, {
      name: "Override Co",
      paymentTerms: "net_90",
    });
    if (!cust.ok) throw new Error("create customer failed");

    const inv = await createInvoice(db, ledgerId, userId, {
      customerId: cust.value.id,
      customerName: "Override Co",
      issueDate: "2026-01-01",
      dueDate: "2026-01-15", // explicit, should win over net_90
      lineItems: [{ description: "X", quantity: 1, unitPrice: 100 }],
    });
    expect(inv.ok).toBe(true);
    if (inv.ok) {
      expect(inv.value.dueDate).toBe("2026-01-15");
    }
  });
});

// ---------------------------------------------------------------------------
// 10. getCustomerInvoiceIds
// ---------------------------------------------------------------------------

describe("getCustomerInvoiceIds", () => {
  let db: Database;

  beforeEach(async () => {
    db = await SqliteDatabase.create();
    applyMigrations(db);
    await seedTestData(db);
  });

  it("returns invoice ids for a customer", async () => {
    const cust = await createCustomer(db, ledgerId, { name: "Invoice Co" });
    if (!cust.ok) throw new Error("create customer failed");

    const inv1 = await createInvoice(db, ledgerId, userId, {
      customerId: cust.value.id,
      customerName: "Invoice Co",
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lineItems: [{ description: "A", quantity: 1, unitPrice: 100 }],
    });
    const inv2 = await createInvoice(db, ledgerId, userId, {
      customerId: cust.value.id,
      customerName: "Invoice Co",
      issueDate: "2026-02-01",
      dueDate: "2026-02-28",
      lineItems: [{ description: "B", quantity: 1, unitPrice: 200 }],
    });

    const ids = await getCustomerInvoiceIds(db, cust.value.id);
    expect(ids).toHaveLength(2);
    if (inv1.ok) expect(ids).toContain(inv1.value.id);
    if (inv2.ok) expect(ids).toContain(inv2.value.id);
  });

  it("returns empty array for customer with no invoices", async () => {
    const cust = await createCustomer(db, ledgerId, { name: "No Invoice Co" });
    if (!cust.ok) throw new Error("create customer failed");

    const ids = await getCustomerInvoiceIds(db, cust.value.id);
    expect(ids).toHaveLength(0);
  });
});

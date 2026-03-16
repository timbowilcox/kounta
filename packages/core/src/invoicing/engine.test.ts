// ---------------------------------------------------------------------------
// Invoicing Engine — Unit Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteDatabase } from "../db/sqlite.js";
import { LedgerEngine } from "../engine/index.js";
import type { Database } from "../db/database.js";
import {
  generateInvoiceNumber,
  calculateLineItems,
  createInvoice,
  sendInvoice,
  recordPayment,
  voidInvoice,
  getInvoiceSummary,
  getARAging,
  checkOverdueInvoices,
} from "./engine.js";

// ---------------------------------------------------------------------------
// Shared test setup
// ---------------------------------------------------------------------------

const ledgerId = "00000000-0000-7000-8000-000000000200";
const userId = "00000000-0000-7000-8000-000000000001";
const cashAccountId = "00000000-0000-7000-8000-000000000020";
const arAccountId = "00000000-0000-7000-8000-000000000021";
const revenueAccountId = "00000000-0000-7000-8000-000000000022";
const taxAccountId = "00000000-0000-7000-8000-000000000023";

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
  const m024 = readFileSync(
    resolve(__dirname, "../db/migrations/024_customers.sqlite.sql"), "utf-8",
  );
  const m025 = readFileSync(
    resolve(__dirname, "../db/migrations/025_invoice_approved_status.sqlite.sql"), "utf-8",
  );
  const schemaWithoutPragmas = m001
    .split("\n")
    .filter((line) => !line.trim().startsWith("PRAGMA"))
    .join("\n");
  db.exec(schemaWithoutPragmas);
  db.exec(m006);
  db.exec(m019);
  db.exec(m021);
  // 024 has ALTER TABLE which may fail if columns already exist in SQLite
  try { db.exec(m024); } catch { /* columns may already exist */ }
  try { db.exec(m025); } catch { /* no-op for SQLite */ }

  // SQLite cannot ALTER CHECK constraints. Drop and recreate invoices table
  // with 'approved' in the CHECK. Safe because this runs before any data is inserted.
  db.exec(`DROP TABLE IF EXISTS invoices`);
  db.exec(`
    CREATE TABLE invoices (
      id TEXT PRIMARY KEY,
      ledger_id TEXT NOT NULL REFERENCES ledgers(id),
      invoice_number TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT,
      customer_address TEXT,
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      subtotal INTEGER NOT NULL,
      tax_amount INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL,
      amount_paid INTEGER NOT NULL DEFAULT 0,
      amount_due INTEGER NOT NULL,
      currency TEXT NOT NULL,
      tax_rate REAL,
      tax_label TEXT,
      tax_inclusive INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN (
          'draft', 'approved', 'sent', 'viewed', 'paid',
          'partially_paid', 'overdue', 'void'
        )),
      paid_date TEXT,
      payment_transaction_id TEXT REFERENCES transactions(id),
      ar_transaction_id TEXT REFERENCES transactions(id),
      notes TEXT,
      footer TEXT,
      revenue_account_id TEXT REFERENCES accounts(id),
      ar_account_id TEXT REFERENCES accounts(id),
      tax_account_id TEXT REFERENCES accounts(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(ledger_id, invoice_number)
    )
  `);
  // Re-apply 023 (sent_at) and 024 (customer_id, payment_terms) on the fresh table
  try { db.exec(`ALTER TABLE invoices ADD COLUMN sent_at TEXT`); } catch { /* */ }
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
    [cashAccountId, ledgerId, "1000", "Cash", "asset", "debit"],
  );
  await db.run(
    `INSERT INTO accounts (id, ledger_id, code, name, type, normal_balance) VALUES (?, ?, ?, ?, ?, ?)`,
    [arAccountId, ledgerId, "1100", "Accounts Receivable", "asset", "debit"],
  );
  await db.run(
    `INSERT INTO accounts (id, ledger_id, code, name, type, normal_balance) VALUES (?, ?, ?, ?, ?, ?)`,
    [revenueAccountId, ledgerId, "4000", "Revenue", "revenue", "credit"],
  );
  await db.run(
    `INSERT INTO accounts (id, ledger_id, code, name, type, normal_balance) VALUES (?, ?, ?, ?, ?, ?)`,
    [taxAccountId, ledgerId, "2100", "GST Collected", "liability", "credit"],
  );
};

// ---------------------------------------------------------------------------
// 1. Invoice number generation
// ---------------------------------------------------------------------------

describe("generateInvoiceNumber", () => {
  let db: Database;

  beforeEach(async () => {
    db = await SqliteDatabase.create();
    applyMigrations(db);
    await seedTestData(db);
  });

  it("first invoice → INV-0001", async () => {
    const num = await generateInvoiceNumber(db, ledgerId);
    expect(num).toBe("INV-0001");
  });

  it("after INV-0005 → INV-0006", async () => {
    // Insert 5 invoices
    for (let i = 1; i <= 5; i++) {
      const num = `INV-${String(i).padStart(4, "0")}`;
      await db.run(
        `INSERT INTO invoices (id, ledger_id, invoice_number, customer_name, issue_date, due_date, subtotal, tax_amount, total, amount_paid, amount_due, currency, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [`inv-${i}`, ledgerId, num, "Customer", "2026-01-01", "2026-01-31", 10000, 0, 10000, 0, 10000, "AUD", "draft"],
      );
    }
    const num = await generateInvoiceNumber(db, ledgerId);
    expect(num).toBe("INV-0006");
  });

  it("custom number is respected when creating invoice", async () => {
    const result = await createInvoice(db, ledgerId, userId, {
      customerName: "Acme Corp",
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lineItems: [{ description: "Service", quantity: 1, unitPrice: 10000 }],
      invoiceNumber: "CUSTOM-001",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.invoiceNumber).toBe("CUSTOM-001");
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Line item calculation
// ---------------------------------------------------------------------------

describe("calculateLineItems", () => {
  it("single item, no tax: amount = qty × price", () => {
    const result = calculateLineItems(
      [{ description: "Widget", quantity: 3, unitPrice: 5000 }],
      null,
      false,
    );
    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0]!.amount).toBe(15000);
    expect(result.lineItems[0]!.taxAmount).toBe(0);
    expect(result.subtotal).toBe(15000);
    expect(result.total).toBe(15000);
  });

  it("single item, 10% tax exclusive: tax = amount × 0.10", () => {
    const result = calculateLineItems(
      [{ description: "Widget", quantity: 1, unitPrice: 10000 }],
      0.10,
      false,
    );
    expect(result.lineItems[0]!.amount).toBe(10000);
    expect(result.lineItems[0]!.taxAmount).toBe(1000);
    expect(result.subtotal).toBe(10000);
    expect(result.taxAmount).toBe(1000);
    expect(result.total).toBe(11000);
  });

  it("single item, 10% tax inclusive: tax extracted correctly", () => {
    const result = calculateLineItems(
      [{ description: "Widget", quantity: 1, unitPrice: 11000 }],
      0.10,
      true,
    );
    // amount = 11000, tax = 11000 - 11000/1.10 = 11000 - 10000 = 1000
    expect(result.lineItems[0]!.amount).toBe(11000);
    expect(result.lineItems[0]!.taxAmount).toBe(1000);
    expect(result.subtotal).toBe(11000);
    expect(result.total).toBe(11000); // tax-inclusive: total = subtotal
  });

  it("multiple items: totals sum correctly", () => {
    const result = calculateLineItems(
      [
        { description: "Item A", quantity: 2, unitPrice: 5000 },
        { description: "Item B", quantity: 1, unitPrice: 3000 },
      ],
      0.10,
      false,
    );
    // A: amount=10000, tax=1000; B: amount=3000, tax=300
    expect(result.subtotal).toBe(13000);
    expect(result.taxAmount).toBe(1300);
    expect(result.total).toBe(14300);
  });

  it("zero quantity: amount = 0", () => {
    const result = calculateLineItems(
      [{ description: "Free item", quantity: 0, unitPrice: 5000 }],
      0.10,
      false,
    );
    expect(result.lineItems[0]!.amount).toBe(0);
    expect(result.lineItems[0]!.taxAmount).toBe(0);
  });

  it("per-line tax override: uses line rate not invoice rate", () => {
    const result = calculateLineItems(
      [{ description: "Widget", quantity: 1, unitPrice: 10000, taxRate: 0.20 }],
      0.10, // invoice-level rate
      false,
    );
    // Should use 20% not 10%
    expect(result.lineItems[0]!.taxAmount).toBe(2000);
    expect(result.total).toBe(12000);
  });
});

// ---------------------------------------------------------------------------
// 3. Create invoice
// ---------------------------------------------------------------------------

describe("createInvoice", () => {
  let db: Database;

  beforeEach(async () => {
    db = await SqliteDatabase.create();
    applyMigrations(db);
    await seedTestData(db);
  });

  it("returns complete invoice with line items", async () => {
    const result = await createInvoice(db, ledgerId, userId, {
      customerName: "Acme Corp",
      customerEmail: "billing@acme.com",
      issueDate: "2026-01-15",
      dueDate: "2026-02-15",
      lineItems: [
        { description: "Consulting", quantity: 10, unitPrice: 15000 },
        { description: "Expenses", quantity: 1, unitPrice: 5000 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.customerName).toBe("Acme Corp");
    expect(result.value.lineItems).toHaveLength(2);
    expect(result.value.status).toBe("draft");
    expect(result.value.subtotal).toBe(155000);
    expect(result.value.currency).toBe("AUD");
  });

  it("invoice number auto-generated", async () => {
    const r1 = await createInvoice(db, ledgerId, userId, {
      customerName: "A", issueDate: "2026-01-01", dueDate: "2026-01-31",
      lineItems: [{ description: "X", quantity: 1, unitPrice: 100 }],
    });
    const r2 = await createInvoice(db, ledgerId, userId, {
      customerName: "B", issueDate: "2026-01-01", dueDate: "2026-01-31",
      lineItems: [{ description: "Y", quantity: 1, unitPrice: 100 }],
    });
    expect(r1.ok && r1.value.invoiceNumber).toBe("INV-0001");
    expect(r2.ok && r2.value.invoiceNumber).toBe("INV-0002");
  });

  it("tax defaults from jurisdiction (AU → 10% GST)", async () => {
    const result = await createInvoice(db, ledgerId, userId, {
      customerName: "Acme",
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lineItems: [{ description: "Service", quantity: 1, unitPrice: 10000 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // AU jurisdiction → GST 10% → taxRate 0.10
    expect(result.value.taxRate).toBe(0.10);
    expect(result.value.taxLabel).toBe("GST");
    expect(result.value.taxAmount).toBe(1000); // 10000 * 0.10
    expect(result.value.total).toBe(11000);
  });

  it("currency defaults from ledger", async () => {
    const result = await createInvoice(db, ledgerId, userId, {
      customerName: "Acme",
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lineItems: [{ description: "X", quantity: 1, unitPrice: 100 }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.currency).toBe("AUD");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Send invoice (posts AR journal entry)
// ---------------------------------------------------------------------------

describe("sendInvoice", () => {
  let db: Database;
  let engine: LedgerEngine;

  beforeEach(async () => {
    db = await SqliteDatabase.create();
    applyMigrations(db);
    await seedTestData(db);
    engine = new LedgerEngine(db);
  });

  it("posts AR journal entry (debit AR, credit Revenue)", async () => {
    const inv = await createInvoice(db, ledgerId, userId, {
      customerName: "Acme",
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lineItems: [{ description: "Service", quantity: 1, unitPrice: 10000 }],
      taxRate: 0,
      arAccountId,
      revenueAccountId,
    });
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;

    const result = await sendInvoice(db, engine, inv.value.id, ledgerId, userId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("approved");

    // Verify journal entry
    const arTxId = (await db.get<{ ar_transaction_id: string }>(
      "SELECT ar_transaction_id FROM invoices WHERE id = ?",
      [inv.value.id],
    ))!.ar_transaction_id;

    const arTx = await engine.getTransaction(arTxId);
    expect(arTx.ok).toBe(true);
    if (!arTx.ok) return;

    // Debits = Credits
    const debits = arTx.value.lines.filter(l => l.direction === "debit").reduce((s, l) => s + l.amount, 0);
    const credits = arTx.value.lines.filter(l => l.direction === "credit").reduce((s, l) => s + l.amount, 0);
    expect(debits).toBe(credits);
    expect(debits).toBe(10000);
  });

  it("with tax: three-line entry (AR, Revenue, GST) and balanced", async () => {
    const inv = await createInvoice(db, ledgerId, userId, {
      customerName: "Acme",
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lineItems: [{ description: "Service", quantity: 1, unitPrice: 10000 }],
      taxRate: 0.10,
      arAccountId,
      revenueAccountId,
      taxAccountId,
    });
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;

    const result = await sendInvoice(db, engine, inv.value.id, ledgerId, userId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const arTxId = (await db.get<{ ar_transaction_id: string }>(
      "SELECT ar_transaction_id FROM invoices WHERE id = ?",
      [inv.value.id],
    ))!.ar_transaction_id;

    const arTx = await engine.getTransaction(arTxId);
    expect(arTx.ok).toBe(true);
    if (!arTx.ok) return;

    // Three lines: AR debit, Revenue credit, GST credit
    expect(arTx.value.lines).toHaveLength(3);

    const debits = arTx.value.lines.filter(l => l.direction === "debit").reduce((s, l) => s + l.amount, 0);
    const credits = arTx.value.lines.filter(l => l.direction === "credit").reduce((s, l) => s + l.amount, 0);
    expect(debits).toBe(credits);
    expect(debits).toBe(11000); // 10000 + 1000 tax
  });

  it("status changes to approved", async () => {
    const inv = await createInvoice(db, ledgerId, userId, {
      customerName: "Acme",
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lineItems: [{ description: "X", quantity: 1, unitPrice: 1000 }],
      taxRate: 0,
      arAccountId,
      revenueAccountId,
    });
    if (!inv.ok) throw new Error("create failed");

    const result = await sendInvoice(db, engine, inv.value.id, ledgerId, userId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("approved");
    }
  });

  it("cannot send non-draft invoice", async () => {
    const inv = await createInvoice(db, ledgerId, userId, {
      customerName: "Acme",
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lineItems: [{ description: "X", quantity: 1, unitPrice: 1000 }],
      taxRate: 0,
      arAccountId,
      revenueAccountId,
    });
    if (!inv.ok) throw new Error("create failed");

    // Send once
    await sendInvoice(db, engine, inv.value.id, ledgerId, userId);

    // Try to send again
    const result = await sendInvoice(db, engine, inv.value.id, ledgerId, userId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVOICE_INVALID_STATE");
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Record payment
// ---------------------------------------------------------------------------

describe("recordPayment", () => {
  let db: Database;
  let engine: LedgerEngine;

  beforeEach(async () => {
    db = await SqliteDatabase.create();
    applyMigrations(db);
    await seedTestData(db);
    engine = new LedgerEngine(db);
  });

  const createAndSendInvoice = async (amount: number) => {
    const inv = await createInvoice(db, ledgerId, userId, {
      customerName: "Payer",
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lineItems: [{ description: "Service", quantity: 1, unitPrice: amount }],
      taxRate: 0,
      arAccountId,
      revenueAccountId,
    });
    if (!inv.ok) throw new Error("create failed");
    const sent = await sendInvoice(db, engine, inv.value.id, ledgerId, userId);
    if (!sent.ok) throw new Error("send failed");
    return sent.value;
  };

  it("full payment: status → paid, amount_due = 0", async () => {
    const inv = await createAndSendInvoice(50000);

    const result = await recordPayment(db, engine, inv.id, ledgerId, userId, {
      amount: 50000,
      paymentDate: "2026-02-01",
      bankAccountId: cashAccountId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("paid");
    expect(result.value.amountDue).toBe(0);
    expect(result.value.amountPaid).toBe(50000);
    expect(result.value.paidDate).toBe("2026-02-01");
  });

  it("partial payment: status → partially_paid", async () => {
    const inv = await createAndSendInvoice(50000);

    const result = await recordPayment(db, engine, inv.id, ledgerId, userId, {
      amount: 20000,
      paymentDate: "2026-02-01",
      bankAccountId: cashAccountId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("partially_paid");
    expect(result.value.amountDue).toBe(30000);
    expect(result.value.amountPaid).toBe(20000);
  });

  it("payment posts journal (debit Cash, credit AR)", async () => {
    const inv = await createAndSendInvoice(25000);

    const result = await recordPayment(db, engine, inv.id, ledgerId, userId, {
      amount: 25000,
      paymentDate: "2026-02-01",
      bankAccountId: cashAccountId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Get the payment's transaction
    const payment = result.value.payments[0]!;
    expect(payment.transactionId).toBeTruthy();

    const tx = await engine.getTransaction(payment.transactionId!);
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;

    const debits = tx.value.lines.filter(l => l.direction === "debit").reduce((s, l) => s + l.amount, 0);
    const credits = tx.value.lines.filter(l => l.direction === "credit").reduce((s, l) => s + l.amount, 0);
    expect(debits).toBe(credits);
    expect(debits).toBe(25000);
  });

  it("overpayment rejected (amount > amount_due)", async () => {
    const inv = await createAndSendInvoice(10000);

    const result = await recordPayment(db, engine, inv.id, ledgerId, userId, {
      amount: 20000,
      paymentDate: "2026-02-01",
      bankAccountId: cashAccountId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("cannot pay void invoice", async () => {
    const inv = await createAndSendInvoice(10000);

    // Void it
    await voidInvoice(db, engine, inv.id, ledgerId, userId);

    const result = await recordPayment(db, engine, inv.id, ledgerId, userId, {
      amount: 10000,
      paymentDate: "2026-02-01",
      bankAccountId: cashAccountId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVOICE_INVALID_STATE");
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Void invoice
// ---------------------------------------------------------------------------

describe("voidInvoice", () => {
  let db: Database;
  let engine: LedgerEngine;

  beforeEach(async () => {
    db = await SqliteDatabase.create();
    applyMigrations(db);
    await seedTestData(db);
    engine = new LedgerEngine(db);
  });

  it("reverses AR journal entry", async () => {
    const inv = await createInvoice(db, ledgerId, userId, {
      customerName: "Acme",
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lineItems: [{ description: "X", quantity: 1, unitPrice: 5000 }],
      taxRate: 0,
      arAccountId,
      revenueAccountId,
    });
    if (!inv.ok) throw new Error("create failed");

    const sent = await sendInvoice(db, engine, inv.value.id, ledgerId, userId);
    if (!sent.ok) throw new Error("send failed");

    const arTxId = (await db.get<{ ar_transaction_id: string }>(
      "SELECT ar_transaction_id FROM invoices WHERE id = ?",
      [inv.value.id],
    ))!.ar_transaction_id;

    const result = await voidInvoice(db, engine, inv.value.id, ledgerId, userId);
    expect(result.ok).toBe(true);

    // Original transaction should be reversed
    const origTx = await engine.getTransaction(arTxId);
    expect(origTx.ok).toBe(true);
    if (origTx.ok) {
      expect(origTx.value.status).toBe("reversed");
    }
  });

  it("cannot void with payments recorded", async () => {
    const inv = await createInvoice(db, ledgerId, userId, {
      customerName: "Acme",
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lineItems: [{ description: "X", quantity: 1, unitPrice: 5000 }],
      taxRate: 0,
      arAccountId,
      revenueAccountId,
    });
    if (!inv.ok) throw new Error("create failed");

    await sendInvoice(db, engine, inv.value.id, ledgerId, userId);
    await recordPayment(db, engine, inv.value.id, ledgerId, userId, {
      amount: 5000,
      paymentDate: "2026-02-01",
      bankAccountId: cashAccountId,
    });

    const result = await voidInvoice(db, engine, inv.value.id, ledgerId, userId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVOICE_INVALID_STATE");
    }
  });

  it("status → void", async () => {
    const inv = await createInvoice(db, ledgerId, userId, {
      customerName: "Acme",
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lineItems: [{ description: "X", quantity: 1, unitPrice: 5000 }],
      taxRate: 0,
    });
    if (!inv.ok) throw new Error("create failed");

    // Can void a draft directly
    const result = await voidInvoice(db, engine, inv.value.id, ledgerId, userId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("void");
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Summary
// ---------------------------------------------------------------------------

describe("getInvoiceSummary", () => {
  let db: Database;
  let engine: LedgerEngine;

  beforeEach(async () => {
    db = await SqliteDatabase.create();
    applyMigrations(db);
    await seedTestData(db);
    engine = new LedgerEngine(db);
  });

  it("correct totals for mixed statuses", async () => {
    // Create a draft invoice
    await createInvoice(db, ledgerId, userId, {
      customerName: "Draft Co",
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lineItems: [{ description: "X", quantity: 1, unitPrice: 20000 }],
      taxRate: 0,
    });

    // Create and send an invoice (outstanding)
    const sent = await createInvoice(db, ledgerId, userId, {
      customerName: "Sent Co",
      issueDate: "2026-01-01",
      dueDate: "2026-03-31",
      lineItems: [{ description: "Y", quantity: 1, unitPrice: 30000 }],
      taxRate: 0,
      arAccountId,
      revenueAccountId,
    });
    if (sent.ok) await sendInvoice(db, engine, sent.value.id, ledgerId, userId);

    const summary = await getInvoiceSummary(db, ledgerId);
    expect(summary.totalDraft).toBe(20000);
    expect(summary.totalOutstanding).toBe(30000);
    expect(summary.invoiceCount).toBe(2); // draft + sent (not void)
    expect(summary.currency).toBe("AUD");
  });

  it("overdue amount only counts past-due invoices", async () => {
    // Create a sent invoice that's already past due
    const inv = await createInvoice(db, ledgerId, userId, {
      customerName: "Late Co",
      issueDate: "2025-12-01",
      dueDate: "2025-12-31",
      lineItems: [{ description: "Z", quantity: 1, unitPrice: 40000 }],
      taxRate: 0,
      arAccountId,
      revenueAccountId,
    });
    if (!inv.ok) throw new Error("create failed");
    await sendInvoice(db, engine, inv.value.id, ledgerId, userId);

    // Mark as overdue
    await checkOverdueInvoices(db, ledgerId);

    const summary = await getInvoiceSummary(db, ledgerId);
    expect(summary.totalOverdue).toBe(40000);
    expect(summary.overdueCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8. AR Aging
// ---------------------------------------------------------------------------

describe("getARAging", () => {
  let db: Database;
  let engine: LedgerEngine;

  beforeEach(async () => {
    db = await SqliteDatabase.create();
    applyMigrations(db);
    await seedTestData(db);
    engine = new LedgerEngine(db);
  });

  const createSentInvoice = async (dueDate: string, amount: number) => {
    const inv = await createInvoice(db, ledgerId, userId, {
      customerName: "Customer",
      issueDate: "2025-01-01",
      dueDate,
      lineItems: [{ description: "Service", quantity: 1, unitPrice: amount }],
      taxRate: 0,
      arAccountId,
      revenueAccountId,
    });
    if (!inv.ok) throw new Error("create failed");
    const sent = await sendInvoice(db, engine, inv.value.id, ledgerId, userId);
    if (!sent.ok) throw new Error("send failed");
    return sent.value;
  };

  it("current bucket: not yet due", async () => {
    await createSentInvoice("2030-12-31", 10000);

    const buckets = await getARAging(db, ledgerId);
    const current = buckets.find(b => b.label === "Current")!;
    expect(current.amount).toBe(10000);
    expect(current.count).toBe(1);
  });

  it("1-30 bucket: 1-30 days past due", async () => {
    // Due 15 days ago
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 15);
    const dueDateStr = dueDate.toISOString().slice(0, 10);
    await createSentInvoice(dueDateStr, 20000);

    const buckets = await getARAging(db, ledgerId);
    const bucket = buckets.find(b => b.label === "1-30 days")!;
    expect(bucket.amount).toBe(20000);
    expect(bucket.count).toBe(1);
  });

  it("90+ bucket: very old invoices", async () => {
    // Due 120 days ago
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 120);
    const dueDateStr = dueDate.toISOString().slice(0, 10);
    await createSentInvoice(dueDateStr, 50000);

    const buckets = await getARAging(db, ledgerId);
    const bucket = buckets.find(b => b.label === "90+ days")!;
    expect(bucket.amount).toBe(50000);
    expect(bucket.count).toBe(1);
  });
});

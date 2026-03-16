// ---------------------------------------------------------------------------
// Invoicing Engine — Accounts Receivable
// ---------------------------------------------------------------------------

import type { Database } from "../db/database.js";
import type { LedgerEngine } from "../engine/index.js";
import { generateId, nowUtc, todayUtc } from "../engine/id.js";
import type { Result } from "../types/index.js";
import { ErrorCode, createError, ok, err } from "../errors/index.js";
import { getJurisdictionConfig } from "../jurisdiction/config.js";
import type {
  Invoice,
  InvoiceSummary,
  ARAgingBucket,
  CreateInvoiceInput,
  UpdateInvoiceInput,
  RecordPaymentInput,
  InvoiceRow,
  InvoiceLineItemRow,
  InvoicePaymentRow,
} from "./types.js";
import {
  mapInvoice,
  mapInvoiceLineItem,
  mapInvoicePayment,
} from "./types.js";

// ---------------------------------------------------------------------------
// Invoice number generation
// ---------------------------------------------------------------------------

export const generateInvoiceNumber = async (
  db: Database,
  ledgerId: string,
): Promise<string> => {
  const row = await db.get<{ max_num: string | null }>(
    `SELECT invoice_number AS max_num FROM invoices
     WHERE ledger_id = ? ORDER BY invoice_number DESC LIMIT 1`,
    [ledgerId],
  );

  if (!row?.max_num) return "INV-0001";

  const match = row.max_num.match(/^INV-(\d+)$/);
  if (!match) return "INV-0001";

  const next = parseInt(match[1]!, 10) + 1;
  return `INV-${String(next).padStart(4, "0")}`;
};

// ---------------------------------------------------------------------------
// Line item calculation
// ---------------------------------------------------------------------------

export interface CalculatedLineItem {
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly amount: number;
  readonly taxRate: number | null;
  readonly taxAmount: number;
  readonly accountId: string | null;
  readonly sortOrder: number;
}

export interface CalculatedTotals {
  readonly lineItems: readonly CalculatedLineItem[];
  readonly subtotal: number;
  readonly taxAmount: number;
  readonly total: number;
  readonly amountDue: number;
}

export const calculateLineItems = (
  lineItems: CreateInvoiceInput["lineItems"],
  invoiceTaxRate: number | null,
  taxInclusive: boolean,
): CalculatedTotals => {
  const calculated: CalculatedLineItem[] = [];

  for (let i = 0; i < lineItems.length; i++) {
    const item = lineItems[i]!;
    const amount = Math.round(item.quantity * item.unitPrice);
    const effectiveRate = item.taxRate ?? invoiceTaxRate ?? 0;

    let taxAmount: number;
    if (taxInclusive && effectiveRate > 0) {
      taxAmount = Math.round(amount - amount / (1 + effectiveRate));
    } else {
      taxAmount = Math.round(amount * effectiveRate);
    }

    calculated.push({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount,
      taxRate: item.taxRate ?? null,
      taxAmount,
      accountId: item.accountId ?? null,
      sortOrder: item.sortOrder ?? i,
    });
  }

  const subtotal = calculated.reduce((sum, li) => sum + li.amount, 0);
  const taxAmount = calculated.reduce((sum, li) => sum + li.taxAmount, 0);
  const total = taxInclusive ? subtotal : subtotal + taxAmount;

  return { lineItems: calculated, subtotal, taxAmount, total, amountDue: total };
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

const fetchInvoiceWithChildren = async (
  db: Database,
  invoiceId: string,
): Promise<Invoice | null> => {
  const row = await db.get<InvoiceRow>(
    "SELECT * FROM invoices WHERE id = ?",
    [invoiceId],
  );
  if (!row) return null;

  const lineRows = await db.all<InvoiceLineItemRow>(
    "SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order, created_at",
    [invoiceId],
  );
  const paymentRows = await db.all<InvoicePaymentRow>(
    "SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY payment_date, created_at",
    [invoiceId],
  );

  return mapInvoice(
    row,
    lineRows.map(mapInvoiceLineItem),
    paymentRows.map(mapInvoicePayment),
  );
};

// ---------------------------------------------------------------------------
// Create invoice
// ---------------------------------------------------------------------------

export const createInvoice = async (
  db: Database,
  ledgerId: string,
  _userId: string,
  input: CreateInvoiceInput,
): Promise<Result<Invoice>> => {
  // Validate line items exist
  if (!input.lineItems || input.lineItems.length === 0) {
    return err(createError(ErrorCode.VALIDATION_ERROR, "At least one line item is required", [
      { field: "lineItems", expected: "non-empty array", actual: "empty" },
    ]));
  }

  // Get ledger for defaults
  const ledger = await db.get<{ currency: string; jurisdiction: string }>(
    "SELECT currency, jurisdiction FROM ledgers WHERE id = ?",
    [ledgerId],
  );
  if (!ledger) {
    return err(createError(ErrorCode.LEDGER_NOT_FOUND, `Ledger not found: ${ledgerId}`));
  }

  const jurisdiction = getJurisdictionConfig(ledger.jurisdiction);

  // Tax defaults from jurisdiction
  const taxRate = input.taxRate ?? (jurisdiction.vatRate != null ? jurisdiction.vatRate / 100 : null);
  const taxLabel = jurisdiction.vatName ?? null;
  const taxInclusive = input.taxInclusive ?? false;
  const currency = input.currency ?? ledger.currency;

  // Generate or use provided invoice number
  const invoiceNumber = input.invoiceNumber ?? await generateInvoiceNumber(db, ledgerId);

  // Check uniqueness
  const existing = await db.get<{ id: string }>(
    "SELECT id FROM invoices WHERE ledger_id = ? AND invoice_number = ?",
    [ledgerId, invoiceNumber],
  );
  if (existing) {
    return err(createError(ErrorCode.VALIDATION_ERROR, `Invoice number ${invoiceNumber} already exists`, [
      { field: "invoiceNumber", actual: invoiceNumber, suggestion: "Use a different invoice number or omit to auto-generate" },
    ]));
  }

  // Calculate line items and totals
  const calc = calculateLineItems(input.lineItems, taxRate, taxInclusive);

  const id = generateId();
  const now = nowUtc();

  // Insert invoice
  await db.run(
    `INSERT INTO invoices (
      id, ledger_id, invoice_number,
      customer_name, customer_email, customer_address,
      issue_date, due_date,
      subtotal, tax_amount, total, amount_paid, amount_due,
      currency, tax_rate, tax_label, tax_inclusive,
      status, notes, footer,
      revenue_account_id, ar_account_id, tax_account_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, ledgerId, invoiceNumber,
      input.customerName, input.customerEmail ?? null, input.customerAddress ?? null,
      input.issueDate, input.dueDate,
      calc.subtotal, calc.taxAmount, calc.total, 0, calc.amountDue,
      currency, taxRate, taxLabel, taxInclusive ? 1 : 0,
      "draft", input.notes ?? null, input.footer ?? null,
      input.revenueAccountId ?? null, input.arAccountId ?? null, input.taxAccountId ?? null,
      now, now,
    ],
  );

  // Insert line items
  for (const li of calc.lineItems) {
    await db.run(
      `INSERT INTO invoice_line_items (
        id, invoice_id, description, quantity, unit_price, amount,
        tax_rate, tax_amount, account_id, sort_order, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generateId(), id, li.description, li.quantity, li.unitPrice, li.amount,
        li.taxRate, li.taxAmount, li.accountId, li.sortOrder, now,
      ],
    );
  }

  const invoice = await fetchInvoiceWithChildren(db, id);
  return ok(invoice!);
};

// ---------------------------------------------------------------------------
// Update invoice (draft only)
// ---------------------------------------------------------------------------

export const updateInvoice = async (
  db: Database,
  invoiceId: string,
  input: UpdateInvoiceInput,
): Promise<Result<Invoice>> => {
  const existing = await db.get<InvoiceRow>(
    "SELECT * FROM invoices WHERE id = ?",
    [invoiceId],
  );
  if (!existing) {
    return err(createError(ErrorCode.INVOICE_NOT_FOUND, `Invoice not found: ${invoiceId}`));
  }
  if (existing.status !== "draft") {
    return err(createError(ErrorCode.INVOICE_INVALID_STATE, "Only draft invoices can be updated", [
      { field: "status", actual: existing.status, expected: "draft" },
    ]));
  }

  const now = nowUtc();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.customerName !== undefined) { sets.push("customer_name = ?"); params.push(input.customerName); }
  if (input.customerEmail !== undefined) { sets.push("customer_email = ?"); params.push(input.customerEmail); }
  if (input.customerAddress !== undefined) { sets.push("customer_address = ?"); params.push(input.customerAddress); }
  if (input.issueDate !== undefined) { sets.push("issue_date = ?"); params.push(input.issueDate); }
  if (input.dueDate !== undefined) { sets.push("due_date = ?"); params.push(input.dueDate); }
  if (input.notes !== undefined) { sets.push("notes = ?"); params.push(input.notes); }
  if (input.footer !== undefined) { sets.push("footer = ?"); params.push(input.footer); }
  if (input.revenueAccountId !== undefined) { sets.push("revenue_account_id = ?"); params.push(input.revenueAccountId); }
  if (input.arAccountId !== undefined) { sets.push("ar_account_id = ?"); params.push(input.arAccountId); }
  if (input.taxAccountId !== undefined) { sets.push("tax_account_id = ?"); params.push(input.taxAccountId); }
  if (input.taxRate !== undefined) { sets.push("tax_rate = ?"); params.push(input.taxRate); }
  if (input.taxInclusive !== undefined) { sets.push("tax_inclusive = ?"); params.push(input.taxInclusive ? 1 : 0); }

  // If line items provided, recalculate totals
  if (input.lineItems) {
    const taxRate = input.taxRate ?? (existing.tax_rate != null ? Number(existing.tax_rate) : null);
    const taxInclusive = input.taxInclusive ?? toBool(existing.tax_inclusive);
    const calc = calculateLineItems(input.lineItems, taxRate, taxInclusive);

    sets.push("subtotal = ?"); params.push(calc.subtotal);
    sets.push("tax_amount = ?"); params.push(calc.taxAmount);
    sets.push("total = ?"); params.push(calc.total);
    sets.push("amount_due = ?"); params.push(calc.total - Number(existing.amount_paid));

    // Delete and re-insert line items
    await db.run("DELETE FROM invoice_line_items WHERE invoice_id = ?", [invoiceId]);
    for (const li of calc.lineItems) {
      await db.run(
        `INSERT INTO invoice_line_items (
          id, invoice_id, description, quantity, unit_price, amount,
          tax_rate, tax_amount, account_id, sort_order, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          generateId(), invoiceId, li.description, li.quantity, li.unitPrice, li.amount,
          li.taxRate, li.taxAmount, li.accountId, li.sortOrder, now,
        ],
      );
    }
  }

  if (sets.length > 0) {
    sets.push("updated_at = ?"); params.push(now);
    params.push(invoiceId);
    await db.run(`UPDATE invoices SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  const invoice = await fetchInvoiceWithChildren(db, invoiceId);
  return ok(invoice!);
};

// ---------------------------------------------------------------------------
// Send invoice (approve — posts AR journal entry)
// ---------------------------------------------------------------------------

export const sendInvoice = async (
  db: Database,
  engine: LedgerEngine,
  invoiceId: string,
  ledgerId: string,
  _userId: string,
): Promise<Result<Invoice>> => {
  const invoice = await fetchInvoiceWithChildren(db, invoiceId);
  if (!invoice) {
    return err(createError(ErrorCode.INVOICE_NOT_FOUND, `Invoice not found: ${invoiceId}`));
  }
  if (invoice.status !== "draft") {
    return err(createError(ErrorCode.INVOICE_INVALID_STATE, "Only draft invoices can be sent", [
      { field: "status", actual: invoice.status, expected: "draft" },
    ]));
  }

  // Find AR account — use invoice-level override or default by code pattern
  const arAccountCode = invoice.arAccountId
    ? (await db.get<{ code: string }>("SELECT code FROM accounts WHERE id = ?", [invoice.arAccountId]))?.code
    : (await db.get<{ code: string }>(
        "SELECT code FROM accounts WHERE ledger_id = ? AND type = 'asset' AND code LIKE '1_00' ORDER BY code LIMIT 1",
        [ledgerId],
      ))?.code ?? (await db.get<{ code: string }>(
        "SELECT code FROM accounts WHERE ledger_id = ? AND type = 'asset' AND name LIKE '%Receivable%' ORDER BY code LIMIT 1",
        [ledgerId],
      ))?.code;

  if (!arAccountCode) {
    return err(createError(ErrorCode.ACCOUNT_NOT_FOUND, "No Accounts Receivable account found. Create an asset account for AR or specify ar_account_id on the invoice.", [
      { field: "arAccountId", suggestion: "Create an asset account with code 1100 named 'Accounts Receivable'" },
    ]));
  }

  // Find revenue account
  const revenueAccountCode = invoice.revenueAccountId
    ? (await db.get<{ code: string }>("SELECT code FROM accounts WHERE id = ?", [invoice.revenueAccountId]))?.code
    : (await db.get<{ code: string }>(
        "SELECT code FROM accounts WHERE ledger_id = ? AND type = 'revenue' ORDER BY code LIMIT 1",
        [ledgerId],
      ))?.code;

  if (!revenueAccountCode) {
    return err(createError(ErrorCode.ACCOUNT_NOT_FOUND, "No revenue account found. Create a revenue account or specify revenue_account_id on the invoice.", [
      { field: "revenueAccountId", suggestion: "Create a revenue account with code 4000" },
    ]));
  }

  // Build journal entry lines
  const lines: { accountCode: string; amount: number; direction: "debit" | "credit"; memo?: string }[] = [];

  // Debit AR for total
  lines.push({
    accountCode: arAccountCode,
    amount: invoice.total,
    direction: "debit",
    memo: `Invoice ${invoice.invoiceNumber}`,
  });

  // Credit revenue for subtotal (or total - tax if tax-inclusive)
  const revenueAmount = invoice.taxInclusive
    ? invoice.total - invoice.taxAmount
    : invoice.subtotal;

  lines.push({
    accountCode: revenueAccountCode,
    amount: revenueAmount,
    direction: "credit",
    memo: `Invoice ${invoice.invoiceNumber} — revenue`,
  });

  // Credit tax liability if there's tax
  if (invoice.taxAmount > 0) {
    const taxAccountCode = invoice.taxAccountId
      ? (await db.get<{ code: string }>("SELECT code FROM accounts WHERE id = ?", [invoice.taxAccountId]))?.code
      : (await db.get<{ code: string }>(
          "SELECT code FROM accounts WHERE ledger_id = ? AND type = 'liability' AND (name LIKE '%GST%' OR name LIKE '%VAT%' OR name LIKE '%Tax%') ORDER BY code LIMIT 1",
          [ledgerId],
        ))?.code;

    if (!taxAccountCode) {
      return err(createError(ErrorCode.ACCOUNT_NOT_FOUND, "No tax liability account found. Create a liability account for tax or specify tax_account_id on the invoice.", [
        { field: "taxAccountId", suggestion: "Create a liability account for GST/VAT collected" },
      ]));
    }

    lines.push({
      accountCode: taxAccountCode,
      amount: invoice.taxAmount,
      direction: "credit",
      memo: `Invoice ${invoice.invoiceNumber} — ${invoice.taxLabel ?? "tax"}`,
    });
  }

  // Post the journal entry
  const txResult = await engine.postTransaction({
    ledgerId,
    date: invoice.issueDate,
    memo: `Invoice ${invoice.invoiceNumber} — ${invoice.customerName}`,
    lines,
    sourceType: "api",
    sourceRef: `invoice:${invoiceId}`,
    idempotencyKey: `invoice-ar-${invoiceId}`,
  });

  if (!txResult.ok) return err(txResult.error);

  // Update invoice status and store transaction reference
  const now = nowUtc();
  await db.run(
    `UPDATE invoices SET status = 'sent', ar_transaction_id = ?, updated_at = ? WHERE id = ?`,
    [txResult.value.id, now, invoiceId],
  );

  const updated = await fetchInvoiceWithChildren(db, invoiceId);
  return ok(updated!);
};

// ---------------------------------------------------------------------------
// Record payment
// ---------------------------------------------------------------------------

export const recordPayment = async (
  db: Database,
  engine: LedgerEngine,
  invoiceId: string,
  ledgerId: string,
  _userId: string,
  input: RecordPaymentInput,
): Promise<Result<Invoice>> => {
  const invoice = await fetchInvoiceWithChildren(db, invoiceId);
  if (!invoice) {
    return err(createError(ErrorCode.INVOICE_NOT_FOUND, `Invoice not found: ${invoiceId}`));
  }

  const validStatuses = ["sent", "partially_paid", "overdue"];
  if (!validStatuses.includes(invoice.status)) {
    return err(createError(ErrorCode.INVOICE_INVALID_STATE, `Cannot record payment on ${invoice.status} invoice`, [
      { field: "status", actual: invoice.status, expected: "sent, partially_paid, or overdue" },
    ]));
  }

  if (input.amount <= 0) {
    return err(createError(ErrorCode.VALIDATION_ERROR, "Payment amount must be positive", [
      { field: "amount", actual: String(input.amount), expected: "positive integer" },
    ]));
  }

  if (input.amount > invoice.amountDue) {
    return err(createError(ErrorCode.VALIDATION_ERROR, `Payment amount ${input.amount} exceeds amount due ${invoice.amountDue}`, [
      { field: "amount", actual: String(input.amount), expected: `<= ${invoice.amountDue}` },
    ]));
  }

  // Find bank/cash account
  const bankAccountCode = input.bankAccountId
    ? (await db.get<{ code: string }>("SELECT code FROM accounts WHERE id = ?", [input.bankAccountId]))?.code
    : (await db.get<{ code: string }>(
        "SELECT code FROM accounts WHERE ledger_id = ? AND type = 'asset' AND (name LIKE '%Bank%' OR name LIKE '%Cash%' OR name LIKE '%Checking%') ORDER BY code LIMIT 1",
        [ledgerId],
      ))?.code ?? (await db.get<{ code: string }>(
        "SELECT code FROM accounts WHERE ledger_id = ? AND code = '1000' LIMIT 1",
        [ledgerId],
      ))?.code;

  if (!bankAccountCode) {
    return err(createError(ErrorCode.ACCOUNT_NOT_FOUND, "No bank/cash account found. Specify bankAccountId.", [
      { field: "bankAccountId", suggestion: "Provide the ID of the bank or cash account receiving the payment" },
    ]));
  }

  // Find AR account
  const arAccountCode = invoice.arAccountId
    ? (await db.get<{ code: string }>("SELECT code FROM accounts WHERE id = ?", [invoice.arAccountId]))?.code
    : (await db.get<{ code: string }>(
        "SELECT code FROM accounts WHERE ledger_id = ? AND type = 'asset' AND (code LIKE '1_00' OR name LIKE '%Receivable%') ORDER BY code LIMIT 1",
        [ledgerId],
      ))?.code;

  if (!arAccountCode) {
    return err(createError(ErrorCode.ACCOUNT_NOT_FOUND, "No Accounts Receivable account found"));
  }

  // Post payment journal entry: Debit Cash, Credit AR
  const txResult = await engine.postTransaction({
    ledgerId,
    date: input.paymentDate,
    memo: `Payment received — Invoice ${invoice.invoiceNumber}`,
    lines: [
      { accountCode: bankAccountCode, amount: input.amount, direction: "debit", memo: `Payment — Invoice ${invoice.invoiceNumber}` },
      { accountCode: arAccountCode, amount: input.amount, direction: "credit", memo: `Payment — Invoice ${invoice.invoiceNumber}` },
    ],
    sourceType: "api",
    sourceRef: `invoice-payment:${invoiceId}`,
    idempotencyKey: `invoice-payment-${invoiceId}-${generateId()}`,
  });

  if (!txResult.ok) return err(txResult.error);

  // Insert payment record
  const paymentId = generateId();
  const now = nowUtc();
  await db.run(
    `INSERT INTO invoice_payments (
      id, invoice_id, amount, payment_date, payment_method,
      reference, transaction_id, bank_transaction_id, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      paymentId, invoiceId, input.amount, input.paymentDate,
      input.paymentMethod ?? null, input.reference ?? null,
      txResult.value.id, null, input.notes ?? null, now,
    ],
  );

  // Update invoice amounts and status
  const newAmountPaid = invoice.amountPaid + input.amount;
  const newAmountDue = invoice.amountDue - input.amount;
  const newStatus = newAmountDue === 0 ? "paid" : "partially_paid";
  const paidDate = newAmountDue === 0 ? input.paymentDate : null;

  await db.run(
    `UPDATE invoices SET
      amount_paid = ?, amount_due = ?, status = ?,
      paid_date = ?, updated_at = ?
    WHERE id = ?`,
    [newAmountPaid, newAmountDue, newStatus, paidDate, now, invoiceId],
  );

  const updated = await fetchInvoiceWithChildren(db, invoiceId);
  return ok(updated!);
};

// ---------------------------------------------------------------------------
// Void invoice
// ---------------------------------------------------------------------------

export const voidInvoice = async (
  db: Database,
  engine: LedgerEngine,
  invoiceId: string,
  _ledgerId: string,
  _userId: string,
): Promise<Result<Invoice>> => {
  const invoice = await fetchInvoiceWithChildren(db, invoiceId);
  if (!invoice) {
    return err(createError(ErrorCode.INVOICE_NOT_FOUND, `Invoice not found: ${invoiceId}`));
  }

  if (invoice.payments.length > 0) {
    return err(createError(ErrorCode.INVOICE_INVALID_STATE, "Cannot void an invoice with recorded payments", [
      { field: "payments", actual: `${invoice.payments.length} payment(s)`, expected: "0",
        suggestion: "Reverse or delete all payments before voiding" },
    ]));
  }

  // If AR journal entry was posted, reverse it
  if (invoice.status !== "draft") {
    const arTxRow = await db.get<{ id: string }>(
      "SELECT ar_transaction_id AS id FROM invoices WHERE id = ?",
      [invoiceId],
    );
    if (arTxRow?.id) {
      const reverseResult = await engine.reverseTransaction(
        arTxRow.id,
        `Void invoice ${invoice.invoiceNumber}`,
      );
      if (!reverseResult.ok) return err(reverseResult.error);
    }
  }

  const now = nowUtc();
  await db.run(
    "UPDATE invoices SET status = 'void', updated_at = ? WHERE id = ?",
    [now, invoiceId],
  );

  const updated = await fetchInvoiceWithChildren(db, invoiceId);
  return ok(updated!);
};

// ---------------------------------------------------------------------------
// Get invoice
// ---------------------------------------------------------------------------

export const getInvoice = async (
  db: Database,
  invoiceId: string,
): Promise<Result<Invoice>> => {
  const invoice = await fetchInvoiceWithChildren(db, invoiceId);
  if (!invoice) {
    return err(createError(ErrorCode.INVOICE_NOT_FOUND, `Invoice not found: ${invoiceId}`));
  }
  return ok(invoice);
};

// ---------------------------------------------------------------------------
// List invoices
// ---------------------------------------------------------------------------

export const listInvoices = async (
  db: Database,
  ledgerId: string,
  filters?: {
    status?: string;
    customerName?: string;
    dateFrom?: string;
    dateTo?: string;
    cursor?: string;
    limit?: number;
  },
): Promise<{ data: Invoice[]; cursor: string | null }> => {
  const limit = Math.min(filters?.limit ?? 50, 200);
  const conditions: string[] = ["i.ledger_id = ?"];
  const params: unknown[] = [ledgerId];

  if (filters?.status) { conditions.push("i.status = ?"); params.push(filters.status); }
  if (filters?.customerName) { conditions.push("i.customer_name LIKE ?"); params.push(`%${filters.customerName}%`); }
  if (filters?.dateFrom) { conditions.push("i.issue_date >= ?"); params.push(filters.dateFrom); }
  if (filters?.dateTo) { conditions.push("i.issue_date <= ?"); params.push(filters.dateTo); }
  if (filters?.cursor) { conditions.push("i.id > ?"); params.push(filters.cursor); }

  params.push(limit + 1);

  const rows = await db.all<InvoiceRow>(
    `SELECT i.* FROM invoices i
     WHERE ${conditions.join(" AND ")}
     ORDER BY i.created_at DESC, i.id
     LIMIT ?`,
    params,
  );

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;

  const invoices: Invoice[] = [];
  for (const row of data) {
    const lineRows = await db.all<InvoiceLineItemRow>(
      "SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order",
      [row.id],
    );
    const paymentRows = await db.all<InvoicePaymentRow>(
      "SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY payment_date",
      [row.id],
    );
    invoices.push(mapInvoice(
      row,
      lineRows.map(mapInvoiceLineItem),
      paymentRows.map(mapInvoicePayment),
    ));
  }

  return {
    data: invoices,
    cursor: hasMore && data.length > 0 ? data[data.length - 1]!.id : null,
  };
};

// ---------------------------------------------------------------------------
// Invoice summary
// ---------------------------------------------------------------------------

export const getInvoiceSummary = async (
  db: Database,
  ledgerId: string,
): Promise<InvoiceSummary> => {
  const ledger = await db.get<{ currency: string }>(
    "SELECT currency FROM ledgers WHERE id = ?",
    [ledgerId],
  );
  const currency = ledger?.currency ?? "USD";

  const outstanding = await db.get<{ total: number | null }>(
    `SELECT COALESCE(SUM(amount_due), 0) AS total FROM invoices
     WHERE ledger_id = ? AND status IN ('sent', 'partially_paid', 'overdue')`,
    [ledgerId],
  );

  const overdue = await db.get<{ total: number | null; cnt: number }>(
    `SELECT COALESCE(SUM(amount_due), 0) AS total, COUNT(*) AS cnt FROM invoices
     WHERE ledger_id = ? AND status = 'overdue'`,
    [ledgerId],
  );

  const draft = await db.get<{ total: number | null }>(
    `SELECT COALESCE(SUM(total), 0) AS total FROM invoices
     WHERE ledger_id = ? AND status = 'draft'`,
    [ledgerId],
  );

  const today = todayUtc();
  const monthStart = today.slice(0, 7) + "-01";
  const paidThisMonth = await db.get<{ total: number | null }>(
    `SELECT COALESCE(SUM(total), 0) AS total FROM invoices
     WHERE ledger_id = ? AND status = 'paid' AND paid_date >= ?`,
    [ledgerId, monthStart],
  );

  const invoiceCount = await db.get<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM invoices WHERE ledger_id = ? AND status != 'void'`,
    [ledgerId],
  );

  const avgDays = await db.get<{ avg_days: number | null }>(
    `SELECT AVG(JULIANDAY(paid_date) - JULIANDAY(issue_date)) AS avg_days FROM invoices
     WHERE ledger_id = ? AND status = 'paid' AND paid_date IS NOT NULL`,
    [ledgerId],
  );

  return {
    totalOutstanding: Number(outstanding?.total ?? 0),
    totalOverdue: Number(overdue?.total ?? 0),
    totalDraft: Number(draft?.total ?? 0),
    totalPaidThisMonth: Number(paidThisMonth?.total ?? 0),
    invoiceCount: invoiceCount?.cnt ?? 0,
    overdueCount: overdue?.cnt ?? 0,
    averageDaysToPayment: avgDays?.avg_days != null ? Math.round(avgDays.avg_days) : null,
    currency,
  };
};

// ---------------------------------------------------------------------------
// AR Aging
// ---------------------------------------------------------------------------

export const getARAging = async (
  db: Database,
  ledgerId: string,
): Promise<ARAgingBucket[]> => {
  const today = todayUtc();

  const rows = await db.all<{ amount_due: number; due_date: string }>(
    `SELECT amount_due, due_date FROM invoices
     WHERE ledger_id = ? AND status IN ('sent', 'partially_paid', 'overdue')`,
    [ledgerId],
  );

  const buckets: ARAgingBucket[] = [
    { label: "Current", amount: 0, count: 0 },
    { label: "1-30 days", amount: 0, count: 0 },
    { label: "31-60 days", amount: 0, count: 0 },
    { label: "61-90 days", amount: 0, count: 0 },
    { label: "90+ days", amount: 0, count: 0 },
  ];

  const todayMs = new Date(today).getTime();

  for (const row of rows) {
    const dueMs = new Date(row.due_date).getTime();
    const daysPastDue = Math.floor((todayMs - dueMs) / (1000 * 60 * 60 * 24));
    const amount = Number(row.amount_due);

    let bucket: ARAgingBucket;
    if (daysPastDue <= 0) {
      bucket = buckets[0]!;
    } else if (daysPastDue <= 30) {
      bucket = buckets[1]!;
    } else if (daysPastDue <= 60) {
      bucket = buckets[2]!;
    } else if (daysPastDue <= 90) {
      bucket = buckets[3]!;
    } else {
      bucket = buckets[4]!;
    }

    // Mutate the mutable working copies
    (bucket as { amount: number }).amount += amount;
    (bucket as { count: number }).count += 1;
  }

  return buckets;
};

// ---------------------------------------------------------------------------
// Overdue check
// ---------------------------------------------------------------------------

export const checkOverdueInvoices = async (
  db: Database,
  ledgerId: string,
): Promise<number> => {
  const today = todayUtc();
  const result = await db.run(
    `UPDATE invoices SET status = 'overdue', updated_at = ?
     WHERE ledger_id = ? AND status = 'sent' AND due_date < ?`,
    [nowUtc(), ledgerId, today],
  );
  return result.changes;
};

// ---------------------------------------------------------------------------
// Bank feed invoice matching
// ---------------------------------------------------------------------------

export interface InvoicePaymentMatch {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly customerName: string;
  readonly invoiceTotal: number;
  readonly invoiceAmountDue: number;
  readonly bankTransactionAmount: number;
  readonly confidence: number;
}

/**
 * Match a bank deposit against outstanding invoices.
 *
 * Scoring:
 * - Exact amount match:         60 pts
 * - Amount within 1%:           40 pts
 * - Customer name in memo:      30 pts
 * - Invoice number in memo:     10 pts
 *
 * Returns matches with confidence >= 0.5, sorted descending.
 */
export const matchBankDepositToInvoices = async (
  db: Database,
  ledgerId: string,
  depositAmountCents: number,
  depositMemo: string,
  _depositDate: string,
): Promise<readonly InvoicePaymentMatch[]> => {
  // Only match positive (credit) deposits
  if (depositAmountCents <= 0) return [];

  const invoices = await db.all<InvoiceRow>(
    `SELECT * FROM invoices
     WHERE ledger_id = ? AND status IN ('sent', 'partially_paid', 'overdue')
     AND amount_due > 0`,
    [ledgerId],
  );

  const memoLower = depositMemo.toLowerCase();
  const matches: InvoicePaymentMatch[] = [];

  for (const inv of invoices) {
    let score = 0;

    // Amount matching
    const amountDue = Number(inv.amount_due);
    if (depositAmountCents === amountDue) {
      score += 60;
    } else {
      const diff = Math.abs(depositAmountCents - amountDue) / amountDue;
      if (diff <= 0.01) score += 40;
    }

    // Customer name in memo
    if (memoLower.includes(inv.customer_name.toLowerCase())) {
      score += 30;
    }

    // Invoice number in memo
    if (memoLower.includes(inv.invoice_number.toLowerCase())) {
      score += 10;
    }

    const confidence = score / 100;
    if (confidence >= 0.5) {
      matches.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        customerName: inv.customer_name,
        invoiceTotal: Number(inv.total),
        invoiceAmountDue: amountDue,
        bankTransactionAmount: depositAmountCents,
        confidence,
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const toBool = (v: number | boolean | null | undefined): boolean =>
  v === true || v === 1;

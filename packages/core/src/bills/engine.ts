// ---------------------------------------------------------------------------
// Bills Engine — Accounts Payable
// ---------------------------------------------------------------------------

import type { Database } from "../db/database.js";
import type { LedgerEngine } from "../engine/index.js";
import { generateId, nowUtc, todayUtc } from "../engine/id.js";
import type { Result } from "../types/index.js";
import { ErrorCode, createError, ok, err } from "../errors/index.js";
import { getJurisdictionConfig } from "../jurisdiction/config.js";
import type { VendorRow } from "./vendors.js";
import { createVendor } from "./vendors.js";
import { calculateDueDate } from "../invoicing/payment-terms.js";
import type { PaymentTermsCode } from "../invoicing/payment-terms.js";
import type {
  Bill,
  BillSummary,
  APAgingBucket,
  CreateBillInput,
  UpdateBillInput,
  RecordBillPaymentInput,
  BillRow,
  BillLineItemRow,
  BillPaymentRow,
} from "./types.js";
import {
  mapBill,
  mapBillLineItem,
  mapBillPayment,
} from "./types.js";

// ---------------------------------------------------------------------------
// Bill number generation
// ---------------------------------------------------------------------------

export const generateBillNumber = async (
  db: Database,
  ledgerId: string,
): Promise<string> => {
  const row = await db.get<{ max_num: string | null }>(
    `SELECT bill_number AS max_num FROM bills
     WHERE ledger_id = ? ORDER BY bill_number DESC LIMIT 1`,
    [ledgerId],
  );

  if (!row?.max_num) return "BILL-0001";

  const match = row.max_num.match(/^BILL-(\d+)$/);
  if (!match) return "BILL-0001";

  const next = parseInt(match[1]!, 10) + 1;
  return `BILL-${String(next).padStart(4, "0")}`;
};

// ---------------------------------------------------------------------------
// Line item calculation
// ---------------------------------------------------------------------------

export interface BillCalculatedLineItem {
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly amount: number;
  readonly taxRate: number | null;
  readonly taxAmount: number;
  readonly accountId: string | null;
  readonly sortOrder: number;
}

export interface BillCalculatedTotals {
  readonly lineItems: readonly BillCalculatedLineItem[];
  readonly subtotal: number;
  readonly taxAmount: number;
  readonly total: number;
  readonly amountDue: number;
}

export const calculateBillLineItems = (
  lineItems: CreateBillInput["lineItems"],
  billTaxRate: number | null,
  taxInclusive: boolean,
): BillCalculatedTotals => {
  const calculated: BillCalculatedLineItem[] = [];

  for (let i = 0; i < lineItems.length; i++) {
    const item = lineItems[i]!;
    const amount = Math.round(item.quantity * item.unitPrice);
    const effectiveRate = item.taxRate ?? billTaxRate ?? 0;

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

const fetchBillWithChildren = async (
  db: Database,
  billId: string,
): Promise<Bill | null> => {
  const row = await db.get<BillRow>(
    "SELECT * FROM bills WHERE id = ?",
    [billId],
  );
  if (!row) return null;

  const lineRows = await db.all<BillLineItemRow>(
    "SELECT * FROM bill_line_items WHERE bill_id = ? ORDER BY sort_order, created_at",
    [billId],
  );
  const paymentRows = await db.all<BillPaymentRow>(
    "SELECT * FROM bill_payments WHERE bill_id = ? ORDER BY payment_date, created_at",
    [billId],
  );

  return mapBill(
    row,
    lineRows.map(mapBillLineItem),
    paymentRows.map(mapBillPayment),
  );
};

// ---------------------------------------------------------------------------
// Create bill
// ---------------------------------------------------------------------------

export const createBill = async (
  db: Database,
  ledgerId: string,
  _userId: string,
  input: CreateBillInput,
): Promise<Result<Bill>> => {
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

  // If vendor_id is provided, auto-fill missing fields from the vendor record
  let vendorName = input.vendorName;
  let vendorEmail = input.vendorEmail ?? null;
  let paymentTerms = input.paymentTerms ?? null;
  let vendorId = input.vendorId ?? null;

  if (vendorId) {
    const vendor = await db.get<VendorRow>(
      "SELECT * FROM vendors WHERE id = ? AND ledger_id = ?",
      [vendorId, ledgerId],
    );
    if (!vendor) {
      return err(createError(ErrorCode.VENDOR_NOT_FOUND, `Vendor not found: ${vendorId}`));
    }
    // Auto-fill from vendor if not explicitly provided
    if (!input.vendorName || input.vendorName.trim().length === 0) {
      vendorName = vendor.name;
    }
    if (!input.vendorEmail && vendor.email) {
      vendorEmail = vendor.email;
    }
    if (!input.paymentTerms && vendor.payment_terms) {
      paymentTerms = vendor.payment_terms;
    }
  }

  const jurisdiction = getJurisdictionConfig(ledger.jurisdiction);

  // Tax defaults from jurisdiction
  const taxRate = input.taxRate ?? (jurisdiction.vatRate != null ? jurisdiction.vatRate / 100 : null);
  const taxLabel = jurisdiction.vatName ?? null;
  const taxInclusive = input.taxInclusive ?? false;
  const currency = input.currency ?? ledger.currency;

  // Calculate due date from payment terms if dueDate not explicitly provided
  const dueDate = input.dueDate ?? (paymentTerms
    ? calculateDueDate(input.billDate, paymentTerms as PaymentTermsCode)
    : (() => { const d = new Date(input.billDate); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })());

  // Generate or use provided bill number
  const billNumber = input.billNumber ?? await generateBillNumber(db, ledgerId);

  // Check uniqueness
  const existing = await db.get<{ id: string }>(
    "SELECT id FROM bills WHERE ledger_id = ? AND bill_number = ?",
    [ledgerId, billNumber],
  );
  if (existing) {
    return err(createError(ErrorCode.VALIDATION_ERROR, `Bill number ${billNumber} already exists`, [
      { field: "billNumber", actual: billNumber, suggestion: "Use a different bill number or omit to auto-generate" },
    ]));
  }

  // Calculate line items and totals
  const calc = calculateBillLineItems(input.lineItems, taxRate, taxInclusive);

  const id = generateId();
  const now = nowUtc();

  // Insert bill
  await db.run(
    `INSERT INTO bills (
      id, ledger_id, bill_number,
      vendor_id, vendor_name, vendor_email,
      payment_terms, bill_date, due_date,
      subtotal, tax_amount, total, amount_paid, amount_due,
      currency, tax_rate, tax_label, tax_inclusive,
      status, notes, reference,
      expense_account_id, ap_account_id, tax_account_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, ledgerId, billNumber,
      vendorId, vendorName, vendorEmail,
      paymentTerms, input.billDate, dueDate,
      calc.subtotal, calc.taxAmount, calc.total, 0, calc.amountDue,
      currency, taxRate, taxLabel, taxInclusive ? 1 : 0,
      "draft", input.notes ?? null, input.reference ?? null,
      input.expenseAccountId ?? null, input.apAccountId ?? null, input.taxAccountId ?? null,
      now, now,
    ],
  );

  // Insert line items
  for (const li of calc.lineItems) {
    await db.run(
      `INSERT INTO bill_line_items (
        id, bill_id, description, quantity, unit_price, amount,
        tax_rate, tax_amount, account_id, sort_order, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generateId(), id, li.description, li.quantity, li.unitPrice, li.amount,
        li.taxRate, li.taxAmount, li.accountId, li.sortOrder, now,
      ],
    );
  }

  const bill = await fetchBillWithChildren(db, id);
  return ok(bill!);
};

// ---------------------------------------------------------------------------
// Update bill (draft only)
// ---------------------------------------------------------------------------

export const updateBill = async (
  db: Database,
  billId: string,
  input: UpdateBillInput,
): Promise<Result<Bill>> => {
  const existing = await db.get<BillRow>(
    "SELECT * FROM bills WHERE id = ?",
    [billId],
  );
  if (!existing) {
    return err(createError(ErrorCode.BILL_NOT_FOUND, `Bill not found: ${billId}`));
  }
  if (existing.status !== "draft") {
    return err(createError(ErrorCode.BILL_INVALID_STATE, "Only draft bills can be updated", [
      { field: "status", actual: existing.status, expected: "draft" },
    ]));
  }

  const now = nowUtc();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.vendorId !== undefined) { sets.push("vendor_id = ?"); params.push(input.vendorId); }
  if (input.vendorName !== undefined) { sets.push("vendor_name = ?"); params.push(input.vendorName); }
  if (input.vendorEmail !== undefined) { sets.push("vendor_email = ?"); params.push(input.vendorEmail); }
  if (input.paymentTerms !== undefined) { sets.push("payment_terms = ?"); params.push(input.paymentTerms); }
  if (input.billDate !== undefined) { sets.push("bill_date = ?"); params.push(input.billDate); }
  if (input.dueDate !== undefined) { sets.push("due_date = ?"); params.push(input.dueDate); }
  if (input.notes !== undefined) { sets.push("notes = ?"); params.push(input.notes); }
  if (input.reference !== undefined) { sets.push("reference = ?"); params.push(input.reference); }
  if (input.expenseAccountId !== undefined) { sets.push("expense_account_id = ?"); params.push(input.expenseAccountId); }
  if (input.apAccountId !== undefined) { sets.push("ap_account_id = ?"); params.push(input.apAccountId); }
  if (input.taxAccountId !== undefined) { sets.push("tax_account_id = ?"); params.push(input.taxAccountId); }
  if (input.taxRate !== undefined) { sets.push("tax_rate = ?"); params.push(input.taxRate); }
  if (input.taxInclusive !== undefined) { sets.push("tax_inclusive = ?"); params.push(input.taxInclusive ? 1 : 0); }

  // If line items provided, recalculate totals
  if (input.lineItems) {
    const taxRate = input.taxRate ?? (existing.tax_rate != null ? Number(existing.tax_rate) : null);
    const taxInclusive = input.taxInclusive ?? toBool(existing.tax_inclusive);
    const calc = calculateBillLineItems(input.lineItems, taxRate, taxInclusive);

    sets.push("subtotal = ?"); params.push(calc.subtotal);
    sets.push("tax_amount = ?"); params.push(calc.taxAmount);
    sets.push("total = ?"); params.push(calc.total);
    sets.push("amount_due = ?"); params.push(calc.total - Number(existing.amount_paid));

    // Delete and re-insert line items
    await db.run("DELETE FROM bill_line_items WHERE bill_id = ?", [billId]);
    for (const li of calc.lineItems) {
      await db.run(
        `INSERT INTO bill_line_items (
          id, bill_id, description, quantity, unit_price, amount,
          tax_rate, tax_amount, account_id, sort_order, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          generateId(), billId, li.description, li.quantity, li.unitPrice, li.amount,
          li.taxRate, li.taxAmount, li.accountId, li.sortOrder, now,
        ],
      );
    }
  }

  if (sets.length > 0) {
    sets.push("updated_at = ?"); params.push(now);
    params.push(billId);
    await db.run(`UPDATE bills SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  const bill = await fetchBillWithChildren(db, billId);
  return ok(bill!);
};

// ---------------------------------------------------------------------------
// Approve bill (posts AP journal entry)
// ---------------------------------------------------------------------------

export const approveBill = async (
  db: Database,
  engine: LedgerEngine,
  billId: string,
  ledgerId: string,
  _userId: string,
): Promise<Result<Bill>> => {
  const bill = await fetchBillWithChildren(db, billId);
  if (!bill) {
    return err(createError(ErrorCode.BILL_NOT_FOUND, `Bill not found: ${billId}`));
  }
  if (bill.status !== "draft") {
    return err(createError(ErrorCode.BILL_INVALID_STATE, "Only draft bills can be approved", [
      { field: "status", actual: bill.status, expected: "draft" },
    ]));
  }

  // Find AP account — use bill-level override or default by code pattern
  const apAccountCode = bill.apAccountId
    ? (await db.get<{ code: string }>("SELECT code FROM accounts WHERE id = ?", [bill.apAccountId]))?.code
    : (await db.get<{ code: string }>(
        "SELECT code FROM accounts WHERE ledger_id = ? AND type = 'liability' AND code LIKE '2_00' ORDER BY code LIMIT 1",
        [ledgerId],
      ))?.code ?? (await db.get<{ code: string }>(
        "SELECT code FROM accounts WHERE ledger_id = ? AND type = 'liability' AND name LIKE '%Payable%' ORDER BY code LIMIT 1",
        [ledgerId],
      ))?.code;

  if (!apAccountCode) {
    return err(createError(ErrorCode.ACCOUNT_NOT_FOUND, "No Accounts Payable account found. Create a liability account for AP or specify ap_account_id on the bill.", [
      { field: "apAccountId", suggestion: "Create a liability account with code 2000 named 'Accounts Payable'" },
    ]));
  }

  // Build journal entry lines — aggregate expense amounts by account
  const lines: { accountCode: string; amount: number; direction: "debit" | "credit"; memo?: string }[] = [];
  const expenseByAccount = new Map<string, number>();

  for (const li of bill.lineItems) {
    // Determine expense account for this line
    let expenseAccountCode: string | undefined;

    if (li.accountId) {
      expenseAccountCode = (await db.get<{ code: string }>("SELECT code FROM accounts WHERE id = ?", [li.accountId]))?.code;
    }

    if (!expenseAccountCode && bill.expenseAccountId) {
      expenseAccountCode = (await db.get<{ code: string }>("SELECT code FROM accounts WHERE id = ?", [bill.expenseAccountId]))?.code;
    }

    if (!expenseAccountCode && bill.vendorId) {
      const vendor = await db.get<VendorRow>("SELECT * FROM vendors WHERE id = ?", [bill.vendorId]);
      if (vendor?.default_expense_account_id) {
        expenseAccountCode = (await db.get<{ code: string }>("SELECT code FROM accounts WHERE id = ?", [vendor.default_expense_account_id]))?.code;
      }
    }

    if (!expenseAccountCode) {
      expenseAccountCode = (await db.get<{ code: string }>(
        "SELECT code FROM accounts WHERE ledger_id = ? AND type = 'expense' ORDER BY code LIMIT 1",
        [ledgerId],
      ))?.code;
    }

    if (!expenseAccountCode) {
      return err(createError(ErrorCode.ACCOUNT_NOT_FOUND, "No expense account found. Create an expense account or specify expense_account_id on the bill.", [
        { field: "expenseAccountId", suggestion: "Create an expense account with code 5000" },
      ]));
    }

    // Aggregate by account — use net amount (subtract tax if tax-inclusive)
    const lineAmount = bill.taxInclusive ? li.amount - li.taxAmount : li.amount;
    const existingAmount = expenseByAccount.get(expenseAccountCode) ?? 0;
    expenseByAccount.set(expenseAccountCode, existingAmount + lineAmount);
  }

  // Debit expense account(s)
  for (const [accountCode, amount] of expenseByAccount) {
    lines.push({
      accountCode,
      amount,
      direction: "debit",
      memo: `Bill ${bill.billNumber} — expense`,
    });
  }

  // If tax: Debit input tax credit account (asset)
  if (bill.taxAmount > 0) {
    const taxAccountCode = bill.taxAccountId
      ? (await db.get<{ code: string }>("SELECT code FROM accounts WHERE id = ?", [bill.taxAccountId]))?.code
      : (await db.get<{ code: string }>(
          "SELECT code FROM accounts WHERE ledger_id = ? AND type = 'asset' AND (name LIKE '%Input Tax%' OR name LIKE '%GST Receivable%' OR name LIKE '%VAT Receivable%') ORDER BY code LIMIT 1",
          [ledgerId],
        ))?.code;

    if (!taxAccountCode) {
      return err(createError(ErrorCode.ACCOUNT_NOT_FOUND, "No input tax credit account found. Create an asset account for input tax or specify tax_account_id on the bill.", [
        { field: "taxAccountId", suggestion: "Create an asset account for Input Tax Credit / GST Receivable" },
      ]));
    }

    lines.push({
      accountCode: taxAccountCode,
      amount: bill.taxAmount,
      direction: "debit",
      memo: `Bill ${bill.billNumber} — ${bill.taxLabel ?? "input tax credit"}`,
    });
  }

  // Credit AP for total
  lines.push({
    accountCode: apAccountCode,
    amount: bill.total,
    direction: "credit",
    memo: `Bill ${bill.billNumber}`,
  });

  // Post the journal entry
  const txResult = await engine.postTransaction({
    ledgerId,
    date: bill.billDate,
    memo: `Bill ${bill.billNumber} — ${bill.vendorName}`,
    lines,
    sourceType: "api",
    sourceRef: `bill:${billId}`,
    idempotencyKey: `bill-ap-${billId}`,
  });

  if (!txResult.ok) return err(txResult.error);

  // Auto-create vendor record if one doesn't exist for this vendor name
  let vendorId = bill.vendorId;
  if (!vendorId) {
    const existingVendor = await db.get<{ id: string }>(
      "SELECT id FROM vendors WHERE ledger_id = ? AND name = ? AND is_active = 1 LIMIT 1",
      [ledgerId, bill.vendorName],
    );
    if (existingVendor) {
      vendorId = existingVendor.id;
    } else {
      try {
        const vendorResult = await createVendor(db, ledgerId, {
          name: bill.vendorName,
          email: bill.vendorEmail ?? undefined,
        });
        if (vendorResult.ok) {
          vendorId = vendorResult.value.id;
        }
      } catch {
        // Non-fatal — vendor auto-creation is best-effort
      }
    }
  }

  const now = nowUtc();
  await db.run(
    `UPDATE bills SET status = ?, ap_transaction_id = ?, vendor_id = COALESCE(?, vendor_id), updated_at = ? WHERE id = ?`,
    ["approved", txResult.value.id, vendorId, now, billId],
  );

  const updated = await fetchBillWithChildren(db, billId);
  return ok(updated!);
};

// ---------------------------------------------------------------------------
// Record bill payment
// ---------------------------------------------------------------------------

export const recordBillPayment = async (
  db: Database,
  engine: LedgerEngine,
  billId: string,
  ledgerId: string,
  _userId: string,
  input: RecordBillPaymentInput,
): Promise<Result<Bill>> => {
  const bill = await fetchBillWithChildren(db, billId);
  if (!bill) {
    return err(createError(ErrorCode.BILL_NOT_FOUND, `Bill not found: ${billId}`));
  }

  const validStatuses = ["approved", "partially_paid", "overdue"];
  if (!validStatuses.includes(bill.status)) {
    return err(createError(ErrorCode.BILL_INVALID_STATE, `Cannot record payment on ${bill.status} bill`, [
      { field: "status", actual: bill.status, expected: "approved, partially_paid, or overdue" },
    ]));
  }

  if (input.amount <= 0) {
    return err(createError(ErrorCode.VALIDATION_ERROR, "Payment amount must be positive", [
      { field: "amount", actual: String(input.amount), expected: "positive integer" },
    ]));
  }

  if (input.amount > bill.amountDue) {
    return err(createError(ErrorCode.VALIDATION_ERROR, `Payment amount ${input.amount} exceeds amount due ${bill.amountDue}`, [
      { field: "amount", actual: String(input.amount), expected: `<= ${bill.amountDue}` },
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
      { field: "bankAccountId", suggestion: "Provide the ID of the bank or cash account used for the payment" },
    ]));
  }

  // Find AP account
  const apAccountCode = bill.apAccountId
    ? (await db.get<{ code: string }>("SELECT code FROM accounts WHERE id = ?", [bill.apAccountId]))?.code
    : (await db.get<{ code: string }>(
        "SELECT code FROM accounts WHERE ledger_id = ? AND type = 'liability' AND (code LIKE '2_00' OR name LIKE '%Payable%') ORDER BY code LIMIT 1",
        [ledgerId],
      ))?.code;

  if (!apAccountCode) {
    return err(createError(ErrorCode.ACCOUNT_NOT_FOUND, "No Accounts Payable account found"));
  }

  // Post payment journal entry: Debit AP, Credit Cash/Bank
  const txResult = await engine.postTransaction({
    ledgerId,
    date: input.paymentDate,
    memo: `Payment made — Bill ${bill.billNumber}`,
    lines: [
      { accountCode: apAccountCode, amount: input.amount, direction: "debit", memo: `Payment — Bill ${bill.billNumber}` },
      { accountCode: bankAccountCode, amount: input.amount, direction: "credit", memo: `Payment — Bill ${bill.billNumber}` },
    ],
    sourceType: "api",
    sourceRef: `bill-payment:${billId}`,
    idempotencyKey: `bill-payment-${billId}-${generateId()}`,
  });

  if (!txResult.ok) return err(txResult.error);

  // Insert payment record
  const paymentId = generateId();
  const now = nowUtc();
  await db.run(
    `INSERT INTO bill_payments (
      id, bill_id, amount, payment_date, payment_method,
      reference, transaction_id, bank_transaction_id, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      paymentId, billId, input.amount, input.paymentDate,
      input.paymentMethod ?? null, input.reference ?? null,
      txResult.value.id, null, input.notes ?? null, now,
    ],
  );

  // Update bill amounts and status
  const newAmountPaid = bill.amountPaid + input.amount;
  const newAmountDue = bill.amountDue - input.amount;
  const newStatus = newAmountDue === 0 ? "paid" : "partially_paid";
  const paidDate = newAmountDue === 0 ? input.paymentDate : null;

  await db.run(
    `UPDATE bills SET
      amount_paid = ?, amount_due = ?, status = ?,
      paid_date = ?, updated_at = ?
    WHERE id = ?`,
    [newAmountPaid, newAmountDue, newStatus, paidDate, now, billId],
  );

  const updated = await fetchBillWithChildren(db, billId);
  return ok(updated!);
};

// ---------------------------------------------------------------------------
// Void bill
// ---------------------------------------------------------------------------

export const voidBill = async (
  db: Database,
  engine: LedgerEngine,
  billId: string,
  _ledgerId: string,
  _userId: string,
): Promise<Result<Bill>> => {
  const bill = await fetchBillWithChildren(db, billId);
  if (!bill) {
    return err(createError(ErrorCode.BILL_NOT_FOUND, `Bill not found: ${billId}`));
  }

  if (bill.payments.length > 0) {
    return err(createError(ErrorCode.BILL_INVALID_STATE, "Cannot void a bill with recorded payments", [
      { field: "payments", actual: `${bill.payments.length} payment(s)`, expected: "0",
        suggestion: "Reverse or delete all payments before voiding" },
    ]));
  }

  // If AP journal entry was posted, reverse it
  if (bill.status !== "draft") {
    const apTxRow = await db.get<{ id: string }>(
      "SELECT ap_transaction_id AS id FROM bills WHERE id = ?",
      [billId],
    );
    if (apTxRow?.id) {
      const reverseResult = await engine.reverseTransaction(
        apTxRow.id,
        `Void bill ${bill.billNumber}`,
      );
      if (!reverseResult.ok) return err(reverseResult.error);
    }
  }

  const now = nowUtc();
  await db.run(
    "UPDATE bills SET status = 'void', updated_at = ? WHERE id = ?",
    [now, billId],
  );

  const updated = await fetchBillWithChildren(db, billId);
  return ok(updated!);
};

// ---------------------------------------------------------------------------
// Get bill
// ---------------------------------------------------------------------------

export const getBill = async (
  db: Database,
  billId: string,
): Promise<Result<Bill>> => {
  const bill = await fetchBillWithChildren(db, billId);
  if (!bill) {
    return err(createError(ErrorCode.BILL_NOT_FOUND, `Bill not found: ${billId}`));
  }
  return ok(bill);
};

// ---------------------------------------------------------------------------
// List bills
// ---------------------------------------------------------------------------

export const listBills = async (
  db: Database,
  ledgerId: string,
  filters?: {
    status?: string;
    vendorName?: string;
    vendorId?: string;
    dateFrom?: string;
    dateTo?: string;
    cursor?: string;
    limit?: number;
  },
): Promise<{ data: Bill[]; cursor: string | null }> => {
  const limit = Math.min(filters?.limit ?? 50, 200);
  const conditions: string[] = ["b.ledger_id = ?"];
  const params: unknown[] = [ledgerId];

  if (filters?.status) { conditions.push("b.status = ?"); params.push(filters.status); }
  if (filters?.vendorName) { conditions.push("b.vendor_name LIKE ?"); params.push(`%${filters.vendorName}%`); }
  if (filters?.vendorId) { conditions.push("b.vendor_id = ?"); params.push(filters.vendorId); }
  if (filters?.dateFrom) { conditions.push("b.bill_date >= ?"); params.push(filters.dateFrom); }
  if (filters?.dateTo) { conditions.push("b.bill_date <= ?"); params.push(filters.dateTo); }
  if (filters?.cursor) { conditions.push("b.id > ?"); params.push(filters.cursor); }

  params.push(limit + 1);

  const rows = await db.all<BillRow>(
    `SELECT b.* FROM bills b
     WHERE ${conditions.join(" AND ")}
     ORDER BY b.created_at DESC, b.id
     LIMIT ?`,
    params,
  );

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;

  const bills: Bill[] = [];
  for (const row of data) {
    const lineRows = await db.all<BillLineItemRow>(
      "SELECT * FROM bill_line_items WHERE bill_id = ? ORDER BY sort_order",
      [row.id],
    );
    const paymentRows = await db.all<BillPaymentRow>(
      "SELECT * FROM bill_payments WHERE bill_id = ? ORDER BY payment_date",
      [row.id],
    );
    bills.push(mapBill(
      row,
      lineRows.map(mapBillLineItem),
      paymentRows.map(mapBillPayment),
    ));
  }

  return {
    data: bills,
    cursor: hasMore && data.length > 0 ? data[data.length - 1]!.id : null,
  };
};

// ---------------------------------------------------------------------------
// Bill summary
// ---------------------------------------------------------------------------

export const getBillSummary = async (
  db: Database,
  ledgerId: string,
): Promise<BillSummary> => {
  const ledger = await db.get<{ currency: string }>(
    "SELECT currency FROM ledgers WHERE id = ?",
    [ledgerId],
  );
  const currency = ledger?.currency ?? "USD";

  const outstanding = await db.get<{ total: number | null }>(
    `SELECT COALESCE(SUM(amount_due), 0) AS total FROM bills
     WHERE ledger_id = ? AND status IN ('approved', 'partially_paid', 'overdue')`,
    [ledgerId],
  );

  const overdue = await db.get<{ total: number | null; cnt: number }>(
    `SELECT COALESCE(SUM(amount_due), 0) AS total, COUNT(*) AS cnt FROM bills
     WHERE ledger_id = ? AND status = 'overdue'`,
    [ledgerId],
  );

  const draft = await db.get<{ total: number | null }>(
    `SELECT COALESCE(SUM(total), 0) AS total FROM bills
     WHERE ledger_id = ? AND status = 'draft'`,
    [ledgerId],
  );

  const today = todayUtc();
  const monthStart = today.slice(0, 7) + "-01";
  const paidThisMonth = await db.get<{ total: number | null }>(
    `SELECT COALESCE(SUM(total), 0) AS total FROM bills
     WHERE ledger_id = ? AND status = 'paid' AND paid_date >= ?`,
    [ledgerId, monthStart],
  );

  const billCount = await db.get<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM bills WHERE ledger_id = ? AND status != 'void'`,
    [ledgerId],
  );

  // Average days to payment — try SQLite's JULIANDAY first, fall back to
  // PostgreSQL date arithmetic if it doesn't exist.
  let avgDaysValue: number | null = null;
  try {
    const avgDays = await db.get<{ avg_days: number | null }>(
      `SELECT AVG(JULIANDAY(paid_date) - JULIANDAY(bill_date)) AS avg_days FROM bills
       WHERE ledger_id = ? AND status = 'paid' AND paid_date IS NOT NULL`,
      [ledgerId],
    );
    avgDaysValue = avgDays?.avg_days ?? null;
  } catch {
    // JULIANDAY is SQLite-only; use PostgreSQL date subtraction
    try {
      const avgDays = await db.get<{ avg_days: number | null }>(
        `SELECT AVG(paid_date::date - bill_date::date) AS avg_days FROM bills
         WHERE ledger_id = ? AND status = 'paid' AND paid_date IS NOT NULL`,
        [ledgerId],
      );
      avgDaysValue = avgDays?.avg_days ?? null;
    } catch {
      // If both fail, leave as null
    }
  }

  return {
    totalOutstanding: Number(outstanding?.total ?? 0),
    totalOverdue: Number(overdue?.total ?? 0),
    totalDraft: Number(draft?.total ?? 0),
    totalPaidThisMonth: Number(paidThisMonth?.total ?? 0),
    billCount: billCount?.cnt ?? 0,
    overdueCount: overdue?.cnt ?? 0,
    averageDaysToPayment: avgDaysValue != null ? Math.round(avgDaysValue) : null,
    currency,
  };
};

// ---------------------------------------------------------------------------
// AP Aging
// ---------------------------------------------------------------------------

export const getAPAging = async (
  db: Database,
  ledgerId: string,
): Promise<APAgingBucket[]> => {
  const today = todayUtc();

  const rows = await db.all<{ amount_due: number; due_date: string }>(
    `SELECT amount_due, due_date FROM bills
     WHERE ledger_id = ? AND status IN ('approved', 'partially_paid', 'overdue')`,
    [ledgerId],
  );

  const buckets: APAgingBucket[] = [
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

    let bucket: APAgingBucket;
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

export const checkOverdueBills = async (
  db: Database,
  ledgerId: string,
): Promise<number> => {
  const today = todayUtc();
  const result = await db.run(
    `UPDATE bills SET status = 'overdue', updated_at = ?
     WHERE ledger_id = ? AND status = 'approved' AND due_date < ?`,
    [nowUtc(), ledgerId, today],
  );
  return result.changes;
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const toBool = (v: number | boolean | null | undefined): boolean =>
  v === true || v === 1;

// ---------------------------------------------------------------------------
// Bills — Accounts Payable Types
// ---------------------------------------------------------------------------

export type BillStatus =
  | "draft"
  | "approved"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "void";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface BillLineItem {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly amount: number;
  readonly taxRate: number | null;
  readonly taxAmount: number;
  readonly accountId: string | null;
  readonly sortOrder: number;
}

export interface BillPayment {
  readonly id: string;
  readonly billId: string;
  readonly amount: number;
  readonly paymentDate: string;
  readonly paymentMethod: string | null;
  readonly reference: string | null;
  readonly transactionId: string | null;
  readonly bankTransactionId: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
}

export interface Bill {
  readonly id: string;
  readonly ledgerId: string;
  readonly billNumber: string;
  readonly vendorId: string | null;
  readonly vendorName: string;
  readonly vendorEmail: string | null;
  readonly billDate: string;
  readonly dueDate: string;
  readonly subtotal: number;
  readonly taxAmount: number;
  readonly total: number;
  readonly amountPaid: number;
  readonly amountDue: number;
  readonly currency: string;
  readonly taxRate: number | null;
  readonly taxLabel: string | null;
  readonly taxInclusive: boolean;
  readonly status: BillStatus;
  readonly paidDate: string | null;
  readonly notes: string | null;
  readonly reference: string | null;
  readonly expenseAccountId: string | null;
  readonly apAccountId: string | null;
  readonly taxAccountId: string | null;
  readonly paymentTerms: string | null;
  readonly lineItems: readonly BillLineItem[];
  readonly payments: readonly BillPayment[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateBillLineItemInput {
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly taxRate?: number;
  readonly accountId?: string;
  readonly sortOrder?: number;
}

export interface CreateBillInput {
  readonly vendorId?: string;
  readonly vendorName: string;
  readonly vendorEmail?: string;
  readonly billDate: string;
  readonly dueDate?: string;
  readonly paymentTerms?: string;
  readonly lineItems: readonly CreateBillLineItemInput[];
  readonly taxRate?: number;
  readonly taxInclusive?: boolean;
  readonly notes?: string;
  readonly reference?: string;
  readonly expenseAccountId?: string;
  readonly apAccountId?: string;
  readonly taxAccountId?: string;
  readonly currency?: string;
  readonly billNumber?: string;
}

export interface UpdateBillInput {
  readonly vendorId?: string | null;
  readonly vendorName?: string;
  readonly vendorEmail?: string;
  readonly paymentTerms?: string;
  readonly billDate?: string;
  readonly dueDate?: string;
  readonly lineItems?: readonly CreateBillLineItemInput[];
  readonly taxRate?: number;
  readonly taxInclusive?: boolean;
  readonly notes?: string;
  readonly reference?: string;
  readonly expenseAccountId?: string;
  readonly apAccountId?: string;
  readonly taxAccountId?: string;
}

export interface RecordBillPaymentInput {
  readonly amount: number;
  readonly paymentDate: string;
  readonly paymentMethod?: string;
  readonly reference?: string;
  readonly notes?: string;
  readonly bankAccountId?: string;
}

// ---------------------------------------------------------------------------
// Summary / reporting types
// ---------------------------------------------------------------------------

export interface BillSummary {
  readonly totalOutstanding: number;
  readonly totalOverdue: number;
  readonly totalDraft: number;
  readonly totalPaidThisMonth: number;
  readonly billCount: number;
  readonly overdueCount: number;
  readonly averageDaysToPayment: number | null;
  readonly currency: string;
}

export interface APAgingBucket {
  readonly label: string;
  readonly amount: number;
  readonly count: number;
}

// ---------------------------------------------------------------------------
// Row types (snake_case, matching DB columns)
// ---------------------------------------------------------------------------

export interface BillRow {
  id: string;
  ledger_id: string;
  bill_number: string;
  vendor_id: string | null;
  vendor_name: string;
  vendor_email: string | null;
  bill_date: string;
  due_date: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  tax_rate: number | null;
  tax_label: string | null;
  tax_inclusive: number | boolean;
  status: string;
  paid_date: string | null;
  ap_transaction_id: string | null;
  notes: string | null;
  reference: string | null;
  expense_account_id: string | null;
  ap_account_id: string | null;
  tax_account_id: string | null;
  payment_terms: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillLineItemRow {
  id: string;
  bill_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  tax_rate: number | null;
  tax_amount: number;
  account_id: string | null;
  sort_order: number;
  created_at: string;
}

export interface BillPaymentRow {
  id: string;
  bill_id: string;
  amount: number;
  payment_date: string;
  payment_method: string | null;
  reference: string | null;
  transaction_id: string | null;
  bank_transaction_id: string | null;
  notes: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Mappers (Row → Domain)
// ---------------------------------------------------------------------------

const toBool = (v: number | boolean | null | undefined): boolean =>
  v === true || v === 1;

export const mapBillLineItem = (row: BillLineItemRow): BillLineItem => ({
  id: row.id,
  description: row.description,
  quantity: Number(row.quantity),
  unitPrice: Number(row.unit_price),
  amount: Number(row.amount),
  taxRate: row.tax_rate != null ? Number(row.tax_rate) : null,
  taxAmount: Number(row.tax_amount),
  accountId: row.account_id,
  sortOrder: row.sort_order,
});

export const mapBillPayment = (row: BillPaymentRow): BillPayment => ({
  id: row.id,
  billId: row.bill_id,
  amount: Number(row.amount),
  paymentDate: row.payment_date,
  paymentMethod: row.payment_method,
  reference: row.reference,
  transactionId: row.transaction_id,
  bankTransactionId: row.bank_transaction_id,
  notes: row.notes,
  createdAt: row.created_at,
});

export const mapBill = (
  row: BillRow,
  lineItems: readonly BillLineItem[],
  payments: readonly BillPayment[],
): Bill => ({
  id: row.id,
  ledgerId: row.ledger_id,
  billNumber: row.bill_number,
  vendorId: row.vendor_id,
  vendorName: row.vendor_name,
  vendorEmail: row.vendor_email,
  billDate: row.bill_date,
  dueDate: row.due_date,
  subtotal: Number(row.subtotal),
  taxAmount: Number(row.tax_amount),
  total: Number(row.total),
  amountPaid: Number(row.amount_paid),
  amountDue: Number(row.amount_due),
  currency: row.currency,
  taxRate: row.tax_rate != null ? Number(row.tax_rate) : null,
  taxLabel: row.tax_label,
  taxInclusive: toBool(row.tax_inclusive),
  status: row.status as BillStatus,
  paidDate: row.paid_date,
  notes: row.notes,
  reference: row.reference,
  expenseAccountId: row.expense_account_id,
  apAccountId: row.ap_account_id,
  taxAccountId: row.tax_account_id,
  paymentTerms: row.payment_terms,
  lineItems,
  payments,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

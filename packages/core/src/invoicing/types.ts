// ---------------------------------------------------------------------------
// Invoicing — Accounts Receivable Types
// ---------------------------------------------------------------------------

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "paid"
  | "partially_paid"
  | "overdue"
  | "void";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface InvoiceLineItem {
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

export interface InvoicePayment {
  readonly id: string;
  readonly invoiceId: string;
  readonly amount: number;
  readonly paymentDate: string;
  readonly paymentMethod: string | null;
  readonly reference: string | null;
  readonly transactionId: string | null;
  readonly bankTransactionId: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
}

export interface Invoice {
  readonly id: string;
  readonly ledgerId: string;
  readonly invoiceNumber: string;
  readonly customerName: string;
  readonly customerEmail: string | null;
  readonly customerAddress: string | null;
  readonly issueDate: string;
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
  readonly status: InvoiceStatus;
  readonly paidDate: string | null;
  readonly notes: string | null;
  readonly footer: string | null;
  readonly customerId: string | null;
  readonly paymentTerms: string | null;
  readonly revenueAccountId: string | null;
  readonly arAccountId: string | null;
  readonly taxAccountId: string | null;
  readonly lineItems: readonly InvoiceLineItem[];
  readonly payments: readonly InvoicePayment[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateInvoiceLineItemInput {
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly taxRate?: number;
  readonly accountId?: string;
  readonly sortOrder?: number;
}

export interface CreateInvoiceInput {
  readonly customerId?: string;
  readonly customerName: string;
  readonly customerEmail?: string;
  readonly customerAddress?: string;
  readonly issueDate: string;
  readonly dueDate?: string;
  readonly paymentTerms?: string;
  readonly lineItems: readonly CreateInvoiceLineItemInput[];
  readonly taxRate?: number;
  readonly taxInclusive?: boolean;
  readonly notes?: string;
  readonly footer?: string;
  readonly revenueAccountId?: string;
  readonly arAccountId?: string;
  readonly taxAccountId?: string;
  readonly currency?: string;
  readonly invoiceNumber?: string;
}

export interface UpdateInvoiceInput {
  readonly customerId?: string | null;
  readonly customerName?: string;
  readonly customerEmail?: string;
  readonly customerAddress?: string;
  readonly paymentTerms?: string;
  readonly issueDate?: string;
  readonly dueDate?: string;
  readonly lineItems?: readonly CreateInvoiceLineItemInput[];
  readonly taxRate?: number;
  readonly taxInclusive?: boolean;
  readonly notes?: string;
  readonly footer?: string;
  readonly revenueAccountId?: string;
  readonly arAccountId?: string;
  readonly taxAccountId?: string;
}

export interface RecordPaymentInput {
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

export interface InvoiceSummary {
  readonly totalOutstanding: number;
  readonly totalOverdue: number;
  readonly totalDraft: number;
  readonly totalPaidThisMonth: number;
  readonly invoiceCount: number;
  readonly overdueCount: number;
  readonly averageDaysToPayment: number | null;
  readonly currency: string;
}

export interface ARAgingBucket {
  readonly label: string;
  readonly amount: number;
  readonly count: number;
}

// ---------------------------------------------------------------------------
// Row types (snake_case, matching DB columns)
// ---------------------------------------------------------------------------

export interface InvoiceRow {
  id: string;
  ledger_id: string;
  invoice_number: string;
  customer_name: string;
  customer_email: string | null;
  customer_address: string | null;
  issue_date: string;
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
  payment_transaction_id: string | null;
  ar_transaction_id: string | null;
  notes: string | null;
  footer: string | null;
  customer_id: string | null;
  payment_terms: string | null;
  revenue_account_id: string | null;
  ar_account_id: string | null;
  tax_account_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineItemRow {
  id: string;
  invoice_id: string;
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

export interface InvoicePaymentRow {
  id: string;
  invoice_id: string;
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

export const mapInvoiceLineItem = (row: InvoiceLineItemRow): InvoiceLineItem => ({
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

export const mapInvoicePayment = (row: InvoicePaymentRow): InvoicePayment => ({
  id: row.id,
  invoiceId: row.invoice_id,
  amount: Number(row.amount),
  paymentDate: row.payment_date,
  paymentMethod: row.payment_method,
  reference: row.reference,
  transactionId: row.transaction_id,
  bankTransactionId: row.bank_transaction_id,
  notes: row.notes,
  createdAt: row.created_at,
});

export const mapInvoice = (
  row: InvoiceRow,
  lineItems: readonly InvoiceLineItem[],
  payments: readonly InvoicePayment[],
): Invoice => ({
  id: row.id,
  ledgerId: row.ledger_id,
  invoiceNumber: row.invoice_number,
  customerName: row.customer_name,
  customerEmail: row.customer_email,
  customerAddress: row.customer_address,
  issueDate: row.issue_date,
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
  status: row.status as InvoiceStatus,
  paidDate: row.paid_date,
  notes: row.notes,
  footer: row.footer,
  customerId: row.customer_id ?? null,
  paymentTerms: row.payment_terms ?? null,
  revenueAccountId: row.revenue_account_id,
  arAccountId: row.ar_account_id,
  taxAccountId: row.tax_account_id,
  lineItems,
  payments,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

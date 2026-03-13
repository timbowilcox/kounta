// ---------------------------------------------------------------------------
// Recurring entry types — automated periodic journal postings.
// ---------------------------------------------------------------------------

export type Frequency = "weekly" | "monthly" | "quarterly" | "annually";

export interface RecurringLineItem {
  readonly accountId: string;
  readonly amount: number;
  readonly direction: "debit" | "credit";
}

// ---------------------------------------------------------------------------
// Domain types (camelCase)
// ---------------------------------------------------------------------------

export interface RecurringEntry {
  readonly id: string;
  readonly ledgerId: string;
  readonly userId: string;
  readonly description: string;
  readonly lineItems: readonly RecurringLineItem[];
  readonly frequency: Frequency;
  readonly dayOfMonth: number | null;
  readonly nextRunDate: string;
  readonly lastRunDate: string | null;
  readonly autoReverse: boolean;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export interface RecurringEntryLog {
  readonly id: string;
  readonly recurringEntryId: string;
  readonly transactionId: string;
  readonly postedDate: string;
  readonly reversalTransactionId: string | null;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Database row types (snake_case)
// ---------------------------------------------------------------------------

export interface RecurringEntryRow {
  id: string;
  ledger_id: string;
  user_id: string;
  description: string;
  line_items: string; // JSON string
  frequency: string;
  day_of_month: number | null;
  next_run_date: string;
  last_run_date: string | null;
  auto_reverse: number | boolean;
  is_active: number | boolean;
  created_at: string;
}

export interface RecurringEntryLogRow {
  id: string;
  recurring_entry_id: string;
  transaction_id: string;
  posted_date: string;
  reversal_transaction_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export const toRecurringEntry = (row: RecurringEntryRow): RecurringEntry => ({
  id: row.id,
  ledgerId: row.ledger_id,
  userId: row.user_id,
  description: row.description,
  lineItems: JSON.parse(row.line_items) as RecurringLineItem[],
  frequency: row.frequency as Frequency,
  dayOfMonth: row.day_of_month,
  nextRunDate: row.next_run_date,
  lastRunDate: row.last_run_date,
  autoReverse: row.auto_reverse === true || row.auto_reverse === 1,
  isActive: row.is_active === true || row.is_active === 1,
  createdAt: row.created_at,
});

export const toRecurringEntryLog = (row: RecurringEntryLogRow): RecurringEntryLog => ({
  id: row.id,
  recurringEntryId: row.recurring_entry_id,
  transactionId: row.transaction_id,
  postedDate: row.posted_date,
  reversalTransactionId: row.reversal_transaction_id,
  createdAt: row.created_at,
});

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateRecurringEntryInput {
  readonly ledgerId: string;
  readonly userId: string;
  readonly description: string;
  readonly lineItems: readonly RecurringLineItem[];
  readonly frequency: Frequency;
  readonly dayOfMonth?: number | null;
  readonly nextRunDate: string;
  readonly autoReverse?: boolean;
}

export interface UpdateRecurringEntryInput {
  readonly description?: string;
  readonly lineItems?: readonly RecurringLineItem[];
  readonly frequency?: Frequency;
  readonly dayOfMonth?: number | null;
  readonly nextRunDate?: string;
  readonly autoReverse?: boolean;
}

// ---------------------------------------------------------------------------
// Recurring entry CRUD — pure DB functions.
// ---------------------------------------------------------------------------

import type { Database } from "../db/database.js";
import type { Result } from "../types/index.js";
import { createError, ErrorCode, ok, err } from "../errors/index.js";
import { generateId } from "../engine/id.js";
import type {
  RecurringEntry,
  RecurringEntryRow,
  RecurringEntryLog,
  RecurringEntryLogRow,
  CreateRecurringEntryInput,
  UpdateRecurringEntryInput,
} from "./types.js";
import { toRecurringEntry, toRecurringEntryLog } from "./types.js";

const notFoundError = (id: string) =>
  createError(ErrorCode.VALIDATION_ERROR, `Recurring entry not found: ${id}`, [
    { field: "id", actual: id, suggestion: "Check the recurring entry ID." },
  ]);

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export const createRecurringEntry = async (
  db: Database,
  input: CreateRecurringEntryInput,
): Promise<Result<RecurringEntry>> => {
  // Validate line items balance
  const debitTotal = input.lineItems
    .filter((l) => l.direction === "debit")
    .reduce((sum, l) => sum + l.amount, 0);
  const creditTotal = input.lineItems
    .filter((l) => l.direction === "credit")
    .reduce((sum, l) => sum + l.amount, 0);

  if (debitTotal !== creditTotal) {
    return err(
      createError(ErrorCode.VALIDATION_ERROR, `Line items are unbalanced: debits (${debitTotal}) ≠ credits (${creditTotal})`, [
        { field: "lineItems", actual: `debits=${debitTotal}, credits=${creditTotal}`, suggestion: "Ensure debits equal credits." },
      ]),
    );
  }

  if (input.lineItems.length < 2) {
    return err(
      createError(ErrorCode.VALIDATION_ERROR, "At least two line items are required", [
        { field: "lineItems", suggestion: "Provide at least one debit and one credit line." },
      ]),
    );
  }

  const id = generateId();

  await db.run(
    `INSERT INTO recurring_entries (id, ledger_id, user_id, description, line_items, frequency, day_of_month, next_run_date, auto_reverse)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.ledgerId,
      input.userId,
      input.description,
      JSON.stringify(input.lineItems),
      input.frequency,
      input.dayOfMonth ?? null,
      input.nextRunDate,
      input.autoReverse ? 1 : 0,
    ],
  );

  const row = await db.get<RecurringEntryRow>(
    "SELECT * FROM recurring_entries WHERE id = ?",
    [id],
  );

  return ok(toRecurringEntry(row!));
};

export const listRecurringEntries = async (
  db: Database,
  ledgerId: string,
): Promise<Result<readonly RecurringEntry[]>> => {
  const rows = await db.all<RecurringEntryRow>(
    "SELECT * FROM recurring_entries WHERE ledger_id = ? ORDER BY created_at DESC",
    [ledgerId],
  );
  return ok(rows.map(toRecurringEntry));
};

export const getRecurringEntry = async (
  db: Database,
  id: string,
): Promise<Result<RecurringEntry>> => {
  const row = await db.get<RecurringEntryRow>(
    "SELECT * FROM recurring_entries WHERE id = ?",
    [id],
  );
  if (!row) return err(notFoundError(id));
  return ok(toRecurringEntry(row));
};

export const updateRecurringEntry = async (
  db: Database,
  id: string,
  input: UpdateRecurringEntryInput,
): Promise<Result<RecurringEntry>> => {
  const existing = await db.get<RecurringEntryRow>(
    "SELECT * FROM recurring_entries WHERE id = ?",
    [id],
  );
  if (!existing) return err(notFoundError(id));

  // Validate line items balance if provided
  if (input.lineItems) {
    const debitTotal = input.lineItems
      .filter((l) => l.direction === "debit")
      .reduce((sum, l) => sum + l.amount, 0);
    const creditTotal = input.lineItems
      .filter((l) => l.direction === "credit")
      .reduce((sum, l) => sum + l.amount, 0);

    if (debitTotal !== creditTotal) {
      return err(
        createError(ErrorCode.VALIDATION_ERROR, `Line items are unbalanced: debits (${debitTotal}) ≠ credits (${creditTotal})`, [
          { field: "lineItems", actual: `debits=${debitTotal}, credits=${creditTotal}`, suggestion: "Ensure debits equal credits." },
        ]),
      );
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.lineItems !== undefined) {
    sets.push("line_items = ?");
    params.push(JSON.stringify(input.lineItems));
  }
  if (input.frequency !== undefined) {
    sets.push("frequency = ?");
    params.push(input.frequency);
  }
  if (input.dayOfMonth !== undefined) {
    sets.push("day_of_month = ?");
    params.push(input.dayOfMonth);
  }
  if (input.nextRunDate !== undefined) {
    sets.push("next_run_date = ?");
    params.push(input.nextRunDate);
  }
  if (input.autoReverse !== undefined) {
    sets.push("auto_reverse = ?");
    params.push(input.autoReverse ? 1 : 0);
  }

  if (sets.length > 0) {
    params.push(id);
    await db.run(
      `UPDATE recurring_entries SET ${sets.join(", ")} WHERE id = ?`,
      params,
    );
  }

  const row = await db.get<RecurringEntryRow>(
    "SELECT * FROM recurring_entries WHERE id = ?",
    [id],
  );
  return ok(toRecurringEntry(row!));
};

export const deleteRecurringEntry = async (
  db: Database,
  id: string,
): Promise<Result<{ id: string; deleted: true }>> => {
  const existing = await db.get<RecurringEntryRow>(
    "SELECT * FROM recurring_entries WHERE id = ?",
    [id],
  );
  if (!existing) return err(notFoundError(id));

  await db.run("DELETE FROM recurring_entries WHERE id = ?", [id]);
  return ok({ id, deleted: true as const });
};

export const pauseRecurringEntry = async (
  db: Database,
  id: string,
): Promise<Result<RecurringEntry>> => {
  const existing = await db.get<RecurringEntryRow>(
    "SELECT * FROM recurring_entries WHERE id = ?",
    [id],
  );
  if (!existing) return err(notFoundError(id));

  await db.run("UPDATE recurring_entries SET is_active = ? WHERE id = ?", [0, id]);

  const row = await db.get<RecurringEntryRow>(
    "SELECT * FROM recurring_entries WHERE id = ?",
    [id],
  );
  return ok(toRecurringEntry(row!));
};

export const resumeRecurringEntry = async (
  db: Database,
  id: string,
): Promise<Result<RecurringEntry>> => {
  const existing = await db.get<RecurringEntryRow>(
    "SELECT * FROM recurring_entries WHERE id = ?",
    [id],
  );
  if (!existing) return err(notFoundError(id));

  await db.run("UPDATE recurring_entries SET is_active = ? WHERE id = ?", [1, id]);

  const row = await db.get<RecurringEntryRow>(
    "SELECT * FROM recurring_entries WHERE id = ?",
    [id],
  );
  return ok(toRecurringEntry(row!));
};

// ---------------------------------------------------------------------------
// Due entries query
// ---------------------------------------------------------------------------

export const getDueEntries = async (
  db: Database,
  today: string,
): Promise<readonly RecurringEntry[]> => {
  const rows = await db.all<RecurringEntryRow>(
    "SELECT * FROM recurring_entries WHERE is_active = ? AND next_run_date <= ? ORDER BY next_run_date ASC",
    [1, today],
  );
  return rows.map(toRecurringEntry);
};

// ---------------------------------------------------------------------------
// Log operations
// ---------------------------------------------------------------------------

export const insertLog = async (
  db: Database,
  input: {
    recurringEntryId: string;
    transactionId: string;
    postedDate: string;
    reversalTransactionId?: string;
  },
): Promise<RecurringEntryLog> => {
  const id = generateId();
  await db.run(
    `INSERT INTO recurring_entry_log (id, recurring_entry_id, transaction_id, posted_date, reversal_transaction_id)
     VALUES (?, ?, ?, ?, ?)`,
    [id, input.recurringEntryId, input.transactionId, input.postedDate, input.reversalTransactionId ?? null],
  );
  const row = await db.get<RecurringEntryLogRow>(
    "SELECT * FROM recurring_entry_log WHERE id = ?",
    [id],
  );
  return toRecurringEntryLog(row!);
};

export const getLogsForEntry = async (
  db: Database,
  recurringEntryId: string,
  limit = 10,
): Promise<readonly RecurringEntryLog[]> => {
  const rows = await db.all<RecurringEntryLogRow>(
    "SELECT * FROM recurring_entry_log WHERE recurring_entry_id = ? ORDER BY created_at DESC LIMIT ?",
    [recurringEntryId, limit],
  );
  return rows.map(toRecurringEntryLog);
};

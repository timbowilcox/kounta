// ---------------------------------------------------------------------------
// Recurring entry scheduler — calculates next run dates and processes
// due entries by posting transactions via the engine.
// ---------------------------------------------------------------------------

import type { LedgerEngine } from "../engine/index.js";
import type { RecurringEntry, Frequency } from "./types.js";
import { getDueEntries, insertLog } from "./recurring.js";

// ---------------------------------------------------------------------------
// Date calculation
// ---------------------------------------------------------------------------

/**
 * Compute the next run date after `current`, given the recurring frequency.
 *
 * For monthly/quarterly/annually, clamps to the last day of the target month
 * when `dayOfMonth` exceeds the month length (e.g. day 31 in February → 28).
 */
export const getNextRunDate = (
  current: string,
  frequency: Frequency,
  dayOfMonth: number | null,
): string => {
  const d = new Date(current + "T00:00:00Z");

  switch (frequency) {
    case "weekly": {
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    }
    case "monthly": {
      const targetDay = dayOfMonth ?? d.getUTCDate();
      d.setUTCDate(1); // prevent overflow when advancing month
      d.setUTCMonth(d.getUTCMonth() + 1);
      clampDay(d, targetDay);
      break;
    }
    case "quarterly": {
      const targetDay = dayOfMonth ?? d.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + 3);
      clampDay(d, targetDay);
      break;
    }
    case "annually": {
      const targetDay = dayOfMonth ?? d.getUTCDate();
      d.setUTCDate(1);
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      clampDay(d, targetDay);
      break;
    }
  }

  return d.toISOString().slice(0, 10);
};

/** Clamp the day-of-month to the last day of the current month. */
const clampDay = (d: Date, targetDay: number): void => {
  // Find the last day of the current month
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(targetDay, lastDay));
};

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

interface AccountRow {
  id: string;
  code: string;
}

/**
 * Process all due recurring entries by posting transactions.
 *
 * Returns counts of processed and failed entries.
 */
export const processRecurringEntries = async (
  engine: LedgerEngine,
): Promise<{ processed: number; failed: number }> => {
  const today = new Date().toISOString().slice(0, 10);
  const db = engine.getDb();
  const dueEntries = await getDueEntries(db, today);

  let processed = 0;
  let failed = 0;

  for (const entry of dueEntries) {
    try {
      await processEntry(engine, entry);
      processed++;
    } catch (e) {
      console.error(`Recurring entry ${entry.id} failed:`, e);
      failed++;
    }
  }

  return { processed, failed };
};

const processEntry = async (
  engine: LedgerEngine,
  entry: RecurringEntry,
): Promise<void> => {
  const db = engine.getDb();

  // Check for duplicate — don't post twice for the same date
  const existingLog = await db.get(
    "SELECT id FROM recurring_entry_log WHERE recurring_entry_id = ? AND posted_date = ?",
    [entry.id, entry.nextRunDate],
  );
  if (existingLog) {
    // Already processed for this date — just advance
    const nextDate = getNextRunDate(entry.nextRunDate, entry.frequency, entry.dayOfMonth);
    await db.run(
      "UPDATE recurring_entries SET next_run_date = ?, last_run_date = ? WHERE id = ?",
      [nextDate, entry.nextRunDate, entry.id],
    );
    return;
  }

  // Look up account codes from account IDs
  const lines: Array<{ accountCode: string; amount: number; direction: "debit" | "credit" }> = [];

  for (const item of entry.lineItems) {
    const account = await db.get<AccountRow>(
      "SELECT id, code FROM accounts WHERE id = ?",
      [item.accountId],
    );
    if (!account) {
      throw new Error(`Account ${item.accountId} not found for recurring entry ${entry.id}`);
    }
    lines.push({
      accountCode: account.code,
      amount: item.amount,
      direction: item.direction,
    });
  }

  // Post the transaction
  const result = await engine.postTransaction({
    ledgerId: entry.ledgerId,
    date: entry.nextRunDate,
    memo: `[Recurring] ${entry.description}`,
    lines,
    sourceType: "api",
    idempotencyKey: `recurring-${entry.id}-${entry.nextRunDate}`,
  });

  if (!result.ok) {
    throw new Error(`Failed to post transaction: ${result.error.message}`);
  }

  const txn = result.value;

  // Handle auto-reverse: post a reversal dated 1st of next period
  let reversalTransactionId: string | undefined;

  if (entry.autoReverse) {
    const reversalDate = getFirstOfNextPeriod(entry.nextRunDate, entry.frequency);
    const reversalLines = lines.map((l) => ({
      accountCode: l.accountCode,
      amount: l.amount,
      direction: (l.direction === "debit" ? "credit" : "debit") as "debit" | "credit",
    }));

    const reversalResult = await engine.postTransaction({
      ledgerId: entry.ledgerId,
      date: reversalDate,
      memo: `[Auto-Reverse] ${entry.description}`,
      lines: reversalLines,
      sourceType: "api",
      idempotencyKey: `recurring-reverse-${entry.id}-${entry.nextRunDate}`,
    });

    if (reversalResult.ok) {
      reversalTransactionId = reversalResult.value.id;
    }
  }

  // Insert log entry
  await insertLog(db, {
    recurringEntryId: entry.id,
    transactionId: txn.id,
    postedDate: entry.nextRunDate,
    reversalTransactionId,
  });

  // Advance next_run_date
  const nextDate = getNextRunDate(entry.nextRunDate, entry.frequency, entry.dayOfMonth);
  await db.run(
    "UPDATE recurring_entries SET next_run_date = ?, last_run_date = ? WHERE id = ?",
    [nextDate, entry.nextRunDate, entry.id],
  );
};

/**
 * Get the 1st day of the next period for auto-reverse entries.
 */
const getFirstOfNextPeriod = (currentDate: string, frequency: Frequency): string => {
  const d = new Date(currentDate + "T00:00:00Z");

  switch (frequency) {
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCDate(1);
      break;
    case "quarterly":
      d.setUTCMonth(d.getUTCMonth() + 3);
      d.setUTCDate(1);
      break;
    case "annually":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      d.setUTCMonth(0);
      d.setUTCDate(1);
      break;
  }

  return d.toISOString().slice(0, 10);
};

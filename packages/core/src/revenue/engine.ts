// ---------------------------------------------------------------------------
// Revenue Recognition Engine — schedule CRUD, entry generation, recognition
// processing, metrics calculation.
// ---------------------------------------------------------------------------

import type { Database } from "../db/database.js";
import type { LedgerEngine } from "../engine/index.js";
import { generateId, nowUtc, todayUtc } from "../engine/id.js";
import type {
  RevenueSchedule,
  RevenueScheduleEntry,
  RevenueScheduleWithEntries,
  CreateScheduleInput,
  UpdateScheduleInput,
  RevenueMetrics,
  MrrHistoryEntry,
  ProcessingResult,
} from "./types.js";
import type { Result, PaginatedResult } from "../types/index.js";

// ---------------------------------------------------------------------------
// Row ↔ Domain mappers
// ---------------------------------------------------------------------------

interface ScheduleRow {
  id: string;
  ledger_id: string;
  source_type: string;
  source_ref: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  customer_name: string | null;
  total_amount: number;
  currency: string;
  recognition_start: string;
  recognition_end: string;
  frequency: string;
  status: string;
  amount_recognised: number;
  amount_remaining: number;
  deferred_revenue_account_id: string;
  revenue_account_id: string;
  description: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

interface EntryRow {
  id: string;
  schedule_id: string;
  ledger_id: string;
  period_start: string;
  period_end: string;
  amount: number;
  status: string;
  transaction_id: string | null;
  posted_at: string | null;
  created_at: string;
}

const mapSchedule = (row: ScheduleRow): RevenueSchedule => ({
  id: row.id,
  ledgerId: row.ledger_id,
  sourceType: row.source_type as RevenueSchedule["sourceType"],
  sourceRef: row.source_ref,
  stripeSubscriptionId: row.stripe_subscription_id,
  stripeCustomerId: row.stripe_customer_id,
  customerName: row.customer_name,
  totalAmount: Number(row.total_amount),
  currency: row.currency,
  recognitionStart: row.recognition_start,
  recognitionEnd: row.recognition_end,
  frequency: row.frequency as RevenueSchedule["frequency"],
  status: row.status as RevenueSchedule["status"],
  amountRecognised: Number(row.amount_recognised),
  amountRemaining: Number(row.amount_remaining),
  deferredRevenueAccountId: row.deferred_revenue_account_id,
  revenueAccountId: row.revenue_account_id,
  description: row.description,
  metadata: row.metadata ? JSON.parse(row.metadata) : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapEntry = (row: EntryRow): RevenueScheduleEntry => ({
  id: row.id,
  scheduleId: row.schedule_id,
  ledgerId: row.ledger_id,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  amount: Number(row.amount),
  status: row.status as RevenueScheduleEntry["status"],
  transactionId: row.transaction_id,
  postedAt: row.posted_at,
  createdAt: row.created_at,
});

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Count the number of months between two dates (YYYY-MM-DD). */
export const monthsBetween = (start: string, end: string): number => {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  const months =
    (e.getUTCFullYear() - s.getUTCFullYear()) * 12 +
    (e.getUTCMonth() - s.getUTCMonth());
  // If end day >= start day, count the end month; otherwise don't.
  // For recognition purposes, we always include both start and end months.
  return Math.max(1, months + 1);
};

/** Get the last day of a given month. */
const lastDayOfMonth = (year: number, month: number): number => {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
};

/** Generate monthly periods from start to end. */
export const generateMonthlyPeriods = (
  start: string,
  end: string,
): Array<{ periodStart: string; periodEnd: string }> => {
  const periods: Array<{ periodStart: string; periodEnd: string }> = [];
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");

  let year = s.getUTCFullYear();
  let month = s.getUTCMonth();

  const endYear = e.getUTCFullYear();
  const endMonth = e.getUTCMonth();

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const periodStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const last = lastDayOfMonth(year, month);
    const periodEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;

    periods.push({ periodStart, periodEnd });

    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }

  return periods;
};

// ---------------------------------------------------------------------------
// Schedule CRUD
// ---------------------------------------------------------------------------

export const createRevenueSchedule = async (
  db: Database,
  input: CreateScheduleInput,
): Promise<Result<RevenueScheduleWithEntries>> => {
  // Validate dates
  if (input.recognitionEnd <= input.recognitionStart) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "recognitionEnd must be after recognitionStart",
        details: [
          {
            field: "recognitionEnd",
            expected: `after ${input.recognitionStart}`,
            actual: input.recognitionEnd,
          },
        ],
      },
    };
  }

  if (input.totalAmount <= 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "totalAmount must be a positive integer",
        details: [{ field: "totalAmount", expected: "> 0", actual: String(input.totalAmount) }],
      },
    };
  }

  const periods = generateMonthlyPeriods(input.recognitionStart, input.recognitionEnd);
  const numPeriods = periods.length;

  // Distribute amount evenly, last period gets remainder
  const perPeriod = Math.floor(input.totalAmount / numPeriods);
  const remainder = input.totalAmount - perPeriod * numPeriods;

  const scheduleId = generateId();
  const now = nowUtc();
  const currency = input.currency ?? "USD";
  const frequency = input.frequency ?? "monthly";
  const sourceType = input.sourceType ?? "manual";

  await db.transaction(async () => {
    await db.run(
      `INSERT INTO revenue_schedules
        (id, ledger_id, source_type, source_ref, stripe_subscription_id,
         stripe_customer_id, customer_name, total_amount, currency,
         recognition_start, recognition_end, frequency, status,
         amount_recognised, amount_remaining,
         deferred_revenue_account_id, revenue_account_id,
         description, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scheduleId,
        input.ledgerId,
        sourceType,
        input.sourceRef ?? null,
        input.stripeSubscriptionId ?? null,
        input.stripeCustomerId ?? null,
        input.customerName ?? null,
        input.totalAmount,
        currency,
        input.recognitionStart,
        input.recognitionEnd,
        frequency,
        input.totalAmount,
        input.deferredRevenueAccountId,
        input.revenueAccountId,
        input.description ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now,
        now,
      ],
    );

    for (let i = 0; i < numPeriods; i++) {
      const period = periods[i]!;
      const amount = i === numPeriods - 1 ? perPeriod + remainder : perPeriod;
      const entryId = generateId();

      await db.run(
        `INSERT INTO revenue_schedule_entries
          (id, schedule_id, ledger_id, period_start, period_end, amount, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [entryId, scheduleId, input.ledgerId, period.periodStart, period.periodEnd, amount, now],
      );
    }
  });

  return getRevenueSchedule(db, scheduleId);
};

export const getRevenueSchedule = async (
  db: Database,
  scheduleId: string,
): Promise<Result<RevenueScheduleWithEntries>> => {
  const row = await db.get<ScheduleRow>(
    "SELECT * FROM revenue_schedules WHERE id = ?",
    [scheduleId],
  );
  if (!row) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: `Revenue schedule ${scheduleId} not found` },
    };
  }

  const entryRows = await db.all<EntryRow>(
    "SELECT * FROM revenue_schedule_entries WHERE schedule_id = ? ORDER BY period_start",
    [scheduleId],
  );

  return {
    ok: true,
    value: {
      ...mapSchedule(row),
      entries: entryRows.map(mapEntry),
    },
  };
};

export const listRevenueSchedules = async (
  db: Database,
  ledgerId: string,
  opts?: {
    status?: string;
    customerName?: string;
    stripeSubscriptionId?: string;
    cursor?: string;
    limit?: number;
  },
): Promise<PaginatedResult<RevenueSchedule>> => {
  const limit = Math.min(opts?.limit ?? 50, 200);
  const conditions: string[] = ["ledger_id = ?"];
  const params: unknown[] = [ledgerId];

  if (opts?.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  }
  if (opts?.customerName) {
    conditions.push("customer_name LIKE ?");
    params.push(`%${opts.customerName}%`);
  }
  if (opts?.stripeSubscriptionId) {
    conditions.push("stripe_subscription_id = ?");
    params.push(opts.stripeSubscriptionId);
  }
  if (opts?.cursor) {
    conditions.push("id < ?");
    params.push(opts.cursor);
  }

  params.push(limit + 1);

  const rows = await db.all<ScheduleRow>(
    `SELECT * FROM revenue_schedules
     WHERE ${conditions.join(" AND ")}
     ORDER BY id DESC
     LIMIT ?`,
    params,
  );

  const hasMore = rows.length > limit;
  const data = (hasMore ? rows.slice(0, limit) : rows).map(mapSchedule);

  return {
    data,
    nextCursor: hasMore ? data[data.length - 1]!.id : null,
  };
};

export const updateRevenueSchedule = async (
  db: Database,
  scheduleId: string,
  input: UpdateScheduleInput,
): Promise<Result<RevenueScheduleWithEntries>> => {
  const existing = await db.get<ScheduleRow>(
    "SELECT * FROM revenue_schedules WHERE id = ?",
    [scheduleId],
  );
  if (!existing) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: `Revenue schedule ${scheduleId} not found` },
    };
  }

  const now = nowUtc();

  switch (input.action) {
    case "pause": {
      if (existing.status !== "active") {
        return {
          ok: false,
          error: { code: "INVALID_STATE", message: "Only active schedules can be paused" },
        };
      }
      await db.run(
        "UPDATE revenue_schedules SET status = 'paused', updated_at = ? WHERE id = ?",
        [now, scheduleId],
      );
      break;
    }
    case "cancel": {
      if (existing.status === "completed" || existing.status === "cancelled") {
        return {
          ok: false,
          error: { code: "INVALID_STATE", message: `Cannot cancel a ${existing.status} schedule` },
        };
      }
      await db.transaction(async () => {
        await db.run(
          "UPDATE revenue_schedules SET status = 'cancelled', updated_at = ? WHERE id = ?",
          [now, scheduleId],
        );
        await db.run(
          "UPDATE revenue_schedule_entries SET status = 'skipped' WHERE schedule_id = ? AND status = 'pending'",
          [scheduleId],
        );
      });
      break;
    }
    case "resume": {
      if (existing.status !== "paused") {
        return {
          ok: false,
          error: { code: "INVALID_STATE", message: "Only paused schedules can be resumed" },
        };
      }
      await db.run(
        "UPDATE revenue_schedules SET status = 'active', updated_at = ? WHERE id = ?",
        [now, scheduleId],
      );
      break;
    }
  }

  return getRevenueSchedule(db, scheduleId);
};

export const cancelSchedule = async (
  db: Database,
  scheduleId: string,
  _reason?: string,
): Promise<Result<RevenueScheduleWithEntries>> => {
  return updateRevenueSchedule(db, scheduleId, { action: "cancel" });
};

// ---------------------------------------------------------------------------
// Recognition processing
// ---------------------------------------------------------------------------

interface DueEntry extends EntryRow {
  schedule_status: string;
  deferred_revenue_account_id: string;
  revenue_account_id: string;
  schedule_customer_name: string | null;
}

interface AccountCodeRow {
  code: string;
}

export const processRevenueRecognition = async (
  db: Database,
  engine: LedgerEngine,
  ledgerId: string,
  asOfDate?: string,
): Promise<ProcessingResult> => {
  const today = asOfDate ?? todayUtc();

  // Find due entries: period_end <= today, entry pending, schedule active
  const dueEntries = await db.all<DueEntry>(
    `SELECT e.*, s.status AS schedule_status,
            s.deferred_revenue_account_id,
            s.revenue_account_id,
            s.customer_name AS schedule_customer_name
     FROM revenue_schedule_entries e
     JOIN revenue_schedules s ON e.schedule_id = s.id
     WHERE e.ledger_id = ?
       AND e.period_end <= ?
       AND e.status = 'pending'
       AND s.status = 'active'
     ORDER BY e.period_start`,
    [ledgerId, today],
  );

  let processed = 0;
  let totalRecognised = 0;

  for (const entry of dueEntries) {
    // Resolve account codes
    const deferredAcct = await db.get<AccountCodeRow>(
      "SELECT code FROM accounts WHERE id = ?",
      [entry.deferred_revenue_account_id],
    );
    const revenueAcct = await db.get<AccountCodeRow>(
      "SELECT code FROM accounts WHERE id = ?",
      [entry.revenue_account_id],
    );

    if (!deferredAcct || !revenueAcct) {
      console.error(`Revenue recognition: account not found for entry ${entry.id}`);
      continue;
    }

    const customerLabel = entry.schedule_customer_name ?? "Unknown";
    const memo = `Revenue recognition: ${customerLabel} ${entry.period_start} to ${entry.period_end}`;

    // Post recognition transaction:
    // Debit deferred revenue (liability decreases)
    // Credit revenue account (revenue increases)
    const result = await engine.postTransaction({
      ledgerId: entry.ledger_id,
      date: entry.period_end,
      memo,
      lines: [
        { accountCode: deferredAcct.code, amount: entry.amount, direction: "debit" },
        { accountCode: revenueAcct.code, amount: entry.amount, direction: "credit" },
      ],
      sourceType: "api",
      idempotencyKey: `rev-recog-${entry.id}`,
    });

    if (!result.ok) {
      console.error(`Revenue recognition failed for entry ${entry.id}: ${result.error.message}`);
      continue;
    }

    const now = nowUtc();

    // Update entry
    await db.run(
      "UPDATE revenue_schedule_entries SET status = 'posted', transaction_id = ?, posted_at = ? WHERE id = ?",
      [result.value.id, now, entry.id],
    );

    // Update schedule totals
    await db.run(
      `UPDATE revenue_schedules
       SET amount_recognised = amount_recognised + ?,
           amount_remaining = amount_remaining - ?,
           updated_at = ?
       WHERE id = ?`,
      [entry.amount, entry.amount, now, entry.schedule_id],
    );

    // Check if schedule is now complete
    const schedule = await db.get<{ amount_remaining: number }>(
      "SELECT amount_remaining FROM revenue_schedules WHERE id = ?",
      [entry.schedule_id],
    );
    if (schedule && Number(schedule.amount_remaining) <= 0) {
      await db.run(
        "UPDATE revenue_schedules SET status = 'completed', updated_at = ? WHERE id = ?",
        [now, entry.schedule_id],
      );
    }

    processed++;
    totalRecognised += entry.amount;
  }

  return { processed, totalRecognised };
};

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export const getRevenueMetrics = async (
  db: Database,
  ledgerId: string,
): Promise<RevenueMetrics> => {
  const today = todayUtc();
  const currentMonth = today.slice(0, 7); // YYYY-MM
  const currentYear = today.slice(0, 4);
  const monthStart = `${currentMonth}-01`;
  const yearStart = `${currentYear}-01-01`;

  // MRR: sum of entry amounts for entries whose period includes the current month
  // (regardless of whether they've been posted yet)
  const mrrRow = await db.get<{ total: number | null }>(
    `SELECT SUM(e.amount) AS total
     FROM revenue_schedule_entries e
     JOIN revenue_schedules s ON e.schedule_id = s.id
     WHERE e.ledger_id = ?
       AND e.period_start <= ?
       AND e.period_end >= ?
       AND e.status != 'skipped'
       AND s.status IN ('active', 'completed')`,
    [ledgerId, today, monthStart],
  );
  const mrr = Number(mrrRow?.total ?? 0);

  // Deferred revenue balance
  const deferredRow = await db.get<{ total: number | null }>(
    `SELECT SUM(amount_remaining) AS total
     FROM revenue_schedules
     WHERE ledger_id = ? AND status IN ('active', 'paused')`,
    [ledgerId],
  );
  const deferredRevenueBalance = Number(deferredRow?.total ?? 0);

  // Recognised this month
  const recognisedMonthRow = await db.get<{ total: number | null }>(
    `SELECT SUM(e.amount) AS total
     FROM revenue_schedule_entries e
     WHERE e.ledger_id = ?
       AND e.status = 'posted'
       AND e.posted_at >= ?`,
    [ledgerId, `${monthStart}T00:00:00`],
  );
  const recognisedThisMonth = Number(recognisedMonthRow?.total ?? 0);

  // Recognised this year
  const recognisedYearRow = await db.get<{ total: number | null }>(
    `SELECT SUM(e.amount) AS total
     FROM revenue_schedule_entries e
     WHERE e.ledger_id = ?
       AND e.status = 'posted'
       AND e.posted_at >= ?`,
    [ledgerId, `${yearStart}T00:00:00`],
  );
  const recognisedThisYear = Number(recognisedYearRow?.total ?? 0);

  // Active schedules count
  const activeRow = await db.get<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM revenue_schedules
     WHERE ledger_id = ? AND status = 'active'`,
    [ledgerId],
  );
  const activeSchedules = Number(activeRow?.count ?? 0);

  return {
    mrr,
    arr: mrr * 12,
    deferredRevenueBalance,
    recognisedThisMonth,
    recognisedThisYear,
    activeSchedules,
  };
};

export const getMrrHistory = async (
  db: Database,
  ledgerId: string,
  months: number = 12,
): Promise<MrrHistoryEntry[]> => {
  const result: MrrHistoryEntry[] = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;
    const monthStart = `${monthStr}-01`;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const monthEnd = `${monthStr}-${String(lastDay).padStart(2, "0")}`;

    const row = await db.get<{ total: number | null }>(
      `SELECT SUM(e.amount) AS total
       FROM revenue_schedule_entries e
       JOIN revenue_schedules s ON e.schedule_id = s.id
       WHERE e.ledger_id = ?
         AND e.period_start <= ?
         AND e.period_end >= ?
         AND e.status != 'skipped'
         AND s.status IN ('active', 'completed')`,
      [ledgerId, monthEnd, monthStart],
    );

    result.push({ month: monthStr, mrr: Number(row?.total ?? 0) });
  }

  return result;
};

// ---------------------------------------------------------------------------
// Account auto-creation
// ---------------------------------------------------------------------------

export const ensureRevenueAccounts = async (
  db: Database,
  engine: LedgerEngine,
  ledgerId: string,
): Promise<{ deferredRevenueAccountId: string; revenueAccountId: string; serviceRevenueAccountId: string }> => {
  // Check for existing accounts by code
  const deferredRow = await db.get<{ id: string }>(
    "SELECT id FROM accounts WHERE ledger_id = ? AND code = '2500'",
    [ledgerId],
  );
  const revenueRow = await db.get<{ id: string }>(
    "SELECT id FROM accounts WHERE ledger_id = ? AND code = '4000'",
    [ledgerId],
  );
  const serviceRow = await db.get<{ id: string }>(
    "SELECT id FROM accounts WHERE ledger_id = ? AND code = '4010'",
    [ledgerId],
  );

  let deferredRevenueAccountId: string;
  let revenueAccountId: string;
  let serviceRevenueAccountId: string;

  // Create Deferred Revenue if not exists
  if (deferredRow) {
    deferredRevenueAccountId = deferredRow.id;
  } else {
    const result = await engine.createAccount({
      ledgerId,
      code: "2500",
      name: "Deferred Revenue",
      type: "liability",
    });
    if (!result.ok) {
      throw new Error(`Failed to create Deferred Revenue account: ${result.error.message}`);
    }
    deferredRevenueAccountId = result.value.id;
  }

  // Create Subscription Revenue if no revenue account exists
  if (revenueRow) {
    revenueAccountId = revenueRow.id;
  } else {
    // Check if any revenue account exists at all
    const anyRevenue = await db.get<{ id: string }>(
      "SELECT id FROM accounts WHERE ledger_id = ? AND type = 'revenue' LIMIT 1",
      [ledgerId],
    );
    if (anyRevenue) {
      revenueAccountId = anyRevenue.id;
    } else {
      const result = await engine.createAccount({
        ledgerId,
        code: "4000",
        name: "Subscription Revenue",
        type: "revenue",
      });
      if (!result.ok) {
        throw new Error(`Failed to create Subscription Revenue account: ${result.error.message}`);
      }
      revenueAccountId = result.value.id;
    }
  }

  // Create Service Revenue if not exists
  if (serviceRow) {
    serviceRevenueAccountId = serviceRow.id;
  } else {
    // Check if a service revenue account exists by name
    const existingService = await db.get<{ id: string }>(
      "SELECT id FROM accounts WHERE ledger_id = ? AND code = '4010'",
      [ledgerId],
    );
    if (existingService) {
      serviceRevenueAccountId = existingService.id;
    } else {
      const result = await engine.createAccount({
        ledgerId,
        code: "4010",
        name: "Service Revenue",
        type: "revenue",
      });
      if (!result.ok) {
        throw new Error(`Failed to create Service Revenue account: ${result.error.message}`);
      }
      serviceRevenueAccountId = result.value.id;
    }
  }

  return { deferredRevenueAccountId, revenueAccountId, serviceRevenueAccountId };
};

// ---------------------------------------------------------------------------
// Batch processor for scheduler — processes all ledgers with pending entries
// ---------------------------------------------------------------------------

export const processAllPendingRecognition = async (
  db: Database,
  engine: LedgerEngine,
): Promise<{ processed: number; failed: number }> => {
  // Find all ledgers with pending recognition entries
  const ledgers = await db.all<{ ledger_id: string }>(
    `SELECT DISTINCT e.ledger_id
     FROM revenue_schedule_entries e
     JOIN revenue_schedules s ON e.schedule_id = s.id
     WHERE e.status = 'pending'
       AND e.period_end <= ?
       AND s.status = 'active'`,
    [todayUtc()],
  );

  let totalProcessed = 0;
  let totalFailed = 0;

  for (const { ledger_id } of ledgers) {
    try {
      const result = await processRevenueRecognition(db, engine, ledger_id);
      totalProcessed += result.processed;
    } catch (err) {
      console.error(`Revenue recognition failed for ledger ${ledger_id}:`, err);
      totalFailed++;
    }
  }

  return { processed: totalProcessed, failed: totalFailed };
};

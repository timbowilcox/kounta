// ---------------------------------------------------------------------------
// Intelligence Analyzer — produces structured insights from ledger data.
//
// Each analyzer function queries the database, computes metrics, and returns
// structured data that can be rendered into human-readable notifications.
// No side effects — these are pure query + compute functions.
// ---------------------------------------------------------------------------

import type { Database } from "../db/database.js";
import type {
  MonthlySummaryData,
  CashPositionData,
  AnomalyData,
  UnclassifiedData,
  LargeDeferredBalanceData,
} from "./types.js";

// ---------------------------------------------------------------------------
// Monthly Summary — revenue, expenses, net income, top categories
// ---------------------------------------------------------------------------

export async function analyzeMonthlySummary(
  db: Database,
  ledgerId: string,
  year: number,
  month: number,
): Promise<MonthlySummaryData | null> {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;

  // Revenue for the period
  const revenueRow = await db.get<{ total: number | null }>(
    `SELECT COALESCE(SUM(li.amount), 0) as total
     FROM line_items li
     JOIN transactions t ON li.transaction_id = t.id
     JOIN accounts a ON li.account_id = a.id
     WHERE t.ledger_id = ? AND t.status = 'posted'
       AND t.date >= ? AND t.date < ?
       AND a.type = 'revenue' AND li.direction = 'credit'`,
    [ledgerId, startDate, endDate],
  );

  // Expenses for the period
  const expenseRow = await db.get<{ total: number | null }>(
    `SELECT COALESCE(SUM(li.amount), 0) as total
     FROM line_items li
     JOIN transactions t ON li.transaction_id = t.id
     JOIN accounts a ON li.account_id = a.id
     WHERE t.ledger_id = ? AND t.status = 'posted'
       AND t.date >= ? AND t.date < ?
       AND a.type = 'expense' AND li.direction = 'debit'`,
    [ledgerId, startDate, endDate],
  );

  const revenue = revenueRow?.total ?? 0;
  const expenses = expenseRow?.total ?? 0;

  // If no activity, skip
  if (revenue === 0 && expenses === 0) return null;

  // Previous month for comparison
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevStartDate = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;

  const prevRevenueRow = await db.get<{ total: number | null }>(
    `SELECT COALESCE(SUM(li.amount), 0) as total
     FROM line_items li
     JOIN transactions t ON li.transaction_id = t.id
     JOIN accounts a ON li.account_id = a.id
     WHERE t.ledger_id = ? AND t.status = 'posted'
       AND t.date >= ? AND t.date < ?
       AND a.type = 'revenue' AND li.direction = 'credit'`,
    [ledgerId, prevStartDate, startDate],
  );

  const prevExpenseRow = await db.get<{ total: number | null }>(
    `SELECT COALESCE(SUM(li.amount), 0) as total
     FROM line_items li
     JOIN transactions t ON li.transaction_id = t.id
     JOIN accounts a ON li.account_id = a.id
     WHERE t.ledger_id = ? AND t.status = 'posted'
       AND t.date >= ? AND t.date < ?
       AND a.type = 'expense' AND li.direction = 'debit'`,
    [ledgerId, prevStartDate, startDate],
  );

  const prevRevenue = prevRevenueRow?.total ?? 0;
  const prevExpenses = prevExpenseRow?.total ?? 0;

  const revenueChange = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : null;
  const expenseChange = prevExpenses > 0 ? ((expenses - prevExpenses) / prevExpenses) * 100 : null;

  // Top expense categories
  const topCategories = await db.all<{ name: string; total: number }>(
    `SELECT a.name, COALESCE(SUM(li.amount), 0) as total
     FROM line_items li
     JOIN transactions t ON li.transaction_id = t.id
     JOIN accounts a ON li.account_id = a.id
     WHERE t.ledger_id = ? AND t.status = 'posted'
       AND t.date >= ? AND t.date < ?
       AND a.type = 'expense' AND li.direction = 'debit'
     GROUP BY a.id, a.name
     ORDER BY total DESC
     LIMIT 5`,
    [ledgerId, startDate, endDate],
  );

  // Transaction count
  const countRow = await db.get<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM transactions
     WHERE ledger_id = ? AND status = 'posted' AND date >= ? AND date < ?`,
    [ledgerId, startDate, endDate],
  );

  return {
    period: `${year}-${String(month).padStart(2, "0")}`,
    revenue,
    expenses,
    netIncome: revenue - expenses,
    revenueChange,
    expenseChange,
    topExpenseCategories: topCategories.map((c) => ({ name: c.name, amount: c.total })),
    transactionCount: countRow?.cnt ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Cash Position — current cash, runway, daily burn
// ---------------------------------------------------------------------------

export async function analyzeCashPosition(
  db: Database,
  ledgerId: string,
): Promise<CashPositionData | null> {
  // Cash accounts = asset accounts where code starts with 1 (convention)
  // or name contains "cash", "bank", "checking", "savings"
  const cashAccounts = await db.all<{ id: string; name: string; code: string }>(
    `SELECT id, name, code FROM accounts
     WHERE ledger_id = ? AND type = 'asset' AND status = 'active'
       AND (LOWER(name) LIKE '%cash%' OR LOWER(name) LIKE '%bank%'
            OR LOWER(name) LIKE '%checking%' OR LOWER(name) LIKE '%savings%'
            OR code LIKE '1000%' OR code LIKE '1010%' OR code LIKE '1020%')`,
    [ledgerId],
  );

  if (cashAccounts.length === 0) return null;

  const accountIds = cashAccounts.map((a) => a.id);
  const placeholders = accountIds.map(() => "?").join(",");

  // Current balances
  const balances = await db.all<{ account_id: string; balance: number }>(
    `SELECT li.account_id,
       SUM(CASE WHEN li.direction = 'debit' THEN li.amount ELSE -li.amount END) as balance
     FROM line_items li
     JOIN transactions t ON li.transaction_id = t.id
     WHERE t.ledger_id = ? AND t.status = 'posted'
       AND li.account_id IN (${placeholders})
     GROUP BY li.account_id`,
    [ledgerId, ...accountIds],
  );

  const balanceMap = new Map(balances.map((b) => [b.account_id, b.balance]));
  const totalCash = balances.reduce((sum, b) => sum + b.balance, 0);

  // Previous month's cash for comparison
  const now = new Date();
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const prevBalances = await db.all<{ account_id: string; balance: number }>(
    `SELECT li.account_id,
       SUM(CASE WHEN li.direction = 'debit' THEN li.amount ELSE -li.amount END) as balance
     FROM line_items li
     JOIN transactions t ON li.transaction_id = t.id
     WHERE t.ledger_id = ? AND t.status = 'posted'
       AND t.date < ?
       AND li.account_id IN (${placeholders})
     GROUP BY li.account_id`,
    [ledgerId, firstOfMonth, ...accountIds],
  );

  const previousCash = prevBalances.reduce((sum, b) => sum + b.balance, 0);

  // Average daily expenses over last 90 days
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString().split("T")[0]!;

  const expenseRow = await db.get<{ total: number | null }>(
    `SELECT COALESCE(SUM(li.amount), 0) as total
     FROM line_items li
     JOIN transactions t ON li.transaction_id = t.id
     JOIN accounts a ON li.account_id = a.id
     WHERE t.ledger_id = ? AND t.status = 'posted'
       AND t.date >= ? AND a.type = 'expense' AND li.direction = 'debit'`,
    [ledgerId, ninetyDaysAgo],
  );

  const totalExpenses90d = expenseRow?.total ?? 0;
  const avgDailyExpenses = Math.round(totalExpenses90d / 90);
  const daysOfRunway = avgDailyExpenses > 0 ? Math.round(totalCash / avgDailyExpenses) : null;

  return {
    totalCash,
    previousCash,
    changeAmount: totalCash - previousCash,
    changePercent: previousCash !== 0
      ? Math.round(((totalCash - previousCash) / Math.abs(previousCash)) * 10000) / 100
      : 0,
    cashAccounts: cashAccounts.map((a) => ({
      name: a.name,
      balance: balanceMap.get(a.id) ?? 0,
    })),
    daysOfRunway,
    avgDailyExpenses,
  };
}

// ---------------------------------------------------------------------------
// Anomaly Detection — unusual amounts, duplicate suspects
// ---------------------------------------------------------------------------

export async function detectAnomalies(
  db: Database,
  ledgerId: string,
  lookbackDays: number = 30,
): Promise<readonly AnomalyData[]> {
  const anomalies: AnomalyData[] = [];
  const sinceDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString().split("T")[0]!;

  // 1. Unusual amounts — transactions significantly larger than the account's average
  const unusualAmounts = await db.all<{
    transaction_id: string;
    account_id: string;
    account_name: string;
    amount: number;
    avg_amount: number;
    stddev_amount: number;
  }>(
    `SELECT li.transaction_id, li.account_id, a.name as account_name,
            li.amount, sub.avg_amount, sub.stddev_amount
     FROM line_items li
     JOIN transactions t ON li.transaction_id = t.id
     JOIN accounts a ON li.account_id = a.id
     JOIN (
       SELECT li2.account_id,
              AVG(li2.amount) as avg_amount,
              AVG(li2.amount * li2.amount) - AVG(li2.amount) * AVG(li2.amount) as variance
       FROM line_items li2
       JOIN transactions t2 ON li2.transaction_id = t2.id
       WHERE t2.ledger_id = ? AND t2.status = 'posted'
       GROUP BY li2.account_id
       HAVING COUNT(*) >= 5
     ) sub ON li.account_id = sub.account_id
     WHERE t.ledger_id = ? AND t.status = 'posted' AND t.date >= ?
       AND li.amount > sub.avg_amount * 3
       AND sub.variance > 0
     ORDER BY li.amount DESC
     LIMIT 5`,
    [ledgerId, ledgerId, sinceDate],
  );

  for (const row of unusualAmounts) {
    const stddev = Math.sqrt(Math.max(row.stddev_amount, 0));
    anomalies.push({
      anomalyType: "unusual_amount",
      transactionId: row.transaction_id,
      accountId: row.account_id,
      accountName: row.account_name,
      amount: row.amount,
      expectedRange: {
        min: Math.round(row.avg_amount - stddev * 2),
        max: Math.round(row.avg_amount + stddev * 2),
      },
      description: `Transaction of ${row.amount} on ${row.account_name} is unusually large (average: ${Math.round(row.avg_amount)})`,
    });
  }

  // 2. Duplicate suspects — same amount, same account, within 2 days
  const duplicates = await db.all<{
    t1_id: string;
    t2_id: string;
    account_name: string;
    amount: number;
    date1: string;
    date2: string;
  }>(
    `SELECT t1.id as t1_id, t2.id as t2_id, a.name as account_name,
            li1.amount, t1.date as date1, t2.date as date2
     FROM line_items li1
     JOIN line_items li2 ON li1.account_id = li2.account_id
       AND li1.amount = li2.amount
       AND li1.direction = li2.direction
       AND li1.id < li2.id
     JOIN transactions t1 ON li1.transaction_id = t1.id
     JOIN transactions t2 ON li2.transaction_id = t2.id
     JOIN accounts a ON li1.account_id = a.id
     WHERE t1.ledger_id = ? AND t1.status = 'posted' AND t2.status = 'posted'
       AND t1.date >= ? AND t2.date >= ?
       AND ABS(JULIANDAY(t1.date) - JULIANDAY(t2.date)) <= 2
     LIMIT 5`,
    [ledgerId, sinceDate, sinceDate],
  );

  for (const row of duplicates) {
    anomalies.push({
      anomalyType: "duplicate_suspect",
      transactionId: row.t1_id,
      accountId: null,
      accountName: row.account_name,
      amount: row.amount,
      expectedRange: null,
      description: `Possible duplicate: ${row.amount} on ${row.account_name} posted on ${row.date1} and ${row.date2}`,
    });
  }

  return anomalies;
}

// ---------------------------------------------------------------------------
// Large Deferred Balance — alert when deferred revenue is disproportionately high
// ---------------------------------------------------------------------------

export async function analyzeDeferredBalance(
  db: Database,
  ledgerId: string,
): Promise<LargeDeferredBalanceData | null> {
  // Total deferred revenue (amount_remaining on active/paused schedules)
  const deferredRow = await db.get<{ total: number | null }>(
    `SELECT SUM(amount_remaining) AS total
     FROM revenue_schedules
     WHERE ledger_id = ? AND status IN ('active', 'paused')`,
    [ledgerId],
  );
  const deferredBalance = Number(deferredRow?.total ?? 0);
  if (deferredBalance === 0) return null;

  // Average monthly recognised over the last 3 months
  const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString().split("T")[0]!;

  const recognisedRow = await db.get<{ total: number | null }>(
    `SELECT SUM(e.amount) AS total
     FROM revenue_schedule_entries e
     WHERE e.ledger_id = ? AND e.status = 'posted' AND e.posted_at >= ?`,
    [ledgerId, `${threeMonthsAgo}T00:00:00`],
  );
  const totalRecognised3m = Number(recognisedRow?.total ?? 0);
  const monthlyRecognised = totalRecognised3m > 0 ? Math.round(totalRecognised3m / 3) : 0;

  // Only alert if deferred > 3x monthly recognised
  if (monthlyRecognised <= 0) return null;
  const monthsOfDeferred = Math.round((deferredBalance / monthlyRecognised) * 10) / 10;
  if (monthsOfDeferred <= 3) return null;

  return { deferredBalance, monthlyRecognised, monthsOfDeferred };
}

// ---------------------------------------------------------------------------
// Unclassified Transactions — transactions without clear account mapping
// ---------------------------------------------------------------------------

export async function findUnclassifiedTransactions(
  db: Database,
  ledgerId: string,
): Promise<UnclassifiedData | null> {
  // Find transactions where all lines go to generic/catch-all accounts
  // (accounts named "other", "uncategorized", "suspense", "clearing", or
  //  accounts at the root of the expense tree with no children)
  const uncategorized = await db.all<{
    id: string;
    date: string;
    memo: string;
    amount: number;
  }>(
    `SELECT DISTINCT t.id, t.date, t.memo,
            (SELECT SUM(li2.amount) FROM line_items li2 WHERE li2.transaction_id = t.id AND li2.direction = 'debit') as amount
     FROM transactions t
     JOIN line_items li ON li.transaction_id = t.id
     JOIN accounts a ON li.account_id = a.id
     WHERE t.ledger_id = ? AND t.status = 'posted'
       AND (LOWER(a.name) LIKE '%uncategorized%'
            OR LOWER(a.name) LIKE '%other expense%'
            OR LOWER(a.name) LIKE '%other income%'
            OR LOWER(a.name) LIKE '%suspense%'
            OR LOWER(a.name) LIKE '%clearing%'
            OR LOWER(a.name) LIKE '%miscellaneous%')
     ORDER BY t.date DESC
     LIMIT 50`,
    [ledgerId],
  );

  if (uncategorized.length === 0) return null;

  const totalAmount = uncategorized.reduce((sum, t) => sum + (t.amount ?? 0), 0);

  return {
    count: uncategorized.length,
    totalAmount,
    sampleTransactions: uncategorized.slice(0, 5).map((t) => ({
      id: t.id,
      date: t.date,
      memo: t.memo ?? "",
      amount: t.amount ?? 0,
    })),
  };
}

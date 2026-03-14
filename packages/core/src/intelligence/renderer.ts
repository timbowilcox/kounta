// ---------------------------------------------------------------------------
// Intelligence Renderer — converts structured insight data into plain-language
// notification titles and bodies for humans and AI agents.
// ---------------------------------------------------------------------------

import type {
  MonthlySummaryData,
  CashPositionData,
  AnomalyData,
  UnclassifiedData,
  MonthlyRecognitionSummaryData,
  ScheduleCompletionData,
  LargeDeferredBalanceData,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAmount(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toFixed(2);
  const formatted = dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return cents < 0 ? `-$${formatted}` : `$${formatted}`;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ---------------------------------------------------------------------------
// Monthly Summary
// ---------------------------------------------------------------------------

export function renderMonthlySummary(data: MonthlySummaryData): { title: string; body: string } {
  const [yearStr, monthStr] = data.period.split("-");
  const monthName = monthNames[parseInt(monthStr!, 10) - 1] ?? monthStr;

  const title = `${monthName} ${yearStr} Summary`;

  const lines: string[] = [];
  lines.push(`Revenue: ${formatAmount(data.revenue)}${data.revenueChange !== null ? ` (${formatPercent(data.revenueChange)} vs prior month)` : ""}`);
  lines.push(`Expenses: ${formatAmount(data.expenses)}${data.expenseChange !== null ? ` (${formatPercent(data.expenseChange)} vs prior month)` : ""}`);
  lines.push(`Net Income: ${formatAmount(data.netIncome)}`);
  lines.push(`Transactions: ${data.transactionCount}`);

  if (data.topExpenseCategories.length > 0) {
    lines.push("");
    lines.push("Top expense categories:");
    for (const cat of data.topExpenseCategories) {
      lines.push(`  • ${cat.name}: ${formatAmount(cat.amount)}`);
    }
  }

  return { title, body: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// Cash Position
// ---------------------------------------------------------------------------

export function renderCashPosition(data: CashPositionData): { title: string; body: string; severity: "info" | "warning" | "critical" } {
  let severity: "info" | "warning" | "critical" = "info";

  if (data.daysOfRunway !== null && data.daysOfRunway < 30) {
    severity = "critical";
  } else if (data.daysOfRunway !== null && data.daysOfRunway < 90) {
    severity = "warning";
  } else if (data.changePercent < -20) {
    severity = "warning";
  }

  const title = severity === "critical"
    ? `Low Cash Alert — ${data.daysOfRunway} days of runway`
    : severity === "warning"
      ? `Cash Position Warning — ${formatAmount(data.totalCash)}`
      : `Cash Position — ${formatAmount(data.totalCash)}`;

  const lines: string[] = [];
  lines.push(`Total cash: ${formatAmount(data.totalCash)}`);
  lines.push(`Change this month: ${formatAmount(data.changeAmount)} (${formatPercent(data.changePercent)})`);

  if (data.daysOfRunway !== null) {
    lines.push(`Estimated runway: ${data.daysOfRunway} days at ${formatAmount(data.avgDailyExpenses)}/day burn rate`);
  }

  if (data.cashAccounts.length > 1) {
    lines.push("");
    lines.push("Cash accounts:");
    for (const acct of data.cashAccounts) {
      lines.push(`  • ${acct.name}: ${formatAmount(acct.balance)}`);
    }
  }

  return { title, body: lines.join("\n"), severity };
}

// ---------------------------------------------------------------------------
// Anomalies
// ---------------------------------------------------------------------------

export function renderAnomalies(anomalies: readonly AnomalyData[]): { title: string; body: string; severity: "info" | "warning" | "critical" } {
  if (anomalies.length === 0) {
    return { title: "No Anomalies Detected", body: "No unusual patterns found in recent transactions.", severity: "info" };
  }

  const severity = anomalies.length >= 3 ? "warning" : "info";

  const title = anomalies.length === 1
    ? "Anomaly Detected"
    : `${anomalies.length} Anomalies Detected`;

  const lines: string[] = [];
  for (const a of anomalies) {
    lines.push(`• ${a.description}`);
  }

  return { title, body: lines.join("\n"), severity };
}

// ---------------------------------------------------------------------------
// Monthly Recognition Summary
// ---------------------------------------------------------------------------

export function renderMonthlyRecognitionSummary(data: MonthlyRecognitionSummaryData): { title: string; body: string } {
  const [, monthStr] = data.period.split("-");
  const monthName = monthNames[parseInt(monthStr!, 10) - 1] ?? monthStr;

  const title = `${monthName} revenue recognition complete`;
  const body = `${formatAmount(data.totalRecognised)} recognised from ${data.schedulesProcessed} schedule${data.schedulesProcessed !== 1 ? "s" : ""}. ${formatAmount(data.totalDeferred)} still deferred.`;

  return { title, body };
}

// ---------------------------------------------------------------------------
// Schedule Completion
// ---------------------------------------------------------------------------

export function renderScheduleCompletion(data: ScheduleCompletionData): { title: string; body: string } {
  const title = "Subscription fully recognised";
  const customerLabel = data.customerName || "Unknown";
  const desc = data.description ? ` (${data.description})` : "";
  const body = `${desc ? data.description : "Revenue schedule"} from ${customerLabel} fully recognised. Total: ${formatAmount(data.totalAmount)}.`;

  return { title, body };
}

// ---------------------------------------------------------------------------
// Large Deferred Balance
// ---------------------------------------------------------------------------

export function renderLargeDeferredBalance(data: LargeDeferredBalanceData): { title: string; body: string } {
  const title = "High deferred revenue balance";
  const body = `Deferred revenue is ${formatAmount(data.deferredBalance)} — ${data.monthsOfDeferred} months of pre-paid revenue.`;

  return { title, body };
}

// ---------------------------------------------------------------------------
// Unclassified Transactions
// ---------------------------------------------------------------------------

export function renderUnclassified(data: UnclassifiedData): { title: string; body: string; severity: "info" | "warning" } {
  const severity = data.count >= 10 ? "warning" : "info";

  const title = `${data.count} Unclassified Transaction${data.count !== 1 ? "s" : ""}`;

  const lines: string[] = [];
  lines.push(`${data.count} transactions totaling ${formatAmount(data.totalAmount)} are in catch-all accounts.`);
  lines.push("Consider recategorizing them for more accurate reporting.");

  if (data.sampleTransactions.length > 0) {
    lines.push("");
    lines.push("Recent examples:");
    for (const t of data.sampleTransactions) {
      lines.push(`  • ${t.date}: ${t.memo || "(no memo)"} — ${formatAmount(t.amount)}`);
    }
  }

  return { title, body: lines.join("\n"), severity };
}

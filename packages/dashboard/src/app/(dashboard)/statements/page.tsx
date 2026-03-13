import { getSessionClient } from "@/lib/ledge";
import type { StatementResponse } from "@ledge/sdk";
import { StatementsView } from "./statements-view";
import { fetchClosedPeriods } from "@/lib/actions";
import type { ClosedPeriodSummary } from "@/lib/actions";

export const dynamic = "force-dynamic";

const emptyStatement = {
  ledgerId: "", statementType: "income_statement" as const,
  period: { startDate: "", endDate: "" }, currency: "USD",
  generatedAt: "", sections: [] as readonly unknown[], totals: {},
  warnings: [] as readonly string[], plainLanguageSummary: "",
} as unknown as StatementResponse;

export default async function StatementsPage() {
  // Default date range: start of year to today
  const now = new Date();
  const startDate = now.getFullYear() + "-01-01";
  const endDate = now.toISOString().split("T")[0];

  let pnl: StatementResponse = emptyStatement;
  let bs: StatementResponse = emptyStatement;
  let cf: StatementResponse = emptyStatement;
  let fiscalYearStart = 1;
  let closedThrough: string | null = null;
  let closedPeriods: ClosedPeriodSummary[] = [];

  try {
    const { client, ledgerId } = await getSessionClient();
    const [pnlRes, bsRes, cfRes] = await Promise.allSettled([
      client.reports.incomeStatement(ledgerId, startDate, endDate),
      client.reports.balanceSheet(ledgerId, endDate),
      client.reports.cashFlow(ledgerId, startDate, endDate),
    ]);

    if (pnlRes.status === "fulfilled") pnl = pnlRes.value;
    if (bsRes.status === "fulfilled") bs = bsRes.value;
    if (cfRes.status === "fulfilled") cf = cfRes.value;

    // Fetch ledger info for fiscal year + closed periods
    try {
      const ledger = await client.ledgers.get(ledgerId);
      fiscalYearStart = (ledger as any).fiscalYearStart ?? 1;
      closedThrough = (ledger as any).closedThrough ?? null;
    } catch {}
    try {
      closedPeriods = await fetchClosedPeriods();
    } catch {}
  } catch {
    // Session or API error — render with empty statements
  }

  return (
    <StatementsView
      initialPnl={pnl}
      initialBalanceSheet={bs}
      initialCashFlow={cf}
      defaultStart={startDate}
      defaultEnd={endDate}
      fiscalYearStart={fiscalYearStart}
      closedThrough={closedThrough}
      closedPeriods={closedPeriods}
    />
  );
}

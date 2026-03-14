import { kounta, LEDGER_ID } from "@/lib/kounta";
import { StatementTable } from "@/components/statement-table";
import { RecentTransactions } from "@/components/recent-transactions";
import { SimulatePayment } from "@/components/simulate-payment";
import { formatCurrency } from "@/lib/format";
import type { StatementResponse } from "@kounta/sdk";

export const dynamic = "force-dynamic";

async function fetchStatements(): Promise<{
  pnl: StatementResponse | null;
  balanceSheet: StatementResponse | null;
  error: string | null;
}> {
  if (!LEDGER_ID) {
    return { pnl: null, balanceSheet: null, error: "KOUNTA_LEDGER_ID not set" };
  }

  try {
    const now = new Date();
    const startOfYear = `${now.getFullYear()}-01-01`;
    const today = now.toISOString().slice(0, 10);

    const [pnl, balanceSheet] = await Promise.all([
      kounta.reports.incomeStatement(LEDGER_ID, startOfYear, today),
      kounta.reports.balanceSheet(LEDGER_ID, today),
    ]);

    return { pnl, balanceSheet, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch statements";
    return { pnl: null, balanceSheet: null, error: message };
  }
}

async function fetchTransactions() {
  if (!LEDGER_ID) return [];

  try {
    const result = await kounta.transactions.list(LEDGER_ID, { limit: 10 });
    return result.data;
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const [{ pnl, balanceSheet, error }, transactions] = await Promise.all([
    fetchStatements(),
    fetchTransactions(),
  ]);

  if (error) {
    return (
      <div className="card text-center py-16">
        <h2 className="text-xl font-bold text-slate-50 mb-3">Setup Required</h2>
        <p className="text-sm mb-6" style={{ color: "#94a3b8" }}>
          {error}. Follow the README to configure your Kounta connection.
        </p>
        <div
          className="inline-block rounded-xl p-5 text-left font-mono text-sm"
          style={{ background: "#0a0f1a", color: "#5eead4" }}
        >
          <p>1. Start Kounta API: <span style={{ color: "#94a3b8" }}>pnpm dev</span> (from repo root)</p>
          <p>2. Copy <span style={{ color: "#94a3b8" }}>.env.example</span> to <span style={{ color: "#94a3b8" }}>.env.local</span></p>
          <p>3. Run seed: <span style={{ color: "#94a3b8" }}>pnpm seed</span></p>
          <p>4. Paste the output values into <span style={{ color: "#94a3b8" }}>.env.local</span></p>
        </div>
      </div>
    );
  }

  // Extract key metrics from statements
  const revenue = pnl?.totals?.["totalRevenue"] ?? 0;
  const netIncome = pnl?.totals?.["netIncome"] ?? 0;
  const totalAssets = balanceSheet?.totals?.["totalAssets"] ?? 0;
  const cash = balanceSheet?.sections
    ?.find((s) => s.name === "Assets")
    ?.lines?.find((l) => l.accountCode === "1000")?.currentPeriod ?? 0;

  return (
    <div className="space-y-8">
      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Revenue (YTD)" value={formatCurrency(revenue)} positive />
        <MetricCard label="Net Income" value={formatCurrency(netIncome)} positive={netIncome >= 0} />
        <MetricCard label="Cash" value={formatCurrency(cash)} />
        <MetricCard label="Total Assets" value={formatCurrency(totalAssets)} />
      </div>

      {/* Simulate Payment button */}
      <SimulatePayment />

      {/* Statements side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {pnl && (
          <StatementTable
            title="Income Statement (P&L)"
            subtitle={`${pnl.period.start} to ${pnl.period.end}`}
            statement={pnl}
          />
        )}
        {balanceSheet && (
          <StatementTable
            title="Balance Sheet"
            subtitle={`As of ${balanceSheet.period.end}`}
            statement={balanceSheet}
          />
        )}
      </div>

      {/* Recent transactions */}
      <RecentTransactions transactions={transactions} />
    </div>
  );
}

function MetricCard({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="stat-card">
      <p className="section-label mb-2">{label}</p>
      <p
        className="text-2xl font-bold font-mono"
        style={{
          color:
            positive === true
              ? "#5eead4"
              : positive === false
                ? "#ef4444"
                : "#f8fafc",
        }}
      >
        {value}
      </p>
    </div>
  );
}

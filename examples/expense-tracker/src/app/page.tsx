import { kounta, ledgerId } from "@/lib/kounta";
import { RecordExpense } from "@/components/record-expense";
import { ImportCSV } from "@/components/import-csv";
import { RecentTransactions } from "@/components/recent-transactions";
import { StatementTable } from "@/components/statement-table";
import { MatchReviewWrapper } from "@/components/match-review-wrapper";
import type { StatementResponse } from "@kounta/sdk";

export const dynamic = "force-dynamic";

async function fetchData(): Promise<{
  accounts: Awaited<ReturnType<typeof kounta.accounts.list>> | null;
  txnResult: Awaited<ReturnType<typeof kounta.transactions.list>> | null;
  pnl: StatementResponse | null;
  balanceSheet: StatementResponse | null;
  error: string | null;
}> {
  if (!ledgerId) {
    return { accounts: null, txnResult: null, pnl: null, balanceSheet: null, error: "KOUNTA_LEDGER_ID not set" };
  }

  try {
    const [accounts, txnResult, pnl, balanceSheet] = await Promise.all([
      kounta.accounts.list(ledgerId),
      kounta.transactions.list(ledgerId, { limit: 20 }),
      kounta.reports.incomeStatement(ledgerId, "2026-01-01", "2026-12-31"),
      kounta.reports.balanceSheet(ledgerId, "2026-12-31"),
    ]);

    return { accounts, txnResult, pnl, balanceSheet, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to connect to Kounta API";
    return { accounts: null, txnResult: null, pnl: null, balanceSheet: null, error: message };
  }
}

export default async function Home() {
  const { accounts, txnResult, pnl, balanceSheet, error } = await fetchData();

  if (error || !accounts || !txnResult || !pnl || !balanceSheet) {
    return (
      <div className="card text-center py-16">
        <h2 className="text-xl font-bold text-slate-50 mb-3">Setup Required</h2>
        <p className="text-sm mb-6" style={{ color: "#94a3b8" }}>
          {error ?? "Could not load data"}. Follow the README to configure your Kounta connection.
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

  const expenseAccounts = accounts.filter((a) => a.type === "expense");
  const totalExpenses = expenseAccounts.reduce((sum, a) => sum + a.balance, 0);
  const cashAccount = accounts.find((a) => a.code === "1000");
  const revenueAccounts = accounts.filter((a) => a.type === "revenue");
  const totalRevenue = revenueAccounts.reduce((sum, a) => sum + a.balance, 0);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="stat-card">
          <p className="section-label">Total Expenses</p>
          <p className="text-2xl font-bold mt-1 font-mono" style={{ color: "#ef4444" }}>
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totalExpenses / 100)}
          </p>
        </div>
        <div className="stat-card">
          <p className="section-label">Total Revenue</p>
          <p className="text-2xl font-bold mt-1 font-mono" style={{ color: "#22c55e" }}>
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totalRevenue / 100)}
          </p>
        </div>
        <div className="stat-card">
          <p className="section-label">Cash Balance</p>
          <p className="text-2xl font-bold mt-1 font-mono" style={{ color: "#5eead4" }}>
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cashAccount?.balance ?? 0) / 100)}
          </p>
        </div>
      </div>

      {/* Actions row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecordExpense />
        <ImportCSV />
      </div>

      {/* Match review (client-side wrapper) */}
      <MatchReviewWrapper />

      {/* Statements */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StatementTable statement={pnl} title="Income Statement" subtitle="2026-01-01 — 2026-12-31" />
        <StatementTable statement={balanceSheet} title="Balance Sheet" subtitle="As of 2026-12-31" />
      </div>

      {/* Recent transactions */}
      <RecentTransactions transactions={txnResult.data} />
    </div>
  );
}

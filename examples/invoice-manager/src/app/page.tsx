import { ledge, ledgerId } from "@/lib/ledge";
import { formatCurrency } from "@/lib/format";
import { StatementTable } from "@/components/statement-table";
import { AccountBalances } from "@/components/account-balances";
import { RecentTransactions } from "@/components/recent-transactions";
import { CreateInvoice } from "@/components/create-invoice";
import { MarkPaid } from "@/components/mark-paid";
import { RecordExpense } from "@/components/record-expense";
import type { StatementResponse } from "@ledge/sdk";

export const dynamic = "force-dynamic";

async function fetchData(): Promise<{
  pnl: StatementResponse | null;
  balanceSheet: StatementResponse | null;
  accounts: Awaited<ReturnType<typeof ledge.accounts.list>> | null;
  txns: Awaited<ReturnType<typeof ledge.transactions.list>> | null;
  error: string | null;
}> {
  if (!ledgerId) {
    return { pnl: null, balanceSheet: null, accounts: null, txns: null, error: "LEDGE_LEDGER_ID not set" };
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const startOfYear = `${today.slice(0, 4)}-01-01`;

    const [pnl, balanceSheet, accounts, txns] = await Promise.all([
      ledge.reports.incomeStatement(ledgerId, startOfYear, today),
      ledge.reports.balanceSheet(ledgerId, today),
      ledge.accounts.list(ledgerId),
      ledge.transactions.list(ledgerId, { limit: 20 }),
    ]);

    return { pnl, balanceSheet, accounts, txns, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to connect to Ledge API";
    return { pnl: null, balanceSheet: null, accounts: null, txns: null, error: message };
  }
}

export default async function Dashboard() {
  const { pnl, balanceSheet, accounts, txns, error } = await fetchData();

  if (error || !pnl || !balanceSheet || !accounts || !txns) {
    return (
      <div className="card text-center py-16">
        <h2 className="text-xl font-bold text-slate-50 mb-3">Setup Required</h2>
        <p className="text-sm mb-6" style={{ color: "#94a3b8" }}>
          {error ?? "Could not load data"}. Follow the README to configure your Ledge connection.
        </p>
        <div
          className="inline-block rounded-xl p-5 text-left font-mono text-sm"
          style={{ background: "#0a0f1a", color: "#5eead4" }}
        >
          <p>1. Start Ledge API: <span style={{ color: "#94a3b8" }}>pnpm dev</span> (from repo root)</p>
          <p>2. Copy <span style={{ color: "#94a3b8" }}>.env.example</span> to <span style={{ color: "#94a3b8" }}>.env.local</span></p>
          <p>3. Run seed: <span style={{ color: "#94a3b8" }}>pnpm seed</span></p>
          <p>4. Paste the output values into <span style={{ color: "#94a3b8" }}>.env.local</span></p>
        </div>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const startOfYear = `${today.slice(0, 4)}-01-01`;

  // KPI cards
  const revenue = pnl.totals.totalRevenue ?? 0;
  const expenses = pnl.totals.totalExpenses ?? 0;
  const netIncome = pnl.totals.netIncome ?? 0;
  const cashAccount = accounts.find((a) => a.code === "1000");
  const arAccount = accounts.find((a) => a.code === "1100");

  return (
    <div className="space-y-8">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KPICard label="Revenue" value={formatCurrency(revenue)} />
        <KPICard label="Expenses" value={formatCurrency(expenses)} />
        <KPICard
          label="Net Income"
          value={formatCurrency(Math.abs(netIncome))}
          positive={netIncome >= 0}
        />
        <KPICard label="Cash" value={formatCurrency(cashAccount?.balance ?? 0)} />
        <KPICard label="Receivables" value={formatCurrency(arAccount?.balance ?? 0)} />
      </div>

      {/* Action Forms */}
      <div>
        <p className="section-label mb-3">Actions</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CreateInvoice />
          <MarkPaid />
          <RecordExpense />
        </div>
      </div>

      {/* Statements */}
      <div>
        <p className="section-label mb-3">Financial Statements</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <StatementTable
            title="Income Statement"
            subtitle={`${startOfYear} — ${today}`}
            statement={pnl}
          />
          <StatementTable
            title="Balance Sheet"
            subtitle={`As of ${today}`}
            statement={balanceSheet}
          />
        </div>
      </div>

      {/* Account Balances */}
      <div>
        <p className="section-label mb-3">Chart of Accounts</p>
        <AccountBalances accounts={accounts} />
      </div>

      {/* Recent Transactions */}
      <div>
        <p className="section-label mb-3">Journal</p>
        <RecentTransactions transactions={txns.data} />
      </div>
    </div>
  );
}

function KPICard({
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
      <p className="text-xs mb-1" style={{ color: "#64748b" }}>
        {label}
      </p>
      <p
        className="text-xl font-bold font-mono"
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

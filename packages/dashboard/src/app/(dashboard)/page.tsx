import { getSessionClient } from "@/lib/ledge";
import { formatCurrency, formatDate, formatNumber, truncateId } from "@/lib/format";
import Link from "next/link";
import type { TransactionWithLines, AccountWithBalance } from "@ledge/sdk";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const { client, ledgerId } = await getSessionClient();

  const [ledger, accountsList, txResult] = await Promise.all([
    client.ledgers.get(ledgerId),
    client.accounts.list(ledgerId),
    client.transactions.list(ledgerId, { limit: 5 }),
  ]);

  const transactionCount = txResult.data.length;
  const accountCount = accountsList.length;
  const totalAssets = accountsList
    .filter((a: AccountWithBalance) => a.type === "asset")
    .reduce((sum: number, a: AccountWithBalance) => sum + a.balance, 0);

  const recentTransactions = txResult.data;

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center gap-3" style={{ marginBottom: 32 }}>
        <h1
          className="font-bold"
          style={{ fontSize: 24, color: "#0A0A0A", fontFamily: "var(--font-family-display)" }}
        >
          {ledger.name}
        </h1>
        <span className="badge badge-blue">{ledger.accountingBasis}</span>
        <span className="text-sm" style={{ color: "rgba(0,0,0,0.36)" }}>
          {ledger.currency}
        </span>
      </div>

      {/* Metric cards */}
      <div
        className="grid grid-cols-4"
        style={{ gap: 20, marginBottom: 36 }}
      >
        <MetricCard label="Accounts" value={formatNumber(accountCount)} />
        <MetricCard
          label="Total Assets"
          value={formatCurrency(totalAssets)}
          mono
        />
        <MetricCard label="Currency" value={ledger.currency} />
        <MetricCard label="Basis" value={ledger.accountingBasis} />
      </div>

      {/* Recent transactions */}
      <div className="card" style={{ padding: 0 }}>
        <div
          className="flex items-center justify-between"
          style={{ padding: "20px 24px" }}
        >
          <span className="section-label">Recent Transactions</span>
          <Link href="/transactions" className="btn-ghost text-xs">
            View all \u2192
          </Link>
        </div>

        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">ID</th>
              <th className="table-header">Date</th>
              <th className="table-header">Description</th>
              <th className="table-header text-right">Amount</th>
              <th className="table-header text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {recentTransactions.map((tx: TransactionWithLines) => {
              const totalDebit = tx.lines
                .filter((l) => l.direction === "debit")
                .reduce((sum, l) => sum + l.amount, 0);
              return (
                <tr key={tx.id} className="table-row">
                  <td className="table-cell font-mono text-xs" style={{ color: "rgba(0,0,0,0.36)" }}>
                    {truncateId(tx.id)}
                  </td>
                  <td className="table-cell text-sm">{formatDate(tx.date)}</td>
                  <td className="table-cell text-sm">{tx.memo}</td>
                  <td className="table-cell text-right font-mono text-sm">
                    {formatCurrency(totalDebit)}
                  </td>
                  <td className="table-cell text-right">
                    <span className={"badge " + (tx.status === "posted" ? "badge-green" : "badge-red")}>
                      {tx.status}
                    </span>
                  </td>
                </tr>
              );
            })}
            {recentTransactions.length === 0 && (
              <tr>
                <td colSpan={5} className="table-cell text-center text-sm" style={{ color: "rgba(0,0,0,0.36)", padding: 48 }}>
                  No transactions yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  mono = false,
  accent = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="card">
      <div className="section-label" style={{ marginBottom: 10 }}>{label}</div>
      <div
        className={"font-bold " + (mono ? "font-mono" : "")}
        style={{
          fontSize: 28,
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
          color: accent ? "#D97706" : "#0A0A0A",
        }}
      >
        {value}
      </div>
    </div>
  );
}

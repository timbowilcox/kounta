import { formatCurrency, formatDate } from "@/lib/format";
import type { TransactionWithLines } from "@kounta/sdk";

export function RecentTransactions({
  transactions,
}: {
  transactions: readonly TransactionWithLines[];
}) {
  if (transactions.length === 0) {
    return (
      <div className="card text-center py-8">
        <p style={{ color: "#64748b" }}>No transactions yet</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="px-6 py-4">
        <h2 className="text-lg font-bold text-slate-50">Recent Transactions</h2>
        <span className="text-xs" style={{ color: "#64748b" }}>
          Last {transactions.length} entries
        </span>
      </div>

      <table className="w-full">
        <thead>
          <tr>
            <th className="table-header">Date</th>
            <th className="table-header">Description</th>
            <th className="table-header">Status</th>
            <th className="table-header text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((txn) => {
            const totalDebit = txn.lines
              .filter((l) => l.direction === "debit")
              .reduce((sum, l) => sum + l.amount, 0);

            return (
              <tr key={txn.id} className="table-row">
                <td className="table-cell text-sm font-mono" style={{ color: "#94a3b8" }}>
                  {formatDate(txn.date)}
                </td>
                <td className="table-cell text-sm text-slate-50">
                  {txn.memo}
                </td>
                <td className="table-cell">
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background:
                        txn.status === "posted"
                          ? "rgba(34,197,94,0.1)"
                          : "rgba(239,68,68,0.1)",
                      color: txn.status === "posted" ? "#22c55e" : "#ef4444",
                      border: `1px solid ${txn.status === "posted" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                    }}
                  >
                    {txn.status}
                  </span>
                </td>
                <td className="table-cell text-right font-mono text-sm text-slate-50">
                  {formatCurrency(totalDebit)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

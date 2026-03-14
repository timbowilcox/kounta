import { formatCurrency } from "@/lib/format";
import type { AccountWithBalance } from "@kounta/sdk";

export function AccountBalances({
  accounts,
}: {
  accounts: readonly AccountWithBalance[];
}) {
  const grouped = new Map<string, AccountWithBalance[]>();
  for (const acct of accounts) {
    const type = acct.type;
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type)!.push(acct);
  }

  const typeOrder = ["asset", "liability", "equity", "revenue", "expense"];
  const typeLabels: Record<string, string> = {
    asset: "Assets",
    liability: "Liabilities",
    equity: "Equity",
    revenue: "Revenue",
    expense: "Expenses",
  };

  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="px-6 py-4">
        <h2 className="text-lg font-bold text-slate-50">Account Balances</h2>
        <span className="text-xs" style={{ color: "#64748b" }}>
          All accounts from the consulting chart
        </span>
      </div>

      <table className="w-full">
        <thead>
          <tr>
            <th className="table-header">Code</th>
            <th className="table-header">Account</th>
            <th className="table-header text-right" style={{ width: 140 }}>
              Balance
            </th>
          </tr>
        </thead>
        <tbody>
          {typeOrder.map((type) => {
            const accts = grouped.get(type);
            if (!accts || accts.length === 0) return null;

            return (
              <AccountGroup
                key={type}
                label={typeLabels[type] ?? type}
                accounts={accts}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AccountGroup({
  label,
  accounts,
}: {
  label: string;
  accounts: AccountWithBalance[];
}) {
  return (
    <>
      <tr>
        <td
          colSpan={3}
          className="px-4 pt-5 pb-2 text-sm font-bold"
          style={{ color: "#5eead4" }}
        >
          {label}
        </td>
      </tr>
      {accounts.map((acct) => (
        <tr key={acct.id} className="table-row">
          <td
            className="table-cell font-mono text-xs"
            style={{ color: "#5eead4", paddingLeft: 32, width: 80 }}
          >
            {acct.code}
          </td>
          <td className="table-cell text-sm" style={{ color: "#94a3b8" }}>
            {acct.name}
          </td>
          <td
            className="table-cell text-right font-mono text-sm"
            style={{
              color: acct.balance === 0 ? "#64748b" : "#f8fafc",
            }}
          >
            {formatCurrency(acct.balance)}
          </td>
        </tr>
      ))}
    </>
  );
}

"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";
import type { AccountWithBalance, AccountType } from "@ledge/sdk";
import { ContextualPrompt } from "@/components/contextual-prompt";

const typeOrder: Record<string, number> = {
  asset: 0, liability: 1, equity: 2, revenue: 3, expense: 4,
};

const typeLabels: Record<string, string> = {
  asset: "Asset", liability: "Liability", equity: "Equity", revenue: "Revenue", expense: "Expense",
};

const typeBadge: Record<string, string> = {
  asset: "badge-blue", liability: "badge-amber", equity: "badge-green", revenue: "badge-green", expense: "badge-red",
};

export function AccountsView({ accounts }: { accounts: AccountWithBalance[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(["asset", "liability", "equity", "revenue", "expense"])
  );

  const grouped = accounts.reduce(
    (acc, account) => {
      const t = account.type as string;
      if (!acc[t]) acc[t] = [];
      acc[t].push(account);
      return acc;
    },
    {} as Record<string, AccountWithBalance[]>
  );

  const sortedTypes = Object.keys(grouped).sort(
    (a, b) => (typeOrder[a] ?? 99) - (typeOrder[b] ?? 99)
  );

  const toggleGroup = (type: string) => {
    const next = new Set(expanded);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setExpanded(next);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <h1
          className="font-bold"
          style={{ fontSize: 24, color: "#0A0A0A", fontFamily: "var(--font-family-display)" }}
        >
          Account Tree
        </h1>
        <ContextualPrompt placeholder="Ask about account balances..." />
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header" style={{ width: 120, position: "sticky", top: 0, backgroundColor: "#F7F7F6", zIndex: 1 }}>Code</th>
              <th className="table-header" style={{ position: "sticky", top: 0, backgroundColor: "#F7F7F6", zIndex: 1 }}>Account Name</th>
              <th className="table-header" style={{ width: 100, position: "sticky", top: 0, backgroundColor: "#F7F7F6", zIndex: 1 }}>Type</th>
              <th className="table-header text-right" style={{ width: 160, position: "sticky", top: 0, backgroundColor: "#F7F7F6", zIndex: 1 }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {sortedTypes.map((type) => {
              const group = grouped[type];
              const isExpanded = expanded.has(type);
              const groupTotal = group.reduce((sum, a) => sum + a.balance, 0);
              return (
                <GroupRows
                  key={type}
                  type={type}
                  accounts={group}
                  isExpanded={isExpanded}
                  groupTotal={groupTotal}
                  onToggle={() => toggleGroup(type)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupRows({
  type,
  accounts,
  isExpanded,
  groupTotal,
  onToggle,
}: {
  type: string;
  accounts: AccountWithBalance[];
  isExpanded: boolean;
  groupTotal: number;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer table-row"
        onClick={onToggle}
        style={{ backgroundColor: "rgba(0,0,0,0.02)" }}
      >
        <td className="table-cell" colSpan={2}>
          <div className="flex items-center gap-2.5">
            <svg
              width="14" height="14" viewBox="0 0 14 14"
              fill="none" stroke="rgba(0,0,0,0.36)" strokeWidth="1.5"
              style={{
                transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 200ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              <path d="M5 3l4 4-4 4" />
            </svg>
            <span className="text-sm font-semibold">
              {(typeLabels[type] ?? type).replace(/y$/,"ie")+"s"}
            </span>
            <span className="text-xs" style={{ color: "rgba(0,0,0,0.28)" }}>
              ({accounts.length})
            </span>
          </div>
        </td>
        <td className="table-cell">
          <span className={"badge " + (typeBadge[type] ?? "badge-blue")}>{typeLabels[type] ?? type}</span>
        </td>
        <td
          className="table-cell text-right font-mono text-sm font-medium"
          style={{ color: groupTotal < 0 ? "#EF4444" : "#0A0A0A", fontVariantNumeric: "tabular-nums" }}
        >
          {formatCurrency(Math.abs(groupTotal))}
        </td>
      </tr>

      {isExpanded &&
        accounts.map((account) => (
          <tr key={account.id} className="table-row">
            <td className="table-cell" style={{ paddingLeft: 44 }}>
              <code className="text-xs font-mono" style={{ color: "#3B82F6" }}>
                {account.code}
              </code>
            </td>
            <td className="table-cell text-sm">{account.name}</td>
            <td className="table-cell">
              <span className={"badge " + (typeBadge[type] ?? "badge-blue")}>{typeLabels[type] ?? type}</span>
            </td>
            <td
              className="table-cell text-right font-mono text-sm"
              style={{ color: account.balance < 0 ? "#EF4444" : "#0A0A0A", fontVariantNumeric: "tabular-nums" }}
            >
              {formatCurrency(Math.abs(account.balance))}
            </td>
          </tr>
        ))}
    </>
  );
}

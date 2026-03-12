"use client";

import { useState, useTransition } from "react";
import { formatCurrency, formatDate, truncateId } from "@/lib/format";
import { fetchTransactions } from "@/lib/actions";
import type { TransactionWithLines, PaginatedResult, AccountWithBalance } from "@ledge/sdk";

interface Props {
  initialData: PaginatedResult<TransactionWithLines>;
  accountMap: Record<string, { code: string; name: string }>;
}

type StatusFilter = "all" | "posted" | "reversed";

export function TransactionsView({ initialData, accountMap }: Props) {
  const [data, setData] = useState(initialData);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [cursors, setCursors] = useState<string[]>([]);

  const filtered = data.data.filter((tx) => {
    if (filter !== "all" && tx.status !== filter) return false;
    if (search && !tx.memo.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const loadNext = () => {
    if (!data.nextCursor) return;
    startTransition(async () => {
      const result = await fetchTransactions(data.nextCursor ?? undefined, 50);
      setCursors([...cursors, ""]);
      setData(result);
    });
  };

  const txAmount = (tx: TransactionWithLines) =>
    tx.lines.filter((l) => l.direction === "debit").reduce((sum, l) => sum + l.amount, 0);

  return (
    <div>
      <h1
        className="font-bold"
        style={{ fontSize: 24, color: "#0A0A0A", marginBottom: 28, fontFamily: "var(--font-family-display)" }}
      >
        Transactions
      </h1>

      {/* Search and filters */}
      <div className="flex items-center" style={{ gap: 16, marginBottom: 24 }}>
        <input
          type="text"
          className="input"
          style={{ maxWidth: 340 }}
          placeholder="Search transactions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex" style={{ gap: 6 }}>
          {(["all", "posted", "reversed"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className="capitalize"
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 500,
                backgroundColor: filter === s ? "rgba(59,130,246,0.1)" : "transparent",
                color: filter === s ? "#3B82F6" : "rgba(0,0,0,0.36)",
                border: filter === s ? "1px solid rgba(59,130,246,0.3)" : "1px solid transparent",
                cursor: "pointer",
                transition: "all 200ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header" style={{ width: 100 }}>ID</th>
              <th className="table-header" style={{ width: 120 }}>Date</th>
              <th className="table-header">Description</th>
              <th className="table-header text-right" style={{ width: 140 }}>Amount</th>
              <th className="table-header text-right" style={{ width: 100 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                amount={txAmount(tx)}
                accountMap={accountMap}
                isExpanded={expandedId === tx.id}
                onToggle={() => setExpandedId(expandedId === tx.id ? null : tx.id)}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="table-cell text-center text-sm" style={{ color: "rgba(0,0,0,0.36)", padding: 48 }}>
                  No transactions found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data.nextCursor && (
        <div className="flex justify-end" style={{ marginTop: 20 }}>
          <button
            className="btn-secondary text-xs"
            style={{ padding: "8px 16px" }}
            onClick={loadNext}
            disabled={isPending}
          >
            {isPending ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}

function TransactionRow({
  tx,
  amount,
  accountMap,
  isExpanded,
  onToggle,
}: {
  tx: TransactionWithLines;
  amount: number;
  accountMap: Record<string, { code: string; name: string }>;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="table-row cursor-pointer" onClick={onToggle}>
        <td className="table-cell font-mono text-xs" style={{ color: "rgba(0,0,0,0.36)" }}>
          {truncateId(tx.id)}
        </td>
        <td className="table-cell text-sm">{formatDate(tx.date)}</td>
        <td className="table-cell text-sm">{tx.memo}</td>
        <td className="table-cell text-right font-mono text-sm">
          {formatCurrency(amount)}
        </td>
        <td className="table-cell text-right">
          <span className={"badge " + (tx.status === "posted" ? "badge-green" : "badge-red")}>
            {tx.status}
          </span>
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={5} style={{ padding: 0 }}>
            <div
              style={{
                margin: "0 16px 12px",
                borderRadius: 14,
                backgroundColor: "#F7F7F6",
                border: "1px solid rgba(0,0,0,0.06)",
              }}
            >
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header text-xs" style={{ paddingTop: 12, paddingBottom: 12 }}>Account</th>
                    <th className="table-header text-xs text-right" style={{ paddingTop: 12, paddingBottom: 12, width: 120 }}>Debit</th>
                    <th className="table-header text-xs text-right" style={{ paddingTop: 12, paddingBottom: 12, width: 120 }}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {tx.lines.map((line, i) => {
                    const acct = accountMap[line.accountId];
                    return (
                      <tr key={i}>
                        <td className="table-cell text-sm" style={{ paddingTop: 10, paddingBottom: 10 }}>
                          {acct && (
                            <code className="font-mono text-xs" style={{ color: "#3B82F6", marginRight: 8 }}>
                              {acct.code}
                            </code>
                          )}
                          <span >{acct?.name ?? line.accountId}</span>
                        </td>
                        <td className="table-cell text-right font-mono text-sm" style={{ paddingTop: 10, paddingBottom: 10 }}>
                          {line.direction === "debit" ? formatCurrency(line.amount) : ""}
                        </td>
                        <td className="table-cell text-right font-mono text-sm" style={{ paddingTop: 10, paddingBottom: 10 }}>
                          {line.direction === "credit" ? formatCurrency(line.amount) : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

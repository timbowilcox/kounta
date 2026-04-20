"use client";

import type { BankConnection } from "@kounta/sdk";
import { useState, useTransition } from "react";
import { fetchBankTransactions, markBankTransactionPersonal } from "@/lib/actions";
import type { BankTransactionSummary } from "@/lib/actions";

interface BankFeedsViewProps {
  connections: unknown[];
  error: string | null;
  initialBankTxns: BankTransactionSummary[];
}

const statusBadge: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "badge-green" },
  stale: { label: "Stale", className: "badge-amber" },
  disconnected: { label: "Disconnected", className: "badge-red" },
  error: { label: "Error", className: "badge-red" },
};

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BankFeedsView({ connections, error, initialBankTxns }: BankFeedsViewProps) {
  const typed = connections as BankConnection[];

  if (error === "upgrade") {
    return (
      <div>
        <PageHeader />
        <div
          className="card"
          style={{
            padding: 40,
            textAlign: "center",
          }}
        >
          <div style={{ margin: "0 auto 16px" }}>
            <svg width="28" height="28" viewBox="0 0 20 20" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4h14" />
              <path d="M4 4v12" />
              <path d="M16 4v12" />
              <path d="M3 16h14" />
              <path d="M3 8h14" />
              <path d="M7 8v8" />
              <path d="M13 8v8" />
            </svg>
          </div>
          <h2
            className="font-bold"
            style={{ fontSize: 18, color: "var(--text-primary)", marginBottom: 8, fontFamily: "var(--font-family-display)" }}
          >
            Upgrade to Enable Bank Feeds
          </h2>
          <p className="text-sm" style={{ color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: 420, margin: "0 auto" }}>
            Bank feed connections require a Builder plan or higher. Upgrade your plan
            to connect your bank accounts and automatically sync transactions.
          </p>
        </div>
      </div>
    );
  }

  if (error === "not-configured") {
    return (
      <div>
        <PageHeader />
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ margin: "0 auto 16px" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2
            className="font-bold"
            style={{ fontSize: 18, color: "var(--text-primary)", marginBottom: 8, fontFamily: "var(--font-family-display)" }}
          >
            Bank Feed Provider Not Configured
          </h2>
          <p className="text-sm" style={{ color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: 420, margin: "0 auto" }}>
            The bank feed provider (Basiq) is not configured on this instance. Set the
            BASIQ_API_KEY environment variable to enable bank feed connections.
          </p>
        </div>
      </div>
    );
  }

  if (typed.length === 0) {
    return (
      <div>
        <PageHeader />
        <EmptyState />
      </div>
    );
  }

  return (
    <div>
      <PageHeader />

      {/* Connections table */}
      <div className="card" style={{ padding: 0 }}>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Institution</th>
              <th className="table-header" style={{ width: 120 }}>Provider</th>
              <th className="table-header" style={{ width: 120 }}>Status</th>
              <th className="table-header" style={{ width: 180 }}>Last Sync</th>
              <th className="table-header" style={{ width: 180 }}>Connected</th>
            </tr>
          </thead>
          <tbody>
            {typed.map((conn) => {
              const badge = statusBadge[conn.status] ?? { label: conn.status, className: "" };
              return (
                <tr key={conn.id} className="table-row">
                  <td className="table-cell">
                    <div className="font-medium text-sm" style={{ color: "var(--text-primary)" }}>
                      {conn.institutionName || "Unknown Institution"}
                    </div>
                    <div className="text-xs font-mono" style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
                      {conn.id.slice(0, 8)}…
                    </div>
                  </td>
                  <td className="table-cell">
                    <span className="text-xs font-medium" style={{ color: "var(--text-secondary)", textTransform: "capitalize" }}>
                      {conn.provider}
                    </span>
                  </td>
                  <td className="table-cell">
                    <span className={badge.className}>{badge.label}</span>
                  </td>
                  <td className="table-cell">
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {formatDate(conn.lastSyncAt)}
                    </span>
                  </td>
                  <td className="table-cell">
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {formatDate(conn.createdAt)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bank Transactions */}
      <BankTransactionsSection initialTxns={initialBankTxns} />

      {/* API guide */}
      <div style={{ marginTop: 32 }}>
        <ApiGuide />
      </div>
    </div>
  );
}

function PageHeader() {
  return (
    <>
      <h1
        className="font-bold"
        style={{ fontSize: 24, color: "var(--text-primary)", marginBottom: 8, fontFamily: "var(--font-family-display)" }}
      >
        Bank Feeds
      </h1>
      <p className="text-sm" style={{ color: "var(--text-secondary)", marginBottom: 32, lineHeight: 1.6 }}>
        Connect bank accounts to automatically sync transactions and match them
        against your ledger entries. Manage connections via the API or MCP tools.
      </p>
    </>
  );
}

function EmptyState() {
  return (
    <>
      <div className="card" style={{ padding: 40, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ marginBottom: 16 }}>
          {/* Lucide Landmark icon */}
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="22" x2="21" y2="22" />
            <line x1="6" y1="18" x2="6" y2="11" />
            <line x1="10" y1="18" x2="10" y2="11" />
            <line x1="14" y1="18" x2="14" y2="11" />
            <line x1="18" y1="18" x2="18" y2="11" />
            <polygon points="12 2 20 7 4 7" />
            <line x1="2" y1="22" x2="22" y2="22" />
            <rect x="2" y="18" width="20" height="4" rx="0" />
          </svg>
        </div>
        <h2
          className="font-bold"
          style={{ fontSize: 18, color: "var(--text-primary)", marginBottom: 8, fontFamily: "var(--font-family-display)" }}
        >
          No Bank Connections
        </h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: 420, margin: "0 auto 20px" }}>
          Connect a bank account to start syncing transactions automatically.
          Use the REST API or MCP tools to create your first connection.
        </p>
        <a
          href="#api-endpoints"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-primary)",
            backgroundColor: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            textDecoration: "none",
            cursor: "pointer",
            transition: "all 150ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--border-strong)";
            e.currentTarget.style.backgroundColor = "var(--surface-1)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          Connect your first bank
          <span style={{ transition: "transform 150ms ease" }}>&rarr;</span>
        </a>
      </div>

      <div id="api-endpoints" style={{ marginTop: 32 }}>
        <ApiGuide />
      </div>
    </>
  );
}

function ApiGuide() {
  return (
    <div>
      <div className="section-label" style={{ marginBottom: 16 }}>How It Works</div>
      <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 12 }}>
        {steps.map((step, i) => (
          <div key={i} className="card" style={{ padding: 20 }}>
            <div className="flex items-center" style={{ gap: 12, marginBottom: 12 }}>
              <span className="font-mono" style={{ fontSize: 12, color: "var(--text-tertiary)", fontWeight: 500, whiteSpace: "nowrap" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {step.title}
              </span>
            </div>
            <p className="text-xs" style={{ color: "var(--text-tertiary)", lineHeight: 1.6 }}>
              {step.description}
            </p>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24 }}>
        <div className="section-label" style={{ marginBottom: 16 }}>API Endpoints</div>
        <div className="card" style={{ padding: 0 }}>
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header" style={{ width: 100 }}>Method</th>
                <th className="table-header">Endpoint</th>
                <th className="table-header">Description</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((ep, i) => (
                <tr key={i} className="table-row">
                  <td className="table-cell">
                    <code className="method-badge" style={{ color: methodColor(ep.method) }}>
                      {ep.method}
                    </code>
                  </td>
                  <td className="table-cell">
                    <code className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
                      {ep.path}
                    </code>
                  </td>
                  <td className="table-cell">
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {ep.description}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

type BankTxnFilter = "business" | "personal" | "all";

function BankTransactionsSection({ initialTxns }: { initialTxns: BankTransactionSummary[] }) {
  const [txns, setTxns] = useState<BankTransactionSummary[]>(initialTxns);
  const [filter, setFilter] = useState<BankTxnFilter>("business");
  const [isPending, startTransition] = useTransition();

  const handleFilterChange = (f: BankTxnFilter) => {
    setFilter(f);
    startTransition(async () => {
      try {
        const result = await fetchBankTransactions(f);
        setTxns(result);
      } catch (e) {
        console.error("[bank-feeds] filter change failed:", e);
      }
    });
  };

  const handleMarkPersonal = (txnId: string) => {
    startTransition(async () => {
      try {
        const ok = await markBankTransactionPersonal(txnId);
        if (ok) {
          setTxns((prev) => prev.filter((t) => t.id !== txnId));
        }
      } catch (e) {
        console.error("[bank-feeds] mark personal failed:", e);
      }
    });
  };

  if (txns.length === 0 && filter === "business") {
    return null; // Don't show empty business section
  }

  return (
    <div style={{ marginTop: 32 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <div className="section-label">Bank Transactions</div>
        <div className="flex" style={{ gap: 4 }}>
          {(["business", "personal", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => handleFilterChange(f)}
              className="capitalize"
              style={{
                padding: "0 12px",
                height: 28,
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                backgroundColor: filter === f ? "var(--surface-3)" : "transparent",
                color: filter === f ? "var(--accent)" : "var(--text-tertiary)",
                border: filter === f ? "1px solid var(--border-strong)" : "1px solid transparent",
                cursor: "pointer",
                transition: "all 150ms ease",
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 0, opacity: isPending ? 0.6 : 1, transition: "opacity 150ms" }}>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header" style={{ width: 100 }}>Date</th>
              <th className="table-header">Description</th>
              <th className="table-header text-right" style={{ width: 120 }}>Amount</th>
              <th className="table-header text-right" style={{ width: 100 }}>Status</th>
              <th className="table-header text-right" style={{ width: 100 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {txns.map((txn) => {
              const isPersonal = txn.isPersonal;
              return (
                <tr key={txn.id} className="table-row">
                  <td
                    className="table-cell font-mono"
                    style={{ fontSize: 13, color: isPersonal ? "var(--text-tertiary)" : "var(--text-secondary)" }}
                  >
                    {formatDate(txn.date)}
                  </td>
                  <td className="table-cell" style={{ fontSize: 13, color: isPersonal ? "var(--text-tertiary)" : "var(--text-primary)", fontWeight: 500 }}>
                    <span>{txn.description}</span>
                    {isPersonal && (
                      <span
                        style={{
                          display: "inline-block",
                          marginLeft: 8,
                          padding: "1px 6px",
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 600,
                          backgroundColor: "rgba(220,38,38,0.08)",
                          color: "var(--negative)",
                        }}
                      >
                        Personal
                      </span>
                    )}
                  </td>
                  <td
                    className="table-cell text-right font-mono"
                    style={{ fontSize: 13, color: isPersonal ? "var(--text-tertiary)" : undefined }}
                  >
                    {formatBankAmount(txn.amount)}
                  </td>
                  <td className="table-cell text-right">
                    <span className={bankStatusBadge(txn.status)}>
                      {txn.status}
                    </span>
                  </td>
                  <td className="table-cell text-right">
                    {!isPersonal && txn.status === "pending" && (
                      <button
                        onClick={() => handleMarkPersonal(txn.id)}
                        disabled={isPending}
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 4,
                          border: "1px solid var(--border)",
                          backgroundColor: "var(--surface-1)",
                          color: "var(--text-secondary)",
                          cursor: "pointer",
                        }}
                      >
                        Mark personal
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {txns.length === 0 && (
              <tr>
                <td colSpan={5} className="table-cell text-center" style={{ padding: 32, color: "var(--text-tertiary)", fontSize: 13 }}>
                  No {filter === "all" ? "" : filter} bank transactions found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatBankAmount(cents: number): string {
  const abs = Math.abs(cents);
  const formatted = `$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return cents < 0 ? `-${formatted}` : formatted;
}

function bankStatusBadge(status: string): string {
  switch (status) {
    case "posted": return "badge badge-green";
    case "matched": return "badge badge-green";
    case "pending": return "badge badge-amber";
    case "ignored": return "badge badge-red";
    default: return "badge";
  }
}

function methodColor(method: string): string {
  switch (method) {
    case "GET": return "var(--text-secondary)";
    case "POST": return "#22c55e";
    case "DELETE": return "#ef4444";
    case "PATCH": return "#f59e0b";
    default: return "var(--text-secondary)";
  }
}

const steps = [
  {
    title: "Connect",
    description: "Create a connection session via the API. The user authorizes access through the bank's consent flow.",
  },
  {
    title: "Sync",
    description: "Trigger a sync to pull transactions from the bank. Kounta automatically matches them against existing entries.",
  },
  {
    title: "Confirm",
    description: "Review suggested matches and confirm or ignore them. Confirmed transactions are posted to the ledger.",
  },
];

const endpoints = [
  { method: "POST", path: "/bank-feeds/connect", description: "Create a bank connection session" },
  { method: "GET", path: "/bank-feeds/connections", description: "List all bank connections" },
  { method: "GET", path: "/bank-feeds/connections/:id", description: "Get connection details" },
  { method: "DELETE", path: "/bank-feeds/connections/:id", description: "Disconnect a bank" },
  { method: "GET", path: "/bank-feeds/connections/:id/accounts", description: "List bank accounts" },
  { method: "POST", path: "/bank-feeds/accounts/:id/map", description: "Map bank account to ledger account" },
  { method: "POST", path: "/bank-feeds/accounts/:id/sync", description: "Trigger transaction sync" },
  { method: "GET", path: "/bank-feeds/sync-log", description: "View sync history" },
  { method: "GET", path: "/bank-feeds/transactions", description: "List bank transactions" },
  { method: "POST", path: "/bank-feeds/transactions/:id/confirm", description: "Confirm or ignore a match" },
];

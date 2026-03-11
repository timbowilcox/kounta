// Script to write all dashboard files for the live API wiring.
// Run with: node scripts/write-dashboard-files.js
const fs = require("fs");
const path = require("path");

const DASH = "packages/dashboard/src";

function writeFile(relPath, content) {
  const full = path.resolve(relPath);
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Remove existing file first to avoid EEXIST on OneDrive
  if (fs.existsSync(full)) fs.unlinkSync(full);
  fs.writeFileSync(full, content, "utf-8");
  const lines = content.split("\n").length;
  console.log(`  ✓ ${relPath} (${lines} lines)`);
}

// ─── 1. Server Actions ───────────────────────────────────────────────────────

writeFile(`${DASH}/lib/actions.ts`, `"use server";

// ---------------------------------------------------------------------------
// Server actions for dashboard data fetching and mutations.
// These run on the server and are called from client components.
// ---------------------------------------------------------------------------

import { getLedgeClient, getLedgerId } from "./ledge";
import type {
  TransactionWithLines,
  AccountWithBalance,
  StatementResponse,
  PaginatedResult,
} from "@ledge/sdk";
import type { ApiKeySafe, ApiKeyWithRaw } from "@ledge/sdk";

// --- Transactions (paginated) -----------------------------------------------

export async function fetchTransactions(
  cursor?: string,
  limit = 50,
): Promise<PaginatedResult<TransactionWithLines>> {
  const client = getLedgeClient();
  const ledgerId = getLedgerId();
  return client.transactions.list(ledgerId, { cursor, limit });
}

// --- Accounts ---------------------------------------------------------------

export async function fetchAccounts(): Promise<AccountWithBalance[]> {
  const client = getLedgeClient();
  const ledgerId = getLedgerId();
  return client.accounts.list(ledgerId);
}

// --- Statements -------------------------------------------------------------

export async function fetchIncomeStatement(
  startDate: string,
  endDate: string,
): Promise<StatementResponse> {
  const client = getLedgeClient();
  const ledgerId = getLedgerId();
  return client.reports.incomeStatement(ledgerId, startDate, endDate);
}

export async function fetchBalanceSheet(
  asOfDate: string,
): Promise<StatementResponse> {
  const client = getLedgeClient();
  const ledgerId = getLedgerId();
  return client.reports.balanceSheet(ledgerId, asOfDate);
}

export async function fetchCashFlow(
  startDate: string,
  endDate: string,
): Promise<StatementResponse> {
  const client = getLedgeClient();
  const ledgerId = getLedgerId();
  return client.reports.cashFlow(ledgerId, startDate, endDate);
}

// --- API Keys (admin) -------------------------------------------------------

export async function fetchApiKeys(): Promise<ApiKeySafe[]> {
  const client = getLedgeClient();
  const ledgerId = getLedgerId();
  return client.apiKeys.list(ledgerId);
}

export async function createApiKey(name: string): Promise<ApiKeyWithRaw> {
  const client = getLedgeClient();
  const ledgerId = getLedgerId();
  // Use a system user ID for dashboard-created keys
  return client.apiKeys.create({
    userId: "00000000-0000-0000-0000-000000000001",
    ledgerId,
    name,
  });
}

export async function revokeApiKey(keyId: string): Promise<ApiKeySafe> {
  const client = getLedgeClient();
  return client.apiKeys.revoke(keyId);
}
`);

// ─── 2. Overview Page (server component) ─────────────────────────────────────

writeFile(`${DASH}/app/(dashboard)/page.tsx`, `import { getLedgeClient, getLedgerId } from "@/lib/ledge";
import { formatCurrency, formatDate, formatNumber, truncateId } from "@/lib/format";
import Link from "next/link";
import type { TransactionWithLines, AccountWithBalance } from "@ledge/sdk";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const client = getLedgeClient();
  const ledgerId = getLedgerId();

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
          style={{ fontSize: 24, color: "#f1f5f9", fontFamily: "var(--font-family-display)" }}
        >
          {ledger.name}
        </h1>
        <span className="badge badge-teal">{ledger.accountingBasis}</span>
        <span className="text-sm" style={{ color: "#64748b" }}>
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
            View all \\u2192
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
                  <td className="table-cell font-mono text-xs" style={{ color: "#64748b" }}>
                    {truncateId(tx.id)}
                  </td>
                  <td className="table-cell text-sm">{formatDate(tx.date)}</td>
                  <td className="table-cell text-sm text-slate-50">{tx.memo}</td>
                  <td className="table-cell text-right font-mono text-sm text-slate-50">
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
                <td colSpan={5} className="table-cell text-center text-sm" style={{ color: "#64748b", padding: 48 }}>
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
          color: accent ? "#f59e0b" : "#f8fafc",
        }}
      >
        {value}
      </div>
    </div>
  );
}
`);

// ─── 3. Accounts ─────────────────────────────────────────────────────────────

writeFile(`${DASH}/app/(dashboard)/accounts/accounts-view.tsx`, `"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";
import type { AccountWithBalance, AccountType } from "@ledge/sdk";

const typeOrder: Record<string, number> = {
  asset: 0, liability: 1, equity: 2, revenue: 3, expense: 4,
};

const typeLabels: Record<string, string> = {
  asset: "Asset", liability: "Liability", equity: "Equity", revenue: "Revenue", expense: "Expense",
};

const typeBadge: Record<string, string> = {
  asset: "badge-teal", liability: "badge-amber", equity: "badge-green", revenue: "badge-green", expense: "badge-red",
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
      <h1
        className="font-bold"
        style={{ fontSize: 24, color: "#f1f5f9", marginBottom: 28, fontFamily: "var(--font-family-display)" }}
      >
        Account Tree
      </h1>

      <div className="card" style={{ padding: 0 }}>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header" style={{ width: 120 }}>Code</th>
              <th className="table-header">Account Name</th>
              <th className="table-header" style={{ width: 100 }}>Type</th>
              <th className="table-header text-right" style={{ width: 160 }}>Balance</th>
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
        style={{ backgroundColor: "rgba(255,255,255,0.01)" }}
      >
        <td className="table-cell" colSpan={2}>
          <div className="flex items-center gap-2.5">
            <svg
              width="14" height="14" viewBox="0 0 14 14"
              fill="none" stroke="#64748b" strokeWidth="1.5"
              style={{
                transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 200ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              <path d="M5 3l4 4-4 4" />
            </svg>
            <span className="text-sm font-semibold text-slate-50">
              {typeLabels[type] ?? type}s
            </span>
            <span className="text-xs" style={{ color: "#475569" }}>
              ({accounts.length})
            </span>
          </div>
        </td>
        <td className="table-cell">
          <span className={"badge " + (typeBadge[type] ?? "badge-teal")}>{typeLabels[type] ?? type}</span>
        </td>
        <td
          className="table-cell text-right font-mono text-sm font-medium"
          style={{ color: groupTotal < 0 ? "#ef4444" : "#f8fafc" }}
        >
          {formatCurrency(Math.abs(groupTotal))}
        </td>
      </tr>

      {isExpanded &&
        accounts.map((account) => (
          <tr key={account.id} className="table-row">
            <td className="table-cell" style={{ paddingLeft: 44 }}>
              <code className="text-xs font-mono" style={{ color: "#5eead4" }}>
                {account.code}
              </code>
            </td>
            <td className="table-cell text-sm text-slate-50">{account.name}</td>
            <td className="table-cell">
              <span className={"badge " + (typeBadge[type] ?? "badge-teal")}>{typeLabels[type] ?? type}</span>
            </td>
            <td
              className="table-cell text-right font-mono text-sm"
              style={{ color: account.balance < 0 ? "#ef4444" : "#f8fafc" }}
            >
              {formatCurrency(Math.abs(account.balance))}
            </td>
          </tr>
        ))}
    </>
  );
}
`);

writeFile(`${DASH}/app/(dashboard)/accounts/page.tsx`, `import { getLedgeClient, getLedgerId } from "@/lib/ledge";
import { AccountsView } from "./accounts-view";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const client = getLedgeClient();
  const ledgerId = getLedgerId();
  const accounts = await client.accounts.list(ledgerId);

  return <AccountsView accounts={accounts} />;
}
`);

// ─── 4. Transactions ─────────────────────────────────────────────────────────

writeFile(`${DASH}/app/(dashboard)/transactions/transactions-view.tsx`, `"use client";

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
        style={{ fontSize: 24, color: "#f1f5f9", marginBottom: 28, fontFamily: "var(--font-family-display)" }}
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
                backgroundColor: filter === s ? "rgba(13,148,136,0.1)" : "transparent",
                color: filter === s ? "#5eead4" : "#64748b",
                border: filter === s ? "1px solid rgba(13,148,136,0.2)" : "1px solid transparent",
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
                <td colSpan={5} className="table-cell text-center text-sm" style={{ color: "#64748b", padding: 48 }}>
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
        <td className="table-cell font-mono text-xs" style={{ color: "#64748b" }}>
          {truncateId(tx.id)}
        </td>
        <td className="table-cell text-sm">{formatDate(tx.date)}</td>
        <td className="table-cell text-sm text-slate-50">{tx.memo}</td>
        <td className="table-cell text-right font-mono text-sm text-slate-50">
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
                backgroundColor: "rgba(255,255,255,0.015)",
                border: "1px solid rgba(255,255,255,0.03)",
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
                            <code className="font-mono text-xs" style={{ color: "#5eead4", marginRight: 8 }}>
                              {acct.code}
                            </code>
                          )}
                          <span className="text-slate-50">{acct?.name ?? line.accountId}</span>
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
`);

writeFile(`${DASH}/app/(dashboard)/transactions/page.tsx`, `import { getLedgeClient, getLedgerId } from "@/lib/ledge";
import { TransactionsView } from "./transactions-view";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const client = getLedgeClient();
  const ledgerId = getLedgerId();

  const [txResult, accounts] = await Promise.all([
    client.transactions.list(ledgerId, { limit: 50 }),
    client.accounts.list(ledgerId),
  ]);

  // Build accountId -> { code, name } lookup for line item display
  const accountMap: Record<string, { code: string; name: string }> = {};
  for (const a of accounts) {
    accountMap[a.id] = { code: a.code, name: a.name };
  }

  return <TransactionsView initialData={txResult} accountMap={accountMap} />;
}
`);

// ─── 5. Statements ──────────────────────────────────────────────────────────

writeFile(`${DASH}/app/(dashboard)/statements/statements-view.tsx`, `"use client";

import { useState, useTransition } from "react";
import { formatCurrency } from "@/lib/format";
import {
  fetchIncomeStatement,
  fetchBalanceSheet,
  fetchCashFlow,
} from "@/lib/actions";
import type { StatementResponse } from "@ledge/sdk";

type Tab = "pnl" | "balance_sheet" | "cash_flow";

const tabs: { key: Tab; label: string }[] = [
  { key: "pnl", label: "Income Statement" },
  { key: "balance_sheet", label: "Balance Sheet" },
  { key: "cash_flow", label: "Cash Flow" },
];

interface Props {
  initialPnl: StatementResponse;
  initialBalanceSheet: StatementResponse;
  initialCashFlow: StatementResponse;
  defaultStart: string;
  defaultEnd: string;
}

export function StatementsView({
  initialPnl,
  initialBalanceSheet,
  initialCashFlow,
  defaultStart,
  defaultEnd,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("pnl");
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [statements, setStatements] = useState<Record<Tab, StatementResponse>>({
    pnl: initialPnl,
    balance_sheet: initialBalanceSheet,
    cash_flow: initialCashFlow,
  });
  const [isPending, startTransition] = useTransition();

  const statement = statements[activeTab];

  const refresh = () => {
    startTransition(async () => {
      const [pnl, bs, cf] = await Promise.all([
        fetchIncomeStatement(startDate, endDate),
        fetchBalanceSheet(endDate),
        fetchCashFlow(startDate, endDate),
      ]);
      setStatements({ pnl, balance_sheet: bs, cash_flow: cf });
    });
  };

  return (
    <div>
      <h1
        className="font-bold"
        style={{ fontSize: 24, color: "#f1f5f9", marginBottom: 28, fontFamily: "var(--font-family-display)" }}
      >
        Statements
      </h1>

      {/* Tab selector */}
      <div className="flex items-center" style={{ gap: 6, marginBottom: 24 }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              backgroundColor: activeTab === tab.key ? "rgba(13,148,136,0.1)" : "transparent",
              color: activeTab === tab.key ? "#5eead4" : "#64748b",
              border: activeTab === tab.key ? "1px solid rgba(13,148,136,0.2)" : "1px solid transparent",
              cursor: "pointer",
              transition: "all 200ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Date range */}
      <div className="flex items-center" style={{ gap: 16, marginBottom: 24 }}>
        <div>
          <label className="section-label block" style={{ marginBottom: 8 }}>Start</label>
          <input
            type="date"
            className="input text-sm"
            style={{ width: 170 }}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label className="section-label block" style={{ marginBottom: 8 }}>End</label>
          <input
            type="date"
            className="input text-sm"
            style={{ width: 170 }}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div style={{ alignSelf: "flex-end" }}>
          <button className="btn-primary text-sm" onClick={refresh} disabled={isPending}>
            {isPending ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Plain-language summary */}
      <div
        style={{
          borderRadius: 18,
          padding: 24,
          marginBottom: 24,
          backgroundColor: "rgba(13,148,136,0.05)",
          border: "1px solid rgba(13,148,136,0.1)",
        }}
      >
        <p className="text-sm" style={{ color: "#94a3b8", lineHeight: 1.7 }}>
          {statement.plainLanguageSummary}
        </p>
      </div>

      {/* Statement table */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "20px 24px" }}>
          <h2
            className="font-bold text-slate-50"
            style={{ fontSize: 18, fontFamily: "var(--font-family-display)" }}
          >
            {formatStatementTitle(statement.statementType)}
          </h2>
          <span className="text-xs" style={{ color: "#64748b" }}>
            {activeTab === "balance_sheet"
              ? "As of " + endDate
              : startDate + " to " + endDate}
          </span>
        </div>

        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Account</th>
              <th className="table-header text-right" style={{ width: 160 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {statement.sections.map((section) => (
              <SectionRows key={section.name} section={section} />
            ))}

            {Object.entries(statement.totals).map(([key, value]) => (
              <tr key={key}>
                <td
                  className="text-sm font-bold text-slate-50"
                  style={{ padding: "14px 20px", borderTop: "1px solid rgba(255,255,255,0.06)" }}
                >
                  {formatTotalLabel(key)}
                </td>
                <td
                  className="text-right font-mono text-sm font-bold"
                  style={{
                    padding: "14px 20px",
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                    color: key === "netIncome" || key === "netChange"
                      ? value >= 0 ? "#5eead4" : "#ef4444"
                      : "#f8fafc",
                    backgroundColor: (key === "netIncome" || key === "netChange" || key === "totalAssets")
                      ? "rgba(13,148,136,0.04)"
                      : undefined,
                  }}
                >
                  {key === "debtToEquity"
                    ? (value / 100).toFixed(2)
                    : formatCurrency(Math.abs(value))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionRows({ section }: { section: StatementResponse["sections"][number] }) {
  return (
    <>
      <tr>
        <td
          colSpan={2}
          className="text-sm font-bold"
          style={{ padding: "20px 20px 10px", color: "#5eead4" }}
        >
          {section.name}
        </td>
      </tr>

      {section.lines.map((line) => (
        <tr key={line.accountCode + line.accountName} className="table-row">
          <td className="table-cell text-sm" style={{ paddingLeft: 36 }}>
            {line.accountCode && (
              <code className="font-mono text-xs" style={{ color: "#5eead4", marginRight: 8 }}>
                {line.accountCode}
              </code>
            )}
            <span style={{ color: "#94a3b8" }}>{line.accountName}</span>
          </td>
          <td
            className="table-cell text-right font-mono text-sm"
            style={{ color: line.currentPeriod < 0 ? "#ef4444" : "#f8fafc" }}
          >
            {line.currentPeriod < 0 ? "(" : ""}
            {formatCurrency(Math.abs(line.currentPeriod))}
            {line.currentPeriod < 0 ? ")" : ""}
          </td>
        </tr>
      ))}

      <tr>
        <td
          className="text-sm font-medium text-slate-50"
          style={{
            paddingLeft: 36,
            padding: "10px 20px 10px 36px",
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          Total {section.name}
        </td>
        <td
          className="text-right font-mono text-sm font-medium"
          style={{
            padding: "10px 20px",
            borderTop: "1px solid rgba(255,255,255,0.04)",
            color: section.total < 0 ? "#ef4444" : "#f8fafc",
          }}
        >
          {section.total < 0 ? "(" : ""}
          {formatCurrency(Math.abs(section.total))}
          {section.total < 0 ? ")" : ""}
        </td>
      </tr>
    </>
  );
}

function formatStatementTitle(type: string): string {
  const titles: Record<string, string> = {
    income_statement: "Income Statement",
    balance_sheet: "Balance Sheet",
    cash_flow: "Cash Flow Statement",
  };
  return titles[type] ?? type;
}

function formatTotalLabel(key: string): string {
  const labels: Record<string, string> = {
    grossProfit: "Gross Profit",
    netIncome: "Net Income",
    totalAssets: "Total Assets",
    totalLiabilitiesAndEquity: "Total Liabilities & Equity",
    debtToEquity: "Debt-to-Equity Ratio",
    netChange: "Net Change in Cash",
  };
  return labels[key] ?? key;
}
`);

writeFile(`${DASH}/app/(dashboard)/statements/page.tsx`, `import { getLedgeClient, getLedgerId } from "@/lib/ledge";
import { StatementsView } from "./statements-view";

export const dynamic = "force-dynamic";

export default async function StatementsPage() {
  const client = getLedgeClient();
  const ledgerId = getLedgerId();

  // Default date range: start of year to today
  const now = new Date();
  const startDate = now.getFullYear() + "-01-01";
  const endDate = now.toISOString().split("T")[0];

  const [pnl, bs, cf] = await Promise.all([
    client.reports.incomeStatement(ledgerId, startDate, endDate),
    client.reports.balanceSheet(ledgerId, endDate),
    client.reports.cashFlow(ledgerId, startDate, endDate),
  ]);

  return (
    <StatementsView
      initialPnl={pnl}
      initialBalanceSheet={bs}
      initialCashFlow={cf}
      defaultStart={startDate}
      defaultEnd={endDate}
    />
  );
}
`);

// ─── 6. API Keys ─────────────────────────────────────────────────────────────

writeFile(`${DASH}/app/(dashboard)/api-keys/api-keys-view.tsx`, `"use client";

import { useState, useTransition } from "react";
import { formatDate } from "@/lib/format";
import { createApiKey, revokeApiKey, fetchApiKeys } from "@/lib/actions";
import { CopyButton } from "@/components/copy-button";
import type { ApiKeySafe } from "@ledge/sdk";

export function ApiKeysView({ initialKeys }: { initialKeys: ApiKeySafe[] }) {
  const [keys, setKeys] = useState<ApiKeySafe[]>(initialKeys);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleCreate = () => {
    if (!newKeyName.trim()) return;
    startTransition(async () => {
      const result = await createApiKey(newKeyName.trim());
      setCreatedKey(result.rawKey);
      setNewKeyName("");
      // Refresh the list
      const updated = await fetchApiKeys();
      setKeys(updated);
    });
  };

  const handleRevoke = (keyId: string) => {
    startTransition(async () => {
      await revokeApiKey(keyId);
      const updated = await fetchApiKeys();
      setKeys(updated);
      setConfirmRevoke(null);
    });
  };

  const envSnippet = createdKey
    ? "LEDGE_API_KEY=" + createdKey + "\\nLEDGE_API_URL=" + (process.env.NEXT_PUBLIC_LEDGE_API_URL ?? "http://localhost:3100")
    : "";

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 28 }}>
        <h1
          className="font-bold"
          style={{ fontSize: 24, color: "#f1f5f9", fontFamily: "var(--font-family-display)" }}
        >
          API Keys
        </h1>
        <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
          Create new key
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Name</th>
              <th className="table-header">Key</th>
              <th className="table-header">Created</th>
              <th className="table-header">Last Used</th>
              <th className="table-header text-right">Status</th>
              <th className="table-header text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id} className="table-row">
                <td className="table-cell text-sm text-slate-50 font-medium">{key.name}</td>
                <td className="table-cell font-mono text-xs" style={{ color: "#5eead4" }}>{key.prefix}...</td>
                <td className="table-cell text-sm">{formatDate(key.createdAt)}</td>
                <td className="table-cell text-sm">{key.lastUsedAt ? formatDate(key.lastUsedAt) : "Never"}</td>
                <td className="table-cell text-right">
                  <span className={"badge " + (key.status === "active" ? "badge-green" : "badge-red")}>{key.status}</span>
                </td>
                <td className="table-cell text-right">
                  {key.status === "active" && (
                    <>
                      {confirmRevoke === key.id ? (
                        <span className="flex items-center justify-end gap-2">
                          <span className="text-xs" style={{ color: "#ef4444" }}>Confirm?</span>
                          <button className="text-xs font-medium" style={{ color: "#ef4444", background: "none", border: "none", cursor: "pointer" }} onClick={() => handleRevoke(key.id)}>Yes</button>
                          <button className="btn-ghost text-xs" onClick={() => setConfirmRevoke(null)}>No</button>
                        </span>
                      ) : (
                        <button className="btn-ghost text-xs" onClick={() => setConfirmRevoke(key.id)}>Revoke</button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={6} className="table-cell text-center text-sm" style={{ color: "#64748b", padding: 48 }}>
                  No API keys yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => { if (!createdKey) setShowCreateModal(false); }}
        >
          <div
            className="card"
            style={{ width: 500, padding: 36, transform: "translateY(-20px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {!createdKey ? (
              <>
                <h2
                  className="font-bold text-slate-50"
                  style={{ fontSize: 20, marginBottom: 20, fontFamily: "var(--font-family-display)" }}
                >
                  Create API Key
                </h2>
                <input
                  type="text"
                  className="input"
                  style={{ marginBottom: 20 }}
                  placeholder="Key name (e.g. Production)"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  autoFocus
                />
                <div className="flex justify-end" style={{ gap: 12 }}>
                  <button className="btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
                  <button className="btn-primary" onClick={handleCreate} disabled={isPending}>
                    {isPending ? "Creating..." : "Create"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2
                  className="font-bold text-slate-50"
                  style={{ fontSize: 20, marginBottom: 8, fontFamily: "var(--font-family-display)" }}
                >
                  Key Created
                </h2>
                <p className="text-sm" style={{ color: "#f59e0b", marginBottom: 20 }}>
                  Copy this key now. You won&apos;t be able to see it again.
                </p>

                <div
                  className="flex items-center justify-between"
                  style={{
                    borderRadius: 14,
                    padding: 16,
                    marginBottom: 20,
                    gap: 12,
                    backgroundColor: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <code className="text-sm font-mono" style={{ color: "#5eead4", wordBreak: "break-all" }}>{createdKey}</code>
                  <CopyButton text={createdKey} />
                </div>

                <div className="flex justify-end">
                  <button className="btn-primary" onClick={() => { setCreatedKey(null); setShowCreateModal(false); }}>
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
`);

writeFile(`${DASH}/app/(dashboard)/api-keys/page.tsx`, `import { getLedgeClient, getLedgerId } from "@/lib/ledge";
import { ApiKeysView } from "./api-keys-view";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const client = getLedgeClient();
  const ledgerId = getLedgerId();
  const keys = await client.apiKeys.list(ledgerId);

  return <ApiKeysView initialKeys={[...keys]} />;
}
`);

// ─── 7. Templates ────────────────────────────────────────────────────────────

writeFile(`${DASH}/app/templates/page.tsx`, `import { getLedgeClient } from "@/lib/ledge";
import { TemplatesGrid } from "./templates-grid";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const client = getLedgeClient();
  const templates = await client.templates.list();

  return <TemplatesGrid templates={templates} />;
}
`);

writeFile(`${DASH}/app/templates/templates-grid.tsx`, `"use client";

import { useRouter } from "next/navigation";
import type { Template } from "@ledge/sdk";

export function TemplatesGrid({ templates }: { templates: Template[] }) {
  const router = useRouter();

  const handleSelect = (slug: string) => {
    void slug;
    router.push("/");
  };

  return (
    <div className="min-h-screen flex flex-col items-center" style={{ padding: "64px 24px" }}>
      <div className="w-full" style={{ maxWidth: 720 }}>
        <h1
          className="font-bold"
          style={{
            fontSize: 28,
            color: "#f1f5f9",
            marginBottom: 8,
            fontFamily: "var(--font-family-display)",
          }}
        >
          Choose a starting point
        </h1>
        <p className="text-sm" style={{ color: "#94a3b8", marginBottom: 40 }}>
          Pick the template closest to your business. You can customise everything later.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 16 }}>
          {templates.map((t) => (
            <button
              key={t.slug}
              onClick={() => handleSelect(t.slug)}
              className="card text-left cursor-pointer"
              style={{
                transition: "all 300ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              <h2
                className="font-bold text-slate-50"
                style={{ fontSize: 18, marginBottom: 8, fontFamily: "var(--font-family-display)" }}
              >
                {t.name}
              </h2>
              <p className="text-sm" style={{ color: "#94a3b8", marginBottom: 16, lineHeight: 1.6 }}>
                {t.description}
              </p>
              <div className="flex flex-wrap" style={{ gap: 6 }}>
                <span
                  className="text-xs"
                  style={{
                    padding: "3px 10px",
                    borderRadius: 9999,
                    backgroundColor: "rgba(13,148,136,0.1)",
                    color: "#5eead4",
                    border: "1px solid rgba(13,148,136,0.15)",
                  }}
                >
                  {t.businessType}
                </span>
              </div>
            </button>
          ))}
        </div>

        <div className="text-center" style={{ marginTop: 36 }}>
          <button
            onClick={() => router.push("/")}
            className="btn-ghost text-sm"
          >
            Skip \\u2014 I&apos;ll configure manually
          </button>
        </div>
      </div>
    </div>
  );
}
`);

console.log("\nAll dashboard files written successfully!");

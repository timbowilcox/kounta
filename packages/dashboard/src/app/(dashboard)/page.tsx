import { getSessionClient } from "@/lib/ledge";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { auth } from "@/lib/auth";
import Link from "next/link";
import type { TransactionWithLines, AccountWithBalance } from "@ledge/sdk";
import { ContextualPrompt } from "@/components/contextual-prompt";
import { PostTransactionButton } from "@/components/post-transaction-button";
import { ProgressChecklist } from "@/components/progress-checklist";
import { FirstClassificationModal } from "@/components/first-classification-modal";

export const dynamic = "force-dynamic";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function OverviewPage() {
  let client: Awaited<ReturnType<typeof getSessionClient>>["client"] | null = null;
  let ledgerId = "";
  try {
    const sc = await getSessionClient();
    client = sc.client;
    ledgerId = sc.ledgerId;
  } catch {
    // Session or API key missing — render empty state
  }

  const session = await auth();
  const rawName = session?.user?.name;
  const firstName = rawName
    ? rawName.split(" ")[0]
    : session?.user?.email
      ? session.user.email.split("@")[0].charAt(0).toUpperCase() + session.user.email.split("@")[0].slice(1)
      : "";

  // Fetch data with safe defaults — each call fails independently
  type LedgerInfo = { name: string; currency: string; accountingBasis: string };
  let ledger: LedgerInfo = { name: "Ledge", currency: "USD", accountingBasis: "accrual" };
  let accountsList: AccountWithBalance[] = [];
  let recentTransactions: TransactionWithLines[] = [];

  if (client && ledgerId) {
    const [ledgerResult, accountsResult, txResult] = await Promise.allSettled([
      client.ledgers.get(ledgerId),
      client.accounts.list(ledgerId),
      client.transactions.list(ledgerId, { limit: 5 }),
    ]);

    if (ledgerResult.status === "fulfilled") ledger = ledgerResult.value as LedgerInfo;
    if (accountsResult.status === "fulfilled") accountsList = accountsResult.value;
    if (txResult.status === "fulfilled") recentTransactions = [...(txResult.value?.data ?? [])];
  }

  const accountCount = accountsList.length;
  const totalAssets = accountsList
    .filter((a: AccountWithBalance) => a.type === "asset")
    .reduce((sum: number, a: AccountWithBalance) => sum + a.balance, 0);
  const totalRevenue = accountsList
    .filter((a: AccountWithBalance) => a.type === "revenue")
    .reduce((sum: number, a: AccountWithBalance) => sum + Math.abs(a.balance), 0);
  const totalExpenses = accountsList
    .filter((a: AccountWithBalance) => a.type === "expense")
    .reduce((sum: number, a: AccountWithBalance) => sum + Math.abs(a.balance), 0);

  return (
    <div>
      {/* Greeting */}
      <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1
            style={{ fontSize: 20, fontWeight: 600, color: "#0A0A0A", marginBottom: 4 }}
          >
            {getGreeting()}, {firstName}
          </h1>
          <p style={{ fontSize: 13, color: "#999999" }}>
            {ledger.name} &middot; {ledger.currency} &middot; {ledger.accountingBasis}
          </p>
        </div>
        <ContextualPrompt placeholder="Ask about your financial overview..." />
      </div>

      {/* Progress checklist — shown for new users */}
      <ProgressChecklist />

      {/* First classification modal — shown after bank sync */}
      <FirstClassificationModal ledgerId={ledgerId} currency={ledger.currency} />

      {/* Metric cards */}
      <div className="grid grid-cols-4" style={{ gap: 16, marginBottom: 32 }}>
        <MetricCard label="Accounts" value={formatNumber(accountCount)} />
        <MetricCard label="Total Assets" value={formatCurrency(totalAssets)} />
        <MetricCard label="Revenue" value={formatCurrency(totalRevenue)} />
        <MetricCard label="Expenses" value={formatCurrency(totalExpenses)} />
      </div>

      {/* Quick actions */}
      <div style={{ marginBottom: 32 }}>
        <div className="section-label" style={{ marginBottom: 8 }}>Quick Actions</div>
        <div className="flex" style={{ gap: 12 }}>
          <QuickActionButton
            icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#0066FF" strokeWidth="1.5" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>}
            label="Post transaction"
          />
          <QuickAction
            icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#0066FF" strokeWidth="1.5" strokeLinecap="round"><path d="M2 13V5M5.5 13V7.5M9 13V3M12.5 13V9" /></svg>}
            label="Generate statement"
            href="/statements"
          />
          <QuickAction
            icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#0066FF" strokeWidth="1.5" strokeLinecap="round"><path d="M2 3h12M3 3v10M13 3v10M2 13h12M2 6.5h12" /></svg>}
            label="Connect bank account"
            href="/bank-feeds"
          />
        </div>
      </div>

      {/* Recent transactions */}
      <div className="card" style={{ padding: 0 }}>
        <div
          className="flex items-center justify-between"
          style={{ padding: "16px 20px" }}
        >
          <span className="section-label">Recent Transactions</span>
          <Link href="/transactions" className="btn-ghost" style={{ fontSize: 12, height: 28, padding: "0 8px" }}>
            View all &rarr;
          </Link>
        </div>

        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header" style={{ position: "sticky", top: 0, zIndex: 1 }}>Date</th>
              <th className="table-header" style={{ position: "sticky", top: 0, zIndex: 1 }}>Description</th>
              <th className="table-header text-right" style={{ position: "sticky", top: 0, zIndex: 1 }}>Amount</th>
              <th className="table-header text-right" style={{ position: "sticky", top: 0, zIndex: 1 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {recentTransactions.map((tx: TransactionWithLines) => {
              const totalDebit = tx.lines
                .filter((l) => l.direction === "debit")
                .reduce((sum, l) => sum + l.amount, 0);
              return (
                <tr key={tx.id} className="table-row">
                  <td className="table-cell font-mono" style={{ fontSize: 13, color: "#666666" }}>{formatDate(tx.date)}</td>
                  <td className="table-cell" style={{ fontSize: 13, color: "#0A0A0A", fontWeight: 500 }}>{tx.memo}</td>
                  <td className="table-cell text-right font-mono" style={{ fontSize: 13 }}>
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
                <td colSpan={4} className="table-cell text-center" style={{ padding: 48 }}>
                  <EmptyState
                    icon={<svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#D4D4D4" strokeWidth="1.5" strokeLinecap="round"><path d="M8 14h32M8 24h32M8 34h20" /></svg>}
                    title="No transactions yet"
                    description="Post your first transaction to see it here."
                    useModal
                  />
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
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">{value}</div>
    </div>
  );
}

function QuickAction({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 quick-action"
      style={{
        padding: "8px 16px",
        borderRadius: 8,
        border: "1px solid #E5E5E5",
        backgroundColor: "#FFFFFF",
        fontSize: 13,
        fontWeight: 500,
        color: "#0A0A0A",
        height: 40,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, backgroundColor: "#F0F6FF" }}>
        {icon}
      </div>
      {label}
    </Link>
  );
}

function QuickActionButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <PostTransactionButton
      className="flex items-center gap-3 quick-action"
      style={{
        padding: "8px 16px",
        borderRadius: 8,
        border: "1px solid #E5E5E5",
        backgroundColor: "#FFFFFF",
        fontSize: 13,
        fontWeight: 500,
        color: "#0A0A0A",
        height: 40,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, backgroundColor: "#F0F6FF" }}>
        {icon}
      </div>
      {label}
    </PostTransactionButton>
  );
}

function EmptyState({ icon, title, description, actionLabel, actionHref, useModal }: { icon: React.ReactNode; title: string; description: string; actionLabel?: string; actionHref?: string; useModal?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, maxWidth: 320, margin: "0 auto" }}>
      <div style={{ marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: "#0A0A0A" }}>{title}</div>
      <div style={{ fontSize: 13, color: "#999999" }}>{description}</div>
      {useModal ? (
        <PostTransactionButton className="btn-primary" style={{ marginTop: 12, cursor: "pointer" }}>
          Post transaction
        </PostTransactionButton>
      ) : actionLabel && actionHref ? (
        <Link href={actionHref} className="btn-primary" style={{ marginTop: 12 }}>
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

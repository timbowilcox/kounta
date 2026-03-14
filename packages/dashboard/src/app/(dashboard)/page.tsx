import { getSessionClient } from "@/lib/kounta";
import { formatCurrency, formatDate } from "@/lib/format";
import { auth } from "@/lib/auth";
import Link from "next/link";
import type { TransactionWithLines, AccountWithBalance } from "@kounta/sdk";
import { ContextualPrompt } from "@/components/contextual-prompt";
import { PostTransactionButton } from "@/components/post-transaction-button";
import { ProgressChecklist } from "@/components/progress-checklist";
import { FirstClassificationModal } from "@/components/first-classification-modal";
import { fetchRevenueMetrics } from "@/lib/actions";

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
  let ledger: LedgerInfo = { name: "Kounta", currency: "USD", accountingBasis: "accrual" };
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

  // Cash balance: sum of accounts with codes 1000–1099 (checking/savings)
  const cashBalance = accountsList
    .filter((a: AccountWithBalance) => {
      const code = parseInt(a.code ?? "", 10);
      return !isNaN(code) && code >= 1000 && code <= 1099;
    })
    .reduce((sum: number, a: AccountWithBalance) => sum + a.balance, 0);

  const totalExpenses = accountsList
    .filter((a: AccountWithBalance) => a.type === "expense")
    .reduce((sum: number, a: AccountWithBalance) => sum + Math.abs(a.balance), 0);

  // Burn rate: average monthly expenses (use total expenses as proxy for current period)
  const burnRate = totalExpenses;

  // Runway: months of cash remaining (burn rate > 0 to avoid division by zero)
  const runwayMonths = burnRate > 0 ? Math.round(cashBalance / burnRate) : null;

  // Revenue recognition metrics (graceful — returns zeros if no schedules)
  let revMetrics = { mrr: 0, arr: 0, deferredRevenueBalance: 0, recognisedThisMonth: 0, recognisedThisYear: 0, activeSchedules: 0 };
  try {
    revMetrics = await fetchRevenueMetrics();
  } catch {
    // Revenue tables may not exist yet
  }
  const hasRevSchedules = revMetrics.activeSchedules > 0;

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
        <MetricCard
          label="Cash Balance"
          value={formatCurrency(cashBalance)}
          icon={<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="4" width="16" height="12" rx="2" /><path d="M2 8h16" /><path d="M6 12h3" /></svg>}
          color="#10B981"
        />
        <MetricCard
          label={hasRevSchedules ? "MRR" : "Revenue"}
          value={hasRevSchedules ? `${formatCurrency(revMetrics.mrr)}/mo` : formatCurrency(accountsList.filter((a: AccountWithBalance) => a.type === "revenue").reduce((s: number, a: AccountWithBalance) => s + Math.abs(a.balance), 0))}
          subtitle={hasRevSchedules ? `Deferred: ${formatCurrency(revMetrics.deferredRevenueBalance)}` : undefined}
          icon={<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#0066FF" strokeWidth="1.5" strokeLinecap="round"><path d="M3 17V9M7.5 17V5M12 17V11M16.5 17V3" /></svg>}
          color="#0066FF"
        />
        <MetricCard
          label="Burn Rate"
          value={burnRate > 0 ? `-${formatCurrency(burnRate)}/mo` : formatCurrency(0)}
          icon={<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round"><path d="M10 3c0 3-4 5-4 8a4 4 0 108 0c0-3-4-5-4-8z" /></svg>}
          color="#F59E0B"
        />
        <MetricCard
          label="Runway"
          value={runwayMonths !== null ? `${runwayMonths} mo` : "∞"}
          subtitle={runwayMonths !== null && runwayMonths <= 6 ? "Review spending" : undefined}
          icon={<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={runwayMonths !== null && runwayMonths <= 6 ? "#EF4444" : "#8B5CF6"} strokeWidth="1.5" strokeLinecap="round"><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2.5" /></svg>}
          color={runwayMonths !== null && runwayMonths <= 6 ? "#EF4444" : "#8B5CF6"}
        />
      </div>

      {/* Quick actions */}
      <div style={{ marginBottom: 32 }}>
        <div className="section-label" style={{ marginBottom: 8 }}>Quick Actions</div>
        <div className="flex" style={{ gap: 12 }}>
          <QuickActionButton
            icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0066FF" strokeWidth="1.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>}
            label="Post transaction"
            bgColor="#EFF6FF"
            accentColor="#0066FF"
          />
          <QuickAction
            icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="1.5" strokeLinecap="round"><path d="M3 18V8M7.5 18V10M12 18V5M16.5 18V12M21 18V14" /></svg>}
            label="Generate statement"
            href="/statements"
            bgColor="#ECFDF5"
            accentColor="#059669"
          />
          <QuickAction
            icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="M7 14h4" /></svg>}
            label="Connect bank account"
            href="/bank-feeds"
            bgColor="#FFFBEB"
            accentColor="#D97706"
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
  subtitle,
  icon,
  color,
}: {
  label: string;
  value: string;
  subtitle?: string;
  icon?: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="stat-card">
      <div className="flex items-center" style={{ gap: 8, marginBottom: 8 }}>
        {icon && (
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: color ? `${color}14` : "#F5F5F5",
          }}>
            {icon}
          </div>
        )}
        <div className="stat-card-label" style={{ marginBottom: 0 }}>{label}</div>
      </div>
      <div className="stat-card-value">{value}</div>
      {subtitle && (
        <div style={{ fontSize: 11, color: "#999999", marginTop: 2, fontFamily: "var(--font-geist-mono, monospace)" }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

function QuickAction({ icon, label, href, bgColor, accentColor }: { icon: React.ReactNode; label: string; href: string; bgColor?: string; accentColor?: string }) {
  return (
    <Link
      href={href}
      className="flex items-center quick-action"
      style={{
        padding: "12px 16px",
        borderRadius: 10,
        border: "1px solid #E5E5E5",
        backgroundColor: bgColor ?? "#FFFFFF",
        fontSize: 14,
        fontWeight: 500,
        color: "#0A0A0A",
        height: 56,
        flex: 1,
        transition: "box-shadow 0.15s, border-color 0.15s",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 8, backgroundColor: accentColor ? `${accentColor}18` : "#F0F6FF", flexShrink: 0 }}>
        {icon}
      </div>
      <span style={{ flex: 1 }}>{label}</span>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={accentColor ?? "#999"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M6 4l4 4-4 4" /></svg>
    </Link>
  );
}

function QuickActionButton({ icon, label, bgColor, accentColor }: { icon: React.ReactNode; label: string; bgColor?: string; accentColor?: string }) {
  return (
    <PostTransactionButton
      className="flex items-center quick-action"
      style={{
        padding: "12px 16px",
        borderRadius: 10,
        border: "1px solid #E5E5E5",
        backgroundColor: bgColor ?? "#FFFFFF",
        fontSize: 14,
        fontWeight: 500,
        color: "#0A0A0A",
        height: 56,
        flex: 1,
        cursor: "pointer",
        transition: "box-shadow 0.15s, border-color 0.15s",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 8, backgroundColor: accentColor ? `${accentColor}18` : "#F0F6FF", flexShrink: 0 }}>
        {icon}
      </div>
      <span style={{ flex: 1 }}>{label}</span>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={accentColor ?? "#999"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M6 4l4 4-4 4" /></svg>
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

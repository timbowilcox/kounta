import { getSessionClient } from "@/lib/kounta";
import { formatCurrency, formatDate, formatDateShort } from "@/lib/format";
import { Sparkline } from "@/components/ui/sparkline";
import { auth } from "@/lib/auth";
import Link from "next/link";
import type { TransactionWithLines, AccountWithBalance } from "@kounta/sdk";
import { PostTransactionButton } from "@/components/post-transaction-button";
import { ProgressChecklist } from "@/components/progress-checklist";
import { FirstClassificationModal } from "@/components/first-classification-modal";
import { fetchRevenueMetrics, fetchPendingDepreciation, fetchInvoiceSummary, fetchARAging } from "@/lib/actions";
import type { InvoiceSummary, ARAgingBucket } from "@/lib/actions";

export const dynamic = "force-dynamic";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 22) return "Good evening";
  return "Hey";
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

  const totalRevenue = accountsList
    .filter((a: AccountWithBalance) => a.type === "revenue")
    .reduce((sum: number, a: AccountWithBalance) => sum + Math.abs(a.balance), 0);

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
  const hasData = accountsList.length > 0;

  // Pending depreciation entries
  let pendingDepreciation = { pendingCount: 0, totalAmount: 0, entries: [] as { assetName: string; amount: number; periodDate: string }[] };
  try {
    pendingDepreciation = await fetchPendingDepreciation();
  } catch {
    // Fixed asset tables may not exist yet
  }

  // Invoice / AR data
  let invoiceSummary: InvoiceSummary = { totalOutstanding: 0, totalOverdue: 0, totalDraft: 0, totalPaidThisMonth: 0, invoiceCount: 0, overdueCount: 0, averageDaysToPayment: null, currency: "USD" };
  let arAging: ARAgingBucket[] = [];
  try {
    const [summaryResult, agingResult] = await Promise.allSettled([
      fetchInvoiceSummary(),
      fetchARAging(),
    ]);
    if (summaryResult.status === "fulfilled") invoiceSummary = summaryResult.value;
    if (agingResult.status === "fulfilled") arAging = agingResult.value;
  } catch {
    // Invoice tables may not exist yet
  }

  return (
    <div>
      {/* Greeting */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 4 }}>
          {getGreeting()}, {firstName}
        </h1>
        <p style={{ fontSize: 14, color: "var(--text-tertiary)", fontWeight: 400 }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <p style={{ fontSize: 14, color: "var(--text-tertiary)" }}>
          {recentTransactions.length === 0 && !hasData ? (
            <>No accounts connected &middot; <Link href="/bank-feeds" style={{ color: "var(--text-secondary)" }}>Connect your bank to get started &rarr;</Link></>
          ) : (
            <>{accountsList.length} account{accountsList.length !== 1 ? "s" : ""} &middot; {ledger.currency} &middot; {ledger.accountingBasis}</>
          )}
        </p>
      </div>

      {/* Progress checklist — shown for new users */}
      <ProgressChecklist />

      {/* First classification modal — shown after bank sync */}
      <FirstClassificationModal ledgerId={ledgerId} currency={ledger.currency} />

      {/* Depreciation pending alert */}
      {pendingDepreciation.pendingCount > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderRadius: "var(--radius-md)",
            border: "1px solid color-mix(in srgb, var(--warning) 30%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--warning) 8%, var(--surface-1))",
            marginBottom: 16,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span style={{ flex: 1, fontSize: 13, color: "var(--text-primary)" }}>
            {pendingDepreciation.pendingCount} depreciation {pendingDepreciation.pendingCount === 1 ? "entry" : "entries"} pending ({formatCurrency(pendingDepreciation.totalAmount)})
          </span>
          <Link
            href="/fixed-assets"
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--warning)",
              whiteSpace: "nowrap",
            }}
          >
            Post now &rarr;
          </Link>
        </div>
      )}

      {/* Overdue invoices alert */}
      {invoiceSummary.overdueCount > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderRadius: "var(--radius-md)",
            border: "1px solid color-mix(in srgb, var(--negative) 30%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--negative) 8%, var(--surface-1))",
            marginBottom: 16,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--negative)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span style={{ flex: 1, fontSize: 13, color: "var(--text-primary)" }}>
            {invoiceSummary.overdueCount} invoice{invoiceSummary.overdueCount !== 1 ? "s" : ""} overdue ({formatCurrency(invoiceSummary.totalOverdue)})
          </span>
          <Link
            href="/invoices?status=overdue"
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--negative)",
              whiteSpace: "nowrap",
            }}
          >
            View &rarr;
          </Link>
        </div>
      )}

      {/* AR Aging summary */}
      {arAging.length > 0 && arAging.some((b) => b.amount > 0) && (
        <div
          style={{
            padding: "16px 20px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
            backgroundColor: "var(--surface-1)",
            marginBottom: 16,
          }}
        >
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Accounts Receivable</span>
            <Link href="/invoices" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>View invoices &rarr;</Link>
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            {arAging.map((bucket) => (
              <div key={bucket.label} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 4 }}>{bucket.label}</div>
                <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: bucket.amount > 0 ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                  {formatCurrency(bucket.amount)}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
                  {bucket.count} inv{bucket.count !== 1 ? "s" : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-4" style={{ gap: 16, marginBottom: 32 }}>
        <MetricCard
          label="Cash Balance"
          value={formatCurrency(cashBalance)}
          trend={hasData ? undefined : "—"}
          trendDirection="neutral"
          zeroHref={!hasData ? "/bank-feeds" : undefined}
          zeroCta={!hasData ? "Connect your bank →" : undefined}
        />
        <MetricCard
          label={hasRevSchedules ? "MRR" : "Revenue"}
          value={hasRevSchedules ? `${formatCurrency(revMetrics.mrr)}/mo` : formatCurrency(totalRevenue)}
          subtitle={hasRevSchedules ? `Deferred: ${formatCurrency(revMetrics.deferredRevenueBalance)}` : undefined}
          trend={hasData ? undefined : "—"}
          trendDirection="neutral"
        />
        <MetricCard
          label="Burn Rate"
          value={burnRate > 0 ? `-${formatCurrency(burnRate)}/mo` : formatCurrency(0)}
          trend={hasData ? undefined : "—"}
          trendDirection={burnRate > 0 ? "negative" : "neutral"}
        />
        <MetricCard
          label="Runway"
          value={runwayMonths !== null ? `${runwayMonths} mo` : "∞"}
          trend={runwayMonths !== null && runwayMonths <= 6 ? "Low" : undefined}
          trendDirection={runwayMonths !== null && runwayMonths <= 6 ? "negative" : "neutral"}
        />
      </div>

      {/* Quick actions */}
      <div style={{ marginBottom: 32 }}>
        <div className="flex" style={{ gap: 12 }}>
          <QuickActionButton
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>}
            label="Post transaction"
          />
          <QuickAction
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round"><path d="M3 18V8M7.5 18V10M12 18V5M16.5 18V12M21 18V14" /></svg>}
            label="Generate statement"
            href="/statements"
          />
          <QuickAction
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="M7 14h4" /></svg>}
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
                  <td className="table-cell font-mono" style={{ fontSize: 13, color: "var(--text-tertiary)" }}>{formatDateShort(tx.date)}</td>
                  <td className="table-cell" style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>{tx.memo}</td>
                  <td className="table-cell text-right font-mono" style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
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
                <td colSpan={4} className="table-cell" style={{ padding: 48 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, maxWidth: 360, margin: "0 auto" }}>
                    {/* Ghost rows */}
                    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8, opacity: 0.2, marginBottom: 8 }}>
                      {[1, 2, 3].map((i) => (
                        <div key={i} style={{ display: "flex", gap: 16, alignItems: "center" }}>
                          <div className="skeleton" style={{ width: 80, height: 12 }} />
                          <div className="skeleton" style={{ flex: 1, height: 12 }} />
                          <div className="skeleton" style={{ width: 60, height: 12 }} />
                        </div>
                      ))}
                    </div>
                    <svg width="32" height="32" viewBox="0 0 48 48" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M8 14h32M8 24h32M8 34h20" />
                    </svg>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>Your ledger is ready</div>
                    <div style={{ fontSize: 13, color: "var(--text-tertiary)", textAlign: "center" }}>
                      Transactions will appear here once you connect a bank feed or post your first entry.
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <Link href="/bank-feeds" className="btn-secondary" style={{ fontSize: 13 }}>
                        Connect bank
                      </Link>
                      <PostTransactionButton className="btn-primary" style={{ fontSize: 13, cursor: "pointer" }}>
                        Add manual entry
                      </PostTransactionButton>
                    </div>
                  </div>
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
  trend,
  trendDirection = "neutral",
  zeroHref,
  zeroCta,
}: {
  label: string;
  value: string;
  subtitle?: string;
  trend?: string;
  trendDirection?: "positive" | "negative" | "neutral";
  zeroHref?: string;
  zeroCta?: string;
}) {
  const trendColor =
    trendDirection === "positive" ? "var(--positive)" :
    trendDirection === "negative" ? "var(--negative)" :
    "var(--text-tertiary)";

  const trendIcon =
    trendDirection === "positive" ? " ↑" :
    trendDirection === "negative" ? " ↓" :
    "";

  return (
    <div className="stat-card">
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <div className="stat-card-label" style={{ marginBottom: 0 }}>{label}</div>
        {trend && (
          <span style={{ fontSize: 12, fontWeight: 500, color: trendColor, fontFamily: "var(--font-mono)" }}>
            {trend}{trendIcon}
          </span>
        )}
      </div>
      <div className="stat-card-value">{value}</div>
      {subtitle && (
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
          {subtitle}
        </div>
      )}
      <div style={{ height: 40, marginTop: 12 }}>
        <Sparkline data={[]} state="empty" />
      </div>
      {zeroCta && zeroHref && (
        <a href={zeroHref} style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 8, display: "block" }}>
          {zeroCta}
        </a>
      )}
    </div>
  );
}

function QuickAction({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center quick-action"
      style={{
        padding: "12px 16px",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        backgroundColor: "var(--surface-1)",
        fontSize: 13,
        fontWeight: 500,
        color: "var(--text-primary)",
        height: 48,
        flex: 1,
        gap: 12,
      }}
    >
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
      <svg className="quick-action-arrow" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M6 4l4 4-4 4" /></svg>
    </Link>
  );
}

function QuickActionButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <PostTransactionButton
      className="flex items-center quick-action"
      style={{
        padding: "12px 16px",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        backgroundColor: "var(--surface-1)",
        fontSize: 13,
        fontWeight: 500,
        color: "var(--text-primary)",
        height: 48,
        flex: 1,
        cursor: "pointer",
        gap: 12,
        textAlign: "left",
      }}
    >
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
      <svg className="quick-action-arrow" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M6 4l4 4-4 4" /></svg>
    </PostTransactionButton>
  );
}

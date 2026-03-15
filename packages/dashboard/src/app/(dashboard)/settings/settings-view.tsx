"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { formatDate } from "@/lib/format";
import { createApiKey, revokeApiKey, fetchApiKeys, createCheckoutSession, createPortalSession, fetchEmailPreferences, updateEmailPreferences, fetchRecurringEntries, deleteRecurringEntryAction, pauseRecurringEntryAction, resumeRecurringEntryAction, updateLedgerAction, reopenPeriodAction, fetchStripeStatus, disconnectStripe, syncStripe, getStripeAuthorizeUrl, updateUserNameAction, fetchOAuthConnections, revokeOAuthConnection } from "@/lib/actions";
import type { StripeConnectStatus, OAuthConnection } from "@/lib/actions";
import type { EmailPreferences, ClosedPeriodSummary } from "@/lib/actions";
import { CopyButton } from "@/components/copy-button";
import type { ApiKeySafe, AccountWithBalance } from "@kounta/sdk";
import type { BillingStatus } from "@/lib/actions";
import { AccountsView } from "@/app/(dashboard)/accounts/accounts-view";

// ── Types ──────────────────────────────────────────────────────────────────

type SettingsTab = "general" | "accounts" | "currencies" | "api-keys" | "billing" | "email" | "recurring" | "connections";

interface Props {
  ledger: { name: string; currency: string; accountingBasis: string; templateId: string | null; createdAt: string };
  billing: BillingStatus;
  initialKeys: ApiKeySafe[];
  currencies: any[];
  exchangeRates: any[];
  fiscalYearStart: number;
  closedThrough: string | null;
  closedPeriods: ClosedPeriodSummary[];
  accounts: AccountWithBalance[];
}

// ── Template display names ──────────────────────────────────────────────────

const TEMPLATE_LABELS: Record<string, string> = {
  tpl_saas: "SaaS Starter",
  tpl_marketplace: "Marketplace",
  tpl_agency: "Agency & Professional Services",
  tpl_ecommerce: "Ecommerce Store",
  tpl_creator: "Creator",
  tpl_consulting: "Freelancer & Consultant",
  tpl_property: "Property Management",
  tpl_nonprofit: "Nonprofit Organisation",
  // Fallback for slug-style references
  saas: "SaaS Starter",
  "saas-starter": "SaaS Starter",
  marketplace: "Marketplace",
  agency: "Agency & Professional Services",
  ecommerce: "Ecommerce Store",
  creator: "Creator",
  consulting: "Freelancer & Consultant",
  freelancer: "Freelancer & Consultant",
  property: "Property Management",
  nonprofit: "Nonprofit Organisation",
  restaurant: "Restaurant & Hospitality",
  general: "General Business",
};

const getTemplateName = (templateId: string | null): string => {
  if (!templateId) return "Custom";
  return TEMPLATE_LABELS[templateId] ?? TEMPLATE_LABELS[templateId.replace("tpl_", "")] ?? templateId;
};

// ── Tab config ─────────────────────────────────────────────────────────────

const TABS: { key: SettingsTab; label: string }[] = [
  { key: "general", label: "General" },
  { key: "accounts", label: "Accounts" },
  { key: "connections", label: "Connections" },
  { key: "recurring", label: "Recurring" },
  { key: "api-keys", label: "API Keys" },
  { key: "billing", label: "Subscription" },
  { key: "email", label: "Email" },
];

// ── Main component ─────────────────────────────────────────────────────────

export function SettingsView({ ledger, billing, initialKeys, currencies, exchangeRates, fiscalYearStart, closedThrough, closedPeriods, accounts }: Props) {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as SettingsTab) || "general";
  const [activeTab, setActiveTab] = useState<SettingsTab>(TABS.some(t => t.key === initialTab) ? initialTab : "general");

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text-primary)" }}>
          Settings
        </h1>
      </div>

      {/* Underline tab bar */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid var(--border)",
          marginBottom: 24,
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                window.history.replaceState(null, "", "/settings?tab=" + tab.key);
              }}
              style={{
                padding: "8px 16px",
                paddingBottom: 10,
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "var(--text-primary)" : "var(--text-tertiary)",
                background: "none",
                border: "none",
                borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                cursor: "pointer",
                transition: "all 150ms ease",
                marginBottom: -1,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "general" && <GeneralTab ledger={ledger} fiscalYearStart={fiscalYearStart} closedThrough={closedThrough} closedPeriods={closedPeriods} />}
      {activeTab === "accounts" && <AccountsView accounts={accounts} />}
      {activeTab === "currencies" && <CurrenciesTab currencies={currencies} exchangeRates={exchangeRates} />}
      {activeTab === "api-keys" && <ApiKeysTab initialKeys={initialKeys} />}
      {activeTab === "billing" && <BillingTab billing={billing} />}
      {activeTab === "email" && <EmailTab />}
      {activeTab === "recurring" && <RecurringTab />}
      {activeTab === "connections" && <ConnectionsTab />}
    </div>
  );
}

// ── General Tab ────────────────────────────────────────────────────────────

const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function GeneralTab({ ledger, fiscalYearStart, closedThrough, closedPeriods }: { ledger: Props["ledger"]; fiscalYearStart: number; closedThrough: string | null; closedPeriods: ClosedPeriodSummary[] }) {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [fyStart, setFyStart] = useState(fiscalYearStart);
  const [fySaving, setFySaving] = useState(false);
  const [fySaved, setFySaved] = useState(false);
  const [periods, setPeriods] = useState(closedPeriods);
  const [reopening, setReopening] = useState<string | null>(null);

  // Display name editing
  const [displayName, setDisplayName] = useState(session?.user?.name ?? "");
  const [displayNameSaved, setDisplayNameSaved] = useState(false);
  const [displayNameSaving, setDisplayNameSaving] = useState(false);
  const displayNameOriginal = useRef(session?.user?.name ?? "");
  const displayNameDirty = displayName !== displayNameOriginal.current;

  useEffect(() => {
    if (session?.user?.name) {
      setDisplayName(session.user.name);
      displayNameOriginal.current = session.user.name;
    }
  }, [session?.user?.name]);

  const handleDisplayNameSave = async () => {
    if (!displayName.trim()) return;
    setDisplayNameSaving(true);
    const ok = await updateUserNameAction(displayName.trim());
    if (ok) {
      await update({ name: displayName.trim() });
      displayNameOriginal.current = displayName.trim();
      setDisplayNameSaved(true);
      setTimeout(() => setDisplayNameSaved(false), 2000);
      // Refresh server components so sidebar/greeting show the new name
      router.refresh();
    }
    setDisplayNameSaving(false);
  };

  // Ledger name editing
  const [ledgerName, setLedgerName] = useState(ledger.name);
  const [ledgerNameSaved, setLedgerNameSaved] = useState(false);
  const [ledgerNameSaving, setLedgerNameSaving] = useState(false);
  const [ledgerNameError, setLedgerNameError] = useState<string | null>(null);
  const ledgerNameOriginal = useRef(ledger.name);
  const ledgerNameDirty = ledgerName !== ledgerNameOriginal.current;

  const handleLedgerNameSave = async () => {
    if (!ledgerName.trim()) {
      setLedgerNameError("Name cannot be empty");
      return;
    }
    if (ledgerName.trim().length > 50) {
      setLedgerNameError("Name must be 50 characters or less");
      return;
    }
    setLedgerNameError(null);
    setLedgerNameSaving(true);
    const ok = await updateLedgerAction({ name: ledgerName.trim() });
    if (ok) {
      ledgerNameOriginal.current = ledgerName.trim();
      setLedgerNameSaved(true);
      setTimeout(() => setLedgerNameSaved(false), 2000);
    }
    setLedgerNameSaving(false);
  };

  const handleFyChange = async (month: number) => {
    setFyStart(month);
    setFySaving(true);
    await updateLedgerAction({ fiscalYearStart: month });
    setFySaving(false);
    setFySaved(true);
    setTimeout(() => setFySaved(false), 2000);
  };

  const handleReopen = async (periodEnd: string) => {
    setReopening(periodEnd);
    await reopenPeriodAction(periodEnd);
    setPeriods((prev) => prev.map((p) => p.periodEnd === periodEnd ? { ...p, reopenedAt: new Date().toISOString(), reopenedBy: "user" } : p));
    setReopening(null);
  };

  const activePeriods = periods.filter((p) => !p.reopenedAt);
  const hasClosedPeriods = activePeriods.length > 0;
  const fmtPeriodEnd = (d: string) => {
    const dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Account info */}
      <div className="card">
        <div className="section-label" style={{ marginBottom: 16 }}>Account</div>
        {session?.user && (
          <div>
            <div className="flex items-center gap-3" style={{ marginBottom: 20 }}>
              {session.user.image && (
                <img
                  src={session.user.image}
                  alt=""
                  style={{ width: 40, height: 40, borderRadius: "50%", border: "1px solid var(--border)" }}
                />
              )}
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{session.user.name}</div>
                <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{session.user.email}</div>
              </div>
            </div>

            {/* Display name editable field */}
            <div>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-tertiary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
                Display Name
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && displayNameDirty) handleDisplayNameSave(); }}
                  style={{
                    flex: 1,
                    maxWidth: 280,
                    backgroundColor: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    padding: "8px 12px",
                    fontSize: 14,
                    color: "var(--text-primary)",
                    outline: "none",
                    transition: "border-color 150ms ease",
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
                />
                {displayNameDirty && !displayNameSaved && (
                  <button
                    onClick={handleDisplayNameSave}
                    disabled={displayNameSaving}
                    className="btn-primary"
                    style={{
                      height: 32,
                      padding: "0 16px",
                      fontSize: 13,
                      animation: "fadeIn 150ms ease",
                    }}
                  >
                    {displayNameSaving ? "Saving..." : "Save"}
                  </button>
                )}
                {displayNameSaved && (
                  <span style={{ fontSize: 13, color: "var(--positive)", animation: "fade-in 150ms ease" }}>
                    Saved ✓
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Ledger info */}
      <div className="card">
        <div className="section-label" style={{ marginBottom: 16 }}>Ledger</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Editable ledger name */}
          <div>
            <label style={{ display: "block", fontSize: 11, color: "var(--text-tertiary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
              Name
            </label>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={ledgerName}
                onChange={(e) => {
                  setLedgerName(e.target.value);
                  if (e.target.value.trim()) setLedgerNameError(null);
                }}
                onKeyDown={(e) => { if (e.key === "Enter" && ledgerNameDirty) handleLedgerNameSave(); }}
                maxLength={50}
                style={{
                  flex: 1,
                  backgroundColor: "var(--surface-2)",
                  border: `1px solid ${ledgerNameError ? "var(--negative)" : "var(--border)"}`,
                  borderRadius: "var(--radius-md)",
                  padding: "8px 12px",
                  fontSize: 14,
                  color: "var(--text-primary)",
                  outline: "none",
                  transition: "border-color 150ms ease",
                }}
                onFocus={(e) => { if (!ledgerNameError) e.currentTarget.style.borderColor = "var(--accent)"; }}
                onBlur={(e) => { if (!ledgerNameError) e.currentTarget.style.borderColor = "var(--border)"; }}
              />
              {ledgerNameDirty && !ledgerNameSaved && (
                <button
                  onClick={handleLedgerNameSave}
                  disabled={ledgerNameSaving}
                  className="btn-primary"
                  style={{
                    height: 32,
                    padding: "0 16px",
                    fontSize: 13,
                    animation: "fadeIn 150ms ease",
                  }}
                >
                  {ledgerNameSaving ? "Saving..." : "Save"}
                </button>
              )}
              {ledgerNameSaved && (
                <span style={{ fontSize: 13, color: "var(--positive)", animation: "fade-in 150ms ease" }}>
                  Saved ✓
                </span>
              )}
            </div>
            {ledgerNameError && (
              <div style={{ fontSize: 11, color: "var(--negative)", marginTop: 4 }}>
                {ledgerNameError}
              </div>
            )}
          </div>
          <InfoRow label="Template" value={getTemplateName(ledger.templateId)} />
          <InfoRow label="Currency" value={ledger.currency} />
          <InfoRow label="Accounting Basis" value={ledger.accountingBasis} />
          <InfoRow label="Created" value={formatDate(ledger.createdAt)} />
          <div>
            <label style={{ display: "block", fontSize: 11, color: "var(--text-tertiary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
              Fiscal Year Start
            </label>
            {hasClosedPeriods ? (
              /* Locked fiscal year — read-only display */
              <div>
                <FiscalYearLocked month={fyStart} />
                <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 6 }}>
                  Fiscal year is locked after periods are closed.
                </div>
              </div>
            ) : (
              /* Editable fiscal year dropdown */
              <div>
                <select
                  className="input"
                  value={fyStart}
                  onChange={(e) => handleFyChange(Number(e.target.value))}
                  style={{ fontSize: 13, width: "100%" }}
                >
                  {MONTH_NAMES.slice(1).map((name, i) => (
                    <option key={i + 1} value={i + 1}>{name}</option>
                  ))}
                </select>
                <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 6 }}>
                  This can be changed until your first period is closed.
                </div>
                {(fySaving || fySaved) && (
                  <div style={{ fontSize: 13, marginTop: 6, color: fySaved ? "var(--positive)" : "var(--text-tertiary)" }}>
                    {fySaving ? "Saving..." : "Saved ✓"}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Period Close */}
      <div className="card">
        <div className="section-label" style={{ marginBottom: 4 }}>Period Close</div>
        <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 16 }}>
          {closedThrough
            ? `Books are closed through ${fmtPeriodEnd(closedThrough)}. No transactions can be posted on or before that date.`
            : <>No closed periods yet. Close periods from the <a href="/statements" style={{ color: "var(--accent)", textDecoration: "none" }}>Statements page →</a></>}
        </p>

        {activePeriods.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activePeriods
              .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
              .map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between"
                  style={{
                    padding: "10px 16px",
                    borderRadius: 8,
                    backgroundColor: "var(--surface-2)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="7" width="10" height="7" rx="1.5" />
                      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
                    </svg>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
                        Through {fmtPeriodEnd(p.periodEnd)}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text-tertiary)", marginLeft: 12 }}>
                        Closed {formatDate(p.closedAt)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleReopen(p.periodEnd)}
                    disabled={reopening === p.periodEnd}
                    style={{
                      padding: "4px 12px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      backgroundColor: "transparent",
                      color: "#D97706",
                      border: "1px solid rgba(217,119,6,0.2)",
                      cursor: reopening === p.periodEnd ? "wait" : "pointer",
                      opacity: reopening === p.periodEnd ? 0.6 : 1,
                    }}
                  >
                    {reopening === p.periodEnd ? "Reopening..." : "Reopen"}
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Locked fiscal year display with lock icon and tooltip */
function FiscalYearLocked({ month }: { month: number }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex items-center gap-2" style={{ position: "relative" }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
        {MONTH_NAMES[month]}
      </span>
      <div
        style={{ position: "relative", display: "inline-flex", cursor: "help" }}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="7" width="10" height="7" rx="1.5" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
        </svg>
        {showTooltip && (
          <div
            ref={tooltipRef}
            style={{
              position: "absolute",
              bottom: "calc(100% + 8px)",
              left: "50%",
              transform: "translateX(-50%)",
              backgroundColor: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "8px 12px",
              fontSize: 12,
              color: "var(--text-secondary)",
              maxWidth: 240,
              whiteSpace: "normal",
              lineHeight: 1.5,
              zIndex: 10,
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              pointerEvents: "none",
            }}
          >
            Changing fiscal year after closing periods would break your historical statements. Contact support if restructuring is needed.
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

// ── Currencies Tab ─────────────────────────────────────────────────────────

function CurrenciesTab({ currencies, exchangeRates }: { currencies: any[]; exchangeRates: any[] }) {
  const fmtRate = (rate: number) => (rate / 1_000_000).toFixed(6);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Enabled currencies */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Enabled Currencies</h2>
              <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>Currencies available for transactions</p>
            </div>
            <span style={{ fontSize: 12, color: "var(--text-tertiary)", fontWeight: 500 }}>{currencies.length}</span>
          </div>
        </div>

        {currencies.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", marginBottom: 4 }}>No additional currencies</p>
            <p style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Enable currencies via the API or MCP.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Currency</th>
                <th className="table-header">Symbol</th>
                <th className="table-header">Decimals</th>
                <th className="table-header">Status</th>
                <th className="table-header">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {currencies.map((c: any) => (
                <tr key={c.id} className="table-row">
                  <td className="table-cell font-mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{c.currencyCode}</td>
                  <td className="table-cell" style={{ fontSize: 13 }}>{c.symbol}</td>
                  <td className="table-cell" style={{ fontSize: 13 }}>{c.decimalPlaces}</td>
                  <td className="table-cell"><span className={"badge " + (c.enabled ? "badge-green" : "badge-red")}>{c.enabled ? "Active" : "Disabled"}</span></td>
                  <td className="table-cell" style={{ fontSize: 13 }}>{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Exchange rates */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Exchange Rates</h2>
              <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>Stored rates for currency conversion</p>
            </div>
            <span style={{ fontSize: 12, color: "var(--text-tertiary)", fontWeight: 500 }}>{exchangeRates.length}</span>
          </div>
        </div>

        {exchangeRates.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", marginBottom: 4 }}>No exchange rates</p>
            <p style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Set rates via the API or MCP.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">From</th>
                <th className="table-header">To</th>
                <th className="table-header text-right">Rate</th>
                <th className="table-header">Effective</th>
                <th className="table-header">Source</th>
              </tr>
            </thead>
            <tbody>
              {exchangeRates.map((r: any) => (
                <tr key={r.id} className="table-row">
                  <td className="table-cell font-mono" style={{ fontSize: 13, fontWeight: 600 }}>{r.fromCurrency}</td>
                  <td className="table-cell font-mono" style={{ fontSize: 13, fontWeight: 600 }}>{r.toCurrency}</td>
                  <td className="table-cell text-right font-mono" style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{fmtRate(r.rate)}</td>
                  <td className="table-cell" style={{ fontSize: 13 }}>{fmtDate(r.effectiveDate)}</td>
                  <td className="table-cell"><span className="badge badge-blue">{r.source}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── API Keys Tab ───────────────────────────────────────────────────────────

function ApiKeysTab({ initialKeys }: { initialKeys: ApiKeySafe[] }) {
  const [keys, setKeys] = useState<ApiKeySafe[]>(initialKeys);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [mcpExpanded, setMcpExpanded] = useState(false);

  const handleCreate = () => {
    if (!newKeyName.trim()) return;
    startTransition(async () => {
      const result = await createApiKey(newKeyName.trim());
      setCreatedKey(result.rawKey);
      setNewKeyName("");
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Keys table */}
      <div>
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <div className="section-label">API Keys</div>
          <button className="btn-primary" style={{ fontSize: 13 }} onClick={() => setShowCreateModal(true)}>
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
                  <td className="table-cell" style={{ fontSize: 13, fontWeight: 500 }}>{key.name}</td>
                  <td className="table-cell font-mono" style={{ fontSize: 12, color: "var(--accent)" }}>{key.prefix}...</td>
                  <td className="table-cell" style={{ fontSize: 13 }}>{formatDate(key.createdAt)}</td>
                  <td className="table-cell" style={{ fontSize: 13 }}>{key.lastUsedAt ? formatDate(key.lastUsedAt) : "Never"}</td>
                  <td className="table-cell text-right">
                    <span className={"badge " + (key.status === "active" ? "badge-green" : "badge-red")}>{key.status}</span>
                  </td>
                  <td className="table-cell text-right">
                    {key.status === "active" && (
                      confirmRevoke === key.id ? (
                        <span className="flex items-center justify-end gap-2">
                          <span style={{ fontSize: 12, color: "var(--negative)" }}>Confirm?</span>
                          <button style={{ fontSize: 12, fontWeight: 500, color: "var(--negative)", background: "none", border: "none", cursor: "pointer" }} onClick={() => handleRevoke(key.id)}>Yes</button>
                          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setConfirmRevoke(null)}>No</button>
                        </span>
                      ) : (
                        <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setConfirmRevoke(key.id)}>Revoke</button>
                      )
                    )}
                  </td>
                </tr>
              ))}
              {keys.length === 0 && (
                <tr>
                  <td colSpan={6} className="table-cell text-center" style={{ fontSize: 13, color: "var(--text-tertiary)", padding: 48 }}>
                    No API keys yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MCP Guide collapsible */}
      <div className="card" style={{ padding: 0 }}>
        <button
          onClick={() => setMcpExpanded(!mcpExpanded)}
          className="flex items-center justify-between w-full"
          style={{ padding: "16px 20px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>MCP Connection Guide</div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>Connect Kounta to Claude Code or Cursor</div>
          </div>
          <svg
            width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5"
            style={{ transform: mcpExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 150ms ease" }}
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>

        {mcpExpanded && (
          <div style={{ padding: "0 20px 20px", borderTop: "1px solid var(--border)" }}>
            <McpGuideContent />
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => { if (!createdKey) setShowCreateModal(false); }}
        >
          <div
            style={{
              width: 480,
              padding: 32,
              backgroundColor: "var(--surface-1)",
              borderRadius: 8,
              border: "1px solid var(--border)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.24)",
              transform: "translateY(-20px)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {!createdKey ? (
              <>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 20 }}>Create API Key</h2>
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
                <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>Key Created</h2>
                <p style={{ fontSize: 13, color: "#D97706", marginBottom: 20 }}>
                  Copy this key now. You won&apos;t be able to see it again.
                </p>
                <div
                  className="flex items-center justify-between"
                  style={{ borderRadius: 8, padding: 16, marginBottom: 20, gap: 12, backgroundColor: "var(--surface-2)", border: "1px solid var(--border)" }}
                >
                  <code className="font-mono" style={{ fontSize: 13, color: "var(--accent)", wordBreak: "break-all" }}>{createdKey}</code>
                  <CopyButton text={createdKey} />
                </div>
                <div className="flex justify-end">
                  <button className="btn-primary" onClick={() => { setCreatedKey(null); setShowCreateModal(false); }}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── MCP Guide Content ──────────────────────────────────────────────────────

function McpGuideContent() {
  const [activeTool, setActiveTool] = useState<"claude-code" | "cursor">("claude-code");

  const configs = {
    "claude-code": {
      label: "Claude Code",
      file: ".claude/settings.json",
      config: `{
  "mcpServers": {
    "kounta": {
      "command": "npx",
      "args": ["@kounta/mcp@latest"],
      "env": {
        "KOUNTA_API_KEY": "YOUR_API_KEY_HERE",
        "KOUNTA_API_URL": "http://localhost:3100"
      }
    }
  }
}`,
    },
    cursor: {
      label: "Cursor",
      file: ".cursor/mcp.json",
      config: `{
  "mcpServers": {
    "kounta": {
      "command": "npx",
      "args": ["@kounta/mcp@latest"],
      "env": {
        "KOUNTA_API_KEY": "YOUR_API_KEY_HERE",
        "KOUNTA_API_URL": "http://localhost:3100"
      }
    }
  }
}`,
    },
  };

  const cfg = configs[activeTool];

  return (
    <div style={{ paddingTop: 20 }}>
      <div className="flex" style={{ gap: 4, marginBottom: 20 }}>
        {(["claude-code", "cursor"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setActiveTool(key)}
            style={{
              padding: "0 12px",
              height: 32,
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              backgroundColor: activeTool === key ? "var(--surface-3)" : "transparent",
              color: activeTool === key ? "var(--accent)" : "var(--text-tertiary)",
              border: activeTool === key ? "1px solid var(--border-strong)" : "1px solid transparent",
              cursor: "pointer",
              transition: "all 150ms ease",
            }}
          >
            {configs[key].label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", fontWeight: 500 }}>
          <code className="font-mono" style={{ color: "var(--accent)" }}>{cfg.file}</code>
        </div>
        <CopyButton text={cfg.config} label="Copy" />
      </div>
      <div
        style={{
          borderRadius: 8,
          padding: 16,
          backgroundColor: "var(--surface-2)",
          border: "1px solid var(--border)",
        }}
      >
        <pre className="font-mono overflow-x-auto" style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          {cfg.config}
        </pre>
      </div>
    </div>
  );
}

// ── Subscription Tab ───────────────────────────────────────────────────────

const PLAN_TIERS = [
  {
    name: "Free", price: "$0", period: "/month", plan: "free" as const,
    features: ["500 transactions/month", "Single entity", "Single currency", "Basic statements", "CSV import", "Full API & MCP access"],
  },
  {
    name: "Builder", price: "$19", period: "/month", plan: "builder" as const, recommended: true,
    features: ["Unlimited transactions", "Bank feed integration", "Auto-reconciliation", "Intelligence layer", "Statement PDF export", "Email notifications"],
  },
  {
    name: "Pro", price: "$49", period: "/month", plan: "pro" as const, comingSoon: true,
    features: ["Everything in Builder", "Multi-currency", "Up to 3 linked entities", "Consolidated reporting", "Budgeting & forecasting", "Custom chart of accounts", "API webhooks", "Priority support"],
  },
  {
    name: "Platform", price: "$149", period: "/month", plan: "platform" as const, comingSoon: true,
    features: ["Everything in Pro", "Unlimited entities", "Multi-jurisdiction tax", "RBAC with team roles", "White-label", "Tenant isolation", "Approval workflows", "SLA & dedicated support"],
  },
];

function BillingTab({ billing }: { billing: BillingStatus }) {
  const [isPending, startTransition] = useTransition();
  const [redirecting, setRedirecting] = useState(false);

  const isFree = billing.plan === "free";
  const limit = billing.usage.limit ?? Infinity;
  const pct = limit === Infinity ? 0 : Math.min((billing.usage.count / limit) * 100, 100);
  const barColor = pct >= 100 ? "var(--negative)" : pct >= 80 ? "#D97706" : "var(--accent)";

  const handleUpgrade = () => {
    setRedirecting(true);
    startTransition(async () => {
      try {
        const url = await createCheckoutSession();
        window.location.href = url;
      } catch { setRedirecting(false); }
    });
  };

  const handleManage = () => {
    setRedirecting(true);
    startTransition(async () => {
      try {
        const url = await createPortalSession();
        window.location.href = url;
      } catch { setRedirecting(false); }
    });
  };

  const fmtDate = (d: string | null) => {
    if (!d) return "\u2014";
    return new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  };

  const planLabel = (plan: string) => {
    switch (plan) { case "builder": return "Builder"; case "pro": return "Pro"; case "platform": return "Platform"; default: return "Free"; }
  };

  const planPrice = (plan: string) => {
    switch (plan) { case "builder": return "$19/mo"; case "pro": return "$49/mo"; case "platform": return "$149/mo"; default: return "$0/mo"; }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="grid grid-cols-2" style={{ gap: 16 }}>
        {/* Current Plan */}
        <div className="card">
          <div className="section-label" style={{ marginBottom: 12 }}>Current Plan</div>
          <div className="flex items-center gap-3" style={{ marginBottom: 12 }}>
            <span className="font-mono" style={{ fontSize: 28, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
              {planLabel(billing.plan)}
            </span>
            <span className={"badge " + (isFree ? "badge-blue" : "badge-green")}>{planPrice(billing.plan)}</span>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            {isFree ? "500 transactions per month." : "Unlimited transactions. All features unlocked."}
          </p>
        </div>

        {/* Usage */}
        <div className="card">
          <div className="section-label" style={{ marginBottom: 12 }}>Monthly Usage</div>
          <div className="flex items-baseline gap-2" style={{ marginBottom: 12 }}>
            <span className="font-mono" style={{ fontSize: 28, fontWeight: 600, color: pct >= 100 ? "var(--negative)" : "var(--text-primary)", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
              {billing.usage.count.toLocaleString()}
            </span>
            <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
              {billing.usage.limit != null ? `/ ${billing.usage.limit.toLocaleString()} transactions` : "transactions (unlimited)"}
            </span>
          </div>
          {billing.usage.limit != null && (
            <div style={{ width: "100%", height: 6, borderRadius: 3, backgroundColor: "var(--border)", overflow: "hidden", marginBottom: 12 }}>
              <div style={{ width: pct + "%", height: "100%", borderRadius: 3, backgroundColor: barColor, transition: "width 600ms ease" }} />
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Resets on {fmtDate(billing.nextResetDate)}</div>
        </div>
      </div>

      {/* Pending notice */}
      {billing.pendingTransactions > 0 && (
        <div style={{ borderRadius: 8, padding: "16px 20px", backgroundColor: "var(--surface-2)", border: "1px solid #D97706" }}>
          <div className="flex items-center gap-3">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="10" cy="10" r="8" /><path d="M10 6.5v4" /><circle cx="10" cy="13.5" r="0.5" fill="#D97706" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#D97706" }}>
              {billing.pendingTransactions} transaction{billing.pendingTransactions !== 1 ? "s" : ""} queued
            </span>
          </div>
        </div>
      )}

      {/* Action card */}
      <div className="card">
        {isFree ? (
          <div>
            <div className="section-label" style={{ marginBottom: 12 }}>Upgrade</div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 20 }}>
              Get unlimited transactions, instant posting, and bank feed integration.
            </p>
            <button className="btn-primary" onClick={handleUpgrade} disabled={isPending || redirecting}>
              {redirecting ? "Redirecting to Stripe..." : "Upgrade to Builder \u2014 $19/month"}
            </button>
          </div>
        ) : (
          <div>
            <div className="section-label" style={{ marginBottom: 12 }}>Manage Subscription</div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 8 }}>
              Update payment method, view invoices, or cancel your subscription.
            </p>
            {billing.periodEnd && (
              <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 20 }}>
                Current period: {fmtDate(billing.periodStart)} {"\u2014"} {fmtDate(billing.periodEnd)}
              </p>
            )}
            <button className="btn-secondary" onClick={handleManage} disabled={isPending || redirecting}>
              {redirecting ? "Redirecting to Stripe..." : "Manage Subscription"}
            </button>
          </div>
        )}
      </div>

      {/* Plan tiers */}
      <div>
        <div className="section-label" style={{ marginBottom: 16 }}>Plans</div>
        <div className="grid grid-cols-2" style={{ gap: 12 }}>
          {PLAN_TIERS.map((tier) => {
            const isCurrent = billing.plan === tier.plan;
            const isRecommended = tier.recommended && isFree;
            return (
              <div
                key={tier.plan}
                className="card"
                style={{
                  position: "relative",
                  border: isRecommended ? "2px solid var(--accent)" : isCurrent ? "1px solid var(--border-strong)" : "1px solid var(--border)",
                  borderLeft: isCurrent ? "3px solid var(--accent)" : undefined,
                  padding: 16,
                  opacity: tier.comingSoon ? 0.6 : 1,
                }}
              >
                {isRecommended && (
                  <div
                    className="text-xs font-medium"
                    style={{
                      position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)",
                      backgroundColor: "var(--accent)", color: "white",
                      padding: "2px 12px", borderRadius: 10, whiteSpace: "nowrap",
                    }}
                  >
                    Recommended
                  </div>
                )}
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
                  {tier.name}
                </div>
                <div className="flex items-baseline gap-1" style={{ marginBottom: 12 }}>
                  <span style={{ fontSize: 22, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>{tier.price}</span>
                  <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{tier.period}</span>
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, marginBottom: 12 }}>
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2" style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 5, lineHeight: 1.5 }}>
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                        <path d="M3.5 7l2 2 5-5" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <div className="text-xs font-semibold uppercase tracking-wide" style={{ textAlign: "center", backgroundColor: "var(--surface-1)", color: "var(--accent)", border: "1px solid var(--border-strong)", borderRadius: 9999, padding: "4px 12px" }}>
                    Current plan
                  </div>
                ) : tier.comingSoon ? (
                  <div className="text-xs font-semibold uppercase tracking-wide" style={{ textAlign: "center", backgroundColor: "var(--surface-1)", color: "var(--text-tertiary)", border: "1px solid var(--border)", borderRadius: 9999, padding: "4px 12px" }}>
                    Coming soon
                  </div>
                ) : tier.plan === "builder" && isFree ? (
                  <button className="btn-primary" style={{ width: "100%", padding: "8px 0", fontSize: 12 }} onClick={handleUpgrade} disabled={isPending || redirecting}>
                    {redirecting ? "Redirecting..." : "Upgrade"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Email Tab ───────────────────────────────────────────────────────────────

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
  "Australia/Perth",
  "Pacific/Auckland",
];

const DAYS_OF_WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function EmailTab() {
  const [prefs, setPrefs] = useState<EmailPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load preferences on mount
  useState(() => {
    fetchEmailPreferences().then((data) => {
      setPrefs(data);
      setLoading(false);
    });
  });

  const handleToggle = async (key: keyof EmailPreferences, value: boolean) => {
    if (!prefs) return;
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    setSaving(true);
    await updateEmailPreferences({ [key]: value });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSelect = async (key: "timezone" | "digestDay", value: string) => {
    if (!prefs) return;
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    setSaving(true);
    await updateEmailPreferences({ [key]: value });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <p style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Loading email preferences...</p>
      </div>
    );
  }

  if (!prefs) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", marginBottom: 4 }}>No email preferences found</p>
        <p style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Email preferences will be created automatically on your next sign-in.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Save indicator */}
      {(saving || saved) && (
        <div style={{
          position: "fixed", top: 16, right: 16, zIndex: 50,
          padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 500,
          backgroundColor: saved ? "rgba(34, 197, 94, 0.08)" : "var(--surface-2)",
          color: saved ? "var(--positive)" : "var(--text-tertiary)",
          border: `1px solid ${saved ? "rgba(34, 197, 94, 0.25)" : "var(--border)"}`,
          transition: "all 200ms ease",
        }}>
          {saving ? "Saving..." : "Saved"}
        </div>
      )}

      {/* Email notifications */}
      <div className="card">
        <div className="section-label" style={{ marginBottom: 16 }}>Notifications</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ToggleRow
            label="Weekly digest"
            description="Financial summary sent on your chosen day"
            checked={prefs.weeklyDigest}
            onChange={(v) => handleToggle("weeklyDigest", v)}
          />
          <ToggleRow
            label="Monthly close reminder"
            description="Prompt to close your books on the 1st of each month"
            checked={prefs.monthlyClose}
            onChange={(v) => handleToggle("monthlyClose", v)}
          />
          <ToggleRow
            label="Urgent alerts"
            description="Large transactions, failed bank connections, low cash"
            checked={prefs.urgentAlerts}
            onChange={(v) => handleToggle("urgentAlerts", v)}
          />
          <ToggleRow
            label="Quarterly tax reminders"
            description="Estimated tax payment reminders each quarter"
            checked={prefs.quarterlyTax}
            onChange={(v) => handleToggle("quarterlyTax", v)}
          />
        </div>
      </div>

      {/* Schedule settings */}
      <div className="card">
        <div className="section-label" style={{ marginBottom: 16 }}>Schedule</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "var(--text-tertiary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
              Timezone
            </label>
            <select
              className="input"
              value={prefs.timezone}
              onChange={(e) => handleSelect("timezone", e.target.value)}
              style={{ fontSize: 13, width: "100%" }}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "var(--text-tertiary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
              Digest Day
            </label>
            <select
              className="input"
              value={prefs.digestDay}
              onChange={(e) => handleSelect("digestDay", e.target.value)}
              style={{ fontSize: 13, width: "100%" }}
            >
              {DAYS_OF_WEEK.map((day) => (
                <option key={day} value={day}>{day.charAt(0).toUpperCase() + day.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 12 }}>
          Digests are sent at 9:00 AM in your timezone on the selected day.
        </p>
      </div>
    </div>
  );
}

// ── Recurring Tab ─────────────────────────────────────────────────────────

interface RecurringEntryView {
  id: string;
  description: string;
  lineItems: { accountId: string; amount: number; direction: string }[];
  frequency: string;
  dayOfMonth: number | null;
  nextRunDate: string;
  lastRunDate: string | null;
  autoReverse: boolean;
  isActive: boolean;
  createdAt: string;
}

function RecurringTab() {
  const [entries, setEntries] = useState<RecurringEntryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  useState(() => {
    fetchRecurringEntries().then((data) => {
      setEntries(data as RecurringEntryView[]);
      setLoading(false);
    });
  });

  const fmtAmount = (items: RecurringEntryView["lineItems"]) => {
    const total = items.filter(l => l.direction === "debit").reduce((s, l) => s + l.amount, 0);
    return "$" + (total / 100).toFixed(2);
  };

  const fmtFreq = (f: string) => f.charAt(0).toUpperCase() + f.slice(1);

  const handlePauseResume = (entry: RecurringEntryView) => {
    startTransition(async () => {
      if (entry.isActive) {
        await pauseRecurringEntryAction(entry.id);
      } else {
        await resumeRecurringEntryAction(entry.id);
      }
      const updated = await fetchRecurringEntries();
      setEntries(updated as RecurringEntryView[]);
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      await deleteRecurringEntryAction(id);
      const updated = await fetchRecurringEntries();
      setEntries(updated as RecurringEntryView[]);
    });
  };

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <p style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Loading recurring entries...</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Recurring Entries</h2>
              <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>Automated periodic journal postings</p>
            </div>
            <span style={{ fontSize: 12, color: "var(--text-tertiary)", fontWeight: 500 }}>{entries.length} entries</span>
          </div>
        </div>

        {entries.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", marginBottom: 4 }}>No recurring entries</p>
            <p style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Create recurring entries via the API, SDK, or MCP.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Description</th>
                <th className="table-header text-right">Amount</th>
                <th className="table-header">Frequency</th>
                <th className="table-header">Next Run</th>
                <th className="table-header">Status</th>
                <th className="table-header text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="table-row">
                  <td className="table-cell" style={{ fontSize: 13, fontWeight: 500 }}>
                    {entry.description}
                    {entry.autoReverse && (
                      <span style={{ fontSize: 10, color: "#D97706", marginLeft: 8, fontWeight: 600 }}>AUTO-REVERSE</span>
                    )}
                  </td>
                  <td className="table-cell text-right font-mono" style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                    {fmtAmount(entry.lineItems)}
                  </td>
                  <td className="table-cell">
                    <span className="badge badge-blue">{fmtFreq(entry.frequency)}</span>
                  </td>
                  <td className="table-cell" style={{ fontSize: 13 }}>{entry.nextRunDate}</td>
                  <td className="table-cell">
                    <span className={"badge " + (entry.isActive ? "badge-green" : "badge-red")}>
                      {entry.isActive ? "Active" : "Paused"}
                    </span>
                  </td>
                  <td className="table-cell text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className="btn-ghost"
                        style={{ fontSize: 12 }}
                        onClick={() => handlePauseResume(entry)}
                        disabled={isPending}
                      >
                        {entry.isActive ? "Pause" : "Resume"}
                      </button>
                      <button
                        className="btn-ghost"
                        style={{ fontSize: 12, color: "var(--negative)" }}
                        onClick={() => handleDelete(entry.id)}
                        disabled={isPending}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between" style={{ paddingBottom: 16, borderBottom: "1px solid var(--surface-3)" }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>{description}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        style={{
          width: 40,
          height: 22,
          borderRadius: 11,
          border: "none",
          cursor: "pointer",
          backgroundColor: checked ? "var(--accent)" : "var(--border)",
          position: "relative",
          transition: "background-color 200ms ease",
          flexShrink: 0,
        }}
      >
        <div style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: "var(--surface-1)",
          position: "absolute",
          top: 2,
          left: checked ? 20 : 2,
          transition: "left 200ms ease",
          boxShadow: "0 1px 3px rgba(0,0,0,0.24)",
        }} />
      </button>
    </div>
  );
}

// ── Connections Tab ────────────────────────────────────────────────────────

function ConnectionsTab() {
  const [connection, setConnection] = useState<StripeConnectStatus | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  useState(() => {
    fetchStripeStatus().then((s) => {
      setConnection(s);
      setLoading(false);
    }).catch(() => setLoading(false));
  });

  const handleDisconnect = () => {
    if (!confirm("Are you sure you want to disconnect your Stripe account? This will stop syncing new transactions.")) return;
    startTransition(async () => {
      const ok = await disconnectStripe();
      if (ok) setConnection(null);
    });
  };

  const handleSync = () => {
    startTransition(async () => {
      await syncStripe();
      const updated = await fetchStripeStatus();
      setConnection(updated);
    });
  };

  const handleConnect = () => {
    startTransition(async () => {
      const url = await getStripeAuthorizeUrl();
      if (url) {
        window.location.href = url;
      }
    });
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>Connections</h2>
        <p style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Connect external services to automatically import transactions.</p>
      </div>

      {/* Stripe Connect */}
      <div className="card" style={{ padding: 20 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <div className="flex items-center" style={{ gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 8,
              background: "#635BFF", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M9.2 7.2c0-.7.6-1 1.5-1 1.4 0 3.1.4 4.5 1.2V3.6C13.7 3 12.2 2.6 10.7 2.6c-3.5 0-5.8 1.8-5.8 4.9 0 4.8 6.6 4 6.6 6.1 0 .8-.7 1.1-1.7 1.1-1.5 0-3.4-.6-4.9-1.4v3.8c1.7.7 3.3 1 4.9 1 3.6 0 6-1.8 6-4.9 0-5.2-6.6-4.2-6.6-6z" fill="white"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Stripe</div>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Import charges, refunds, and payouts</div>
            </div>
          </div>
          {connection && (
            <span className="badge badge-green">Connected</span>
          )}
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Loading...</div>
        ) : connection ? (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 2 }}>Account ID</div>
                <div style={{ fontSize: 13, color: "var(--text-primary)", fontFamily: "monospace" }}>{connection.stripeAccountId}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 2 }}>Last Synced</div>
                <div style={{ fontSize: 13, color: "var(--text-primary)" }}>
                  {connection.lastSyncedAt ? formatDate(connection.lastSyncedAt) : "Never"}
                </div>
              </div>
            </div>
            <div className="flex" style={{ gap: 8 }}>
              <button
                className="btn-primary"
                style={{ fontSize: 12, height: 32, padding: "0 12px" }}
                onClick={handleSync}
                disabled={isPending}
              >
                {isPending ? "Syncing..." : "Sync Now"}
              </button>
              <button
                className="btn-ghost"
                style={{ fontSize: 12, height: 32, padding: "0 12px", color: "var(--negative)" }}
                onClick={handleDisconnect}
                disabled={isPending}
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
              Connect your Stripe account to automatically import charges, refunds, and payouts as journal entries.
            </p>
            <button
              className="btn-primary"
              style={{ fontSize: 12, height: 32, padding: "0 12px" }}
              onClick={handleConnect}
              disabled={isPending}
            >
              {isPending ? "Connecting..." : "Connect Stripe"}
            </button>
          </div>
        )}
      </div>

      {/* OAuth Connected Applications */}
      <OAuthConnectionsSection />
    </div>
  );
}

function OAuthConnectionsSection() {
  const [connections, setConnections] = useState<OAuthConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    fetchOAuthConnections().then((c) => {
      setConnections(c);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleRevoke = (clientId: string, clientName: string) => {
    if (!confirm(`Revoke access for ${clientName}? This will disconnect the application immediately.`)) return;
    startTransition(async () => {
      const ok = await revokeOAuthConnection(clientId);
      if (ok) {
        setConnections((prev) => prev.filter((c) => c.client_id !== clientId));
      }
    });
  };

  return (
    <div style={{ marginTop: 20 }}>
      <div className="card" style={{ padding: 20 }}>
        <div className="flex items-center" style={{ gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 8,
            background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="9" width="14" height="8" rx="2" />
              <path d="M7 9V6a3 3 0 0 1 6 0v3" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Connected Applications</div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Third-party apps authorized via OAuth</div>
          </div>
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Loading...</div>
        ) : connections.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            No third-party applications are connected. When you authorize an application to access your ledger, it will appear here.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {connections.map((conn) => (
              <div
                key={conn.client_id}
                className="flex items-center justify-between"
                style={{
                  padding: 12,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--surface-1)",
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginBottom: 2 }}>
                    {conn.client_name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                    {conn.scopes.join(", ")} · Connected {formatDate(conn.connected_at)}
                  </div>
                </div>
                <button
                  className="btn-ghost"
                  style={{ fontSize: 12, height: 28, padding: "0 10px", color: "var(--negative)" }}
                  onClick={() => handleRevoke(conn.client_id, conn.client_name)}
                  disabled={isPending}
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

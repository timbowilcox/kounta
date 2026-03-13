"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { formatDate } from "@/lib/format";
import { createApiKey, revokeApiKey, fetchApiKeys, createCheckoutSession, createPortalSession, fetchEmailPreferences, updateEmailPreferences, fetchRecurringEntries, deleteRecurringEntryAction, pauseRecurringEntryAction, resumeRecurringEntryAction, updateLedgerAction, reopenPeriodAction } from "@/lib/actions";
import type { EmailPreferences, ClosedPeriodSummary } from "@/lib/actions";
import { CopyButton } from "@/components/copy-button";
import type { ApiKeySafe } from "@ledge/sdk";
import type { BillingStatus } from "@/lib/actions";

// ── Types ──────────────────────────────────────────────────────────────────

type SettingsTab = "general" | "currencies" | "api-keys" | "billing" | "email" | "recurring";

interface Props {
  ledger: { name: string; currency: string; accountingBasis: string; templateId: string | null; createdAt: string };
  billing: BillingStatus;
  initialKeys: ApiKeySafe[];
  currencies: any[];
  exchangeRates: any[];
  fiscalYearStart: number;
  closedThrough: string | null;
  closedPeriods: ClosedPeriodSummary[];
}

// ── Tab config ─────────────────────────────────────────────────────────────

const TABS: { key: SettingsTab; label: string }[] = [
  { key: "general", label: "General" },
  { key: "currencies", label: "Currencies" },
  { key: "api-keys", label: "API Keys" },
  { key: "billing", label: "Billing" },
  { key: "email", label: "Email" },
  { key: "recurring", label: "Recurring" },
];

// ── Main component ─────────────────────────────────────────────────────────

export function SettingsView({ ledger, billing, initialKeys, currencies, exchangeRates, fiscalYearStart, closedThrough, closedPeriods }: Props) {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as SettingsTab) || "general";
  const [activeTab, setActiveTab] = useState<SettingsTab>(TABS.some(t => t.key === initialTab) ? initialTab : "general");

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#0A0A0A" }}>
          Settings
        </h1>
      </div>

      {/* Underline tab bar */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid #E5E5E5",
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
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "#0066FF" : "#999999",
                background: "none",
                border: "none",
                borderBottom: isActive ? "2px solid #0066FF" : "2px solid transparent",
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
      {activeTab === "currencies" && <CurrenciesTab currencies={currencies} exchangeRates={exchangeRates} />}
      {activeTab === "api-keys" && <ApiKeysTab initialKeys={initialKeys} />}
      {activeTab === "billing" && <BillingTab billing={billing} />}
      {activeTab === "email" && <EmailTab />}
      {activeTab === "recurring" && <RecurringTab />}
    </div>
  );
}

// ── General Tab ────────────────────────────────────────────────────────────

const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function GeneralTab({ ledger, fiscalYearStart, closedThrough, closedPeriods }: { ledger: Props["ledger"]; fiscalYearStart: number; closedThrough: string | null; closedPeriods: ClosedPeriodSummary[] }) {
  const { data: session } = useSession();
  const [fyStart, setFyStart] = useState(fiscalYearStart);
  const [fySaving, setFySaving] = useState(false);
  const [fySaved, setFySaved] = useState(false);
  const [periods, setPeriods] = useState(closedPeriods);
  const [reopening, setReopening] = useState<string | null>(null);

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
  const fmtPeriodEnd = (d: string) => {
    const dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Save indicator */}
      {(fySaving || fySaved) && (
        <div style={{
          position: "fixed", top: 16, right: 16, zIndex: 50,
          padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 500,
          backgroundColor: fySaved ? "#F0FDF4" : "#FAFAFA",
          color: fySaved ? "#16A34A" : "#999999",
          border: `1px solid ${fySaved ? "#BBF7D0" : "#E5E5E5"}`,
          transition: "all 200ms ease",
        }}>
          {fySaving ? "Saving..." : "Saved"}
        </div>
      )}

      {/* Account info */}
      <div className="card">
        <div className="section-label" style={{ marginBottom: 16 }}>Account</div>
        {session?.user && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {session.user.image && (
                <img
                  src={session.user.image}
                  alt=""
                  style={{ width: 40, height: 40, borderRadius: "50%", border: "1px solid #E5E5E5" }}
                />
              )}
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#0A0A0A" }}>{session.user.name}</div>
                <div style={{ fontSize: 12, color: "#999999" }}>{session.user.email}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Ledger info */}
      <div className="card">
        <div className="section-label" style={{ marginBottom: 16 }}>Ledger</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <InfoRow label="Name" value={ledger.name} />
          <InfoRow label="Template" value={ledger.templateId ?? "Custom"} />
          <InfoRow label="Currency" value={ledger.currency} />
          <InfoRow label="Accounting Basis" value={ledger.accountingBasis} />
          <InfoRow label="Created" value={formatDate(ledger.createdAt)} />
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#999999", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>
              Fiscal Year Start
            </label>
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
          </div>
        </div>
      </div>

      {/* Period Close */}
      <div className="card">
        <div className="section-label" style={{ marginBottom: 4 }}>Period Close</div>
        <p style={{ fontSize: 12, color: "#999999", marginBottom: 16 }}>
          {closedThrough
            ? `Books are closed through ${fmtPeriodEnd(closedThrough)}. No transactions can be posted on or before that date.`
            : "No periods have been closed. Close periods from the Statements page."}
        </p>

        {activePeriods.length > 0 ? (
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
                    backgroundColor: "#F9FAFB",
                    border: "1px solid #E5E5E5",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="7" width="10" height="7" rx="1.5" />
                      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
                    </svg>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "#0A0A0A" }}>
                        Through {fmtPeriodEnd(p.periodEnd)}
                      </span>
                      <span style={{ fontSize: 12, color: "#999999", marginLeft: 12 }}>
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
        ) : (
          !closedThrough && (
            <div style={{ fontSize: 13, color: "#999999", padding: "12px 0" }}>
              No closed periods to manage.
            </div>
          )
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#999999", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, color: "#0A0A0A" }}>{value}</div>
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
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E5E5E5" }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "#0A0A0A" }}>Enabled Currencies</h2>
              <p style={{ fontSize: 12, color: "#999999", marginTop: 2 }}>Currencies available for transactions</p>
            </div>
            <span style={{ fontSize: 12, color: "#999999", fontWeight: 500 }}>{currencies.length}</span>
          </div>
        </div>

        {currencies.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: "#0A0A0A", marginBottom: 4 }}>No additional currencies</p>
            <p style={{ fontSize: 13, color: "#999999" }}>Enable currencies via the API or MCP.</p>
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
                  <td className="table-cell font-mono" style={{ fontSize: 13, fontWeight: 600, color: "#0A0A0A" }}>{c.currencyCode}</td>
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
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E5E5E5" }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "#0A0A0A" }}>Exchange Rates</h2>
              <p style={{ fontSize: 12, color: "#999999", marginTop: 2 }}>Stored rates for currency conversion</p>
            </div>
            <span style={{ fontSize: 12, color: "#999999", fontWeight: 500 }}>{exchangeRates.length}</span>
          </div>
        </div>

        {exchangeRates.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: "#0A0A0A", marginBottom: 4 }}>No exchange rates</p>
            <p style={{ fontSize: 13, color: "#999999" }}>Set rates via the API or MCP.</p>
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
                  <td className="table-cell font-mono" style={{ fontSize: 12, color: "#0066FF" }}>{key.prefix}...</td>
                  <td className="table-cell" style={{ fontSize: 13 }}>{formatDate(key.createdAt)}</td>
                  <td className="table-cell" style={{ fontSize: 13 }}>{key.lastUsedAt ? formatDate(key.lastUsedAt) : "Never"}</td>
                  <td className="table-cell text-right">
                    <span className={"badge " + (key.status === "active" ? "badge-green" : "badge-red")}>{key.status}</span>
                  </td>
                  <td className="table-cell text-right">
                    {key.status === "active" && (
                      confirmRevoke === key.id ? (
                        <span className="flex items-center justify-end gap-2">
                          <span style={{ fontSize: 12, color: "#DC2626" }}>Confirm?</span>
                          <button style={{ fontSize: 12, fontWeight: 500, color: "#DC2626", background: "none", border: "none", cursor: "pointer" }} onClick={() => handleRevoke(key.id)}>Yes</button>
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
                  <td colSpan={6} className="table-cell text-center" style={{ fontSize: 13, color: "#999999", padding: 48 }}>
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
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0A0A0A" }}>MCP Connection Guide</div>
            <div style={{ fontSize: 12, color: "#999999", marginTop: 2 }}>Connect Ledge to Claude Code or Cursor</div>
          </div>
          <svg
            width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#999999" strokeWidth="1.5"
            style={{ transform: mcpExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 150ms ease" }}
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>

        {mcpExpanded && (
          <div style={{ padding: "0 20px 20px", borderTop: "1px solid #E5E5E5" }}>
            <McpGuideContent />
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
          onClick={() => { if (!createdKey) setShowCreateModal(false); }}
        >
          <div
            style={{
              width: 480,
              padding: 32,
              backgroundColor: "#FFFFFF",
              borderRadius: 8,
              border: "1px solid #E5E5E5",
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              transform: "translateY(-20px)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {!createdKey ? (
              <>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: "#0A0A0A", marginBottom: 20 }}>Create API Key</h2>
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
                <h2 style={{ fontSize: 16, fontWeight: 600, color: "#0A0A0A", marginBottom: 8 }}>Key Created</h2>
                <p style={{ fontSize: 13, color: "#D97706", marginBottom: 20 }}>
                  Copy this key now. You won&apos;t be able to see it again.
                </p>
                <div
                  className="flex items-center justify-between"
                  style={{ borderRadius: 8, padding: 16, marginBottom: 20, gap: 12, backgroundColor: "#FAFAFA", border: "1px solid #E5E5E5" }}
                >
                  <code className="font-mono" style={{ fontSize: 13, color: "#0066FF", wordBreak: "break-all" }}>{createdKey}</code>
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
    "ledge": {
      "command": "npx",
      "args": ["@ledge/mcp@latest"],
      "env": {
        "LEDGE_API_KEY": "YOUR_API_KEY_HERE",
        "LEDGE_API_URL": "http://localhost:3100"
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
    "ledge": {
      "command": "npx",
      "args": ["@ledge/mcp@latest"],
      "env": {
        "LEDGE_API_KEY": "YOUR_API_KEY_HERE",
        "LEDGE_API_URL": "http://localhost:3100"
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
              backgroundColor: activeTool === key ? "#F0F6FF" : "transparent",
              color: activeTool === key ? "#0066FF" : "#999999",
              border: activeTool === key ? "1px solid rgba(0,102,255,0.2)" : "1px solid transparent",
              cursor: "pointer",
              transition: "all 150ms ease",
            }}
          >
            {configs[key].label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: "#999999", fontWeight: 500 }}>
          <code className="font-mono" style={{ color: "#0066FF" }}>{cfg.file}</code>
        </div>
        <CopyButton text={cfg.config} label="Copy" />
      </div>
      <div
        style={{
          borderRadius: 8,
          padding: 16,
          backgroundColor: "#FAFAFA",
          border: "1px solid #E5E5E5",
        }}
      >
        <pre className="font-mono overflow-x-auto" style={{ fontSize: 12, color: "#666666", lineHeight: 1.7 }}>
          {cfg.config}
        </pre>
      </div>
    </div>
  );
}

// ── Billing Tab ────────────────────────────────────────────────────────────

function BillingTab({ billing }: { billing: BillingStatus }) {
  const [isPending, startTransition] = useTransition();
  const [redirecting, setRedirecting] = useState(false);

  const isFree = billing.plan === "free";
  const limit = billing.usage.limit ?? Infinity;
  const pct = limit === Infinity ? 0 : Math.min((billing.usage.count / limit) * 100, 100);
  const barColor = pct >= 100 ? "#DC2626" : pct >= 80 ? "#D97706" : "#0066FF";

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
            <span className="font-mono" style={{ fontSize: 28, fontWeight: 600, color: "#0A0A0A", letterSpacing: "-0.02em" }}>
              {planLabel(billing.plan)}
            </span>
            <span className={"badge " + (isFree ? "badge-blue" : "badge-green")}>{planPrice(billing.plan)}</span>
          </div>
          <p style={{ fontSize: 13, color: "#666666", lineHeight: 1.6 }}>
            {isFree ? "500 transactions per month." : "Unlimited transactions. All features unlocked."}
          </p>
        </div>

        {/* Usage */}
        <div className="card">
          <div className="section-label" style={{ marginBottom: 12 }}>Monthly Usage</div>
          <div className="flex items-baseline gap-2" style={{ marginBottom: 12 }}>
            <span className="font-mono" style={{ fontSize: 28, fontWeight: 600, color: pct >= 100 ? "#DC2626" : "#0A0A0A", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
              {billing.usage.count.toLocaleString()}
            </span>
            <span style={{ fontSize: 13, color: "#999999" }}>
              {billing.usage.limit != null ? `/ ${billing.usage.limit.toLocaleString()} transactions` : "transactions (unlimited)"}
            </span>
          </div>
          {billing.usage.limit != null && (
            <div style={{ width: "100%", height: 6, borderRadius: 3, backgroundColor: "#E5E5E5", overflow: "hidden", marginBottom: 12 }}>
              <div style={{ width: pct + "%", height: "100%", borderRadius: 3, backgroundColor: barColor, transition: "width 600ms ease" }} />
            </div>
          )}
          <div style={{ fontSize: 12, color: "#999999" }}>Resets on {fmtDate(billing.nextResetDate)}</div>
        </div>
      </div>

      {/* Pending notice */}
      {billing.pendingTransactions > 0 && (
        <div style={{ borderRadius: 8, padding: "16px 20px", backgroundColor: "#FFFBEB", border: "1px solid #FDE68A" }}>
          <div className="flex items-center gap-3">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="10" cy="10" r="8" /><path d="M10 6.5v4" /><circle cx="10" cy="13.5" r="0.5" fill="#D97706" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#92400E" }}>
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
            <p style={{ fontSize: 13, color: "#666666", lineHeight: 1.6, marginBottom: 20 }}>
              Get unlimited transactions, instant posting, and bank feed integration.
            </p>
            <button className="btn-primary" onClick={handleUpgrade} disabled={isPending || redirecting}>
              {redirecting ? "Redirecting to Stripe..." : "Upgrade to Builder \u2014 $19/month"}
            </button>
          </div>
        ) : (
          <div>
            <div className="section-label" style={{ marginBottom: 12 }}>Manage Subscription</div>
            <p style={{ fontSize: 13, color: "#666666", lineHeight: 1.6, marginBottom: 8 }}>
              Update payment method, view invoices, or cancel your subscription.
            </p>
            {billing.periodEnd && (
              <p style={{ fontSize: 12, color: "#999999", marginBottom: 20 }}>
                Current period: {fmtDate(billing.periodStart)} {"\u2014"} {fmtDate(billing.periodEnd)}
              </p>
            )}
            <button className="btn-secondary" onClick={handleManage} disabled={isPending || redirecting}>
              {redirecting ? "Redirecting to Stripe..." : "Manage Subscription"}
            </button>
          </div>
        )}
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
        <p style={{ fontSize: 13, color: "#999999" }}>Loading email preferences...</p>
      </div>
    );
  }

  if (!prefs) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <p style={{ fontSize: 14, fontWeight: 500, color: "#0A0A0A", marginBottom: 4 }}>No email preferences found</p>
        <p style={{ fontSize: 13, color: "#999999" }}>Email preferences will be created automatically on your next sign-in.</p>
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
          backgroundColor: saved ? "#F0FDF4" : "#FAFAFA",
          color: saved ? "#16A34A" : "#999999",
          border: `1px solid ${saved ? "#BBF7D0" : "#E5E5E5"}`,
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
            <label style={{ display: "block", fontSize: 12, color: "#999999", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>
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
            <label style={{ display: "block", fontSize: 12, color: "#999999", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>
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
        <p style={{ fontSize: 12, color: "#999999", marginTop: 12 }}>
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
        <p style={{ fontSize: 13, color: "#999999" }}>Loading recurring entries...</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E5E5E5" }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "#0A0A0A" }}>Recurring Entries</h2>
              <p style={{ fontSize: 12, color: "#999999", marginTop: 2 }}>Automated periodic journal postings</p>
            </div>
            <span style={{ fontSize: 12, color: "#999999", fontWeight: 500 }}>{entries.length} entries</span>
          </div>
        </div>

        {entries.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: "#0A0A0A", marginBottom: 4 }}>No recurring entries</p>
            <p style={{ fontSize: 13, color: "#999999" }}>Create recurring entries via the API, SDK, or MCP.</p>
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
                        style={{ fontSize: 12, color: "#DC2626" }}
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
    <div className="flex items-center justify-between" style={{ paddingBottom: 16, borderBottom: "1px solid #F5F5F5" }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#0A0A0A" }}>{label}</div>
        <div style={{ fontSize: 12, color: "#999999", marginTop: 2 }}>{description}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        style={{
          width: 40,
          height: 22,
          borderRadius: 11,
          border: "none",
          cursor: "pointer",
          backgroundColor: checked ? "#0066FF" : "#E5E5E5",
          position: "relative",
          transition: "background-color 200ms ease",
          flexShrink: 0,
        }}
      >
        <div style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: "#FFFFFF",
          position: "absolute",
          top: 2,
          left: checked ? 20 : 2,
          transition: "left 200ms ease",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }} />
      </button>
    </div>
  );
}

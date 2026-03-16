"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LedgerSummary, TierUsage } from "@/lib/actions";
import { switchLedgerAction, createLedgerAction } from "@/lib/actions";

// ---------------------------------------------------------------------------
// Jurisdiction data
// ---------------------------------------------------------------------------

const JURISDICTIONS = [
  { code: "AU", label: "Australia", currency: "AUD" },
  { code: "US", label: "United States", currency: "USD" },
  { code: "UK", label: "United Kingdom", currency: "GBP" },
  { code: "NZ", label: "New Zealand", currency: "NZD" },
  { code: "CA", label: "Canada", currency: "CAD" },
  { code: "SG", label: "Singapore", currency: "SGD" },
];

const TEMPLATES = [
  { slug: "saas", label: "SaaS" },
  { slug: "agency", label: "Agency" },
  { slug: "ecommerce", label: "Ecommerce" },
  { slug: "consulting", label: "Consulting" },
  { slug: "creator", label: "Creator" },
  { slug: "marketplace", label: "Marketplace" },
  { slug: "property", label: "Property" },
  { slug: "nonprofit", label: "Nonprofit" },
];

const TIER_ORDER = ["free", "builder", "pro", "platform"];
const TIER_LEDGER_LIMITS: Record<string, number | null> = {
  free: 1,
  builder: 3,
  pro: 10,
  platform: null,
};

function nextTierName(currentTier: string): string {
  const idx = TIER_ORDER.indexOf(currentTier);
  if (idx < 0 || idx >= TIER_ORDER.length - 1) return "Platform";
  const next = TIER_ORDER[idx + 1];
  return next ? next.charAt(0).toUpperCase() + next.slice(1) : "Platform";
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  ledgers: LedgerSummary[];
  activeLedgerId: string;
  currentTier?: string;
  tierUsage?: TierUsage | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LedgerSwitcher({ ledgers, activeLedgerId, currentTier = "free" }: Props) {
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const activeLedger = ledgers.find((l) => l.id === activeLedgerId) ?? ledgers[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const handleSwitch = (ledgerId: string) => {
    if (ledgerId === activeLedgerId) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const ok = await switchLedgerAction(ledgerId);
      if (ok) {
        setOpen(false);
        router.refresh();
        window.location.reload();
      }
    });
  };

  const handleNewLedger = () => {
    setOpen(false);
    const limit = TIER_LEDGER_LIMITS[currentTier] ?? null;
    if (limit !== null && ledgers.length >= limit) {
      setShowUpgrade(true);
    } else {
      setShowCreate(true);
    }
  };

  if (!activeLedger) return null;

  return (
    <>
      <div ref={ref} style={{ position: "relative" }}>
        {/* Trigger */}
        <button
          onClick={() => setOpen(!open)}
          disabled={isPending}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
            backgroundColor: open ? "var(--surface-1)" : "transparent",
            color: "var(--text-secondary)",
            fontSize: "0.8125rem",
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 150ms ease",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-1)"; e.currentTarget.style.borderColor = "var(--border-strong)"; }}
          onMouseLeave={(e) => { if (!open) { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.borderColor = "var(--border)"; } }}
        >
          <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{activeLedger.name}</span>
          <span style={{ fontSize: "0.625rem", color: "var(--text-disabled)", marginLeft: 2 }}>
            {activeLedger.currency}
          </span>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 2, transition: "transform 150ms", transform: open ? "rotate(180deg)" : "rotate(0)" }}>
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>

        {/* Dropdown */}
        {open && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              right: 0,
              minWidth: 260,
              backgroundColor: "var(--surface-2)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-dropdown)",
              border: "1px solid var(--border-strong)",
              padding: "4px",
              zIndex: 100,
            }}
          >
            {ledgers.map((l) => (
              <button
                key={l.id}
                onClick={() => handleSwitch(l.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "var(--radius-md)",
                  border: "none",
                  backgroundColor: l.id === activeLedgerId ? "rgba(59,130,246,0.08)" : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background-color 100ms",
                }}
                onMouseEnter={(e) => { if (l.id !== activeLedgerId) e.currentTarget.style.backgroundColor = "var(--surface-1)"; }}
                onMouseLeave={(e) => { if (l.id !== activeLedgerId) e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {l.name}
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "var(--text-tertiary)", marginTop: 1 }}>
                    {l.jurisdiction} &middot; {l.currency}
                  </div>
                </div>
                {l.id === activeLedgerId && (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M3.5 8.5l3 3 6-7" />
                  </svg>
                )}
              </button>
            ))}

            {/* Separator */}
            <div style={{ margin: "4px 8px", borderTop: "1px solid var(--border)" }} />

            {/* New ledger */}
            <button
              onClick={handleNewLedger}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: "100%",
                padding: "8px 12px",
                borderRadius: "var(--radius-md)",
                border: "none",
                backgroundColor: "transparent",
                cursor: "pointer",
                fontSize: "0.8125rem",
                fontWeight: 500,
                color: "var(--accent)",
                textAlign: "left",
                transition: "background-color 100ms",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-1)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v10M3 8h10" />
              </svg>
              New ledger
            </button>
          </div>
        )}
      </div>

      {/* Upgrade modal */}
      {showUpgrade && (
        <>
          <div onClick={() => setShowUpgrade(false)} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", zIndex: 200 }} />
          <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 201, width: 440 }}>
            <div style={{ backgroundColor: "var(--surface-2)", borderRadius: 12, border: "1px solid var(--border)", padding: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 8px" }}>Ledger limit reached</h3>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 20px", lineHeight: 1.5 }}>
                Your {currentTier.charAt(0).toUpperCase() + currentTier.slice(1)} plan includes{" "}
                {TIER_LEDGER_LIMITS[currentTier]} ledger{(TIER_LEDGER_LIMITS[currentTier] ?? 0) !== 1 ? "s" : ""}.
                Upgrade to {nextTierName(currentTier)} for{" "}
                {TIER_LEDGER_LIMITS[TIER_ORDER[TIER_ORDER.indexOf(currentTier) + 1] ?? "platform"] ?? "unlimited"} ledgers.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <a
                  href="/settings?tab=billing"
                  style={{
                    flex: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "8px 16px",
                    borderRadius: 8,
                    backgroundColor: "var(--accent)",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 500,
                    textDecoration: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  View plans
                </a>
                <button
                  onClick={() => setShowUpgrade(false)}
                  style={{
                    flex: 1,
                    padding: "8px 16px",
                    borderRadius: 8,
                    backgroundColor: "transparent",
                    color: "var(--text-tertiary)",
                    fontSize: 13,
                    fontWeight: 500,
                    border: "1px solid var(--border)",
                    cursor: "pointer",
                  }}
                >
                  Maybe later
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Create ledger modal */}
      {showCreate && (
        <CreateLedgerModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            router.refresh();
            window.location.reload();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Create Ledger Modal
// ---------------------------------------------------------------------------

function CreateLedgerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [jurisdiction, setJurisdiction] = useState("AU");
  const [currency, setCurrency] = useState("AUD");
  const [template, setTemplate] = useState("saas");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleJurisdictionChange = (code: string) => {
    setJurisdiction(code);
    const j = JURISDICTIONS.find((jur) => jur.code === code);
    if (j) setCurrency(j.currency);
  };

  const handleCreate = () => {
    if (!name.trim()) { setError("Ledger name is required"); return; }
    setError(null);
    startTransition(async () => {
      const result = await createLedgerAction({
        name: name.trim(),
        currency,
        jurisdiction,
        templateSlug: template,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onCreated();
    });
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-tertiary)",
    fontWeight: 500,
    marginBottom: 6,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: 36,
    padding: "0 10px",
    backgroundColor: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    color: "var(--text-primary)",
    fontSize: 13,
    boxSizing: "border-box",
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", zIndex: 200 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 201, width: 440, backgroundColor: "var(--surface-2)", borderRadius: 12, border: "1px solid var(--border)", padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 20px" }}>New ledger</h3>

        {error && (
          <div style={{ padding: "8px 12px", backgroundColor: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, marginBottom: 16, fontSize: 13, color: "#ef4444" }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Ledger name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My new ledger"
            style={inputStyle}
            autoFocus
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Jurisdiction</label>
            <select
              value={jurisdiction}
              onChange={(e) => handleJurisdictionChange(e.target.value)}
              style={{ ...inputStyle, appearance: "auto" }}
            >
              {JURISDICTIONS.map((j) => (
                <option key={j.code} value={j.code}>{j.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Currency</label>
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>Chart of accounts template</label>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            style={{ ...inputStyle, appearance: "auto" }}
          >
            {TEMPLATES.map((t) => (
              <option key={t.slug} value={t.slug}>{t.label}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onClose}
            disabled={isPending}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              backgroundColor: "transparent",
              color: "var(--text-tertiary)",
              fontSize: 13,
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isPending || !name.trim()}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              backgroundColor: isPending ? "var(--surface-1)" : "var(--accent)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 500,
              border: "none",
              cursor: isPending ? "not-allowed" : "pointer",
              opacity: isPending ? 0.7 : 1,
            }}
          >
            {isPending ? "Creating\u2026" : "Create"}
          </button>
        </div>
      </div>
    </>
  );
}

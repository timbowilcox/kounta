"use client";

import { useState, useEffect, useTransition, useCallback, useRef } from "react";
import { usePostTransaction } from "./post-transaction-provider";
import { fetchAccounts, postTransaction } from "@/lib/actions";
import { useRouter } from "next/navigation";
import type { AccountWithBalance } from "@ledge/sdk";

/* ── Types ──────────────────────────────────────────────────────────── */

interface EntryRow {
  id: string;
  accountCode: string;
  amount: string;
}

interface AccountOption {
  code: string;
  name: string;
  type: string;
}

const ACCOUNT_TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"] as const;

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  revenue: "Revenue",
  expense: "Expenses",
};

/* ── Template definitions (from/to language) ────────────────────────── */

interface QuickTemplate {
  label: string;
  from: { typeMatch: string }[];
  to: { typeMatch: string }[];
}

const QUICK_TEMPLATES: QuickTemplate[] = [
  {
    label: "Revenue received",
    from: [{ typeMatch: "revenue" }],
    to: [{ typeMatch: "asset" }],
  },
  {
    label: "Expense paid",
    from: [{ typeMatch: "asset" }],
    to: [{ typeMatch: "expense" }],
  },
  {
    label: "Invoice sent",
    from: [{ typeMatch: "revenue" }],
    to: [{ typeMatch: "asset" }],  // AR
  },
  {
    label: "Bill received",
    from: [{ typeMatch: "liability" }],  // AP
    to: [{ typeMatch: "expense" }],
  },
];

/* ── Helpers ─────────────────────────────────────────────────────────── */

let nextRowId = 1;
function makeRowId(): string {
  return `row_${nextRowId++}`;
}

function emptyRow(): EntryRow {
  return { id: makeRowId(), accountCode: "", amount: "" };
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function dollarsToCents(dollars: string): number {
  return Math.round(parseFloat(dollars) * 100);
}

function formatDollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function sumCents(rows: EntryRow[]): number {
  return rows.reduce((sum, r) => {
    if (r.amount && !isNaN(parseFloat(r.amount))) {
      return sum + dollarsToCents(r.amount);
    }
    return sum;
  }, 0);
}

/* ── Component ──────────────────────────────────────────────────────── */

export function PostTransactionModal() {
  const { isOpen, close } = usePostTransaction();
  const router = useRouter();

  // Form state — from/to model
  const [date, setDate] = useState(todayISO);
  const [memo, setMemo] = useState("");
  const [fromRows, setFromRows] = useState<EntryRow[]>([emptyRow()]);
  const [toRows, setToRows] = useState<EntryRow[]>([emptyRow()]);

  // Accounts
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

  // Submit
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Dropdown search
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [dropdownSearch, setDropdownSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Load accounts when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setAccountsLoading(true);
    fetchAccounts()
      .then((accts) => {
        setAccounts(
          accts.map((a: AccountWithBalance) => ({
            code: a.code,
            name: a.name,
            type: a.type,
          })),
        );
      })
      .catch(() => setAccounts([]))
      .finally(() => setAccountsLoading(false));
  }, [isOpen]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setDate(todayISO());
      setMemo("");
      setFromRows([emptyRow()]);
      setToRows([emptyRow()]);
      setError(null);
      setSuccessMsg(null);
      setOpenDropdownId(null);
      setDropdownSearch("");
    }
  }, [isOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!openDropdownId) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdownId(null);
        setDropdownSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openDropdownId]);

  // Escape key closes modal
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, close]);

  /* ── Row helpers ────────────────────────────────────────────────────── */

  const updateRow = useCallback(
    (section: "from" | "to", id: string, patch: Partial<EntryRow>) => {
      const setter = section === "from" ? setFromRows : setToRows;
      setter((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [],
  );

  const removeRow = useCallback(
    (section: "from" | "to", id: string) => {
      const setter = section === "from" ? setFromRows : setToRows;
      setter((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
    },
    [],
  );

  const addRow = useCallback((section: "from" | "to") => {
    const setter = section === "from" ? setFromRows : setToRows;
    setter((prev) => [...prev, emptyRow()]);
  }, []);

  /* ── Quick templates ───────────────────────────────────────────────── */

  const applyTemplate = useCallback(
    (template: QuickTemplate) => {
      const newFromRows = template.from.map((tpl) => {
        const match = accounts.find((a) => a.type === tpl.typeMatch);
        return { id: makeRowId(), accountCode: match?.code ?? "", amount: "" };
      });
      const newToRows = template.to.map((tpl) => {
        const match = accounts.find((a) => a.type === tpl.typeMatch);
        return { id: makeRowId(), accountCode: match?.code ?? "", amount: "" };
      });
      setFromRows(newFromRows);
      setToRows(newToRows);
      setMemo("");
    },
    [accounts],
  );

  /* ── Validation ────────────────────────────────────────────────────── */

  const totalFrom = sumCents(fromRows);
  const totalTo = sumCents(toRows);
  const isBalanced = totalFrom === totalTo && totalFrom > 0;
  const difference = Math.abs(totalFrom - totalTo);

  const allFromFilled = fromRows.every(
    (r) => r.accountCode && r.amount && parseFloat(r.amount) > 0,
  );
  const allToFilled = toRows.every(
    (r) => r.accountCode && r.amount && parseFloat(r.amount) > 0,
  );

  const isValid =
    memo.trim().length > 0 &&
    fromRows.length >= 1 &&
    toRows.length >= 1 &&
    allFromFilled &&
    allToFilled &&
    isBalanced;

  /* ── Submit ────────────────────────────────────────────────────────── */

  const handleSubmit = () => {
    if (!isValid) return;
    setError(null);

    // Convert from/to into API line items:
    // "from" accounts → credits (money comes from here)
    // "to" accounts → debits (money goes to here)
    const lines = [
      ...fromRows.map((r) => ({
        accountCode: r.accountCode,
        amount: dollarsToCents(r.amount),
        direction: "credit" as const,
      })),
      ...toRows.map((r) => ({
        accountCode: r.accountCode,
        amount: dollarsToCents(r.amount),
        direction: "debit" as const,
      })),
    ];

    startTransition(async () => {
      try {
        await postTransaction({ date, memo: memo.trim(), lines });
        setSuccessMsg("Transaction posted successfully");
        setTimeout(() => {
          close();
          router.refresh();
        }, 800);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to post transaction";
        setError(msg);
      }
    });
  };

  /* ── Account grouping for dropdown ─────────────────────────────────── */

  const filteredAccounts = dropdownSearch
    ? accounts.filter(
        (a) =>
          a.code.toLowerCase().includes(dropdownSearch.toLowerCase()) ||
          a.name.toLowerCase().includes(dropdownSearch.toLowerCase()),
      )
    : accounts;

  const groupedAccounts = ACCOUNT_TYPE_ORDER.reduce<Record<string, AccountOption[]>>(
    (groups, type) => {
      const items = filteredAccounts.filter((a) => a.type === type);
      if (items.length > 0) groups[type] = items;
      return groups;
    },
    {},
  );

  /* ── Shared row renderer ───────────────────────────────────────────── */

  const renderRow = (section: "from" | "to", row: EntryRow, rows: EntryRow[]) => (
    <div key={row.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {/* Account dropdown */}
      <div style={{ flex: 1, position: "relative" }} ref={openDropdownId === row.id ? dropdownRef : undefined}>
        <button
          onClick={() => {
            setOpenDropdownId(openDropdownId === row.id ? null : row.id);
            setDropdownSearch("");
          }}
          style={{
            width: "100%",
            height: 36,
            padding: "0 12px",
            borderRadius: 8,
            border: "1px solid #E5E5E5",
            backgroundColor: "#FFFFFF",
            fontSize: 13,
            color: row.accountCode ? "#0A0A0A" : "#999999",
            textAlign: "left",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {row.accountCode ? (
            <>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#999999" }}>
                {row.accountCode}
              </span>
              <span>{accounts.find((a) => a.code === row.accountCode)?.name ?? ""}</span>
            </>
          ) : (
            "Select account..."
          )}
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none"
            style={{ marginLeft: "auto", flexShrink: 0 }}
          >
            <path d="M3 5l3 3 3-3" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Dropdown panel */}
        {openDropdownId === row.id && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              width: "100%",
              minWidth: 280,
              maxHeight: 240,
              overflowY: "auto",
              backgroundColor: "#FFFFFF",
              border: "1px solid #E5E5E5",
              borderRadius: 8,
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              zIndex: 1010,
              padding: 4,
            }}
          >
            <div style={{ padding: "4px 4px 8px" }}>
              <input
                type="text"
                className="input"
                placeholder="Search accounts..."
                value={dropdownSearch}
                onChange={(e) => setDropdownSearch(e.target.value)}
                autoFocus
                style={{ height: 32, fontSize: 12 }}
              />
            </div>
            {accountsLoading ? (
              <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: "#999999" }}>Loading...</div>
            ) : (
              Object.entries(groupedAccounts).map(([type, items]) => (
                <div key={type}>
                  <div style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "#999999",
                    fontWeight: 500,
                    padding: "8px 8px 4px",
                  }}>
                    {ACCOUNT_TYPE_LABELS[type] ?? type}
                  </div>
                  {items.map((acct) => (
                    <button
                      key={acct.code}
                      onClick={() => {
                        updateRow(section, row.id, { accountCode: acct.code });
                        setOpenDropdownId(null);
                        setDropdownSearch("");
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: "none",
                        backgroundColor: row.accountCode === acct.code ? "#F0F6FF" : "transparent",
                        fontSize: 13,
                        color: "#0A0A0A",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                      onMouseEnter={(e) => {
                        if (row.accountCode !== acct.code) e.currentTarget.style.backgroundColor = "#F5F5F5";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = row.accountCode === acct.code ? "#F0F6FF" : "transparent";
                      }}
                    >
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#999999", minWidth: 40 }}>
                        {acct.code}
                      </span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {acct.name}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
            {!accountsLoading && filteredAccounts.length === 0 && (
              <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: "#999999" }}>No accounts found</div>
            )}
          </div>
        )}
      </div>

      {/* Amount */}
      <div style={{ width: 110 }}>
        <input
          type="number"
          className="input font-mono"
          placeholder="0.00"
          value={row.amount}
          onChange={(e) => updateRow(section, row.id, { amount: e.target.value })}
          min="0"
          step="0.01"
          style={{ fontSize: 13, textAlign: "right" }}
        />
      </div>

      {/* Remove */}
      <button
        onClick={() => removeRow(section, row.id)}
        disabled={rows.length <= 1}
        style={{
          width: 28,
          height: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
          border: "none",
          backgroundColor: "transparent",
          color: rows.length <= 1 ? "#E5E5E5" : "#999999",
          cursor: rows.length <= 1 ? "default" : "pointer",
          fontSize: 16,
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          if (rows.length > 1) { e.currentTarget.style.backgroundColor = "#FEF2F2"; e.currentTarget.style.color = "#DC2626"; }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = rows.length <= 1 ? "#E5E5E5" : "#999999";
        }}
      >
        ✕
      </button>
    </div>
  );

  const renderAddButton = (section: "from" | "to") => (
    <button
      onClick={() => addRow(section)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: 0,
        border: "none",
        backgroundColor: "transparent",
        fontSize: 12,
        fontWeight: 500,
        color: "#999999",
        cursor: "pointer",
        marginTop: 4,
        transition: "color 150ms ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "#0066FF"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "#999999"; }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M6 2v8M2 6h8" />
      </svg>
      Add account
    </button>
  );

  /* ── Render ────────────────────────────────────────────────────────── */

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(4px)",
          zIndex: 1000,
          animation: "modal-fade-in 150ms ease",
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1001,
          pointerEvents: "none",
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            pointerEvents: "auto",
            width: "100%",
            maxWidth: 560,
            maxHeight: "calc(100vh - 64px)",
            overflowY: "auto",
            backgroundColor: "#FFFFFF",
            borderRadius: 8,
            border: "1px solid #E5E5E5",
            boxShadow: "0 4px 24px rgba(0, 0, 0, 0.12)",
            padding: 24,
            animation: "modal-slide-up 200ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "#0A0A0A" }}>Post Transaction</h2>
            <button
              onClick={close}
              style={{
                width: 28,
                height: 28,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 6,
                border: "none",
                backgroundColor: "transparent",
                color: "#999999",
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#F5F5F5"; e.currentTarget.style.color = "#0A0A0A"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#999999"; }}
            >
              ✕
            </button>
          </div>

          {/* Date + Description */}
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, marginBottom: 20 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "#999999", fontWeight: 500, marginBottom: 6 }}>
                Date
              </label>
              <input
                type="date"
                className="input font-mono"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "#999999", fontWeight: 500, marginBottom: 6 }}>
                Description
              </label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Monthly hosting payment"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                style={{ fontSize: 13 }}
              />
            </div>
          </div>

          {/* Quick templates */}
          {accounts.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: "#999999", fontWeight: 500, marginBottom: 8 }}>
                Quick Entry
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {QUICK_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.label}
                    onClick={() => applyTemplate(tpl)}
                    style={{
                      padding: "4px 12px",
                      height: 28,
                      borderRadius: 6,
                      border: "1px solid #E5E5E5",
                      backgroundColor: "#FFFFFF",
                      fontSize: 12,
                      fontWeight: 500,
                      color: "#666666",
                      cursor: "pointer",
                      transition: "all 150ms ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "rgba(0,102,255,0.3)";
                      e.currentTarget.style.backgroundColor = "#F0F6FF";
                      e.currentTarget.style.color = "#0066FF";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "#E5E5E5";
                      e.currentTarget.style.backgroundColor = "#FFFFFF";
                      e.currentTarget.style.color = "#666666";
                    }}
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* From section */}
          <div style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              fontWeight: 500,
              marginBottom: 8,
              color: "#999999",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#999999" strokeWidth="1.5" strokeLinecap="round">
                <path d="M11 7H3M6 4L3 7l3 3" />
              </svg>
              From
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {fromRows.map((row) => renderRow("from", row, fromRows))}
            </div>
            {renderAddButton("from")}
          </div>

          {/* Arrow divider */}
          <div style={{ display: "flex", justifyContent: "center", margin: "4px 0 12px", color: "#D4D4D4" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M8 3v10M5 10l3 3 3-3" />
            </svg>
          </div>

          {/* To section */}
          <div style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              fontWeight: 500,
              marginBottom: 8,
              color: "#999999",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#999999" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 7h8M8 4l3 3-3 3" />
              </svg>
              To
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {toRows.map((row) => renderRow("to", row, toRows))}
            </div>
            {renderAddButton("to")}
          </div>

          {/* Balance indicator */}
          <div
            style={{
              padding: "12px 16px",
              borderRadius: 8,
              backgroundColor: "#FAFAFA",
              border: "1px solid #E5E5E5",
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", gap: 20, fontSize: 13 }}>
              <span>
                <span style={{ color: "#999999", fontWeight: 500, marginRight: 4 }}>From:</span>
                <span className="font-mono" style={{ fontWeight: 600, color: "#0A0A0A" }}>{formatDollars(totalFrom)}</span>
              </span>
              <span>
                <span style={{ color: "#999999", fontWeight: 500, marginRight: 4 }}>To:</span>
                <span className="font-mono" style={{ fontWeight: 600, color: "#0A0A0A" }}>{formatDollars(totalTo)}</span>
              </span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>
              {totalFrom === 0 && totalTo === 0 ? (
                <span style={{ color: "#999999" }}>—</span>
              ) : isBalanced ? (
                <span style={{ color: "#00A854" }}>Balanced ✓</span>
              ) : (
                <span style={{ color: "#DC2626" }}>Difference: {formatDollars(difference)}</span>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              padding: "10px 14px",
              borderRadius: 8,
              backgroundColor: "#FEF2F2",
              border: "1px solid #FECACA",
              fontSize: 13,
              color: "#DC2626",
              marginBottom: 16,
            }}>
              {error}
            </div>
          )}

          {/* Success toast */}
          {successMsg && (
            <div style={{
              padding: "10px 14px",
              borderRadius: 8,
              backgroundColor: "#F0FDF4",
              border: "1px solid #BBF7D0",
              fontSize: 13,
              color: "#00A854",
              fontWeight: 500,
              marginBottom: 16,
            }}>
              {successMsg}
            </div>
          )}

          {/* Footer */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn-secondary" onClick={close} style={{ fontSize: 13 }}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={handleSubmit}
              disabled={!isValid || isPending}
              style={{
                fontSize: 13,
                opacity: !isValid || isPending ? 0.5 : 1,
                cursor: !isValid || isPending ? "not-allowed" : "pointer",
              }}
            >
              {isPending ? "Posting..." : "Post Transaction"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

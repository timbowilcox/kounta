'use client';

// ---------------------------------------------------------------------------
// Add Asset Modal — fixed asset creation with capitalisation check and
// jurisdiction-aware depreciation schedule preview.
// Extracted from fixed-assets-view.tsx.
// ---------------------------------------------------------------------------

import { useState, useEffect, useTransition, useRef, useCallback } from 'react';
import { formatCurrency, formatDate } from '@/lib/format';
import {
  createFixedAssetAction,
  capitalisationCheckAction,
} from '@/lib/actions';
import type { CapitalisationCheckResult } from '@/lib/actions';
import type { AccountWithBalance } from '@kounta/sdk';
import { usePostTransaction } from '@/components/post-transaction-provider';
import type { TransactionPrefill } from '@/components/post-transaction-provider';
import {
  ASSET_TYPES_BY_JURISDICTION,
  TAX_AUTHORITY,
  DEPRECIATION_METHODS_BY_JURISDICTION,
  DEFAULT_METHODS,
  formatAssetTypeLabel,
  todayISO,
  dollarsToCents,
  labelStyle,
} from './_shared';
import type { SchedulePreviewRow } from './_shared';

export function AddAssetModal({
  isOpen,
  onClose,
  onCreated,
  accounts,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  accounts: AccountWithBalance[];
}) {
  const { openWithPrefill } = usePostTransaction();

  // Form state — initial fields
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState("");
  const [costDollars, setCostDollars] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayISO);

  // Capitalisation check
  const [capCheck, setCapCheck] = useState<CapitalisationCheckResult | null>(null);
  const [capLoading, setCapLoading] = useState(false);
  const [showDepreciationFields, setShowDepreciationFields] = useState(false);

  // Depreciation fields
  const [depMethod, setDepMethod] = useState("");
  const [usefulLifeMonths, setUsefulLifeMonths] = useState("");
  const [salvageDollars, setSalvageDollars] = useState("0");

  // Account selection
  const [assetAccountId, setAssetAccountId] = useState("");
  const [accumAccountId, setAccumAccountId] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");

  // Account dropdown state
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownSearch, setDropdownSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Schedule preview
  const [schedulePreview, setSchedulePreview] = useState<SchedulePreviewRow[] | null>(null);

  // Submit state
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Jurisdiction — detect from ledger context (cap check returns it)
  const jurisdiction = capCheck?.jurisdiction ?? "AU";
  const assetTypes = ASSET_TYPES_BY_JURISDICTION[jurisdiction] ?? ASSET_TYPES_BY_JURISDICTION["AU"]!;
  const depMethods = DEPRECIATION_METHODS_BY_JURISDICTION[jurisdiction] ?? DEPRECIATION_METHODS_BY_JURISDICTION["AU"]!;
  const taxAuth = TAX_AUTHORITY[jurisdiction] ?? "Tax Authority";

  // Debounced capitalisation check
  const capCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runCapCheck = useCallback(async (cost: string, type: string, date: string) => {
    if (!cost || !type || parseFloat(cost) <= 0) {
      setCapCheck(null);
      return;
    }
    setCapLoading(true);
    try {
      const result = await capitalisationCheckAction({
        amount: dollarsToCents(cost),
        asset_type: type,
        purchase_date: date,
      });
      setCapCheck(result);
      if (result) {
        if (result.recommendation === "capitalise" || result.recommendation === "consider_section_179") {
          setShowDepreciationFields(true);
          if (result.suggestedMethod && !depMethod) {
            setDepMethod(result.suggestedMethod);
          }
          if (result.suggestedLifeYears && !usefulLifeMonths) {
            setUsefulLifeMonths(String(Math.round(result.suggestedLifeYears * 12)));
          }
        } else {
          setShowDepreciationFields(false);
        }
      }
    } catch {
      // Silent failure — advisory is non-critical
    } finally {
      setCapLoading(false);
    }
  }, [depMethod, usefulLifeMonths]);

  // Trigger cap check when cost + asset type change
  useEffect(() => {
    if (capCheckTimer.current) clearTimeout(capCheckTimer.current);
    if (costDollars && assetType && parseFloat(costDollars) > 0) {
      capCheckTimer.current = setTimeout(() => {
        runCapCheck(costDollars, assetType, purchaseDate);
      }, 500);
    } else {
      setCapCheck(null);
    }
    return () => {
      if (capCheckTimer.current) clearTimeout(capCheckTimer.current);
    };
  }, [costDollars, assetType, purchaseDate, runCapCheck]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!openDropdown) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
        setDropdownSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openDropdown]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setName("");
      setAssetType("");
      setCostDollars("");
      setPurchaseDate(todayISO());
      setCapCheck(null);
      setCapLoading(false);
      setShowDepreciationFields(false);
      setDepMethod("");
      setUsefulLifeMonths("");
      setSalvageDollars("0");
      setAssetAccountId("");
      setAccumAccountId("");
      setExpenseAccountId("");
      setSchedulePreview(null);
      setError(null);
      setSuccessMsg(null);
      setOpenDropdown(null);
      setDropdownSearch("");
    }
  }, [isOpen]);

  // Auto-select accounts based on code patterns
  useEffect(() => {
    if (!isOpen) return;
    // TODO: This filters by account code range which works for all built-in
    // templates but will break for users with custom chart of accounts numbering.
    // When custom CoA editing lands, filter by account type/subtype instead of code prefix.
    if (!assetAccountId) {
      const match = accounts.find((a) => a.type === "asset" && /^15/.test(a.code));
      if (match) setAssetAccountId(match.id);
    }
    // TODO: This filters by account code range which works for all built-in
    // templates but will break for users with custom chart of accounts numbering.
    // When custom CoA editing lands, filter by account type/subtype instead of code prefix.
    if (!accumAccountId) {
      const match = accounts.find((a) => a.type === "asset" && a.normalBalance === "credit" && /^15|^16/.test(a.code));
      if (match) setAccumAccountId(match.id);
    }
    // TODO: This filters by account code range which works for all built-in
    // templates but will break for users with custom chart of accounts numbering.
    // When custom CoA editing lands, filter by account type/subtype instead of code prefix.
    if (!expenseAccountId) {
      const match = accounts.find((a) => a.type === "expense" && /^6[0-4]/.test(a.code) && /depreciation/i.test(a.name));
      if (match) setExpenseAccountId(match.id);
    }
  }, [isOpen, accounts, assetAccountId, accumAccountId, expenseAccountId]);

  // Schedule preview — fetch when depreciation fields are complete
  useEffect(() => {
    if (!showDepreciationFields || !depMethod || !usefulLifeMonths || !costDollars) {
      setSchedulePreview(null);
      return;
    }
    const costCents = dollarsToCents(costDollars);
    const salvageCents = dollarsToCents(salvageDollars || "0");
    if (costCents <= 0) return;

    // Fetch the full asset (with schedule) via a temporary creation call isn't ideal.
    // Instead we'll show a simplified client-side preview.
    const months = parseInt(usefulLifeMonths, 10);
    if (!months || months <= 0) return;

    const depreciable = costCents - salvageCents;
    if (depreciable <= 0) return;

    const previewPeriods: SchedulePreviewRow[] = [];
    const maxShow = Math.min(months, 12);
    const monthlyAmount = Math.floor(depreciable / months);
    let accumulated = 0;
    let nbv = costCents;

    const startDate = new Date(purchaseDate + "T00:00:00Z");
    const taxYearStart = jurisdiction === "AU" ? 7 : jurisdiction === "UK" || jurisdiction === "NZ" ? 4 : 1;

    for (let i = 1; i <= maxShow; i++) {
      const periodDate = new Date(startDate.getTime());
      periodDate.setUTCMonth(periodDate.getUTCMonth() + i);

      let amount = monthlyAmount;
      if (i === months) {
        // Last period absorbs remainder
        amount = depreciable - accumulated;
      }
      if (nbv - amount < salvageCents) {
        amount = nbv - salvageCents;
      }
      if (amount <= 0) break;

      accumulated += amount;
      nbv -= amount;

      // Financial year label
      let fy: string;
      if (taxYearStart === 1) {
        fy = String(periodDate.getUTCFullYear());
      } else {
        const fyStartThisYear = new Date(Date.UTC(periodDate.getUTCFullYear(), taxYearStart - 1, 1));
        if (periodDate >= fyStartThisYear) {
          fy = `${periodDate.getUTCFullYear()}-${String(periodDate.getUTCFullYear() + 1).slice(2)}`;
        } else {
          fy = `${periodDate.getUTCFullYear() - 1}-${String(periodDate.getUTCFullYear()).slice(2)}`;
        }
      }

      previewPeriods.push({
        periodDate: periodDate.toISOString().slice(0, 10),
        periodNumber: i,
        financialYear: fy,
        depreciationAmount: amount,
        accumulatedDepreciation: accumulated,
        netBookValue: nbv,
      });
    }

    setSchedulePreview(previewPeriods);
  }, [showDepreciationFields, depMethod, usefulLifeMonths, costDollars, salvageDollars, purchaseDate, jurisdiction]);

  // Validation
  const isValid =
    name.trim().length > 0 &&
    assetType.length > 0 &&
    parseFloat(costDollars) > 0 &&
    purchaseDate.length > 0 &&
    (showDepreciationFields
      ? depMethod.length > 0 &&
        parseInt(usefulLifeMonths, 10) > 0 &&
        assetAccountId.length > 0
      : true);

  // Submit
  const handleSubmit = () => {
    if (!isValid) return;
    setError(null);

    startTransition(async () => {
      try {
        const costCents = dollarsToCents(costDollars);
        const salvageCents = dollarsToCents(salvageDollars || "0");

        const actionResult = await createFixedAssetAction({
          name: name.trim(),
          assetType,
          costAmount: costCents,
          purchaseDate,
          depreciationMethod: showDepreciationFields ? depMethod : (capCheck?.recommendation === "instant_writeoff" ? "instant_writeoff" : capCheck?.suggestedMethod),
          usefulLifeMonths: showDepreciationFields ? parseInt(usefulLifeMonths, 10) : undefined,
          salvageValue: showDepreciationFields ? salvageCents : undefined,
          assetAccountId: assetAccountId || accounts.find((a) => a.type === "asset" && /^15/.test(a.code))?.id || accounts.find((a) => a.type === "asset")?.id || "",
          accumulatedDepreciationAccountId: accumAccountId || undefined,
          depreciationExpenseAccountId: expenseAccountId || undefined,
        });

        if (!actionResult.ok) {
          setError(actionResult.error.type === "tier_limit"
            ? `${actionResult.error.message}. Upgrade your plan to continue.`
            : actionResult.error.message);
          return;
        }

        if (!actionResult.data) {
          setError("Failed to create asset. Check all fields and try again.");
          return;
        }

        setSuccessMsg("Asset created successfully");
        setTimeout(() => {
          onCreated();
          onClose();
        }, 800);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to create asset");
      }
    });
  };

  // Account dropdown renderer
  const renderAccountDropdown = (
    fieldId: string,
    value: string,
    onChange: (id: string) => void,
    filterFn: (a: AccountWithBalance) => boolean,
  ) => {
    const filtered = dropdownSearch
      ? accounts.filter(filterFn).filter(
          (a) =>
            a.code.toLowerCase().includes(dropdownSearch.toLowerCase()) ||
            a.name.toLowerCase().includes(dropdownSearch.toLowerCase()),
        )
      : accounts.filter(filterFn);

    const selectedAcct = accounts.find((a) => a.id === value);

    return (
      <div style={{ position: "relative" }} ref={openDropdown === fieldId ? dropdownRef : undefined}>
        <button
          onClick={() => {
            setOpenDropdown(openDropdown === fieldId ? null : fieldId);
            setDropdownSearch("");
          }}
          style={{
            width: "100%",
            height: 36,
            padding: "0 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            backgroundColor: "var(--surface-2)",
            fontSize: 13,
            color: selectedAcct ? "var(--text-primary)" : "var(--text-tertiary)",
            textAlign: "left",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {selectedAcct ? (
            <>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-tertiary)" }}>
                {selectedAcct.code}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{selectedAcct.name}</span>
            </>
          ) : (
            "Select account..."
          )}
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none"
            style={{ marginLeft: "auto", flexShrink: 0 }}
          >
            <path d="M3 5l3 3 3-3" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {openDropdown === fieldId && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              width: "100%",
              minWidth: 280,
              maxHeight: 200,
              overflowY: "auto",
              backgroundColor: "var(--surface-2)",
              border: "1px solid var(--border-strong)",
              borderRadius: 8,
              boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
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
            {filtered.length === 0 ? (
              <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: "var(--text-tertiary)" }}>No accounts found</div>
            ) : (
              filtered.map((acct) => (
                <button
                  key={acct.id}
                  onClick={() => {
                    onChange(acct.id);
                    setOpenDropdown(null);
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
                    backgroundColor: value === acct.id ? "var(--surface-3)" : "transparent",
                    fontSize: 13,
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) => {
                    if (value !== acct.id) e.currentTarget.style.backgroundColor = "var(--surface-3)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = value === acct.id ? "var(--surface-3)" : "transparent";
                  }}
                >
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-tertiary)", minWidth: 40 }}>
                    {acct.code}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {acct.name}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.6)",
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
            maxWidth: 620,
            maxHeight: "calc(100vh - 64px)",
            overflowY: "auto",
            backgroundColor: "var(--surface-1)",
            borderRadius: 8,
            border: "1px solid var(--border-strong)",
            boxShadow: "0 24px 80px rgba(0, 0, 0, 0.5)",
            padding: 24,
            animation: "modal-slide-up 200ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Add Fixed Asset</h2>
            <button
              onClick={onClose}
              style={{
                width: 28,
                height: 28,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 6,
                border: "none",
                backgroundColor: "transparent",
                color: "var(--text-tertiary)",
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-3)"; e.currentTarget.style.color = "var(--text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--text-tertiary)"; }}
            >
              ✕
            </button>
          </div>

          {/* Asset Name */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Asset Name</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. MacBook Pro 16-inch"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ fontSize: 13 }}
            />
          </div>

          {/* Asset Type + Cost — side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Asset Type</label>
              <select
                className="input"
                value={assetType}
                onChange={(e) => setAssetType(e.target.value)}
                style={{ fontSize: 13, width: "100%", cursor: "pointer" }}
              >
                <option value="">Select type...</option>
                {assetTypes.map((t) => (
                  <option key={t} value={t}>{formatAssetTypeLabel(t)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Cost</label>
              <div style={{ display: "flex" }}>
                <span
                  style={{
                    height: 36,
                    padding: "0 10px",
                    backgroundColor: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    borderRight: "none",
                    borderRadius: "8px 0 0 8px",
                    display: "flex",
                    alignItems: "center",
                    fontSize: 13,
                    color: "var(--text-tertiary)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  $
                </span>
                <input
                  type="number"
                  className="input font-mono"
                  placeholder="0.00"
                  value={costDollars}
                  onChange={(e) => setCostDollars(e.target.value)}
                  min="0"
                  step="0.01"
                  style={{
                    fontSize: 13,
                    textAlign: "right",
                    borderRadius: "0 8px 8px 0",
                    flex: 1,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Purchase Date */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Purchase Date</label>
            <input
              type="date"
              className="input font-mono"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              style={{ fontSize: 13, width: 180 }}
            />
          </div>

          {/* Capitalisation Check Advisory */}
          {capLoading && (
            <div style={{
              padding: "10px 14px",
              borderRadius: 8,
              backgroundColor: "var(--surface-2)",
              border: "1px solid var(--border)",
              fontSize: 13,
              color: "var(--text-tertiary)",
              marginBottom: 16,
            }}>
              Checking capitalisation rules...
            </div>
          )}

          {capCheck && !capLoading && (
            <div style={{ marginBottom: 16 }}>
              {capCheck.recommendation === "expense" && (
                <div style={{
                  padding: "12px 16px",
                  borderRadius: 8,
                  backgroundColor: "rgba(59, 130, 246, 0.08)",
                  border: "1px solid rgba(59, 130, 246, 0.3)",
                  fontSize: 13,
                  color: "#60a5fa",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                    <div>
                      <div style={{ fontWeight: 500, marginBottom: 4 }}>Below capitalisation threshold</div>
                      <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                        {capCheck.reason}
                      </div>
                      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                        <button
                          className="btn-primary"
                          style={{ fontSize: 12, height: 28, padding: "0 12px" }}
                          onClick={() => {
                            // Find a suitable expense account and bank/cash account for pre-fill
                            const expenseAcct = accounts.find((a) => a.type === "expense");
                            const bankAcct = accounts.find(
                              (a) => a.type === "asset" && /bank|cash|checking|savings/i.test(a.name),
                            ) ?? accounts.find((a) => a.type === "asset" && a.normalBalance === "debit");
                            const prefill: TransactionPrefill = {
                              date: purchaseDate,
                              memo: name ? `Expense: ${name}` : "",
                              fromAccountCode: bankAcct?.code ?? "",
                              toAccountCode: expenseAcct?.code ?? "",
                              amount: costDollars,
                            };
                            onClose();
                            openWithPrefill(prefill);
                          }}
                        >
                          Record as expense
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 12, height: 28, padding: "0 12px" }}
                          onClick={() => setShowDepreciationFields(true)}
                        >
                          Capitalise anyway
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {capCheck.recommendation === "instant_writeoff" && (
                <div style={{
                  padding: "12px 16px",
                  borderRadius: 8,
                  backgroundColor: "rgba(34, 197, 94, 0.08)",
                  border: "1px solid rgba(34, 197, 94, 0.25)",
                  fontSize: 13,
                  color: "var(--positive)",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--positive)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    <div>
                      <div style={{ fontWeight: 500, marginBottom: 4 }}>Eligible for instant asset write-off</div>
                      <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                        {capCheck.reason}
                      </div>
                      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                        <button
                          className="btn-primary"
                          style={{ fontSize: 12, height: 28, padding: "0 12px" }}
                          onClick={() => {
                            setDepMethod("instant_writeoff");
                            setShowDepreciationFields(false);
                          }}
                        >
                          Use instant write-off
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 12, height: 28, padding: "0 12px" }}
                          onClick={() => {
                            setShowDepreciationFields(true);
                            setDepMethod(DEFAULT_METHODS[jurisdiction] ?? "straight_line");
                          }}
                        >
                          Depreciate instead
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {capCheck.recommendation === "consider_section_179" && (
                <div style={{
                  padding: "12px 16px",
                  borderRadius: 8,
                  backgroundColor: "rgba(34, 197, 94, 0.08)",
                  border: "1px solid rgba(34, 197, 94, 0.25)",
                  fontSize: 13,
                  color: "var(--positive)",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--positive)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    <div>
                      <div style={{ fontWeight: 500, marginBottom: 4 }}>Section 179 eligible</div>
                      <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                        {capCheck.reason}
                      </div>
                      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                        <button
                          className="btn-primary"
                          style={{ fontSize: 12, height: 28, padding: "0 12px" }}
                          onClick={() => {
                            setDepMethod("section_179");
                            setShowDepreciationFields(false);
                          }}
                        >
                          Use Section 179
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 12, height: 28, padding: "0 12px" }}
                          onClick={() => {
                            setShowDepreciationFields(true);
                            setDepMethod(DEFAULT_METHODS[jurisdiction] ?? "macrs");
                          }}
                        >
                          Depreciate instead
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {capCheck.recommendation === "capitalise" && (
                <div style={{
                  padding: "12px 16px",
                  borderRadius: 8,
                  backgroundColor: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  fontSize: 13,
                  color: "var(--text-secondary)",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                      <rect x="2" y="6" width="20" height="12" rx="2" />
                      <path d="M12 12h.01" />
                    </svg>
                    <div>
                      <div style={{ fontWeight: 500, marginBottom: 4, color: "var(--text-primary)" }}>Capitalise and depreciate</div>
                      <div style={{ fontSize: 12 }}>
                        {capCheck.reason}
                        {capCheck.suggestedLifeYears && (
                          <span style={{ display: "block", marginTop: 4, color: "var(--text-tertiary)" }}>
                            {taxAuth} effective life: {capCheck.suggestedLifeYears} years ({Math.round(capCheck.suggestedLifeYears * 12)} months)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Depreciation Fields — shown after cap check recommends capitalise or user opts in */}
          {showDepreciationFields && (
            <div style={{ animation: "fadeIn 200ms ease" }}>
              {/* Divider */}
              <div style={{ borderTop: "1px solid var(--border)", margin: "8px 0 16px" }} />

              {/* Depreciation Method + Useful Life */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Depreciation Method</label>
                  <select
                    className="input"
                    value={depMethod}
                    onChange={(e) => setDepMethod(e.target.value)}
                    style={{ fontSize: 13, width: "100%", cursor: "pointer" }}
                  >
                    <option value="">Select method...</option>
                    {depMethods.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Useful Life (months)</label>
                  <input
                    type="number"
                    className="input font-mono"
                    placeholder="e.g. 60"
                    value={usefulLifeMonths}
                    onChange={(e) => setUsefulLifeMonths(e.target.value)}
                    min="1"
                    style={{ fontSize: 13, textAlign: "right" }}
                  />
                  {capCheck?.suggestedLifeYears && (
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                      {taxAuth} effective life: {capCheck.suggestedLifeYears} years ({Math.round(capCheck.suggestedLifeYears * 12)} months)
                    </div>
                  )}
                </div>
              </div>

              {/* Salvage Value */}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Salvage Value</label>
                <div style={{ display: "flex", maxWidth: 200 }}>
                  <span
                    style={{
                      height: 36,
                      padding: "0 10px",
                      backgroundColor: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      borderRight: "none",
                      borderRadius: "8px 0 0 8px",
                      display: "flex",
                      alignItems: "center",
                      fontSize: 13,
                      color: "var(--text-tertiary)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    $
                  </span>
                  <input
                    type="number"
                    className="input font-mono"
                    placeholder="0.00"
                    value={salvageDollars}
                    onChange={(e) => setSalvageDollars(e.target.value)}
                    min="0"
                    step="0.01"
                    style={{
                      fontSize: 13,
                      textAlign: "right",
                      borderRadius: "0 8px 8px 0",
                      flex: 1,
                    }}
                  />
                </div>
              </div>

              {/* Account Selection */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Asset Account</label>
                  {renderAccountDropdown(
                    "asset",
                    assetAccountId,
                    setAssetAccountId,
                    (a) => a.type === "asset" && a.normalBalance === "debit",
                  )}
                </div>
                <div>
                  <label style={labelStyle}>Accum. Depreciation</label>
                  {renderAccountDropdown(
                    "accum",
                    accumAccountId,
                    setAccumAccountId,
                    (a) => a.type === "asset" && a.normalBalance === "credit",
                  )}
                </div>
                <div>
                  <label style={labelStyle}>Depreciation Expense</label>
                  {renderAccountDropdown(
                    "expense",
                    expenseAccountId,
                    setExpenseAccountId,
                    (a) => a.type === "expense",
                  )}
                </div>
              </div>

              {/* Schedule Preview */}
              {schedulePreview && schedulePreview.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ ...labelStyle, marginBottom: 8 }}>
                    Schedule Preview (first {schedulePreview.length} {schedulePreview.length === 1 ? "period" : "periods"})
                  </div>
                  <div style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          {["Period", "Amount", "Accumulated", "NBV", "FY"].map((h) => (
                            <th
                              key={h}
                              style={{
                                textAlign: h === "Period" || h === "FY" ? "left" : "right",
                                padding: "6px 10px",
                                fontSize: 10,
                                fontWeight: 600,
                                color: "var(--text-tertiary)",
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                                backgroundColor: "var(--surface-2)",
                                borderBottom: "1px solid var(--border)",
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {schedulePreview.map((row) => (
                          <tr key={row.periodNumber} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "5px 10px", fontSize: 12, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                              {row.periodDate}
                            </td>
                            <td style={{ padding: "5px 10px", fontSize: 12, color: "var(--text-primary)", textAlign: "right", fontFamily: "var(--font-mono)" }}>
                              {formatCurrency(row.depreciationAmount)}
                            </td>
                            <td style={{ padding: "5px 10px", fontSize: 12, color: "var(--text-secondary)", textAlign: "right", fontFamily: "var(--font-mono)" }}>
                              {formatCurrency(row.accumulatedDepreciation)}
                            </td>
                            <td style={{ padding: "5px 10px", fontSize: 12, color: "var(--text-primary)", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 500 }}>
                              {formatCurrency(row.netBookValue)}
                            </td>
                            <td style={{ padding: "5px 10px", fontSize: 11, color: "var(--text-tertiary)" }}>
                              {row.financialYear}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {/* Summary row */}
                    <div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "8px 10px",
                      backgroundColor: "var(--surface-2)",
                      borderTop: "1px solid var(--border)",
                      fontSize: 12,
                    }}>
                      <span style={{ color: "var(--text-tertiary)" }}>
                        Total depreciation: <span style={{ color: "var(--text-primary)", fontWeight: 600, fontFamily: "var(--font-mono)" }}>
                          {formatCurrency(dollarsToCents(costDollars) - dollarsToCents(salvageDollars || "0"))}
                        </span>
                      </span>
                      <span style={{ color: "var(--text-tertiary)" }}>
                        Final NBV: <span style={{ color: "var(--text-primary)", fontWeight: 600, fontFamily: "var(--font-mono)" }}>
                          {formatCurrency(dollarsToCents(salvageDollars || "0"))}
                        </span>
                      </span>
                    </div>
                    {/* FY breakdown */}
                    {(() => {
                      const fyTotals: Record<string, number> = {};
                      for (const row of schedulePreview) {
                        fyTotals[row.financialYear] = (fyTotals[row.financialYear] ?? 0) + row.depreciationAmount;
                      }
                      const fyEntries = Object.entries(fyTotals);
                      if (fyEntries.length <= 1) return null;
                      return (
                        <div style={{
                          padding: "6px 10px",
                          borderTop: "1px solid var(--border)",
                          fontSize: 11,
                          color: "var(--text-tertiary)",
                          display: "flex",
                          gap: 16,
                        }}>
                          {fyEntries.map(([fy, total]) => (
                            <span key={fy}>
                              FY {fy}: <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>{formatCurrency(total)}</span>
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              padding: "10px 14px",
              borderRadius: 8,
              backgroundColor: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              fontSize: 13,
              color: "var(--negative)",
              marginBottom: 16,
            }}>
              {error}
            </div>
          )}

          {/* Success */}
          {successMsg && (
            <div style={{
              padding: "10px 14px",
              borderRadius: 8,
              backgroundColor: "rgba(34, 197, 94, 0.08)",
              border: "1px solid rgba(34, 197, 94, 0.25)",
              fontSize: 13,
              color: "var(--positive)",
              fontWeight: 500,
              marginBottom: 16,
            }}>
              {successMsg}
            </div>
          )}

          {/* Footer */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn-secondary" onClick={onClose} style={{ fontSize: 13 }}>
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
              {isPending ? "Creating..." : "Create Asset"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
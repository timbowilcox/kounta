"use client";

import { useState, useTransition } from "react";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  fetchFixedAssets,
  fetchAssetSummary,
  runDepreciationAction,
} from "@/lib/actions";
import type {
  FixedAssetSummaryItem,
  AssetRegisterSummary,
} from "@/lib/actions";
import type { AccountWithBalance } from "@kounta/sdk";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  initialAssets: FixedAssetSummaryItem[];
  initialSummary: AssetRegisterSummary;
  accounts: AccountWithBalance[];
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      style={{
        padding: "16px 20px",
        backgroundColor: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        flex: 1,
        minWidth: 160,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: "var(--text-primary)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    active: { bg: "rgba(34,197,94,0.12)", text: "var(--positive)" },
    disposed: { bg: "rgba(239,68,68,0.12)", text: "var(--negative)" },
    fully_depreciated: { bg: "rgba(234,179,8,0.12)", text: "#D97706" },
  };
  const c = colors[status] ?? colors.active;
  const label = status === "fully_depreciated" ? "Fully Depreciated" : status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 500,
        backgroundColor: c.bg,
        color: c.text,
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function FixedAssetsView({ initialAssets, initialSummary, accounts }: Props) {
  const [assets, setAssets] = useState(initialAssets);
  const [summary, setSummary] = useState(initialSummary);
  const [filter, setFilter] = useState<"active" | "disposed" | "fully_depreciated" | "all">("active");
  const [isPending, startTransition] = useTransition();
  const [depResult, setDepResult] = useState<{ posted: number; totalAmount: number } | null>(null);

  // Suppress unused var warning — accounts will be used for create asset form
  void accounts;

  const filteredAssets = filter === "all"
    ? assets
    : assets.filter((a) => a.status === filter);

  const refresh = () => {
    startTransition(async () => {
      const [a, s] = await Promise.allSettled([
        fetchFixedAssets(),
        fetchAssetSummary(),
      ]);
      if (a.status === "fulfilled") setAssets(a.value);
      if (s.status === "fulfilled") setSummary(s.value);
    });
  };

  const handleRunDepreciation = () => {
    startTransition(async () => {
      const result = await runDepreciationAction();
      if (result) {
        setDepResult(result);
        refresh();
        setTimeout(() => setDepResult(null), 5000);
      }
    });
  };

  return (
    <div style={{ padding: 32, maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
            Fixed Assets
          </h1>
          {summary.currentFinancialYear && (
            <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: "4px 0 0" }}>
              {summary.currentFinancialYear}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {summary.pendingEntries > 0 && (
            <button
              onClick={handleRunDepreciation}
              disabled={isPending}
              className="btn-primary"
              style={{ fontSize: 13 }}
            >
              Post Depreciation ({summary.pendingEntries})
            </button>
          )}
        </div>
      </div>

      {/* Depreciation result toast */}
      {depResult && (
        <div
          style={{
            padding: "10px 16px",
            backgroundColor: "rgba(34,197,94,0.12)",
            border: "1px solid var(--positive)",
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 13,
            color: "var(--positive)",
          }}
        >
          Posted {depResult.posted} depreciation entries totalling {formatCurrency(depResult.totalAmount)}.
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <StatCard
          label="Total Cost"
          value={formatCurrency(summary.totalCost)}
          sub={`${summary.totalAssets} asset${summary.totalAssets !== 1 ? "s" : ""}`}
        />
        <StatCard
          label="Net Book Value"
          value={formatCurrency(summary.totalNbv)}
        />
        <StatCard
          label="Accumulated Depreciation"
          value={formatCurrency(summary.totalAccumulated)}
        />
        <StatCard
          label="Depreciation This FY"
          value={formatCurrency(summary.depreciationThisFy)}
          sub={summary.depreciationLastFy > 0 ? `Last FY: ${formatCurrency(summary.depreciationLastFy)}` : undefined}
        />
      </div>

      {/* Pending depreciation alert */}
      {summary.pendingEntries > 0 && (
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "rgba(234,179,8,0.08)",
            border: "1px solid #D97706",
            borderRadius: 8,
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span style={{ fontSize: 13, color: "var(--text-primary)" }}>
            {summary.pendingEntries} depreciation {summary.pendingEntries === 1 ? "entry" : "entries"} pending
            ({formatCurrency(summary.pendingAmount)})
          </span>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 1 }}>
        {(["active", "disposed", "fully_depreciated", "all"] as const).map((f) => {
          const label = f === "fully_depreciated" ? "Fully Depreciated" : f.charAt(0).toUpperCase() + f.slice(1);
          const count = f === "all"
            ? assets.length
            : f === "active"
              ? summary.assetsByStatus.active
              : f === "disposed"
                ? summary.assetsByStatus.disposed
                : summary.assetsByStatus.fullyDepreciated;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: filter === f ? 600 : 400,
                color: filter === f ? "var(--text-primary)" : "var(--text-tertiary)",
                backgroundColor: "transparent",
                border: "none",
                borderBottom: filter === f ? "2px solid var(--text-primary)" : "2px solid transparent",
                cursor: "pointer",
                marginBottom: -1,
              }}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>

      {/* Asset table */}
      {filteredAssets.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-tertiary)" }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto 12px" }}>
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M12 12h.01" />
            <path d="M17 6V4a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2" />
          </svg>
          <p style={{ fontSize: 14, fontWeight: 500 }}>No fixed assets</p>
          <p style={{ fontSize: 13, marginTop: 4 }}>
            Use the assistant to register your first asset.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Name", "Type", "Purchase Date", "Cost", "NBV", "Method", "Status"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: h === "Cost" || h === "NBV" ? "right" : "left",
                      padding: "8px 12px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text-tertiary)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredAssets.map((asset) => (
                <tr
                  key={asset.id}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>
                    {asset.name}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "var(--text-secondary)" }}>
                    {asset.assetType ? asset.assetType.replace(/_/g, " ") : "-"}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "var(--text-secondary)" }}>
                    {formatDate(asset.purchaseDate)}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "var(--text-primary)", textAlign: "right" }}>
                    {formatCurrency(asset.costAmount, asset.currency)}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "var(--text-primary)", textAlign: "right" }}>
                    {asset.netBookValue != null ? formatCurrency(asset.netBookValue, asset.currency) : "-"}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "var(--text-secondary)" }}>
                    {asset.depreciationMethod.replace(/_/g, " ")}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <StatusBadge status={asset.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect, useTransition, useRef, useCallback } from "react";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  fetchFixedAssets,
  fetchAssetSummary,
  runDepreciationAction,
  createFixedAssetAction,
  capitalisationCheckAction,
} from "@/lib/actions";
import type {
  FixedAssetSummaryItem,
  AssetRegisterSummary,
  CapitalisationCheckResult,
} from "@/lib/actions";
import type { AccountWithBalance } from "@kounta/sdk";
import { usePostTransaction } from "@/components/post-transaction-provider";
import type { TransactionPrefill } from "@/components/post-transaction-provider";

// ---------------------------------------------------------------------------
// Asset type data — matches JURISDICTION_THRESHOLDS in engine.ts
// ---------------------------------------------------------------------------

export const ASSET_TYPES_BY_JURISDICTION: Record<string, string[]> = {
  AU: [
    "laptop", "desktop_computer", "mobile_phone", "tablet", "server",
    "network_equipment", "office_furniture", "motor_vehicle_car",
    "motor_vehicle_ute", "commercial_vehicle", "manufacturing_equipment",
    "office_equipment", "air_conditioner", "solar_panels", "building_fitout",
    "software", "website",
  ],
  US: [
    "laptop", "desktop_computer", "mobile_phone", "tablet", "server",
    "office_furniture", "motor_vehicle_car", "commercial_vehicle",
    "manufacturing_equipment", "office_equipment", "building",
    "residential_rental", "software",
  ],
  UK: [
    "laptop", "desktop_computer", "mobile_phone", "server",
    "office_furniture", "motor_vehicle_car", "commercial_vehicle",
    "manufacturing_equipment", "office_equipment",
  ],
};

export const TAX_AUTHORITY: Record<string, string> = {
  AU: "ATO", US: "IRS", UK: "HMRC", NZ: "IRD", CA: "CRA", SG: "IRAS",
};

export const DEPRECIATION_METHODS_BY_JURISDICTION: Record<string, { value: string; label: string }[]> = {
  AU: [
    { value: "diminishing_value", label: "Diminishing Value" },
    { value: "prime_cost", label: "Prime Cost" },
    { value: "straight_line", label: "Straight Line" },
    { value: "instant_writeoff", label: "Instant Write-off" },
  ],
  US: [
    { value: "macrs", label: "MACRS" },
    { value: "straight_line", label: "Straight Line" },
    { value: "section_179", label: "Section 179" },
    { value: "bonus_depreciation", label: "Bonus Depreciation" },
  ],
  UK: [
    { value: "writing_down_allowance", label: "Writing Down Allowance" },
    { value: "straight_line", label: "Straight Line" },
    { value: "aia", label: "Annual Investment Allowance" },
  ],
};

export const DEFAULT_METHODS: Record<string, string> = {
  AU: "diminishing_value", US: "macrs", UK: "writing_down_allowance",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatAssetTypeLabel(key: string): string {
  return key
    .split("_")
    .map((w, i) => {
      // Parenthetical groupings
      if (w === "car") return "(Car)";
      if (w === "ute") return "(Ute)";
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ")
    .replace(" (", " (")
    .replace("Motor Vehicle (Car)", "Motor Vehicle (Car)")
    .replace("Motor Vehicle (Ute)", "Motor Vehicle (Ute)");
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dollarsToCents(dollars: string): number {
  return Math.round(parseFloat(dollars) * 100);
}

// ---------------------------------------------------------------------------
// Label style (reused across all labels)
// ---------------------------------------------------------------------------

export const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--text-tertiary)",
  fontWeight: 500,
  marginBottom: 6,
};

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

export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
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

export function StatusBadge({ status }: { status: string }) {
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
// Schedule preview types
// ---------------------------------------------------------------------------

export interface SchedulePreviewRow {
  periodDate: string;
  periodNumber: number;
  financialYear: string;
  depreciationAmount: number;
  accumulatedDepreciation: number;
  netBookValue: number;
}

// ---------------------------------------------------------------------------
// Add Asset Modal
// ---------------------------------------------------------------------------

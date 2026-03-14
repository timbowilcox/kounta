"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchChecklist, dismissChecklistAction } from "@/lib/actions";
import type { OnboardingChecklistItem } from "@/lib/actions";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Checklist item config — label, link, and display
// ---------------------------------------------------------------------------

const ITEM_CONFIG: Record<
  string,
  { label: string; href: string; description: string }
> = {
  business_profile: {
    label: "Business profile configured",
    href: "/settings",
    description: "Set up your business type and accounting preferences",
  },
  chart_of_accounts: {
    label: "Chart of accounts created",
    href: "/settings?tab=accounts",
    description: "Your chart of accounts has been configured",
  },
  bank_connected: {
    label: "Bank account connected",
    href: "/bank-feeds",
    description: "Connect a bank account to import transactions",
  },
  first_classified: {
    label: "First transactions classified",
    href: "/bank-feeds",
    description: "Classify your imported transactions",
  },
  connect_stripe: {
    label: "Connect Stripe",
    href: "/settings",
    description: "Link your Stripe account for automatic revenue tracking",
  },
  tax_profile: {
    label: "Set up tax profile",
    href: "/settings",
    description: "Configure your tax settings and filing details",
  },
};

// ---------------------------------------------------------------------------
// Progress Checklist — persistent bar on dashboard overview
// ---------------------------------------------------------------------------

export function ProgressChecklist() {
  const [items, setItems] = useState<OnboardingChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // Check local storage first
    const stored = typeof window !== "undefined" && localStorage.getItem("ledge_checklist_dismissed");
    if (stored) {
      setIsDismissed(true);
      setLoading(false);
      return;
    }

    fetchChecklist()
      .then((data) => {
        setItems(data);
        // Check if all items are dismissed in DB
        if (data.length > 0 && data.every((i) => i.dismissed)) {
          setIsDismissed(true);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleDismiss = useCallback(async () => {
    setIsDismissed(true);
    if (typeof window !== "undefined") {
      localStorage.setItem("ledge_checklist_dismissed", "true");
    }
    await dismissChecklistAction().catch(() => {});
  }, []);

  if (loading || isDismissed || items.length === 0) return null;

  const completedCount = items.filter((i) => i.completed).length;
  const totalCount = items.length;
  const allComplete = completedCount === totalCount;

  // Auto-dismiss if all complete
  if (allComplete) return null;

  const progress = (completedCount / totalCount) * 100;

  return (
    <div
      style={{
        marginBottom: 24,
        borderRadius: 12,
        border: "1px solid #E5E5E5",
        backgroundColor: "#FFFFFF",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 20px 12px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#0A0A0A" }}>
              Getting started with Kounta
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "#666666",
                padding: "2px 8px",
                borderRadius: 9999,
                backgroundColor: "#F0F6FF",
              }}
            >
              {completedCount}/{totalCount} complete
            </span>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          style={{
            padding: "4px 8px",
            border: "none",
            backgroundColor: "transparent",
            color: "#999999",
            fontSize: 12,
            cursor: "pointer",
          }}
          title="Dismiss checklist"
        >
          ✕
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ padding: "0 20px 16px" }}>
        <div
          style={{
            height: 4,
            backgroundColor: "#E5E5E5",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              backgroundColor: "#0066FF",
              borderRadius: 2,
              transition: "width 300ms ease",
            }}
          />
        </div>
      </div>

      {/* Checklist items */}
      <div style={{ padding: "0 20px 16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((item) => {
            const config = ITEM_CONFIG[item.item];
            if (!config) return null;

            return (
              <ChecklistRow
                key={item.id}
                label={config.label}
                href={config.href}
                completed={item.completed}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checklist Row
// ---------------------------------------------------------------------------

function ChecklistRow({
  label,
  href,
  completed,
}: {
  label: string;
  href: string;
  completed: boolean;
}) {
  if (completed) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 0",
        }}
      >
        <span style={{ color: "#22C55E", fontSize: 14, fontWeight: 700 }}>✓</span>
        <span style={{ fontSize: 13, color: "#999999", textDecoration: "line-through" }}>
          {label}
        </span>
      </div>
    );
  }

  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 0",
        textDecoration: "none",
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          border: "2px solid #E5E5E5",
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 13, color: "#0066FF", fontWeight: 500 }}>
        {label}
      </span>
    </Link>
  );
}

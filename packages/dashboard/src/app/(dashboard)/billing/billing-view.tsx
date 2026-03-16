"use client";

import { useState, useTransition } from "react";
import { createCheckoutSession, createPortalSession } from "@/lib/actions";
import type { BillingStatus } from "@/lib/actions";

const TIER_ORDER = ["free", "builder", "pro", "platform"];

const TIERS = [
  {
    name: "Free",
    price: "$0",
    period: "/month",
    features: [
      "100 transactions/month",
      "5 invoices/month",
      "3 customers",
      "1 ledger",
      "MCP access",
      "Basic statements",
    ],
    recommended: false,
    plan: "free" as const,
  },
  {
    name: "Builder",
    price: "$19",
    period: "/month",
    features: [
      "1,000 transactions/month",
      "Unlimited invoices",
      "Unlimited customers",
      "3 ledgers",
      "API & SDK access",
      "PDF export & email",
    ],
    recommended: true,
    plan: "builder" as const,
  },
  {
    name: "Pro",
    price: "$49",
    period: "/month",
    features: [
      "10,000 transactions/month",
      "10 ledgers",
      "Revenue recognition",
      "Multi-currency",
      "Custom chart of accounts",
      "Consolidated view",
    ],
    recommended: false,
    plan: "pro" as const,
  },
  {
    name: "Platform",
    price: "$149",
    period: "/month",
    features: [
      "Unlimited everything",
      "Programmatic provisioning",
      "Webhooks",
      "White-label",
      "Unlimited ledgers",
      "Priority support",
    ],
    recommended: false,
    plan: "platform" as const,
  },
];

const COMPARISON_ROWS: { label: string; values: (string | boolean)[] }[] = [
  { label: "Price", values: ["$0/mo", "$19/mo", "$49/mo", "$149/mo"] },
  { label: "Ledgers", values: ["1", "3", "10", "Unlimited"] },
  { label: "Transactions/mo", values: ["100", "1,000", "10,000", "Unlimited"] },
  { label: "Invoices/mo", values: ["5", "Unlimited", "Unlimited", "Unlimited"] },
  { label: "Customers", values: ["3", "Unlimited", "Unlimited", "Unlimited"] },
  { label: "Fixed Assets", values: ["3", "Unlimited", "Unlimited", "Unlimited"] },
  { label: "API/SDK access", values: [false, true, true, true] },
  { label: "PDF export", values: [false, true, true, true] },
  { label: "Invoice email", values: [false, true, true, true] },
  { label: "Multi-currency", values: [false, true, true, true] },
  { label: "Revenue recognition", values: [false, false, true, true] },
  { label: "Consolidated view", values: [false, false, true, true] },
  { label: "White-label", values: [false, false, false, true] },
  { label: "Webhooks", values: [false, false, false, true] },
];

export function BillingView({ billing }: { billing: BillingStatus }) {
  const [isPending, startTransition] = useTransition();
  const [redirecting, setRedirecting] = useState(false);

  const isFree = billing.plan === "free";
  const limit = billing.usage.limit ?? Infinity;
  const pct = limit === Infinity ? 0 : Math.min((billing.usage.count / limit) * 100, 100);
  const barColor =
    pct >= 100 ? "#DC2626" : pct >= 80 ? "#D97706" : "var(--accent)";

  const handleUpgrade = () => {
    setRedirecting(true);
    startTransition(async () => {
      try {
        const url = await createCheckoutSession();
        window.location.href = url;
      } catch {
        setRedirecting(false);
      }
    });
  };

  const handleManage = () => {
    setRedirecting(true);
    startTransition(async () => {
      try {
        const url = await createPortalSession();
        window.location.href = url;
      } catch {
        setRedirecting(false);
      }
    });
  };

  const formatDate = (d: string | null) => {
    if (!d) return "\u2014";
    return new Date(d).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const planLabel = (plan: string) => {
    switch (plan) {
      case "builder": return "Builder";
      case "pro": return "Pro";
      case "platform": return "Platform";
      default: return "Free";
    }
  };

  const planPrice = (plan: string) => {
    switch (plan) {
      case "builder": return "$19/mo";
      case "pro": return "$49/mo";
      case "platform": return "$149/mo";
      default: return "$0/mo";
    }
  };

  return (
    <div>
      <h1
        className="font-bold"
        style={{
          fontSize: 24,
          color: "var(--text-primary)",
          marginBottom: 28,
          fontFamily: "var(--font-family-display)",
        }}
      >
        Billing
      </h1>

      <div className="grid grid-cols-2" style={{ gap: 20, marginBottom: 24 }}>
        {/* Current Plan */}
        <div className="card">
          <div className="section-label" style={{ marginBottom: 14 }}>
            Current Plan
          </div>
          <div className="flex items-center gap-3" style={{ marginBottom: 12 }}>
            <span
              className="font-bold"
              style={{
                fontSize: 28,
                color: "var(--text-primary)",
                letterSpacing: "-0.02em",
                fontFamily: "var(--font-family-display)",
              }}
            >
              {planLabel(billing.plan)}
            </span>
            <span className={"badge " + (isFree ? "badge-blue" : "badge-green")}>
              {planPrice(billing.plan)}
            </span>
          </div>
          <p
            className="text-sm"
            style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}
          >
            {isFree
              ? "100 transactions, 5 invoices, 3 customers per month."
              : billing.plan === "builder" ? "1,000 transactions/month. Unlimited invoices and customers."
              : billing.plan === "pro" ? "10,000 transactions/month. Revenue recognition and consolidated view."
              : "Unlimited everything. Programmatic provisioning and white-label."}
          </p>
        </div>

        {/* Usage */}
        <div className="card">
          <div className="section-label" style={{ marginBottom: 14 }}>
            Monthly Usage
          </div>
          <div className="flex items-baseline gap-2" style={{ marginBottom: 14 }}>
            <span
              className="font-bold font-mono"
              style={{
                fontSize: 28,
                color: pct >= 100 ? "#DC2626" : "var(--text-primary)",
                letterSpacing: "-0.02em",
              }}
            >
              {billing.usage.count.toLocaleString()}
            </span>
            {billing.usage.limit != null ? (
              <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>
                / {billing.usage.limit.toLocaleString()} transactions
              </span>
            ) : (
              <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>
                transactions (unlimited)
              </span>
            )}
          </div>

          {/* Usage bar — only show for free tier */}
          {billing.usage.limit != null && (
            <div
              style={{
                width: "100%",
                height: 8,
                borderRadius: 4,
                backgroundColor: "var(--surface-2)",
                overflow: "hidden",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  width: pct + "%",
                  height: "100%",
                  borderRadius: 4,
                  backgroundColor: barColor,
                  transition: "width 600ms cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              />
            </div>
          )}

          <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            Resets on {formatDate(billing.nextResetDate)}
          </div>
        </div>
      </div>

      {/* Pending transactions notice */}
      {billing.pendingTransactions > 0 && (
        <div
          style={{
            borderRadius: 18,
            padding: "20px 24px",
            marginBottom: 24,
            backgroundColor: "rgba(217,119,6,0.06)",
            border: "1px solid rgba(217,119,6,0.15)",
          }}
        >
          <div className="flex items-center gap-3">
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="#D97706"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="10" cy="10" r="8" />
              <path d="M10 6.5v4" />
              <circle cx="10" cy="13.5" r="0.5" fill="#D97706" />
            </svg>
            <div>
              <span className="text-sm font-medium" style={{ color: "#92400E" }}>
                {billing.pendingTransactions} transaction
                {billing.pendingTransactions !== 1 ? "s" : ""} queued
              </span>
              <span
                className="text-sm"
                style={{ color: "rgba(146,64,14,0.7)", marginLeft: 6 }}
              >
                {"\u2014"} upgrade to post them now
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Action card */}
      <div className="card" style={{ marginBottom: 32 }}>
        {isFree ? (
          <div>
            <div className="section-label" style={{ marginBottom: 14 }}>
              Upgrade
            </div>
            <p
              className="text-sm"
              style={{
                color: "var(--text-secondary)",
                lineHeight: 1.6,
                marginBottom: 20,
              }}
            >
              Get unlimited transactions, instant posting, and bank feed integration.
              {billing.pendingTransactions > 0 &&
                " Your " +
                  billing.pendingTransactions +
                  " pending transaction" +
                  (billing.pendingTransactions !== 1 ? "s" : "") +
                  " will be posted automatically."}
            </p>
            <button
              className="btn-primary"
              style={{ padding: "12px 28px", fontSize: 14 }}
              onClick={handleUpgrade}
              disabled={isPending || redirecting}
            >
              {redirecting
                ? "Redirecting to Stripe..."
                : "Upgrade to Builder \u2014 $19/month"}
            </button>
          </div>
        ) : (
          <div>
            <div className="section-label" style={{ marginBottom: 14 }}>
              Manage Subscription
            </div>
            <p
              className="text-sm"
              style={{
                color: "var(--text-secondary)",
                lineHeight: 1.6,
                marginBottom: 8,
              }}
            >
              Update payment method, view invoices, or cancel your subscription.
            </p>
            {billing.periodEnd && (
              <p
                className="text-xs"
                style={{ color: "var(--text-tertiary)", marginBottom: 20 }}
              >
                Current period: {formatDate(billing.periodStart)} {"\u2014"}{" "}
                {formatDate(billing.periodEnd)}
              </p>
            )}
            <button
              className="btn-secondary"
              style={{ padding: "12px 28px", fontSize: 14 }}
              onClick={handleManage}
              disabled={isPending || redirecting}
            >
              {redirecting ? "Redirecting to Stripe..." : "Manage Subscription"}
            </button>
          </div>
        )}
      </div>

      {/* Tier comparison */}
      <div>
        <div className="section-label" style={{ marginBottom: 16 }}>
          Plans
        </div>
        <div className="grid grid-cols-4" style={{ gap: 16 }}>
          {TIERS.map((tier) => {
            const isCurrent = billing.plan === tier.plan;
            const isRecommended = tier.recommended && isFree;
            return (
              <div
                key={tier.plan}
                className="card"
                style={{
                  position: "relative",
                  border: isRecommended
                    ? "2px solid var(--accent)"
                    : isCurrent
                      ? "1px solid var(--border-strong)"
                      : "1px solid var(--border)",
                  borderLeft: isCurrent ? "3px solid var(--accent)" : undefined,
                  padding: 20,
                  opacity: 1,
                }}
              >
                {isRecommended && (
                  <div
                    className="text-xs font-medium"
                    style={{
                      position: "absolute",
                      top: -10,
                      left: "50%",
                      transform: "translateX(-50%)",
                      backgroundColor: "var(--accent)",
                      color: "white",
                      padding: "2px 12px",
                      borderRadius: 10,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Recommended
                  </div>
                )}
                <div
                  className="font-bold"
                  style={{
                    fontSize: 16,
                    color: "var(--text-primary)",
                    marginBottom: 4,
                    fontFamily: "var(--font-family-display)",
                  }}
                >
                  {tier.name}
                </div>
                <div className="flex items-baseline gap-1" style={{ marginBottom: 16 }}>
                  <span
                    className="font-bold"
                    style={{
                      fontSize: 24,
                      color: "var(--text-primary)",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {tier.price}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    {tier.period}
                  </span>
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, marginBottom: 16 }}>
                  {tier.features.map((f) => (
                    <li
                      key={f}
                      className="text-xs flex items-start gap-2"
                      style={{ color: "var(--text-secondary)", marginBottom: 6, lineHeight: 1.5 }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ flexShrink: 0, marginTop: 2 }}
                      >
                        <path d="M3.5 7l2 2 5-5" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <div
                    className="text-xs font-semibold uppercase tracking-wide"
                    style={{
                      textAlign: "center",
                      backgroundColor: "var(--surface-1)",
                      color: "var(--accent)",
                      border: "1px solid var(--border-strong)",
                      borderRadius: 9999,
                      padding: "5px 12px",
                    }}
                  >
                    Current plan
                  </div>
                ) : TIER_ORDER.indexOf(tier.plan) > TIER_ORDER.indexOf(billing.plan) ? (
                  <button
                    className="btn-primary"
                    style={{ width: "100%", padding: "10px 0", fontSize: 13 }}
                    onClick={handleUpgrade}
                    disabled={isPending || redirecting}
                  >
                    {redirecting ? "Redirecting..." : "Upgrade"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Feature comparison table */}
      <div style={{ marginTop: 32 }}>
        <div className="section-label" style={{ marginBottom: 16 }}>Compare plans</div>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="w-full" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "12px 16px", fontSize: 12, color: "var(--text-tertiary)", fontWeight: 500, borderBottom: "1px solid var(--border)" }}>Feature</th>
                {TIERS.map((t) => (
                  <th
                    key={t.plan}
                    style={{
                      textAlign: "center",
                      padding: "12px 16px",
                      fontSize: 13,
                      fontWeight: 600,
                      color: billing.plan === t.plan ? "var(--accent)" : "var(--text-primary)",
                      borderBottom: "1px solid var(--border)",
                      backgroundColor: billing.plan === t.plan ? "color-mix(in srgb, var(--accent) 5%, transparent)" : undefined,
                    }}
                  >
                    {t.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.label}>
                  <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>{row.label}</td>
                  {row.values.map((val, i) => (
                    <td
                      key={i}
                      style={{
                        textAlign: "center",
                        padding: "10px 16px",
                        fontSize: 13,
                        borderBottom: "1px solid var(--border)",
                        color: typeof val === "boolean" ? (val ? "var(--positive)" : "var(--text-disabled)") : "var(--text-primary)",
                        backgroundColor: billing.plan === TIERS[i]!.plan ? "color-mix(in srgb, var(--accent) 5%, transparent)" : undefined,
                      }}
                    >
                      {typeof val === "boolean" ? (val ? "\u2713" : "\u2014") : val}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Success/cancel banners from Stripe redirect */}
      <SuccessBanner />
    </div>
  );
}

function SuccessBanner() {
  const [params] = useState(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search);
  });

  if (!params) return null;

  if (params.get("success") === "true") {
    return (
      <div
        style={{
          borderRadius: 18,
          padding: "20px 24px",
          marginTop: 24,
          backgroundColor: "rgba(22,163,74,0.06)",
          border: "1px solid rgba(22,163,74,0.15)",
        }}
      >
        <div className="flex items-center gap-3">
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="#16A34A"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="10" cy="10" r="8" />
            <path d="M7 10l2 2 4-4" />
          </svg>
          <span className="text-sm font-medium" style={{ color: "#166534" }}>
            Upgrade successful! Your pending transactions are being posted.
          </span>
        </div>
      </div>
    );
  }

  if (params.get("canceled") === "true") {
    return (
      <div
        style={{
          borderRadius: 18,
          padding: "20px 24px",
          marginTop: 24,
          backgroundColor: "var(--surface-1)",
          border: "1px solid var(--surface-2)",
        }}
      >
        <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Checkout canceled. You can upgrade anytime.
        </span>
      </div>
    );
  }

  return null;
}

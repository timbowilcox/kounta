"use client";

import { useState, useTransition } from "react";
import type { Notification, NotificationSeverity, NotificationStatus, NotificationType } from "@ledge/sdk";
import { ContextualPrompt } from "@/components/contextual-prompt";

interface NotificationsViewProps {
  notifications: readonly unknown[];
  error: string | null;
}

type FilterTab = "all" | "unread" | "read" | "dismissed";

const severityBadge: Record<NotificationSeverity, { label: string; className: string }> = {
  info: { label: "Info", className: "badge-blue" },
  warning: { label: "Warning", className: "badge-amber" },
  critical: { label: "Critical", className: "badge-red" },
};

const typeLabels: Record<NotificationType, string> = {
  monthly_summary: "Monthly Summary",
  cash_position: "Cash Position",
  anomaly: "Anomaly",
  unclassified_transactions: "Unclassified",
  sync_complete: "Sync Complete",
  reconciliation_needed: "Reconciliation",
  system: "System",
};

function typeIcon(type: NotificationType): string {
  switch (type) {
    case "monthly_summary": return "📊";
    case "cash_position": return "💰";
    case "anomaly": return "⚠️";
    case "unclassified_transactions": return "📂";
    case "sync_complete": return "✅";
    case "reconciliation_needed": return "🔄";
    case "system": return "🔔";
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

export function NotificationsView({ notifications, error }: NotificationsViewProps) {
  const typed = notifications as Notification[];
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = activeFilter === "all"
    ? typed
    : typed.filter((n) => n.status === activeFilter);

  const unreadCount = typed.filter((n) => n.status === "unread").length;

  if (error === "upgrade") {
    return (
      <div>
        <PageHeader unreadCount={0} />
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              backgroundColor: "rgba(59,130,246,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <NotificationIconSvg />
          </div>
          <h2
            className="font-bold"
            style={{ fontSize: 18, color: "#0A0A0A", marginBottom: 8, fontFamily: "var(--font-family-display)" }}
          >
            Upgrade to Enable Insights
          </h2>
          <p className="text-sm" style={{ color: "rgba(0,0,0,0.55)", lineHeight: 1.6, maxWidth: 420, margin: "0 auto" }}>
            Automated financial insights and notifications require a Builder plan or higher.
            Upgrade your plan to receive monthly summaries, cash position alerts, and anomaly detection.
          </p>
        </div>
      </div>
    );
  }

  if (typed.length === 0) {
    return (
      <div>
        <PageHeader unreadCount={0} />
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              backgroundColor: "rgba(59,130,246,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <NotificationIconSvg />
          </div>
          <h2
            className="font-bold"
            style={{ fontSize: 18, color: "#0A0A0A", marginBottom: 8, fontFamily: "var(--font-family-display)" }}
          >
            No Notifications Yet
          </h2>
          <p className="text-sm" style={{ color: "rgba(0,0,0,0.55)", lineHeight: 1.6, maxWidth: 420, margin: "0 auto" }}>
            Ledge generates financial insights automatically as you use the ledger. Post transactions,
            connect bank feeds, and insights will appear here — monthly summaries, cash position
            alerts, anomaly detection, and more.
          </p>
        </div>

        <div style={{ marginTop: 32 }}>
          <InsightTypesGuide />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader unreadCount={unreadCount} />

      {/* Filter tabs */}
      <div className="flex items-center" style={{ gap: 6, marginBottom: 24 }}>
        {(["all", "unread", "read", "dismissed"] as const).map((tab) => {
          const count = tab === "all" ? typed.length : typed.filter((n) => n.status === tab).length;
          return (
            <button
              key={tab}
              onClick={() => setActiveFilter(tab)}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 500,
                backgroundColor: activeFilter === tab ? "rgba(59,130,246,0.1)" : "transparent",
                color: activeFilter === tab ? "#3B82F6" : "rgba(0,0,0,0.36)",
                border: activeFilter === tab ? "1px solid rgba(59,130,246,0.3)" : "1px solid transparent",
                cursor: "pointer",
                transition: "all 200ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {count > 0 && (
                <span
                  className="text-xs"
                  style={{
                    marginLeft: 6,
                    opacity: 0.7,
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Notification list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((notification) => {
          const badge = severityBadge[notification.severity];
          const isExpanded = expandedId === notification.id;
          const isUnread = notification.status === "unread";

          return (
            <div
              key={notification.id}
              className="card"
              style={{
                padding: 20,
                cursor: "pointer",
                borderLeft: isUnread ? "3px solid #3B82F6" : "3px solid transparent",
                transition: "all 200ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
              onClick={() => setExpandedId(isExpanded ? null : notification.id)}
            >
              <div className="flex items-start" style={{ gap: 14 }}>
                {/* Icon */}
                <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1 }}>
                  {typeIcon(notification.type)}
                </span>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex items-center" style={{ gap: 8, marginBottom: 4 }}>
                    <span
                      className="text-sm font-medium"
                      style={{ color: "#0A0A0A", fontWeight: isUnread ? 600 : 500 }}
                    >
                      {notification.title}
                    </span>
                    <span className={badge.className}>{badge.label}</span>
                    <span
                      className="text-xs"
                      style={{
                        color: "rgba(0,0,0,0.28)",
                        backgroundColor: "rgba(0,0,0,0.04)",
                        padding: "2px 8px",
                        borderRadius: 6,
                      }}
                    >
                      {typeLabels[notification.type]}
                    </span>
                  </div>

                  {/* Preview / expanded body */}
                  <p
                    className="text-sm"
                    style={{
                      color: "rgba(0,0,0,0.55)",
                      lineHeight: 1.6,
                      marginBottom: 4,
                      ...(isExpanded ? {} : {
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap" as const,
                      }),
                    }}
                  >
                    {notification.body}
                  </p>

                  <span className="text-xs" style={{ color: "rgba(0,0,0,0.28)" }}>
                    {timeAgo(notification.createdAt)}
                  </span>
                </div>

                {/* Expand indicator */}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="rgba(0,0,0,0.28)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    flexShrink: 0,
                    marginTop: 4,
                    transition: "transform 200ms",
                    transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                  }}
                >
                  <path d="M4 6l4 4 4-4" />
                </svg>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <p className="text-sm" style={{ color: "rgba(0,0,0,0.36)" }}>
            No {activeFilter} notifications.
          </p>
        </div>
      )}

      <div style={{ marginTop: 32 }}>
        <InsightTypesGuide />
      </div>
    </div>
  );
}

function PageHeader({ unreadCount }: { unreadCount: number }) {
  return (
    <>
      <div className="flex items-center" style={{ gap: 12, marginBottom: 8, justifyContent: "space-between" }}>
        <div className="flex items-center" style={{ gap: 12 }}>
          <h1
            className="font-bold"
            style={{ fontSize: 24, color: "#0A0A0A", fontFamily: "var(--font-family-display)" }}
          >
            Insights
          </h1>
          {unreadCount > 0 && (
            <span
              className="text-xs font-bold"
              style={{
                backgroundColor: "#3B82F6",
                color: "#fff",
                padding: "2px 10px",
                borderRadius: 12,
              }}
            >
              {unreadCount} new
            </span>
          )}
        </div>
        <ContextualPrompt placeholder="Ask about trends and insights..." />
      </div>
      <p className="text-sm" style={{ color: "rgba(0,0,0,0.55)", marginBottom: 32, lineHeight: 1.6 }}>
        Automated financial insights and alerts generated from your ledger activity.
        Ledge analyzes your transactions to surface summaries, anomalies, and action items.
      </p>
    </>
  );
}

function NotificationIconSvg() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function InsightTypesGuide() {
  return (
    <div>
      <div className="section-label" style={{ marginBottom: 16 }}>Insight Types</div>
      <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 12 }}>
        {insightTypes.map((insight) => (
          <div key={insight.type} className="card" style={{ padding: 20 }}>
            <div className="flex items-center" style={{ gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 18 }}>{insight.icon}</span>
              <span className="text-sm font-medium" style={{ color: "#0A0A0A" }}>
                {insight.label}
              </span>
            </div>
            <p className="text-xs" style={{ color: "rgba(0,0,0,0.36)", lineHeight: 1.6 }}>
              {insight.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

const insightTypes = [
  {
    type: "monthly_summary",
    icon: "📊",
    label: "Monthly Summary",
    description: "End-of-month revenue, expenses, and net income with period-over-period comparison.",
  },
  {
    type: "cash_position",
    icon: "💰",
    label: "Cash Position",
    description: "Current cash balances, burn rate, and estimated runway across all cash accounts.",
  },
  {
    type: "anomaly",
    icon: "⚠️",
    label: "Anomaly Detection",
    description: "Unusual transactions, suspected duplicates, and unexpected balance changes.",
  },
  {
    type: "unclassified_transactions",
    icon: "📂",
    label: "Unclassified Transactions",
    description: "Transactions posted to catch-all or suspense accounts that need proper categorization.",
  },
  {
    type: "sync_complete",
    icon: "✅",
    label: "Sync Complete",
    description: "Bank feed sync completed with match status summary.",
  },
  {
    type: "reconciliation_needed",
    icon: "🔄",
    label: "Reconciliation Needed",
    description: "Bank transactions that could not be automatically matched to ledger entries.",
  },
];

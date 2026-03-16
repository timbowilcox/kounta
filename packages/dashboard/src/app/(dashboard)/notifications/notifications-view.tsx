"use client";

import { useState, useTransition } from "react";
import type { Notification, NotificationSeverity, NotificationStatus, NotificationType } from "@kounta/sdk";

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
  receipt_prompt: "Receipt Prompt",
  monthly_recognition_summary: "Revenue Recognition",
  schedule_completion: "Schedule Complete",
  large_deferred_balance: "Deferred Revenue",
  capitalisation_check: "Capitalisation",
  system: "System",
};

function TypeIcon({ type, size = 16 }: { type: NotificationType; size?: number }) {
  const stroke = "var(--text-tertiary)";
  const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke, strokeWidth: "1.5", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (type) {
    case "monthly_summary": return (
      <svg {...props}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
    );
    case "cash_position": return (
      <svg {...props}><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" /></svg>
    );
    case "anomaly": return (
      <svg {...props}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
    );
    case "unclassified_transactions": return (
      <svg {...props}><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3" /><path d="M2 8V6a2 2 0 0 1 2-2h16" /></svg>
    );
    case "sync_complete": return (
      <svg {...props}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
    );
    case "reconciliation_needed": return (
      <svg {...props}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
    );
    case "receipt_prompt": return (
      <svg {...props}><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" /><path d="M12 17.5v-11" /></svg>
    );
    case "monthly_recognition_summary": return (
      <svg {...props}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
    );
    case "schedule_completion": return (
      <svg {...props}><polyline points="20 6 9 17 4 12" /></svg>
    );
    case "large_deferred_balance": return (
      <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
    );
    case "capitalisation_check": return (
      <svg {...props}><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M12 12h.01" /><path d="M17 12h.01" /><path d="M7 12h.01" /></svg>
    );
    case "system": return (
      <svg {...props}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
    );
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
        <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", minHeight: 160, padding: "3rem 2rem" }}>
          <div style={{ marginBottom: "1rem" }}>
            <NotificationIconSvg />
          </div>
          <h2
            className="font-bold"
            style={{ fontSize: "1.125rem", color: "var(--text-primary)", marginBottom: "0.5rem", fontFamily: "var(--font-family-display)" }}
          >
            Upgrade to Enable Insights
          </h2>
          <p className="text-sm" style={{ color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: "26.25rem" }}>
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
        <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", minHeight: 160, padding: "3rem 2rem" }}>
          <div style={{ marginBottom: "1rem" }}>
            <NotificationIconSvg />
          </div>
          <h2
            className="font-bold"
            style={{ fontSize: "1.125rem", color: "var(--text-primary)", marginBottom: "0.5rem", fontFamily: "var(--font-family-display)" }}
          >
            No Notifications Yet
          </h2>
          <p className="text-sm" style={{ color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: "26.25rem" }}>
            Kounta generates financial insights automatically as you use the ledger. Post transactions,
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
                backgroundColor: activeFilter === tab ? "var(--surface-1)" : "transparent",
                color: activeFilter === tab ? "var(--text-primary)" : "var(--text-tertiary)",
                border: activeFilter === tab ? "1px solid var(--border-strong)" : "1px solid transparent",
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
                borderLeft: isUnread ? "3px solid var(--accent)" : "3px solid transparent",
                transition: "all 200ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
              onClick={() => setExpandedId(isExpanded ? null : notification.id)}
            >
              <div className="flex items-start" style={{ gap: 14 }}>
                {/* Icon */}
                <span style={{ flexShrink: 0, lineHeight: 0, marginTop: 2 }}>
                  <TypeIcon type={notification.type} size={16} />
                </span>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex items-center" style={{ gap: 8, marginBottom: 4 }}>
                    <span
                      className="text-sm font-medium"
                      style={{ color: "var(--text-primary)", fontWeight: isUnread ? 600 : 500 }}
                    >
                      {notification.title}
                    </span>
                    <span className={badge.className}>{badge.label}</span>
                    <span
                      className="text-xs"
                      style={{
                        color: "var(--text-tertiary)",
                        backgroundColor: "var(--surface-1)",
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
                      color: "var(--text-secondary)",
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

                  <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    {timeAgo(notification.createdAt)}
                  </span>
                </div>

                {/* Expand indicator */}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="var(--text-tertiary)"
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
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
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
      <div className="flex items-center" style={{ gap: 12, marginBottom: 8 }}>
        <h1
          className="font-bold"
          style={{ fontSize: 24, color: "var(--text-primary)", fontFamily: "var(--font-family-display)" }}
        >
          Insights
        </h1>
        {unreadCount > 0 && (
          <span
            className="text-xs font-bold"
            style={{
              backgroundColor: "var(--accent)",
              color: "var(--text-primary)",
              padding: "2px 10px",
              borderRadius: 12,
            }}
          >
            {unreadCount} new
          </span>
        )}
      </div>
      <p className="text-sm" style={{ color: "var(--text-secondary)", marginBottom: 32, lineHeight: 1.6 }}>
        Automated financial insights and alerts generated from your ledger activity.
        Kounta analyzes your transactions to surface summaries, anomalies, and action items.
      </p>
    </>
  );
}

function NotificationIconSvg() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function InsightTypesGuide() {
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 12 }}>
        {insightTypes.map((insight) => (
          <div
            key={insight.type}
            className="insight-type-card"
            style={{
              backgroundColor: "var(--surface-1)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: "16px 20px",
              cursor: "default",
              transition: "all 150ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--border-strong)";
              const icon = e.currentTarget.querySelector(".insight-type-icon") as HTMLElement;
              if (icon) icon.style.color = "var(--text-secondary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
              const icon = e.currentTarget.querySelector(".insight-type-icon") as HTMLElement;
              if (icon) icon.style.color = "var(--text-tertiary)";
            }}
          >
            <div className="flex items-center" style={{ gap: 10, marginBottom: 6 }}>
              <span className="insight-type-icon" style={{ color: "var(--text-tertiary)", lineHeight: 0, flexShrink: 0, transition: "color 150ms ease" }}>
                <TypeIcon type={insight.type as NotificationType} size={16} />
              </span>
              <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
                {insight.label}
              </span>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.5, marginLeft: 26 }}>
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
    label: "Monthly Summary",
    description: "End-of-month P&L with period-over-period comparison",
  },
  {
    type: "cash_position",
    label: "Cash Position",
    description: "Live balance, burn rate, and estimated runway",
  },
  {
    type: "anomaly",
    label: "Anomaly Detection",
    description: "Unusual transactions and unexpected balance changes",
  },
  {
    type: "unclassified_transactions",
    label: "Unclassified Transactions",
    description: "Entries posted to catch-all accounts needing categorisation",
  },
  {
    type: "sync_complete",
    label: "Sync Complete",
    description: "Bank feed sync summary with match status",
  },
  {
    type: "reconciliation_needed",
    label: "Reconciliation Needed",
    description: "Transactions that couldn't be automatically matched",
  },
  {
    type: "capitalisation_check",
    label: "Capitalisation Check",
    description: "Large expenses that may need to be recorded as fixed assets",
  },
];

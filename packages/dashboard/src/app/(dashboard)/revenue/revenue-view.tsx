"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/format";
import { ContextualPrompt } from "@/components/contextual-prompt";
import {
  fetchRevenueMetrics,
  fetchRevenueSchedules,
  fetchRevenueSchedule,
  updateRevenueScheduleAction,
} from "@/lib/actions";
import type {
  RevenueMetricsSummary,
  MrrHistoryPoint,
  RevenueScheduleSummary,
  RevenueScheduleEntrySummary,
} from "@/lib/actions";
import { CreateScheduleModal } from "./create-schedule-modal";
import type { AccountWithBalance } from "@kounta/sdk";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  initialMetrics: RevenueMetricsSummary;
  initialMrrHistory: MrrHistoryPoint[];
  initialSchedules: RevenueScheduleSummary[];
  accounts: AccountWithBalance[];
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function RevenueView({ initialMetrics, initialMrrHistory, initialSchedules, accounts }: Props) {
  const [metrics, setMetrics] = useState(initialMetrics);
  const [mrrHistory] = useState(initialMrrHistory);
  const [schedules, setSchedules] = useState(initialSchedules);
  const [filter, setFilter] = useState<"active" | "completed" | "all">("active");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedEntries, setExpandedEntries] = useState<RevenueScheduleEntrySummary[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [isPending, startTransition] = useTransition();

  const filteredSchedules = filter === "all"
    ? schedules
    : schedules.filter((s) => s.status === filter);

  const refresh = () => {
    startTransition(async () => {
      const [m, s] = await Promise.allSettled([
        fetchRevenueMetrics(),
        fetchRevenueSchedules(),
      ]);
      if (m.status === "fulfilled") setMetrics(m.value);
      if (s.status === "fulfilled") setSchedules(s.value.data);
    });
  };

  const handleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedEntries([]);
      return;
    }
    setExpandedId(id);
    startTransition(async () => {
      const detail = await fetchRevenueSchedule(id);
      if (detail) setExpandedEntries(detail.entries);
    });
  };

  const handleAction = (id: string, action: "pause" | "cancel" | "resume") => {
    startTransition(async () => {
      await updateRevenueScheduleAction(id, action);
      refresh();
    });
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "#0A0A0A", marginBottom: 4 }}>
            Revenue
          </h1>
          <p style={{ fontSize: 13, color: "#999999" }}>
            Revenue recognition schedules, MRR, and deferred revenue
          </p>
        </div>
        <div className="flex items-center" style={{ gap: 8 }}>
          <ContextualPrompt placeholder="Ask about your revenue..." />
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary flex items-center"
            style={{ gap: 6, height: 34, padding: "0 14px", fontSize: 13 }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
            Create schedule
          </button>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-4" style={{ gap: 16, marginBottom: 32 }}>
        <MetricCard label="MRR" value={`${formatCurrency(metrics.mrr)}/mo`} />
        <MetricCard label="ARR" value={formatCurrency(metrics.arr)} />
        <MetricCard label="Deferred Revenue" value={formatCurrency(metrics.deferredRevenueBalance)} />
        <MetricCard label="Recognised This Month" value={formatCurrency(metrics.recognisedThisMonth)} />
      </div>

      {/* MRR Trend chart */}
      {mrrHistory.length > 0 && (
        <div className="card" style={{ padding: 20, marginBottom: 32 }}>
          <div className="section-label" style={{ marginBottom: 16 }}>MRR Trend</div>
          <MrrChart data={mrrHistory} />
        </div>
      )}

      {/* Revenue schedules */}
      <div className="card" style={{ padding: 0 }}>
        <div className="flex items-center justify-between" style={{ padding: "16px 20px", borderBottom: "1px solid #E5E5E5" }}>
          <div className="flex items-center" style={{ gap: 0 }}>
            {(["active", "completed", "all"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                style={{
                  padding: "6px 16px",
                  fontSize: 13,
                  fontWeight: filter === tab ? 600 : 400,
                  color: filter === tab ? "#0066FF" : "#666666",
                  backgroundColor: "transparent",
                  border: "none",
                  borderBottom: filter === tab ? "2px solid #0066FF" : "2px solid transparent",
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {tab}
              </button>
            ))}
          </div>
          <button onClick={refresh} className="btn-ghost" style={{ fontSize: 12, height: 28, padding: "0 8px" }} disabled={isPending}>
            {isPending ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Customer</th>
              <th className="table-header">Description</th>
              <th className="table-header text-right">Total</th>
              <th className="table-header" style={{ width: 180 }}>Progress</th>
              <th className="table-header">Status</th>
              <th className="table-header">Period</th>
              <th className="table-header" style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {filteredSchedules.length === 0 && (
              <tr>
                <td colSpan={7} className="table-cell text-center" style={{ padding: 48 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "#0A0A0A", marginBottom: 4 }}>
                    No {filter === "all" ? "" : filter} schedules
                  </div>
                  <div style={{ fontSize: 13, color: "#999999" }}>
                    Revenue schedules are created automatically from Stripe subscriptions or manually.
                  </div>
                </td>
              </tr>
            )}
            {filteredSchedules.map((s) => (
              <ScheduleRow
                key={s.id}
                schedule={s}
                expanded={expandedId === s.id}
                entries={expandedId === s.id ? expandedEntries : []}
                onExpand={() => handleExpand(s.id)}
                onAction={handleAction}
                isPending={isPending}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Create schedule modal */}
      {showCreate && (
        <CreateScheduleModal
          accounts={accounts}
          onClose={() => setShowCreate(false)}
          onCreated={refresh}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric card
// ---------------------------------------------------------------------------

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MRR Chart (SVG)
// ---------------------------------------------------------------------------

function MrrChart({ data }: { data: MrrHistoryPoint[] }) {
  const width = 720;
  const height = 200;
  const padLeft = 60;
  const padRight = 20;
  const padTop = 10;
  const padBottom = 30;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const values = data.map((d) => d.mrr);
  const maxVal = Math.max(...values, 1);

  const points = data.map((d, i) => {
    const x = padLeft + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = padTop + chartH - (d.mrr / maxVal) * chartH;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? padLeft} ${padTop + chartH} L ${padLeft} ${padTop + chartH} Z`;

  // Y-axis labels (5 ticks)
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const val = (maxVal / 4) * i;
    const y = padTop + chartH - (val / maxVal) * chartH;
    return { val, y };
  });

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible" }}>
      {/* Grid lines */}
      {yTicks.map((t, i) => (
        <line key={i} x1={padLeft} y1={t.y} x2={width - padRight} y2={t.y} stroke="#F0F0F0" strokeWidth="1" />
      ))}

      {/* Y-axis labels */}
      {yTicks.map((t, i) => (
        <text key={i} x={padLeft - 8} y={t.y + 4} textAnchor="end" fill="#999999" fontSize="10" fontFamily="var(--font-geist-mono, monospace)">
          {formatCurrency(t.val)}
        </text>
      ))}

      {/* Area fill */}
      <path d={areaPath} fill="#0066FF" opacity="0.06" />

      {/* Line */}
      <path d={linePath} fill="none" stroke="#0066FF" strokeWidth="2" strokeLinejoin="round" />

      {/* Data points */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="#FFFFFF" stroke="#0066FF" strokeWidth="1.5" />
      ))}

      {/* X-axis labels */}
      {points.map((p, i) => (
        <text key={i} x={p.x} y={height - 4} textAnchor="middle" fill="#999999" fontSize="10" fontFamily="var(--font-geist-mono, monospace)">
          {p.month.slice(5)}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Schedule row (expandable)
// ---------------------------------------------------------------------------

function ScheduleRow({
  schedule: s,
  expanded,
  entries,
  onExpand,
  onAction,
  isPending,
}: {
  schedule: RevenueScheduleSummary;
  expanded: boolean;
  entries: RevenueScheduleEntrySummary[];
  onExpand: () => void;
  onAction: (id: string, action: "pause" | "cancel" | "resume") => void;
  isPending: boolean;
}) {
  const pct = s.totalAmount > 0 ? Math.round((s.amountRecognised / s.totalAmount) * 100) : 0;

  return (
    <>
      <tr
        className="table-row"
        onClick={onExpand}
        style={{ cursor: "pointer" }}
      >
        <td className="table-cell" style={{ fontSize: 13, fontWeight: 500, color: "#0A0A0A" }}>
          {s.customerName ?? "—"}
        </td>
        <td className="table-cell" style={{ fontSize: 13, color: "#666666" }}>
          {s.description ?? s.sourceRef ?? "—"}
        </td>
        <td className="table-cell text-right font-mono" style={{ fontSize: 13 }}>
          {formatCurrency(s.totalAmount)}
        </td>
        <td className="table-cell">
          <div className="flex items-center" style={{ gap: 8 }}>
            <div style={{ flex: 1, height: 6, backgroundColor: "#F0F0F0", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", backgroundColor: "#0066FF", borderRadius: 3, transition: "width 300ms ease" }} />
            </div>
            <span style={{ fontSize: 11, color: "#999999", fontFamily: "var(--font-geist-mono, monospace)", whiteSpace: "nowrap" }}>
              {pct}%
            </span>
          </div>
        </td>
        <td className="table-cell">
          <StatusBadge status={s.status} />
        </td>
        <td className="table-cell" style={{ fontSize: 12, color: "#999999", fontFamily: "var(--font-geist-mono, monospace)", whiteSpace: "nowrap" }}>
          {s.recognitionStart.slice(0, 7)} &rarr; {s.recognitionEnd.slice(0, 7)}
        </td>
        <td className="table-cell text-center">
          <svg
            width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#999999" strokeWidth="1.5" strokeLinecap="round"
            style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 150ms ease" }}
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={7} style={{ padding: 0 }}>
            <div style={{ padding: "16px 20px", backgroundColor: "#FAFAFA", borderTop: "1px solid #F0F0F0" }}>
              {/* Actions */}
              <div className="flex items-center" style={{ gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#666666", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Schedule detail
                </span>
                <div style={{ flex: 1 }} />
                {s.status === "active" && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); onAction(s.id, "pause"); }}
                      className="btn-ghost"
                      style={{ fontSize: 12, height: 26, padding: "0 8px", color: "#D97706" }}
                      disabled={isPending}
                    >
                      Pause
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onAction(s.id, "cancel"); }}
                      className="btn-ghost"
                      style={{ fontSize: 12, height: 26, padding: "0 8px", color: "#DC2626" }}
                      disabled={isPending}
                    >
                      Cancel
                    </button>
                  </>
                )}
                {s.status === "paused" && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onAction(s.id, "resume"); }}
                    className="btn-ghost"
                    style={{ fontSize: 12, height: 26, padding: "0 8px", color: "#0066FF" }}
                    disabled={isPending}
                  >
                    Resume
                  </button>
                )}
              </div>

              {/* Summary */}
              <div className="grid grid-cols-4" style={{ gap: 12, marginBottom: 16 }}>
                <MiniStat label="Recognised" value={formatCurrency(s.amountRecognised)} />
                <MiniStat label="Remaining" value={formatCurrency(s.amountRemaining)} />
                <MiniStat label="Frequency" value={s.frequency} />
                <MiniStat label="Source" value={s.sourceType} />
              </div>

              {/* Entries timeline */}
              <div style={{ borderRadius: 6, border: "1px solid #E5E5E5", backgroundColor: "#FFFFFF", overflow: "hidden" }}>
                <table className="w-full" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th className="table-header" style={{ fontSize: 11 }}>Period</th>
                      <th className="table-header text-right" style={{ fontSize: 11 }}>Amount</th>
                      <th className="table-header text-center" style={{ fontSize: 11 }}>Status</th>
                      <th className="table-header" style={{ fontSize: 11 }}>Transaction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id} className="table-row">
                        <td className="table-cell font-mono" style={{ color: "#666666" }}>
                          {e.periodStart} &rarr; {e.periodEnd}
                        </td>
                        <td className="table-cell text-right font-mono">
                          {formatCurrency(e.amount)}
                        </td>
                        <td className="table-cell text-center">
                          {e.status === "posted" && <span style={{ color: "#00A854" }}>&#10003;</span>}
                          {e.status === "pending" && <span style={{ color: "#999999" }}>&#9675;</span>}
                          {e.status === "skipped" && <span style={{ color: "#DC2626" }}>&#10005;</span>}
                        </td>
                        <td className="table-cell">
                          {e.transactionId ? (
                            <Link
                              href={`/transactions?id=${e.transactionId}`}
                              style={{ color: "#0066FF", fontSize: 11, fontFamily: "var(--font-geist-mono, monospace)" }}
                              onClick={(ev) => ev.stopPropagation()}
                            >
                              {e.transactionId.slice(0, 8)}...
                            </Link>
                          ) : (
                            <span style={{ color: "#CCCCCC" }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {entries.length === 0 && (
                      <tr>
                        <td colSpan={4} className="table-cell text-center" style={{ padding: 24, color: "#999999" }}>
                          Loading entries...
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { dot: string; text: string }> = {
    active: { dot: "#00A854", text: "#00A854" },
    completed: { dot: "#999999", text: "#999999" },
    paused: { dot: "#D97706", text: "#D97706" },
    cancelled: { dot: "#DC2626", text: "#DC2626" },
  };
  const c = colors[status] ?? colors["active"]!;

  return (
    <span className="flex items-center" style={{ gap: 5, fontSize: 12 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: c.dot, display: "inline-block" }} />
      <span style={{ color: c.text, textTransform: "capitalize" }}>{status}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Mini stat (used in expanded detail)
// ---------------------------------------------------------------------------

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "8px 12px", backgroundColor: "#FFFFFF", border: "1px solid #E5E5E5", borderRadius: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "#999999", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, color: "#0A0A0A", fontFamily: "var(--font-geist-mono, monospace)" }}>
        {value}
      </div>
    </div>
  );
}

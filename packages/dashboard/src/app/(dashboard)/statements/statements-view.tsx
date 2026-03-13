"use client";

import { useState, useTransition } from "react";
import { formatCurrency } from "@/lib/format";
import {
  fetchIncomeStatement,
  fetchBalanceSheet,
  fetchCashFlow,
  closePeriodAction,
} from "@/lib/actions";
import type { ClosedPeriodSummary } from "@/lib/actions";
import type { StatementResponse } from "@ledge/sdk";
import { ContextualPrompt } from "@/components/contextual-prompt";

type Tab = "pnl" | "balance_sheet" | "cash_flow";

const tabs: { key: Tab; label: string }[] = [
  { key: "pnl", label: "Profit & Loss" },
  { key: "balance_sheet", label: "Balance Sheet" },
  { key: "cash_flow", label: "Cash Flow" },
];

interface Props {
  initialPnl: StatementResponse;
  initialBalanceSheet: StatementResponse;
  initialCashFlow: StatementResponse;
  defaultStart: string;
  defaultEnd: string;
  fiscalYearStart?: number;
  closedThrough?: string | null;
  closedPeriods?: ClosedPeriodSummary[];
}

export function StatementsView({
  initialPnl,
  initialBalanceSheet,
  initialCashFlow,
  defaultStart,
  defaultEnd,
  fiscalYearStart = 1,
  closedThrough = null,
  closedPeriods = [],
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("pnl");
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [statements, setStatements] = useState<Record<Tab, StatementResponse>>({
    pnl: initialPnl,
    balance_sheet: initialBalanceSheet,
    cash_flow: initialCashFlow,
  });
  const [isPending, startTransition] = useTransition();
  const [closing, startClosing] = useTransition();
  const [currentClosedThrough, setCurrentClosedThrough] = useState(closedThrough);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const statement = statements[activeTab];

  const refresh = (start?: string, end?: string) => {
    const s = start ?? startDate;
    const e = end ?? endDate;
    startTransition(async () => {
      const [pnl, bs, cf] = await Promise.all([
        fetchIncomeStatement(s, e),
        fetchBalanceSheet(e),
        fetchCashFlow(s, e),
      ]);
      setStatements({ pnl, balance_sheet: bs, cash_flow: cf });
    });
  };

  // Period presets — fiscal-year-aware
  const presets = buildPresets(fiscalYearStart);
  const applyPreset = (preset: { label: string; start: string; end: string }) => {
    setStartDate(preset.start);
    setEndDate(preset.end);
    setActivePreset(preset.label);
    refresh(preset.start, preset.end);
  };

  // Close period handler
  const handleClosePeriod = () => {
    startClosing(async () => {
      await closePeriodAction(endDate);
      setCurrentClosedThrough(endDate);
    });
  };

  // Check if the current period includes closed dates
  const includesClosedPeriod = currentClosedThrough && endDate >= (currentClosedThrough ?? "");
  const closedThroughMonth = currentClosedThrough
    ? new Date(currentClosedThrough + "T00:00:00").toLocaleString("en-US", { month: "long", year: "numeric" })
    : null;
  const isPeriodFullyClosed = currentClosedThrough && startDate <= currentClosedThrough && endDate <= currentClosedThrough;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#0A0A0A" }}>
          Statements
        </h1>
        <ContextualPrompt placeholder="Generate or ask about statements..." />
      </div>

      {/* Underline tab selector */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid #E5E5E5",
          marginBottom: 24,
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "#0066FF" : "#999999",
                background: "none",
                border: "none",
                borderBottom: isActive ? "2px solid #0066FF" : "2px solid transparent",
                cursor: "pointer",
                transition: "all 150ms ease",
                marginBottom: -1,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Period presets */}
      <div className="flex flex-wrap items-center" style={{ gap: 6, marginBottom: 16 }}>
        {presets.map((p) => {
          const isActive = activePreset === p.label;
          return (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                color: isActive ? "#0066FF" : "#666666",
                backgroundColor: isActive ? "#F0F6FF" : "#F5F5F5",
                border: "none",
                cursor: "pointer",
                transition: "all 150ms ease",
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Date range */}
      <div className="flex items-center" style={{ gap: 12, marginBottom: 24 }}>
        <div>
          <label className="section-label block" style={{ marginBottom: 4 }}>Start</label>
          <input
            type="date"
            className="input"
            style={{ width: 160 }}
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setActivePreset(null); }}
          />
        </div>
        <div>
          <label className="section-label block" style={{ marginBottom: 4 }}>End</label>
          <input
            type="date"
            className="input"
            style={{ width: 160 }}
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setActivePreset(null); }}
          />
        </div>
        <div style={{ alignSelf: "flex-end" }}>
          <button className="btn-primary" onClick={() => { setActivePreset(null); refresh(); }} disabled={isPending}>
            {isPending ? "Loading..." : "Refresh"}
          </button>
        </div>
        {/* Close period button */}
        {!isPeriodFullyClosed && (
          <div style={{ alignSelf: "flex-end", marginLeft: "auto" }}>
            <button
              onClick={handleClosePeriod}
              disabled={closing}
              style={{
                padding: "0 14px",
                height: 36,
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                color: "#D97706",
                backgroundColor: "#FFFBEB",
                border: "1px solid #FDE68A",
                cursor: closing ? "wait" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="7" width="10" height="8" rx="1.5" />
                <path d="M5 7V5a3 3 0 0 1 6 0v2" />
              </svg>
              {closing ? "Closing..." : "Close period"}
            </button>
          </div>
        )}
      </div>

      {/* Closed period indicator */}
      {isPeriodFullyClosed && (
        <div
          style={{
            borderRadius: 8,
            padding: "12px 20px",
            marginBottom: 16,
            backgroundColor: "#F5F5F5",
            border: "1px solid #E5E5E5",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#666666" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="7" width="10" height="8" rx="1.5" />
            <path d="M5 7V5a3 3 0 0 1 6 0v2" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 500, color: "#666666" }}>
            This period is closed. Numbers are locked.
          </span>
        </div>
      )}
      {includesClosedPeriod && !isPeriodFullyClosed && closedThroughMonth && (
        <div
          style={{
            borderRadius: 8,
            padding: "12px 20px",
            marginBottom: 16,
            backgroundColor: "#FFFBEB",
            border: "1px solid #FDE68A",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="7" width="10" height="8" rx="1.5" />
            <path d="M5 7V5a3 3 0 0 1 6 0v2" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 500, color: "#92400E" }}>
            Includes closed periods through {closedThroughMonth}.
          </span>
        </div>
      )}

      {/* Plain-language summary */}
      <div
        style={{
          borderRadius: 8,
          padding: 20,
          marginBottom: 24,
          backgroundColor: "#FFFFFF",
          border: "1px solid #E5E5E5",
        }}
      >
        <p style={{ fontSize: 13, color: "#666666", lineHeight: 1.7 }}>
          {statement.plainLanguageSummary}
        </p>
      </div>

      {/* Statement table */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "16px 20px" }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>
            {formatStatementTitle(statement.statementType)}
          </h2>
          <span style={{ fontSize: 12, color: "#999999" }}>
            {activeTab === "balance_sheet"
              ? "As of " + endDate
              : startDate + " to " + endDate}
          </span>
        </div>

        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header" style={{ position: "sticky", top: 0, zIndex: 1 }}>Account</th>
              <th className="table-header text-right" style={{ width: 160, position: "sticky", top: 0, zIndex: 1 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {statement.sections.map((section) => (
              <SectionRows key={section.name} section={section} />
            ))}

            {Object.entries(statement.totals).map(([key, value]) => {
              const isGrand = key === "netIncome" || key === "netChange" || key === "grossProfit";
              return (
                <tr key={key} className={isGrand ? "grand-total-row" : ""} style={!isGrand ? { backgroundColor: "#FAFAFA" } : undefined}>
                  <td
                    style={{
                      padding: "12px 20px",
                      fontSize: 13,
                      fontWeight: 600,
                      borderTop: "1px solid #E5E5E5",
                      color: isGrand ? "white" : "#0A0A0A",
                    }}
                  >
                    {formatTotalLabel(key)}
                  </td>
                  <td
                    className="font-mono text-right"
                    style={{
                      padding: "12px 20px",
                      fontSize: 13,
                      fontWeight: 600,
                      borderTop: "1px solid #E5E5E5",
                      color: isGrand ? "white" : "#0A0A0A",
                    }}
                  >
                    {key === "debtToEquity"
                      ? (value / 100).toFixed(2)
                      : formatCurrency(Math.abs(value))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionRows({ section }: { section: StatementResponse["sections"][number] }) {
  return (
    <>
      {/* Section header */}
      <tr>
        <td
          colSpan={2}
          style={{
            padding: "16px 20px 8px",
            fontSize: 12,
            fontWeight: 500,
            color: "#999999",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {section.name}
        </td>
      </tr>

      {/* Line items */}
      {section.lines.map((line) => (
        <tr
          key={line.accountCode + line.accountName}
          className="table-row"
        >
          <td className="table-cell" style={{ paddingLeft: 32, fontSize: 13 }}>
            {line.accountCode && (
              <code className="font-mono" style={{ fontSize: 12, color: "#666666", marginRight: 8 }}>
                {line.accountCode}
              </code>
            )}
            <span style={{ color: "#666666" }}>{line.accountName}</span>
          </td>
          <td
            className="table-cell text-right font-mono"
            style={{
              fontSize: 13,
              color: line.currentPeriod < 0 ? "#DC2626" : "#0A0A0A",
            }}
          >
            {line.currentPeriod < 0 ? "(" : ""}
            {formatCurrency(Math.abs(line.currentPeriod))}
            {line.currentPeriod < 0 ? ")" : ""}
          </td>
        </tr>
      ))}

      {/* Section total */}
      <tr style={{ backgroundColor: "#FAFAFA" }}>
        <td
          style={{
            paddingLeft: 32,
            padding: "10px 20px 10px 32px",
            borderTop: "1px solid #E5E5E5",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Total {section.name}
        </td>
        <td
          className="text-right font-mono"
          style={{
            padding: "10px 20px",
            borderTop: "1px solid #E5E5E5",
            fontSize: 13,
            fontWeight: 600,
            color: section.total < 0 ? "#DC2626" : "#0A0A0A",
          }}
        >
          {section.total < 0 ? "(" : ""}
          {formatCurrency(Math.abs(section.total))}
          {section.total < 0 ? ")" : ""}
        </td>
      </tr>
    </>
  );
}

function formatStatementTitle(type: string): string {
  const titles: Record<string, string> = {
    income_statement: "Profit & Loss Statement",
    pnl: "Profit & Loss Statement",
    balance_sheet: "Balance Sheet",
    cash_flow: "Cash Flow Statement",
  };
  return titles[type] ?? type;
}

function formatTotalLabel(key: string): string {
  const labels: Record<string, string> = {
    totalRevenue: "Total Revenue",
    totalCogs: "Cost of Goods Sold",
    grossProfit: "Gross Profit",
    totalOperatingExpenses: "Total Operating Expenses",
    operatingIncome: "Operating Income",
    netIncome: "Net Income",
    totalAssets: "Total Assets",
    totalLiabilities: "Total Liabilities",
    totalEquity: "Total Equity",
    totalLiabilitiesAndEquity: "Total Liabilities & Equity",
    debtToEquity: "Debt-to-Equity Ratio",
    netChange: "Net Change in Cash",
    totalOperating: "Cash from Operations",
    totalInvesting: "Cash from Investing",
    totalFinancing: "Cash from Financing",
  };
  return labels[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim();
}

// ---------------------------------------------------------------------------
// Period preset builder — fiscal-year-aware
// ---------------------------------------------------------------------------

function buildPresets(fiscalYearStart: number): { label: string; start: string; end: string }[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed

  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const lastDay = (year: number, month: number) => new Date(year, month + 1, 0);
  const firstDay = (year: number, month: number) => new Date(year, month, 1);

  // This month
  const thisMonthStart = firstDay(y, m);
  const thisMonthEnd = lastDay(y, m);

  // Last month
  const lastMonthStart = firstDay(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1);
  const lastMonthEnd = lastDay(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1);

  // This quarter (calendar)
  const qStart = Math.floor(m / 3) * 3;
  const thisQStart = firstDay(y, qStart);
  const thisQEnd = lastDay(y, qStart + 2);

  // Last quarter
  const lqStart = qStart === 0 ? 9 : qStart - 3;
  const lqYear = qStart === 0 ? y - 1 : y;
  const lastQStart = firstDay(lqYear, lqStart);
  const lastQEnd = lastDay(lqYear, lqStart + 2);

  // This calendar year
  const thisYearStart = firstDay(y, 0);
  const thisYearEnd = lastDay(y, 11);

  // Last calendar year
  const lastYearStart = firstDay(y - 1, 0);
  const lastYearEnd = lastDay(y - 1, 11);

  // Fiscal year (uses fiscalYearStart, 1-indexed month)
  const fyMonth = fiscalYearStart - 1; // 0-indexed
  const thisFYStartYear = m >= fyMonth ? y : y - 1;
  const thisFYStart = firstDay(thisFYStartYear, fyMonth);
  const thisFYEnd = lastDay(thisFYStartYear + 1, fyMonth - 1 < 0 ? 11 : fyMonth - 1);

  const lastFYStart = firstDay(thisFYStartYear - 1, fyMonth);
  const lastFYEnd = lastDay(thisFYStartYear, fyMonth - 1 < 0 ? 11 : fyMonth - 1);

  return [
    { label: "This month", start: fmt(thisMonthStart), end: fmt(thisMonthEnd) },
    { label: "Last month", start: fmt(lastMonthStart), end: fmt(lastMonthEnd) },
    { label: "This quarter", start: fmt(thisQStart), end: fmt(thisQEnd) },
    { label: "Last quarter", start: fmt(lastQStart), end: fmt(lastQEnd) },
    { label: "This year", start: fmt(thisYearStart), end: fmt(thisYearEnd) },
    { label: "Last year", start: fmt(lastYearStart), end: fmt(lastYearEnd) },
    { label: "This FY", start: fmt(thisFYStart), end: fmt(thisFYEnd) },
    { label: "Last FY", start: fmt(lastFYStart), end: fmt(lastFYEnd) },
  ];
}

"use client";

import { useState, useTransition } from "react";
import { formatCurrency } from "@/lib/format";
import {
  fetchIncomeStatement,
  fetchBalanceSheet,
  fetchCashFlow,
} from "@/lib/actions";
import type { StatementResponse } from "@ledge/sdk";
import { ContextualPrompt } from "@/components/contextual-prompt";

type Tab = "pnl" | "balance_sheet" | "cash_flow";

const tabs: { key: Tab; label: string }[] = [
  { key: "pnl", label: "Profit & Loss Statement" },
  { key: "balance_sheet", label: "Balance Sheet" },
  { key: "cash_flow", label: "Cash Flow Statement" },
];

interface Props {
  initialPnl: StatementResponse;
  initialBalanceSheet: StatementResponse;
  initialCashFlow: StatementResponse;
  defaultStart: string;
  defaultEnd: string;
}

export function StatementsView({
  initialPnl,
  initialBalanceSheet,
  initialCashFlow,
  defaultStart,
  defaultEnd,
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

  const statement = statements[activeTab];

  const refresh = () => {
    startTransition(async () => {
      const [pnl, bs, cf] = await Promise.all([
        fetchIncomeStatement(startDate, endDate),
        fetchBalanceSheet(endDate),
        fetchCashFlow(startDate, endDate),
      ]);
      setStatements({ pnl, balance_sheet: bs, cash_flow: cf });
    });
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <h1
          className="font-bold"
          style={{ fontSize: 24, color: "#0A0A0A", fontFamily: "var(--font-family-display)" }}
        >
          Statements
        </h1>
        <ContextualPrompt placeholder="Generate or ask about statements..." />
      </div>

      {/* Underline tab selector */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid rgba(0,0,0,0.10)",
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
                padding: "12px 20px",
                fontSize: 14,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "#3B82F6" : "rgba(0,0,0,0.36)",
                background: "none",
                border: "none",
                borderBottom: isActive ? "2px solid #3B82F6" : "2px solid transparent",
                cursor: "pointer",
                transition: "all 200ms cubic-bezier(0.16, 1, 0.3, 1)",
                marginBottom: -1,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Date range */}
      <div className="flex items-center" style={{ gap: 16, marginBottom: 24 }}>
        <div>
          <label className="section-label block" style={{ marginBottom: 8 }}>Start</label>
          <input
            type="date"
            className="input text-sm"
            style={{ width: 170 }}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label className="section-label block" style={{ marginBottom: 8 }}>End</label>
          <input
            type="date"
            className="input text-sm"
            style={{ width: 170 }}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div style={{ alignSelf: "flex-end" }}>
          <button className="btn-primary text-sm" onClick={refresh} disabled={isPending}>
            {isPending ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Plain-language summary */}
      <div
        style={{
          borderRadius: 18,
          padding: 24,
          marginBottom: 24,
          backgroundColor: "rgba(59,130,246,0.06)",
          border: "1px solid rgba(59,130,246,0.1)",
        }}
      >
        <p className="text-sm" style={{ color: "rgba(0,0,0,0.55)", lineHeight: 1.7 }}>
          {statement.plainLanguageSummary}
        </p>
      </div>

      {/* Statement table */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "20px 24px" }}>
          <h2
            className="font-bold"
            style={{ fontSize: 18, fontFamily: "var(--font-family-display)" }}
          >
            {formatStatementTitle(statement.statementType)}
          </h2>
          <span className="text-xs" style={{ color: "rgba(0,0,0,0.36)" }}>
            {activeTab === "balance_sheet"
              ? "As of " + endDate
              : startDate + " to " + endDate}
          </span>
        </div>

        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header" style={{ position: "sticky", top: 0, backgroundColor: "#F7F7F6", zIndex: 1 }}>Account</th>
              <th className="table-header text-right" style={{ width: 160, position: "sticky", top: 0, backgroundColor: "#F7F7F6", zIndex: 1 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {statement.sections.map((section) => (
              <SectionRows key={section.name} section={section} />
            ))}

            {Object.entries(statement.totals).map(([key, value]) => (
              <tr key={key} style={{ backgroundColor: (key === "netIncome" || key === "netChange" || key === "totalAssets") ? "rgba(59,130,246,0.04)" : undefined }}>
                <td
                  className="text-sm font-bold"
                  style={{
                    padding: "14px 20px",
                    borderTop: "2px solid rgba(0,0,0,0.12)",
                    color: "#0A0A0A",
                  }}
                >
                  {formatTotalLabel(key)}
                </td>
                <td
                  className="text-right font-mono text-sm font-bold"
                  style={{
                    padding: "14px 20px",
                    borderTop: "2px solid rgba(0,0,0,0.12)",
                    fontVariantNumeric: "tabular-nums",
                    color: key === "netIncome" || key === "netChange"
                      ? value >= 0 ? "#16A34A" : "#DC2626"
                      : "#0A0A0A",
                  }}
                >
                  {key === "debtToEquity"
                    ? (value / 100).toFixed(2)
                    : formatCurrency(Math.abs(value))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Section category colour mapping ────────────────────────────────────

function getSectionColor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("revenue") || lower.includes("income") || lower.includes("sales")) return "#16A34A";
  if (lower.includes("expense") || lower.includes("cost")) return "#3B82F6";
  if (lower.includes("asset")) return "#3B82F6";
  if (lower.includes("liabilit")) return "#D97706";
  if (lower.includes("equity")) return "#8B5CF6";
  if (lower.includes("operating") || lower.includes("investing") || lower.includes("financing")) return "#3B82F6";
  return "#64748B";
}

function SectionRows({ section }: { section: StatementResponse["sections"][number] }) {
  const sectionColor = getSectionColor(section.name);

  return (
    <>
      {/* Section header with colour bar */}
      <tr>
        <td
          colSpan={2}
          className="text-sm font-bold"
          style={{
            padding: "20px 20px 10px",
            color: sectionColor,
            position: "relative",
          }}
        >
          <span
            style={{
              position: "absolute",
              left: 0,
              top: 14,
              bottom: 4,
              width: 3,
              borderRadius: "0 2px 2px 0",
              backgroundColor: sectionColor,
            }}
          />
          {section.name}
        </td>
      </tr>

      {/* Line items with subtle striping */}
      {section.lines.map((line, idx) => (
        <tr
          key={line.accountCode + line.accountName}
          className="table-row"
          style={{ backgroundColor: idx % 2 === 1 ? "rgba(0,0,0,0.015)" : undefined }}
        >
          <td className="table-cell text-sm" style={{ paddingLeft: 36 }}>
            {line.accountCode && (
              <code className="font-mono text-xs" style={{ color: "#3B82F6", marginRight: 8 }}>
                {line.accountCode}
              </code>
            )}
            <span style={{ color: "rgba(0,0,0,0.55)" }}>{line.accountName}</span>
          </td>
          <td
            className="table-cell text-right font-mono text-sm"
            style={{
              color: line.currentPeriod < 0 ? "#EF4444" : "#0A0A0A",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {line.currentPeriod < 0 ? "(" : ""}
            {formatCurrency(Math.abs(line.currentPeriod))}
            {line.currentPeriod < 0 ? ")" : ""}
          </td>
        </tr>
      ))}

      {/* Section total */}
      <tr>
        <td
          className="text-sm font-medium"
          style={{
            paddingLeft: 36,
            padding: "10px 20px 10px 36px",
            borderTop: "1px solid rgba(0,0,0,0.08)",
          }}
        >
          Total {section.name}
        </td>
        <td
          className="text-right font-mono text-sm font-medium"
          style={{
            padding: "10px 20px",
            borderTop: "1px solid rgba(0,0,0,0.08)",
            color: section.total < 0 ? "#EF4444" : "#0A0A0A",
            fontVariantNumeric: "tabular-nums",
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

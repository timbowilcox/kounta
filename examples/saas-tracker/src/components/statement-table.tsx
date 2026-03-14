import { formatCurrency } from "@/lib/format";
import type { StatementResponse } from "@kounta/sdk";

export function StatementTable({
  title,
  subtitle,
  statement,
}: {
  title: string;
  subtitle: string;
  statement: StatementResponse;
}) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="px-6 py-4">
        <h2 className="text-lg font-bold text-slate-50">{title}</h2>
        <span className="text-xs" style={{ color: "#64748b" }}>
          {subtitle}
        </span>
      </div>

      <table className="w-full">
        <thead>
          <tr>
            <th className="table-header">Account</th>
            <th className="table-header text-right" style={{ width: 140 }}>
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {statement.sections.map((section) => (
            <SectionRows key={section.name} section={section} />
          ))}

          {/* Totals */}
          {Object.entries(statement.totals).map(([key, value]) => (
            <tr key={key}>
              <td
                className="px-4 py-3 text-sm font-bold text-slate-50"
                style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
              >
                {formatTotalLabel(key)}
              </td>
              <td
                className="px-4 py-3 text-right font-mono text-sm font-bold"
                style={{
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                  color:
                    key === "netIncome" || key === "netChange"
                      ? value >= 0
                        ? "#5eead4"
                        : "#ef4444"
                      : "#f8fafc",
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

      {/* Summary */}
      {statement.plainLanguageSummary && (
        <div
          className="mx-4 mb-4 rounded-xl p-4"
          style={{
            background: "rgba(13,148,136,0.06)",
            border: "1px solid rgba(13,148,136,0.12)",
          }}
        >
          <p className="text-xs leading-relaxed" style={{ color: "#94a3b8" }}>
            {statement.plainLanguageSummary}
          </p>
        </div>
      )}
    </div>
  );
}

function SectionRows({
  section,
}: {
  section: StatementResponse["sections"][number];
}) {
  return (
    <>
      <tr>
        <td
          colSpan={2}
          className="px-4 pt-5 pb-2 text-sm font-bold"
          style={{ color: "#5eead4" }}
        >
          {section.name}
        </td>
      </tr>

      {section.lines.map((line) => (
        <tr key={`${line.accountCode}-${line.accountName}`} className="table-row">
          <td className="table-cell text-sm" style={{ paddingLeft: 32 }}>
            {line.accountCode && (
              <code
                className="font-mono text-xs mr-2"
                style={{ color: "#5eead4" }}
              >
                {line.accountCode}
              </code>
            )}
            <span style={{ color: "#94a3b8" }}>{line.accountName}</span>
          </td>
          <td
            className="table-cell text-right font-mono text-sm"
            style={{
              color: line.currentPeriod < 0 ? "#ef4444" : "#f8fafc",
            }}
          >
            {line.currentPeriod < 0 ? "(" : ""}
            {formatCurrency(Math.abs(line.currentPeriod))}
            {line.currentPeriod < 0 ? ")" : ""}
          </td>
        </tr>
      ))}

      <tr>
        <td
          className="px-4 py-2 text-sm font-medium text-slate-50"
          style={{
            paddingLeft: 32,
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          Total {section.name}
        </td>
        <td
          className="px-4 py-2 text-right font-mono text-sm font-medium"
          style={{
            borderTop: "1px solid rgba(255,255,255,0.04)",
            color: section.total < 0 ? "#ef4444" : "#f8fafc",
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

function formatTotalLabel(key: string): string {
  const labels: Record<string, string> = {
    grossProfit: "Gross Profit",
    netIncome: "Net Income",
    totalRevenue: "Total Revenue",
    totalExpenses: "Total Expenses",
    totalAssets: "Total Assets",
    totalLiabilities: "Total Liabilities",
    totalEquity: "Total Equity",
    totalLiabilitiesAndEquity: "Total Liabilities & Equity",
    debtToEquity: "Debt-to-Equity Ratio",
    netChange: "Net Change in Cash",
  };
  return labels[key] ?? key;
}

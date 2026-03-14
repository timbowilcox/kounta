"use client";

import type { CurrencySetting, ExchangeRate } from "@kounta/sdk";

interface CurrenciesViewProps {
  currencies: readonly unknown[];
  exchangeRates: readonly unknown[];
  error: string | null;
}

function formatRate(rate: number): string {
  return (rate / 1_000_000).toFixed(6);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function CurrenciesView({ currencies, exchangeRates, error }: CurrenciesViewProps) {
  const items = currencies as CurrencySetting[];
  const rates = exchangeRates as ExchangeRate[];

  if (error === "upgrade") {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1 className="page-title">Currencies</h1>
          <p className="page-subtitle">Multi-currency support for your ledger</p>
        </div>
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <p style={{ color: "rgba(0,0,0,0.55)", marginBottom: 16 }}>
            Multi-currency is available on the Builder plan and above.
          </p>
          <a href="/settings?tab=billing" className="btn-primary" style={{ display: "inline-block" }}>
            Upgrade Plan
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Currencies</h1>
        <p className="page-subtitle">
          Manage enabled currencies and exchange rates for multi-currency transactions
        </p>
      </div>

      {/* Enabled Currencies */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid rgba(0,0,0,0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "#0A0A0A" }}>
              Enabled Currencies
            </h2>
            <p style={{ fontSize: 13, color: "rgba(0,0,0,0.45)", marginTop: 2 }}>
              Currencies available for transactions in this ledger
            </p>
          </div>
          <span className="badge-blue">{items.length}</span>
        </div>

        {items.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "rgba(0,0,0,0.36)" }}>
            <p style={{ fontSize: 14 }}>No additional currencies enabled.</p>
            <p style={{ fontSize: 13, marginTop: 4 }}>
              Use the API or MCP to enable currencies for multi-currency transactions.
            </p>
          </div>
        ) : (
          <div style={{ overflow: "auto" }}>
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Currency</th>
                  <th>Symbol</th>
                  <th>Decimal Places</th>
                  <th>Status</th>
                  <th>Enabled</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span style={{ fontWeight: 600, fontFamily: "var(--font-family-mono)" }}>
                        {c.currencyCode}
                      </span>
                    </td>
                    <td>{c.symbol}</td>
                    <td>{c.decimalPlaces}</td>
                    <td>
                      <span className={c.enabled ? "badge-green" : "badge-red"}>
                        {c.enabled ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td style={{ color: "rgba(0,0,0,0.45)", fontSize: 13 }}>
                      {formatDate(c.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Exchange Rates */}
      <div className="card">
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid rgba(0,0,0,0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "#0A0A0A" }}>
              Exchange Rates
            </h2>
            <p style={{ fontSize: 13, color: "rgba(0,0,0,0.45)", marginTop: 2 }}>
              Stored exchange rates used for currency conversion
            </p>
          </div>
          <span className="badge-blue">{rates.length}</span>
        </div>

        {rates.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "rgba(0,0,0,0.36)" }}>
            <p style={{ fontSize: 14 }}>No exchange rates set.</p>
            <p style={{ fontSize: 13, marginTop: 4 }}>
              Set exchange rates via the API or MCP to enable currency conversion.
            </p>
          </div>
        ) : (
          <div style={{ overflow: "auto" }}>
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Rate</th>
                  <th>Effective Date</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span style={{ fontFamily: "var(--font-family-mono)", fontWeight: 600 }}>
                        {r.fromCurrency}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontFamily: "var(--font-family-mono)", fontWeight: 600 }}>
                        {r.toCurrency}
                      </span>
                    </td>
                    <td style={{ fontFamily: "var(--font-family-mono)" }}>
                      {formatRate(r.rate)}
                    </td>
                    <td style={{ color: "rgba(0,0,0,0.55)", fontSize: 13 }}>
                      {formatDate(r.effectiveDate)}
                    </td>
                    <td>
                      <span className="badge-gray">{r.source}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

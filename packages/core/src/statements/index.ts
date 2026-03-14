// ---------------------------------------------------------------------------
// Financial statement builders — pure functions that take pre-computed
// account balance data and return structured StatementResponse objects.
//
// Three statements:
//   1. Income Statement (P&L) — period-based revenue vs expenses
//   2. Balance Sheet — point-in-time assets = liabilities + equity
//   3. Cash Flow (indirect method) — reconcile net income to cash change
// ---------------------------------------------------------------------------

import type {
  AccountType,
  NormalBalance,
  StatementResponse,
  StatementSection,
  StatementLine,
  StatementPeriod,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Account balance data — the shape engines pass to builders
// ---------------------------------------------------------------------------

export interface AccountBalanceData {
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly normalBalance: NormalBalance;
  readonly balance: number;
  readonly priorBalance: number | null;
  readonly metadata: Record<string, unknown> | null;
}

export interface CashFlowAccountData extends AccountBalanceData {
  /** Change in balance over the period (endBalance - startBalance) */
  readonly delta: number;
}

// ---------------------------------------------------------------------------
// Account classification by code range + metadata tags
// ---------------------------------------------------------------------------

const codeNum = (code: string): number => parseInt(code, 10) || 0;

const tagsInclude = (metadata: Record<string, unknown> | null, ...tags: string[]): boolean => {
  if (!metadata || !Array.isArray(metadata["tags"])) return false;
  return tags.some((t) => (metadata["tags"] as string[]).includes(t));
};

const isCashAccount = (a: { code: string; metadata: Record<string, unknown> | null }): boolean => {
  const n = codeNum(a.code);
  return (n >= 1000 && n < 1100) || tagsInclude(a.metadata, "cash");
};

const isCurrentAccount = (a: { code: string; type: AccountType; metadata: Record<string, unknown> | null }): boolean => {
  const n = codeNum(a.code);
  if (a.type === "asset") return (n >= 1000 && n < 1500) || tagsInclude(a.metadata, "current", "cash");
  // Liabilities: 2000-2599 are current (includes 2500 Deferred Revenue)
  if (a.type === "liability") return (n >= 2000 && n < 2600) || tagsInclude(a.metadata, "current");
  return false;
};

const isNonCurrentAccount = (a: { code: string; type: AccountType; metadata: Record<string, unknown> | null }): boolean => {
  const n = codeNum(a.code);
  if (a.type === "asset") return (n >= 1500 && n < 2000) || tagsInclude(a.metadata, "non-current");
  if (a.type === "liability") return (n >= 2600 && n < 3000) || tagsInclude(a.metadata, "non-current");
  return false;
};

const isCogsAccount = (a: { code: string; metadata: Record<string, unknown> | null }): boolean => {
  const n = codeNum(a.code);
  return (n >= 5000 && n < 6000) || tagsInclude(a.metadata, "cogs");
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const formatAmount = (cents: number): string => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${sign}$${whole}.${frac}`;
};

const buildSection = (name: string, accounts: AccountBalanceData[]): StatementSection => {
  const lines: StatementLine[] = accounts
    .filter((a) => a.balance !== 0 || (a.priorBalance !== null && a.priorBalance !== 0))
    .map((a) => ({
      accountCode: a.code,
      accountName: a.name,
      currentPeriod: a.balance,
      priorPeriod: a.priorBalance,
    }));

  const total = accounts.reduce((sum, a) => sum + a.balance, 0);
  return { name, lines, total };
};

// ---------------------------------------------------------------------------
// 1. Income Statement (P&L)
// ---------------------------------------------------------------------------

export const buildIncomeStatement = (
  accounts: AccountBalanceData[],
  period: StatementPeriod,
  currency: string,
  ledgerId: string,
  notes?: readonly string[],
): StatementResponse => {
  const revenueAccounts = accounts.filter((a) => a.type === "revenue");
  const cogsAccounts = accounts.filter((a) => a.type === "expense" && isCogsAccount(a));
  const opexAccounts = accounts.filter((a) => a.type === "expense" && !isCogsAccount(a));

  const revenueSection = buildSection("Revenue", revenueAccounts);
  const cogsSection = buildSection("Cost of Revenue", cogsAccounts);
  const opexSection = buildSection("Operating Expenses", opexAccounts);

  const totalRevenue = revenueSection.total;
  const totalCogs = cogsSection.total;
  const grossProfit = totalRevenue - totalCogs;
  const totalOpex = opexSection.total;
  const netIncome = grossProfit - totalOpex;

  const warnings: string[] = [];
  if (revenueAccounts.length === 0) warnings.push("No revenue accounts found");
  if (accounts.length === 0) warnings.push("No accounts found for this period");

  const profitOrLoss = netIncome >= 0 ? "profit" : "loss";
  const grossMargin = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 100) : 0;
  const summary =
    netIncome !== 0
      ? `Net ${profitOrLoss} of ${formatAmount(netIncome)} on ${formatAmount(totalRevenue)} revenue. Gross margin: ${grossMargin}%.`
      : `Break-even with ${formatAmount(totalRevenue)} in revenue.`;

  return {
    ledgerId,
    statementType: "pnl",
    period,
    currency,
    generatedAt: new Date().toISOString(),
    sections: [revenueSection, cogsSection, opexSection],
    totals: { totalRevenue, totalCogs, grossProfit, totalOpex, netIncome },
    warnings,
    notes: notes ?? [],
    plainLanguageSummary: summary,
  };
};

// ---------------------------------------------------------------------------
// 2. Balance Sheet
// ---------------------------------------------------------------------------

export const buildBalanceSheet = (
  accounts: AccountBalanceData[],
  asOfDate: string,
  currency: string,
  ledgerId: string,
  netIncome: number,
  priorNetIncome: number | null,
): StatementResponse => {
  const assetAccounts = accounts.filter((a) => a.type === "asset");
  const liabilityAccounts = accounts.filter((a) => a.type === "liability");
  const equityAccounts = accounts.filter((a) => a.type === "equity");

  // Computed retained-earnings line (revenue − expenses that haven't been closed)
  const retainedEarningsLine: AccountBalanceData = {
    code: "RE",
    name: "Net Income (Current Period)",
    type: "equity",
    normalBalance: "credit",
    balance: netIncome,
    priorBalance: priorNetIncome,
    metadata: null,
  };

  const assetsSection = buildSection("Assets", assetAccounts);
  const liabilitiesSection = buildSection("Liabilities", liabilityAccounts);
  const equitySection = buildSection("Equity", [...equityAccounts, retainedEarningsLine]);

  const totalAssets = assetsSection.total;
  const totalLiabilities = liabilitiesSection.total;
  const totalEquity = equitySection.total;

  const warnings: string[] = [];
  const imbalance = totalAssets - (totalLiabilities + totalEquity);
  if (imbalance !== 0) {
    warnings.push(
      `Balance sheet out of balance by ${formatAmount(imbalance)}. Assets (${formatAmount(totalAssets)}) != Liabilities (${formatAmount(totalLiabilities)}) + Equity (${formatAmount(totalEquity)}).`,
    );
  }
  if (assetAccounts.length === 0) warnings.push("No asset accounts found");

  const debtToEquity =
    totalEquity !== 0 ? (totalLiabilities / totalEquity).toFixed(2) : "N/A";
  const summary = `Total assets of ${formatAmount(totalAssets)}. ${
    totalLiabilities > 0
      ? `Debt-to-equity ratio: ${debtToEquity}.`
      : "No liabilities."
  }`;

  return {
    ledgerId,
    statementType: "balance_sheet",
    period: { start: asOfDate, end: asOfDate },
    currency,
    generatedAt: new Date().toISOString(),
    sections: [assetsSection, liabilitiesSection, equitySection],
    totals: { totalAssets, totalLiabilities, totalEquity },
    warnings,
    notes: [],
    plainLanguageSummary: summary,
  };
};

// ---------------------------------------------------------------------------
// 3. Cash Flow Statement (Indirect Method)
// ---------------------------------------------------------------------------

export const buildCashFlowStatement = (
  accounts: CashFlowAccountData[],
  netIncome: number,
  period: StatementPeriod,
  currency: string,
  ledgerId: string,
): StatementResponse => {
  // Operating — working capital adjustments
  const currentNonCashAssets = accounts.filter(
    (a) => a.type === "asset" && isCurrentAccount(a) && !isCashAccount(a),
  );
  const currentLiabilities = accounts.filter(
    (a) => a.type === "liability" && isCurrentAccount(a),
  );

  const workingCapitalLines: StatementLine[] = [
    ...currentNonCashAssets.map((a) => ({
      accountCode: a.code,
      accountName: `Change in ${a.name}`,
      currentPeriod: -a.delta, // asset increase → cash used
      priorPeriod: null,
    })),
    ...currentLiabilities.map((a) => ({
      accountCode: a.code,
      accountName: `Change in ${a.name}`,
      currentPeriod: a.delta, // liability increase → cash source
      priorPeriod: null,
    })),
  ];

  const operatingAdj = workingCapitalLines.reduce((s, l) => s + l.currentPeriod, 0);
  const operatingTotal = netIncome + operatingAdj;

  const operatingSection: StatementSection = {
    name: "Operating Activities",
    lines: [
      { accountCode: "NI", accountName: "Net Income", currentPeriod: netIncome, priorPeriod: null },
      ...workingCapitalLines,
    ],
    total: operatingTotal,
  };

  // Investing — non-current assets
  const nonCurrentAssets = accounts.filter(
    (a) => a.type === "asset" && isNonCurrentAccount(a),
  );
  const investingLines: StatementLine[] = nonCurrentAssets.map((a) => ({
    accountCode: a.code,
    accountName: `Change in ${a.name}`,
    currentPeriod: -a.delta, // asset increase → cash spent
    priorPeriod: null,
  }));
  const investingTotal = investingLines.reduce((s, l) => s + l.currentPeriod, 0);

  const investingSection: StatementSection = {
    name: "Investing Activities",
    lines: investingLines,
    total: investingTotal,
  };

  // Financing — non-current liabilities + equity
  const nonCurrentLiabilities = accounts.filter(
    (a) => a.type === "liability" && isNonCurrentAccount(a),
  );
  const equityAccounts = accounts.filter((a) => a.type === "equity");
  const financingLines: StatementLine[] = [
    ...nonCurrentLiabilities.map((a) => ({
      accountCode: a.code,
      accountName: `Change in ${a.name}`,
      currentPeriod: a.delta,
      priorPeriod: null,
    })),
    ...equityAccounts.map((a) => ({
      accountCode: a.code,
      accountName: `Change in ${a.name}`,
      currentPeriod: a.delta,
      priorPeriod: null,
    })),
  ];
  const financingTotal = financingLines.reduce((s, l) => s + l.currentPeriod, 0);

  const financingSection: StatementSection = {
    name: "Financing Activities",
    lines: financingLines,
    total: financingTotal,
  };

  // Cash reconciliation
  const cashAccounts = accounts.filter((a) => a.type === "asset" && isCashAccount(a));
  const startingCash = cashAccounts.reduce((s, a) => s + (a.balance - a.delta), 0);
  const endingCash = cashAccounts.reduce((s, a) => s + a.balance, 0);
  const netCashChange = operatingTotal + investingTotal + financingTotal;

  const warnings: string[] = [];
  const expected = startingCash + netCashChange;
  if (Math.abs(expected - endingCash) > 1) {
    warnings.push(`Cash reconciliation variance of ${formatAmount(expected - endingCash)}`);
  }

  const direction = netCashChange >= 0 ? "increased" : "decreased";
  const summary = `Cash ${direction} by ${formatAmount(netCashChange)} to ${formatAmount(endingCash)}. Operating activities generated ${formatAmount(operatingTotal)}.`;

  return {
    ledgerId,
    statementType: "cash_flow",
    period,
    currency,
    generatedAt: new Date().toISOString(),
    sections: [operatingSection, investingSection, financingSection],
    totals: { operatingTotal, investingTotal, financingTotal, netCashChange, startingCash, endingCash },
    warnings,
    notes: [],
    plainLanguageSummary: summary,
  };
};

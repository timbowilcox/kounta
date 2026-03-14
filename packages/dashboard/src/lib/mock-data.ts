// ── Templates ────────────────────────────────────────────────────────────────

export interface Template {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly categories: readonly string[];
}

export const templates: readonly Template[] = [
  {
    slug: "saas",
    name: "SaaS",
    description: "Subscription, usage, and professional services revenue. Tracks deferred revenue, hosting costs, and R&D spend.",
    categories: ["Subscription Revenue", "Deferred Revenue", "Hosting & Infrastructure", "R&D", "Professional Services"],
  },
  {
    slug: "marketplace",
    name: "Marketplace",
    description: "Two-sided marketplace earning commissions. Tracks platform commissions, escrow flows, and seller payables.",
    categories: ["Platform Commissions", "Escrow Deposits", "Seller Payables", "Payment Processing", "Trust & Safety"],
  },
  {
    slug: "agency",
    name: "Agency",
    description: "Project and retainer billing for creative and digital agencies. Tracks WIP, contractor costs, and deferred retainers.",
    categories: ["Project Revenue", "Retainer Revenue", "Work in Progress", "Contractor Costs", "Production Costs"],
  },
  {
    slug: "ecommerce",
    name: "Ecommerce",
    description: "Online retail with physical products. Tracks inventory, COGS, shipping, sales tax, and gift card liabilities.",
    categories: ["Product Sales", "Inventory", "Cost of Goods Sold", "Shipping & Fulfillment", "Sales Tax"],
  },
  {
    slug: "creator",
    name: "Creator",
    description: "Content creators with ads, sponsorships, merchandise, digital products, and memberships.",
    categories: ["Ad Revenue", "Sponsorships", "Merchandise Sales", "Digital Products", "Memberships"],
  },
  {
    slug: "consulting",
    name: "Consulting",
    description: "Professional services billing hourly or on retainer. Tracks consulting fees, subcontractors, and travel.",
    categories: ["Consulting Fees", "Advisory Retainers", "Subcontractor Costs", "Travel & Entertainment", "Training Revenue"],
  },
  {
    slug: "property",
    name: "Property Management",
    description: "Rental property management. Tracks rental income, tenant deposits, mortgages, maintenance, and property expenses.",
    categories: ["Rental Income", "Security Deposits", "Mortgage Payable", "Maintenance & Repairs", "Property Taxes"],
  },
  {
    slug: "nonprofit",
    name: "Nonprofit",
    description: "Grant and donation tracking with fund-accounting concepts. Restricted and unrestricted net assets.",
    categories: ["Government Grants", "Individual Donations", "Program Expenses", "Fundraising", "Restricted Net Assets"],
  },
];

// ── Ledger ────────────────────────────────────────────────────────────────────

export interface MockLedger {
  readonly id: string;
  readonly name: string;
  readonly entity: string;
  readonly template: string;
  readonly currency: string;
  readonly createdAt: string;
}

export const ledger: MockLedger = {
  id: "01936a7b-4c2e-7d8f-a1b3-5e9f0c2d4a6b",
  name: "Acme SaaS",
  entity: "Acme Inc.",
  template: "SaaS",
  currency: "USD",
  createdAt: "2026-01-15T09:00:00Z",
};

// ── Accounts ─────────────────────────────────────────────────────────────────

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface MockAccount {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly parentId: string | null;
  readonly balance: number; // cents
}

export const accounts: readonly MockAccount[] = [
  // Assets
  { id: "a1", code: "1000", name: "Cash", type: "asset", parentId: null, balance: 12450000 },
  { id: "a2", code: "1100", name: "Accounts Receivable", type: "asset", parentId: null, balance: 3820000 },
  { id: "a3", code: "1200", name: "Prepaid Expenses", type: "asset", parentId: null, balance: 600000 },
  { id: "a4", code: "1500", name: "Equipment", type: "asset", parentId: null, balance: 1500000 },
  // Liabilities
  { id: "l1", code: "2000", name: "Accounts Payable", type: "liability", parentId: null, balance: 1240000 },
  { id: "l2", code: "2100", name: "Deferred Revenue", type: "liability", parentId: null, balance: 4500000 },
  { id: "l3", code: "2200", name: "Accrued Expenses", type: "liability", parentId: null, balance: 830000 },
  // Equity
  { id: "e1", code: "3000", name: "Owner's Equity", type: "equity", parentId: null, balance: 5000000 },
  { id: "e2", code: "3100", name: "Retained Earnings", type: "equity", parentId: null, balance: 6800000 },
  // Revenue
  { id: "r1", code: "4000", name: "Subscription Revenue", type: "revenue", parentId: null, balance: 18500000 },
  { id: "r2", code: "4100", name: "Professional Services Revenue", type: "revenue", parentId: null, balance: 3200000 },
  { id: "r3", code: "4200", name: "Usage-Based Revenue", type: "revenue", parentId: null, balance: 1850000 },
  // Expenses (COGS)
  { id: "x1", code: "5000", name: "Hosting & Infrastructure", type: "expense", parentId: null, balance: 2400000 },
  { id: "x2", code: "5100", name: "Third-Party Services", type: "expense", parentId: null, balance: 850000 },
  // Expenses (Operating)
  { id: "x3", code: "6000", name: "Salaries & Benefits", type: "expense", parentId: null, balance: 9600000 },
  { id: "x4", code: "6100", name: "Marketing & Advertising", type: "expense", parentId: null, balance: 1800000 },
  { id: "x5", code: "6200", name: "Research & Development", type: "expense", parentId: null, balance: 1200000 },
  { id: "x6", code: "6300", name: "General & Administrative", type: "expense", parentId: null, balance: 950000 },
];

// ── Transactions ─────────────────────────────────────────────────────────────

export interface MockLineItem {
  readonly accountCode: string;
  readonly accountName: string;
  readonly amount: number;
  readonly direction: "debit" | "credit";
}

export interface MockTransaction {
  readonly id: string;
  readonly date: string;
  readonly memo: string;
  readonly status: "posted" | "reversed";
  readonly amount: number; // total debit cents
  readonly lines: readonly MockLineItem[];
}

export const transactions: readonly MockTransaction[] = [
  {
    id: "01936b1a-8f3e-7a2c-b4d5-9e1f3c5a7b8d",
    date: "2026-03-09T14:30:00Z",
    memo: "Monthly subscription batch — March 2026",
    status: "posted",
    amount: 6200000,
    lines: [
      { accountCode: "1100", accountName: "Accounts Receivable", amount: 6200000, direction: "debit" },
      { accountCode: "4000", accountName: "Subscription Revenue", amount: 6200000, direction: "credit" },
    ],
  },
  {
    id: "01936b19-2d4e-7b1a-c3f5-8a6d2e4b9c0f",
    date: "2026-03-08T10:15:00Z",
    memo: "AWS hosting invoice — February 2026",
    status: "posted",
    amount: 840000,
    lines: [
      { accountCode: "5000", accountName: "Hosting & Infrastructure", amount: 840000, direction: "debit" },
      { accountCode: "2000", accountName: "Accounts Payable", amount: 840000, direction: "credit" },
    ],
  },
  {
    id: "01936b18-4a6c-7d3e-a2b4-7c5f1d3a9e8b",
    date: "2026-03-07T16:45:00Z",
    memo: "Consulting engagement — Initech onboarding",
    status: "posted",
    amount: 1500000,
    lines: [
      { accountCode: "1100", accountName: "Accounts Receivable", amount: 1500000, direction: "debit" },
      { accountCode: "4100", accountName: "Professional Services Revenue", amount: 1500000, direction: "credit" },
    ],
  },
  {
    id: "01936b17-6b8d-7c2f-b1a3-9d4e6f8a0c2d",
    date: "2026-03-06T09:00:00Z",
    memo: "Payroll — first half March",
    status: "posted",
    amount: 4800000,
    lines: [
      { accountCode: "6000", accountName: "Salaries & Benefits", amount: 4800000, direction: "debit" },
      { accountCode: "1000", accountName: "Cash", amount: 4800000, direction: "credit" },
    ],
  },
  {
    id: "01936b16-9c0e-7a4d-c3b5-2f6a8d1e4c7b",
    date: "2026-03-05T11:30:00Z",
    memo: "Customer payment received — Globex Corp",
    status: "posted",
    amount: 3200000,
    lines: [
      { accountCode: "1000", accountName: "Cash", amount: 3200000, direction: "debit" },
      { accountCode: "1100", accountName: "Accounts Receivable", amount: 3200000, direction: "credit" },
    ],
  },
  {
    id: "01936b15-1d3f-7b5e-a4c6-8e2d0f6a9b3c",
    date: "2026-03-04T14:00:00Z",
    memo: "Google Ads — February campaign",
    status: "posted",
    amount: 450000,
    lines: [
      { accountCode: "6100", accountName: "Marketing & Advertising", amount: 450000, direction: "debit" },
      { accountCode: "1000", accountName: "Cash", amount: 450000, direction: "credit" },
    ],
  },
  {
    id: "01936b14-3e5a-7c6f-b2d4-1a8c9e3f5d7b",
    date: "2026-03-03T09:45:00Z",
    memo: "Annual domain and SSL renewal",
    status: "posted",
    amount: 24000,
    lines: [
      { accountCode: "6300", accountName: "General & Administrative", amount: 24000, direction: "debit" },
      { accountCode: "1000", accountName: "Cash", amount: 24000, direction: "credit" },
    ],
  },
  {
    id: "01936b13-5f7b-7d8a-c1e3-4b6d2a9c0f5e",
    date: "2026-03-02T16:20:00Z",
    memo: "Refund — duplicate charge correction",
    status: "reversed",
    amount: 9900,
    lines: [
      { accountCode: "4000", accountName: "Subscription Revenue", amount: 9900, direction: "debit" },
      { accountCode: "1000", accountName: "Cash", amount: 9900, direction: "credit" },
    ],
  },
  {
    id: "01936b12-7a9c-7e1b-d2f4-5c8a3b7d6e0f",
    date: "2026-03-01T08:00:00Z",
    memo: "Usage-based billing — February overages",
    status: "posted",
    amount: 185000,
    lines: [
      { accountCode: "1100", accountName: "Accounts Receivable", amount: 185000, direction: "debit" },
      { accountCode: "4200", accountName: "Usage-Based Revenue", amount: 185000, direction: "credit" },
    ],
  },
  {
    id: "01936b11-8b0d-7f2c-e3a5-6d9b4c8e1f7a",
    date: "2026-02-28T13:30:00Z",
    memo: "Equipment purchase — developer workstations",
    status: "posted",
    amount: 500000,
    lines: [
      { accountCode: "1500", accountName: "Equipment", amount: 500000, direction: "debit" },
      { accountCode: "1000", accountName: "Cash", amount: 500000, direction: "credit" },
    ],
  },
  {
    id: "01936b10-9c1e-7a3d-f4b6-7e0c5d9a2f8b",
    date: "2026-02-27T10:00:00Z",
    memo: "Annual SaaS tool subscriptions prepaid",
    status: "posted",
    amount: 360000,
    lines: [
      { accountCode: "1200", accountName: "Prepaid Expenses", amount: 360000, direction: "debit" },
      { accountCode: "1000", accountName: "Cash", amount: 360000, direction: "credit" },
    ],
  },
  {
    id: "01936b0f-0d2f-7b4e-a5c7-8f1d6e0b3a9c",
    date: "2026-02-26T15:45:00Z",
    memo: "Customer prepayment — annual plan",
    status: "posted",
    amount: 2400000,
    lines: [
      { accountCode: "1000", accountName: "Cash", amount: 2400000, direction: "debit" },
      { accountCode: "2100", accountName: "Deferred Revenue", amount: 2400000, direction: "credit" },
    ],
  },
];

// ── API Keys ─────────────────────────────────────────────────────────────────

export interface MockApiKey {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly status: "active" | "revoked";
}

export const apiKeys: readonly MockApiKey[] = [
  {
    id: "k1",
    name: "Production",
    prefix: "kounta_live_7f3a",
    createdAt: "2026-01-15T09:30:00Z",
    lastUsedAt: "2026-03-10T08:12:00Z",
    status: "active",
  },
  {
    id: "k2",
    name: "CI / Staging",
    prefix: "kounta_live_2b8c",
    createdAt: "2026-02-01T14:00:00Z",
    lastUsedAt: "2026-03-09T22:45:00Z",
    status: "active",
  },
  {
    id: "k3",
    name: "Old integration",
    prefix: "kounta_live_9d1e",
    createdAt: "2026-01-20T11:00:00Z",
    lastUsedAt: "2026-02-15T16:30:00Z",
    status: "revoked",
  },
];

// ── Statements ───────────────────────────────────────────────────────────────

export interface StatementLine {
  readonly accountCode: string;
  readonly accountName: string;
  readonly amount: number;
}

export interface StatementSection {
  readonly name: string;
  readonly lines: readonly StatementLine[];
  readonly total: number;
}

export interface Statement {
  readonly type: "pnl" | "balance_sheet" | "cash_flow";
  readonly title: string;
  readonly period: { readonly start: string; readonly end: string };
  readonly sections: readonly StatementSection[];
  readonly totals: Record<string, number>;
  readonly summary: string;
}

export const incomeStatement: Statement = {
  type: "pnl",
  title: "Income Statement",
  period: { start: "2026-01-01", end: "2026-03-10" },
  sections: [
    {
      name: "Revenue",
      lines: [
        { accountCode: "4000", accountName: "Subscription Revenue", amount: 18500000 },
        { accountCode: "4100", accountName: "Professional Services", amount: 3200000 },
        { accountCode: "4200", accountName: "Usage-Based Revenue", amount: 1850000 },
      ],
      total: 23550000,
    },
    {
      name: "Cost of Revenue",
      lines: [
        { accountCode: "5000", accountName: "Hosting & Infrastructure", amount: -2400000 },
        { accountCode: "5100", accountName: "Third-Party Services", amount: -850000 },
      ],
      total: -3250000,
    },
    {
      name: "Operating Expenses",
      lines: [
        { accountCode: "6000", accountName: "Salaries & Benefits", amount: -9600000 },
        { accountCode: "6100", accountName: "Marketing & Advertising", amount: -1800000 },
        { accountCode: "6200", accountName: "Research & Development", amount: -1200000 },
        { accountCode: "6300", accountName: "General & Administrative", amount: -950000 },
      ],
      total: -13550000,
    },
  ],
  totals: {
    grossProfit: 20300000,
    netIncome: 6750000,
  },
  summary: "Your SaaS business generated $235,500 in revenue this quarter with a gross margin of 86.2%. After operating expenses of $135,500, net income was $67,500 — a healthy 28.7% net margin.",
};

export const balanceSheet: Statement = {
  type: "balance_sheet",
  title: "Balance Sheet",
  period: { start: "2026-03-10", end: "2026-03-10" },
  sections: [
    {
      name: "Assets",
      lines: [
        { accountCode: "1000", accountName: "Cash", amount: 12450000 },
        { accountCode: "1100", accountName: "Accounts Receivable", amount: 3820000 },
        { accountCode: "1200", accountName: "Prepaid Expenses", amount: 600000 },
        { accountCode: "1500", accountName: "Equipment", amount: 1500000 },
      ],
      total: 18370000,
    },
    {
      name: "Liabilities",
      lines: [
        { accountCode: "2000", accountName: "Accounts Payable", amount: 1240000 },
        { accountCode: "2100", accountName: "Deferred Revenue", amount: 4500000 },
        { accountCode: "2200", accountName: "Accrued Expenses", amount: 830000 },
      ],
      total: 6570000,
    },
    {
      name: "Equity",
      lines: [
        { accountCode: "3000", accountName: "Owner's Equity", amount: 5000000 },
        { accountCode: "3100", accountName: "Retained Earnings", amount: 6800000 },
      ],
      total: 11800000,
    },
  ],
  totals: {
    totalAssets: 18370000,
    totalLiabilitiesAndEquity: 18370000,
    debtToEquity: 56,
  },
  summary: "Total assets of $183,700 are funded by $65,700 in liabilities and $118,000 in equity. Your debt-to-equity ratio of 0.56 indicates a conservatively financed business.",
};

export const cashFlowStatement: Statement = {
  type: "cash_flow",
  title: "Cash Flow Statement",
  period: { start: "2026-01-01", end: "2026-03-10" },
  sections: [
    {
      name: "Operating Activities",
      lines: [
        { accountCode: "", accountName: "Net Income", amount: 6750000 },
        { accountCode: "1100", accountName: "Change in Accounts Receivable", amount: -820000 },
        { accountCode: "1200", accountName: "Change in Prepaid Expenses", amount: -200000 },
        { accountCode: "2000", accountName: "Change in Accounts Payable", amount: 340000 },
        { accountCode: "2100", accountName: "Change in Deferred Revenue", amount: 1200000 },
        { accountCode: "2200", accountName: "Change in Accrued Expenses", amount: 230000 },
      ],
      total: 7500000,
    },
    {
      name: "Investing Activities",
      lines: [
        { accountCode: "1500", accountName: "Equipment Purchases", amount: -500000 },
      ],
      total: -500000,
    },
    {
      name: "Financing Activities",
      lines: [
        { accountCode: "3000", accountName: "Owner Distributions", amount: -1000000 },
      ],
      total: -1000000,
    },
  ],
  totals: {
    netChange: 6000000,
  },
  summary: "Cash increased by $60,000 this quarter. Operations generated $75,000, offset by $5,000 in equipment investment and $10,000 in owner distributions.",
};

// ── Metrics ──────────────────────────────────────────────────────────────────

export const metrics = {
  transactionCount: 247,
  accountCount: 18,
  ledgerValue: 18370000, // total assets in cents
  planUsage: 24.7, // percentage
};

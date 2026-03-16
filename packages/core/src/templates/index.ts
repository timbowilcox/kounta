// ---------------------------------------------------------------------------
// Starter templates — 8 pre-configured charts of accounts for common
// business types. Each template includes accounts, default currency,
// and recommended accounting basis.
//
// Account code convention (consistent across all templates):
//   1000–1099  Cash & equivalents
//   1100–1499  Current assets
//   1500–1999  Non-current assets
//   2000–2499  Current liabilities
//   2500–2999  Non-current liabilities
//   3000–3999  Equity
//   4000–4999  Revenue
//   5000–5999  Cost of revenue / COGS
//   6000–6999  Operating expenses
// ---------------------------------------------------------------------------

import type {
  Template,
  TemplateAccount,
  AccountType,
  NormalBalance,
  AccountingBasis,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Helper — reduces boilerplate in template definitions
// ---------------------------------------------------------------------------

const normalBalanceFor = (type: AccountType): NormalBalance =>
  type === "asset" || type === "expense" ? "debit" : "credit";

const a = (
  code: string,
  name: string,
  type: AccountType,
  tags: readonly string[] = [],
  parentCode: string | null = null,
): TemplateAccount => ({
  code,
  name,
  type,
  normalBalance: normalBalanceFor(type),
  parentCode,
  isSystem: false,
  tags,
});

/** Contra-asset account (asset type, credit normal balance). */
const contra = (
  code: string,
  name: string,
  tags: readonly string[] = [],
  parentCode: string | null = null,
): TemplateAccount => ({
  code,
  name,
  type: "asset" as AccountType,
  normalBalance: "credit" as NormalBalance,
  parentCode,
  isSystem: false,
  tags,
});

// ---------------------------------------------------------------------------
// 1. SaaS
// ---------------------------------------------------------------------------

const saasAccounts: TemplateAccount[] = [
  a("1000", "Cash", "asset", ["cash", "current"]),
  a("1100", "Accounts Receivable", "asset", ["current"]),
  a("1200", "Prepaid Expenses", "asset", ["current"]),
  a("1500", "Equipment & Hardware", "asset", ["non-current"]),
  contra("1510", "Accumulated Depreciation", ["non-current"]),
  a("2000", "Accounts Payable", "liability", ["current"]),
  a("2100", "Deferred Revenue", "liability", ["current"]),
  a("2200", "Accrued Expenses", "liability", ["current"]),
  a("3000", "Owner's Equity", "equity"),
  a("3100", "Retained Earnings", "equity"),
  a("4000", "Subscription Revenue", "revenue"),
  a("4100", "Professional Services Revenue", "revenue"),
  a("4200", "Usage-Based Revenue", "revenue"),
  a("5000", "Hosting & Infrastructure", "expense", ["cogs"]),
  a("5100", "Third-Party Services", "expense", ["cogs"]),
  a("6000", "Salaries & Benefits", "expense"),
  a("6100", "Marketing & Advertising", "expense"),
  a("6200", "Research & Development", "expense"),
  a("6300", "General & Administrative", "expense"),
  a("6400", "Depreciation Expense", "expense"),
];

// ---------------------------------------------------------------------------
// 2. Marketplace
// ---------------------------------------------------------------------------

const marketplaceAccounts: TemplateAccount[] = [
  a("1000", "Cash", "asset", ["cash", "current"]),
  a("1100", "Platform Receivables", "asset", ["current"]),
  a("1200", "Escrow Deposits", "asset", ["current"]),
  a("2000", "Seller Payables", "liability", ["current"]),
  a("2100", "Deferred Revenue", "liability", ["current"]),
  a("2200", "Sales Tax Payable", "liability", ["current"]),
  a("3000", "Owner's Equity", "equity"),
  a("3100", "Retained Earnings", "equity"),
  a("4000", "Platform Commissions", "revenue"),
  a("4100", "Listing Fees", "revenue"),
  a("4200", "Promoted Listings Revenue", "revenue"),
  a("4300", "Subscription Revenue", "revenue"),
  a("5000", "Payment Processing Fees", "expense", ["cogs"]),
  a("6000", "Salaries & Benefits", "expense"),
  a("6100", "Trust & Safety", "expense"),
  a("6200", "Marketing & Advertising", "expense"),
  a("6300", "Customer Support", "expense"),
  a("6400", "General & Administrative", "expense"),
];

// ---------------------------------------------------------------------------
// 3. Agency
// ---------------------------------------------------------------------------

const agencyAccounts: TemplateAccount[] = [
  a("1000", "Cash", "asset", ["cash", "current"]),
  a("1100", "Accounts Receivable", "asset", ["current"]),
  a("1200", "Work in Progress", "asset", ["current"]),
  a("1500", "Office Equipment", "asset", ["non-current"]),
  contra("1510", "Accumulated Depreciation", ["non-current"]),
  a("2000", "Accounts Payable", "liability", ["current"]),
  a("2100", "Deferred Retainers", "liability", ["current"]),
  a("2200", "Payroll Liabilities", "liability", ["current"]),
  a("3000", "Owner's Equity", "equity"),
  a("3100", "Retained Earnings", "equity"),
  a("4000", "Project Revenue", "revenue"),
  a("4100", "Retainer Revenue", "revenue"),
  a("4200", "Consulting Revenue", "revenue"),
  a("5000", "Contractor Costs", "expense", ["cogs"]),
  a("5100", "Production Costs", "expense", ["cogs"]),
  a("6000", "Salaries & Benefits", "expense"),
  a("6100", "Software & Tools", "expense"),
  a("6200", "Marketing & Business Development", "expense"),
  a("6300", "General & Administrative", "expense"),
  a("6400", "Depreciation Expense", "expense"),
];

// ---------------------------------------------------------------------------
// 4. Ecommerce
// ---------------------------------------------------------------------------

const ecommerceAccounts: TemplateAccount[] = [
  a("1000", "Cash", "asset", ["cash", "current"]),
  a("1100", "Accounts Receivable", "asset", ["current"]),
  a("1200", "Inventory", "asset", ["current"]),
  a("1300", "Prepaid Expenses", "asset", ["current"]),
  a("1500", "Warehouse Equipment", "asset", ["non-current"]),
  contra("1510", "Accumulated Depreciation", ["non-current"]),
  a("2000", "Accounts Payable", "liability", ["current"]),
  a("2100", "Sales Tax Payable", "liability", ["current"]),
  a("2200", "Gift Card Liability", "liability", ["current"]),
  a("2300", "Accrued Shipping Costs", "liability", ["current"]),
  a("3000", "Owner's Equity", "equity"),
  a("3100", "Retained Earnings", "equity"),
  a("4000", "Product Sales", "revenue"),
  a("4100", "Shipping Revenue", "revenue"),
  a("5000", "Cost of Goods Sold", "expense", ["cogs"]),
  a("5100", "Shipping & Fulfillment", "expense", ["cogs"]),
  a("5200", "Packaging Costs", "expense", ["cogs"]),
  a("6000", "Salaries & Benefits", "expense"),
  a("6100", "Marketing & Advertising", "expense"),
  a("6200", "Platform & Marketplace Fees", "expense"),
  a("6300", "General & Administrative", "expense"),
  a("6400", "Depreciation Expense", "expense"),
];

// ---------------------------------------------------------------------------
// 5. Creator
// ---------------------------------------------------------------------------

const creatorAccounts: TemplateAccount[] = [
  a("1000", "Cash", "asset", ["cash", "current"]),
  a("1100", "Accounts Receivable", "asset", ["current"]),
  a("1500", "Equipment & Gear", "asset", ["non-current"]),
  contra("1510", "Accumulated Depreciation", ["non-current"]),
  a("2000", "Accounts Payable", "liability", ["current"]),
  a("2100", "Taxes Payable", "liability", ["current"]),
  a("3000", "Owner's Equity", "equity"),
  a("3100", "Retained Earnings", "equity"),
  a("4000", "Ad Revenue", "revenue"),
  a("4100", "Sponsorship Revenue", "revenue"),
  a("4200", "Merchandise Sales", "revenue"),
  a("4300", "Digital Product Sales", "revenue"),
  a("4400", "Membership & Subscription Revenue", "revenue"),
  a("5000", "Production Costs", "expense", ["cogs"]),
  a("5100", "Merchandise COGS", "expense", ["cogs"]),
  a("6000", "Software & Subscriptions", "expense"),
  a("6100", "Marketing & Promotion", "expense"),
  a("6200", "General & Administrative", "expense"),
  a("6300", "Depreciation Expense", "expense"),
];

// ---------------------------------------------------------------------------
// 6. Consulting
// ---------------------------------------------------------------------------

const consultingAccounts: TemplateAccount[] = [
  a("1000", "Cash", "asset", ["cash", "current"]),
  a("1100", "Accounts Receivable", "asset", ["current"]),
  a("1200", "Prepaid Expenses", "asset", ["current"]),
  a("2000", "Accounts Payable", "liability", ["current"]),
  a("2100", "Deferred Revenue", "liability", ["current"]),
  a("2200", "Tax Liabilities", "liability", ["current"]),
  a("3000", "Owner's Equity", "equity"),
  a("3100", "Retained Earnings", "equity"),
  a("4000", "Consulting Fees", "revenue"),
  a("4100", "Advisory Retainers", "revenue"),
  a("4200", "Workshop & Training Revenue", "revenue"),
  a("5000", "Subcontractor Costs", "expense", ["cogs"]),
  a("6000", "Salaries & Benefits", "expense"),
  a("6100", "Travel & Entertainment", "expense"),
  a("6200", "Professional Development", "expense"),
  a("6300", "Insurance", "expense"),
  a("6400", "General & Administrative", "expense"),
];

// ---------------------------------------------------------------------------
// 7. Property Management
// ---------------------------------------------------------------------------

const propertyAccounts: TemplateAccount[] = [
  a("1000", "Cash", "asset", ["cash", "current"]),
  a("1100", "Rent Receivable", "asset", ["current"]),
  a("1200", "Security Deposits Receivable", "asset", ["current"]),
  a("1500", "Properties", "asset", ["non-current"]),
  contra("1510", "Accumulated Depreciation", ["non-current"]),
  a("1600", "Building Improvements", "asset", ["non-current"]),
  a("2000", "Accounts Payable", "liability", ["current"]),
  a("2100", "Tenant Security Deposits", "liability", ["current"]),
  a("2200", "Taxes Payable", "liability", ["current"]),
  a("2500", "Mortgage Payable", "liability", ["non-current"]),
  a("3000", "Owner's Equity", "equity"),
  a("3100", "Retained Earnings", "equity"),
  a("4000", "Rental Income", "revenue"),
  a("4100", "Late Fees", "revenue"),
  a("4200", "Common Area Charges", "revenue"),
  a("5000", "Property Management Fees", "expense", ["cogs"]),
  a("6000", "Maintenance & Repairs", "expense"),
  a("6100", "Property Insurance", "expense"),
  a("6200", "Property Taxes", "expense"),
  a("6300", "Utilities", "expense"),
  a("6400", "Mortgage Interest", "expense"),
  a("6500", "Depreciation Expense", "expense"),
];

// ---------------------------------------------------------------------------
// 8. Nonprofit
// ---------------------------------------------------------------------------

const nonprofitAccounts: TemplateAccount[] = [
  a("1000", "Cash", "asset", ["cash", "current"]),
  a("1100", "Grants Receivable", "asset", ["current"]),
  a("1200", "Pledges Receivable", "asset", ["current"]),
  a("1500", "Fixed Assets", "asset", ["non-current"]),
  contra("1510", "Accumulated Depreciation", ["non-current"]),
  a("2000", "Accounts Payable", "liability", ["current"]),
  a("2100", "Accrued Expenses", "liability", ["current"]),
  a("2200", "Deferred Grant Revenue", "liability", ["current"]),
  a("3000", "Unrestricted Net Assets", "equity"),
  a("3100", "Temporarily Restricted Net Assets", "equity"),
  a("3200", "Board-Designated Reserves", "equity"),
  a("4000", "Government Grants", "revenue"),
  a("4100", "Foundation Grants", "revenue"),
  a("4200", "Individual Donations", "revenue"),
  a("4300", "Corporate Sponsorships", "revenue"),
  a("4400", "Program Service Fees", "revenue"),
  a("6000", "Program Expenses", "expense"),
  a("6100", "Fundraising Expenses", "expense"),
  a("6200", "Management & General", "expense"),
  a("6300", "Depreciation Expense", "expense"),
];

// ---------------------------------------------------------------------------
// Template definitions
// ---------------------------------------------------------------------------

const makeTemplate = (
  slug: string,
  name: string,
  description: string,
  businessType: string,
  accounts: TemplateAccount[],
  currency: string = "USD",
  basis: AccountingBasis = "accrual",
): Template => ({
  id: `tpl_${slug}`,
  slug,
  name,
  description,
  businessType,
  chartOfAccounts: accounts,
  defaultCurrency: currency,
  defaultBasis: basis,
  metadata: null,
});

export const TEMPLATES: readonly Template[] = [
  makeTemplate(
    "saas",
    "SaaS",
    "Software-as-a-Service businesses with subscription, usage, and professional services revenue streams. Tracks deferred revenue, hosting costs, and R&D spend.",
    "saas",
    saasAccounts,
  ),
  makeTemplate(
    "marketplace",
    "Marketplace",
    "Two-sided marketplaces earning commissions on transactions between buyers and sellers. Tracks platform commissions, escrow flows, and seller payables.",
    "marketplace",
    marketplaceAccounts,
  ),
  makeTemplate(
    "agency",
    "Agency",
    "Creative, marketing, and digital agencies billing on projects and retainers. Tracks work in progress, contractor costs, and deferred retainers.",
    "agency",
    agencyAccounts,
  ),
  makeTemplate(
    "ecommerce",
    "Ecommerce",
    "Online retail businesses selling physical products. Tracks inventory, COGS, shipping revenue and costs, sales tax, and gift card liabilities.",
    "ecommerce",
    ecommerceAccounts,
  ),
  makeTemplate(
    "creator",
    "Creator",
    "Content creators earning through ads, sponsorships, merchandise, digital products, and memberships. Tracks multiple revenue streams and production costs.",
    "creator",
    creatorAccounts,
  ),
  makeTemplate(
    "consulting",
    "Consulting",
    "Professional services and consulting firms billing hourly or on retainer. Tracks consulting fees, subcontractor costs, and travel expenses.",
    "consulting",
    consultingAccounts,
  ),
  makeTemplate(
    "property",
    "Property Management",
    "Rental property owners and managers. Tracks rental income, tenant deposits, mortgage payments, maintenance, and property-level expenses.",
    "property",
    propertyAccounts,
    "USD",
    "cash",
  ),
  makeTemplate(
    "nonprofit",
    "Nonprofit",
    "Nonprofit organizations tracking grants, donations, and program expenses. Uses fund-accounting concepts with restricted and unrestricted net assets.",
    "nonprofit",
    nonprofitAccounts,
  ),
];

// ---------------------------------------------------------------------------
// Template lookup
// ---------------------------------------------------------------------------

export const getTemplates = (): readonly Template[] => TEMPLATES;

export const getTemplate = (idOrSlug: string): Template | undefined =>
  TEMPLATES.find((t) => t.id === idOrSlug || t.slug === idOrSlug);

// ---------------------------------------------------------------------------
// Template recommendation engine
//
// Scores templates against a business context using keyword matching.
// Primary keywords have weight 3, secondary have weight 1.
// ---------------------------------------------------------------------------

interface TemplateKeywords {
  primary: readonly string[];
  secondary: readonly string[];
}

const TEMPLATE_KEYWORDS: Record<string, TemplateKeywords> = {
  saas: {
    primary: ["saas", "software", "subscription", "recurring", "platform", "app", "cloud"],
    secondary: ["mrr", "arr", "churn", "seats", "api", "b2b", "startup", "tech"],
  },
  marketplace: {
    primary: ["marketplace", "two-sided", "commission", "gmv", "sellers", "buyers"],
    secondary: ["platform", "matching", "escrow", "take-rate", "listings", "p2p", "gig"],
  },
  agency: {
    primary: ["agency", "creative", "advertising", "branding", "design"],
    secondary: ["marketing", "digital", "media", "campaigns", "retainer", "studio", "production"],
  },
  ecommerce: {
    primary: ["ecommerce", "e-commerce", "retail", "shop", "store", "products"],
    secondary: ["inventory", "shipping", "fulfillment", "cogs", "dropship", "dtc", "wholesale"],
  },
  creator: {
    primary: ["creator", "content", "youtube", "podcast", "streaming", "influencer"],
    secondary: ["media", "audience", "sponsorship", "merch", "patreon", "tiktok", "newsletter"],
  },
  consulting: {
    primary: ["consulting", "consultant", "advisory", "freelance", "professional services"],
    secondary: ["hourly", "billable", "engagements", "workshops", "training", "coach"],
  },
  property: {
    primary: ["property", "real estate", "rental", "landlord", "tenant"],
    secondary: ["apartment", "building", "lease", "mortgage", "maintenance", "housing", "rent"],
  },
  nonprofit: {
    primary: ["nonprofit", "non-profit", "charity", "foundation", "ngo"],
    secondary: ["grant", "donation", "fund", "mission", "501c3", "donor", "volunteer"],
  },
};

export interface RecommendContext {
  readonly industry?: string;
  readonly description?: string;
  readonly businessModel?: string;
}

export interface TemplateRecommendation {
  readonly template: Template;
  readonly score: number;
  readonly reason: string;
}

export const recommendTemplate = (context: RecommendContext): TemplateRecommendation[] => {
  const input = [
    context.industry ?? "",
    context.description ?? "",
    context.businessModel ?? "",
  ]
    .join(" ")
    .toLowerCase();

  // Tokenize: split on whitespace and common punctuation
  const tokens = input.split(/[\s,.\-_/;:()]+/).filter((t) => t.length > 1);

  const scored: TemplateRecommendation[] = TEMPLATES.map((template) => {
    const kw = TEMPLATE_KEYWORDS[template.slug];
    if (!kw) return { template, score: 0, reason: "" };

    let score = 0;
    const matched: string[] = [];

    for (const token of tokens) {
      for (const pk of kw.primary) {
        if (pk.includes(token) || token.includes(pk)) {
          score += 3;
          if (!matched.includes(pk)) matched.push(pk);
        }
      }
      for (const sk of kw.secondary) {
        if (sk.includes(token) || token.includes(sk)) {
          score += 1;
          if (!matched.includes(sk)) matched.push(sk);
        }
      }
    }

    const reason = matched.length > 0
      ? `Matched keywords: ${matched.slice(0, 5).join(", ")}`
      : "No keyword matches";

    return { template, score, reason };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
};

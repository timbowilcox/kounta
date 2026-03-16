// ---------------------------------------------------------------------------
// Tier configuration — defines limits, features, and pricing for each plan.
//
// The billing entity is the USER (account), not the ledger.
// Prices are in cents (smallest currency unit).
// null limits mean unlimited.
// ---------------------------------------------------------------------------

export const TIER_CONFIGS = {
  free: {
    name: "Free",
    price: 0,
    limits: {
      maxLedgers: 1,
      maxTransactionsPerMonth: 100,
      maxInvoicesPerMonth: 5,
      maxCustomers: 3,
      maxFixedAssets: 3,
    },
    features: {
      apiAccess: false,
      sdkAccess: false,
      mcpAccess: true,
      dashboardAccess: true,
      pdfExport: false,
      invoiceEmail: false,
      multiCurrency: false,
      revenueRecognition: false,
      customChartOfAccounts: false,
      consolidatedView: false,
      programmaticProvisioning: false,
      webhooks: false,
      whiteLabel: false,
    },
    bankSyncInterval: "daily" as const,
    aiModel: "haiku" as const,
  },
  builder: {
    name: "Builder",
    price: 1900,
    limits: {
      maxLedgers: 3,
      maxTransactionsPerMonth: 1000,
      maxInvoicesPerMonth: null,
      maxCustomers: null,
      maxFixedAssets: null,
    },
    features: {
      apiAccess: true,
      sdkAccess: true,
      mcpAccess: true,
      dashboardAccess: true,
      pdfExport: true,
      invoiceEmail: true,
      multiCurrency: true,
      revenueRecognition: false,
      customChartOfAccounts: false,
      consolidatedView: false,
      programmaticProvisioning: false,
      webhooks: false,
      whiteLabel: false,
    },
    bankSyncInterval: "hourly" as const,
    aiModel: "sonnet" as const,
  },
  pro: {
    name: "Pro",
    price: 4900,
    limits: {
      maxLedgers: 10,
      maxTransactionsPerMonth: 10000,
      maxInvoicesPerMonth: null,
      maxCustomers: null,
      maxFixedAssets: null,
    },
    features: {
      apiAccess: true,
      sdkAccess: true,
      mcpAccess: true,
      dashboardAccess: true,
      pdfExport: true,
      invoiceEmail: true,
      multiCurrency: true,
      revenueRecognition: true,
      customChartOfAccounts: true,
      consolidatedView: true,
      programmaticProvisioning: false,
      webhooks: false,
      whiteLabel: false,
    },
    bankSyncInterval: "realtime" as const,
    aiModel: "sonnet" as const,
  },
  platform: {
    name: "Platform",
    price: 14900,
    limits: {
      maxLedgers: null,
      maxTransactionsPerMonth: null,
      maxInvoicesPerMonth: null,
      maxCustomers: null,
      maxFixedAssets: null,
    },
    features: {
      apiAccess: true,
      sdkAccess: true,
      mcpAccess: true,
      dashboardAccess: true,
      pdfExport: true,
      invoiceEmail: true,
      multiCurrency: true,
      revenueRecognition: true,
      customChartOfAccounts: true,
      consolidatedView: true,
      programmaticProvisioning: true,
      webhooks: true,
      whiteLabel: true,
    },
    bankSyncInterval: "realtime" as const,
    aiModel: "sonnet" as const,
  },
} as const;

export type Tier = keyof typeof TIER_CONFIGS;
export type TierFeature = keyof typeof TIER_CONFIGS.free.features;
export type TierLimit = keyof typeof TIER_CONFIGS.free.limits;

export function getTierConfig(tier: string) {
  return TIER_CONFIGS[tier as Tier] ?? TIER_CONFIGS.free;
}

export function hasFeature(tier: string, feature: TierFeature): boolean {
  return getTierConfig(tier).features[feature] ?? false;
}

export function getLimit(tier: string, limit: TierLimit): number | null {
  const config = getTierConfig(tier);
  const value = config.limits[limit];
  // null means unlimited; undefined (unknown limit key) defaults to 0
  return value === undefined ? 0 : value;
}

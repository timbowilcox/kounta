// ---------------------------------------------------------------------------
// Fixed Asset Depreciation — types for assets, schedules, and calculations.
// All monetary amounts are integers in the smallest currency unit (cents).
// ---------------------------------------------------------------------------

export type DepreciationMethod =
  | "straight_line"
  | "diminishing_value"
  | "declining_balance"
  | "prime_cost"
  | "macrs"
  | "writing_down_allowance"
  | "aia"
  | "section_179"
  | "bonus_depreciation"
  | "instant_writeoff"
  | "cca"
  | "none";

export type AssetStatus = "active" | "disposed" | "fully_depreciated";

export type CapitalAllowancePool = "main" | "special" | "single" | "aia";

export interface FixedAsset {
  readonly id: string;
  readonly ledgerId: string;
  readonly jurisdiction: string;
  readonly name: string;
  readonly description: string | null;
  readonly assetNumber: string | null;
  readonly assetType: string | null;
  readonly costAmount: number;
  readonly currency: string;
  readonly purchaseDate: string;
  readonly depreciationMethod: DepreciationMethod;
  readonly usefulLifeMonths: number | null;
  readonly depreciationRate: number | null;
  readonly salvageValue: number;
  // AU specific
  readonly atoEffectiveLifeYears: number | null;
  readonly instantWriteoffYear: number | null;
  // US specific
  readonly macrsPropertyClass: string | null;
  readonly section179Elected: boolean;
  readonly bonusDepreciationAmount: number | null;
  readonly bonusDepreciationElected: boolean;
  // UK specific
  readonly capitalAllowancePool: CapitalAllowancePool | null;
  readonly aiaClaimed: boolean;
  readonly aiaAmount: number | null;
  // Account links
  readonly assetAccountId: string;
  readonly accumulatedDepreciationAccountId: string | null;
  readonly depreciationExpenseAccountId: string | null;
  readonly sourceTransactionId: string | null;
  // Status
  readonly status: AssetStatus;
  readonly disposalDate: string | null;
  readonly disposalProceeds: number | null;
  readonly disposalTransactionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DepreciationPeriod {
  readonly id: string;
  readonly assetId: string;
  readonly ledgerId: string;
  readonly jurisdiction: string;
  readonly periodDate: string;
  readonly periodNumber: number;
  readonly financialYear: string;
  readonly depreciationAmount: number;
  readonly accumulatedDepreciation: number;
  readonly netBookValue: number;
  readonly transactionId: string | null;
  readonly postedAt: string | null;
  readonly createdAt: string;
}

export interface FixedAssetWithSchedule extends FixedAsset {
  readonly schedule: readonly DepreciationPeriod[];
}

export interface CreateFixedAssetInput {
  readonly ledgerId: string;
  readonly name: string;
  readonly description?: string;
  readonly assetNumber?: string;
  readonly assetType?: string;
  readonly costAmount: number;
  readonly currency?: string;
  readonly purchaseDate: string;
  readonly depreciationMethod?: DepreciationMethod;
  readonly usefulLifeMonths?: number;
  readonly salvageValue?: number;
  readonly assetAccountId: string;
  readonly accumulatedDepreciationAccountId?: string;
  readonly depreciationExpenseAccountId?: string;
  readonly sourceTransactionId?: string;
  // Jurisdiction-specific overrides
  readonly macrsPropertyClass?: string;
  readonly capitalAllowancePool?: CapitalAllowancePool;
  // Pro-rata first period (default true). When true, the first depreciation
  // period is reduced proportionally based on days remaining in the purchase month.
  readonly proRataFirstPeriod?: boolean;
}

export interface UpdateFixedAssetInput {
  readonly name?: string;
  readonly description?: string;
  readonly assetType?: string;
  readonly usefulLifeMonths?: number;
  readonly salvageValueCents?: number;
  readonly depreciationMethod?: DepreciationMethod;
}

export interface DisposeAssetInput {
  readonly disposalDate: string;
  readonly disposalProceeds: number;
  readonly proceedsAccountId?: string;
  readonly gainAccountId?: string;
  readonly lossAccountId?: string;
  readonly notes?: string;
}

export interface CapitalisationAdvice {
  readonly recommendation: "expense" | "instant_writeoff" | "capitalise" | "consider_section_179";
  readonly reason: string;
  readonly threshold?: number | null;
  readonly suggestedMethod?: string;
  readonly suggestedLifeYears?: number;
}

export interface AssetSummary {
  readonly totalAssets: number;
  readonly totalCost: number;
  readonly totalNbv: number;
  readonly totalAccumulated: number;
  readonly pendingEntries: number;
  readonly pendingAmount: number;
  readonly nextDepreciationDate: string | null;
  readonly currentFinancialYear: string;
  readonly depreciationThisFy: number;
  readonly depreciationLastFy: number;
  readonly assetsByStatus: {
    readonly active: number;
    readonly disposed: number;
    readonly fullyDepreciated: number;
  };
}

export interface DepreciationRunResult {
  readonly posted: number;
  readonly totalAmount: number;
  readonly assetsAffected: number;
  readonly entries: readonly {
    readonly assetName: string;
    readonly amount: number;
    readonly period: string;
  }[];
}

export interface DisposalResult {
  readonly assetName: string;
  readonly originalCost: number;
  readonly accumulatedDepreciation: number;
  readonly netBookValue: number;
  readonly disposalProceeds: number;
  readonly gainLoss: number;
  readonly gainOrLoss: "gain" | "loss" | "nil";
  readonly transactionId: string;
  readonly cgtNote: string | null;
  readonly journalEntries: readonly {
    readonly accountName: string;
    readonly type: "debit" | "credit";
    readonly amount: number;
  }[];
}

// ---------------------------------------------------------------------------
// Row types (snake_case from DB)
// ---------------------------------------------------------------------------

export interface FixedAssetRow {
  id: string;
  ledger_id: string;
  jurisdiction: string;
  name: string;
  description: string | null;
  asset_number: string | null;
  asset_type: string | null;
  cost_amount: number;
  currency: string;
  purchase_date: string;
  depreciation_method: string;
  useful_life_months: number | null;
  depreciation_rate: number | null;
  salvage_value: number;
  ato_effective_life_years: number | null;
  instant_writeoff_year: number | null;
  macrs_property_class: string | null;
  section_179_elected: number | boolean;
  bonus_depreciation_amount: number | null;
  bonus_depreciation_elected: number | boolean;
  capital_allowance_pool: string | null;
  aia_claimed: number | boolean;
  aia_amount: number | null;
  asset_account_id: string;
  accumulated_depreciation_account_id: string | null;
  depreciation_expense_account_id: string | null;
  source_transaction_id: string | null;
  status: string;
  disposal_date: string | null;
  disposal_proceeds: number | null;
  disposal_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DepreciationPeriodRow {
  id: string;
  asset_id: string;
  ledger_id: string;
  jurisdiction: string;
  period_date: string;
  period_number: number;
  financial_year: string;
  depreciation_amount: number;
  accumulated_depreciation: number;
  net_book_value: number;
  transaction_id: string | null;
  posted_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Row → domain mappers
// ---------------------------------------------------------------------------

const toBool = (v: number | boolean | null | undefined): boolean =>
  v === true || v === 1;

export const mapFixedAsset = (row: FixedAssetRow): FixedAsset => ({
  id: row.id,
  ledgerId: row.ledger_id,
  jurisdiction: row.jurisdiction,
  name: row.name,
  description: row.description,
  assetNumber: row.asset_number,
  assetType: row.asset_type,
  costAmount: Number(row.cost_amount),
  currency: row.currency,
  purchaseDate: row.purchase_date,
  depreciationMethod: row.depreciation_method as DepreciationMethod,
  usefulLifeMonths: row.useful_life_months,
  depreciationRate: row.depreciation_rate,
  salvageValue: Number(row.salvage_value),
  atoEffectiveLifeYears: row.ato_effective_life_years,
  instantWriteoffYear: row.instant_writeoff_year,
  macrsPropertyClass: row.macrs_property_class,
  section179Elected: toBool(row.section_179_elected),
  bonusDepreciationAmount: row.bonus_depreciation_amount != null ? Number(row.bonus_depreciation_amount) : null,
  bonusDepreciationElected: toBool(row.bonus_depreciation_elected),
  capitalAllowancePool: row.capital_allowance_pool as CapitalAllowancePool | null,
  aiaClaimed: toBool(row.aia_claimed),
  aiaAmount: row.aia_amount != null ? Number(row.aia_amount) : null,
  assetAccountId: row.asset_account_id,
  accumulatedDepreciationAccountId: row.accumulated_depreciation_account_id,
  depreciationExpenseAccountId: row.depreciation_expense_account_id,
  sourceTransactionId: row.source_transaction_id,
  status: row.status as AssetStatus,
  disposalDate: row.disposal_date,
  disposalProceeds: row.disposal_proceeds != null ? Number(row.disposal_proceeds) : null,
  disposalTransactionId: row.disposal_transaction_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const mapDepreciationPeriod = (row: DepreciationPeriodRow): DepreciationPeriod => ({
  id: row.id,
  assetId: row.asset_id,
  ledgerId: row.ledger_id,
  jurisdiction: row.jurisdiction,
  periodDate: row.period_date,
  periodNumber: row.period_number,
  financialYear: row.financial_year,
  depreciationAmount: Number(row.depreciation_amount),
  accumulatedDepreciation: Number(row.accumulated_depreciation),
  netBookValue: Number(row.net_book_value),
  transactionId: row.transaction_id,
  postedAt: row.posted_at,
  createdAt: row.created_at,
});

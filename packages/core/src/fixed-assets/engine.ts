// ---------------------------------------------------------------------------
// Fixed Asset Depreciation Engine — CRUD, schedule generation, depreciation
// calculation, processing, disposal, and capitalisation advisory.
// ---------------------------------------------------------------------------

import type { Database } from "../db/database.js";
import type { LedgerEngine } from "../engine/index.js";
import { generateId, nowUtc, todayUtc } from "../engine/id.js";
import type { Result, PaginatedResult } from "../types/index.js";
import type {
  FixedAsset,
  FixedAssetWithSchedule,
  DepreciationPeriod,
  CreateFixedAssetInput,
  DisposeAssetInput,
  CapitalisationAdvice,
  AssetSummary,
  DepreciationRunResult,
  DisposalResult,
  FixedAssetRow,
  DepreciationPeriodRow,
  DepreciationMethod,
} from "./types.js";
import { mapFixedAsset, mapDepreciationPeriod } from "./types.js";

// ---------------------------------------------------------------------------
// MACRS depreciation tables (annual percentages)
// ---------------------------------------------------------------------------

const MACRS_TABLES: Record<string, number[]> = {
  "3-year": [33.33, 44.45, 14.81, 7.41],
  "5-year": [20.0, 32.0, 19.2, 11.52, 11.52, 5.76],
  "7-year": [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
  "10-year": [10.0, 18.0, 14.4, 11.52, 9.22, 7.37, 6.55, 6.55, 6.56, 6.55, 3.28],
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const addMonths = (date: Date, months: number): Date => {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
};

const formatDate = (d: Date): string => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const monthsDiff = (a: Date, b: Date): number => {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
};

const daysInMonth = (date: Date): number => {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
};

// ---------------------------------------------------------------------------
// Financial year helpers (imported lazily to avoid circular deps)
// ---------------------------------------------------------------------------

// Inline simplified versions — the full jurisdiction config lives in
// packages/core/src/jurisdiction/config.ts which we import at the call site.

const getFinancialYearLabelForDate = (date: Date, taxYearStartMM: number): string => {
  if (taxYearStartMM === 1) return String(date.getUTCFullYear());
  const fyStartThisYear = new Date(Date.UTC(date.getUTCFullYear(), taxYearStartMM - 1, 1));
  if (date >= fyStartThisYear) {
    return `${date.getUTCFullYear()}-${String(date.getUTCFullYear() + 1).slice(2)}`;
  }
  return `${date.getUTCFullYear() - 1}-${String(date.getUTCFullYear()).slice(2)}`;
};

const getTaxYearStartMonth = (jurisdiction: string): number => {
  const map: Record<string, number> = {
    AU: 7, US: 1, UK: 4, NZ: 4, CA: 1, SG: 1, OTHER: 1,
  };
  return map[jurisdiction] ?? 1;
};

// ---------------------------------------------------------------------------
// Depreciation calculation
// ---------------------------------------------------------------------------

export const calculateMonthlyDepreciation = (
  method: DepreciationMethod,
  costAmount: number,
  salvageValue: number,
  usefulLifeMonths: number,
  currentNBV: number,
  periodNumber: number,
  jurisdiction: string,
  macrsPropertyClass?: string | null,
  capitalAllowancePool?: string | null,
): number => {
  switch (method) {
    case "prime_cost":
    case "straight_line":
      return Math.floor((costAmount - salvageValue) / usefulLifeMonths);

    case "diminishing_value": {
      // AU: rate = 200% / effective life years / 12
      const lifeYears = usefulLifeMonths / 12;
      const rate = 2.0 / lifeYears / 12;
      return Math.floor(currentNBV * rate);
    }

    case "declining_balance": {
      const dvRate = jurisdiction === "NZ" ? 1.5 : 2.0;
      const lifeYears = usefulLifeMonths / 12;
      const rate = dvRate / lifeYears / 12;
      return Math.floor(currentNBV * rate);
    }

    case "macrs": {
      const propClass = macrsPropertyClass ?? "5-year";
      const table = MACRS_TABLES[propClass] ?? MACRS_TABLES["5-year"]!;
      const year = Math.ceil(periodNumber / 12);
      const annualPct = (table[year - 1] ?? 0) / 100;
      const annualAmount = Math.floor(costAmount * annualPct);
      return Math.floor(annualAmount / 12);
    }

    case "writing_down_allowance": {
      const wdaRate = capitalAllowancePool === "special" ? 0.06 : 0.18;
      return Math.floor(currentNBV * wdaRate / 12);
    }

    case "instant_writeoff":
    case "section_179":
    case "bonus_depreciation":
    case "aia":
      return periodNumber === 1 ? costAmount - salvageValue : 0;

    case "cca": {
      // Canadian CCA simplified as declining balance at 30%
      return Math.floor(currentNBV * 0.30 / 12);
    }

    case "none":
      return 0;

    default:
      return 0;
  }
};

// ---------------------------------------------------------------------------
// Schedule generation
// ---------------------------------------------------------------------------

interface GeneratedPeriod {
  periodDate: string;
  periodNumber: number;
  financialYear: string;
  depreciationAmount: number;
  accumulatedDepreciation: number;
  netBookValue: number;
}

// ---------------------------------------------------------------------------
// MACRS schedule — half-year convention
// ---------------------------------------------------------------------------
// TODO: Mid-quarter convention is not yet supported (only half-year).
// The mid-quarter convention applies when more than 40% of all depreciable
// property placed in service during the tax year is placed in service during
// the last 3 months. This is not checked or implemented.

const generateMACRSSchedule = (
  costAmount: number,
  salvageValue: number,
  startDate: Date,
  macrsPropertyClass: string | null | undefined,
  taxYearStartMonth: number,
): GeneratedPeriod[] => {
  const propClass = macrsPropertyClass ?? "5-year";
  const table = MACRS_TABLES[propClass] ?? MACRS_TABLES["5-year"]!;
  const depreciable = costAmount - salvageValue;
  const purchaseMonth0 = startDate.getUTCMonth(); // 0-based (0=Jan)

  // Year 1: months from purchase month through December
  const year1Months = 12 - purchaseMonth0;
  // Final recovery year is always 6 months (Jan–Jun) under the half-year convention,
  // regardless of when in the year the asset was placed in service.
  // TODO: Mid-quarter convention would change this to 1.5 months for Q4 assets.
  const finalYearMonths = 6;

  const periods: GeneratedPeriod[] = [];
  let accumulated = 0;
  let currentNBV = costAmount;
  let periodCounter = 0;

  for (let yearIdx = 0; yearIdx < table.length; yearIdx++) {
    const isFirstYear = yearIdx === 0;
    const isLastYear = yearIdx === table.length - 1;

    let yearAmount: number;
    let monthsThisYear: number;

    if (isLastYear) {
      // Final recovery year: use remaining depreciable amount
      yearAmount = depreciable - accumulated;
      monthsThisYear = finalYearMonths;
    } else {
      yearAmount = Math.floor(costAmount * table[yearIdx]! / 100);
      monthsThisYear = isFirstYear ? year1Months : 12;
    }

    if (yearAmount <= 0 || monthsThisYear <= 0) continue;

    const monthlyAmount = Math.floor(yearAmount / monthsThisYear);
    let yearAccumulated = 0;

    for (let m = 0; m < monthsThisYear; m++) {
      periodCounter++;
      const periodDate = addMonths(startDate, periodCounter);

      // Last month of this year: absorb rounding remainder for the year
      let amount = (m === monthsThisYear - 1)
        ? yearAmount - yearAccumulated
        : monthlyAmount;

      // Don't go below salvage value
      if (currentNBV - amount < salvageValue) {
        amount = currentNBV - salvageValue;
      }
      if (amount <= 0) break;

      yearAccumulated += amount;
      accumulated += amount;
      currentNBV -= amount;

      periods.push({
        periodDate: formatDate(periodDate),
        periodNumber: periodCounter,
        financialYear: getFinancialYearLabelForDate(periodDate, taxYearStartMonth),
        depreciationAmount: amount,
        accumulatedDepreciation: accumulated,
        netBookValue: currentNBV,
      });

      if (currentNBV <= salvageValue) break;
    }

    if (currentNBV <= salvageValue) break;
  }

  return periods;
};

// ---------------------------------------------------------------------------
// generateSchedule — main entry point
// ---------------------------------------------------------------------------

export const generateSchedule = (
  costAmount: number,
  salvageValue: number,
  usefulLifeMonths: number,
  purchaseDate: string,
  method: DepreciationMethod,
  jurisdiction: string,
  macrsPropertyClass?: string | null,
  capitalAllowancePool?: string | null,
  proRataFirstPeriod: boolean = true,
): GeneratedPeriod[] => {
  if (method === "none") return [];

  const depreciable = costAmount - salvageValue;
  const startDate = new Date(purchaseDate + "T00:00:00Z");
  const taxYearStartMonth = getTaxYearStartMonth(jurisdiction);

  // MACRS uses its own half-year convention schedule generation
  if (method === "macrs") {
    return generateMACRSSchedule(costAmount, salvageValue, startDate, macrsPropertyClass, taxYearStartMonth);
  }

  const periods: GeneratedPeriod[] = [];
  let accumulated = 0;
  let currentNBV = costAmount;
  const maxPeriods = (method === "instant_writeoff" || method === "section_179" || method === "aia") ? 1 : usefulLifeMonths || 360;

  // Calculate pro-rata factor for first period.
  // Pro-rata divides the purchase month's remaining days by total days in that month.
  // Example: purchased March 15, 31 days in March, 16 remaining → factor = 16/31.
  let proRataFactor = 1.0;
  if (proRataFirstPeriod && maxPeriods > 1) {
    const totalDays = daysInMonth(startDate);
    const dayOfMonth = startDate.getUTCDate();
    const daysRemaining = totalDays - dayOfMonth;
    if (daysRemaining > 0 && daysRemaining < totalDays) {
      proRataFactor = daysRemaining / totalDays;
    }
    // Purchases in the first ~2 days of a month get a full first period.
    // Without this threshold, a Jan 1 purchase would get factor=30/31≈0.968
    // which is misleadingly close to 1.0 and confuses users.
    if (proRataFactor >= 0.95) {
      proRataFactor = 1.0;
    }
  }

  for (let i = 1; i <= maxPeriods; i++) {
    const periodDate = addMonths(startDate, i);
    let amount = calculateMonthlyDepreciation(
      method, costAmount, salvageValue, usefulLifeMonths, currentNBV, i,
      jurisdiction, macrsPropertyClass, capitalAllowancePool,
    );

    // Apply pro-rata to first period
    if (i === 1 && proRataFactor < 1.0) {
      amount = Math.floor(amount * proRataFactor);
    }

    // Don't go below salvage value
    if (currentNBV - amount < salvageValue) {
      amount = currentNBV - salvageValue;
    }
    if (amount <= 0) break;

    accumulated += amount;
    currentNBV -= amount;

    periods.push({
      periodDate: formatDate(periodDate),
      periodNumber: i,
      financialYear: getFinancialYearLabelForDate(periodDate, taxYearStartMonth),
      depreciationAmount: amount,
      accumulatedDepreciation: accumulated,
      netBookValue: currentNBV,
    });

    if (currentNBV <= salvageValue) break;
  }

  // Adjust last period for rounding — ensure total = depreciable exactly.
  // For linear methods (straight_line, prime_cost), always absorb the residual
  // so that cost - salvage is fully depreciated (this includes any pro-rata shortfall).
  // For non-linear methods (DV, WDA, CCA), only absorb small rounding errors.
  if (periods.length > 0) {
    const last = periods[periods.length - 1]!;
    const adjustment = last.netBookValue - salvageValue;
    const isLinearMethod = method === "straight_line" || method === "prime_cost";
    if (adjustment > 0 && (isLinearMethod || adjustment < depreciable * 0.01)) {
      last.depreciationAmount += adjustment;
      last.netBookValue = salvageValue;
      last.accumulatedDepreciation = depreciable;
    }
  }

  return periods;
};

// ---------------------------------------------------------------------------
// Capitalisation advisory
// ---------------------------------------------------------------------------

interface JurisdictionThresholds {
  capitalisationThreshold: number;
  instantWriteOffThresholds?: Record<number, number>;
  smallBusinessThreshold?: number;
  section179Limit?: number;
  defaultDepreciationMethod: string;
  effectiveLives?: Record<string, number>;
}

const JURISDICTION_THRESHOLDS: Record<string, JurisdictionThresholds> = {
  AU: {
    capitalisationThreshold: 30000,
    instantWriteOffThresholds: { 2024: 2_000_000, 2025: 2_000_000, 2026: 2_000_000 },
    smallBusinessThreshold: 1_000_000_000,
    defaultDepreciationMethod: "diminishing_value",
    effectiveLives: {
      laptop: 3, desktop_computer: 4, mobile_phone: 3, tablet: 3,
      server: 5, network_equipment: 5, office_furniture: 10,
      motor_vehicle_car: 8, motor_vehicle_ute: 5, commercial_vehicle: 5,
      manufacturing_equipment: 10, office_equipment: 5,
      air_conditioner: 10, solar_panels: 20, building_fitout: 10,
      software: 2.5, website: 2.5,
    },
  },
  US: {
    capitalisationThreshold: 250_000,
    section179Limit: 116_000_000,
    defaultDepreciationMethod: "macrs",
    effectiveLives: {
      laptop: 5, desktop_computer: 5, mobile_phone: 5, tablet: 5,
      server: 5, office_furniture: 7, motor_vehicle_car: 5,
      commercial_vehicle: 5, manufacturing_equipment: 7,
      office_equipment: 5, building: 39, residential_rental: 27.5, software: 3,
    },
  },
  UK: {
    capitalisationThreshold: 0,
    defaultDepreciationMethod: "writing_down_allowance",
    effectiveLives: {
      laptop: 4, desktop_computer: 4, mobile_phone: 3, server: 5,
      office_furniture: 10, motor_vehicle_car: 5, commercial_vehicle: 5,
      manufacturing_equipment: 10, office_equipment: 5,
    },
  },
  NZ: {
    capitalisationThreshold: 100_000,
    defaultDepreciationMethod: "diminishing_value",
  },
  CA: {
    capitalisationThreshold: 150_000,
    defaultDepreciationMethod: "cca",
  },
  SG: {
    capitalisationThreshold: 0,
    defaultDepreciationMethod: "straight_line",
  },
  OTHER: {
    capitalisationThreshold: 0,
    defaultDepreciationMethod: "straight_line",
  },
};

const MACRS_PROPERTY_CLASSES: Record<string, string> = {
  laptop: "5-year", desktop_computer: "5-year", mobile_phone: "5-year",
  server: "5-year", office_furniture: "7-year", motor_vehicle_car: "5-year",
  manufacturing_equipment: "7-year", software: "3-year",
};

export const adviseOnCapitalisation = (
  amount: number,
  jurisdiction: string,
  annualTurnover: number | null,
  purchaseYear: number,
  assetType: string,
): CapitalisationAdvice => {
  const config = JURISDICTION_THRESHOLDS[jurisdiction] ?? JURISDICTION_THRESHOLDS["OTHER"]!;

  // Below capitalisation threshold — expense it
  if (amount < config.capitalisationThreshold) {
    return {
      recommendation: "expense",
      reason: `Below ${jurisdiction} capitalisation threshold of $${(config.capitalisationThreshold / 100).toFixed(0)}`,
    };
  }

  // Check AU instant write-off
  if (jurisdiction === "AU" && config.instantWriteOffThresholds) {
    const threshold = config.instantWriteOffThresholds[purchaseYear];
    if (threshold) {
      if (annualTurnover && annualTurnover > (config.smallBusinessThreshold ?? Infinity)) {
        // Over SBE threshold — can't use instant write-off
      } else if (amount <= threshold) {
        return {
          recommendation: "instant_writeoff",
          reason: `Eligible for instant asset write-off — full cost deductible in ${purchaseYear}. ` +
            `Asset cost $${(amount / 100).toFixed(2)} is under the $${(threshold / 100).toFixed(0)} threshold.`,
          threshold,
        };
      }
    }
  }

  // Check US Section 179
  if (jurisdiction === "US" && config.section179Limit && amount <= config.section179Limit) {
    return {
      recommendation: "consider_section_179",
      reason: `Eligible for Section 179 immediate deduction (limit: $${(config.section179Limit / 100).toLocaleString()})`,
    };
  }

  // Default: capitalise and depreciate
  const lifeYears = config.effectiveLives?.[assetType];
  return {
    recommendation: "capitalise",
    reason: `Amount exceeds capitalisation threshold. Recommend ${config.defaultDepreciationMethod} ` +
      `depreciation${lifeYears ? ` over ${lifeYears} years` : ""}.`,
    suggestedMethod: config.defaultDepreciationMethod,
    suggestedLifeYears: lifeYears,
  };
};

// ---------------------------------------------------------------------------
// CRUD — Create
// ---------------------------------------------------------------------------

export const createFixedAsset = async (
  db: Database,
  input: CreateFixedAssetInput,
): Promise<Result<FixedAssetWithSchedule>> => {
  if (input.costAmount <= 0) {
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: "costAmount must be positive", details: [] },
    };
  }

  // Look up ledger jurisdiction
  const ledger = await db.get<{ jurisdiction: string; currency: string }>(
    "SELECT jurisdiction, currency FROM ledgers WHERE id = ?",
    [input.ledgerId],
  );
  const jurisdiction = ledger?.jurisdiction ?? "AU";
  const currency = input.currency ?? ledger?.currency ?? "AUD";

  // Determine depreciation method
  const jConfig = JURISDICTION_THRESHOLDS[jurisdiction] ?? JURISDICTION_THRESHOLDS["OTHER"]!;
  const method = (input.depreciationMethod ?? jConfig.defaultDepreciationMethod) as DepreciationMethod;

  // Determine useful life
  let usefulLifeMonths = input.usefulLifeMonths ?? null;
  if (!usefulLifeMonths && input.assetType && jConfig.effectiveLives) {
    const years = jConfig.effectiveLives[input.assetType];
    if (years) {
      usefulLifeMonths = Math.round(years * 12);
    }
  }
  if (!usefulLifeMonths && method !== "instant_writeoff" && method !== "section_179" && method !== "aia" && method !== "none") {
    usefulLifeMonths = 60; // Default 5 years
  }

  // MACRS property class
  const macrsPropertyClass = input.macrsPropertyClass ?? (jurisdiction === "US" && input.assetType ? MACRS_PROPERTY_CLASSES[input.assetType] ?? "5-year" : null);

  const salvageValue = input.salvageValue ?? 0;
  const assetId = generateId();
  const now = nowUtc();

  // Generate schedule
  const schedule = generateSchedule(
    input.costAmount, salvageValue, usefulLifeMonths ?? 1,
    input.purchaseDate, method, jurisdiction,
    macrsPropertyClass, input.capitalAllowancePool,
    input.proRataFirstPeriod ?? true,
  );

  await db.transaction(async () => {
    await db.run(
      `INSERT INTO fixed_assets
        (id, ledger_id, jurisdiction, name, description, asset_number, asset_type,
         cost_amount, currency, purchase_date, depreciation_method,
         useful_life_months, salvage_value,
         ato_effective_life_years, instant_writeoff_year,
         macrs_property_class, section_179_elected, bonus_depreciation_elected,
         capital_allowance_pool, aia_claimed,
         asset_account_id, accumulated_depreciation_account_id,
         depreciation_expense_account_id, source_transaction_id,
         status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        assetId, input.ledgerId, jurisdiction, input.name,
        input.description ?? null, input.assetNumber ?? null, input.assetType ?? null,
        input.costAmount, currency, input.purchaseDate, method,
        usefulLifeMonths, salvageValue,
        jConfig.effectiveLives?.[input.assetType ?? ""] ?? null,
        method === "instant_writeoff" ? new Date(input.purchaseDate).getUTCFullYear() : null,
        macrsPropertyClass,
        method === "section_179" ? 1 : 0,
        method === "bonus_depreciation" ? 1 : 0,
        input.capitalAllowancePool ?? null,
        method === "aia" ? 1 : 0,
        input.assetAccountId,
        input.accumulatedDepreciationAccountId ?? null,
        input.depreciationExpenseAccountId ?? null,
        input.sourceTransactionId ?? null,
        now, now,
      ],
    );

    // Insert schedule periods
    for (const period of schedule) {
      const periodId = generateId();
      await db.run(
        `INSERT INTO depreciation_schedule
          (id, asset_id, ledger_id, jurisdiction, period_date, period_number,
           financial_year, depreciation_amount, accumulated_depreciation,
           net_book_value, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          periodId, assetId, input.ledgerId, jurisdiction,
          period.periodDate, period.periodNumber, period.financialYear,
          period.depreciationAmount, period.accumulatedDepreciation,
          period.netBookValue, now,
        ],
      );
    }
  });

  return getFixedAsset(db, assetId);
};

// ---------------------------------------------------------------------------
// CRUD — Read
// ---------------------------------------------------------------------------

export const getFixedAsset = async (
  db: Database,
  assetId: string,
): Promise<Result<FixedAssetWithSchedule>> => {
  const row = await db.get<FixedAssetRow>(
    "SELECT * FROM fixed_assets WHERE id = ?",
    [assetId],
  );
  if (!row) {
    return { ok: false, error: { code: "NOT_FOUND", message: `Fixed asset ${assetId} not found` } };
  }

  const periodRows = await db.all<DepreciationPeriodRow>(
    "SELECT * FROM depreciation_schedule WHERE asset_id = ? ORDER BY period_number",
    [assetId],
  );

  return {
    ok: true,
    value: {
      ...mapFixedAsset(row),
      schedule: periodRows.map(mapDepreciationPeriod),
    },
  };
};

export const listFixedAssets = async (
  db: Database,
  ledgerId: string,
  opts?: { status?: string; cursor?: string; limit?: number },
): Promise<PaginatedResult<FixedAsset>> => {
  const limit = Math.min(opts?.limit ?? 50, 200);
  const conditions: string[] = ["ledger_id = ?"];
  const params: unknown[] = [ledgerId];

  if (opts?.status && opts.status !== "all") {
    conditions.push("status = ?");
    params.push(opts.status);
  }
  if (opts?.cursor) {
    conditions.push("id < ?");
    params.push(opts.cursor);
  }

  params.push(limit + 1);

  const rows = await db.all<FixedAssetRow>(
    `SELECT * FROM fixed_assets WHERE ${conditions.join(" AND ")} ORDER BY id DESC LIMIT ?`,
    params,
  );

  const hasMore = rows.length > limit;
  const data = (hasMore ? rows.slice(0, limit) : rows).map(mapFixedAsset);

  return {
    data,
    nextCursor: hasMore ? data[data.length - 1]!.id : null,
  };
};

// ---------------------------------------------------------------------------
// Schedule retrieval
// ---------------------------------------------------------------------------

export const getAssetSchedule = async (
  db: Database,
  assetId: string,
): Promise<Result<{ asset: FixedAsset; schedule: DepreciationPeriod[] }>> => {
  const assetResult = await getFixedAsset(db, assetId);
  if (!assetResult.ok) return assetResult;
  return {
    ok: true,
    value: {
      asset: assetResult.value,
      schedule: [...assetResult.value.schedule],
    },
  };
};

// ---------------------------------------------------------------------------
// Pending depreciation entries
// ---------------------------------------------------------------------------

export const getPendingDepreciation = async (
  db: Database,
  ledgerId: string,
  asOfDate?: string,
): Promise<{
  pendingCount: number;
  totalAmount: number;
  entries: Array<{
    assetId: string;
    assetName: string;
    periodDate: string;
    periodNumber: number;
    amount: number;
    nbvAfter: number;
  }>;
}> => {
  const today = asOfDate ?? todayUtc();

  const rows = await db.all<DepreciationPeriodRow & { asset_name: string }>(
    `SELECT ds.*, fa.name AS asset_name
     FROM depreciation_schedule ds
     JOIN fixed_assets fa ON ds.asset_id = fa.id
     WHERE ds.ledger_id = ?
       AND ds.period_date <= ?
       AND ds.posted_at IS NULL
       AND fa.status = 'active'
     ORDER BY ds.period_date, fa.name`,
    [ledgerId, today],
  );

  let totalAmount = 0;
  const entries = rows.map((r) => {
    totalAmount += Number(r.depreciation_amount);
    return {
      assetId: r.asset_id,
      assetName: r.asset_name,
      periodDate: r.period_date,
      periodNumber: r.period_number,
      amount: Number(r.depreciation_amount),
      nbvAfter: Number(r.net_book_value),
    };
  });

  return { pendingCount: entries.length, totalAmount, entries };
};

// ---------------------------------------------------------------------------
// Run depreciation — post all pending entries
// ---------------------------------------------------------------------------

export const runDepreciation = async (
  db: Database,
  engine: LedgerEngine,
  ledgerId: string,
  asOfDate?: string,
): Promise<DepreciationRunResult> => {
  const today = asOfDate ?? todayUtc();

  const rows = await db.all<DepreciationPeriodRow & {
    asset_name: string;
    accumulated_depreciation_account_id: string;
    depreciation_expense_account_id: string;
  }>(
    `SELECT ds.*, fa.name AS asset_name,
            fa.accumulated_depreciation_account_id,
            fa.depreciation_expense_account_id
     FROM depreciation_schedule ds
     JOIN fixed_assets fa ON ds.asset_id = fa.id
     WHERE ds.ledger_id = ?
       AND ds.period_date <= ?
       AND ds.posted_at IS NULL
       AND fa.status = 'active'
       AND fa.accumulated_depreciation_account_id IS NOT NULL
       AND fa.depreciation_expense_account_id IS NOT NULL
     ORDER BY ds.period_date`,
    [ledgerId, today],
  );

  let posted = 0;
  let totalAmount = 0;
  const assetsAffected = new Set<string>();
  const entries: { assetName: string; amount: number; period: string }[] = [];

  for (const row of rows) {
    const amount = Number(row.depreciation_amount);
    if (amount <= 0) continue;

    // Get account codes
    const accumAcct = await db.get<{ code: string }>(
      "SELECT code FROM accounts WHERE id = ?",
      [row.accumulated_depreciation_account_id],
    );
    const expenseAcct = await db.get<{ code: string }>(
      "SELECT code FROM accounts WHERE id = ?",
      [row.depreciation_expense_account_id],
    );

    if (!accumAcct || !expenseAcct) continue;

    // Post balanced journal entry: debit expense, credit accumulated depreciation
    const result = await engine.postTransaction({
      ledgerId,
      date: row.period_date,
      memo: `Depreciation: ${row.asset_name} (period ${row.period_number})`,
      lines: [
        { accountCode: expenseAcct.code, amount, direction: "debit" },
        { accountCode: accumAcct.code, amount, direction: "credit" },
      ],
      sourceType: "api",
      idempotencyKey: `depreciation-${row.id}`,
    });

    if (!result.ok) {
      console.error(`Depreciation posting failed for entry ${row.id}: ${result.error.message}`);
      continue;
    }

    const now = nowUtc();
    await db.run(
      "UPDATE depreciation_schedule SET transaction_id = ?, posted_at = ? WHERE id = ?",
      [result.value.id, now, row.id],
    );

    posted++;
    totalAmount += amount;
    assetsAffected.add(row.asset_id);
    entries.push({ assetName: row.asset_name, amount, period: row.period_date });

    // Check if asset is fully depreciated
    const remaining = await db.get<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM depreciation_schedule WHERE asset_id = ? AND posted_at IS NULL",
      [row.asset_id],
    );
    if (remaining && remaining.cnt === 0) {
      await db.run(
        "UPDATE fixed_assets SET status = 'fully_depreciated', updated_at = ? WHERE id = ?",
        [now, row.asset_id],
      );
    }
  }

  return { posted, totalAmount, assetsAffected: assetsAffected.size, entries };
};

// ---------------------------------------------------------------------------
// Asset summary
// ---------------------------------------------------------------------------

export const getAssetSummary = async (
  db: Database,
  ledgerId: string,
): Promise<AssetSummary> => {
  const today = todayUtc();
  const taxYearStartMonth = getTaxYearStartMonth(
    (await db.get<{ jurisdiction: string }>("SELECT jurisdiction FROM ledgers WHERE id = ?", [ledgerId]))?.jurisdiction ?? "AU",
  );
  const currentFY = getFinancialYearLabelForDate(new Date(), taxYearStartMonth);

  // Previous FY
  const prevDate = new Date();
  prevDate.setUTCFullYear(prevDate.getUTCFullYear() - 1);
  const previousFY = getFinancialYearLabelForDate(prevDate, taxYearStartMonth);

  const stats = await db.get<{
    total_assets: number;
    total_cost: number;
    total_salvage: number;
    active_count: number;
    disposed_count: number;
    fully_depreciated_count: number;
  }>(
    `SELECT
       COUNT(*) as total_assets,
       COALESCE(SUM(cost_amount), 0) as total_cost,
       COALESCE(SUM(salvage_value), 0) as total_salvage,
       COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) as active_count,
       COALESCE(SUM(CASE WHEN status = 'disposed' THEN 1 ELSE 0 END), 0) as disposed_count,
       COALESCE(SUM(CASE WHEN status = 'fully_depreciated' THEN 1 ELSE 0 END), 0) as fully_depreciated_count
     FROM fixed_assets WHERE ledger_id = ?`,
    [ledgerId],
  );

  const totalAccumulated = await db.get<{ total: number }>(
    `SELECT COALESCE(SUM(depreciation_amount), 0) as total
     FROM depreciation_schedule WHERE ledger_id = ? AND posted_at IS NOT NULL`,
    [ledgerId],
  );

  const depThisFy = await db.get<{ total: number }>(
    `SELECT COALESCE(SUM(depreciation_amount), 0) as total
     FROM depreciation_schedule WHERE ledger_id = ? AND financial_year = ? AND posted_at IS NOT NULL`,
    [ledgerId, currentFY],
  );

  const depLastFy = await db.get<{ total: number }>(
    `SELECT COALESCE(SUM(depreciation_amount), 0) as total
     FROM depreciation_schedule WHERE ledger_id = ? AND financial_year = ? AND posted_at IS NOT NULL`,
    [ledgerId, previousFY],
  );

  const pending = await db.get<{ cnt: number; total: number }>(
    `SELECT COUNT(*) as cnt, COALESCE(SUM(depreciation_amount), 0) as total
     FROM depreciation_schedule ds
     JOIN fixed_assets fa ON ds.asset_id = fa.id
     WHERE ds.ledger_id = ? AND ds.period_date <= ? AND ds.posted_at IS NULL AND fa.status = 'active'`,
    [ledgerId, today],
  );

  const nextDep = await db.get<{ period_date: string }>(
    `SELECT MIN(period_date) as period_date
     FROM depreciation_schedule ds
     JOIN fixed_assets fa ON ds.asset_id = fa.id
     WHERE ds.ledger_id = ? AND ds.posted_at IS NULL AND fa.status = 'active'`,
    [ledgerId],
  );

  const totalCost = Number(stats?.total_cost ?? 0);
  const totalAccum = Number(totalAccumulated?.total ?? 0);

  return {
    totalAssets: Number(stats?.total_assets ?? 0),
    totalCost,
    totalNbv: totalCost - totalAccum,
    totalAccumulated: totalAccum,
    pendingEntries: Number(pending?.cnt ?? 0),
    pendingAmount: Number(pending?.total ?? 0),
    nextDepreciationDate: nextDep?.period_date ?? null,
    currentFinancialYear: currentFY,
    depreciationThisFy: Number(depThisFy?.total ?? 0),
    depreciationLastFy: Number(depLastFy?.total ?? 0),
    assetsByStatus: {
      active: Number(stats?.active_count ?? 0),
      disposed: Number(stats?.disposed_count ?? 0),
      fullyDepreciated: Number(stats?.fully_depreciated_count ?? 0),
    },
  };
};

// ---------------------------------------------------------------------------
// Disposal
// ---------------------------------------------------------------------------

export const disposeFixedAsset = async (
  db: Database,
  engine: LedgerEngine,
  assetId: string,
  input: DisposeAssetInput,
): Promise<Result<DisposalResult>> => {
  const assetResult = await getFixedAsset(db, assetId);
  if (!assetResult.ok) return assetResult;
  const asset = assetResult.value;

  if (asset.status !== "active") {
    return {
      ok: false,
      error: { code: "INVALID_STATE", message: `Asset is ${asset.status}, cannot dispose` },
    };
  }

  // Calculate accumulated depreciation (sum of posted entries)
  const accumRow = await db.get<{ total: number }>(
    "SELECT COALESCE(SUM(depreciation_amount), 0) as total FROM depreciation_schedule WHERE asset_id = ? AND posted_at IS NOT NULL",
    [assetId],
  );
  const accumulatedDep = Number(accumRow?.total ?? 0);
  const nbv = asset.costAmount - accumulatedDep;
  const gainLoss = input.disposalProceeds - nbv;

  // Get account codes
  const assetAcct = await db.get<{ code: string; name: string }>(
    "SELECT code, name FROM accounts WHERE id = ?",
    [asset.assetAccountId],
  );
  const accumAcct = asset.accumulatedDepreciationAccountId
    ? await db.get<{ code: string; name: string }>("SELECT code, name FROM accounts WHERE id = ?", [asset.accumulatedDepreciationAccountId])
    : null;

  if (!assetAcct) {
    return { ok: false, error: { code: "NOT_FOUND", message: "Asset account not found" } };
  }

  // Build journal entry lines
  const lines: Array<{ accountCode: string; amount: number; direction: "debit" | "credit" }> = [];
  const journalEntries: Array<{ accountName: string; type: "debit" | "credit"; amount: number }> = [];

  // Remove accumulated depreciation (debit contra-asset)
  if (accumAcct && accumulatedDep > 0) {
    lines.push({ accountCode: accumAcct.code, amount: accumulatedDep, direction: "debit" });
    journalEntries.push({ accountName: accumAcct.name, type: "debit", amount: accumulatedDep });
  }

  // Record proceeds (debit cash/bank)
  if (input.disposalProceeds > 0 && input.proceedsAccountId) {
    const proceedsAcct = await db.get<{ code: string; name: string }>(
      "SELECT code, name FROM accounts WHERE id = ?",
      [input.proceedsAccountId],
    );
    if (proceedsAcct) {
      lines.push({ accountCode: proceedsAcct.code, amount: input.disposalProceeds, direction: "debit" });
      journalEntries.push({ accountName: proceedsAcct.name, type: "debit", amount: input.disposalProceeds });
    }
  }

  // Record gain or loss
  if (gainLoss > 0 && input.gainAccountId) {
    const gainAcct = await db.get<{ code: string; name: string }>(
      "SELECT code, name FROM accounts WHERE id = ?",
      [input.gainAccountId],
    );
    if (gainAcct) {
      lines.push({ accountCode: gainAcct.code, amount: gainLoss, direction: "credit" });
      journalEntries.push({ accountName: gainAcct.name, type: "credit", amount: gainLoss });
    }
  } else if (gainLoss < 0 && input.lossAccountId) {
    const lossAcct = await db.get<{ code: string; name: string }>(
      "SELECT code, name FROM accounts WHERE id = ?",
      [input.lossAccountId],
    );
    if (lossAcct) {
      lines.push({ accountCode: lossAcct.code, amount: Math.abs(gainLoss), direction: "debit" });
      journalEntries.push({ accountName: lossAcct.name, type: "debit", amount: Math.abs(gainLoss) });
    }
  }

  // Remove asset at cost (credit asset account)
  lines.push({ accountCode: assetAcct.code, amount: asset.costAmount, direction: "credit" });
  journalEntries.push({ accountName: assetAcct.name, type: "credit", amount: asset.costAmount });

  // Post the disposal transaction
  const txResult = await engine.postTransaction({
    ledgerId: asset.ledgerId,
    date: input.disposalDate,
    memo: `Disposal of ${asset.name}${input.notes ? ` — ${input.notes}` : ""}`,
    lines,
    sourceType: "api",
    idempotencyKey: `disposal-${assetId}`,
  });

  if (!txResult.ok) {
    return {
      ok: false,
      error: { code: "POSTING_FAILED", message: `Failed to post disposal: ${txResult.error.message}` },
    };
  }

  const now = nowUtc();

  // Update asset status
  await db.run(
    `UPDATE fixed_assets SET
       status = 'disposed', disposal_date = ?, disposal_proceeds = ?,
       disposal_transaction_id = ?, updated_at = ?
     WHERE id = ?`,
    [input.disposalDate, input.disposalProceeds, txResult.value.id, now, assetId],
  );

  // Cancel future unposted schedule entries
  await db.run(
    "DELETE FROM depreciation_schedule WHERE asset_id = ? AND posted_at IS NULL",
    [assetId],
  );

  // CGT note for AU
  let cgtNote: string | null = null;
  if (asset.jurisdiction === "AU" && gainLoss > 0) {
    const purchaseDate = new Date(asset.purchaseDate + "T00:00:00Z");
    const disposalDate = new Date(input.disposalDate + "T00:00:00Z");
    const monthsHeld = monthsDiff(purchaseDate, disposalDate);
    cgtNote = `CGT event A1 may apply. Asset held ${monthsHeld} months. ` +
      (monthsHeld >= 12
        ? "50% CGT discount may be available for individual taxpayers."
        : "Less than 12 months — no CGT discount available.");
  }

  return {
    ok: true,
    value: {
      assetName: asset.name,
      originalCost: asset.costAmount,
      accumulatedDepreciation: accumulatedDep,
      netBookValue: nbv,
      disposalProceeds: input.disposalProceeds,
      gainLoss,
      gainOrLoss: gainLoss > 0 ? "gain" : gainLoss < 0 ? "loss" : "nil",
      transactionId: txResult.value.id,
      cgtNote,
      journalEntries,
    },
  };
};

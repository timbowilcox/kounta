// ---------------------------------------------------------------------------
// Jurisdiction configuration — tax calendars, depreciation rules, thresholds.
//
// All monetary amounts are integers in the smallest currency unit (cents).
// ---------------------------------------------------------------------------

export type Jurisdiction = 'AU' | 'US' | 'UK' | 'NZ' | 'CA' | 'SG' | 'OTHER';

export interface JurisdictionConfig {
  /** Human-readable country/jurisdiction name. */
  readonly name: string;
  /** ISO 4217 currency code. */
  readonly currency: string;
  /** Currency display symbol. */
  readonly currencySymbol: string;
  /** Start of the standard tax year as 'MM-DD'. */
  readonly taxYearStart: string;
  /** End of the standard tax year as 'MM-DD'. */
  readonly taxYearEnd: string;
  /** Name of the tax authority (e.g. 'ATO', 'IRS'). */
  readonly taxAuthority: string;
  /** Local name for VAT/GST/sales tax (e.g. 'GST', 'VAT'). */
  readonly vatName: string;
  /** Standard VAT/GST rate as a percentage, or null if none. */
  readonly vatRate: number | null;
  /** Label for the tax identification number (e.g. 'ABN', 'EIN'). */
  readonly taxIdLabel: string;
  /** Regex pattern string for validating the tax ID, if applicable. */
  readonly taxIdFormat?: string;
  /** Available depreciation methods. */
  readonly depreciationMethods: readonly string[];
  /** Default depreciation method for new assets. */
  readonly defaultDepreciationMethod: string;
  /** Threshold in cents — amounts at or above this are capitalised. */
  readonly capitalisationThreshold: number;
  /** Effective useful lives in years by asset category. */
  readonly effectiveLives: Readonly<Record<string, number>>;

  // Jurisdiction-specific optional fields
  /** Instant asset write-off threshold in cents (AU, NZ). */
  readonly instantWriteOffThreshold?: number;
  /** Small business turnover threshold in cents for write-off eligibility (AU). */
  readonly smallBusinessTurnoverThreshold?: number;
  /** Bonus depreciation percentage (US). */
  readonly bonusDepreciationRate?: number;
  /** Annual Investment Allowance limit in cents (UK). */
  readonly annualInvestmentAllowance?: number;
  /** Capital Cost Allowance classes (CA). */
  readonly ccaClasses?: Readonly<Record<string, number>>;
  /** Section 19A write-off threshold in cents (SG). */
  readonly section19AThreshold?: number;
}

export const JURISDICTION_CONFIGS: Readonly<Record<Jurisdiction, JurisdictionConfig>> = {
  AU: {
    name: 'Australia',
    currency: 'AUD',
    currencySymbol: '$',
    taxYearStart: '07-01',
    taxYearEnd: '06-30',
    taxAuthority: 'ATO',
    vatName: 'GST',
    vatRate: 10,
    taxIdLabel: 'ABN',
    taxIdFormat: '^\\d{11}$',
    depreciationMethods: ['diminishing-value', 'prime-cost', 'instant-write-off', 'simplified'],
    defaultDepreciationMethod: 'diminishing-value',
    capitalisationThreshold: 30000,
    effectiveLives: {
      'computer-hardware': 4,
      'office-furniture': 10,
      'motor-vehicle': 8,
      'building': 40,
      'plant-and-equipment': 15,
      'software': 5,
    },
    instantWriteOffThreshold: 2_000_000,
    smallBusinessTurnoverThreshold: 1_000_000_000,
  },

  US: {
    name: 'United States',
    currency: 'USD',
    currencySymbol: '$',
    taxYearStart: '01-01',
    taxYearEnd: '12-31',
    taxAuthority: 'IRS',
    vatName: 'Sales Tax',
    vatRate: null,
    taxIdLabel: 'EIN',
    taxIdFormat: '^\\d{2}-\\d{7}$',
    depreciationMethods: ['straight-line', 'double-declining', 'MACRS', 'Section 179', 'bonus'],
    defaultDepreciationMethod: 'MACRS',
    capitalisationThreshold: 250000,
    effectiveLives: {
      'computer-hardware': 5,
      'office-furniture': 7,
      'motor-vehicle': 5,
      'building': 39,
      'plant-and-equipment': 7,
      'software': 3,
    },
    bonusDepreciationRate: 80,
  },

  UK: {
    name: 'United Kingdom',
    currency: 'GBP',
    currencySymbol: '£',
    taxYearStart: '04-06',
    taxYearEnd: '04-05',
    taxAuthority: 'HMRC',
    vatName: 'VAT',
    vatRate: 20,
    taxIdLabel: 'UTR',
    taxIdFormat: '^\\d{10}$',
    depreciationMethods: ['straight-line', 'reducing-balance', 'AIA'],
    defaultDepreciationMethod: 'reducing-balance',
    capitalisationThreshold: 100000,
    effectiveLives: {
      'computer-hardware': 3,
      'office-furniture': 5,
      'motor-vehicle': 4,
      'building': 50,
      'plant-and-equipment': 8,
      'software': 3,
    },
    annualInvestmentAllowance: 100_000_000,
  },

  NZ: {
    name: 'New Zealand',
    currency: 'NZD',
    currencySymbol: '$',
    taxYearStart: '04-01',
    taxYearEnd: '03-31',
    taxAuthority: 'IRD',
    vatName: 'GST',
    vatRate: 15,
    taxIdLabel: 'IRD Number',
    taxIdFormat: '^\\d{8,9}$',
    depreciationMethods: ['diminishing-value', 'straight-line', 'low-value-asset'],
    defaultDepreciationMethod: 'diminishing-value',
    capitalisationThreshold: 100000,
    effectiveLives: {
      'computer-hardware': 4,
      'office-furniture': 10,
      'motor-vehicle': 5,
      'building': 50,
      'plant-and-equipment': 15,
      'software': 4,
    },
    instantWriteOffThreshold: 100000,
  },

  CA: {
    name: 'Canada',
    currency: 'CAD',
    currencySymbol: '$',
    taxYearStart: '01-01',
    taxYearEnd: '12-31',
    taxAuthority: 'CRA',
    vatName: 'GST/HST',
    vatRate: 5,
    taxIdLabel: 'BN',
    taxIdFormat: '^\\d{9}$',
    depreciationMethods: ['declining-balance', 'straight-line', 'CCA'],
    defaultDepreciationMethod: 'CCA',
    capitalisationThreshold: 50000,
    effectiveLives: {
      'computer-hardware': 3,
      'office-furniture': 10,
      'motor-vehicle': 5,
      'building': 25,
      'plant-and-equipment': 10,
      'software': 3,
    },
    ccaClasses: {
      'computer-hardware': 50,
      'office-furniture': 20,
      'motor-vehicle': 30,
      'building': 4,
      'software': 100,
    },
  },

  SG: {
    name: 'Singapore',
    currency: 'SGD',
    currencySymbol: '$',
    taxYearStart: '01-01',
    taxYearEnd: '12-31',
    taxAuthority: 'IRAS',
    vatName: 'GST',
    vatRate: 9,
    taxIdLabel: 'UEN',
    taxIdFormat: '^[\\dA-Z]{9,10}$',
    depreciationMethods: ['straight-line', 'Section 19A'],
    defaultDepreciationMethod: 'straight-line',
    capitalisationThreshold: 500000,
    effectiveLives: {
      'computer-hardware': 3,
      'office-furniture': 6,
      'motor-vehicle': 6,
      'building': 50,
      'plant-and-equipment': 12,
      'software': 3,
    },
    section19AThreshold: 500000,
  },

  OTHER: {
    name: 'Other',
    currency: 'USD',
    currencySymbol: '$',
    taxYearStart: '01-01',
    taxYearEnd: '12-31',
    taxAuthority: 'N/A',
    vatName: 'Tax',
    vatRate: null,
    taxIdLabel: 'Tax ID',
    depreciationMethods: ['straight-line', 'declining-balance'],
    defaultDepreciationMethod: 'straight-line',
    capitalisationThreshold: 100000,
    effectiveLives: {
      'computer-hardware': 4,
      'office-furniture': 7,
      'motor-vehicle': 5,
      'building': 40,
      'plant-and-equipment': 10,
      'software': 3,
    },
  },
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Retrieve the jurisdiction configuration for a given jurisdiction code.
 * Falls back to OTHER if the code is unrecognised.
 */
export const getJurisdictionConfig = (jurisdiction: string): JurisdictionConfig => {
  const key = jurisdiction.toUpperCase() as Jurisdiction;
  return JURISDICTION_CONFIGS[key] ?? JURISDICTION_CONFIGS.OTHER;
};

/**
 * Return a human-readable financial year label for the given date and jurisdiction.
 * For jurisdictions where the tax year crosses calendar years (e.g. AU 2025-07-01 to
 * 2026-06-30), returns 'FY2025-26'. For calendar-year jurisdictions, returns 'FY2025'.
 */
export const getFinancialYearLabel = (date: Date, jurisdiction: string): string => {
  const config = getJurisdictionConfig(jurisdiction);
  const parts = config.taxYearStart.split('-').map(Number);
  const startMonth = parts[0] ?? 1;
  const startDay = parts[1] ?? 1;

  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  const isBeforeStart = month < startMonth || (month === startMonth && day < startDay);

  if (startMonth === 1 && startDay === 1) {
    // Calendar-year jurisdiction — the financial year equals the calendar year.
    return `FY${year}`;
  }

  // Cross-year jurisdiction
  const fyStartYear = isBeforeStart ? year - 1 : year;
  const fyEndYear = fyStartYear + 1;
  const shortEnd = String(fyEndYear).slice(2);
  return `FY${fyStartYear}-${shortEnd}`;
};

/**
 * Determine whether an amount should be capitalised (treated as a fixed asset)
 * based on the jurisdiction's capitalisation threshold.
 * Returns true when the amount is >= the threshold.
 */
export const shouldCapitalise = (amount: number, jurisdiction: string): boolean => {
  const config = getJurisdictionConfig(jurisdiction);
  return amount >= config.capitalisationThreshold;
};

/**
 * Get the instant write-off threshold for a jurisdiction in a given financial year.
 * Returns null if the jurisdiction does not offer an instant write-off scheme.
 *
 * @param jurisdiction  - jurisdiction code (e.g. 'AU')
 * @param financialYearStart - the calendar year in which the financial year starts
 */
export const getInstantWriteOffThreshold = (
  jurisdiction: string,
  financialYearStart: number,
): number | null => {
  const config = getJurisdictionConfig(jurisdiction);

  // AU: Instant Asset Write-Off — threshold has changed over time
  if (jurisdiction.toUpperCase() === 'AU') {
    if (financialYearStart >= 2023) {
      return 2_000_000;
    }
    if (financialYearStart >= 2020) {
      return 15_000_000;
    }
    return 3_000_000;
  }

  // NZ: Low-value asset write-off
  if (jurisdiction.toUpperCase() === 'NZ') {
    return config.instantWriteOffThreshold ?? null;
  }

  // UK: Annual Investment Allowance
  if (jurisdiction.toUpperCase() === 'UK') {
    return config.annualInvestmentAllowance ?? null;
  }

  // SG: Section 19A
  if (jurisdiction.toUpperCase() === 'SG') {
    return config.section19AThreshold ?? null;
  }

  return null;
};

/**
 * Check whether an asset purchase is eligible for an instant write-off.
 *
 * @param amount        - purchase cost in cents
 * @param jurisdiction  - jurisdiction code
 * @param turnover      - annual turnover in cents (used for AU small-business test)
 * @param purchaseYear  - calendar year of the purchase
 * @returns eligibility result with threshold and reason
 */
export const isEligibleForInstantWriteOff = (
  amount: number,
  jurisdiction: string,
  turnover: number,
  purchaseYear: number,
): { eligible: boolean; threshold: number | null; reason: string } => {
  const config = getJurisdictionConfig(jurisdiction);
  const threshold = getInstantWriteOffThreshold(jurisdiction, purchaseYear);

  if (threshold === null) {
    return {
      eligible: false,
      threshold: null,
      reason: `${config.name} does not offer an instant write-off scheme.`,
    };
  }

  // AU requires the business to be under the aggregated turnover threshold
  if (jurisdiction.toUpperCase() === 'AU') {
    const turnoverLimit = config.smallBusinessTurnoverThreshold ?? 0;
    if (turnover > turnoverLimit) {
      return {
        eligible: false,
        threshold,
        reason: `Annual turnover exceeds the aggregated turnover threshold of ${turnoverLimit} cents for the Australian instant asset write-off.`,
      };
    }
  }

  if (amount > threshold) {
    return {
      eligible: false,
      threshold,
      reason: `Amount of ${amount} cents exceeds the instant write-off threshold of ${threshold} cents in ${config.name}.`,
    };
  }

  return {
    eligible: true,
    threshold,
    reason: `Eligible for instant write-off under ${config.taxAuthority} rules in ${config.name}.`,
  };
};

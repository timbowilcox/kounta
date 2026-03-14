// ---------------------------------------------------------------------------
// Currency utilities — decimal handling, conversion, formatting.
//
// All financial amounts in Kounta are integers in the smallest currency unit.
// Different currencies have different decimal places (USD=2, JPY=0, BHD=3).
// This module centralises the conversion logic so parsers and the engine
// never hardcode `* 100`.
// ---------------------------------------------------------------------------

/** Rate precision: exchange rates are stored as integers × this factor. */
export const RATE_PRECISION = 1_000_000;

/**
 * ISO 4217 decimal places for common currencies.
 * Currencies not listed default to 2 decimal places.
 */
export const CURRENCY_DECIMAL_PLACES: Record<string, number> = {
  // 0 decimal places
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0,
  KRW: 0, PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0,
  XOF: 0, XPF: 0,

  // 2 decimal places (most currencies — default)
  USD: 2, EUR: 2, GBP: 2, AUD: 2, CAD: 2, CHF: 2, CNY: 2,
  HKD: 2, INR: 2, MXN: 2, NZD: 2, SGD: 2, ZAR: 2, SEK: 2,
  NOK: 2, DKK: 2, PLN: 2, CZK: 2, THB: 2, MYR: 2, PHP: 2,
  IDR: 2, BRL: 2, ARS: 2, TWD: 2, TRY: 2, RUB: 2, AED: 2,
  SAR: 2, ILS: 2, EGP: 2, NGN: 2, KES: 2, GHS: 2,

  // 3 decimal places
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

/**
 * Get the number of decimal places for a currency code.
 * Defaults to 2 if the currency is not in the lookup table.
 */
export function getDecimalPlaces(currencyCode: string): number {
  return CURRENCY_DECIMAL_PLACES[currencyCode.toUpperCase()] ?? 2;
}

/**
 * Convert a decimal value to the smallest currency unit (integer).
 * Example: toSmallestUnit(12.50, "USD") → 1250
 * Example: toSmallestUnit(1000, "JPY")  → 1000
 * Example: toSmallestUnit(1.234, "BHD") → 1234
 */
export function toSmallestUnit(value: number, currencyCode: string): number {
  const decimals = getDecimalPlaces(currencyCode);
  return Math.round(value * Math.pow(10, decimals));
}

/**
 * Convert a smallest-unit integer back to a decimal value.
 * Example: fromSmallestUnit(1250, "USD") → 12.50
 * Example: fromSmallestUnit(1000, "JPY") → 1000
 */
export function fromSmallestUnit(amount: number, currencyCode: string): number {
  const decimals = getDecimalPlaces(currencyCode);
  return amount / Math.pow(10, decimals);
}

/**
 * Convert an amount from one currency to another using an exchange rate.
 * Rate is stored as an integer with RATE_PRECISION (1,000,000) precision.
 * Example: convertAmount(1000, 1_085_000) → 1085 (USD cents → EUR cents at 1.085)
 */
export function convertAmount(originalAmount: number, rate: number): number {
  return Math.round(originalAmount * rate / RATE_PRECISION);
}

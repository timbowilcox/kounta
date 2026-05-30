// ---------------------------------------------------------------------------
// The single Plaid -> internal normalisation boundary.
//
// Both acquisition channels converge here on ProviderBankTransaction:
//   * the mock provider (now) and the live Plaid client (later) call
//     normalizePlaidTransaction;
//   * the manual CSV importer produces the same ProviderBankTransaction via its
//     own mapping, then shares the fingerprint helpers below for cross-channel
//     dedup.
//
// Nothing downstream of this file knows whether a transaction came from Plaid,
// Basiq, or a CSV upload.
// ---------------------------------------------------------------------------

import { toSmallestUnit } from "../currency-utils.js";
import type { ProviderBankTransaction } from "./types.js";
import type { PlaidTransaction } from "./plaid-types.js";

/**
 * Map a raw Plaid transaction to Kounta's internal ProviderBankTransaction.
 *
 * Sign convention: Plaid amount is POSITIVE for money out (debit) and NEGATIVE
 * for money in (credit). We store a positive magnitude in the smallest currency
 * unit plus an explicit credit/debit type.
 */
export function normalizePlaidTransaction(
  txn: PlaidTransaction,
): ProviderBankTransaction {
  const currency = txn.iso_currency_code ?? txn.unofficial_currency_code ?? "USD";
  const isOutflow = txn.amount > 0; // Plaid: positive = money leaving the account
  const magnitude = toSmallestUnit(Math.abs(txn.amount), currency);

  const category = txn.personal_finance_category
    ? txn.personal_finance_category.detailed ?? txn.personal_finance_category.primary
    : null;

  return {
    providerTransactionId: txn.transaction_id,
    date: txn.date,
    amount: magnitude,
    type: isOutflow ? "debit" : "credit",
    description: txn.name,
    reference: null,
    category: category ?? null,
    balance: null,
    rawData: { ...txn },
  };
}

// ---------------------------------------------------------------------------
// Cross-channel dedup primitives — shared by every acquisition channel so the
// same real-world transaction produces the same fingerprint regardless of
// source.
// ---------------------------------------------------------------------------

/**
 * Normalise a transaction description for fingerprinting: lowercase, collapse
 * any run of non-alphanumeric characters to a single space, trim. Stable enough
 * that the same bank-statement line from Plaid and from a CSV export collide.
 */
export function normalizeDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The engine's line fingerprint for cross-channel dedup:
 * date + signed-amount + normalised description. Signed so a debit and a credit
 * of equal magnitude never collide. The "account" dimension is applied by the
 * caller via the ledger-account scope of the dedup query, not baked in here —
 * so re-mapping a bank account does not silently change existing fingerprints.
 */
export function lineFingerprint(
  date: string,
  amount: number,
  type: "credit" | "debit",
  description: string,
): string {
  const signedAmount = type === "debit" ? -amount : amount;
  return `${date}|${signedAmount}|${normalizeDescription(description)}`;
}

/** Compute the fingerprint for a normalised provider transaction. */
export function fingerprintOf(txn: ProviderBankTransaction): string {
  return lineFingerprint(txn.date, txn.amount, txn.type, txn.description);
}

/**
 * The "loose" key — date + signed-amount, WITHOUT the description. Two rows
 * sharing a loose key but differing on description are candidate cross-source
 * duplicates (e.g. Plaid's cleaned merchant name vs a bank CSV's raw line):
 * reliable enough to flag for confirmation, not to auto-merge.
 */
export function looseKey(date: string, amount: number, type: "credit" | "debit"): string {
  const signedAmount = type === "debit" ? -amount : amount;
  return `${date}|${signedAmount}`;
}

/** Derive the loose key (date|signedAmount) from a full line fingerprint. */
export function looseKeyFromFingerprint(fingerprint: string): string {
  const first = fingerprint.indexOf("|");
  const second = fingerprint.indexOf("|", first + 1);
  return second === -1 ? fingerprint : fingerprint.slice(0, second);
}

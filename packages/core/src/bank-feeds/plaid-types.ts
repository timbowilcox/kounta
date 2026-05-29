// ---------------------------------------------------------------------------
// Plaid wire shapes — the exact JSON a real Plaid /transactions/sync response
// returns. The mock provider emits these; the live Plaid client will receive
// these. Both pass through normalizePlaidTransaction (the single normalisation
// boundary) to produce Kounta's internal ProviderBankTransaction.
//
// Reference: https://plaid.com/docs/api/products/transactions/#transactionssync
// ---------------------------------------------------------------------------

/** Plaid's ML-derived category taxonomy (PFC). */
export interface PlaidPersonalFinanceCategory {
  readonly primary: string;
  readonly detailed: string;
  readonly confidence_level?: string;
}

/**
 * A Plaid transaction. Amount sign convention (important): Plaid uses POSITIVE
 * for money moving OUT of the account (debits/purchases) and NEGATIVE for money
 * moving IN (credits/deposits). Amounts are in major currency units (dollars),
 * not cents.
 */
export interface PlaidTransaction {
  readonly transaction_id: string;
  readonly account_id: string;
  readonly amount: number;
  readonly iso_currency_code: string | null;
  readonly unofficial_currency_code?: string | null;
  readonly date: string; // YYYY-MM-DD
  readonly name: string;
  readonly merchant_name: string | null;
  readonly pending: boolean;
  readonly personal_finance_category: PlaidPersonalFinanceCategory | null;
}

/** A removed transaction reference (Plaid only returns the id). */
export interface PlaidRemovedTransaction {
  readonly transaction_id: string;
}

/** The shape of a Plaid /transactions/sync response page. */
export interface PlaidSyncResponse {
  readonly added: readonly PlaidTransaction[];
  readonly modified: readonly PlaidTransaction[];
  readonly removed: readonly PlaidRemovedTransaction[];
  readonly next_cursor: string;
  readonly has_more: boolean;
}

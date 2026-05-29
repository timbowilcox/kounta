// ---------------------------------------------------------------------------
// Mock Plaid fixtures.
//
// These transactions are shaped exactly like real Plaid /transactions/sync
// payloads. Each carries a GROUND-TRUTH category label so the dataset doubles
// as the seed for the categorisation accuracy harness (see
// tests/plaid-accuracy.test.ts).
//
// The fixtures are scripted into cursor-addressed pages that exercise the full
// sync model: pagination (has_more), a pending -> posted transition (txn A),
// and a removed transaction (txn B).
// ---------------------------------------------------------------------------

import type { PlaidSyncResponse, PlaidTransaction } from "./plaid-types.js";

/** A Plaid transaction paired with the Kounta category a human would assign. */
export interface LabeledPlaidTransaction {
  readonly plaid: PlaidTransaction;
  readonly groundTruthCategory: string;
}

export const MOCK_ACCOUNT_ID = "mock_acct_checking_001";

// --- Individual transactions ----------------------------------------------

const txnA_pending: PlaidTransaction = {
  transaction_id: "mock_txn_A",
  account_id: MOCK_ACCOUNT_ID,
  amount: -2500.0, // money IN (credit) — Stripe payout
  iso_currency_code: "AUD",
  date: "2026-04-02",
  name: "STRIPE PAYOUT PENDING",
  merchant_name: "Stripe",
  pending: true,
  personal_finance_category: { primary: "INCOME", detailed: "INCOME_OTHER_INCOME" },
};

const txnA_posted: PlaidTransaction = {
  ...txnA_pending,
  name: "STRIPE PAYOUT",
  pending: false,
};

const txnB: PlaidTransaction = {
  transaction_id: "mock_txn_B",
  account_id: MOCK_ACCOUNT_ID,
  amount: 412.55, // money OUT (debit)
  iso_currency_code: "AUD",
  date: "2026-04-03",
  name: "AWS EMEA PENDING AUTH",
  merchant_name: "Amazon Web Services",
  pending: true,
  personal_finance_category: {
    primary: "GENERAL_SERVICES",
    detailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
  },
};

const txnC: PlaidTransaction = {
  transaction_id: "mock_txn_C",
  account_id: MOCK_ACCOUNT_ID,
  amount: 49.0,
  iso_currency_code: "AUD",
  date: "2026-04-09",
  name: "GITHUB.COM",
  merchant_name: "GitHub",
  pending: false,
  personal_finance_category: {
    primary: "GENERAL_SERVICES",
    detailed: "GENERAL_SERVICES_COMPUTER_SOFTWARE",
  },
};

const txnD: PlaidTransaction = {
  transaction_id: "mock_txn_D",
  account_id: MOCK_ACCOUNT_ID,
  amount: 89.95,
  iso_currency_code: "AUD",
  date: "2026-04-04",
  name: "OFFICEWORKS 0123",
  merchant_name: "Officeworks",
  pending: false,
  personal_finance_category: {
    primary: "GENERAL_MERCHANDISE",
    detailed: "GENERAL_MERCHANDISE_OFFICE_SUPPLIES",
  },
};

const txnE: PlaidTransaction = {
  transaction_id: "mock_txn_E",
  account_id: MOCK_ACCOUNT_ID,
  amount: 34.2,
  iso_currency_code: "AUD",
  date: "2026-04-05",
  name: "UBER EATS",
  merchant_name: "Uber Eats",
  pending: false,
  personal_finance_category: {
    primary: "FOOD_AND_DRINK",
    detailed: "FOOD_AND_DRINK_FAST_FOOD",
  },
};

const txnF: PlaidTransaction = {
  transaction_id: "mock_txn_F",
  account_id: MOCK_ACCOUNT_ID,
  amount: 615.0,
  iso_currency_code: "AUD",
  date: "2026-04-06",
  name: "QANTAS AIRWAYS",
  merchant_name: "Qantas",
  pending: false,
  personal_finance_category: { primary: "TRAVEL", detailed: "TRAVEL_FLIGHTS" },
};

const txnG: PlaidTransaction = {
  transaction_id: "mock_txn_G",
  account_id: MOCK_ACCOUNT_ID,
  amount: -1800.0, // money IN (credit) — client deposit
  iso_currency_code: "AUD",
  date: "2026-04-07",
  name: "DEPOSIT ACME PTY LTD",
  merchant_name: null,
  pending: false,
  personal_finance_category: { primary: "INCOME", detailed: "INCOME_OTHER_INCOME" },
};

/**
 * The canonical labelled dataset (posted versions). Used by the normalisation
 * test and the accuracy harness. Order is stable.
 */
export const labeledFixtures: readonly LabeledPlaidTransaction[] = [
  { plaid: txnA_posted, groundTruthCategory: "Sales Revenue" },
  { plaid: txnC, groundTruthCategory: "Software & Hosting" },
  { plaid: txnD, groundTruthCategory: "Office Supplies" },
  { plaid: txnE, groundTruthCategory: "Meals & Entertainment" },
  { plaid: txnF, groundTruthCategory: "Travel" },
  { plaid: txnG, groundTruthCategory: "Sales Revenue" },
];

// --- Cursor-addressed sync pages ------------------------------------------
//
//  ""        page 1a: A(pending), B, D, E        has_more=true   -> cursor-1
//  cursor-1  page 1b: F, G                        has_more=false  -> cursor-2
//  cursor-2  page 2 : +C, A->posted, -B           has_more=false  -> cursor-3
//  cursor-3  page 3 : empty (steady state)        has_more=false  -> cursor-3
//
// So one initial sync (from null) paginates 1a+1b; a later sync (from cursor-2)
// applies the modified/removed deltas; a further sync is a no-op (idempotent).

const PAGES: Record<string, PlaidSyncResponse> = {
  "": {
    added: [txnA_pending, txnB, txnD, txnE],
    modified: [],
    removed: [],
    next_cursor: "cursor-1",
    has_more: true,
  },
  "cursor-1": {
    added: [txnF, txnG],
    modified: [],
    removed: [],
    next_cursor: "cursor-2",
    has_more: false,
  },
  "cursor-2": {
    added: [txnC],
    modified: [txnA_posted],
    removed: [{ transaction_id: txnB.transaction_id }],
    next_cursor: "cursor-3",
    has_more: false,
  },
  "cursor-3": {
    added: [],
    modified: [],
    removed: [],
    next_cursor: "cursor-3",
    has_more: false,
  },
};

/** Return the scripted sync page for an incoming cursor (null === first page). */
export function getSyncPage(cursor: string | null): PlaidSyncResponse {
  const key = cursor ?? "";
  return PAGES[key] ?? PAGES["cursor-3"]!; // unknown cursor => steady state
}

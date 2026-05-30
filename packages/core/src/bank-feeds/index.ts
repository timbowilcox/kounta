// ---------------------------------------------------------------------------
// Bank feeds module — export barrel
// ---------------------------------------------------------------------------

export * from "./types.js";
export * from "./plaid-types.js";
export { BasiqProvider, verifyBasiqWebhookSignature } from "./basiq.js";
export { PlaidProvider } from "./plaid.js";
export { MockPlaidProvider } from "./mock.js";
export type { MockProviderConfig } from "./mock.js";
export { createBankFeedProvider } from "./factory.js";
export { bankTransactionToParseRow, providerTransactionToParseRow } from "./adapter.js";
export {
  normalizePlaidTransaction,
  normalizeDescription,
  lineFingerprint,
  fingerprintOf,
  looseKey,
  looseKeyFromFingerprint,
} from "./normalize.js";
export {
  labeledFixtures,
  getSyncPage,
  MOCK_ACCOUNT_ID,
} from "./fixtures.js";
export type { LabeledPlaidTransaction } from "./fixtures.js";

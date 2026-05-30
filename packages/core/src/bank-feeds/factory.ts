// ---------------------------------------------------------------------------
// Provider factory — creates bank feed providers from config.
// ---------------------------------------------------------------------------

import type { BankFeedProvider, ProviderConfig, ProviderName } from "./types.js";
import { BasiqProvider } from "./basiq.js";
import { PlaidProvider } from "./plaid.js";
import { MockPlaidProvider } from "./mock.js";

export function createBankFeedProvider(
  name: ProviderName,
  config: ProviderConfig,
): BankFeedProvider {
  switch (name) {
    case "basiq": {
      if (!config.basiq) {
        throw new Error("Basiq configuration is required. Set BASIQ_API_KEY environment variable.");
      }
      return new BasiqProvider(config.basiq);
    }
    case "plaid": {
      if (!config.plaid) {
        throw new Error("Plaid configuration is required.");
      }
      return new PlaidProvider();
    }
    case "mock": {
      // Fail-closed: the constructor throws if NODE_ENV=production.
      return new MockPlaidProvider(config.mock);
    }
    default:
      throw new Error(`Unknown bank feed provider: ${name}`);
  }
}

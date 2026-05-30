// ---------------------------------------------------------------------------
// Plaid bank feed provider — US/UK/EU banking via Plaid Link.
// This is a compile-time stub. Full implementation planned for Phase 3.
// All methods throw NOT_IMPLEMENTED to prevent accidental usage.
// ---------------------------------------------------------------------------

import type {
  BankFeedProvider,
  CreateConnectionSessionParams,
  CreateConnectionSessionResult,
  FetchTransactionsParams,
  ProviderBankAccount,
  ProviderBankTransaction,
  ProviderConnection,
  WebhookResult,
  WebhookVerificationInput,
} from "./types.js";

const NOT_IMPLEMENTED = "Plaid provider is not yet implemented. Use Basiq for AU/NZ bank feeds.";

export class PlaidProvider implements BankFeedProvider {
  readonly name = "plaid" as const;

  async createConnectionSession(
    _params: CreateConnectionSessionParams,
  ): Promise<CreateConnectionSessionResult> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async listConnections(_userId: string): Promise<readonly ProviderConnection[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async listAccounts(_connectionId: string): Promise<readonly ProviderBankAccount[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async fetchTransactions(
    _params: FetchTransactionsParams,
  ): Promise<readonly ProviderBankTransaction[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async disconnect(_connectionId: string): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async handleWebhook(_input: WebhookVerificationInput): Promise<WebhookResult> {
    throw new Error(NOT_IMPLEMENTED);
  }
}

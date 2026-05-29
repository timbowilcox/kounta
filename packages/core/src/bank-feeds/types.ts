// ---------------------------------------------------------------------------
// Bank Feed types — provider interface, connections, accounts, transactions.
// ---------------------------------------------------------------------------

export type BankConnectionStatus = "active" | "stale" | "disconnected" | "error";
export type BankSyncStatus = "running" | "completed" | "failed";
export type BankTransactionType = "credit" | "debit";
export type BankTransactionStatus = "pending" | "matched" | "posted" | "ignored";

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

export interface BankConnection {
  readonly id: string;
  readonly ledgerId: string;
  readonly provider: string;
  readonly providerConnectionId: string;
  readonly institutionId: string;
  readonly institutionName: string;
  readonly status: BankConnectionStatus;
  readonly consentExpiresAt: string | null;
  readonly lastSyncAt: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BankAccount {
  readonly id: string;
  readonly connectionId: string;
  readonly ledgerId: string;
  readonly providerAccountId: string;
  readonly name: string;
  readonly accountNumber: string;
  readonly bsb: string | null;
  readonly type: string;
  readonly currency: string;
  readonly currentBalance: number;
  readonly availableBalance: number | null;
  readonly mappedAccountId: string | null;
  readonly lastSyncAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BankTransaction {
  readonly id: string;
  readonly bankAccountId: string;
  readonly ledgerId: string;
  readonly providerTransactionId: string;
  readonly date: string;
  readonly amount: number;
  readonly type: BankTransactionType;
  readonly description: string;
  readonly reference: string | null;
  readonly category: string | null;
  readonly balance: number | null;
  readonly status: BankTransactionStatus;
  readonly matchedTransactionId: string | null;
  readonly matchConfidence: number | null;
  readonly isPersonal: boolean;
  readonly suggestedAccountId: string | null;
  readonly rawData: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BankSyncLog {
  readonly id: string;
  readonly connectionId: string;
  readonly bankAccountId: string | null;
  readonly status: BankSyncStatus;
  readonly transactionsFetched: number;
  readonly transactionsNew: number;
  readonly transactionsMatched: number;
  readonly errorMessage: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Provider interface — implemented by Basiq, Plaid, etc.
// ---------------------------------------------------------------------------

export interface CreateConnectionSessionParams {
  readonly userId: string;
  readonly institutionId?: string;
  readonly redirectUrl: string;
}

export interface CreateConnectionSessionResult {
  readonly sessionUrl: string;
  readonly connectionId: string;
}

export interface FetchTransactionsParams {
  readonly connectionId: string;
  readonly accountId: string;
  readonly fromDate: string;
  readonly toDate: string;
}

export interface WebhookResult {
  readonly event: string;
  readonly connectionId: string | null;
  readonly shouldSync: boolean;
}

// Cursor-based sync (Plaid /transactions/sync model). Optional on the provider
// interface — providers that only support a date-range pull (e.g. Basiq) omit it.
export interface SyncTransactionsParams {
  readonly connectionId: string;
  readonly accountId: string;
}

export interface ProviderSyncResult {
  // Already normalised to the internal representation via the provider's
  // own normalisation boundary (e.g. normalizePlaidTransaction).
  readonly added: readonly ProviderBankTransaction[];
  readonly modified: readonly ProviderBankTransaction[];
  // Provider transaction ids that no longer exist (e.g. a pending txn dropped).
  readonly removed: readonly string[];
  readonly nextCursor: string;
  readonly hasMore: boolean;
}

export interface ProviderBankAccount {
  readonly providerAccountId: string;
  readonly name: string;
  readonly accountNumber: string;
  readonly bsb: string | null;
  readonly type: string;
  readonly currency: string;
  readonly currentBalance: number;
  readonly availableBalance: number | null;
}

export interface ProviderBankTransaction {
  readonly providerTransactionId: string;
  readonly date: string;
  readonly amount: number;
  readonly type: BankTransactionType;
  readonly description: string;
  readonly reference: string | null;
  readonly category: string | null;
  readonly balance: number | null;
  readonly rawData: Record<string, unknown>;
}

export interface ProviderConnection {
  readonly providerConnectionId: string;
  readonly institutionId: string;
  readonly institutionName: string;
  readonly status: BankConnectionStatus;
  readonly consentExpiresAt: string | null;
  readonly accounts: readonly ProviderBankAccount[];
}

export interface BankFeedProvider {
  readonly name: string;

  createConnectionSession(
    params: CreateConnectionSessionParams,
  ): Promise<CreateConnectionSessionResult>;

  listConnections(userId: string): Promise<readonly ProviderConnection[]>;

  listAccounts(connectionId: string): Promise<readonly ProviderBankAccount[]>;

  fetchTransactions(
    params: FetchTransactionsParams,
  ): Promise<readonly ProviderBankTransaction[]>;

  disconnect(connectionId: string): Promise<void>;

  handleWebhook(
    payload: unknown,
    signature: string,
  ): Promise<WebhookResult>;

  /**
   * Cursor-based incremental sync (Plaid /transactions/sync model). Optional:
   * when present, the engine prefers it over fetchTransactions and resumes from
   * the persisted cursor. Returns added/modified/removed already normalised to
   * the internal representation, plus the next cursor.
   */
  syncTransactions?(
    params: SyncTransactionsParams,
    cursor: string | null,
  ): Promise<ProviderSyncResult>;
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export type ProviderName = "basiq" | "plaid" | "mock";

export interface ProviderConfig {
  readonly basiq?: {
    readonly apiKey: string;
    readonly environment?: "sandbox" | "production";
  };
  readonly plaid?: {
    readonly clientId: string;
    readonly secret: string;
    readonly environment?: "sandbox" | "development" | "production";
  };
  readonly mock?: {
    // Optional override of process.env.NODE_ENV for testing the production guard.
    readonly nodeEnv?: string;
  };
}

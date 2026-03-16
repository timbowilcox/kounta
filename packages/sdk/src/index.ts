// ---------------------------------------------------------------------------
// @kounta/sdk — Typed client for the Kounta REST API.
//
// All types are re-exported from @kounta/core so consumers get full type
// coverage without a separate import. Response envelopes ({ data: T }) are
// unwrapped automatically — callers receive the inner payload directly.
// ---------------------------------------------------------------------------

// --- Re-exports from @kounta/core so consumers only need @kounta/sdk ---------

export type {
  // Entity types
  Ledger,
  Account,
  AccountWithBalance,
  Transaction,
  TransactionWithLines,
  LineItem,
  Reversal,
  AuditEntry,
  ImportBatch,
  ImportRow,
  Template,
  TemplateAccount,
  ApiKey,
  User,

  // Input types
  PostTransactionInput,
  PostLineInput,
  ReverseTransactionInput,

  // Statement types
  StatementResponse,
  StatementSection,
  StatementLine,
  StatementPeriod,

  // Enum types
  AccountType,
  NormalBalance,
  Direction,
  TransactionStatus,
  SourceType,
  AccountingBasis,
  LedgerStatus,
  AccountStatus,
  ApiKeyStatus,
  ImportBatchStatus,
  MatchStatus,
  AuditAction,
  ActorType,
  StatementType,

  // Pagination
  PaginatedResult,
  PaginationParams,

  // Errors
  KountaError,
  ErrorDetail,

  // Bank feeds
  BankConnection,
  BankAccount,
  BankTransaction,
  BankSyncLog,
  BankConnectionStatus,
  BankTransactionStatus,
  BankTransactionType,
  BankSyncStatus,

  // Intelligence / Notifications
  Notification,
  NotificationPreference,
  NotificationType,
  NotificationSeverity,
  NotificationStatus,

  // Multi-currency
  CurrencySetting,
  ExchangeRate,
  ExchangeRateSource,
  ConvertAmountResult,
  RevaluationResult,

  // AI Conversations
  Conversation,
  ConversationMessage,
  ToolCallRecord,

  // Classification
  ClassificationRule,
  ClassificationResult,
  MerchantAlias,
  RuleType,
  RuleField,
  ClassificationLayer,
  CreateClassificationRuleInput,
  UpdateClassificationRuleInput,
  ListClassificationRulesOptions,

  // Recurring entries
  RecurringEntry,
  RecurringEntryLog,
  RecurringLineItem,
  Frequency,
  CreateRecurringEntryInput,
  UpdateRecurringEntryInput,

  // Stripe Connect
  StripeConnection,
  StripeConnectionStatus,

  // Revenue Recognition
  RevenueSchedule,
  RevenueScheduleEntry,
  RevenueScheduleWithEntries,
  CreateScheduleInput,
  UpdateScheduleInput,
  RevenueMetrics,
  MrrHistoryEntry,
  ProcessingResult,
  RevenueSourceType,
  RevenueScheduleStatus,
  RevenueEntryStatus,
  RevenueFrequency,

  // Fixed Assets
  FixedAsset,
  FixedAssetWithSchedule,
  DepreciationPeriod,
  CreateFixedAssetInput,
  DisposeAssetInput,
  CapitalisationAdvice,
  AssetSummary,
  DepreciationRunResult,
  DisposalResult,
  DepreciationMethod,
  AssetStatus,
  CapitalAllowancePool,

} from "@kounta/core";

export type {
  // Schema-derived input types
  CreateLedgerInput,
  CreateAccountInput,
  CreateImportInput,
  ConfirmMatchesInput,
} from "@kounta/core";

export { ErrorCode } from "@kounta/core";

export type { ConfirmAction } from "@kounta/core";

export type { ClosedPeriod } from "@kounta/core";

// --- Internal type imports -------------------------------------------------

import type {
  ClosedPeriod,
  Ledger,
  Account,
  AccountWithBalance,
  TransactionWithLines,
  AuditEntry,
  ImportBatch,
  ImportRow,
  Template,
  User,
  StatementResponse,
  PaginatedResult,
  BankConnection,
  BankAccount,
  BankTransaction,
  BankSyncLog,
  Notification,
  NotificationPreference,
  NotificationType,
  NotificationStatus,
  CurrencySetting,
  ExchangeRate,
  ConvertAmountResult,
  RevaluationResult,
  Conversation,
  ConversationMessage,
  ClassificationRule,
  ClassificationResult,
  MerchantAlias,
  RuleType,
  RuleField,
  RecurringEntry,
  RecurringEntryLog,
  Frequency,
  RecurringLineItem,
  RevenueSchedule,
  RevenueScheduleWithEntries,
  RevenueMetrics,
  MrrHistoryEntry,
  ProcessingResult,
  FixedAsset,
  FixedAssetWithSchedule,
  DepreciationPeriod,
  CreateFixedAssetInput,
  DisposeAssetInput,
  CapitalisationAdvice,
  AssetSummary,
  DepreciationRunResult,
  DisposalResult,
} from "@kounta/core";

import type {
  CreateLedgerInput,
  CreateAccountInput,
} from "@kounta/core";

import type { ConfirmAction } from "@kounta/core";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface KountaConfig {
  /** API key (starts with `ldg_`). Required. */
  readonly apiKey: string;

  /**
   * Admin secret for privileged operations (ledger creation, API key
   * management, template application). Optional — only needed if the SDK
   * is used for admin tasks.
   */
  readonly adminSecret?: string;

  /** Base URL of the Kounta API. Defaults to `https://api.kounta.ai`. */
  readonly baseUrl?: string;

  /** Custom fetch implementation (useful for testing or edge runtimes). */
  readonly fetch?: typeof globalThis.fetch;
}

/** Options for paginated list endpoints. */
export interface ListOptions {
  readonly cursor?: string;
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/** Structured error thrown for non-2xx API responses. */
export class KountaApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: readonly unknown[];
  readonly requestId?: string;

  constructor(
    status: number,
    body?: { code?: string; message?: string; details?: unknown[]; requestId?: string } | null,
  ) {
    super(body?.message ?? `API error (${status})`);
    this.name = "KountaApiError";
    this.status = status;
    this.code = body?.code ?? "UNKNOWN";
    this.details = body?.details;
    this.requestId = body?.requestId;
  }
}

// ---------------------------------------------------------------------------
// Query-string helper
// ---------------------------------------------------------------------------

const buildQuery = (params: Record<string, string | number | boolean | undefined>): string => {
  const qs = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined) qs.set(key, String(val));
  }
  const str = qs.toString();
  return str ? `?${str}` : "";
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class Kounta {
  /** @internal */ readonly _apiKey: string;
  /** @internal */ readonly _adminSecret: string | undefined;
  /** @internal */ readonly _baseUrl: string;
  /** @internal */ readonly _fetch: typeof globalThis.fetch;

  readonly ledgers: LedgersModule;
  readonly accounts: AccountsModule;
  readonly transactions: TransactionsModule;
  readonly reports: ReportsModule;
  readonly audit: AuditModule;
  readonly imports: ImportsModule;
  readonly templates: TemplatesModule;
  readonly apiKeys: ApiKeysModule;
  readonly admin: AdminModule;
  readonly bankFeeds: BankFeedsModule;
  readonly notifications: NotificationsModule;
  readonly currencies: CurrenciesModule;
  readonly conversations: ConversationsModule;
  readonly classification: ClassificationModule;
  readonly recurring: RecurringModule;
  readonly periods: PeriodsModule;
  readonly stripeConnect: StripeConnectModule;
  readonly revenue: RevenueModule;
  readonly fixedAssets: FixedAssetsModule;

  constructor(config: KountaConfig) {
    this._apiKey = config.apiKey;
    this._adminSecret = config.adminSecret;
    this._baseUrl = (config.baseUrl ?? "https://api.kounta.ai").replace(/\/+$/, "");
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis);

    this.ledgers = new LedgersModule(this);
    this.accounts = new AccountsModule(this);
    this.transactions = new TransactionsModule(this);
    this.reports = new ReportsModule(this);
    this.audit = new AuditModule(this);
    this.imports = new ImportsModule(this);
    this.templates = new TemplatesModule(this);
    this.apiKeys = new ApiKeysModule(this);
    this.admin = new AdminModule(this);
    this.bankFeeds = new BankFeedsModule(this);
    this.notifications = new NotificationsModule(this);
    this.currencies = new CurrenciesModule(this);
    this.conversations = new ConversationsModule(this);
    this.classification = new ClassificationModule(this);
    this.recurring = new RecurringModule(this);
    this.periods = new PeriodsModule(this);
    this.stripeConnect = new StripeConnectModule(this);
    this.revenue = new RevenueModule(this);
    this.fixedAssets = new FixedAssetsModule(this);
  }

  // -------------------------------------------------------------------------
  // Internal HTTP transport
  // -------------------------------------------------------------------------

  /**
   * @internal Issue a request and unwrap the `{ data: T }` envelope.
   * For paginated endpoints use {@link requestPaginated} instead.
   */
  async request<T>(
    method: string,
    path: string,
    opts?: { body?: unknown; auth?: "apiKey" | "admin"; headers?: Record<string, string> },
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.authHeader(opts?.auth ?? "apiKey"),
      ...opts?.headers,
    };

    const res = await this._fetch(`${this._baseUrl}${path}`, {
      method,
      headers,
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({
        error: { code: "UNKNOWN", message: res.statusText },
      }))) as { error: { code: string; message: string; details?: unknown[]; requestId?: string } };
      throw new KountaApiError(res.status, errBody.error);
    }

    // 204 No Content
    if (res.status === 204) return undefined as T;

    const json = (await res.json()) as { data: T };
    return json.data;
  }

  /**
   * @internal Issue a paginated GET and return `{ data, nextCursor }`.
   */
  async requestPaginated<T>(path: string, opts?: { auth?: "apiKey" | "admin" }): Promise<PaginatedResult<T>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.authHeader(opts?.auth ?? "apiKey"),
    };

    const res = await this._fetch(`${this._baseUrl}${path}`, {
      method: "GET",
      headers,
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({
        error: { code: "UNKNOWN", message: res.statusText },
      }))) as { error: { code: string; message: string; details?: unknown[]; requestId?: string } };
      throw new KountaApiError(res.status, errBody.error);
    }

    return (await res.json()) as PaginatedResult<T>;
  }

  /** @internal Produce the Authorization header for the given auth mode. */
  private authHeader(mode: "apiKey" | "admin"): Record<string, string> {
    if (mode === "admin") {
      const secret = this._adminSecret;
      if (!secret) throw new Error("adminSecret is required for this operation");
      return { Authorization: `Bearer ${secret}` };
    }
    return { Authorization: `Bearer ${this._apiKey}` };
  }
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

// --- Ledgers ---------------------------------------------------------------

class LedgersModule {
  constructor(private readonly c: Kounta) {}

  /** Create a new ledger. Requires admin auth. */
  async create(input: CreateLedgerInput & { ownerId: string }): Promise<Ledger> {
    return this.c.request("POST", "/v1/ledgers", { body: input, auth: "admin" });
  }

  /** Retrieve a ledger by ID. */
  async get(ledgerId: string): Promise<Ledger> {
    return this.c.request("GET", `/v1/ledgers/${ledgerId}`);
  }

  /** Update ledger settings. */
  async update(ledgerId: string, input: { name?: string; fiscalYearStart?: number }): Promise<Ledger> {
    return this.c.request("PATCH", `/v1/ledgers/${ledgerId}`, { body: input });
  }
}

// --- Periods ---------------------------------------------------------------

class PeriodsModule {
  constructor(private readonly c: Kounta) {}

  /** Close a period through the given date. */
  async close(ledgerId: string, periodEnd: string): Promise<{ periodEnd: string; closedAt: string }> {
    return this.c.request("POST", `/v1/ledgers/${ledgerId}/periods/close`, { body: { periodEnd } });
  }

  /** Reopen a previously closed period. */
  async reopen(ledgerId: string, periodEnd: string): Promise<{ periodEnd: string; reopenedAt: string }> {
    return this.c.request("POST", `/v1/ledgers/${ledgerId}/periods/reopen`, { body: { periodEnd } });
  }

  /** List closed periods. */
  async list(ledgerId: string): Promise<ClosedPeriod[]> {
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/periods/closed`);
  }
}

// --- Accounts --------------------------------------------------------------

class AccountsModule {
  constructor(private readonly c: Kounta) {}

  /** Create an account in a ledger. */
  async create(
    ledgerId: string,
    input: Omit<CreateAccountInput, "ledgerId">,
  ): Promise<Account> {
    return this.c.request("POST", `/v1/ledgers/${ledgerId}/accounts`, { body: input });
  }

  /** List all accounts in a ledger (with balances). */
  async list(ledgerId: string): Promise<AccountWithBalance[]> {
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/accounts`);
  }

  /** Retrieve a single account by ID (with balance). */
  async get(ledgerId: string, accountId: string): Promise<AccountWithBalance> {
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/accounts/${accountId}`);
  }
}

// --- Transactions ----------------------------------------------------------

/** Input for posting a transaction via the SDK. `ledgerId` is passed separately. */
export interface PostTransactionParams {
  readonly date: string;
  readonly memo: string;
  readonly lines: readonly {
    readonly accountCode: string;
    readonly amount: number;
    readonly direction: "debit" | "credit";
    readonly memo?: string;
    readonly metadata?: Record<string, unknown>;
  }[];
  readonly effectiveDate?: string;
  readonly idempotencyKey?: string;
  readonly sourceType?: "api" | "mcp" | "import" | "manual";
  readonly sourceRef?: string;
  readonly agentId?: string;
  readonly metadata?: Record<string, unknown>;
}

class TransactionsModule {
  constructor(private readonly c: Kounta) {}

  /** Post a balanced transaction to a ledger. */
  async post(ledgerId: string, input: PostTransactionParams): Promise<TransactionWithLines> {
    return this.c.request("POST", `/v1/ledgers/${ledgerId}/transactions`, {
      body: input,
    });
  }

  /** List transactions in a ledger (paginated). */
  async list(
    ledgerId: string,
    opts?: ListOptions,
  ): Promise<PaginatedResult<TransactionWithLines>> {
    const qs = buildQuery({ cursor: opts?.cursor, limit: opts?.limit });
    return this.c.requestPaginated(`/v1/ledgers/${ledgerId}/transactions${qs}`);
  }

  /** Retrieve a single transaction by ID. */
  async get(ledgerId: string, transactionId: string): Promise<TransactionWithLines> {
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/transactions/${transactionId}`);
  }

  /** Reverse a posted transaction. Creates an offsetting entry. */
  async reverse(
    ledgerId: string,
    transactionId: string,
    reason: string,
  ): Promise<TransactionWithLines> {
    return this.c.request(
      "POST",
      `/v1/ledgers/${ledgerId}/transactions/${transactionId}/reverse`,
      { body: { reason } },
    );
  }
}

// --- Reports ---------------------------------------------------------------

class ReportsModule {
  constructor(private readonly c: Kounta) {}

  /** Generate an income statement (P&L) for a date range. */
  async incomeStatement(
    ledgerId: string,
    startDate: string,
    endDate: string,
  ): Promise<StatementResponse> {
    const qs = buildQuery({ startDate, endDate });
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/reports/income-statement${qs}`);
  }

  /** Generate a balance sheet as of a given date. */
  async balanceSheet(ledgerId: string, asOfDate: string): Promise<StatementResponse> {
    const qs = buildQuery({ asOfDate });
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/reports/balance-sheet${qs}`);
  }

  /** Generate a cash-flow statement for a date range. */
  async cashFlow(
    ledgerId: string,
    startDate: string,
    endDate: string,
  ): Promise<StatementResponse> {
    const qs = buildQuery({ startDate, endDate });
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/reports/cash-flow${qs}`);
  }
}

// --- Audit -----------------------------------------------------------------

class AuditModule {
  constructor(private readonly c: Kounta) {}

  /** List audit entries for a ledger (paginated). */
  async list(
    ledgerId: string,
    opts?: ListOptions,
  ): Promise<PaginatedResult<AuditEntry>> {
    const qs = buildQuery({ cursor: opts?.cursor, limit: opts?.limit });
    return this.c.requestPaginated(`/v1/ledgers/${ledgerId}/audit${qs}`);
  }
}

// --- Imports ---------------------------------------------------------------

/** Result of uploading an import file. */
export interface ImportResult {
  readonly batch: ImportBatch;
  readonly rows: readonly ImportRow[];
}

class ImportsModule {
  constructor(private readonly c: Kounta) {}

  /** Upload a CSV or OFX bank statement for parsing and matching. */
  async upload(
    ledgerId: string,
    input: { fileContent: string; fileType: "csv" | "ofx"; filename?: string },
  ): Promise<ImportResult> {
    return this.c.request("POST", `/v1/ledgers/${ledgerId}/imports`, { body: input });
  }

  /** List import batches for a ledger (paginated). */
  async list(
    ledgerId: string,
    opts?: ListOptions,
  ): Promise<PaginatedResult<ImportBatch>> {
    const qs = buildQuery({ cursor: opts?.cursor, limit: opts?.limit });
    return this.c.requestPaginated(`/v1/ledgers/${ledgerId}/imports${qs}`);
  }

  /** Retrieve an import batch with all its rows. */
  async get(batchId: string): Promise<ImportResult> {
    return this.c.request("GET", `/v1/imports/${batchId}`);
  }

  /** Confirm, reject, or override row matches in an import batch. */
  async confirmMatches(
    batchId: string,
    actions: readonly ConfirmAction[],
  ): Promise<ImportResult> {
    return this.c.request("POST", `/v1/imports/${batchId}/confirm`, {
      body: { actions },
    });
  }
}

// --- Templates -------------------------------------------------------------

/** Template recommendation with score and reasoning. */
export interface TemplateRecommendation {
  readonly template: Template;
  readonly score: number;
  readonly reason: string;
}

class TemplatesModule {
  constructor(private readonly c: Kounta) {}

  /** List all available chart-of-accounts templates. No auth required. */
  async list(): Promise<Template[]> {
    return this.c.request("GET", "/v1/templates");
  }

  /** Get a template by ID or slug. No auth required. */
  async get(idOrSlug: string): Promise<Template> {
    return this.c.request("GET", `/v1/templates/${idOrSlug}`);
  }

  /** Get template recommendations based on business context. No auth required. */
  async recommend(context: {
    industry?: string;
    description?: string;
    businessModel?: string;
  }): Promise<TemplateRecommendation[]> {
    return this.c.request("POST", "/v1/templates/recommend", { body: context });
  }

  /** Apply a template's chart of accounts to a ledger. Requires admin auth. */
  async apply(
    ledgerId: string,
    templateSlug: string,
  ): Promise<{ accounts: Account[]; count: number }> {
    return this.c.request("POST", "/v1/templates/apply", {
      body: { ledgerId, templateSlug },
      auth: "admin",
    });
  }
}

// --- API Keys --------------------------------------------------------------

/** API key with the raw key visible (only returned on creation). */
export interface ApiKeyWithRaw {
  readonly id: string;
  readonly userId: string;
  readonly ledgerId: string;
  readonly prefix: string;
  readonly name: string;
  readonly rawKey: string;
  readonly status: "active" | "revoked";
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** API key as returned from list/revoke (hash and raw key hidden). */
export interface ApiKeySafe {
  readonly id: string;
  readonly userId: string;
  readonly ledgerId: string;
  readonly prefix: string;
  readonly name: string;
  readonly status: "active" | "revoked";
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}


// --- Admin -----------------------------------------------------------------

/** Result of provisioning a user with a ledger and API key. */
export interface ProvisionResult {
  readonly user: User;
  readonly ledger: Ledger;
  readonly apiKey: {
    readonly id: string;
    readonly userId: string;
    readonly ledgerId: string;
    readonly prefix: string;
    readonly name: string;
    readonly rawKey: string;
    readonly status: string;
    readonly createdAt: string;
  };
  readonly needsTemplate: boolean;
  readonly isNew: boolean;
}

class AdminModule {
  constructor(private readonly c: Kounta) {}

  /** Provision a user with a ledger and API key. Requires admin auth. */
  async provision(input: {
    email: string;
    name: string;
    authProvider: string;
    authProviderId: string;
    templateSlug?: string;
  }): Promise<ProvisionResult> {
    return this.c.request("POST", "/v1/admin/provision", {
      body: input,
      auth: "admin",
    });
  }
}
class ApiKeysModule {
  constructor(private readonly c: Kounta) {}

  /** Create a new API key for a user and ledger. Requires admin auth. */
  async create(input: {
    userId: string;
    ledgerId: string;
    name: string;
  }): Promise<ApiKeyWithRaw> {
    return this.c.request("POST", "/v1/api-keys", { body: input, auth: "admin" });
  }

  /** List API keys for a ledger. Requires admin auth. */
  async list(ledgerId: string): Promise<ApiKeySafe[]> {
    const qs = buildQuery({ ledgerId });
    return this.c.request("GET", `/v1/api-keys${qs}`, { auth: "admin" });
  }

  /** Revoke an API key. Requires admin auth. */
  async revoke(keyId: string): Promise<ApiKeySafe> {
    return this.c.request("DELETE", `/v1/api-keys/${keyId}`, { auth: "admin" });
  }
}

// --- Bank Feeds ------------------------------------------------------------

class BankFeedsModule {
  constructor(private readonly c: Kounta) {}

  /** List bank feed connections for a ledger. */
  async listConnections(ledgerId: string): Promise<BankConnection[]> {
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/bank-feeds/connections`);
  }

  /** Get a specific bank feed connection. */
  async getConnection(ledgerId: string, connectionId: string): Promise<BankConnection> {
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/bank-feeds/connections/${connectionId}`);
  }

  /** List bank accounts for a connection. */
  async listAccounts(ledgerId: string, connectionId: string): Promise<BankAccount[]> {
    return this.c.request(
      "GET",
      `/v1/ledgers/${ledgerId}/bank-feeds/connections/${connectionId}/accounts`,
    );
  }

  /** Map a bank account to a ledger account. */
  async mapAccount(
    ledgerId: string,
    bankAccountId: string,
    accountId: string,
  ): Promise<BankAccount> {
    return this.c.request(
      "POST",
      `/v1/ledgers/${ledgerId}/bank-feeds/accounts/${bankAccountId}/map`,
      { body: { accountId } },
    );
  }

  /** Trigger a sync for a bank account. */
  async sync(
    ledgerId: string,
    bankAccountId: string,
    opts?: { fromDate?: string; toDate?: string },
  ): Promise<BankSyncLog> {
    return this.c.request(
      "POST",
      `/v1/ledgers/${ledgerId}/bank-feeds/accounts/${bankAccountId}/sync`,
      { body: opts ?? {} },
    );
  }

  /** Get sync history for a connection. */
  async listSyncLogs(ledgerId: string, connectionId: string): Promise<BankSyncLog[]> {
    const qs = buildQuery({ connectionId });
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/bank-feeds/sync-log${qs}`);
  }

  /** List bank transactions for a bank account. */
  async listTransactions(
    ledgerId: string,
    bankAccountId: string,
    opts?: { status?: string; limit?: number },
  ): Promise<BankTransaction[]> {
    const qs = buildQuery({ bankAccountId, status: opts?.status, limit: opts?.limit });
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/bank-feeds/transactions${qs}`);
  }

  /** Confirm or ignore a bank transaction match. */
  async confirmMatch(
    ledgerId: string,
    bankTransactionId: string,
    action: "confirm" | "ignore",
    overrideTransactionId?: string,
  ): Promise<BankTransaction> {
    return this.c.request(
      "POST",
      `/v1/ledgers/${ledgerId}/bank-feeds/transactions/${bankTransactionId}/confirm`,
      { body: { action, overrideTransactionId } },
    );
  }
}

// ---------------------------------------------------------------------------
// Notifications Module
// ---------------------------------------------------------------------------

class NotificationsModule {
  constructor(private readonly c: Kounta) {}

  /** List notifications for the authenticated user. */
  async list(
    ledgerId: string,
    opts?: { status?: NotificationStatus; type?: NotificationType; limit?: number; cursor?: string },
  ): Promise<PaginatedResult<Notification>> {
    const qs = buildQuery({
      status: opts?.status,
      type: opts?.type,
      limit: opts?.limit,
      cursor: opts?.cursor,
    });
    return this.c.requestPaginated<Notification>(`/v1/ledgers/${ledgerId}/notifications${qs}`);
  }

  /** Get a specific notification. */
  async get(ledgerId: string, notificationId: string): Promise<Notification> {
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/notifications/${notificationId}`);
  }

  /** Update notification status (read, dismissed, actioned). */
  async updateStatus(
    ledgerId: string,
    notificationId: string,
    status: NotificationStatus,
  ): Promise<Notification> {
    return this.c.request("PATCH", `/v1/ledgers/${ledgerId}/notifications/${notificationId}`, {
      body: { status },
    });
  }

  /** Trigger insight generation (monthly summary, cash position, anomalies, unclassified). */
  async generateInsights(
    ledgerId: string,
  ): Promise<{ generated: number; notifications: Notification[] }> {
    return this.c.request("POST", `/v1/ledgers/${ledgerId}/notifications/generate`);
  }

  /** Get notification preferences for the authenticated user. */
  async getPreferences(ledgerId: string): Promise<NotificationPreference[]> {
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/notifications/preferences`);
  }

  /** Set a notification preference (enable/disable a type). */
  async setPreference(
    ledgerId: string,
    type: NotificationType,
    enabled: boolean,
  ): Promise<NotificationPreference> {
    return this.c.request("PUT", `/v1/ledgers/${ledgerId}/notifications/preferences/${type}`, {
      body: { enabled },
    });
  }
}

// ---------------------------------------------------------------------------
// Currencies Module
// ---------------------------------------------------------------------------

class CurrenciesModule {
  constructor(private readonly c: Kounta) {}

  /** List enabled currencies for a ledger. */
  async list(ledgerId: string): Promise<CurrencySetting[]> {
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/currencies`);
  }

  /** Enable a currency on a ledger. */
  async enable(
    ledgerId: string,
    input: { currencyCode: string; decimalPlaces?: number; symbol?: string },
  ): Promise<CurrencySetting> {
    return this.c.request("POST", `/v1/ledgers/${ledgerId}/currencies`, { body: input });
  }

  /** List exchange rates for a ledger. */
  async listRates(
    ledgerId: string,
    opts?: { fromCurrency?: string; toCurrency?: string; limit?: number; cursor?: string },
  ): Promise<PaginatedResult<ExchangeRate>> {
    const qs = buildQuery({
      fromCurrency: opts?.fromCurrency,
      toCurrency: opts?.toCurrency,
      limit: opts?.limit,
      cursor: opts?.cursor,
    });
    return this.c.requestPaginated<ExchangeRate>(`/v1/ledgers/${ledgerId}/currencies/exchange-rates${qs}`);
  }

  /** Set an exchange rate between two currencies. */
  async setRate(
    ledgerId: string,
    input: {
      fromCurrency: string;
      toCurrency: string;
      rate: number;
      effectiveDate: string;
      source?: "manual" | "api" | "import";
    },
  ): Promise<ExchangeRate> {
    return this.c.request("POST", `/v1/ledgers/${ledgerId}/currencies/exchange-rates`, { body: input });
  }

  /** Convert an amount between currencies using stored exchange rates. */
  async convert(
    ledgerId: string,
    input: { fromCurrency: string; toCurrency: string; amount: number; date?: string },
  ): Promise<ConvertAmountResult> {
    const qs = buildQuery({
      fromCurrency: input.fromCurrency,
      toCurrency: input.toCurrency,
      amount: input.amount,
      date: input.date,
    });
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/currencies/exchange-rates/convert${qs}`);
  }

  /** Revalue foreign-currency accounts at current exchange rates. */
  async revalue(
    ledgerId: string,
    date: string,
  ): Promise<RevaluationResult[]> {
    return this.c.request("POST", `/v1/ledgers/${ledgerId}/currencies/revalue`, { body: { date } });
  }
}

// ---------------------------------------------------------------------------
// Conversations Module
// ---------------------------------------------------------------------------

class ConversationsModule {
  constructor(private readonly c: Kounta) {}

  /** List conversations for the authenticated user in a ledger. */
  async list(
    ledgerId: string,
    opts?: ListOptions,
  ): Promise<PaginatedResult<Conversation>> {
    const qs = buildQuery({ cursor: opts?.cursor, limit: opts?.limit });
    return this.c.requestPaginated<Conversation>(`/v1/ledgers/${ledgerId}/conversations${qs}`);
  }

  /** Create a new conversation. */
  async create(ledgerId: string, title?: string): Promise<Conversation> {
    return this.c.request("POST", `/v1/ledgers/${ledgerId}/conversations`, {
      body: title ? { title } : {},
    });
  }

  /** Get a conversation by ID. */
  async get(ledgerId: string, conversationId: string): Promise<Conversation> {
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/conversations/${conversationId}`);
  }

  /** Update conversation messages. */
  async update(
    ledgerId: string,
    conversationId: string,
    messages: readonly ConversationMessage[],
    title?: string,
  ): Promise<Conversation> {
    return this.c.request("PUT", `/v1/ledgers/${ledgerId}/conversations/${conversationId}`, {
      body: { messages, title },
    });
  }

  /** Delete a conversation. */
  async delete(ledgerId: string, conversationId: string): Promise<void> {
    return this.c.request("DELETE", `/v1/ledgers/${ledgerId}/conversations/${conversationId}`);
  }
}

// ---------------------------------------------------------------------------
// Classification Module
// ---------------------------------------------------------------------------

class ClassificationModule {
  constructor(private readonly c: Kounta) {}

  /** List classification rules for a ledger. */
  async listRules(
    ledgerId: string,
    opts?: { ruleType?: RuleType; field?: RuleField; autoGenerated?: boolean; limit?: number; offset?: number },
  ): Promise<ClassificationRule[]> {
    const qs = buildQuery({
      ruleType: opts?.ruleType,
      field: opts?.field,
      autoGenerated: opts?.autoGenerated,
      limit: opts?.limit,
      offset: opts?.offset,
    });
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/classification/rules${qs}`);
  }

  /** Create a classification rule. */
  async createRule(
    ledgerId: string,
    input: {
      ruleType: RuleType;
      field: RuleField;
      pattern: string;
      targetAccountId: string;
      priority?: number;
      isPersonal?: boolean;
      confidence?: number;
    },
  ): Promise<ClassificationRule> {
    return this.c.request("POST", `/v1/ledgers/${ledgerId}/classification/rules`, {
      body: input,
    });
  }

  /** Get a classification rule by ID. */
  async getRule(ledgerId: string, ruleId: string): Promise<ClassificationRule> {
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/classification/rules/${ruleId}`);
  }

  /** Update a classification rule. */
  async updateRule(
    ledgerId: string,
    ruleId: string,
    input: {
      priority?: number;
      pattern?: string;
      targetAccountId?: string;
      isPersonal?: boolean;
      confidence?: number;
    },
  ): Promise<ClassificationRule> {
    return this.c.request("PUT", `/v1/ledgers/${ledgerId}/classification/rules/${ruleId}`, {
      body: input,
    });
  }

  /** Delete a classification rule. */
  async deleteRule(ledgerId: string, ruleId: string): Promise<void> {
    return this.c.request("DELETE", `/v1/ledgers/${ledgerId}/classification/rules/${ruleId}`);
  }

  /** Preview how a transaction description would be classified. */
  async classify(
    ledgerId: string,
    input: { description: string; category?: string; amount?: number },
  ): Promise<ClassificationResult | null> {
    return this.c.request("POST", `/v1/ledgers/${ledgerId}/classification/classify`, {
      body: input,
    });
  }

  /** Manually classify a bank transaction to a ledger account. */
  async classifyBankTransaction(
    ledgerId: string,
    bankTransactionId: string,
    accountId: string,
    isPersonal?: boolean,
  ): Promise<BankTransaction> {
    return this.c.request(
      "POST",
      `/v1/ledgers/${ledgerId}/classification/bank-transactions/${bankTransactionId}`,
      { body: { accountId, isPersonal: isPersonal ?? false } },
    );
  }

  /** List merchant aliases. */
  async listAliases(ledgerId: string): Promise<MerchantAlias[]> {
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/classification/aliases`);
  }

  /** Add a merchant alias. */
  async addAlias(
    ledgerId: string,
    canonicalName: string,
    alias: string,
  ): Promise<MerchantAlias> {
    return this.c.request("POST", `/v1/ledgers/${ledgerId}/classification/aliases`, {
      body: { canonicalName, alias },
    });
  }
}

// ---------------------------------------------------------------------------
// Recurring Module
// ---------------------------------------------------------------------------

class RecurringModule {
  constructor(private readonly c: Kounta) {}

  /** List all recurring entries for a ledger. */
  async list(ledgerId: string): Promise<RecurringEntry[]> {
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/recurring`);
  }

  /** Create a new recurring entry. */
  async create(
    ledgerId: string,
    input: {
      description: string;
      lineItems: readonly RecurringLineItem[];
      frequency: Frequency;
      dayOfMonth?: number | null;
      nextRunDate: string;
      autoReverse?: boolean;
    },
  ): Promise<RecurringEntry> {
    return this.c.request("POST", `/v1/ledgers/${ledgerId}/recurring`, { body: input });
  }

  /** Get a recurring entry by ID (includes recent logs). */
  async get(ledgerId: string, id: string): Promise<RecurringEntry & { recentLogs: RecurringEntryLog[] }> {
    return this.c.request("GET", `/v1/ledgers/${ledgerId}/recurring/${id}`);
  }

  /** Update a recurring entry. */
  async update(
    ledgerId: string,
    id: string,
    input: {
      description?: string;
      lineItems?: readonly RecurringLineItem[];
      frequency?: Frequency;
      dayOfMonth?: number | null;
      nextRunDate?: string;
      autoReverse?: boolean;
    },
  ): Promise<RecurringEntry> {
    return this.c.request("PUT", `/v1/ledgers/${ledgerId}/recurring/${id}`, { body: input });
  }

  /** Delete a recurring entry. */
  async delete(ledgerId: string, id: string): Promise<void> {
    return this.c.request("DELETE", `/v1/ledgers/${ledgerId}/recurring/${id}`);
  }

  /** Pause a recurring entry. */
  async pause(ledgerId: string, id: string): Promise<RecurringEntry> {
    return this.c.request("POST", `/v1/ledgers/${ledgerId}/recurring/${id}/pause`);
  }

  /** Resume a recurring entry. */
  async resume(ledgerId: string, id: string): Promise<RecurringEntry> {
    return this.c.request("POST", `/v1/ledgers/${ledgerId}/recurring/${id}/resume`);
  }
}

// ---------------------------------------------------------------------------
// Stripe Connect Module
// ---------------------------------------------------------------------------

/** Stripe connection status returned from the API (tokens hidden). */
export interface StripeConnectStatus {
  readonly id: string;
  readonly stripeAccountId: string;
  readonly status: string;
  readonly lastSyncedAt: string | null;
  readonly createdAt: string;
}

class StripeConnectModule {
  constructor(private readonly c: Kounta) {}

  /** Get the Stripe OAuth URL. The caller should redirect the user's browser to this URL. */
  async authorize(): Promise<{ url: string }> {
    return this.c.request("GET", "/v1/stripe-connect/authorize");
  }

  /** Get Stripe connection status. Returns null if not connected. */
  async status(): Promise<StripeConnectStatus | null> {
    return this.c.request("GET", "/v1/stripe-connect/status");
  }

  /** Disconnect the Stripe account. */
  async disconnect(): Promise<{ disconnected: boolean }> {
    return this.c.request("POST", "/v1/stripe-connect/disconnect");
  }

  /** Trigger a manual sync of Stripe data (last 90 days). */
  async sync(): Promise<{ syncing: boolean; message: string }> {
    return this.c.request("POST", "/v1/stripe-connect/sync");
  }
}

// ---------------------------------------------------------------------------
// Revenue Module
// ---------------------------------------------------------------------------

class RevenueModule {
  constructor(private readonly c: Kounta) {}

  /** List revenue recognition schedules. */
  async listSchedules(
    opts?: {
      status?: string;
      customerName?: string;
      stripeSubscriptionId?: string;
      cursor?: string;
      limit?: number;
    },
  ): Promise<PaginatedResult<RevenueSchedule>> {
    const qs = buildQuery({
      status: opts?.status,
      customerName: opts?.customerName,
      stripeSubscriptionId: opts?.stripeSubscriptionId,
      cursor: opts?.cursor,
      limit: opts?.limit,
    });
    return this.c.requestPaginated<RevenueSchedule>(`/v1/revenue/schedules${qs}`);
  }

  /** Get a single revenue schedule with all entries. */
  async getSchedule(scheduleId: string): Promise<RevenueScheduleWithEntries> {
    return this.c.request("GET", `/v1/revenue/schedules/${scheduleId}`);
  }

  /** Create a manual revenue recognition schedule. */
  async createSchedule(input: {
    totalAmount: number;
    recognitionStart: string;
    recognitionEnd: string;
    currency?: string;
    customerName?: string;
    description?: string;
    sourceRef?: string;
    deferredRevenueAccountId?: string;
    revenueAccountId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<RevenueScheduleWithEntries> {
    return this.c.request("POST", "/v1/revenue/schedules", { body: input });
  }

  /** Update a revenue schedule (pause, cancel, resume). */
  async updateSchedule(
    scheduleId: string,
    input: { action: "pause" | "cancel" | "resume"; reason?: string },
  ): Promise<RevenueScheduleWithEntries> {
    return this.c.request("PUT", `/v1/revenue/schedules/${scheduleId}`, { body: input });
  }

  /** Manually trigger revenue recognition processing. */
  async processRecognition(): Promise<ProcessingResult> {
    return this.c.request("POST", "/v1/revenue/process");
  }

  /** Get revenue metrics (MRR, ARR, deferred balance, etc.). */
  async getMetrics(): Promise<RevenueMetrics> {
    return this.c.request("GET", "/v1/revenue/metrics");
  }

  /** Get MRR history over time (last N months). */
  async getMrrHistory(months?: number): Promise<MrrHistoryEntry[]> {
    const qs = buildQuery({ months });
    return this.c.request("GET", `/v1/revenue/mrr-history${qs}`);
  }
}

// ── Fixed Assets ────────────────────────────────────────────────────────────

class FixedAssetsModule {
  constructor(private readonly c: Kounta) {}

  /** List fixed assets. */
  async list(opts?: { status?: string; cursor?: string; limit?: number }): Promise<PaginatedResult<FixedAsset>> {
    const qs = buildQuery({ status: opts?.status, cursor: opts?.cursor, limit: opts?.limit });
    return this.c.requestPaginated<FixedAsset>(`/v1/fixed-assets${qs}`);
  }

  /** Create a fixed asset with auto-generated depreciation schedule. */
  async create(input: CreateFixedAssetInput): Promise<FixedAssetWithSchedule> {
    return this.c.request("POST", "/v1/fixed-assets", { body: input });
  }

  /** Get a fixed asset with its full depreciation schedule. */
  async get(assetId: string): Promise<FixedAssetWithSchedule> {
    return this.c.request("GET", `/v1/fixed-assets/${assetId}`);
  }

  /** Get the depreciation schedule for an asset. */
  async getSchedule(assetId: string): Promise<{ asset: FixedAsset; schedule: DepreciationPeriod[] }> {
    return this.c.request("GET", `/v1/fixed-assets/${assetId}/schedule`);
  }

  /** Get asset register summary. */
  async getSummary(): Promise<AssetSummary> {
    return this.c.request("GET", "/v1/fixed-assets/summary");
  }

  /** Get pending depreciation entries. */
  async getPending(): Promise<{ pendingCount: number; totalAmount: number; entries: unknown[] }> {
    return this.c.request("GET", "/v1/fixed-assets/pending");
  }

  /** Check if an amount should be capitalised. */
  async checkCapitalisation(input: {
    amount: number;
    asset_type: string;
    purchase_date: string;
    annual_turnover?: number;
  }): Promise<CapitalisationAdvice & { jurisdiction: string }> {
    return this.c.request("POST", "/v1/fixed-assets/capitalisation-check", { body: input });
  }

  /** Run depreciation — post all pending entries. */
  async runDepreciation(): Promise<DepreciationRunResult> {
    return this.c.request("POST", "/v1/fixed-assets/run-depreciation");
  }

  /** Dispose of a fixed asset. */
  async dispose(assetId: string, input: DisposeAssetInput): Promise<DisposalResult> {
    return this.c.request("POST", `/v1/fixed-assets/${assetId}/dispose`, { body: input });
  }
}

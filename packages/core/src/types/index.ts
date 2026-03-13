// ---------------------------------------------------------------------------
// Domain types — derived from Zod schemas but declared here for clarity.
// All monetary amounts are integers in the smallest currency unit (cents).
// All IDs are UUID v7. All timestamps are UTC ISO 8601.
// ---------------------------------------------------------------------------

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type NormalBalance = "debit" | "credit";
export type Direction = "debit" | "credit";
export type TransactionStatus = "posted" | "reversed" | "pending";
export type UserPlan = "free" | "builder" | "pro" | "platform";
export type SourceType = "api" | "mcp" | "import" | "manual";
export type AccountingBasis = "accrual" | "cash";
export type LedgerStatus = "active" | "archived";
export type AccountStatus = "active" | "archived";
export type ApiKeyStatus = "active" | "revoked";
export type ImportBatchStatus = "pending" | "processing" | "complete" | "failed";
export type MatchStatus = "matched" | "suggested" | "unmatched";
export type AuditAction = "created" | "reversed" | "archived" | "updated";
export type ActorType = "user" | "agent" | "system";
export type StatementType = "pnl" | "balance_sheet" | "cash_flow";

// ---------------------------------------------------------------------------
// Entity interfaces
// ---------------------------------------------------------------------------

export interface Ledger {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly templateId: string | null;
  readonly businessContext: Record<string, unknown> | null;
  readonly fiscalYearStart: number;
  readonly accountingBasis: AccountingBasis;
  readonly status: LedgerStatus;
  readonly ownerId: string;
  readonly closedThrough: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClosedPeriod {
  readonly id: string;
  readonly ledgerId: string;
  readonly periodEnd: string;
  readonly closedAt: string;
  readonly closedBy: string;
  readonly reopenedAt: string | null;
  readonly reopenedBy: string | null;
  readonly createdAt: string;
}

export interface Account {
  readonly id: string;
  readonly ledgerId: string;
  readonly parentId: string | null;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly normalBalance: NormalBalance;
  readonly isSystem: boolean;
  readonly currency: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly status: AccountStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Transaction {
  readonly id: string;
  readonly ledgerId: string;
  readonly idempotencyKey: string;
  readonly date: string;
  readonly effectiveDate: string | null;
  readonly memo: string;
  readonly status: TransactionStatus;
  readonly sourceType: SourceType;
  readonly sourceRef: string | null;
  readonly agentId: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly postedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LineItem {
  readonly id: string;
  readonly transactionId: string;
  readonly accountId: string;
  readonly amount: number;
  readonly direction: Direction;
  readonly currency: string;
  readonly originalAmount: number;
  readonly exchangeRate: number | null;
  readonly memo: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Reversal {
  readonly id: string;
  readonly originalTransactionId: string;
  readonly reversalTransactionId: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AuditEntry {
  readonly id: string;
  readonly ledgerId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: AuditAction;
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly evidenceRef: string | null;
  readonly snapshot: Record<string, unknown>;
  readonly createdAt: string;
}

export interface ImportBatch {
  readonly id: string;
  readonly ledgerId: string;
  readonly sourceType: "csv" | "ofx";
  readonly filename: string;
  readonly rowCount: number;
  readonly matchedCount: number;
  readonly unmatchedCount: number;
  readonly status: ImportBatchStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ImportRow {
  readonly id: string;
  readonly batchId: string;
  readonly date: string;
  readonly amount: number;
  readonly payee: string;
  readonly memo: string | null;
  readonly rawData: Record<string, unknown>;
  readonly matchStatus: MatchStatus;
  readonly matchedTransactionId: string | null;
  readonly confidence: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly authProvider: string;
  readonly authProviderId: string;
  readonly plan: UserPlan;
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly planPeriodStart: string | null;
  readonly planPeriodEnd: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApiKey {
  readonly id: string;
  readonly userId: string;
  readonly ledgerId: string;
  readonly keyHash: string;
  readonly prefix: string;
  readonly name: string;
  readonly lastUsedAt: string | null;
  readonly status: ApiKeyStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Template {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly businessType: string;
  readonly chartOfAccounts: TemplateAccount[];
  readonly defaultCurrency: string;
  readonly defaultBasis: AccountingBasis;
  readonly metadata: Record<string, unknown> | null;
}

export interface TemplateAccount {
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly normalBalance: NormalBalance;
  readonly parentCode: string | null;
  readonly isSystem: boolean;
  readonly children?: TemplateAccount[];
  /** Classification tags for reports: "cash", "current", "non-current", "cogs" */
  readonly tags?: readonly string[];
}

export interface UsagePeriod {
  readonly id: string;
  readonly ledgerId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly transactionCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type PlanEnforcementResult =
  | { readonly allowed: true; readonly status: "posted" | "pending" }
  | { readonly allowed: false };

// ---------------------------------------------------------------------------
// Composite types used by the engine
// ---------------------------------------------------------------------------

export interface TransactionWithLines extends Transaction {
  readonly lines: readonly LineItem[];
}

export interface AccountWithBalance extends Account {
  readonly balance: number;
}

export interface PostTransactionInput {
  readonly ledgerId: string;
  readonly date: string;
  readonly effectiveDate?: string;
  readonly memo: string;
  readonly lines: readonly PostLineInput[];
  readonly idempotencyKey?: string;
  readonly sourceType?: SourceType;
  readonly sourceRef?: string;
  readonly agentId?: string;
  readonly metadata?: Record<string, unknown>;
  readonly statusOverride?: TransactionStatus;
}

export interface PostLineInput {
  readonly accountCode: string;
  readonly amount: number;
  readonly direction: Direction;
  readonly memo?: string;
  readonly metadata?: Record<string, unknown>;
  readonly currency?: string;
  readonly originalAmount?: number;
  readonly exchangeRate?: number;
}

export interface ReverseTransactionInput {
  readonly transactionId: string;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Statement types
// ---------------------------------------------------------------------------

export interface StatementPeriod {
  readonly start: string;
  readonly end: string;
}

export interface StatementLine {
  readonly accountCode: string;
  readonly accountName: string;
  readonly currentPeriod: number;
  readonly priorPeriod: number | null;
}

export interface StatementSection {
  readonly name: string;
  readonly lines: readonly StatementLine[];
  readonly total: number;
}

export interface StatementResponse {
  readonly ledgerId: string;
  readonly statementType: StatementType;
  readonly period: StatementPeriod;
  readonly currency: string;
  readonly generatedAt: string;
  readonly sections: readonly StatementSection[];
  readonly totals: Record<string, number>;
  readonly warnings: readonly string[];
  readonly plainLanguageSummary: string;
}

// ---------------------------------------------------------------------------
// Result type for explicit error handling
// ---------------------------------------------------------------------------

export type Result<T, E = LedgeError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface LedgeError {
  readonly code: string;
  readonly message: string;
  readonly details?: readonly ErrorDetail[];
}

export interface ErrorDetail {
  readonly field: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly suggestion?: string;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginatedResult<T> {
  readonly data: readonly T[];
  readonly nextCursor: string | null;
}

export interface PaginationParams {
  readonly cursor?: string;
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Multi-currency types
// ---------------------------------------------------------------------------

export type ExchangeRateSource = "manual" | "api" | "import";

export interface CurrencySetting {
  readonly id: string;
  readonly ledgerId: string;
  readonly currencyCode: string;
  readonly decimalPlaces: number;
  readonly symbol: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExchangeRate {
  readonly id: string;
  readonly ledgerId: string;
  readonly fromCurrency: string;
  readonly toCurrency: string;
  readonly rate: number;
  readonly effectiveDate: string;
  readonly source: ExchangeRateSource;
  readonly createdAt: string;
}

export interface ConvertAmountResult {
  readonly fromCurrency: string;
  readonly toCurrency: string;
  readonly originalAmount: number;
  readonly convertedAmount: number;
  readonly rate: number;
  readonly effectiveDate: string;
}

export interface RevaluationResult {
  readonly accountId: string;
  readonly accountCode: string;
  readonly currency: string;
  readonly originalBalance: number;
  readonly revaluedBalance: number;
  readonly gainLoss: number;
  readonly transactionId: string | null;
}

// ---------------------------------------------------------------------------
// AI Financial Assistant — conversations
// ---------------------------------------------------------------------------

export interface ToolCallRecord {
  readonly toolName: string;
  readonly input: unknown;
  readonly output: unknown;
}

export interface ConversationMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly toolCalls?: readonly ToolCallRecord[];
  readonly timestamp: string;
}

export interface Conversation {
  readonly id: string;
  readonly userId: string;
  readonly ledgerId: string;
  readonly title: string | null;
  readonly messages: readonly ConversationMessage[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

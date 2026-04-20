// ---------------------------------------------------------------------------
// LedgerEngine — the core double-entry accounting engine.
//
// All monetary amounts are integers in the smallest currency unit (cents).
// All IDs are UUID v7. All timestamps are UTC ISO 8601.
// Transactions are immutable once posted. Corrections create reversals.
// Balance constraint: debits must equal credits on every transaction.
// ---------------------------------------------------------------------------

import { createHash, randomBytes } from "node:crypto";
import type { Database } from "../db/database.js";
import type {
  Ledger,
  Account,
  AccountType,
  NormalBalance,
  TransactionWithLines,
  LineItem,
  AccountWithBalance,
  PostTransactionInput,
  PostLineInput,
  ApiKey,
  AuditEntry,
  ImportBatch,
  ImportRow,
  User,
  Result,
  StatementResponse,
  CurrencySetting,
  ExchangeRate,
  ExchangeRateSource,
  ConvertAmountResult,
  RevaluationResult,
  Conversation,
  ConversationMessage,
  ClosedPeriod,
} from "../types/index.js";
import type {
  BankConnection,
  BankAccount,
  BankTransaction,
  BankSyncLog,
  BankFeedProvider,
  ProviderBankTransaction,
} from "../bank-feeds/types.js";
import { bankTransactionToParseRow } from "../bank-feeds/adapter.js";
import { getTemplate } from "../templates/index.js";
import type { AccountBalanceData, CashFlowAccountData } from "../statements/index.js";
import { buildIncomeStatement, buildBalanceSheet, buildCashFlowStatement } from "../statements/index.js";
import { parseCSV } from "../import/csv-parser.js";
import { parseOFX } from "../import/ofx-parser.js";
import { matchRows } from "../import/matcher.js";
import type { MatchConfig, ConfirmAction } from "../import/types.js";
import { DEFAULT_MATCH_CONFIG } from "../import/types.js";
import {
  ErrorCode,
  ok,
  err,
  unbalancedTransactionError,
  accountNotFoundError,
  ledgerNotFoundError,
  periodClosedError,
  duplicateAccountCodeError,
  transactionNotFoundError,
  transactionAlreadyReversedError,
  apiKeyNotFoundError,
  importNotFoundError,
  importParseError,
  bankConnectionNotFoundError,
  bankAccountNotFoundError,
  bankFeedSyncInProgressError,
  notificationNotFoundError,
  exchangeRateNotFoundError,
  conversationNotFoundError,
  createError,
} from "../errors/index.js";
import { RATE_PRECISION, getDecimalPlaces, convertAmount as convertAmountUtil } from "../currency-utils.js";
import type {
  Notification,
  NotificationPreference,
  NotificationType,
  NotificationStatus,
  CreateNotificationInput,
} from "../intelligence/types.js";
import {
  analyzeMonthlySummary,
  analyzeCashPosition,
  detectAnomalies,
  findUnclassifiedTransactions,
  analyzeDeferredBalance,
} from "../intelligence/analyzer.js";
import {
  renderMonthlySummary,
  renderCashPosition,
  renderAnomalies,
  renderUnclassified,
  renderLargeDeferredBalance,
} from "../intelligence/renderer.js";
import { createLedgerSchema, createAccountSchema, postTransactionSchema, createImportSchema, confirmMatchesSchema } from "../schemas/index.js";
import { createAliasService } from "../classification/aliases.js";
import { createRulesService } from "../classification/rules.js";
import { createClassificationEngine } from "../classification/engine.js";
import { recordClassification } from "../classification/global.js";
import type {
  ClassificationRule,
  ClassificationResult,
  CreateClassificationRuleInput,
  UpdateClassificationRuleInput,
  ListClassificationRulesOptions,
  MerchantAlias,
} from "../classification/types.js";
import {
  matchBankDepositToInvoices,
  listInvoices as listInvoicesFn,
  getInvoiceSummary as getInvoiceSummaryFn,
  getARAging as getARAgingFn,
  getInvoice as getInvoiceFn,
  createInvoice as createInvoiceFn,
  updateInvoice as updateInvoiceFn,
  sendInvoice as sendInvoiceFn,
  recordPayment as recordPaymentFn,
  voidInvoice as voidInvoiceFn,
} from "../invoicing/engine.js";
import type { CreateInvoiceInput, UpdateInvoiceInput, RecordPaymentInput } from "../invoicing/types.js";
import {
  listFixedAssets as listFixedAssetsFn,
  getFixedAsset as getFixedAssetFn,
  createFixedAsset as createFixedAssetFn,
  updateFixedAsset as updateFixedAssetFn,
  getAssetSchedule as getAssetScheduleFn,
  getPendingDepreciation as getPendingDepreciationFn,
  runDepreciation as runDepreciationFn,
  getAssetSummary as getAssetSummaryFn,
  disposeFixedAsset as disposeFixedAssetFn,
} from "../fixed-assets/engine.js";
import type { CreateFixedAssetInput, UpdateFixedAssetInput, DisposeAssetInput } from "../fixed-assets/types.js";
import {
  getConnectionByLedger as getConnectionByLedgerFn,
  createConnection as createConnectionFn,
  disconnectConnection as disconnectConnectionFn,
} from "../stripe/connection.js";
import { handleEvent as handleEventFn } from "../stripe/webhook.js";
import { ensureStripeAccounts as ensureStripeAccountsFn } from "../stripe/accounts.js";
import { backfillAll as backfillAllFn } from "../stripe/backfill.js";
import type { StripeConnection, CreateStripeConnectionInput } from "../stripe/types.js";
import { getUsageSummary as getUsageSummaryFn, checkLimit as checkLimitFn, incrementUsage as incrementUsageFn } from "../tiers/usage.js";
import { sendEmail as sendEmailFn } from "../email/sender.js";
import {
  createBill as createBillFn,
  updateBill as updateBillFn,
  approveBill as approveBillFn,
  recordBillPayment as recordBillPaymentFn,
  voidBill as voidBillFn,
  getBill as getBillFn,
  listBills as listBillsFn,
  getBillSummary as getBillSummaryFn,
  getAPAging as getAPAgingFn,
} from "../bills/engine.js";
import type { CreateBillInput, UpdateBillInput, RecordBillPaymentInput } from "../bills/types.js";
import {
  createVendor as createVendorFn,
  updateVendor as updateVendorFn,
  getVendor as getVendorFn,
  listVendors as listVendorsFn,
  deleteVendor as deleteVendorFn,
} from "../bills/vendors.js";
import type { CreateVendorInput, UpdateVendorInput } from "../bills/vendors.js";
import { generateId, nowUtc } from "./id.js";
import type {
  RecurringEntry,
  RecurringEntryLog,
  CreateRecurringEntryInput,
  UpdateRecurringEntryInput,
} from "../recurring/types.js";
import {
  createRecurringEntry as createRecurringEntryFn,
  listRecurringEntries as listRecurringEntriesFn,
  getRecurringEntry as getRecurringEntryFn,
  updateRecurringEntry as updateRecurringEntryFn,
  deleteRecurringEntry as deleteRecurringEntryFn,
  pauseRecurringEntry as pauseRecurringEntryFn,
  resumeRecurringEntry as resumeRecurringEntryFn,
  getLogsForEntry as getLogsForEntryFn,
} from "../recurring/recurring.js";
import { processRecurringEntries as processRecurringEntriesFn } from "../recurring/scheduler.js";

// ---------------------------------------------------------------------------
// Normal balance derivation
// ---------------------------------------------------------------------------

const normalBalanceFor = (type: AccountType): NormalBalance => {
  switch (type) {
    case "asset":
    case "expense":
      return "debit";
    case "liability":
    case "equity":
    case "revenue":
      return "credit";
  }
};

// ---------------------------------------------------------------------------
// DB row types (snake_case from SQLite)
// ---------------------------------------------------------------------------

interface LedgerRow {
  id: string;
  name: string;
  currency: string;
  template_id: string | null;
  business_context: string | Record<string, unknown> | null;
  fiscal_year_start: number;
  accounting_basis: string;
  status: string;
  owner_id: string;
  closed_through: string | null;
  jurisdiction: string;
  tax_id: string | null;
  tax_basis: string;
  created_at: string;
  updated_at: string;
}

interface AccountRow {
  id: string;
  ledger_id: string;
  parent_id: string | null;
  code: string;
  name: string;
  type: string;
  normal_balance: string;
  is_system: number | boolean;
  currency: string | null;
  metadata: string | Record<string, unknown> | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface TransactionRow {
  id: string;
  ledger_id: string;
  idempotency_key: string;
  date: string;
  effective_date: string | null;
  memo: string;
  status: string;
  source_type: string;
  source_ref: string | null;
  agent_id: string | null;
  metadata: string | Record<string, unknown> | null;
  posted_at: string;
  created_at: string;
  updated_at: string;
}

interface LineItemRow {
  id: string;
  transaction_id: string;
  account_id: string;
  amount: number;
  direction: string;
  currency: string;
  original_amount: number;
  exchange_rate: number | null;
  memo: string | null;
  metadata: string | Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface ApiKeyRow {
  id: string;
  user_id: string;
  ledger_id: string;
  key_hash: string;
  prefix: string;
  name: string;
  last_used_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface AuditEntryRow {
  id: string;
  ledger_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_type: string;
  actor_id: string;
  evidence_ref: string | null;
  snapshot: string | Record<string, unknown>;
  created_at: string;
}

interface ImportBatchRow {
  id: string;
  ledger_id: string;
  source_type: string;
  filename: string;
  row_count: number;
  matched_count: number;
  unmatched_count: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ImportRowRow {
  id: string;
  batch_id: string;
  date: string;
  amount: number;
  payee: string;
  memo: string | null;
  raw_data: string | Record<string, unknown>;
  match_status: string;
  matched_transaction_id: string | null;
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  auth_provider: string;
  auth_provider_id: string;
  plan: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan_period_start: string | null;
  plan_period_end: string | null;
  created_at: string;
  updated_at: string;
}

interface ClosedPeriodRow {
  id: string;
  ledger_id: string;
  period_end: string;
  closed_at: string;
  closed_by: string;
  reopened_at: string | null;
  reopened_by: string | null;
  created_at: string;
}

interface BalanceRow {
  balance: number | string;
}

// DEPRECATED: Used only by deprecated getUsage/incrementUsage/resetUsage methods below.
// New code should use usage_tracking table via @kounta/core tiers/usage.ts.
interface UsagePeriodRow {
  id: string;
  ledger_id: string;
  period_start: string;
  period_end: string;
  transaction_count: number;
  created_at: string;
  updated_at: string;
}


interface ConversationRow {
  id: string;
  user_id: string;
  ledger_id: string;
  title: string | null;
  messages: string;
  created_at: string;
  updated_at: string;
}

interface BankConnectionRow {
  id: string;
  ledger_id: string;
  provider: string;
  provider_connection_id: string;
  institution_id: string;
  institution_name: string;
  status: string;
  consent_expires_at: string | null;
  last_sync_at: string | null;
  metadata: string | Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface BankAccountRow {
  id: string;
  connection_id: string;
  ledger_id: string;
  provider_account_id: string;
  name: string;
  account_number: string;
  bsb: string | null;
  type: string;
  currency: string;
  current_balance: number;
  available_balance: number | null;
  mapped_account_id: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

interface BankTransactionRow {
  id: string;
  bank_account_id: string;
  ledger_id: string;
  provider_transaction_id: string;
  date: string;
  amount: number;
  type: string;
  description: string;
  reference: string | null;
  category: string | null;
  balance: number | null;
  status: string;
  matched_transaction_id: string | null;
  match_confidence: number | null;
  is_personal: number | boolean;
  suggested_account_id: string | null;
  raw_data: string | Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface BankSyncLogRow {
  id: string;
  connection_id: string;
  bank_account_id: string | null;
  status: string;
  transactions_fetched: number;
  transactions_new: number;
  transactions_matched: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

interface NotificationRow {
  id: string;
  ledger_id: string;
  user_id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  data: string | Record<string, unknown>;
  action_type: string | null;
  action_data: string | Record<string, unknown> | null;
  status: string;
  created_at: string;
  read_at: string | null;
  actioned_at: string | null;
}

interface NotificationPreferenceRow {
  id: string;
  user_id: string;
  ledger_id: string;
  type: string;
  enabled: number | boolean;
  updated_at: string;
}

interface CurrencySettingRow {
  id: string;
  ledger_id: string;
  currency_code: string;
  decimal_places: number;
  symbol: string;
  enabled: number | boolean;
  created_at: string;
  updated_at: string;
}

interface ExchangeRateRow {
  id: string;
  ledger_id: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  effective_date: string;
  source: string;
  created_at: string;
}

/**
 * Safely parse a JSONB value from the database.
 * SQLite returns JSON as TEXT (string), PostgreSQL returns JSONB as a parsed JS object.
 * This helper handles both cases.
 */
const parseJsonb = <T = Record<string, unknown>>(value: string | T): T => {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
};

// ---------------------------------------------------------------------------
// Row → Domain mappers
// ---------------------------------------------------------------------------

const toLedger = (row: LedgerRow): Ledger => ({
  id: row.id,
  name: row.name,
  currency: row.currency,
  templateId: row.template_id,
  businessContext: row.business_context ? parseJsonb(row.business_context) as Record<string, unknown> : null,
  fiscalYearStart: row.fiscal_year_start,
  accountingBasis: row.accounting_basis as Ledger["accountingBasis"],
  status: row.status as Ledger["status"],
  ownerId: row.owner_id,
  closedThrough: row.closed_through,
  jurisdiction: row.jurisdiction ?? "AU",
  taxId: row.tax_id ?? null,
  taxBasis: row.tax_basis ?? "accrual",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toClosedPeriod = (row: ClosedPeriodRow): ClosedPeriod => ({
  id: row.id,
  ledgerId: row.ledger_id,
  periodEnd: row.period_end,
  closedAt: row.closed_at,
  closedBy: row.closed_by,
  reopenedAt: row.reopened_at,
  reopenedBy: row.reopened_by,
  createdAt: row.created_at,
});

const toAccount = (row: AccountRow): Account => ({
  id: row.id,
  ledgerId: row.ledger_id,
  parentId: row.parent_id,
  code: row.code,
  name: row.name,
  type: row.type as Account["type"],
  normalBalance: row.normal_balance as Account["normalBalance"],
  isSystem: !!row.is_system,
  currency: row.currency ?? null,
  metadata: row.metadata ? parseJsonb(row.metadata) as Record<string, unknown> : null,
  status: row.status as Account["status"],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toTransaction = (row: TransactionRow): TransactionWithLines["lines"] extends never ? never : Omit<TransactionWithLines, "lines"> => ({
  id: row.id,
  ledgerId: row.ledger_id,
  idempotencyKey: row.idempotency_key,
  date: row.date,
  effectiveDate: row.effective_date,
  memo: row.memo,
  status: row.status as TransactionWithLines["status"],
  sourceType: row.source_type as TransactionWithLines["sourceType"],
  sourceRef: row.source_ref,
  agentId: row.agent_id,
  metadata: row.metadata ? parseJsonb(row.metadata) as Record<string, unknown> : null,
  postedAt: row.posted_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toLineItem = (row: LineItemRow): LineItem => ({
  id: row.id,
  transactionId: row.transaction_id,
  accountId: row.account_id,
  amount: row.amount,
  direction: row.direction as LineItem["direction"],
  currency: row.currency ?? "",
  originalAmount: row.original_amount ?? row.amount,
  exchangeRate: row.exchange_rate ?? null,
  memo: row.memo,
  metadata: row.metadata ? parseJsonb(row.metadata) as Record<string, unknown> : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toApiKey = (row: ApiKeyRow): ApiKey => ({
  id: row.id,
  userId: row.user_id,
  ledgerId: row.ledger_id,
  keyHash: row.key_hash,
  prefix: row.prefix,
  name: row.name,
  lastUsedAt: row.last_used_at,
  status: row.status as ApiKey["status"],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toAuditEntry = (row: AuditEntryRow): AuditEntry => ({
  id: row.id,
  ledgerId: row.ledger_id,
  entityType: row.entity_type,
  entityId: row.entity_id,
  action: row.action as AuditEntry["action"],
  actorType: row.actor_type as AuditEntry["actorType"],
  actorId: row.actor_id,
  evidenceRef: row.evidence_ref,
  snapshot: parseJsonb(row.snapshot) as Record<string, unknown>,
  createdAt: row.created_at,
});

const toImportBatch = (row: ImportBatchRow): ImportBatch => ({
  id: row.id,
  ledgerId: row.ledger_id,
  sourceType: row.source_type as ImportBatch["sourceType"],
  filename: row.filename,
  rowCount: row.row_count,
  matchedCount: row.matched_count,
  unmatchedCount: row.unmatched_count,
  status: row.status as ImportBatch["status"],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toImportRow = (row: ImportRowRow): ImportRow => ({
  id: row.id,
  batchId: row.batch_id,
  date: row.date,
  amount: row.amount,
  payee: row.payee,
  memo: row.memo,
  rawData: parseJsonb(row.raw_data) as Record<string, unknown>,
  matchStatus: row.match_status as ImportRow["matchStatus"],
  matchedTransactionId: row.matched_transaction_id,
  confidence: row.confidence,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  authProvider: row.auth_provider,
  authProviderId: row.auth_provider_id,
  plan: (row.plan || "free") as User["plan"],
  stripeCustomerId: row.stripe_customer_id,
  stripeSubscriptionId: row.stripe_subscription_id,
  planPeriodStart: row.plan_period_start,
  planPeriodEnd: row.plan_period_end,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toConversation = (row: ConversationRow): Conversation => ({
  id: row.id,
  userId: row.user_id,
  ledgerId: row.ledger_id,
  title: row.title,
  messages: parseJsonb<ConversationMessage[]>(row.messages),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toBankConnection = (row: BankConnectionRow): BankConnection => ({
  id: row.id,
  ledgerId: row.ledger_id,
  provider: row.provider,
  providerConnectionId: row.provider_connection_id,
  institutionId: row.institution_id,
  institutionName: row.institution_name,
  status: row.status as BankConnection["status"],
  consentExpiresAt: row.consent_expires_at,
  lastSyncAt: row.last_sync_at,
  metadata: row.metadata ? parseJsonb(row.metadata) as Record<string, unknown> : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toBankAccount = (row: BankAccountRow): BankAccount => ({
  id: row.id,
  connectionId: row.connection_id,
  ledgerId: row.ledger_id,
  providerAccountId: row.provider_account_id,
  name: row.name,
  accountNumber: row.account_number,
  bsb: row.bsb,
  type: row.type,
  currency: row.currency,
  currentBalance: row.current_balance,
  availableBalance: row.available_balance,
  mappedAccountId: row.mapped_account_id,
  lastSyncAt: row.last_sync_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toBankTransaction = (row: BankTransactionRow): BankTransaction => ({
  id: row.id,
  bankAccountId: row.bank_account_id,
  ledgerId: row.ledger_id,
  providerTransactionId: row.provider_transaction_id,
  date: row.date,
  amount: row.amount,
  type: row.type as BankTransaction["type"],
  description: row.description,
  reference: row.reference,
  category: row.category,
  balance: row.balance,
  status: row.status as BankTransaction["status"],
  matchedTransactionId: row.matched_transaction_id,
  matchConfidence: row.match_confidence,
  isPersonal: row.is_personal === 1 || row.is_personal === true,
  suggestedAccountId: row.suggested_account_id,
  rawData: row.raw_data ? parseJsonb(row.raw_data) as Record<string, unknown> : {},
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toBankSyncLog = (row: BankSyncLogRow): BankSyncLog => ({
  id: row.id,
  connectionId: row.connection_id,
  bankAccountId: row.bank_account_id,
  status: row.status as BankSyncLog["status"],
  transactionsFetched: row.transactions_fetched,
  transactionsNew: row.transactions_new,
  transactionsMatched: row.transactions_matched,
  errorMessage: row.error_message,
  startedAt: row.started_at,
  completedAt: row.completed_at,
});

const toNotification = (row: NotificationRow): Notification => ({
  id: row.id,
  ledgerId: row.ledger_id,
  userId: row.user_id,
  type: row.type as NotificationType,
  severity: row.severity as Notification["severity"],
  title: row.title,
  body: row.body,
  data: parseJsonb(row.data),
  actionType: row.action_type,
  actionData: row.action_data ? parseJsonb(row.action_data) : null,
  status: row.status as NotificationStatus,
  createdAt: row.created_at,
  readAt: row.read_at,
  actionedAt: row.actioned_at,
});

const toNotificationPreference = (row: NotificationPreferenceRow): NotificationPreference => ({
  id: row.id,
  userId: row.user_id,
  ledgerId: row.ledger_id,
  type: row.type as NotificationType,
  enabled: row.enabled === 1 || row.enabled === true,
  updatedAt: row.updated_at,
});

const toCurrencySetting = (row: CurrencySettingRow): CurrencySetting => ({
  id: row.id,
  ledgerId: row.ledger_id,
  currencyCode: row.currency_code,
  decimalPlaces: row.decimal_places,
  symbol: row.symbol,
  enabled: row.enabled === 1 || row.enabled === true,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toExchangeRate = (row: ExchangeRateRow): ExchangeRate => ({
  id: row.id,
  ledgerId: row.ledger_id,
  fromCurrency: row.from_currency,
  toCurrency: row.to_currency,
  rate: row.rate,
  effectiveDate: row.effective_date,
  source: row.source as ExchangeRateSource,
  createdAt: row.created_at,
});

/** Hash a raw API key with SHA-256 */
const hashApiKey = (rawKey: string): string =>
  createHash("sha256").update(rawKey).digest("hex");

/** Compute the date string for one day before the given ISO date */
const dayBefore = (dateStr: string): string => {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface CreateLedgerParams {
  readonly name: string;
  readonly currency?: string;
  readonly fiscalYearStart?: number;
  readonly accountingBasis?: "accrual" | "cash";
  readonly ownerId: string;
  readonly businessContext?: Record<string, unknown>;
}

export interface CreateAccountParams {
  readonly ledgerId: string;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly normalBalance?: NormalBalance;
  readonly parentCode?: string;
  readonly currency?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface CreateApiKeyParams {
  readonly userId: string;
  readonly ledgerId: string;
  readonly name: string;
}

export class LedgerEngine {
  constructor(private readonly db: Database) {}

  /** Expose the database for modules that need direct access (email, scheduler). */
  getDb(): Database {
    return this.db;
  }

  // -------------------------------------------------------------------------
  // Ledger operations
  // -------------------------------------------------------------------------

  async createLedger(params: CreateLedgerParams): Promise<Result<Ledger>> {
    const parsed = createLedgerSchema.safeParse(params);
    if (!parsed.success) {
      return err(createError(ErrorCode.VALIDATION_ERROR, parsed.error.message));
    }

    const id = generateId();
    const now = nowUtc();
    const currency = params.currency ?? "USD";
    const fiscalYearStart = params.fiscalYearStart ?? 1;
    const accountingBasis = params.accountingBasis ?? "accrual";
    const businessContext = params.businessContext ? JSON.stringify(params.businessContext) : null;

    // Ensure the owner user exists (auto-create for admin/system callers)
    const existingUser = await this.db.get("SELECT id FROM users WHERE id = ?", [params.ownerId]);
    if (!existingUser) {
      await this.db.run(
        "INSERT INTO users (id, email, name, auth_provider, auth_provider_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [params.ownerId, `user-${params.ownerId.substring(0, 8)}@kounta.internal`, "Auto-created User", "system", params.ownerId, now, now]
      );
    }

    await this.db.run(
      `INSERT INTO ledgers (id, name, currency, fiscal_year_start, accounting_basis, status, owner_id, business_context, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      [id, params.name, currency, fiscalYearStart, accountingBasis, params.ownerId, businessContext, now, now]
    );

    const row = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [id]);
    if (!row) {
      return err(createError(ErrorCode.INTERNAL_ERROR, "Failed to create ledger"));
    }
    return ok(toLedger(row));
  }

  async getLedger(id: string): Promise<Result<Ledger>> {
    const row = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [id]);
    if (!row) {
      return err(ledgerNotFoundError(id));
    }
    return ok(toLedger(row));
  }

  async findUserByProvider(authProvider: string, authProviderId: string): Promise<Result<User | null>> {
    const row = await this.db.get<UserRow>(
      "SELECT * FROM users WHERE auth_provider = ? AND auth_provider_id = ?",
      [authProvider, authProviderId],
    );
    return ok(row ? toUser(row) : null);
  }

  async findUserByEmail(email: string): Promise<Result<User | null>> {
    const row = await this.db.get<UserRow>(
      "SELECT * FROM users WHERE email = ?",
      [email],
    );
    return ok(row ? toUser(row) : null);
  }

  async findLedgersByOwner(ownerId: string): Promise<Result<Ledger[]>> {
    const rows = await this.db.all<LedgerRow>(
      "SELECT * FROM ledgers WHERE owner_id = ? AND status = 'active' ORDER BY created_at DESC",
      [ownerId],
    );
    return ok(rows.map(toLedger));
  }

  async createUser(params: { email: string; name: string; authProvider: string; authProviderId: string }): Promise<Result<User>> {
    const id = generateId();
    const now = nowUtc();
    await this.db.run(
      "INSERT INTO users (id, email, name, auth_provider, auth_provider_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, params.email, params.name, params.authProvider, params.authProviderId, now, now]
    );
    const row = await this.db.get<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
    if (!row) return err(createError(ErrorCode.INTERNAL_ERROR, "Failed to create user"));
    return ok(toUser(row));
  }

  // -------------------------------------------------------------------------
  // Account operations
  // -------------------------------------------------------------------------

  async createAccount(params: CreateAccountParams): Promise<Result<Account>> {
    const parsed = createAccountSchema.safeParse(params);
    if (!parsed.success) {
      return err(createError(ErrorCode.VALIDATION_ERROR, parsed.error.message));
    }

    // Verify ledger exists
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [params.ledgerId]);
    if (!ledger) {
      return err(ledgerNotFoundError(params.ledgerId));
    }

    // Check for duplicate code within ledger
    const existing = await this.db.get<AccountRow>(
      "SELECT * FROM accounts WHERE ledger_id = ? AND code = ?",
      [params.ledgerId, params.code]
    );
    if (existing) {
      return err(duplicateAccountCodeError(params.code, params.ledgerId));
    }

    // Resolve parent account if parentCode is provided
    let parentId: string | null = null;
    if (params.parentCode) {
      const parent = await this.db.get<AccountRow>(
        "SELECT * FROM accounts WHERE ledger_id = ? AND code = ?",
        [params.ledgerId, params.parentCode]
      );
      if (!parent) {
        return err(accountNotFoundError(params.parentCode));
      }
      parentId = parent.id;
    }

    // Auto-derive normal balance from account type if not provided
    const normalBalance = params.normalBalance ?? normalBalanceFor(params.type);
    const id = generateId();
    const now = nowUtc();
    const metadata = params.metadata ? JSON.stringify(params.metadata) : null;

    await this.db.run(
      `INSERT INTO accounts (id, ledger_id, parent_id, code, name, type, normal_balance, is_system, currency, metadata, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [id, params.ledgerId, parentId, params.code, params.name, params.type, normalBalance, false, params.currency ?? null, metadata, now, now]
    );

    const row = await this.db.get<AccountRow>("SELECT * FROM accounts WHERE id = ?", [id]);
    if (!row) {
      return err(createError(ErrorCode.INTERNAL_ERROR, "Failed to create account"));
    }

    const auditId = generateId();
    await this.db.run(
      `INSERT INTO audit_entries (id, ledger_id, entity_type, entity_id, action, actor_type, actor_id, snapshot, created_at)
       VALUES (?, ?, 'account', ?, 'created', 'system', 'engine', ?, ?)`,
      [auditId, params.ledgerId, id, JSON.stringify(toAccount(row)), now]
    );

    return ok(toAccount(row));
  }

  async getAccount(id: string): Promise<Result<AccountWithBalance>> {
    const row = await this.db.get<AccountRow>("SELECT * FROM accounts WHERE id = ?", [id]);
    if (!row) {
      return err(accountNotFoundError(id));
    }
    const account = toAccount(row);
    const balance = await this.computeBalance(id, account.normalBalance);
    return ok({ ...account, balance });
  }

  async listAccounts(ledgerId: string): Promise<Result<AccountWithBalance[]>> {
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) {
      return err(ledgerNotFoundError(ledgerId));
    }

    const rows = await this.db.all<AccountRow>(
      "SELECT * FROM accounts WHERE ledger_id = ? ORDER BY code",
      [ledgerId]
    );

    // Batch compute all balances in a single query (avoids N+1)
    const rawBalances = await this.computeBalancesBatch(rows.map((r) => r.id));

    const accounts: AccountWithBalance[] = rows.map((row) => {
      const account = toAccount(row);
      const balance = this.getSignedBalance(rawBalances, row.id, account.normalBalance);
      return { ...account, balance };
    });

    return ok(accounts);
  }

  // -------------------------------------------------------------------------
  // Transaction posting
  // -------------------------------------------------------------------------

  async postTransaction(input: PostTransactionInput): Promise<Result<TransactionWithLines>> {
    // Validate input with Zod
    const parsed = postTransactionSchema.safeParse(input);
    if (!parsed.success) {
      return err(createError(ErrorCode.VALIDATION_ERROR, parsed.error.message));
    }

    // Verify ledger exists (select only needed columns)
    const ledger = await this.db.get<Pick<LedgerRow, "id" | "currency" | "closed_through">>(
      "SELECT id, currency, closed_through FROM ledgers WHERE id = ?",
      [input.ledgerId],
    );
    if (!ledger) {
      return err(ledgerNotFoundError(input.ledgerId));
    }

    // Check period close — reject if transaction date is on or before closed_through
    if (ledger.closed_through && input.date <= ledger.closed_through) {
      return err(periodClosedError(input.date, ledger.closed_through));
    }

    // Balance enforcement — debits must equal credits
    const debitTotal = input.lines
      .filter((l) => l.direction === "debit")
      .reduce((sum, l) => sum + l.amount, 0);
    const creditTotal = input.lines
      .filter((l) => l.direction === "credit")
      .reduce((sum, l) => sum + l.amount, 0);

    if (debitTotal !== creditTotal) {
      return err(unbalancedTransactionError(debitTotal, creditTotal));
    }

    // Resolve account codes to IDs and validate all accounts belong to this ledger.
    // Single batch lookup instead of one query per line — was previously O(n) round trips.
    const uniqueCodes = Array.from(new Set(input.lines.map((l) => l.accountCode)));
    const placeholders = uniqueCodes.map(() => "?").join(",");
    const accountRows = await this.db.all<Pick<AccountRow, "id" | "code" | "status">>(
      `SELECT id, code, status FROM accounts WHERE ledger_id = ? AND code IN (${placeholders})`,
      [input.ledgerId, ...uniqueCodes],
    );
    const accountByCode = new Map(accountRows.map((a) => [a.code, a]));

    const resolvedLines: Array<{ accountId: string; line: PostLineInput }> = [];
    for (const line of input.lines) {
      const account = accountByCode.get(line.accountCode);
      if (!account) {
        return err(accountNotFoundError(line.accountCode));
      }
      if (account.status !== "active") {
        return err(createError(ErrorCode.ACCOUNT_INACTIVE, `Account ${line.accountCode} is not active`));
      }
      resolvedLines.push({ accountId: account.id, line });
    }

    // Generate idempotency key if not provided
    const idempotencyKey = input.idempotencyKey ?? generateId();

    // All validations passed — insert within a DB transaction (includes atomic idempotency check)
    try {
    const result = await this.db.transaction(async () => {
      // Atomic idempotency check — inside the transaction to prevent race conditions.
      // The UNIQUE(ledger_id, idempotency_key) constraint provides a DB-level safety net,
      // but checking here gives a graceful return instead of a constraint violation error.
      const existingTxn = await this.db.get<TransactionRow>(
        "SELECT * FROM transactions WHERE ledger_id = ? AND idempotency_key = ?",
        [input.ledgerId, idempotencyKey]
      );

      if (existingTxn) {
        // Compare key parameters to detect key reuse with different data.
        // Fingerprint each line-set as a sorted multiset of (account_id, direction, amount)
        // so the comparison is independent of insertion order but sensitive to amounts.
        const existingLines = await this.db.all<LineItemRow>(
          "SELECT * FROM line_items WHERE transaction_id = ? ORDER BY created_at",
          [existingTxn.id]
        );

        const fingerprint = (rows: ReadonlyArray<{ account_id: string; direction: string; amount: number }>) =>
          rows
            .map((r) => `${r.account_id}|${r.direction}|${r.amount}`)
            .sort()
            .join(";");

        const existingFingerprint = fingerprint(existingLines);
        const incomingFingerprint = fingerprint(
          resolvedLines.map((rl) => ({
            account_id: rl.accountId,
            direction: rl.line.direction,
            amount: rl.line.amount,
          })),
        );

        const paramMismatch =
          existingTxn.date !== input.date ||
          existingTxn.memo !== input.memo ||
          existingFingerprint !== incomingFingerprint;

        if (paramMismatch) {
          throw Object.assign(
            new Error(`Idempotency key "${idempotencyKey}" already used with different parameters`),
            { code: "IDEMPOTENCY_CONFLICT" },
          );
        }

        return {
          ...toTransaction(existingTxn),
          lines: existingLines.map(toLineItem),
        } as TransactionWithLines;
      }

      const txnId = generateId();
      const now = nowUtc();
      const sourceType = input.sourceType ?? "api";
      const metadata = input.metadata ? JSON.stringify(input.metadata) : null;

      await this.db.run(
        `INSERT INTO transactions (id, ledger_id, idempotency_key, date, effective_date, memo, status, source_type, source_ref, agent_id, metadata, posted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          txnId,
          input.ledgerId,
          idempotencyKey,
          input.date,
          input.effectiveDate ?? null,
          input.memo,
          input.statusOverride ?? "posted",
          sourceType,
          input.sourceRef ?? null,
          input.agentId ?? null,
          metadata,
          input.statusOverride === "pending" ? null : now,
          now,
          now,
        ]
      );

      // Insert line items
      const lineIds: string[] = [];
      for (const { accountId, line } of resolvedLines) {
        const lineId = generateId();
        lineIds.push(lineId);
        const lineMeta = line.metadata ? JSON.stringify(line.metadata) : null;
        const lineCurrency = line.currency ?? ledger.currency;
        const lineOriginalAmount = line.originalAmount ?? line.amount;
        const lineExchangeRate = line.exchangeRate ?? null;

        await this.db.run(
          `INSERT INTO line_items (id, transaction_id, account_id, amount, direction, currency, original_amount, exchange_rate, memo, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [lineId, txnId, accountId, line.amount, line.direction, lineCurrency, lineOriginalAmount, lineExchangeRate, line.memo ?? null, lineMeta, now, now]
        );
      }

      // Verify balance at the DB level (application-layer enforcement for SQLite)
      const balanceCheck = await this.db.get<{ debit_total: number; credit_total: number; line_count: number }>(
        `SELECT
           COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0) AS debit_total,
           COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0) AS credit_total,
           COUNT(*) AS line_count
         FROM line_items
         WHERE transaction_id = ?`,
        [txnId]
      );

      if (!balanceCheck || Number(balanceCheck.debit_total) !== Number(balanceCheck.credit_total) || Number(balanceCheck.line_count) < 2) {
        throw new Error(
          `Balance constraint violation: debits (${balanceCheck?.debit_total}) != credits (${balanceCheck?.credit_total})`
        );
      }

      // Write audit entry
      const auditId = generateId();
      await this.db.run(
        `INSERT INTO audit_entries (id, ledger_id, entity_type, entity_id, action, actor_type, actor_id, snapshot, created_at)
         VALUES (?, ?, 'transaction', ?, 'created', 'system', 'engine', ?, ?)`,
        [auditId, input.ledgerId, txnId, JSON.stringify({ memo: input.memo, lines: input.lines }), now]
      );

      // Read back the complete transaction with lines
      const txnRow = (await this.db.get<TransactionRow>("SELECT * FROM transactions WHERE id = ?", [txnId]))!;
      const lineRows = await this.db.all<LineItemRow>(
        "SELECT * FROM line_items WHERE transaction_id = ? ORDER BY created_at",
        [txnId]
      );

      return {
        ...toTransaction(txnRow),
        lines: lineRows.map(toLineItem),
      } as TransactionWithLines;
    });

    return ok(result);
  } catch (e: unknown) {
    if (e instanceof Error && "code" in e && (e as Error & { code: string }).code === "IDEMPOTENCY_CONFLICT") {
      return err(createError(ErrorCode.VALIDATION_ERROR, e.message));
    }
    throw e;
  }
  }

  // -------------------------------------------------------------------------
  // Transaction retrieval
  // -------------------------------------------------------------------------

  async getTransaction(id: string): Promise<Result<TransactionWithLines>> {
    const row = await this.db.get<TransactionRow>("SELECT * FROM transactions WHERE id = ?", [id]);
    if (!row) {
      return err(transactionNotFoundError(id));
    }
    const lines = await this.db.all<LineItemRow>(
      "SELECT * FROM line_items WHERE transaction_id = ? ORDER BY created_at",
      [row.id]
    );
    return ok({
      ...toTransaction(row),
      lines: lines.map(toLineItem),
    } as TransactionWithLines);
  }

  async listTransactions(
    ledgerId: string,
    params?: { cursor?: string; limit?: number }
  ): Promise<Result<{ data: TransactionWithLines[]; nextCursor: string | null }>> {
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) {
      return err(ledgerNotFoundError(ledgerId));
    }

    const limit = Math.min(params?.limit ?? 50, 200);
    let rows: TransactionRow[];

    if (params?.cursor) {
      rows = await this.db.all<TransactionRow>(
        "SELECT * FROM transactions WHERE ledger_id = ? AND id > ? ORDER BY id LIMIT ?",
        [ledgerId, params.cursor, limit + 1]
      );
    } else {
      rows = await this.db.all<TransactionRow>(
        "SELECT * FROM transactions WHERE ledger_id = ? ORDER BY id LIMIT ?",
        [ledgerId, limit + 1]
      );
    }

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? pageRows[pageRows.length - 1]!.id : null;

    // Batch fetch all line items in a single query (avoids N+1)
    const lineItemsMap = await this.fetchLineItemsBatch(pageRows.map((r) => r.id));

    const transactions: TransactionWithLines[] = pageRows.map((row) => ({
      ...toTransaction(row),
      lines: lineItemsMap.get(row.id) ?? [],
    } as TransactionWithLines));

    return ok({ data: transactions, nextCursor });
  }

  // -------------------------------------------------------------------------
  // Reversal
  // -------------------------------------------------------------------------

  async reverseTransaction(transactionId: string, reason: string): Promise<Result<TransactionWithLines>> {
    const originalRow = await this.db.get<TransactionRow>("SELECT * FROM transactions WHERE id = ?", [transactionId]);
    if (!originalRow) {
      return err(transactionNotFoundError(transactionId));
    }

    if (originalRow.status === "reversed") {
      return err(transactionAlreadyReversedError(transactionId));
    }

    // Check if already reversed via reversals table
    const existingReversal = await this.db.get<{ id: string }>(
      "SELECT id FROM reversals WHERE original_transaction_id = ?",
      [transactionId]
    );
    if (existingReversal) {
      return err(transactionAlreadyReversedError(transactionId));
    }

    const originalLines = await this.db.all<LineItemRow>(
      "SELECT * FROM line_items WHERE transaction_id = ?",
      [transactionId]
    );

    // Pre-resolve account codes before entering the transaction block
    const reversalLines: PostLineInput[] = [];
    for (const line of originalLines) {
      const accountCode = await this.getAccountCodeById(line.account_id);
      reversalLines.push({
        accountCode,
        amount: line.amount,
        direction: line.direction === "debit" ? "credit" as const : "debit" as const,
      });
    }

    // Create the reversal as a new transaction with flipped directions
    const reversalInput: PostTransactionInput = {
      ledgerId: originalRow.ledger_id,
      date: new Date().toISOString().slice(0, 10),
      memo: `Reversal of ${transactionId}: ${reason}`,
      sourceType: originalRow.source_type as PostTransactionInput["sourceType"],
      lines: reversalLines,
    };

    const result = await this.db.transaction(async () => {
      // Post the reversal transaction
      const postResult = await this.postTransaction(reversalInput);
      if (!postResult.ok) {
        throw new Error(postResult.error.message);
      }

      const reversalTxn = postResult.value;

      // Mark original as reversed
      await this.db.run(
        "UPDATE transactions SET status = 'reversed' WHERE id = ?",
        [transactionId]
      );

      // Create reversals record
      const reversalId = generateId();
      const now = nowUtc();
      await this.db.run(
        `INSERT INTO reversals (id, original_transaction_id, reversal_transaction_id, reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [reversalId, transactionId, reversalTxn.id, reason, now, now]
      );

      // Audit entry
      const auditId = generateId();
      await this.db.run(
        `INSERT INTO audit_entries (id, ledger_id, entity_type, entity_id, action, actor_type, actor_id, snapshot, created_at)
         VALUES (?, ?, 'transaction', ?, 'reversed', 'system', 'engine', ?, ?)`,
        [auditId, originalRow.ledger_id, transactionId, JSON.stringify({ reason, reversalTransactionId: reversalTxn.id }), now]
      );

      return reversalTxn;
    });

    return ok(result);
  }

  // -------------------------------------------------------------------------
  // Balance calculation
  // -------------------------------------------------------------------------

  async getBalance(accountId: string, asOfDate?: string): Promise<Result<number>> {
    const accountRow = await this.db.get<AccountRow>("SELECT * FROM accounts WHERE id = ?", [accountId]);
    if (!accountRow) {
      return err(accountNotFoundError(accountId));
    }

    const balance = await this.computeBalance(accountId, accountRow.normal_balance as NormalBalance, asOfDate);
    return ok(balance);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async computeBalance(accountId: string, normalBalance: NormalBalance, asOfDate?: string): Promise<number> {
    // Include ALL transactions (posted and reversed) in balance calculation.
    // In double-entry accounting, the "reversed" status is informational.
    // The reversal creates a separate offsetting transaction, so both the
    // original and reversal lines are needed for an accurate balance.
    let sql: string;
    let params: unknown[];

    if (asOfDate) {
      sql = `SELECT
               COALESCE(SUM(CASE WHEN li.direction = 'debit' THEN li.amount ELSE 0 END), 0) -
               COALESCE(SUM(CASE WHEN li.direction = 'credit' THEN li.amount ELSE 0 END), 0) AS balance
             FROM line_items li
             JOIN transactions t ON t.id = li.transaction_id
             WHERE li.account_id = ? AND t.date <= ? AND t.status != 'pending'`;
      params = [accountId, asOfDate];
    } else {
      sql = `SELECT
               COALESCE(SUM(CASE WHEN li.direction = 'debit' THEN li.amount ELSE 0 END), 0) -
               COALESCE(SUM(CASE WHEN li.direction = 'credit' THEN li.amount ELSE 0 END), 0) AS balance
             FROM line_items li
             JOIN transactions t ON t.id = li.transaction_id
             WHERE li.account_id = ? AND t.status != 'pending'`;
      params = [accountId];
    }

    const row = await this.db.get<BalanceRow>(sql, params);
    const rawBalance = Number(row?.balance ?? 0);

    // For credit-normal accounts, invert the sign
    // Debit-normal: balance = debits - credits (positive = debit balance)
    // Credit-normal: balance = credits - debits (positive = credit balance)
    return normalBalance === "credit" ? -rawBalance : rawBalance;
  }

  /**
   * Compute balances for multiple accounts in a single query.
   * Avoids the N+1 problem when generating financial statements.
   */
  private async computeBalancesBatch(
    accountIds: string[],
    asOfDate?: string,
  ): Promise<Map<string, number>> {
    if (accountIds.length === 0) return new Map();

    const placeholders = accountIds.map(() => "?").join(", ");
    let sql: string;
    let params: unknown[];

    if (asOfDate) {
      sql = `SELECT li.account_id,
               COALESCE(SUM(CASE WHEN li.direction = 'debit' THEN li.amount ELSE 0 END), 0) -
               COALESCE(SUM(CASE WHEN li.direction = 'credit' THEN li.amount ELSE 0 END), 0) AS balance
             FROM line_items li
             JOIN transactions t ON t.id = li.transaction_id
             WHERE li.account_id IN (${placeholders}) AND t.date <= ? AND t.status != 'pending'
             GROUP BY li.account_id`;
      params = [...accountIds, asOfDate];
    } else {
      sql = `SELECT li.account_id,
               COALESCE(SUM(CASE WHEN li.direction = 'debit' THEN li.amount ELSE 0 END), 0) -
               COALESCE(SUM(CASE WHEN li.direction = 'credit' THEN li.amount ELSE 0 END), 0) AS balance
             FROM line_items li
             JOIN transactions t ON t.id = li.transaction_id
             WHERE li.account_id IN (${placeholders}) AND t.status != 'pending'
             GROUP BY li.account_id`;
      params = [...accountIds];
    }

    const rows = await this.db.all<{ account_id: string; balance: number | string }>(sql, params);
    const result = new Map<string, number>();
    for (const row of rows) {
      result.set(row.account_id, Number(row.balance));
    }
    return result;
  }

  /**
   * Compute period balances for multiple accounts in a single query.
   * Avoids the N+1 problem when generating income statements and cash flow.
   */
  private async computeBalancesInPeriodBatch(
    accountIds: string[],
    startDate: string,
    endDate: string,
  ): Promise<Map<string, number>> {
    if (accountIds.length === 0) return new Map();

    const placeholders = accountIds.map(() => "?").join(", ");
    const sql = `SELECT li.account_id,
                   COALESCE(SUM(CASE WHEN li.direction = 'debit' THEN li.amount ELSE 0 END), 0) -
                   COALESCE(SUM(CASE WHEN li.direction = 'credit' THEN li.amount ELSE 0 END), 0) AS balance
                 FROM line_items li
                 JOIN transactions t ON t.id = li.transaction_id
                 WHERE li.account_id IN (${placeholders}) AND t.date >= ? AND t.date <= ? AND t.status != 'pending'
                 GROUP BY li.account_id`;

    const rows = await this.db.all<{ account_id: string; balance: number | string }>(
      sql,
      [...accountIds, startDate, endDate],
    );
    const result = new Map<string, number>();
    for (const row of rows) {
      result.set(row.account_id, Number(row.balance));
    }
    return result;
  }

  /**
   * Get the signed balance for an account from a raw balance map.
   * Adjusts sign based on normal_balance (credit-normal accounts are inverted).
   */
  private getSignedBalance(rawBalances: Map<string, number>, accountId: string, normalBalance: NormalBalance): number {
    const rawBalance = rawBalances.get(accountId) ?? 0;
    return normalBalance === "credit" ? -rawBalance : rawBalance;
  }

  /**
   * Fetch line items for multiple transactions in a single query.
   * Returns a map of transaction_id -> LineItem[].
   * Avoids the N+1 problem when listing transactions.
   */
  private async fetchLineItemsBatch(transactionIds: string[]): Promise<Map<string, LineItem[]>> {
    if (transactionIds.length === 0) return new Map();

    const placeholders = transactionIds.map(() => "?").join(", ");
    const rows = await this.db.all<LineItemRow>(
      `SELECT * FROM line_items WHERE transaction_id IN (${placeholders}) ORDER BY transaction_id, created_at`,
      transactionIds,
    );

    const result = new Map<string, LineItem[]>();
    for (const row of rows) {
      const txnId = row.transaction_id;
      if (!result.has(txnId)) {
        result.set(txnId, []);
      }
      result.get(txnId)!.push(toLineItem(row));
    }
    return result;
  }

  private async getAccountCodeById(accountId: string): Promise<string> {
    const row = await this.db.get<Pick<AccountRow, "code">>("SELECT code FROM accounts WHERE id = ?", [accountId]);
    if (!row) {
      throw new Error(`Account not found: ${accountId}`);
    }
    return row.code;
  }

  // -------------------------------------------------------------------------
  // API Key management
  // -------------------------------------------------------------------------

  async createApiKey(params: CreateApiKeyParams): Promise<Result<{ apiKey: ApiKey; rawKey: string }>> {
    if (!params.name || params.name.length === 0) {
      return err(createError(ErrorCode.VALIDATION_ERROR, "API key name is required"));
    }

    // Verify ledger exists
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [params.ledgerId]);
    if (!ledger) {
      return err(ledgerNotFoundError(params.ledgerId));
    }

    // Generate raw key: kounta_live_ + 24 random bytes (48 hex chars)
    const secret = randomBytes(24).toString("hex");
    const rawKey = `kounta_live_${secret}`;
    const keyHash = hashApiKey(rawKey);
    const prefix = `kounta_live_${secret.slice(0, 8)}`;

    const id = generateId();
    const now = nowUtc();

    // Ensure the user exists (auto-create for admin/system callers)
    const existingUser = await this.db.get("SELECT id FROM users WHERE id = ?", [params.userId]);
    if (!existingUser) {
      await this.db.run(
        "INSERT INTO users (id, email, name, auth_provider, auth_provider_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [params.userId, `user-${params.userId.substring(0, 8)}@kounta.internal`, "Auto-created User", "system", params.userId, now, now]
      );
    }

    await this.db.run(
      `INSERT INTO api_keys (id, user_id, ledger_id, key_hash, prefix, name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [id, params.userId, params.ledgerId, keyHash, prefix, params.name, now, now]
    );

    const row = await this.db.get<ApiKeyRow>("SELECT * FROM api_keys WHERE id = ?", [id]);
    if (!row) {
      return err(createError(ErrorCode.INTERNAL_ERROR, "Failed to create API key"));
    }

    return ok({ apiKey: toApiKey(row), rawKey });
  }

  async validateApiKey(rawKey: string): Promise<Result<ApiKey>> {
    if (!rawKey.startsWith("kounta_live_") && !rawKey.startsWith("kounta_test_")) {
      return err(createError(ErrorCode.UNAUTHORIZED, "Invalid API key format"));
    }

    const keyHash = hashApiKey(rawKey);
    const row = await this.db.get<ApiKeyRow>(
      "SELECT * FROM api_keys WHERE key_hash = ? AND status = 'active'",
      [keyHash]
    );

    if (!row) {
      return err(createError(ErrorCode.UNAUTHORIZED, "Invalid or revoked API key"));
    }

    // Update last_used_at
    await this.db.run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", [nowUtc(), row.id]);

    return ok(toApiKey(row));
  }

  async listApiKeys(ledgerId: string): Promise<Result<ApiKey[]>> {
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) {
      return err(ledgerNotFoundError(ledgerId));
    }

    const rows = await this.db.all<ApiKeyRow>(
      "SELECT * FROM api_keys WHERE ledger_id = ? ORDER BY created_at DESC",
      [ledgerId]
    );

    return ok(rows.map(toApiKey));
  }

  async revokeApiKey(keyId: string): Promise<Result<ApiKey>> {
    const row = await this.db.get<ApiKeyRow>("SELECT * FROM api_keys WHERE id = ?", [keyId]);
    if (!row) {
      return err(apiKeyNotFoundError(keyId));
    }

    await this.db.run("UPDATE api_keys SET status = 'revoked' WHERE id = ?", [keyId]);

    const updated = await this.db.get<ApiKeyRow>("SELECT * FROM api_keys WHERE id = ?", [keyId]);

    const auditId = generateId();
    await this.db.run(
      `INSERT INTO audit_entries (id, ledger_id, entity_type, entity_id, action, actor_type, actor_id, snapshot, created_at)
       VALUES (?, ?, 'api_key', ?, 'revoked', 'system', 'engine', ?, ?)`,
      [auditId, row.ledger_id, keyId, JSON.stringify(toApiKey(updated!)), new Date().toISOString()]
    );

    return ok(toApiKey(updated!));
  }

  // -------------------------------------------------------------------------
  // Ledger lifecycle
  // -------------------------------------------------------------------------

  async softDeleteLedger(ledgerId: string, userId: string): Promise<Result<{ id: string; status: string }>> {
    const ledgerResult = await this.getLedger(ledgerId);
    if (!ledgerResult.ok) return ledgerResult;

    if (ledgerResult.value.ownerId !== userId) {
      return err(createError(ErrorCode.FORBIDDEN, "User does not own this ledger"));
    }

    const ledgersResult = await this.findLedgersByOwner(userId);
    if (ledgersResult.ok && ledgersResult.value.length <= 1) {
      return err(createError(ErrorCode.VALIDATION_ERROR, "Cannot delete your only ledger"));
    }

    const now = new Date().toISOString();
    await this.db.run("UPDATE ledgers SET status = 'deleted', updated_at = ? WHERE id = ?", [now, ledgerId]);

    const keysResult = await this.listApiKeys(ledgerId);
    if (keysResult.ok) {
      for (const key of keysResult.value) {
        if (key.status === "active") {
          await this.revokeApiKey(key.id);
        }
      }
    }

    const auditId = generateId();
    await this.db.run(
      `INSERT INTO audit_entries (id, ledger_id, entity_type, entity_id, action, actor_type, actor_id, snapshot, created_at)
       VALUES (?, ?, 'ledger', ?, 'deleted', 'user', ?, ?, ?)`,
      [auditId, ledgerId, ledgerId, userId, JSON.stringify({ id: ledgerId, status: "deleted" }), now]
    );

    return ok({ id: ledgerId, status: "deleted" });
  }

  // -------------------------------------------------------------------------
  // Jurisdiction
  // -------------------------------------------------------------------------

  async getLedgerJurisdiction(ledgerId: string): Promise<Result<{ jurisdiction: string; taxId: string | null; taxBasis: string; fiscalYearStart: number }>> {
    const row = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!row) return err(ledgerNotFoundError(ledgerId));

    return ok({
      jurisdiction: row.jurisdiction ?? "AU",
      taxId: row.tax_id ?? null,
      taxBasis: row.tax_basis ?? "accrual",
      fiscalYearStart: row.fiscal_year_start,
    });
  }

  async updateLedgerJurisdiction(
    ledgerId: string,
    updates: { jurisdiction?: string; taxId?: string | null; taxBasis?: string },
  ): Promise<Result<{ jurisdiction: string; taxId: string | null; taxBasis: string }>> {
    const row = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!row) return err(ledgerNotFoundError(ledgerId));

    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.jurisdiction !== undefined) {
      sets.push("jurisdiction = ?");
      params.push(updates.jurisdiction);
    }
    if (updates.taxId !== undefined) {
      sets.push("tax_id = ?");
      params.push(updates.taxId);
    }
    if (updates.taxBasis !== undefined) {
      sets.push("tax_basis = ?");
      params.push(updates.taxBasis);
    }

    if (sets.length === 0) {
      return err(createError(ErrorCode.VALIDATION_ERROR, "No fields to update"));
    }

    sets.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(ledgerId);

    await this.db.run(`UPDATE ledgers SET ${sets.join(", ")} WHERE id = ?`, params);

    const updated = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    return ok({
      jurisdiction: updated?.jurisdiction ?? "AU",
      taxId: updated?.tax_id ?? null,
      taxBasis: updated?.tax_basis ?? "accrual",
    });
  }

  // -------------------------------------------------------------------------
  // Invoice mutations (extracted from routes)
  // -------------------------------------------------------------------------

  async markInvoiceSent(invoiceId: string, alsoUpgradeStatus: boolean): Promise<Result<void>> {
    const statusUpdate = alsoUpgradeStatus ? ", status = 'sent'" : "";
    await this.db.run(
      `UPDATE invoices SET sent_at = datetime('now'), updated_at = datetime('now')${statusUpdate} WHERE id = ?`,
      [invoiceId],
    );
    return ok(undefined);
  }

  async deleteInvoiceDraft(invoiceId: string, ledgerId: string): Promise<Result<{ deleted: boolean; id: string }>> {
    const existing = await this.db.get<{ ledger_id: string; status: string }>(
      "SELECT ledger_id, status FROM invoices WHERE id = ?",
      [invoiceId],
    );
    if (!existing || existing.ledger_id !== ledgerId) {
      return err(createError(ErrorCode.INVOICE_NOT_FOUND, `Invoice not found: ${invoiceId}`));
    }
    if (existing.status !== "draft") {
      return err(createError(ErrorCode.VALIDATION_ERROR, "Only draft invoices can be deleted"));
    }

    await this.db.run("DELETE FROM invoice_line_items WHERE invoice_id = ?", [invoiceId]);
    await this.db.run("DELETE FROM invoices WHERE id = ?", [invoiceId]);

    return ok({ deleted: true, id: invoiceId });
  }

  // -------------------------------------------------------------------------
  // Invoice wrappers (delegate to standalone functions with this.db)
  // -------------------------------------------------------------------------

  async listInvoices(ledgerId: string, filters?: { status?: string; customerName?: string; customerId?: string; dateFrom?: string; dateTo?: string; cursor?: string; limit?: number }) {
    return listInvoicesFn(this.db, ledgerId, filters);
  }

  async getInvoiceSummary(ledgerId: string) {
    return getInvoiceSummaryFn(this.db, ledgerId);
  }

  async getARAging(ledgerId: string) {
    return getARAgingFn(this.db, ledgerId);
  }

  async getInvoice(invoiceId: string) {
    return getInvoiceFn(this.db, invoiceId);
  }

  async createInvoice(ledgerId: string, userId: string, input: CreateInvoiceInput) {
    return createInvoiceFn(this.db, ledgerId, userId, input);
  }

  async updateInvoice(invoiceId: string, input: UpdateInvoiceInput) {
    return updateInvoiceFn(this.db, invoiceId, input);
  }

  async sendInvoice(invoiceId: string, ledgerId: string, userId: string, options?: { sendEmail?: boolean }) {
    return sendInvoiceFn(this.db, this as LedgerEngine, invoiceId, ledgerId, userId, options);
  }

  async recordInvoicePayment(invoiceId: string, ledgerId: string, userId: string, input: RecordPaymentInput) {
    return recordPaymentFn(this.db, this as LedgerEngine, invoiceId, ledgerId, userId, input);
  }

  async voidInvoice(invoiceId: string, ledgerId: string, userId: string) {
    return voidInvoiceFn(this.db, this as LedgerEngine, invoiceId, ledgerId, userId);
  }

  async getLedgerBusinessInfo(ledgerId: string): Promise<Result<{
    name: string; jurisdiction: string; currency: string;
    businessName: string | null; businessAddress: string | null;
    businessEmail: string | null; businessPhone: string | null;
    taxId: string | null;
  }>> {
    const row = await this.db.get<{
      name: string; jurisdiction: string; currency: string;
      business_name: string | null; business_address: string | null;
      business_email: string | null; business_phone: string | null;
      tax_id: string | null;
    }>(
      "SELECT name, jurisdiction, currency, business_name, business_address, business_email, business_phone, tax_id FROM ledgers WHERE id = ?",
      [ledgerId],
    );
    if (!row) return err(ledgerNotFoundError(ledgerId));
    return ok({
      name: row.name,
      jurisdiction: row.jurisdiction ?? "AU",
      currency: row.currency,
      businessName: row.business_name,
      businessAddress: row.business_address,
      businessEmail: row.business_email,
      businessPhone: row.business_phone,
      taxId: row.tax_id,
    });
  }

  async verifyInvoiceBelongsToLedger(invoiceId: string, ledgerId: string): Promise<boolean> {
    const row = await this.db.get<{ ledger_id: string }>(
      "SELECT ledger_id FROM invoices WHERE id = ?",
      [invoiceId],
    );
    return !!row && row.ledger_id === ledgerId;
  }

  async sendEmailLog(userId: string, to: string, subject: string, html: string, emailType: string, metadata?: Record<string, unknown>) {
    return sendEmailFn(this.db, userId, to, subject, html, emailType, metadata);
  }

  // -------------------------------------------------------------------------
  // Fixed asset wrappers (delegate to standalone functions with this.db)
  // -------------------------------------------------------------------------

  async listFixedAssets(ledgerId: string, opts?: { status?: string; cursor?: string; limit?: number }) {
    return listFixedAssetsFn(this.db, ledgerId, opts);
  }

  async getFixedAsset(assetId: string) {
    return getFixedAssetFn(this.db, assetId);
  }

  async createFixedAsset(input: CreateFixedAssetInput) {
    return createFixedAssetFn(this.db, input);
  }

  async updateFixedAsset(assetId: string, input: UpdateFixedAssetInput) {
    return updateFixedAssetFn(this.db, assetId, input);
  }

  async getAssetSchedule(assetId: string) {
    return getAssetScheduleFn(this.db, assetId);
  }

  async getPendingDepreciation(ledgerId: string, asOfDate?: string) {
    return getPendingDepreciationFn(this.db, ledgerId, asOfDate);
  }

  async runDepreciation(ledgerId: string, asOfDate?: string) {
    return runDepreciationFn(this.db, this as LedgerEngine, ledgerId, asOfDate);
  }

  async getAssetSummary(ledgerId: string) {
    return getAssetSummaryFn(this.db, ledgerId);
  }

  async disposeFixedAsset(assetId: string, input: DisposeAssetInput) {
    return disposeFixedAssetFn(this.db, this as LedgerEngine, assetId, input);
  }

  async verifyFixedAssetBelongsToLedger(assetId: string, ledgerId: string): Promise<boolean> {
    const row = await this.db.get<{ ledger_id: string }>(
      "SELECT ledger_id FROM fixed_assets WHERE id = ?",
      [assetId],
    );
    return !!row && row.ledger_id === ledgerId;
  }

  // -------------------------------------------------------------------------
  // Bill wrappers (delegate to standalone functions with this.db)
  // -------------------------------------------------------------------------

  async listBills(ledgerId: string, filters?: { status?: string; vendorName?: string; vendorId?: string; dateFrom?: string; dateTo?: string; cursor?: string; limit?: number }) {
    return listBillsFn(this.db, ledgerId, filters);
  }

  async getBill(billId: string) {
    return getBillFn(this.db, billId);
  }

  async createBill(ledgerId: string, userId: string, input: CreateBillInput) {
    return createBillFn(this.db, ledgerId, userId, input);
  }

  async updateBill(billId: string, input: UpdateBillInput) {
    return updateBillFn(this.db, billId, input);
  }

  async approveBill(billId: string, ledgerId: string, userId: string) {
    return approveBillFn(this.db, this as LedgerEngine, billId, ledgerId, userId);
  }

  async recordBillPayment(billId: string, ledgerId: string, userId: string, input: RecordBillPaymentInput) {
    return recordBillPaymentFn(this.db, this as LedgerEngine, billId, ledgerId, userId, input);
  }

  async voidBill(billId: string, ledgerId: string, userId: string) {
    return voidBillFn(this.db, this as LedgerEngine, billId, ledgerId, userId);
  }

  async deleteBillDraft(billId: string, ledgerId: string) {
    const existing = await this.db.get<{ ledger_id: string; status: string }>(
      "SELECT ledger_id, status FROM bills WHERE id = ?",
      [billId],
    );
    if (!existing || existing.ledger_id !== ledgerId) {
      return err(createError(ErrorCode.BILL_NOT_FOUND, `Bill not found: ${billId}`));
    }
    if (existing.status !== "draft") {
      return err(createError(ErrorCode.VALIDATION_ERROR, "Only draft bills can be deleted"));
    }

    await this.db.run("DELETE FROM bill_line_items WHERE bill_id = ?", [billId]);
    await this.db.run("DELETE FROM bill_payments WHERE bill_id = ?", [billId]);
    await this.db.run("DELETE FROM bills WHERE id = ?", [billId]);

    return ok({ deleted: true, id: billId });
  }

  async verifyBillBelongsToLedger(billId: string, ledgerId: string): Promise<boolean> {
    const row = await this.db.get<{ ledger_id: string }>(
      "SELECT ledger_id FROM bills WHERE id = ?",
      [billId],
    );
    return !!row && row.ledger_id === ledgerId;
  }

  async getBillSummary(ledgerId: string) {
    return getBillSummaryFn(this.db, ledgerId);
  }

  async getAPAging(ledgerId: string) {
    return getAPAgingFn(this.db, ledgerId);
  }

  // -------------------------------------------------------------------------
  // Vendor wrappers (delegate to standalone functions with this.db)
  // -------------------------------------------------------------------------

  async listVendors(ledgerId: string, filters?: { search?: string; isActive?: boolean; cursor?: string; limit?: number }) {
    return listVendorsFn(this.db, ledgerId, filters);
  }

  async createVendor(ledgerId: string, input: CreateVendorInput) {
    return createVendorFn(this.db, ledgerId, input);
  }

  async getVendor(vendorId: string) {
    return getVendorFn(this.db, vendorId);
  }

  async updateVendor(vendorId: string, input: UpdateVendorInput) {
    return updateVendorFn(this.db, vendorId, input);
  }

  async deleteVendor(vendorId: string) {
    return deleteVendorFn(this.db, vendorId);
  }

  // -------------------------------------------------------------------------
  // Stripe wrappers (delegate to standalone functions with this.db)
  // -------------------------------------------------------------------------

  async getStripeConnectionByLedger(ledgerId: string) {
    return getConnectionByLedgerFn(this.db, ledgerId);
  }

  async getStripeConnectionByAccountId(accountId: string): Promise<{ id: string; webhookSecret: string | null; ledgerId: string } | null> {
    const row = await this.db.get<{ id: string; webhook_secret: string | null; ledger_id: string }>(
      "SELECT id, webhook_secret, ledger_id FROM stripe_connections WHERE stripe_account_id = ? AND status = 'active'",
      [accountId],
    );
    return row ? { id: row.id, webhookSecret: row.webhook_secret, ledgerId: row.ledger_id } : null;
  }

  async createStripeConnection(input: CreateStripeConnectionInput) {
    return createConnectionFn(this.db, input);
  }

  async disconnectStripeConnection(connectionId: string) {
    return disconnectConnectionFn(this.db, connectionId);
  }

  async ensureStripeAccounts(ledgerId: string) {
    return ensureStripeAccountsFn(this.db, this as LedgerEngine, ledgerId);
  }

  async handleStripeEvent(connection: StripeConnection, event: Parameters<typeof handleEventFn>[3]) {
    return handleEventFn(this.db, this as LedgerEngine, connection, event);
  }

  async backfillStripe(connection: StripeConnection, days?: number) {
    return backfillAllFn(this.db, this as LedgerEngine, connection, days);
  }

  async completeOnboardingItem(userId: string, item: string): Promise<void> {
    try {
      await this.db.run(
        "UPDATE onboarding_checklist SET completed = 1, completed_at = datetime('now') WHERE user_id = ? AND item = ? AND completed = 0",
        [userId, item],
      );
    } catch {
      // Onboarding table may not exist — that's fine
    }
  }

  // -------------------------------------------------------------------------
  // Tier / usage wrappers (delegate to standalone functions with this.db)
  // -------------------------------------------------------------------------

  async getUsageSummary(userId: string) {
    return getUsageSummaryFn(this.db, userId);
  }

  async checkLimit(userId: string, ledgerId: string | undefined, resource: string) {
    return checkLimitFn(this.db, userId, ledgerId, resource);
  }

  async incrementTierUsage(userId: string, ledgerId: string | undefined, field: string) {
    return incrementUsageFn(this.db, userId, ledgerId, field as Parameters<typeof incrementUsageFn>[3]);
  }

  async getUsageHistory(userId: string) {
    const rows = await this.db.all<{
      period_start: string; period_end: string; ledger_id: string | null;
      transactions_count: number; invoices_count: number; customers_count: number; fixed_assets_count: number;
    }>(
      "SELECT period_start, period_end, ledger_id, transactions_count, invoices_count, customers_count, fixed_assets_count FROM usage_tracking WHERE user_id = ? ORDER BY period_start DESC LIMIT 120",
      [userId],
    );

    const periods = new Map<string, { periodStart: string; periodEnd: string; transactions: number; invoices: number; customers: number; fixedAssets: number }>();
    for (const row of rows) {
      const existing = periods.get(row.period_start);
      if (existing) {
        existing.transactions += row.transactions_count;
        existing.invoices += row.invoices_count;
        existing.customers += row.customers_count;
        existing.fixedAssets += row.fixed_assets_count;
      } else {
        periods.set(row.period_start, {
          periodStart: row.period_start, periodEnd: row.period_end,
          transactions: row.transactions_count, invoices: row.invoices_count,
          customers: row.customers_count, fixedAssets: row.fixed_assets_count,
        });
      }
    }
    return Array.from(periods.values()).slice(0, 12);
  }

  // -------------------------------------------------------------------------
  // Misc helpers
  // -------------------------------------------------------------------------

  async isRecurringTransaction(transactionId: string): Promise<boolean> {
    const row = await this.db.get<{ id: string }>(
      "SELECT id FROM recurring_entry_log WHERE transaction_id = ? LIMIT 1",
      [transactionId],
    );
    return !!row;
  }

  // -------------------------------------------------------------------------
  // Audit log
  // -------------------------------------------------------------------------

  async listAuditEntries(
    ledgerId: string,
    params?: { cursor?: string; limit?: number }
  ): Promise<Result<{ data: AuditEntry[]; nextCursor: string | null }>> {
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) {
      return err(ledgerNotFoundError(ledgerId));
    }

    const limit = Math.min(params?.limit ?? 50, 200);
    let rows: AuditEntryRow[];

    if (params?.cursor) {
      rows = await this.db.all<AuditEntryRow>(
        "SELECT * FROM audit_entries WHERE ledger_id = ? AND id > ? ORDER BY id LIMIT ?",
        [ledgerId, params.cursor, limit + 1]
      );
    } else {
      rows = await this.db.all<AuditEntryRow>(
        "SELECT * FROM audit_entries WHERE ledger_id = ? ORDER BY id LIMIT ?",
        [ledgerId, limit + 1]
      );
    }

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? pageRows[pageRows.length - 1]!.id : null;

    return ok({ data: pageRows.map(toAuditEntry), nextCursor });
  }

  // -------------------------------------------------------------------------
  // Template application
  // -------------------------------------------------------------------------

  async applyTemplate(ledgerId: string, templateSlug: string): Promise<Result<Account[]>> {
    const template = getTemplate(templateSlug);
    if (!template) {
      return err(createError(ErrorCode.TEMPLATE_NOT_FOUND, `Template not found: ${templateSlug}`));
    }

    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) {
      return err(ledgerNotFoundError(ledgerId));
    }

    const accounts = await this.db.transaction(async () => {
      // Ensure the template row exists in the templates table (FK target)
      const existingTpl = await this.db.get<{ id: string }>(
        "SELECT id FROM templates WHERE id = ?",
        [template.id],
      );
      if (!existingTpl) {
        const now = nowUtc();
        await this.db.run(
          `INSERT INTO templates (id, slug, name, description, business_type, chart_of_accounts, default_currency, default_basis, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            template.id,
            template.slug,
            template.name,
            template.description,
            template.businessType,
            JSON.stringify(template.chartOfAccounts),
            template.defaultCurrency,
            template.defaultBasis,
            template.metadata ? JSON.stringify(template.metadata) : null,
            now,
            now,
          ],
        );
      }

      const created: Account[] = [];

      for (const ta of template.chartOfAccounts) {
        const id = generateId();
        const now = nowUtc();
        const metadata = ta.tags?.length ? JSON.stringify({ tags: [...ta.tags] }) : null;

        // Resolve parent if specified
        let parentId: string | null = null;
        if (ta.parentCode) {
          const parent = await this.db.get<AccountRow>(
            "SELECT id FROM accounts WHERE ledger_id = ? AND code = ?",
            [ledgerId, ta.parentCode],
          );
          if (parent) parentId = parent.id;
        }

        await this.db.run(
          `INSERT INTO accounts (id, ledger_id, parent_id, code, name, type, normal_balance, is_system, metadata, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
          [id, ledgerId, parentId, ta.code, ta.name, ta.type, ta.normalBalance, ta.isSystem ? true : false, metadata, now, now],
        );

        const row = await this.db.get<AccountRow>("SELECT * FROM accounts WHERE id = ?", [id]);
        if (row) created.push(toAccount(row));
      }

      // Link template to ledger
      await this.db.run(
        "UPDATE ledgers SET template_id = ?, updated_at = ? WHERE id = ?",
        [template.id, nowUtc(), ledgerId],
      );

      return created;
    });

    return ok(accounts);
  }

  // -------------------------------------------------------------------------
  // Financial statements
  // -------------------------------------------------------------------------

  async generateIncomeStatement(
    ledgerId: string,
    startDate: string,
    endDate: string,
  ): Promise<Result<StatementResponse>> {
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) return err(ledgerNotFoundError(ledgerId));

    const rows = await this.db.all<AccountRow>(
      "SELECT * FROM accounts WHERE ledger_id = ? AND type IN ('revenue', 'expense') AND status = 'active' ORDER BY code",
      [ledgerId],
    );

    // Batch compute all period balances in a single query (avoids N+1)
    const rawBalances = await this.computeBalancesInPeriodBatch(
      rows.map((r) => r.id),
      startDate,
      endDate,
    );

    const accounts: AccountBalanceData[] = rows.map((row) => ({
      code: row.code,
      name: row.name,
      type: row.type as AccountType,
      normalBalance: row.normal_balance as NormalBalance,
      balance: this.getSignedBalance(rawBalances, row.id, row.normal_balance as NormalBalance),
      priorBalance: null,
      metadata: row.metadata ? (parseJsonb(row.metadata) as Record<string, unknown>) : null,
    }));

    // Check for deferred revenue activity during this period
    const notes: string[] = [];
    try {
      const deferredActivity = await this.db.get<{ total: number | null }>(
        `SELECT SUM(e.amount) AS total
         FROM revenue_schedule_entries e
         JOIN revenue_schedules s ON e.schedule_id = s.id
         WHERE e.ledger_id = ? AND e.status = 'posted'
           AND e.posted_at >= ? AND e.posted_at <= ?`,
        [ledgerId, `${startDate}T00:00:00`, `${endDate}T23:59:59`],
      );
      const recognised = Number(deferredActivity?.total ?? 0);
      if (recognised > 0) {
        const dollars = (recognised / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        notes.push(`Includes $${dollars} of deferred revenue recognised this period`);
      }
    } catch {
      // revenue_schedule_entries table may not exist — skip
    }

    return ok(
      buildIncomeStatement(accounts, { start: startDate, end: endDate }, ledger.currency, ledgerId, notes),
    );
  }

  async generateBalanceSheet(
    ledgerId: string,
    asOfDate: string,
  ): Promise<Result<StatementResponse>> {
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) return err(ledgerNotFoundError(ledgerId));

    // Balance sheet accounts
    const bsRows = await this.db.all<AccountRow>(
      "SELECT * FROM accounts WHERE ledger_id = ? AND type IN ('asset', 'liability', 'equity') AND status = 'active' ORDER BY code",
      [ledgerId],
    );

    // Revenue and expense accounts for net income calculation
    const revenueRows = await this.db.all<AccountRow>(
      "SELECT * FROM accounts WHERE ledger_id = ? AND type = 'revenue' AND status = 'active'",
      [ledgerId],
    );
    const expenseRows = await this.db.all<AccountRow>(
      "SELECT * FROM accounts WHERE ledger_id = ? AND type = 'expense' AND status = 'active'",
      [ledgerId],
    );

    // Batch compute ALL balances in a single query (avoids N+1 for BS + P&L accounts)
    const allAccountIds = [
      ...bsRows.map((r) => r.id),
      ...revenueRows.map((r) => r.id),
      ...expenseRows.map((r) => r.id),
    ];
    const rawBalances = await this.computeBalancesBatch(allAccountIds, asOfDate);

    const accounts: AccountBalanceData[] = bsRows.map((row) => ({
      code: row.code,
      name: row.name,
      type: row.type as AccountType,
      normalBalance: row.normal_balance as NormalBalance,
      balance: this.getSignedBalance(rawBalances, row.id, row.normal_balance as NormalBalance),
      priorBalance: null,
      metadata: row.metadata ? (parseJsonb(row.metadata) as Record<string, unknown>) : null,
    }));

    // Compute net income from batched balances
    let totalRevenue = 0;
    for (const r of revenueRows) {
      totalRevenue += this.getSignedBalance(rawBalances, r.id, r.normal_balance as NormalBalance);
    }
    let totalExpenses = 0;
    for (const r of expenseRows) {
      totalExpenses += this.getSignedBalance(rawBalances, r.id, r.normal_balance as NormalBalance);
    }
    const netIncome = totalRevenue - totalExpenses;

    return ok(
      buildBalanceSheet(accounts, asOfDate, ledger.currency, ledgerId, netIncome, null),
    );
  }

  async generateCashFlow(
    ledgerId: string,
    startDate: string,
    endDate: string,
  ): Promise<Result<StatementResponse>> {
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) return err(ledgerNotFoundError(ledgerId));

    // Compute net income for the period
    const revenueRows = await this.db.all<AccountRow>(
      "SELECT * FROM accounts WHERE ledger_id = ? AND type = 'revenue' AND status = 'active'",
      [ledgerId],
    );
    const expenseRows = await this.db.all<AccountRow>(
      "SELECT * FROM accounts WHERE ledger_id = ? AND type = 'expense' AND status = 'active'",
      [ledgerId],
    );

    // Balance sheet accounts with period deltas
    const bsRows = await this.db.all<AccountRow>(
      "SELECT * FROM accounts WHERE ledger_id = ? AND type IN ('asset', 'liability', 'equity') AND status = 'active' ORDER BY code",
      [ledgerId],
    );

    const dayBeforeStart = dayBefore(startDate);

    // Batch compute ALL balances in parallel-safe queries (avoids N+1)
    const plAccountIds = [...revenueRows.map((r) => r.id), ...expenseRows.map((r) => r.id)];
    const bsAccountIds = bsRows.map((r) => r.id);
    const allAccountIds = [...plAccountIds, ...bsAccountIds];

    const [periodBalances, endBalances, startBalances] = await Promise.all([
      this.computeBalancesInPeriodBatch(plAccountIds, startDate, endDate),
      this.computeBalancesBatch(allAccountIds, endDate),
      this.computeBalancesBatch(bsAccountIds, dayBeforeStart),
    ]);

    let periodRevenue = 0;
    for (const r of revenueRows) {
      periodRevenue += this.getSignedBalance(periodBalances, r.id, r.normal_balance as NormalBalance);
    }
    let periodExpenses = 0;
    for (const r of expenseRows) {
      periodExpenses += this.getSignedBalance(periodBalances, r.id, r.normal_balance as NormalBalance);
    }
    const netIncome = periodRevenue - periodExpenses;

    const accounts: CashFlowAccountData[] = bsRows.map((row) => {
      const nb = row.normal_balance as NormalBalance;
      const endBalance = this.getSignedBalance(endBalances, row.id, nb);
      const startBalance = this.getSignedBalance(startBalances, row.id, nb);
      return {
        code: row.code,
        name: row.name,
        type: row.type as AccountType,
        normalBalance: nb,
        balance: endBalance,
        priorBalance: null,
        metadata: row.metadata ? (parseJsonb(row.metadata) as Record<string, unknown>) : null,
        delta: endBalance - startBalance,
      };
    });

    return ok(
      buildCashFlowStatement(accounts, netIncome, { start: startDate, end: endDate }, ledger.currency, ledgerId),
    );
  }

  // -------------------------------------------------------------------------
  // Import operations
  // -------------------------------------------------------------------------

  async createImport(params: {
    ledgerId: string;
    fileContent: string;
    fileType: "csv" | "ofx";
    filename?: string;
  }): Promise<Result<{ batch: ImportBatch; rows: ImportRow[] }>> {
    const parsed = createImportSchema.safeParse(params);
    if (!parsed.success) {
      return err(createError(ErrorCode.VALIDATION_ERROR, parsed.error.message));
    }

    // Verify ledger exists
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [params.ledgerId]);
    if (!ledger) {
      return err(ledgerNotFoundError(params.ledgerId));
    }

    // Parse the file
    let parsedRows;
    try {
      parsedRows = params.fileType === "csv"
        ? parseCSV(params.fileContent)
        : parseOFX(params.fileContent);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to parse import file";
      return err(importParseError(message));
    }

    // Read match config from ledger's business_context
    const businessContext = ledger.business_context
      ? (parseJsonb(ledger.business_context) as Record<string, unknown>)
      : null;
    const importConfig = businessContext?.importConfig as Partial<MatchConfig> | undefined;
    const config: MatchConfig = {
      autoMatchThreshold: importConfig?.autoMatchThreshold ?? DEFAULT_MATCH_CONFIG.autoMatchThreshold,
      suggestThreshold: importConfig?.suggestThreshold ?? DEFAULT_MATCH_CONFIG.suggestThreshold,
    };

    // Determine a reasonable matching window based on import data dates.
    // Fall back to 1 year before the earliest row date to keep the dataset bounded.
    let earliestDate: string | null = null;
    for (const row of parsedRows) {
      if (!earliestDate || row.date < earliestDate) {
        earliestDate = row.date;
      }
    }
    const matchWindowDate = earliestDate
      ? (() => { const d = new Date(earliestDate + "T00:00:00Z"); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); })()
      : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const txnRows = await this.db.all<TransactionRow>(
      "SELECT id, ledger_id, idempotency_key, date, effective_date, memo, status, source_type, source_ref, agent_id, metadata, posted_at, created_at, updated_at FROM transactions WHERE ledger_id = ? AND status = 'posted' AND date >= ? ORDER BY date DESC",
      [params.ledgerId, matchWindowDate],
    );

    // Batch fetch all line items in a single query (avoids N+1)
    const lineItemsMap = await this.fetchLineItemsBatch(txnRows.map((r) => r.id));

    const existingTransactions: TransactionWithLines[] = txnRows.map((txnRow) => ({
      ...toTransaction(txnRow),
      lines: lineItemsMap.get(txnRow.id) ?? [],
    } as TransactionWithLines));

    // Run matching
    const matchResults = matchRows(parsedRows, existingTransactions, config);

    // Persist everything in a DB transaction
    const result = await this.db.transaction(async () => {
      const batchId = generateId();
      const now = nowUtc();
      const filename = params.filename ?? `import_${now.replace(/[^0-9]/g, "")}.${params.fileType}`;

      // Count by status
      let matchedCount = 0;
      let unmatchedCount = 0;
      for (const mr of matchResults) {
        if (mr.matchStatus === "matched") matchedCount++;
        else if (mr.matchStatus === "unmatched") unmatchedCount++;
      }
      const suggestedCount = matchResults.length - matchedCount - unmatchedCount;

      await this.db.run(
        `INSERT INTO import_batches (id, ledger_id, source_type, filename, row_count, matched_count, unmatched_count, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'complete', ?, ?)`,
        [batchId, params.ledgerId, params.fileType, filename, parsedRows.length, matchedCount, unmatchedCount + suggestedCount, now, now],
      );

      // Insert import rows
      const importRows: ImportRow[] = [];
      for (let i = 0; i < parsedRows.length; i++) {
        const row = parsedRows[i]!;
        const mr = matchResults[i]!;
        const rowId = generateId();

        await this.db.run(
          `INSERT INTO import_rows (id, batch_id, date, amount, payee, memo, raw_data, match_status, matched_transaction_id, confidence, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            rowId, batchId, row.date, row.amount, row.payee, row.memo,
            JSON.stringify(row.rawData), mr.matchStatus,
            mr.transactionId, mr.confidence, now, now,
          ],
        );

        const importRowRow = (await this.db.get<ImportRowRow>("SELECT * FROM import_rows WHERE id = ?", [rowId]))!;
        importRows.push(toImportRow(importRowRow));
      }

      // Audit entry
      const auditId = generateId();
      await this.db.run(
        `INSERT INTO audit_entries (id, ledger_id, entity_type, entity_id, action, actor_type, actor_id, snapshot, created_at)
         VALUES (?, ?, 'import_batch', ?, 'created', 'system', 'engine', ?, ?)`,
        [auditId, params.ledgerId, batchId, JSON.stringify({ fileType: params.fileType, rowCount: parsedRows.length, matchedCount }), now],
      );

      const batchRow = (await this.db.get<ImportBatchRow>("SELECT * FROM import_batches WHERE id = ?", [batchId]))!;
      return { batch: toImportBatch(batchRow), rows: importRows };
    });

    return ok(result);
  }

  async getImportBatch(batchId: string): Promise<Result<{ batch: ImportBatch; rows: ImportRow[] }>> {
    const batchRow = await this.db.get<ImportBatchRow>("SELECT * FROM import_batches WHERE id = ?", [batchId]);
    if (!batchRow) {
      return err(importNotFoundError(batchId));
    }

    const rowRows = await this.db.all<ImportRowRow>(
      "SELECT * FROM import_rows WHERE batch_id = ? ORDER BY date, created_at",
      [batchId],
    );

    return ok({
      batch: toImportBatch(batchRow),
      rows: rowRows.map(toImportRow),
    });
  }

  async listImportBatches(
    ledgerId: string,
    params?: { cursor?: string; limit?: number },
  ): Promise<Result<{ data: ImportBatch[]; nextCursor: string | null }>> {
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) {
      return err(ledgerNotFoundError(ledgerId));
    }

    const limit = Math.min(params?.limit ?? 50, 200);
    let rows: ImportBatchRow[];

    if (params?.cursor) {
      rows = await this.db.all<ImportBatchRow>(
        "SELECT * FROM import_batches WHERE ledger_id = ? AND id > ? ORDER BY id LIMIT ?",
        [ledgerId, params.cursor, limit + 1],
      );
    } else {
      rows = await this.db.all<ImportBatchRow>(
        "SELECT * FROM import_batches WHERE ledger_id = ? ORDER BY id LIMIT ?",
        [ledgerId, limit + 1],
      );
    }

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? pageRows[pageRows.length - 1]!.id : null;

    return ok({ data: pageRows.map(toImportBatch), nextCursor });
  }

  async confirmMatches(params: {
    batchId: string;
    actions: ConfirmAction[];
  }): Promise<Result<{ batch: ImportBatch; rows: ImportRow[] }>> {
    const validated = confirmMatchesSchema.safeParse(params);
    if (!validated.success) {
      return err(createError(ErrorCode.VALIDATION_ERROR, validated.error.message));
    }

    const batchRow = await this.db.get<ImportBatchRow>("SELECT * FROM import_batches WHERE id = ?", [params.batchId]);
    if (!batchRow) {
      return err(importNotFoundError(params.batchId));
    }

    const result = await this.db.transaction(async () => {
      const now = nowUtc();

      for (const action of params.actions) {
        const rowRow = await this.db.get<ImportRowRow>("SELECT * FROM import_rows WHERE id = ? AND batch_id = ?", [action.rowId, params.batchId]);
        if (!rowRow) continue; // Skip unknown rows

        switch (action.action) {
          case "confirm":
            // Only allow confirming suggested matches
            if (rowRow.match_status === "suggested") {
              await this.db.run(
                "UPDATE import_rows SET match_status = 'matched', updated_at = ? WHERE id = ?",
                [now, action.rowId],
              );
            }
            break;

          case "reject":
            await this.db.run(
              "UPDATE import_rows SET match_status = 'unmatched', matched_transaction_id = NULL, confidence = NULL, updated_at = ? WHERE id = ?",
              [now, action.rowId],
            );
            break;

          case "override":
            if (action.overrideTransactionId) {
              await this.db.run(
                "UPDATE import_rows SET match_status = 'matched', matched_transaction_id = ?, confidence = 1.0, updated_at = ? WHERE id = ?",
                [action.overrideTransactionId, now, action.rowId],
              );
            }
            break;
        }
      }

      // Recompute batch counts
      const matchedCount = (await this.db.get<{ count: number }>(
        "SELECT COUNT(*) as count FROM import_rows WHERE batch_id = ? AND match_status = 'matched'",
        [params.batchId],
      ))!.count;
      const unmatchedCount = (await this.db.get<{ count: number }>(
        "SELECT COUNT(*) as count FROM import_rows WHERE batch_id = ? AND match_status IN ('unmatched', 'suggested')",
        [params.batchId],
      ))!.count;

      await this.db.run(
        "UPDATE import_batches SET matched_count = ?, unmatched_count = ?, updated_at = ? WHERE id = ?",
        [matchedCount, unmatchedCount, now, params.batchId],
      );

      // Audit
      const auditId = generateId();
      await this.db.run(
        `INSERT INTO audit_entries (id, ledger_id, entity_type, entity_id, action, actor_type, actor_id, snapshot, created_at)
         VALUES (?, ?, 'import_batch', ?, 'updated', 'system', 'engine', ?, ?)`,
        [auditId, batchRow.ledger_id, params.batchId, JSON.stringify({ actions: params.actions }), now],
      );

      // Read back
      const updatedBatch = (await this.db.get<ImportBatchRow>("SELECT * FROM import_batches WHERE id = ?", [params.batchId]))!;
      const updatedRows = await this.db.all<ImportRowRow>(
        "SELECT * FROM import_rows WHERE batch_id = ? ORDER BY date, created_at",
        [params.batchId],
      );

      return { batch: toImportBatch(updatedBatch), rows: updatedRows.map(toImportRow) };
    });

    return ok(result);
  }

  // -------------------------------------------------------------------------
  // Billing — usage tracking and plan management
  // -------------------------------------------------------------------------

  // DEPRECATED: Use getUsageSummary from @kounta/core tiers/usage.ts instead.
  // Reads from old usage_periods table. Retained for backward compat; not called by any route.
  async getUsage(ledgerId: string): Promise<Result<{ count: number; limit: number; plan: string; periodStart: string; periodEnd: string }>> {
    // Get the user's plan via ledger owner
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) return err(ledgerNotFoundError(ledgerId));

    const user = await this.db.get<UserRow>("SELECT * FROM users WHERE id = ?", [ledger.owner_id]);
    if (!user) return err(createError(ErrorCode.INTERNAL_ERROR, "Owner not found for ledger"));

    const plan = user.plan || "free";
    const limit = plan === "free" ? 500 : -1; // -1 = unlimited

    // Get current month boundaries
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0]!;
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0]!;

    // Get or create usage period
    const usage = await this.db.get<UsagePeriodRow>(
      "SELECT * FROM usage_periods WHERE ledger_id = ? AND period_start = ?",
      [ledgerId, periodStart]
    );

    return ok({
      count: usage ? usage.transaction_count : 0,
      limit,
      plan,
      periodStart,
      periodEnd,
    });
  }

  // DEPRECATED: Use incrementUsage from @kounta/core tiers/usage.ts instead.
  // Writes to old usage_periods table. Retained for backward compat; not called by any route.
  async incrementUsage(ledgerId: string): Promise<void> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
    const ts = nowUtc();

    // Upsert usage period — increment count
    const existing = await this.db.get<UsagePeriodRow>(
      "SELECT * FROM usage_periods WHERE ledger_id = ? AND period_start = ?",
      [ledgerId, periodStart]
    );

    if (existing) {
      await this.db.run(
        "UPDATE usage_periods SET transaction_count = transaction_count + 1, updated_at = ? WHERE id = ?",
        [ts, existing.id]
      );
    } else {
      const id = generateId();
      await this.db.run(
        "INSERT INTO usage_periods (id, ledger_id, period_start, period_end, transaction_count, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
        [id, ledgerId, periodStart, periodEnd, ts, ts]
      );
    }
  }

  async postPendingTransactions(ledgerId: string): Promise<Result<number>> {
    const now = nowUtc();

    // Find all pending transactions for this ledger
    const pending = await this.db.all<TransactionRow>(
      "SELECT * FROM transactions WHERE ledger_id = ? AND status = 'pending'",
      [ledgerId]
    );

    if (pending.length === 0) return ok(0);

    await this.db.transaction(async () => {
      for (const txn of pending) {
        await this.db.run(
          "UPDATE transactions SET status = 'posted', posted_at = ?, updated_at = ? WHERE id = ?",
          [now, now, txn.id]
        );

        // Audit entry for each posted pending transaction
        const auditId = generateId();
        await this.db.run(
          `INSERT INTO audit_entries (id, ledger_id, entity_type, entity_id, action, actor_type, actor_id, snapshot, created_at)
           VALUES (?, ?, 'transaction', ?, 'updated', 'system', 'billing', ?, ?)`,
          [auditId, ledgerId, txn.id, JSON.stringify({ previousStatus: "pending", newStatus: "posted", reason: "plan_upgrade" }), now]
        );
      }
    });

    return ok(pending.length);
  }

  async getUserByLedger(ledgerId: string): Promise<Result<User>> {
    const row = await this.db.get<UserRow>(
      "SELECT u.* FROM users u JOIN ledgers l ON l.owner_id = u.id WHERE l.id = ?",
      [ledgerId]
    );
    if (!row) return err(createError(ErrorCode.INTERNAL_ERROR, "Owner not found for ledger"));
    return ok(toUser(row));
  }

  async updateUserPlan(
    userId: string,
    plan: string,
    stripeCustomerId?: string,
    stripeSubscriptionId?: string,
    periodStart?: string,
    periodEnd?: string
  ): Promise<Result<User>> {
    const now = nowUtc();
    await this.db.run(
      `UPDATE users SET
        plan = ?,
        stripe_customer_id = COALESCE(?, stripe_customer_id),
        stripe_subscription_id = COALESCE(?, stripe_subscription_id),
        plan_period_start = COALESCE(?, plan_period_start),
        plan_period_end = COALESCE(?, plan_period_end),
        plan_updated_at = ?,
        updated_at = ?
       WHERE id = ?`,
      [plan, stripeCustomerId ?? null, stripeSubscriptionId ?? null, periodStart ?? null, periodEnd ?? null, now, now, userId]
    );

    const row = await this.db.get<UserRow>("SELECT * FROM users WHERE id = ?", [userId]);
    if (!row) return err(createError(ErrorCode.INTERNAL_ERROR, "User not found after update"));
    return ok(toUser(row));
  }

  async updateUserName(userId: string, name: string): Promise<Result<User>> {
    const now = nowUtc();
    await this.db.run(
      "UPDATE users SET name = ?, updated_at = ? WHERE id = ?",
      [name, now, userId]
    );
    const row = await this.db.get<UserRow>("SELECT * FROM users WHERE id = ?", [userId]);
    if (!row) return err(createError(ErrorCode.INTERNAL_ERROR, "User not found after update"));
    return ok(toUser(row));
  }

  async findUserByStripeCustomer(stripeCustomerId: string): Promise<Result<User>> {
    const row = await this.db.get<UserRow>(
      "SELECT * FROM users WHERE stripe_customer_id = ?",
      [stripeCustomerId]
    );
    if (!row) return err(createError(ErrorCode.INTERNAL_ERROR, "User not found for Stripe customer"));
    return ok(toUser(row));
  }

  // DEPRECATED: Usage resets automatically via new period in usage_tracking table.
  // Writes to old usage_periods table. Retained for backward compat; not called by any route.
  async resetUsage(ledgerId: string): Promise<void> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const ts = nowUtc();

    await this.db.run(
      "UPDATE usage_periods SET transaction_count = 0, updated_at = ? WHERE ledger_id = ? AND period_start = ?",
      [ts, ledgerId, periodStart]
    );
  }

  // -------------------------------------------------------------------------
  // Bank Feeds — connections
  // -------------------------------------------------------------------------

  async createBankConnection(params: {
    ledgerId: string;
    provider: string;
    providerConnectionId: string;
    institutionId: string;
    institutionName: string;
  }): Promise<Result<BankConnection>> {
    const id = generateId();
    const ts = nowUtc();

    await this.db.run(
      `INSERT INTO bank_connections (id, ledger_id, provider, provider_connection_id, institution_id, institution_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [id, params.ledgerId, params.provider, params.providerConnectionId, params.institutionId, params.institutionName, ts, ts]
    );

    const row = await this.db.get<BankConnectionRow>("SELECT * FROM bank_connections WHERE id = ?", [id]);
    if (!row) return err(createError(ErrorCode.INTERNAL_ERROR, "Failed to create bank connection"));
    return ok(toBankConnection(row));
  }

  async listBankConnections(ledgerId: string): Promise<Result<readonly BankConnection[]>> {
    const rows = await this.db.all<BankConnectionRow>(
      "SELECT * FROM bank_connections WHERE ledger_id = ? ORDER BY created_at DESC",
      [ledgerId]
    );
    return ok(rows.map(toBankConnection));
  }

  async getBankConnection(connectionId: string): Promise<Result<BankConnection>> {
    const row = await this.db.get<BankConnectionRow>(
      "SELECT * FROM bank_connections WHERE id = ?",
      [connectionId]
    );
    if (!row) return err(bankConnectionNotFoundError(connectionId));
    return ok(toBankConnection(row));
  }

  async updateBankConnectionStatus(
    connectionId: string,
    status: BankConnection["status"],
  ): Promise<Result<BankConnection>> {
    const ts = nowUtc();
    await this.db.run(
      "UPDATE bank_connections SET status = ?, updated_at = ? WHERE id = ?",
      [status, ts, connectionId]
    );
    return this.getBankConnection(connectionId);
  }

  async deleteBankConnection(connectionId: string): Promise<Result<void>> {
    const row = await this.db.get<BankConnectionRow>(
      "SELECT * FROM bank_connections WHERE id = ?",
      [connectionId]
    );
    if (!row) return err(bankConnectionNotFoundError(connectionId));

    // Soft-delete: mark as disconnected rather than hard deleting (preserves audit trail)
    const now = nowUtc();
    await this.db.run(
      "UPDATE bank_connections SET status = 'disconnected', updated_at = ? WHERE id = ?",
      [now, connectionId]
    );
    return ok(undefined);
  }

  // -------------------------------------------------------------------------
  // Bank Feeds — accounts
  // -------------------------------------------------------------------------

  async upsertBankAccount(params: {
    connectionId: string;
    ledgerId: string;
    providerAccountId: string;
    name: string;
    accountNumber: string;
    bsb: string | null;
    type: string;
    currency: string;
    currentBalance: number;
    availableBalance: number | null;
  }): Promise<Result<BankAccount>> {
    const ts = nowUtc();

    // Check if already exists
    const existing = await this.db.get<BankAccountRow>(
      "SELECT * FROM bank_accounts WHERE connection_id = ? AND provider_account_id = ?",
      [params.connectionId, params.providerAccountId]
    );

    if (existing) {
      await this.db.run(
        `UPDATE bank_accounts
         SET name = ?, account_number = ?, bsb = ?, type = ?, currency = ?,
             current_balance = ?, available_balance = ?, updated_at = ?
         WHERE id = ?`,
        [params.name, params.accountNumber, params.bsb, params.type, params.currency,
         params.currentBalance, params.availableBalance, ts, existing.id]
      );
      const row = await this.db.get<BankAccountRow>("SELECT * FROM bank_accounts WHERE id = ?", [existing.id]);
      return ok(toBankAccount(row!));
    }

    const id = generateId();
    await this.db.run(
      `INSERT INTO bank_accounts (id, connection_id, ledger_id, provider_account_id, name, account_number, bsb, type, currency, current_balance, available_balance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, params.connectionId, params.ledgerId, params.providerAccountId, params.name,
       params.accountNumber, params.bsb, params.type, params.currency,
       params.currentBalance, params.availableBalance, ts, ts]
    );

    const row = await this.db.get<BankAccountRow>("SELECT * FROM bank_accounts WHERE id = ?", [id]);
    if (!row) return err(createError(ErrorCode.INTERNAL_ERROR, "Failed to create bank account"));
    return ok(toBankAccount(row));
  }

  async listBankAccounts(connectionId: string): Promise<Result<readonly BankAccount[]>> {
    const rows = await this.db.all<BankAccountRow>(
      "SELECT * FROM bank_accounts WHERE connection_id = ? ORDER BY name",
      [connectionId]
    );
    return ok(rows.map(toBankAccount));
  }

  async getBankAccount(bankAccountId: string): Promise<Result<BankAccount>> {
    const row = await this.db.get<BankAccountRow>(
      "SELECT * FROM bank_accounts WHERE id = ?",
      [bankAccountId]
    );
    if (!row) return err(bankAccountNotFoundError(bankAccountId));
    return ok(toBankAccount(row));
  }

  async mapBankAccountToLedgerAccount(
    bankAccountId: string,
    ledgerAccountId: string,
  ): Promise<Result<BankAccount>> {
    const ts = nowUtc();
    await this.db.run(
      "UPDATE bank_accounts SET mapped_account_id = ?, updated_at = ? WHERE id = ?",
      [ledgerAccountId, ts, bankAccountId]
    );
    return this.getBankAccount(bankAccountId);
  }

  // -------------------------------------------------------------------------
  // Bank Feeds — transactions
  // -------------------------------------------------------------------------

  async upsertBankTransactions(
    bankAccountId: string,
    ledgerId: string,
    providerTransactions: readonly ProviderBankTransaction[],
  ): Promise<Result<{ created: number; updated: number }>> {
    const ts = nowUtc();
    let created = 0;
    let updated = 0;

    if (providerTransactions.length === 0) return ok({ created: 0, updated: 0 });

    // Single batch lookup for existing rows — was previously O(n) round trips per sync.
    const providerIds = providerTransactions.map((p) => p.providerTransactionId);
    const placeholders = providerIds.map(() => "?").join(",");
    const existingRows = await this.db.all<BankTransactionRow>(
      `SELECT * FROM bank_transactions
       WHERE bank_account_id = ? AND provider_transaction_id IN (${placeholders})`,
      [bankAccountId, ...providerIds],
    );
    const existingByProviderId = new Map(
      existingRows.map((r) => [r.provider_transaction_id, r]),
    );

    for (const ptxn of providerTransactions) {
      const existing = existingByProviderId.get(ptxn.providerTransactionId);

      if (existing) {
        await this.db.run(
          `UPDATE bank_transactions
           SET date = ?, amount = ?, type = ?, description = ?, reference = ?,
               category = ?, balance = ?, raw_data = ?, updated_at = ?
           WHERE id = ?`,
          [ptxn.date, ptxn.amount, ptxn.type, ptxn.description, ptxn.reference,
           ptxn.category, ptxn.balance, JSON.stringify(ptxn.rawData), ts, existing.id]
        );
        updated++;
      } else {
        const id = generateId();
        await this.db.run(
          `INSERT INTO bank_transactions (id, bank_account_id, ledger_id, provider_transaction_id, date, amount, type, description, reference, category, balance, status, raw_data, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
          [id, bankAccountId, ledgerId, ptxn.providerTransactionId, ptxn.date,
           ptxn.amount, ptxn.type, ptxn.description, ptxn.reference, ptxn.category,
           ptxn.balance, JSON.stringify(ptxn.rawData), ts, ts]
        );
        created++;
      }
    }

    return ok({ created, updated });
  }

  async listBankTransactions(params: {
    bankAccountId?: string;
    ledgerId?: string;
    status?: BankTransaction["status"];
    isPersonal?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<Result<readonly BankTransaction[]>> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.bankAccountId) {
      conditions.push("bank_account_id = ?");
      values.push(params.bankAccountId);
    }
    if (params.ledgerId) {
      conditions.push("ledger_id = ?");
      values.push(params.ledgerId);
    }
    if (params.status) {
      conditions.push("status = ?");
      values.push(params.status);
    }
    if (params.isPersonal !== undefined) {
      conditions.push("is_personal = ?");
      values.push(params.isPersonal ? 1 : 0);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const rows = await this.db.all<BankTransactionRow>(
      `SELECT * FROM bank_transactions ${where} ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?`,
      [...values, limit, offset]
    );
    return ok(rows.map(toBankTransaction));
  }

  async matchBankTransactions(
    ledgerId: string,
    bankAccountId: string,
  ): Promise<Result<{ matched: number; suggested: number; unmatched: number }>> {
    // Get pending bank transactions
    const bankTxnRows = await this.db.all<BankTransactionRow>(
      "SELECT * FROM bank_transactions WHERE bank_account_id = ? AND status = 'pending' ORDER BY date",
      [bankAccountId]
    );

    if (bankTxnRows.length === 0) {
      return ok({ matched: 0, suggested: 0, unmatched: 0 });
    }

    const bankTxns = bankTxnRows.map(toBankTransaction);

    // Get existing ledger transactions for matching
    const ledgerTxnRows = await this.db.all<TransactionRow>(
      "SELECT * FROM transactions WHERE ledger_id = ? AND status = 'posted' ORDER BY date DESC LIMIT 1000",
      [ledgerId]
    );

    // Batch fetch all line items in a single query (avoids N+1)
    const lineItemsMap = await this.fetchLineItemsBatch(ledgerTxnRows.map((r) => r.id));

    const ledgerTxns: TransactionWithLines[] = ledgerTxnRows.map((txnRow) => ({
      ...toTransaction(txnRow),
      lines: lineItemsMap.get(txnRow.id) ?? [],
    } as TransactionWithLines));

    // Convert bank transactions to ParsedRows and run the matcher
    const parsedRows = bankTxns.map(bankTransactionToParseRow);
    const matchResults = matchRows(parsedRows, ledgerTxns);

    let matched = 0;
    let suggested = 0;
    let unmatched = 0;
    const ts = nowUtc();

    for (let i = 0; i < matchResults.length; i++) {
      const result = matchResults[i]!;
      const bankTxn = bankTxns[i]!;

      if (result.matchStatus === "matched" && result.transactionId) {
        await this.db.run(
          `UPDATE bank_transactions SET status = 'matched', matched_transaction_id = ?, match_confidence = ?, updated_at = ? WHERE id = ?`,
          [result.transactionId, result.confidence, ts, bankTxn.id]
        );
        matched++;
      } else if (result.matchStatus === "suggested" && result.transactionId) {
        await this.db.run(
          `UPDATE bank_transactions SET matched_transaction_id = ?, match_confidence = ?, updated_at = ? WHERE id = ?`,
          [result.transactionId, result.confidence, ts, bankTxn.id]
        );
        suggested++;
      } else {
        unmatched++;
      }
    }

    return ok({ matched, suggested, unmatched });
  }

  async confirmBankTransactionMatch(
    bankTransactionId: string,
    action: "confirm" | "ignore",
    overrideTransactionId?: string,
  ): Promise<Result<BankTransaction>> {
    const row = await this.db.get<BankTransactionRow>(
      "SELECT * FROM bank_transactions WHERE id = ?",
      [bankTransactionId]
    );
    if (!row) return err(createError(ErrorCode.INTERNAL_ERROR, "Bank transaction not found"));

    const ts = nowUtc();

    // Personal transactions cannot be confirmed into the ledger — auto-ignore
    const isPersonal = row.is_personal === 1 || row.is_personal === true;
    if (isPersonal && action === "confirm") {
      await this.db.run(
        "UPDATE bank_transactions SET status = 'ignored', updated_at = ? WHERE id = ?",
        [ts, bankTransactionId]
      );
      const updated = await this.db.get<BankTransactionRow>(
        "SELECT * FROM bank_transactions WHERE id = ?",
        [bankTransactionId]
      );
      return ok(toBankTransaction(updated!));
    }

    if (action === "ignore") {
      await this.db.run(
        "UPDATE bank_transactions SET status = 'ignored', updated_at = ? WHERE id = ?",
        [ts, bankTransactionId]
      );
    } else if (action === "confirm") {
      const txnId = overrideTransactionId ?? row.matched_transaction_id;
      if (!txnId) {
        return err(createError(ErrorCode.VALIDATION_ERROR, "No matched transaction to confirm. Provide overrideTransactionId."));
      }
      await this.db.run(
        "UPDATE bank_transactions SET status = 'matched', matched_transaction_id = ?, updated_at = ? WHERE id = ?",
        [txnId, ts, bankTransactionId]
      );
    }

    const updated = await this.db.get<BankTransactionRow>(
      "SELECT * FROM bank_transactions WHERE id = ?",
      [bankTransactionId]
    );
    return ok(toBankTransaction(updated!));
  }

  // -------------------------------------------------------------------------
  // Bank Feeds — sync
  // -------------------------------------------------------------------------

  async syncBankAccount(
    provider: BankFeedProvider,
    connectionId: string,
    bankAccountId: string,
    fromDate: string,
    toDate: string,
  ): Promise<Result<BankSyncLog>> {
    // Check for running sync
    const runningSync = await this.db.get<BankSyncLogRow>(
      "SELECT * FROM bank_sync_log WHERE connection_id = ? AND status = 'running'",
      [connectionId]
    );
    if (runningSync) return err(bankFeedSyncInProgressError(connectionId));

    // Get connection and bank account
    const connRow = await this.db.get<BankConnectionRow>(
      "SELECT * FROM bank_connections WHERE id = ?",
      [connectionId]
    );
    if (!connRow) return err(bankConnectionNotFoundError(connectionId));

    const bankAcctRow = await this.db.get<BankAccountRow>(
      "SELECT * FROM bank_accounts WHERE id = ?",
      [bankAccountId]
    );
    if (!bankAcctRow) return err(bankAccountNotFoundError(bankAccountId));

    // Create sync log entry
    const syncId = generateId();
    const ts = nowUtc();
    await this.db.run(
      `INSERT INTO bank_sync_log (id, connection_id, bank_account_id, status, started_at)
       VALUES (?, ?, ?, 'running', ?)`,
      [syncId, connectionId, bankAccountId, ts]
    );

    try {
      // Fetch transactions from provider
      const providerTxns = await provider.fetchTransactions({
        connectionId: connRow.provider_connection_id,
        accountId: bankAcctRow.provider_account_id,
        fromDate,
        toDate,
      });

      // Upsert into our database
      const upsertResult = await this.upsertBankTransactions(
        bankAccountId,
        connRow.ledger_id,
        providerTxns,
      );
      if (!upsertResult.ok) throw new Error("Failed to upsert bank transactions");

      // Run matching
      const matchResult = await this.matchBankTransactions(
        connRow.ledger_id,
        bankAccountId,
      );

      const completedAt = nowUtc();
      await this.db.run(
        `UPDATE bank_sync_log
         SET status = 'completed',
             transactions_fetched = ?,
             transactions_new = ?,
             transactions_matched = ?,
             completed_at = ?
         WHERE id = ?`,
        [providerTxns.length, upsertResult.value.created,
         matchResult.ok ? matchResult.value.matched : 0, completedAt, syncId]
      );

      // Run classification on newly synced transactions
      await this.classifyPendingBankTransactions(connRow.ledger_id);

      // Best-effort: check if any credit/deposit transactions match outstanding invoices
      try {
        const pendingCredits = await this.db.all<BankTransactionRow>(
          "SELECT * FROM bank_transactions WHERE bank_account_id = ? AND status = 'pending' AND amount > 0 ORDER BY date",
          [bankAccountId],
        );
        for (const credit of pendingCredits) {
          const matches = await matchBankDepositToInvoices(
            this.db,
            connRow.ledger_id,
            Number(credit.amount),
            credit.description ?? "",
            credit.date,
          );
          if (matches.length > 0 && matches[0] !== undefined) {
            const best = matches[0];
            // Create notification for the best match
            try {
              // Find any user on this ledger for the notification
              const userRow = await this.db.get<{ user_id: string }>(
                "SELECT user_id FROM api_keys WHERE ledger_id = ? LIMIT 1",
                [connRow.ledger_id],
              );
              if (userRow) {
                await this.createNotification({
                  ledgerId: connRow.ledger_id,
                  userId: userRow.user_id,
                  type: "invoice_payment_match",
                  severity: best.confidence >= 0.8 ? "info" : "warning",
                  title: `Possible payment for ${best.invoiceNumber}`,
                  body: `Bank deposit of $${(Number(credit.amount) / 100).toFixed(2)} may be payment for invoice ${best.invoiceNumber} (${best.customerName}). Amount due: $${(best.invoiceAmountDue / 100).toFixed(2)}. Confidence: ${Math.round(best.confidence * 100)}%.`,
                  data: {
                    invoiceId: best.invoiceId,
                    invoiceNumber: best.invoiceNumber,
                    customerName: best.customerName,
                    invoiceTotal: best.invoiceTotal,
                    invoiceAmountDue: best.invoiceAmountDue,
                    bankTransactionId: credit.id,
                    bankTransactionAmount: Number(credit.amount),
                    bankTransactionDate: credit.date,
                    bankTransactionMemo: credit.description ?? "",
                    confidence: best.confidence,
                  },
                });
              }
            } catch { /* notification creation is best-effort */ }
          }
        }
      } catch (invoiceMatchErr) {
        console.error("Invoice payment matching error (non-blocking):", invoiceMatchErr);
      }

      // Update bank account and connection sync timestamps
      await this.db.run(
        "UPDATE bank_accounts SET last_sync_at = ?, updated_at = ? WHERE id = ?",
        [completedAt, completedAt, bankAccountId]
      );
      await this.db.run(
        "UPDATE bank_connections SET last_sync_at = ?, updated_at = ? WHERE id = ?",
        [completedAt, completedAt, connectionId]
      );

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const completedAt = nowUtc();
      await this.db.run(
        `UPDATE bank_sync_log
         SET status = 'failed', error_message = ?, completed_at = ?
         WHERE id = ?`,
        [errorMsg, completedAt, syncId]
      );
    }

    const syncRow = await this.db.get<BankSyncLogRow>(
      "SELECT * FROM bank_sync_log WHERE id = ?",
      [syncId]
    );
    return ok(toBankSyncLog(syncRow!));
  }

  async listSyncLogs(
    connectionId: string,
    limit = 20,
  ): Promise<Result<readonly BankSyncLog[]>> {
    const rows = await this.db.all<BankSyncLogRow>(
      "SELECT * FROM bank_sync_log WHERE connection_id = ? ORDER BY started_at DESC LIMIT ?",
      [connectionId, limit]
    );
    return ok(rows.map(toBankSyncLog));
  }

  // -------------------------------------------------------------------------
  // Intelligence — Notifications
  // -------------------------------------------------------------------------

  async createNotification(
    input: CreateNotificationInput,
  ): Promise<Result<Notification>> {
    // Check user preferences — skip if this type is disabled
    const pref = await this.db.get<NotificationPreferenceRow>(
      "SELECT * FROM notification_preferences WHERE user_id = ? AND ledger_id = ? AND type = ?",
      [input.userId, input.ledgerId, input.type]
    );
    if (pref && (pref.enabled === 0 || pref.enabled === false)) {
      // Preference says disabled — silently skip
      return err(createError(ErrorCode.FORBIDDEN, "Notification type disabled by user preference"));
    }

    const id = generateId();
    const now = nowUtc();
    const dataJson = JSON.stringify(input.data ?? {});
    const actionDataJson = input.actionData ? JSON.stringify(input.actionData) : null;

    await this.db.run(
      `INSERT INTO notifications (id, ledger_id, user_id, type, severity, title, body, data, action_type, action_data, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unread', ?)`,
      [id, input.ledgerId, input.userId, input.type, input.severity,
       input.title, input.body, dataJson, input.actionType ?? null, actionDataJson, now]
    );

    const row = await this.db.get<NotificationRow>(
      "SELECT * FROM notifications WHERE id = ?",
      [id]
    );
    return ok(toNotification(row!));
  }

  async listNotifications(
    ledgerId: string,
    userId: string,
    options: {
      status?: NotificationStatus;
      type?: NotificationType;
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<Result<{ notifications: readonly Notification[]; nextCursor: string | null }>> {
    const limit = Math.min(options.limit ?? 50, 200);
    const conditions: string[] = ["ledger_id = ?", "user_id = ?"];
    const params: unknown[] = [ledgerId, userId];

    if (options.status) {
      conditions.push("status = ?");
      params.push(options.status);
    }
    if (options.type) {
      conditions.push("type = ?");
      params.push(options.type);
    }
    if (options.cursor) {
      conditions.push("created_at < ?");
      params.push(options.cursor);
    }

    params.push(limit + 1);

    const rows = await this.db.all<NotificationRow>(
      `SELECT * FROM notifications
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`,
      params
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1]!.created_at : null;

    return ok({ notifications: page.map(toNotification), nextCursor });
  }

  async getNotification(id: string): Promise<Result<Notification>> {
    const row = await this.db.get<NotificationRow>(
      "SELECT * FROM notifications WHERE id = ?",
      [id]
    );
    if (!row) return err(notificationNotFoundError(id));
    return ok(toNotification(row));
  }

  async updateNotificationStatus(
    id: string,
    status: NotificationStatus,
  ): Promise<Result<Notification>> {
    const existing = await this.db.get<NotificationRow>(
      "SELECT * FROM notifications WHERE id = ?",
      [id]
    );
    if (!existing) return err(notificationNotFoundError(id));

    const now = nowUtc();
    const readAt = status === "read" || status === "actioned" ? now : existing.read_at;
    const actionedAt = status === "actioned" ? now : existing.actioned_at;

    await this.db.run(
      "UPDATE notifications SET status = ?, read_at = ?, actioned_at = ? WHERE id = ?",
      [status, readAt, actionedAt, id]
    );

    const row = await this.db.get<NotificationRow>(
      "SELECT * FROM notifications WHERE id = ?",
      [id]
    );
    return ok(toNotification(row!));
  }

  async getNotificationPreferences(
    userId: string,
    ledgerId: string,
  ): Promise<Result<readonly NotificationPreference[]>> {
    const rows = await this.db.all<NotificationPreferenceRow>(
      "SELECT * FROM notification_preferences WHERE user_id = ? AND ledger_id = ?",
      [userId, ledgerId]
    );
    return ok(rows.map(toNotificationPreference));
  }

  async setNotificationPreference(
    userId: string,
    ledgerId: string,
    type: NotificationType,
    enabled: boolean,
  ): Promise<Result<NotificationPreference>> {
    const now = nowUtc();
    const existing = await this.db.get<NotificationPreferenceRow>(
      "SELECT * FROM notification_preferences WHERE user_id = ? AND ledger_id = ? AND type = ?",
      [userId, ledgerId, type]
    );

    if (existing) {
      await this.db.run(
        "UPDATE notification_preferences SET enabled = ?, updated_at = ? WHERE id = ?",
        [enabled ? 1 : 0, now, existing.id]
      );
    } else {
      const id = generateId();
      await this.db.run(
        "INSERT INTO notification_preferences (id, user_id, ledger_id, type, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        [id, userId, ledgerId, type, enabled ? 1 : 0, now]
      );
    }

    const row = await this.db.get<NotificationPreferenceRow>(
      "SELECT * FROM notification_preferences WHERE user_id = ? AND ledger_id = ? AND type = ?",
      [userId, ledgerId, type]
    );
    return ok(toNotificationPreference(row!));
  }

  // -------------------------------------------------------------------------
  // Intelligence — Insight Generation
  // -------------------------------------------------------------------------

  async generateInsights(
    ledgerId: string,
    userId: string,
  ): Promise<Result<readonly Notification[]>> {
    const created: Notification[] = [];

    // 1. Monthly summary (previous month)
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // getMonth is 0-based
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    const summaryData = await analyzeMonthlySummary(this.db, ledgerId, prevYear, prevMonth);
    if (summaryData) {
      const rendered = renderMonthlySummary(summaryData);
      const result = await this.createNotification({
        ledgerId,
        userId,
        type: "monthly_summary",
        severity: "info",
        title: rendered.title,
        body: rendered.body,
        data: summaryData as unknown as Record<string, unknown>,
      });
      if (result.ok) created.push(result.value);
    }

    // 2. Cash position
    const cashData = await analyzeCashPosition(this.db, ledgerId);
    if (cashData) {
      const rendered = renderCashPosition(cashData);
      const result = await this.createNotification({
        ledgerId,
        userId,
        type: "cash_position",
        severity: rendered.severity,
        title: rendered.title,
        body: rendered.body,
        data: cashData as unknown as Record<string, unknown>,
      });
      if (result.ok) created.push(result.value);
    }

    // 3. Anomalies
    const anomalies = await detectAnomalies(this.db, ledgerId);
    if (anomalies.length > 0) {
      const rendered = renderAnomalies(anomalies);
      const result = await this.createNotification({
        ledgerId,
        userId,
        type: "anomaly",
        severity: rendered.severity,
        title: rendered.title,
        body: rendered.body,
        data: { anomalies } as unknown as Record<string, unknown>,
      });
      if (result.ok) created.push(result.value);
    }

    // 4. Unclassified transactions
    const unclassified = await findUnclassifiedTransactions(this.db, ledgerId);
    if (unclassified) {
      const rendered = renderUnclassified(unclassified);
      const result = await this.createNotification({
        ledgerId,
        userId,
        type: "unclassified_transactions",
        severity: rendered.severity,
        title: rendered.title,
        body: rendered.body,
        data: unclassified as unknown as Record<string, unknown>,
      });
      if (result.ok) created.push(result.value);
    }

    // 5. Large deferred revenue balance
    const deferredData = await analyzeDeferredBalance(this.db, ledgerId);
    if (deferredData) {
      const rendered = renderLargeDeferredBalance(deferredData);
      const result = await this.createNotification({
        ledgerId,
        userId,
        type: "large_deferred_balance",
        severity: "info",
        title: rendered.title,
        body: rendered.body,
        data: deferredData as unknown as Record<string, unknown>,
      });
      if (result.ok) created.push(result.value);
    }

    return ok(created);
  }

  // -------------------------------------------------------------------------
  // Multi-currency operations
  // -------------------------------------------------------------------------

  async enableCurrency(
    ledgerId: string,
    currencyCode: string,
    decimalPlaces?: number,
    symbol?: string,
  ): Promise<Result<CurrencySetting>> {
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) return err(ledgerNotFoundError(ledgerId));

    const code = currencyCode.toUpperCase();
    const decimals = decimalPlaces ?? getDecimalPlaces(code);
    const sym = symbol ?? code;
    const now = nowUtc();

    // Check if already exists
    const existing = await this.db.get<CurrencySettingRow>(
      "SELECT * FROM currency_settings WHERE ledger_id = ? AND currency_code = ?",
      [ledgerId, code]
    );

    if (existing) {
      // Re-enable if disabled
      if (!(existing.enabled === 1 || existing.enabled === true)) {
        await this.db.run(
          "UPDATE currency_settings SET enabled = ?, updated_at = ? WHERE id = ?",
          [true, now, existing.id]
        );
      }
      const row = (await this.db.get<CurrencySettingRow>("SELECT * FROM currency_settings WHERE id = ?", [existing.id]))!;
      return ok(toCurrencySetting(row));
    }

    const id = generateId();
    await this.db.run(
      `INSERT INTO currency_settings (id, ledger_id, currency_code, decimal_places, symbol, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, ledgerId, code, decimals, sym, true, now, now]
    );

    const row = (await this.db.get<CurrencySettingRow>("SELECT * FROM currency_settings WHERE id = ?", [id]))!;
    return ok(toCurrencySetting(row));
  }

  async listEnabledCurrencies(ledgerId: string): Promise<Result<CurrencySetting[]>> {
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) return err(ledgerNotFoundError(ledgerId));

    const rows = await this.db.all<CurrencySettingRow>(
      "SELECT * FROM currency_settings WHERE ledger_id = ? AND enabled = ? ORDER BY currency_code",
      [ledgerId, true]
    );
    return ok(rows.map(toCurrencySetting));
  }

  async setExchangeRate(
    ledgerId: string,
    fromCurrency: string,
    toCurrency: string,
    rate: number,
    effectiveDate: string,
    source: ExchangeRateSource = "manual",
  ): Promise<Result<ExchangeRate>> {
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) return err(ledgerNotFoundError(ledgerId));

    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();
    const now = nowUtc();

    // Upsert: try to find existing for this date
    const existing = await this.db.get<ExchangeRateRow>(
      "SELECT * FROM exchange_rates WHERE ledger_id = ? AND from_currency = ? AND to_currency = ? AND effective_date = ?",
      [ledgerId, from, to, effectiveDate]
    );

    if (existing) {
      await this.db.run(
        "UPDATE exchange_rates SET rate = ?, source = ? WHERE id = ?",
        [rate, source, existing.id]
      );
      const row = (await this.db.get<ExchangeRateRow>("SELECT * FROM exchange_rates WHERE id = ?", [existing.id]))!;
      return ok(toExchangeRate(row));
    }

    const id = generateId();
    await this.db.run(
      `INSERT INTO exchange_rates (id, ledger_id, from_currency, to_currency, rate, effective_date, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, ledgerId, from, to, rate, effectiveDate, source, now]
    );

    const row = (await this.db.get<ExchangeRateRow>("SELECT * FROM exchange_rates WHERE id = ?", [id]))!;
    return ok(toExchangeRate(row));
  }

  async getExchangeRate(
    ledgerId: string,
    fromCurrency: string,
    toCurrency: string,
    date?: string,
  ): Promise<Result<ExchangeRate>> {
    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();
    const asOf = date ?? new Date().toISOString().slice(0, 10);

    // Find the most recent rate on or before the given date
    const row = await this.db.get<ExchangeRateRow>(
      `SELECT * FROM exchange_rates
       WHERE ledger_id = ? AND from_currency = ? AND to_currency = ? AND effective_date <= ?
       ORDER BY effective_date DESC
       LIMIT 1`,
      [ledgerId, from, to, asOf]
    );

    if (!row) return err(exchangeRateNotFoundError(from, to, asOf));
    return ok(toExchangeRate(row));
  }

  async listExchangeRates(
    ledgerId: string,
    opts?: { fromCurrency?: string; toCurrency?: string; limit?: number; cursor?: string },
  ): Promise<Result<{ rates: ExchangeRate[]; nextCursor: string | null }>> {
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) return err(ledgerNotFoundError(ledgerId));

    const limit = Math.min(opts?.limit ?? 50, 200);
    const conditions: string[] = ["ledger_id = ?"];
    const params: unknown[] = [ledgerId];

    if (opts?.fromCurrency) {
      conditions.push("from_currency = ?");
      params.push(opts.fromCurrency.toUpperCase());
    }
    if (opts?.toCurrency) {
      conditions.push("to_currency = ?");
      params.push(opts.toCurrency.toUpperCase());
    }
    if (opts?.cursor) {
      conditions.push("id < ?");
      params.push(opts.cursor);
    }

    params.push(limit + 1);
    const rows = await this.db.all<ExchangeRateRow>(
      `SELECT * FROM exchange_rates WHERE ${conditions.join(" AND ")} ORDER BY effective_date DESC, id DESC LIMIT ?`,
      params
    );

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const lastItem = slice[slice.length - 1];
    const nextCursor = hasMore && lastItem ? lastItem.id : null;

    return ok({ rates: slice.map(toExchangeRate), nextCursor });
  }

  async convertAmount(
    ledgerId: string,
    fromCurrency: string,
    toCurrency: string,
    amount: number,
    date?: string,
  ): Promise<Result<ConvertAmountResult>> {
    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();

    if (from === to) {
      return ok({
        fromCurrency: from,
        toCurrency: to,
        originalAmount: amount,
        convertedAmount: amount,
        rate: RATE_PRECISION,
        effectiveDate: date ?? new Date().toISOString().slice(0, 10),
      });
    }

    const rateResult = await this.getExchangeRate(ledgerId, from, to, date);
    if (!rateResult.ok) return err(rateResult.error);

    const converted = convertAmountUtil(amount, rateResult.value.rate);
    return ok({
      fromCurrency: from,
      toCurrency: to,
      originalAmount: amount,
      convertedAmount: converted,
      rate: rateResult.value.rate,
      effectiveDate: rateResult.value.effectiveDate,
    });
  }

  async revalueAccounts(
    ledgerId: string,
    date: string,
  ): Promise<Result<RevaluationResult[]>> {
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) return err(ledgerNotFoundError(ledgerId));

    // Find all accounts with a specific currency different from base
    const foreignAccounts = await this.db.all<AccountRow>(
      "SELECT * FROM accounts WHERE ledger_id = ? AND currency IS NOT NULL AND currency != ? AND status = 'active'",
      [ledgerId, ledger.currency]
    );

    const results: RevaluationResult[] = [];

    for (const acct of foreignAccounts) {
      const account = toAccount(acct);
      if (!account.currency) continue;

      // Get current balance in base currency (sum of amount column)
      const baseBalance = await this.computeBalance(acct.id, account.normalBalance);

      // Get current balance in original currency (sum of original_amount column)
      const origBalanceRow = await this.db.get<{ balance: number | string }>(
        `SELECT COALESCE(
           SUM(CASE WHEN direction = ? THEN original_amount ELSE 0 END) -
           SUM(CASE WHEN direction = ? THEN original_amount ELSE 0 END), 0
         ) AS balance FROM line_items WHERE account_id = ?`,
        [account.normalBalance, account.normalBalance === "debit" ? "credit" : "debit", acct.id]
      );
      const origBalance = Number(origBalanceRow?.balance ?? 0);

      // Get current exchange rate
      const rateResult = await this.getExchangeRate(ledgerId, account.currency, ledger.currency, date);
      if (!rateResult.ok) {
        results.push({
          accountId: acct.id,
          accountCode: acct.code,
          currency: account.currency,
          originalBalance: origBalance,
          revaluedBalance: baseBalance,
          gainLoss: 0,
          transactionId: null,
        });
        continue;
      }

      // Compute what the balance should be at current rate
      const revaluedBase = convertAmountUtil(origBalance, rateResult.value.rate);
      const gainLoss = revaluedBase - baseBalance;

      let transactionId: string | null = null;

      if (gainLoss !== 0) {
        // Find or require an FX gain/loss account
        const fxAccount = await this.db.get<AccountRow>(
          "SELECT * FROM accounts WHERE ledger_id = ? AND code = 'FX-GAIN-LOSS' AND status = 'active'",
          [ledgerId]
        );

        if (fxAccount) {
          // Post an adjustment entry
          const adjustmentLines: PostLineInput[] = gainLoss > 0
            ? [
                { accountCode: acct.code, amount: gainLoss, direction: "debit" as const },
                { accountCode: "FX-GAIN-LOSS", amount: gainLoss, direction: "credit" as const },
              ]
            : [
                { accountCode: "FX-GAIN-LOSS", amount: Math.abs(gainLoss), direction: "debit" as const },
                { accountCode: acct.code, amount: Math.abs(gainLoss), direction: "credit" as const },
              ];

          const txnResult = await this.postTransaction({
            ledgerId,
            date,
            memo: `FX revaluation: ${account.currency}/${ledger.currency} for account ${acct.code}`,
            lines: adjustmentLines,
            sourceType: "manual",
            metadata: { type: "fx_revaluation", currency: account.currency, rate: rateResult.value.rate },
          });

          if (txnResult.ok) {
            transactionId = txnResult.value.id;
          }
        }
      }

      results.push({
        accountId: acct.id,
        accountCode: acct.code,
        currency: account.currency,
        originalBalance: origBalance,
        revaluedBalance: revaluedBase,
        gainLoss,
        transactionId,
      });
    }

    return ok(results);
  }

  // -------------------------------------------------------------------------
  // AI Conversations
  // -------------------------------------------------------------------------

  async createConversation(
    userId: string,
    ledgerId: string,
    title?: string,
  ): Promise<Result<Conversation>> {
    const id = generateId();
    const ts = nowUtc();

    await this.db.run(
      `INSERT INTO conversations (id, user_id, ledger_id, title, messages, created_at, updated_at)
       VALUES (?, ?, ?, ?, '[]', ?, ?)`,
      [id, userId, ledgerId, title ?? null, ts, ts],
    );

    return ok({
      id,
      userId,
      ledgerId,
      title: title ?? null,
      messages: [],
      createdAt: ts,
      updatedAt: ts,
    });
  }

  async getConversation(conversationId: string): Promise<Result<Conversation>> {
    const row = await this.db.get<ConversationRow>(
      "SELECT * FROM conversations WHERE id = ?",
      [conversationId],
    );
    if (!row) return err(conversationNotFoundError(conversationId));
    return ok(toConversation(row));
  }

  async listConversations(
    userId: string,
    ledgerId: string,
    opts?: { cursor?: string; limit?: number },
  ): Promise<Result<{ data: Conversation[]; nextCursor: string | null }>> {
    const limit = Math.min(opts?.limit ?? 50, 200);
    const params: unknown[] = [userId, ledgerId];
    let where = "WHERE user_id = ? AND ledger_id = ?";

    if (opts?.cursor) {
      where += " AND created_at < ?";
      params.push(opts.cursor);
    }

    params.push(limit + 1);

    const rows = await this.db.all<ConversationRow>(
      `SELECT * FROM conversations ${where} ORDER BY created_at DESC LIMIT ?`,
      params,
    );

    const hasMore = rows.length > limit;
    const data = (hasMore ? rows.slice(0, limit) : rows).map(toConversation);
    const nextCursor = hasMore && data.length > 0 ? data[data.length - 1]!.createdAt : null;

    return ok({ data, nextCursor });
  }

  async updateConversationMessages(
    conversationId: string,
    messages: readonly ConversationMessage[],
    title?: string,
  ): Promise<Result<Conversation>> {
    const ts = nowUtc();
    const messagesJson = JSON.stringify(messages);

    const setClauses = ["messages = ?", "updated_at = ?"];
    const params: unknown[] = [messagesJson, ts];

    if (title !== undefined) {
      setClauses.push("title = ?");
      params.push(title);
    }

    params.push(conversationId);

    await this.db.run(
      `UPDATE conversations SET ${setClauses.join(", ")} WHERE id = ?`,
      params,
    );

    const row = await this.db.get<ConversationRow>(
      "SELECT * FROM conversations WHERE id = ?",
      [conversationId],
    );
    if (!row) return err(conversationNotFoundError(conversationId));
    return ok(toConversation(row));
  }

  async deleteConversation(conversationId: string): Promise<Result<void>> {
    const row = await this.db.get<ConversationRow>(
      "SELECT * FROM conversations WHERE id = ?",
      [conversationId],
    );
    if (!row) return err(conversationNotFoundError(conversationId));

    await this.db.run("DELETE FROM conversations WHERE id = ?", [conversationId]);
    return ok(undefined);
  }

  // -------------------------------------------------------------------------
  // Classification Rules Engine
  // -------------------------------------------------------------------------

  private getAliasService() {
    return createAliasService(this.db);
  }

  private getRulesService() {
    return createRulesService(this.db);
  }

  private getClassificationEngine() {
    return createClassificationEngine(this.db, this.getAliasService());
  }

  // --- Rules CRUD ---

  async createClassificationRule(input: CreateClassificationRuleInput): Promise<Result<ClassificationRule>> {
    return this.getRulesService().createRule(input);
  }

  async listClassificationRules(
    ledgerId: string,
    opts?: ListClassificationRulesOptions,
  ): Promise<Result<readonly ClassificationRule[]>> {
    return this.getRulesService().listRules(ledgerId, opts);
  }

  async getClassificationRule(ruleId: string): Promise<Result<ClassificationRule>> {
    return this.getRulesService().getRule(ruleId);
  }

  async updateClassificationRule(
    ruleId: string,
    input: UpdateClassificationRuleInput,
  ): Promise<Result<ClassificationRule>> {
    return this.getRulesService().updateRule(ruleId, input);
  }

  async deleteClassificationRule(ruleId: string): Promise<Result<void>> {
    return this.getRulesService().deleteRule(ruleId);
  }

  // --- Classification pipeline ---

  async classifyTransaction(
    ledgerId: string,
    transaction: { description: string; category?: string | null; amount?: number },
  ): Promise<Result<ClassificationResult | null>> {
    const result = await this.getClassificationEngine().classify(ledgerId, transaction);
    return ok(result);
  }

  /**
   * Run the classification pipeline on all pending (unmatched) bank
   * transactions for a given ledger. Called after bank feed sync.
   *
   * For each unmatched transaction:
   *   - confidence >= 0.95 → status = 'matched'
   *   - confidence >= 0.60 → status = 'suggested' (kept as pending for review)
   *   - Sets is_personal and suggested_account_id
   */
  async classifyPendingBankTransactions(
    ledgerId: string,
  ): Promise<Result<{ classified: number; suggested: number; unclassified: number }>> {
    const engine = this.getClassificationEngine();
    const ts = nowUtc();

    // Get all pending bank transactions for this ledger
    const rows = await this.db.all<BankTransactionRow>(
      "SELECT * FROM bank_transactions WHERE ledger_id = ? AND status = 'pending' ORDER BY date",
      [ledgerId],
    );

    let classified = 0;
    let suggested = 0;
    let unclassified = 0;

    for (const row of rows) {
      const result = await engine.classify(ledgerId, {
        description: row.description,
        category: row.category,
        amount: row.amount,
      });

      if (!result) {
        unclassified++;
        continue;
      }

      if (result.confidence >= 0.95) {
        await this.db.run(
          `UPDATE bank_transactions
           SET status = 'matched', suggested_account_id = ?, is_personal = ?,
               match_confidence = ?, updated_at = ?
           WHERE id = ?`,
          [result.accountId, result.isPersonal ? 1 : 0, result.confidence, ts, row.id],
        );

        // Fire-and-forget: record high-confidence auto-matches to global table
        const canonical = await this.getAliasService().normalise(row.description);
        const acctRow = await this.db.get<{ type: string }>(
          "SELECT type FROM accounts WHERE id = ?",
          [result.accountId],
        );
        if (acctRow) {
          recordClassification(
            this.db, canonical, acctRow.type, result.accountName,
            result.accountCode, result.isPersonal,
          ).catch(() => { /* never block */ });
        }

        classified++;
      } else if (result.confidence >= 0.60) {
        // Mark as suggested — keep status as pending but set the suggestion
        await this.db.run(
          `UPDATE bank_transactions
           SET suggested_account_id = ?, is_personal = ?,
               match_confidence = ?, updated_at = ?
           WHERE id = ?`,
          [result.accountId, result.isPersonal ? 1 : 0, result.confidence, ts, row.id],
        );
        suggested++;
      } else {
        unclassified++;
      }
    }

    return ok({ classified, suggested, unclassified });
  }

  // --- Manual classification with auto-rule generation ---

  async classifyBankTransaction(
    bankTransactionId: string,
    accountId: string,
    isPersonal: boolean,
  ): Promise<Result<BankTransaction>> {
    const row = await this.db.get<BankTransactionRow>(
      "SELECT * FROM bank_transactions WHERE id = ?",
      [bankTransactionId],
    );
    if (!row) {
      return err(createError(ErrorCode.INTERNAL_ERROR, "Bank transaction not found"));
    }

    const ts = nowUtc();

    // Update the bank transaction
    await this.db.run(
      `UPDATE bank_transactions
       SET status = 'matched', suggested_account_id = ?, is_personal = ?,
           match_confidence = 1.0, updated_at = ?
       WHERE id = ?`,
      [accountId, isPersonal ? 1 : 0, ts, bankTransactionId],
    );

    // Try to auto-generate a rule
    await this.getRulesService().autoGenerateRule(
      row.ledger_id,
      row.description,
      accountId,
      isPersonal,
    );

    // Fire-and-forget: record to global crowdsourced classification table.
    // Only record if we have a real account (not personal-only mark).
    if (accountId) {
      const acct = await this.db.get<{ type: string; name: string; code: string }>(
        "SELECT type, name, code FROM accounts WHERE id = ?",
        [accountId],
      );
      if (acct) {
        const canonical = await this.getAliasService().normalise(row.description);
        recordClassification(this.db, canonical, acct.type, acct.name, acct.code, isPersonal)
          .catch(() => { /* never block the user action */ });
      }
    }

    const updated = await this.db.get<BankTransactionRow>(
      "SELECT * FROM bank_transactions WHERE id = ?",
      [bankTransactionId],
    );
    return ok(toBankTransaction(updated!));
  }

  // --- Merchant aliases ---

  async listMerchantAliases(): Promise<Result<readonly MerchantAlias[]>> {
    const aliases = await this.getAliasService().listAliases();
    return ok(aliases);
  }

  async addMerchantAlias(
    canonicalName: string,
    alias: string,
  ): Promise<Result<MerchantAlias>> {
    const result = await this.getAliasService().addAlias(canonicalName, alias);
    return ok(result);
  }

  // -------------------------------------------------------------------------
  // Recurring entries
  // -------------------------------------------------------------------------

  async createRecurringEntry(input: CreateRecurringEntryInput): Promise<Result<RecurringEntry>> {
    return createRecurringEntryFn(this.db, input);
  }

  async listRecurringEntries(ledgerId: string): Promise<Result<readonly RecurringEntry[]>> {
    return listRecurringEntriesFn(this.db, ledgerId);
  }

  async getRecurringEntry(id: string): Promise<Result<RecurringEntry>> {
    return getRecurringEntryFn(this.db, id);
  }

  async updateRecurringEntry(id: string, input: UpdateRecurringEntryInput): Promise<Result<RecurringEntry>> {
    return updateRecurringEntryFn(this.db, id, input);
  }

  async deleteRecurringEntry(id: string): Promise<Result<{ id: string; deleted: true }>> {
    return deleteRecurringEntryFn(this.db, id);
  }

  async pauseRecurringEntry(id: string): Promise<Result<RecurringEntry>> {
    return pauseRecurringEntryFn(this.db, id);
  }

  async resumeRecurringEntry(id: string): Promise<Result<RecurringEntry>> {
    return resumeRecurringEntryFn(this.db, id);
  }

  async getRecurringEntryLogs(entryId: string, limit?: number): Promise<readonly RecurringEntryLog[]> {
    return getLogsForEntryFn(this.db, entryId, limit);
  }

  async processRecurringEntries(): Promise<{ processed: number; failed: number }> {
    return processRecurringEntriesFn(this);
  }

  // -------------------------------------------------------------------------
  // Period close operations
  // -------------------------------------------------------------------------

  /**
   * Close a period through a given date. Prevents posting transactions
   * on or before that date. Records an audit trail in closed_periods.
   */
  async closePeriod(
    ledgerId: string,
    periodEnd: string,
    closedBy: string,
  ): Promise<Result<{ periodEnd: string; closedAt: string }>> {
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) return err(ledgerNotFoundError(ledgerId));

    // If already closed through a later date, nothing to do
    if (ledger.closed_through && ledger.closed_through >= periodEnd) {
      return ok({ periodEnd, closedAt: nowUtc() });
    }

    const now = nowUtc();
    const id = generateId();

    // Insert closed_periods record
    await this.db.run(
      `INSERT INTO closed_periods (id, ledger_id, period_end, closed_at, closed_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (ledger_id, period_end) DO UPDATE SET closed_at = ?, closed_by = ?, reopened_at = NULL, reopened_by = NULL`,
      [id, ledgerId, periodEnd, now, closedBy, now, now, closedBy],
    );

    // Update the ledger's closed_through to the max of current and new
    await this.db.run(
      "UPDATE ledgers SET closed_through = ?, updated_at = ? WHERE id = ?",
      [periodEnd, now, ledgerId],
    );

    // Audit
    const auditId = generateId();
    await this.db.run(
      `INSERT INTO audit_entries (id, ledger_id, entity_type, entity_id, action, actor_type, actor_id, snapshot, created_at)
       VALUES (?, ?, 'ledger', ?, 'updated', 'user', ?, ?, ?)`,
      [auditId, ledgerId, ledgerId, closedBy, JSON.stringify({ action: "close_period", periodEnd }), now],
    );

    return ok({ periodEnd, closedAt: now });
  }

  /**
   * Reopen a closed period. Sets closed_through to the period before
   * the reopened one (or null if reopening the earliest period).
   */
  async reopenPeriod(
    ledgerId: string,
    periodEnd: string,
    reopenedBy: string,
  ): Promise<Result<{ periodEnd: string; reopenedAt: string }>> {
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) return err(ledgerNotFoundError(ledgerId));

    const now = nowUtc();

    // Mark the closed_periods record as reopened
    await this.db.run(
      `UPDATE closed_periods SET reopened_at = ?, reopened_by = ?
       WHERE ledger_id = ? AND period_end = ? AND reopened_at IS NULL`,
      [now, reopenedBy, ledgerId, periodEnd],
    );

    // Recalculate closed_through: max period_end that is still closed (not reopened)
    const maxClosed = await this.db.get<{ max_period: string | null }>(
      `SELECT MAX(period_end) as max_period FROM closed_periods
       WHERE ledger_id = ? AND reopened_at IS NULL`,
      [ledgerId],
    );

    const newClosedThrough = maxClosed?.max_period ?? null;
    await this.db.run(
      "UPDATE ledgers SET closed_through = ?, updated_at = ? WHERE id = ?",
      [newClosedThrough, now, ledgerId],
    );

    // Audit
    const auditId2 = generateId();
    await this.db.run(
      `INSERT INTO audit_entries (id, ledger_id, entity_type, entity_id, action, actor_type, actor_id, snapshot, created_at)
       VALUES (?, ?, 'ledger', ?, 'updated', 'user', ?, ?, ?)`,
      [auditId2, ledgerId, ledgerId, reopenedBy, JSON.stringify({ action: "reopen_period", periodEnd }), now],
    );

    return ok({ periodEnd, reopenedAt: now });
  }

  /**
   * Check if a specific date falls within a closed period.
   */
  async isPeriodClosed(ledgerId: string, date: string): Promise<boolean> {
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) return false;
    return !!(ledger.closed_through && date <= ledger.closed_through);
  }

  /**
   * List all closed periods for a ledger (including reopened history).
   */
  async listClosedPeriods(ledgerId: string): Promise<readonly ClosedPeriod[]> {
    const rows = await this.db.all<ClosedPeriodRow>(
      `SELECT * FROM closed_periods WHERE ledger_id = ? ORDER BY period_end DESC`,
      [ledgerId],
    );
    return rows.map(toClosedPeriod);
  }

  // -------------------------------------------------------------------------
  // Ledger update — update mutable settings
  // -------------------------------------------------------------------------

  async updateLedger(
    ledgerId: string,
    updates: { name?: string; fiscalYearStart?: number },
  ): Promise<Result<Ledger>> {
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    if (!ledger) return err(ledgerNotFoundError(ledgerId));

    const now = nowUtc();
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.name !== undefined) {
      sets.push("name = ?");
      params.push(updates.name);
    }
    if (updates.fiscalYearStart !== undefined) {
      if (updates.fiscalYearStart < 1 || updates.fiscalYearStart > 12) {
        return err(createError(ErrorCode.VALIDATION_ERROR, "fiscalYearStart must be between 1 and 12"));
      }
      sets.push("fiscal_year_start = ?");
      params.push(updates.fiscalYearStart);
    }

    if (sets.length === 0) {
      return ok(toLedger(ledger));
    }

    sets.push("updated_at = ?");
    params.push(now);
    params.push(ledgerId);

    await this.db.run(
      `UPDATE ledgers SET ${sets.join(", ")} WHERE id = ?`,
      params,
    );

    const updated = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [ledgerId]);
    return ok(toLedger(updated!));
  }

}

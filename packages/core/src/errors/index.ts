import type { KountaError, ErrorDetail } from "../types/index.js";

// ---------------------------------------------------------------------------
// Error codes — every error the engine can return
// ---------------------------------------------------------------------------

export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNBALANCED_TRANSACTION: "UNBALANCED_TRANSACTION",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  ACCOUNT_WRONG_LEDGER: "ACCOUNT_WRONG_LEDGER",
  LEDGER_NOT_FOUND: "LEDGER_NOT_FOUND",
  TRANSACTION_NOT_FOUND: "TRANSACTION_NOT_FOUND",
  TRANSACTION_ALREADY_REVERSED: "TRANSACTION_ALREADY_REVERSED",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  PERIOD_CLOSED: "PERIOD_CLOSED",
  TEMPLATE_NOT_FOUND: "TEMPLATE_NOT_FOUND",
  DUPLICATE_ACCOUNT_CODE: "DUPLICATE_ACCOUNT_CODE",
  IMPORT_NOT_FOUND: "IMPORT_NOT_FOUND",
  IMPORT_PARSE_ERROR: "IMPORT_PARSE_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  API_KEY_NOT_FOUND: "API_KEY_NOT_FOUND",
  PLAN_LIMIT_REACHED: "PLAN_LIMIT_REACHED",
  PLAN_LIMIT_EXCEEDED: "PLAN_LIMIT_EXCEEDED",
  BANK_CONNECTION_NOT_FOUND: "BANK_CONNECTION_NOT_FOUND",
  BANK_ACCOUNT_NOT_FOUND: "BANK_ACCOUNT_NOT_FOUND",
  BANK_FEED_PROVIDER_ERROR: "BANK_FEED_PROVIDER_ERROR",
  BANK_FEED_SYNC_IN_PROGRESS: "BANK_FEED_SYNC_IN_PROGRESS",
  BANK_FEED_NOT_CONFIGURED: "BANK_FEED_NOT_CONFIGURED",
  NOTIFICATION_NOT_FOUND: "NOTIFICATION_NOT_FOUND",
  EXCHANGE_RATE_NOT_FOUND: "EXCHANGE_RATE_NOT_FOUND",
  CURRENCY_NOT_ENABLED: "CURRENCY_NOT_ENABLED",
  CURRENCY_MISMATCH: "CURRENCY_MISMATCH",
  CONVERSATION_NOT_FOUND: "CONVERSATION_NOT_FOUND",
  ATTACHMENT_NOT_FOUND: "ATTACHMENT_NOT_FOUND",
  FIXED_ASSET_NOT_FOUND: "FIXED_ASSET_NOT_FOUND",
  FIXED_ASSET_INVALID_STATE: "FIXED_ASSET_INVALID_STATE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

// ---------------------------------------------------------------------------
// Error constructors — every error includes a suggestion for correction
// ---------------------------------------------------------------------------

export const createError = (
  code: ErrorCodeValue,
  message: string,
  details?: readonly ErrorDetail[]
): KountaError => ({
  code,
  message,
  details,
});

export const validationError = (
  message: string,
  details?: readonly ErrorDetail[]
): KountaError => createError(ErrorCode.VALIDATION_ERROR, message, details);

export const unbalancedTransactionError = (
  debitTotal: number,
  creditTotal: number
): KountaError =>
  createError(
    ErrorCode.UNBALANCED_TRANSACTION,
    `Transaction is unbalanced: debits (${debitTotal}) do not equal credits (${creditTotal})`,
    [
      {
        field: "lines",
        expected: `equal debit and credit totals`,
        actual: `debits=${debitTotal}, credits=${creditTotal}`,
        suggestion: `Adjust line amounts so debits and credits both sum to the same value. Difference: ${Math.abs(debitTotal - creditTotal)}`,
      },
    ]
  );

export const accountNotFoundError = (identifier: string): KountaError =>
  createError(ErrorCode.ACCOUNT_NOT_FOUND, `Account not found: ${identifier}`, [
    {
      field: "accountCode",
      actual: identifier,
      suggestion:
        "Verify the account code or ID exists in this ledger. Use GET /v1/ledgers/:ledgerId/accounts to list all accounts.",
    },
  ]);

export const accountInactiveError = (identifier: string): KountaError =>
  createError(ErrorCode.ACCOUNT_INACTIVE, `Account is inactive: ${identifier}`, [
    {
      field: "accountCode",
      actual: identifier,
      suggestion:
        "This account has been archived. Reactivate it or use a different active account.",
    },
  ]);

export const accountWrongLedgerError = (
  accountId: string,
  expectedLedgerId: string
): KountaError =>
  createError(
    ErrorCode.ACCOUNT_WRONG_LEDGER,
    `Account ${accountId} does not belong to ledger ${expectedLedgerId}`,
    [
      {
        field: "accountCode",
        actual: accountId,
        expected: `account in ledger ${expectedLedgerId}`,
        suggestion:
          "All line items in a transaction must reference accounts that belong to the same ledger.",
      },
    ]
  );

export const ledgerNotFoundError = (id: string): KountaError =>
  createError(ErrorCode.LEDGER_NOT_FOUND, `Ledger not found: ${id}`, [
    {
      field: "ledgerId",
      actual: id,
      suggestion:
        "Check that the ledger ID is correct. Use POST /v1/ledgers to create a new ledger, or verify the ID with your admin.",
    },
  ]);

export const transactionNotFoundError = (id: string): KountaError =>
  createError(
    ErrorCode.TRANSACTION_NOT_FOUND,
    `Transaction not found: ${id}`,
    [
      {
        field: "transactionId",
        actual: id,
        suggestion:
          "Verify the transaction ID is correct and belongs to this ledger. Use GET /v1/ledgers/:ledgerId/transactions to list transactions.",
      },
    ]
  );

export const transactionAlreadyReversedError = (id: string): KountaError =>
  createError(
    ErrorCode.TRANSACTION_ALREADY_REVERSED,
    `Transaction ${id} has already been reversed`,
    [
      {
        field: "transactionId",
        actual: id,
        suggestion:
          "A transaction can only be reversed once. If you need to correct the reversal, post a new transaction with the corrected amounts.",
      },
    ]
  );

export const periodClosedError = (
  transactionDate: string,
  closedThrough: string
): KountaError =>
  createError(
    ErrorCode.PERIOD_CLOSED,
    `Cannot post transaction dated ${transactionDate}: period is closed through ${closedThrough}`,
    [
      {
        field: "date",
        actual: transactionDate,
        expected: `after ${closedThrough}`,
        suggestion: `Use a date after ${closedThrough}, or ask an admin to reopen the period.`,
      },
    ]
  );

export const idempotencyConflictError = (key: string): KountaError =>
  createError(
    ErrorCode.IDEMPOTENCY_CONFLICT,
    `Idempotency key "${key}" already exists with different parameters`,
    [
      {
        field: "idempotencyKey",
        actual: key,
        suggestion:
          "This key was used for a previous transaction with different data. Use a unique idempotency key for each distinct transaction, or send the exact same request to retrieve the original.",
      },
    ]
  );

export const duplicateAccountCodeError = (
  code: string,
  ledgerId: string
): KountaError =>
  createError(
    ErrorCode.DUPLICATE_ACCOUNT_CODE,
    `Account code "${code}" already exists in ledger ${ledgerId}`,
    [
      {
        field: "code",
        actual: code,
        suggestion:
          "Choose a unique account code for this ledger. Use GET /v1/ledgers/:ledgerId/accounts to see existing codes.",
      },
    ]
  );

export const templateNotFoundError = (idOrSlug: string): KountaError =>
  createError(
    ErrorCode.TEMPLATE_NOT_FOUND,
    `Template not found: ${idOrSlug}`,
    [
      {
        field: "templateSlug",
        actual: idOrSlug,
        suggestion:
          "Use GET /v1/templates to list all available templates. Valid slugs include: saas, ecommerce, marketplace, agency, freelancer, nonprofit, manufacturing, retail.",
      },
    ]
  );

export const unauthorizedError = (
  message = "Authentication required"
): KountaError =>
  createError(ErrorCode.UNAUTHORIZED, message, [
    {
      field: "Authorization",
      suggestion:
        'Provide a valid API key via "Authorization: Bearer <key>" header or "X-Api-Key: <key>" header. Create keys at POST /v1/api-keys.',
    },
  ]);

export const forbiddenError = (
  message = "Access denied"
): KountaError =>
  createError(ErrorCode.FORBIDDEN, message, [
    {
      field: "Authorization",
      suggestion:
        "Your API key does not have access to this resource. Ensure the key is scoped to the correct ledger.",
    },
  ]);

export const apiKeyNotFoundError = (id: string): KountaError =>
  createError(ErrorCode.API_KEY_NOT_FOUND, `API key not found: ${id}`, [
    {
      field: "keyId",
      actual: id,
      suggestion:
        "Check that the API key ID is correct and has not been revoked. Use GET /v1/api-keys?ledgerId=<id> to list keys.",
    },
  ]);

export const importNotFoundError = (id: string): KountaError =>
  createError(ErrorCode.IMPORT_NOT_FOUND, `Import batch not found: ${id}`, [
    {
      field: "batchId",
      actual: id,
      suggestion:
        "Verify the import batch ID is correct. Use GET /v1/ledgers/:ledgerId/imports to list batches.",
    },
  ]);

export const importParseError = (
  message: string,
  details?: readonly ErrorDetail[],
): KountaError =>
  createError(
    ErrorCode.IMPORT_PARSE_ERROR,
    message,
    details && details.length > 0
      ? details
      : [
          {
            field: "fileContent",
            suggestion:
              "Check that the file is valid CSV or OFX format. CSV files must include date, amount, and payee columns.",
          },
        ]
  );


export const planLimitReachedError = (
  count: number,
  limit: number,
  nextResetDate: string,
  upgradeUrl: string
): KountaError =>
  createError(
    ErrorCode.PLAN_LIMIT_REACHED,
    `Free plan soft limit reached (${count}/${limit}). Transaction accepted as pending.`,
    [
      {
        field: "plan",
        actual: `${count} transactions used`,
        expected: `under ${limit}`,
        suggestion: `Upgrade at ${upgradeUrl} to post transactions immediately. Usage resets on ${nextResetDate}.`,
      },
    ]
  );

export const planLimitExceededError = (
  count: number,
  limit: number,
  nextResetDate: string,
  upgradeUrl: string
): KountaError =>
  createError(
    ErrorCode.PLAN_LIMIT_EXCEEDED,
    `Free plan hard limit exceeded (${count}/${limit}). Transaction rejected.`,
    [
      {
        field: "plan",
        actual: `${count} transactions used`,
        expected: `under ${limit + 100}`,
        suggestion: `Upgrade at ${upgradeUrl} to remove limits. Usage resets on ${nextResetDate}.`,
      },
    ]
  );

export const bankConnectionNotFoundError = (id: string): KountaError =>
  createError(ErrorCode.BANK_CONNECTION_NOT_FOUND, `Bank connection not found: ${id}`, [
    {
      field: "connectionId",
      actual: id,
      suggestion:
        "Verify the connection ID is correct. Use GET /v1/ledgers/:ledgerId/bank-feeds/connections to list connections.",
    },
  ]);

export const bankAccountNotFoundError = (id: string): KountaError =>
  createError(ErrorCode.BANK_ACCOUNT_NOT_FOUND, `Bank account not found: ${id}`, [
    {
      field: "bankAccountId",
      actual: id,
      suggestion:
        "Verify the bank account ID is correct. Use GET /v1/ledgers/:ledgerId/bank-feeds/connections/:connectionId/accounts to list accounts.",
    },
  ]);

export const bankFeedProviderError = (provider: string, message: string): KountaError =>
  createError(ErrorCode.BANK_FEED_PROVIDER_ERROR, `Bank feed provider error (${provider}): ${message}`, [
    {
      field: "provider",
      actual: provider,
      suggestion: "Check your bank feed provider configuration and credentials. The external provider may be temporarily unavailable.",
    },
  ]);

export const bankFeedSyncInProgressError = (connectionId: string): KountaError =>
  createError(ErrorCode.BANK_FEED_SYNC_IN_PROGRESS, `A sync is already in progress for connection ${connectionId}`, [
    {
      field: "connectionId",
      actual: connectionId,
      suggestion: "Wait for the current sync to complete before starting another. Check GET /v1/ledgers/:ledgerId/bank-feeds/sync-log for status.",
    },
  ]);

export const bankFeedNotConfiguredError = (): KountaError =>
  createError(ErrorCode.BANK_FEED_NOT_CONFIGURED, "Bank feed provider is not configured", [
    {
      field: "provider",
      suggestion: "Set BASIQ_API_KEY environment variable to enable bank feeds. Bank feeds require a Builder plan or higher.",
    },
  ]);

export const notificationNotFoundError = (id: string): KountaError =>
  createError(ErrorCode.NOTIFICATION_NOT_FOUND, `Notification not found: ${id}`, [
    {
      field: "notificationId",
      actual: id,
      suggestion:
        "Verify the notification ID is correct. Use GET /v1/ledgers/:ledgerId/notifications to list notifications.",
    },
  ]);

export const exchangeRateNotFoundError = (
  fromCurrency: string,
  toCurrency: string,
  date?: string,
): KountaError =>
  createError(
    ErrorCode.EXCHANGE_RATE_NOT_FOUND,
    `No exchange rate found for ${fromCurrency}/${toCurrency}${date ? ` on or before ${date}` : ""}`,
    [
      {
        field: "exchangeRate",
        actual: `${fromCurrency}/${toCurrency}`,
        suggestion:
          "Set an exchange rate first using POST /v1/ledgers/:ledgerId/exchange-rates, or provide the rate directly on the line item.",
      },
    ]
  );

export const currencyNotEnabledError = (currencyCode: string): KountaError =>
  createError(
    ErrorCode.CURRENCY_NOT_ENABLED,
    `Currency ${currencyCode} is not enabled on this ledger`,
    [
      {
        field: "currency",
        actual: currencyCode,
        suggestion:
          "Enable the currency first using POST /v1/ledgers/:ledgerId/currencies with the currency code.",
      },
    ]
  );

export const currencyMismatchError = (
  accountCode: string,
  accountCurrency: string,
  lineCurrency: string,
): KountaError =>
  createError(
    ErrorCode.CURRENCY_MISMATCH,
    `Account ${accountCode} is restricted to ${accountCurrency} but line item uses ${lineCurrency}`,
    [
      {
        field: "currency",
        actual: lineCurrency,
        expected: accountCurrency,
        suggestion:
          "Use the correct currency for this account, or use an account that accepts the desired currency.",
      },
    ]
  );

export const internalError = (
  message = "An unexpected error occurred"
): KountaError =>
  createError(ErrorCode.INTERNAL_ERROR, message, [
    {
      field: "request",
      suggestion:
        "This is a server error. Retry the request, and if the problem persists, contact support with the requestId from this response.",
    },
  ]);

export const conversationNotFoundError = (id: string): KountaError =>
  createError(ErrorCode.CONVERSATION_NOT_FOUND, `Conversation not found: ${id}`, [
    {
      field: "conversationId",
      actual: id,
      suggestion:
        "Verify the conversation ID is correct. Use GET /v1/ledgers/:ledgerId/conversations to list conversations.",
    },
  ]);

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

export const ok = <T>(value: T) => ({ ok: true as const, value });
export const err = <E>(error: E) => ({ ok: false as const, error });

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const uuidV7 = z.string().uuid();
export const isoDate = z.string().date();
export const isoTimestamp = z.string().datetime();
export const currencyCode = z.string().length(3).toUpperCase();
export const positiveInt = z.number().int().positive();

export const accountType = z.enum([
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
]);

export const normalBalance = z.enum(["debit", "credit"]);
export const direction = z.enum(["debit", "credit"]);
export const transactionStatus = z.enum(["posted", "reversed"]);
export const sourceType = z.enum(["api", "mcp", "import", "manual"]);
export const accountingBasis = z.enum(["accrual", "cash"]);
export const ledgerStatus = z.enum(["active", "archived"]);
export const accountStatus = z.enum(["active", "archived"]);
export const apiKeyStatus = z.enum(["active", "revoked"]);
export const importBatchStatus = z.enum([
  "pending",
  "processing",
  "complete",
  "failed",
]);
export const matchStatus = z.enum(["matched", "suggested", "unmatched"]);
export const auditAction = z.enum(["created", "reversed", "archived", "updated"]);
export const actorType = z.enum(["user", "agent", "system"]);
export const statementType = z.enum(["pnl", "balance_sheet", "cash_flow"]);

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export const createLedgerSchema = z.object({
  name: z.string().min(1).max(255),
  currency: currencyCode.default("USD"),
  templateSlug: z.string().optional(),
  businessType: z.string().optional(),
  naturalLanguageDescription: z.string().optional(),
  businessContext: z.record(z.unknown()).optional(),
  fiscalYearStart: z.number().int().min(1).max(12).default(1),
  accountingBasis: accountingBasis.default("accrual"),
});

export type CreateLedgerInput = z.infer<typeof createLedgerSchema>;

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export const createAccountSchema = z.object({
  ledgerId: uuidV7,
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  type: accountType,
  normalBalance: normalBalance.optional(),
  parentCode: z.string().optional(),
  currency: currencyCode.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
  status: accountStatus.optional(),
});

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

export const postLineSchema = z.object({
  accountCode: z.string().min(1),
  amount: positiveInt,
  direction: direction,
  memo: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  currency: currencyCode.optional(),
  originalAmount: positiveInt.optional(),
  exchangeRate: z.number().positive().optional(),
});

// ---------------------------------------------------------------------------
// Transaction validation: debits must equal credits
// ---------------------------------------------------------------------------

export const balancedLinesSchema = z
  .array(postLineSchema)
  .min(2)
  .refine(
    (lines) => {
      const debits = lines
        .filter((l) => l.direction === "debit")
        .reduce((sum, l) => sum + l.amount, 0);
      const credits = lines
        .filter((l) => l.direction === "credit")
        .reduce((sum, l) => sum + l.amount, 0);
      return debits === credits;
    },
    {
      message:
        "Transaction is unbalanced: total debits must equal total credits",
    }
  );

export const postTransactionSchema = z.object({
  ledgerId: uuidV7,
  date: isoDate,
  effectiveDate: isoDate.optional(),
  memo: z.string().min(1).max(1000),
  lines: z.array(postLineSchema).min(2),
  idempotencyKey: z.string().max(255).optional(),
  sourceType: sourceType.optional(),
  sourceRef: z.string().max(500).optional(),
  agentId: z.string().max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type PostTransactionSchema = z.infer<typeof postTransactionSchema>;

export const reverseTransactionSchema = z.object({
  transactionId: uuidV7,
  reason: z.string().min(1).max(1000),
});

export type ReverseTransactionSchema = z.infer<typeof reverseTransactionSchema>;

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export const statementQuerySchema = z.object({
  ledgerId: uuidV7,
  type: statementType,
  startDate: isoDate,
  endDate: isoDate,
  comparePrior: z.boolean().default(false),
});

export type StatementQueryInput = z.infer<typeof statementQuerySchema>;

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export const createImportSchema = z.object({
  ledgerId: uuidV7,
  fileContent: z.string().min(1),
  fileType: z.enum(["csv", "ofx"]),
  filename: z.string().optional(),
});

export type CreateImportInput = z.infer<typeof createImportSchema>;

export const confirmActionSchema = z.object({
  rowId: uuidV7,
  action: z.enum(["confirm", "reject", "override"]),
  overrideTransactionId: uuidV7.optional(),
});

export const confirmMatchesSchema = z.object({
  batchId: uuidV7,
  actions: z.array(confirmActionSchema).min(1),
});

export type ConfirmMatchesInput = z.infer<typeof confirmMatchesSchema>;

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

// ---------------------------------------------------------------------------
// API Error
// ---------------------------------------------------------------------------

export const errorDetailSchema = z.object({
  field: z.string(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  suggestion: z.string().optional(),
});

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.array(errorDetailSchema).optional(),
  requestId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Multi-currency
// ---------------------------------------------------------------------------

export const exchangeRateSource = z.enum(["manual", "api", "import"]);

export const enableCurrencySchema = z.object({
  currencyCode: currencyCode,
  decimalPlaces: z.number().int().min(0).max(4).optional(),
  symbol: z.string().min(1).max(10).optional(),
});

export type EnableCurrencyInput = z.infer<typeof enableCurrencySchema>;

export const setExchangeRateSchema = z.object({
  fromCurrency: currencyCode,
  toCurrency: currencyCode,
  rate: z.number().positive(),
  effectiveDate: isoDate,
  source: exchangeRateSource.default("manual"),
});

export type SetExchangeRateInput = z.infer<typeof setExchangeRateSchema>;

export const convertAmountSchema = z.object({
  fromCurrency: currencyCode,
  toCurrency: currencyCode,
  amount: positiveInt,
  date: isoDate.optional(),
});

export type ConvertAmountInput = z.infer<typeof convertAmountSchema>;

export const revalueAccountsSchema = z.object({
  date: isoDate,
});

export type RevalueAccountsInput = z.infer<typeof revalueAccountsSchema>;

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
  Result,
  StatementResponse,
} from "../types/index.js";
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
  createError,
} from "../errors/index.js";
import { createLedgerSchema, createAccountSchema, postTransactionSchema, createImportSchema, confirmMatchesSchema } from "../schemas/index.js";
import { generateId, nowUtc } from "./id.js";

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
  business_context: string | null;
  fiscal_year_start: number;
  accounting_basis: string;
  status: string;
  owner_id: string;
  closed_through: string | null;
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
  metadata: string | null;
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
  metadata: string | null;
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
  memo: string | null;
  metadata: string | null;
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
  snapshot: string;
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
  raw_data: string;
  match_status: string;
  matched_transaction_id: string | null;
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

interface BalanceRow {
  balance: number;
}

// ---------------------------------------------------------------------------
// Row → Domain mappers
// ---------------------------------------------------------------------------

const toLedger = (row: LedgerRow): Ledger => ({
  id: row.id,
  name: row.name,
  currency: row.currency,
  templateId: row.template_id,
  businessContext: row.business_context ? JSON.parse(row.business_context) as Record<string, unknown> : null,
  fiscalYearStart: row.fiscal_year_start,
  accountingBasis: row.accounting_basis as Ledger["accountingBasis"],
  status: row.status as Ledger["status"],
  ownerId: row.owner_id,
  closedThrough: row.closed_through,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
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
  metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : null,
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
  metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : null,
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
  memo: row.memo,
  metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : null,
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
  snapshot: JSON.parse(row.snapshot) as Record<string, unknown>,
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
  rawData: JSON.parse(row.raw_data) as Record<string, unknown>,
  matchStatus: row.match_status as ImportRow["matchStatus"],
  matchedTransactionId: row.matched_transaction_id,
  confidence: row.confidence,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
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
  readonly metadata?: Record<string, unknown>;
}

export interface CreateApiKeyParams {
  readonly userId: string;
  readonly ledgerId: string;
  readonly name: string;
}

export class LedgerEngine {
  constructor(private readonly db: Database) {}

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
        [params.ownerId, `user-${params.ownerId.substring(0, 8)}@ledge.internal`, "Auto-created User", "system", params.ownerId, now, now]
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
      `INSERT INTO accounts (id, ledger_id, parent_id, code, name, type, normal_balance, is_system, metadata, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [id, params.ledgerId, parentId, params.code, params.name, params.type, normalBalance, false, metadata, now, now]
    );

    const row = await this.db.get<AccountRow>("SELECT * FROM accounts WHERE id = ?", [id]);
    if (!row) {
      return err(createError(ErrorCode.INTERNAL_ERROR, "Failed to create account"));
    }
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

    const accounts: AccountWithBalance[] = [];
    for (const row of rows) {
      const account = toAccount(row);
      const balance = await this.computeBalance(row.id, account.normalBalance);
      accounts.push({ ...account, balance });
    }

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

    // Verify ledger exists
    const ledger = await this.db.get<LedgerRow>("SELECT * FROM ledgers WHERE id = ?", [input.ledgerId]);
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

    // Resolve account codes to IDs and validate all accounts belong to this ledger
    const resolvedLines: Array<{ accountId: string; line: PostLineInput }> = [];
    for (const line of input.lines) {
      const account = await this.db.get<AccountRow>(
        "SELECT * FROM accounts WHERE ledger_id = ? AND code = ?",
        [input.ledgerId, line.accountCode]
      );
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

    // Idempotency check — if this key already exists, return the original transaction
    const existingTxn = await this.db.get<TransactionRow>(
      "SELECT * FROM transactions WHERE ledger_id = ? AND idempotency_key = ?",
      [input.ledgerId, idempotencyKey]
    );

    if (existingTxn) {
      // If the key exists, verify the parameters match (simplified: just return existing)
      // A full implementation would compare all input fields for true idempotency conflict detection.
      const existingLines = await this.db.all<LineItemRow>(
        "SELECT * FROM line_items WHERE transaction_id = ? ORDER BY created_at",
        [existingTxn.id]
      );
      return ok({
        ...toTransaction(existingTxn),
        lines: existingLines.map(toLineItem),
      } as TransactionWithLines);
    }

    // All validations passed — insert within a DB transaction
    const result = await this.db.transaction(async () => {
      const txnId = generateId();
      const now = nowUtc();
      const sourceType = input.sourceType ?? "api";
      const metadata = input.metadata ? JSON.stringify(input.metadata) : null;

      await this.db.run(
        `INSERT INTO transactions (id, ledger_id, idempotency_key, date, effective_date, memo, status, source_type, source_ref, agent_id, metadata, posted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?, ?)`,
        [
          txnId,
          input.ledgerId,
          idempotencyKey,
          input.date,
          input.effectiveDate ?? null,
          input.memo,
          sourceType,
          input.sourceRef ?? null,
          input.agentId ?? null,
          metadata,
          now,
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

        await this.db.run(
          `INSERT INTO line_items (id, transaction_id, account_id, amount, direction, memo, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [lineId, txnId, accountId, line.amount, line.direction, line.memo ?? null, lineMeta, now, now]
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

      if (!balanceCheck || balanceCheck.debit_total !== balanceCheck.credit_total || balanceCheck.line_count < 2) {
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

    const transactions: TransactionWithLines[] = [];
    for (const row of pageRows) {
      const lines = await this.db.all<LineItemRow>(
        "SELECT * FROM line_items WHERE transaction_id = ? ORDER BY created_at",
        [row.id]
      );
      transactions.push({
        ...toTransaction(row),
        lines: lines.map(toLineItem),
      } as TransactionWithLines);
    }

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
             WHERE li.account_id = ? AND t.date <= ?`;
      params = [accountId, asOfDate];
    } else {
      sql = `SELECT
               COALESCE(SUM(CASE WHEN li.direction = 'debit' THEN li.amount ELSE 0 END), 0) -
               COALESCE(SUM(CASE WHEN li.direction = 'credit' THEN li.amount ELSE 0 END), 0) AS balance
             FROM line_items li
             WHERE li.account_id = ?`;
      params = [accountId];
    }

    const row = await this.db.get<BalanceRow>(sql, params);
    const rawBalance = row?.balance ?? 0;

    // For credit-normal accounts, invert the sign
    // Debit-normal: balance = debits - credits (positive = debit balance)
    // Credit-normal: balance = credits - debits (positive = credit balance)
    return normalBalance === "credit" ? -rawBalance : rawBalance;
  }

  private async computeBalanceInPeriod(
    accountId: string,
    normalBalance: NormalBalance,
    startDate: string,
    endDate: string,
  ): Promise<number> {
    const sql = `SELECT
                   COALESCE(SUM(CASE WHEN li.direction = 'debit' THEN li.amount ELSE 0 END), 0) -
                   COALESCE(SUM(CASE WHEN li.direction = 'credit' THEN li.amount ELSE 0 END), 0) AS balance
                 FROM line_items li
                 JOIN transactions t ON t.id = li.transaction_id
                 WHERE li.account_id = ? AND t.date >= ? AND t.date <= ?`;

    const row = await this.db.get<BalanceRow>(sql, [accountId, startDate, endDate]);
    const rawBalance = row?.balance ?? 0;
    return normalBalance === "credit" ? -rawBalance : rawBalance;
  }

  private async getAccountCodeById(accountId: string): Promise<string> {
    const row = await this.db.get<AccountRow>("SELECT code FROM accounts WHERE id = ?", [accountId]);
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

    // Generate raw key: ledge_live_ + 24 random bytes (48 hex chars)
    const secret = randomBytes(24).toString("hex");
    const rawKey = `ledge_live_${secret}`;
    const keyHash = hashApiKey(rawKey);
    const prefix = `ledge_live_${secret.slice(0, 8)}`;

    const id = generateId();
    const now = nowUtc();

    // Ensure the user exists (auto-create for admin/system callers)
    const existingUser = await this.db.get("SELECT id FROM users WHERE id = ?", [params.userId]);
    if (!existingUser) {
      await this.db.run(
        "INSERT INTO users (id, email, name, auth_provider, auth_provider_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [params.userId, `user-${params.userId.substring(0, 8)}@ledge.internal`, "Auto-created User", "system", params.userId, now, now]
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
    if (!rawKey.startsWith("ledge_live_") && !rawKey.startsWith("ledge_test_")) {
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
    return ok(toApiKey(updated!));
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

    const accounts: AccountBalanceData[] = [];
    for (const row of rows) {
      accounts.push({
        code: row.code,
        name: row.name,
        type: row.type as AccountType,
        normalBalance: row.normal_balance as NormalBalance,
        balance: await this.computeBalanceInPeriod(row.id, row.normal_balance as NormalBalance, startDate, endDate),
        priorBalance: null,
        metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
      });
    }

    return ok(
      buildIncomeStatement(accounts, { start: startDate, end: endDate }, ledger.currency, ledgerId),
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

    const accounts: AccountBalanceData[] = [];
    for (const row of bsRows) {
      accounts.push({
        code: row.code,
        name: row.name,
        type: row.type as AccountType,
        normalBalance: row.normal_balance as NormalBalance,
        balance: await this.computeBalance(row.id, row.normal_balance as NormalBalance, asOfDate),
        priorBalance: null,
        metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
      });
    }

    // Compute net income (cumulative revenue − expenses through asOfDate)
    const revenueRows = await this.db.all<AccountRow>(
      "SELECT * FROM accounts WHERE ledger_id = ? AND type = 'revenue' AND status = 'active'",
      [ledgerId],
    );
    const expenseRows = await this.db.all<AccountRow>(
      "SELECT * FROM accounts WHERE ledger_id = ? AND type = 'expense' AND status = 'active'",
      [ledgerId],
    );
    let totalRevenue = 0;
    for (const r of revenueRows) {
      totalRevenue += await this.computeBalance(r.id, r.normal_balance as NormalBalance, asOfDate);
    }
    let totalExpenses = 0;
    for (const r of expenseRows) {
      totalExpenses += await this.computeBalance(r.id, r.normal_balance as NormalBalance, asOfDate);
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
    let periodRevenue = 0;
    for (const r of revenueRows) {
      periodRevenue += await this.computeBalanceInPeriod(r.id, r.normal_balance as NormalBalance, startDate, endDate);
    }
    let periodExpenses = 0;
    for (const r of expenseRows) {
      periodExpenses += await this.computeBalanceInPeriod(r.id, r.normal_balance as NormalBalance, startDate, endDate);
    }
    const netIncome = periodRevenue - periodExpenses;

    // Balance sheet accounts with period deltas
    const bsRows = await this.db.all<AccountRow>(
      "SELECT * FROM accounts WHERE ledger_id = ? AND type IN ('asset', 'liability', 'equity') AND status = 'active' ORDER BY code",
      [ledgerId],
    );

    const dayBeforeStart = dayBefore(startDate);

    const accounts: CashFlowAccountData[] = [];
    for (const row of bsRows) {
      const nb = row.normal_balance as NormalBalance;
      const endBalance = await this.computeBalance(row.id, nb, endDate);
      const startBalance = await this.computeBalance(row.id, nb, dayBeforeStart);
      accounts.push({
        code: row.code,
        name: row.name,
        type: row.type as AccountType,
        normalBalance: nb,
        balance: endBalance,
        priorBalance: null,
        metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
        delta: endBalance - startBalance,
      });
    }

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
      ? (JSON.parse(ledger.business_context) as Record<string, unknown>)
      : null;
    const importConfig = businessContext?.importConfig as Partial<MatchConfig> | undefined;
    const config: MatchConfig = {
      autoMatchThreshold: importConfig?.autoMatchThreshold ?? DEFAULT_MATCH_CONFIG.autoMatchThreshold,
      suggestThreshold: importConfig?.suggestThreshold ?? DEFAULT_MATCH_CONFIG.suggestThreshold,
    };

    // Fetch existing posted transactions for matching
    const txnRows = await this.db.all<TransactionRow>(
      "SELECT * FROM transactions WHERE ledger_id = ? AND status = 'posted' ORDER BY date DESC",
      [params.ledgerId],
    );
    const existingTransactions: TransactionWithLines[] = [];
    for (const txnRow of txnRows) {
      const lineRows = await this.db.all<LineItemRow>(
        "SELECT * FROM line_items WHERE transaction_id = ? ORDER BY created_at",
        [txnRow.id],
      );
      existingTransactions.push({
        ...toTransaction(txnRow),
        lines: lineRows.map(toLineItem),
      } as TransactionWithLines);
    }

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
}

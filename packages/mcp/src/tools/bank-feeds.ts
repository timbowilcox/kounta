// ---------------------------------------------------------------------------
// Bank feed MCP tools — connect, sync, match, and manage bank feeds.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerEngine, BankFeedProvider } from "@kounta/core";
import { handleResult, toolErr } from "../lib/helpers.js";

export function registerBankFeedTools(
  server: McpServer,
  engine: LedgerEngine,
  provider: BankFeedProvider | null,
): void {
  // -----------------------------------------------------------------------
  // list_bank_connections
  // -----------------------------------------------------------------------
  server.tool(
    "list_bank_connections",
    "List all bank feed connections for a ledger.",
    {
      ledgerId: z.string().describe("Ledger ID"),
    },
    async ({ ledgerId }) => {
      const result = await engine.listBankConnections(ledgerId);
      return handleResult(result);
    },
  );

  // -----------------------------------------------------------------------
  // list_bank_accounts
  // -----------------------------------------------------------------------
  server.tool(
    "list_bank_accounts",
    "List bank accounts for a specific bank connection.",
    {
      connectionId: z.string().describe("Bank connection ID"),
    },
    async ({ connectionId }) => {
      const result = await engine.listBankAccounts(connectionId);
      return handleResult(result);
    },
  );

  // -----------------------------------------------------------------------
  // sync_bank_account
  // -----------------------------------------------------------------------
  server.tool(
    "sync_bank_account",
    "Trigger a sync of transactions from the bank for a specific account. Fetches new transactions, runs matching against existing ledger entries, and returns a sync summary.",
    {
      bankAccountId: z.string().describe("Bank account ID to sync"),
      fromDate: z.string().optional().describe("Start date for sync window (ISO 8601, default: 90 days ago)"),
      toDate: z.string().optional().describe("End date for sync window (ISO 8601, default: today)"),
    },
    async ({ bankAccountId, fromDate, toDate }) => {
      if (!provider) {
        return toolErr({
          code: "BANK_FEED_NOT_CONFIGURED",
          message: "Bank feed provider is not configured. Set BASIQ_API_KEY to enable.",
        });
      }

      const acctResult = await engine.getBankAccount(bankAccountId);
      if (!acctResult.ok) return handleResult(acctResult);

      const syncFrom =
        fromDate ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;
      const syncTo = toDate ?? new Date().toISOString().split("T")[0]!;

      const result = await engine.syncBankAccount(
        provider,
        acctResult.value.connectionId,
        bankAccountId,
        syncFrom,
        syncTo,
      );
      return handleResult(result);
    },
  );

  // -----------------------------------------------------------------------
  // list_bank_transactions
  // -----------------------------------------------------------------------
  server.tool(
    "list_bank_transactions",
    "List bank transactions for a bank account, optionally filtered by match status.",
    {
      bankAccountId: z.string().describe("Bank account ID"),
      status: z
        .enum(["pending", "matched", "posted", "ignored"])
        .optional()
        .describe("Filter by status: pending (unmatched), matched (suggested match), posted (confirmed), ignored"),
      limit: z.number().int().min(1).max(200).optional().describe("Results per page (default 50)"),
    },
    async ({ bankAccountId, status, limit }) => {
      const result = await engine.listBankTransactions({ bankAccountId, status, limit });
      return handleResult(result);
    },
  );

  // -----------------------------------------------------------------------
  // confirm_bank_match
  // -----------------------------------------------------------------------
  server.tool(
    "confirm_bank_match",
    "Confirm or ignore a suggested bank transaction match. Use after syncing to finalize reconciliation.",
    {
      bankTransactionId: z.string().describe("Bank transaction ID"),
      action: z
        .enum(["confirm", "ignore"])
        .describe("Action: confirm accepts the suggested match, ignore skips it"),
      overrideTransactionId: z
        .string()
        .optional()
        .describe("Manually specify a ledger transaction ID to match against"),
    },
    async ({ bankTransactionId, action, overrideTransactionId }) => {
      const result = await engine.confirmBankTransactionMatch(
        bankTransactionId,
        action,
        overrideTransactionId,
      );
      return handleResult(result);
    },
  );

  // -----------------------------------------------------------------------
  // map_bank_account
  // -----------------------------------------------------------------------
  server.tool(
    "map_bank_account",
    "Map a bank account to a ledger account. This tells the reconciliation engine which ledger account corresponds to this bank account.",
    {
      bankAccountId: z.string().describe("Bank account ID"),
      accountId: z.string().describe("Ledger account ID to map to"),
    },
    async ({ bankAccountId, accountId }) => {
      const result = await engine.mapBankAccountToLedgerAccount(bankAccountId, accountId);
      return handleResult(result);
    },
  );
}

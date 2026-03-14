// ---------------------------------------------------------------------------
// post_transaction, reverse_transaction, search_transactions tools
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerEngine } from "@kounta/core";
import { handleResult } from "../lib/helpers.js";

export function registerTransactionTools(
  server: McpServer,
  engine: LedgerEngine,
): void {
  // -----------------------------------------------------------------------
  // post_transaction
  // -----------------------------------------------------------------------
  server.tool(
    "post_transaction",
    "Post a balanced double-entry transaction to a ledger. Debits must equal credits.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      date: z.string().describe("Transaction date (ISO 8601, e.g. 2024-03-15)"),
      memo: z.string().describe("Transaction description"),
      lines: z
        .array(
          z.object({
            accountCode: z.string().describe("Account code (e.g. 1000)"),
            amount: z.number().int().positive().describe("Amount in smallest currency unit (e.g. cents)"),
            direction: z.enum(["debit", "credit"]).describe("Debit or credit"),
            memo: z.string().optional().describe("Line item memo"),
          }),
        )
        .min(2)
        .describe("Line items (minimum 2, must balance)"),
      effectiveDate: z.string().optional().describe("Effective date if different from date"),
      idempotencyKey: z.string().optional().describe("Unique key to prevent duplicate posts"),
      metadata: z.record(z.unknown()).optional().describe("Additional metadata (JSON)"),
    },
    async ({ ledgerId, date, memo, lines, effectiveDate, idempotencyKey, metadata }) => {
      const result = await engine.postTransaction({
        ledgerId,
        date,
        effectiveDate,
        memo,
        lines,
        idempotencyKey,
        sourceType: "mcp",
        metadata,
      });
      return handleResult(result);
    },
  );

  // -----------------------------------------------------------------------
  // reverse_transaction
  // -----------------------------------------------------------------------
  server.tool(
    "reverse_transaction",
    "Reverse a posted transaction by creating offsetting entries. Original transaction becomes 'reversed'.",
    {
      transactionId: z.string().describe("ID of the transaction to reverse"),
      reason: z.string().describe("Reason for reversal"),
    },
    async ({ transactionId, reason }) => {
      const result = await engine.reverseTransaction(transactionId, reason);
      return handleResult(result);
    },
  );

  // -----------------------------------------------------------------------
  // search_transactions
  // -----------------------------------------------------------------------
  server.tool(
    "search_transactions",
    "List transactions for a ledger with cursor-based pagination.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      cursor: z.string().optional().describe("Pagination cursor from previous response"),
      limit: z.number().int().min(1).max(200).optional().describe("Results per page (default 50, max 200)"),
    },
    async ({ ledgerId, cursor, limit }) => {
      const result = await engine.listTransactions(ledgerId, { cursor, limit });
      return handleResult(result);
    },
  );
}

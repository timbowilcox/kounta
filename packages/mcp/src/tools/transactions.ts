// ---------------------------------------------------------------------------
// post_transaction, reverse_transaction, search_transactions tools
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerEngine } from "@kounta/core";
import { getJurisdictionConfig, incrementUsage } from "@kounta/core";
import { handleResult } from "../lib/helpers.js";
import { mcpCheckLimit, getLedgerOwner } from "../lib/tier-check.js";

export function registerTransactionTools(
  server: McpServer,
  engine: LedgerEngine,
  systemUserId: string,
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
      // Tier limit check
      const db = engine.getDb();
      const ownerId = await getLedgerOwner(db, ledgerId);
      if (ownerId) {
        const limitErr = await mcpCheckLimit(db, ownerId, ledgerId, "transactions");
        if (limitErr) return limitErr;
      }

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

      // Increment tier usage after successful post
      if (result.ok && ownerId) {
        try { await incrementUsage(db, ownerId, ledgerId, "transactions_count"); } catch { /* best-effort */ }
      }

      // Capitalisation check — best-effort notification for large expenses
      if (result.ok) {
        try {
          const tx = result.value;

          // Skip depreciation entries
          const isDepreciation = tx.idempotencyKey?.startsWith("depreciation-") || tx.memo?.startsWith("Depreciation:");

          // Skip transactions linked to recurring entries
          const db = engine.getDb();
          const recurringLink = await db.get<{ id: string }>(
            "SELECT id FROM recurring_entry_log WHERE transaction_id = ? LIMIT 1",
            [tx.id],
          );
          const isRecurring = !!recurringLink;

          if (!isDepreciation && !isRecurring) {
            const EXCLUDE_KEYWORDS = /\b(rent|insurance|subscription|lease|payroll|salary|wages|tax|utilities)\b/i;

            const ledgerRow = await db.get<{ jurisdiction: string }>(
              "SELECT jurisdiction FROM ledgers WHERE id = ?",
              [ledgerId],
            );
            const jurisdiction = ledgerRow?.jurisdiction ?? "AU";
            const jConfig = getJurisdictionConfig(jurisdiction);
            const threshold = jConfig.capitalisationThreshold;

            if (threshold > 0) {
              const expenseDebits = tx.lines.filter((l) => l.direction === "debit" && l.amount >= threshold);
              for (const line of expenseDebits) {
                const acctResult = await engine.getAccount(line.accountId);
                if (!acctResult.ok || acctResult.value.type !== "expense") continue;
                if (EXCLUDE_KEYWORDS.test(acctResult.value.name)) continue;

                const amountDisplay = `$${(line.amount / 100).toFixed(2)}`;
                const thresholdDisplay = `$${(threshold / 100).toFixed(2)}`;
                await engine.createNotification({
                  ledgerId,
                  userId: systemUserId,
                  type: "capitalisation_check",
                  severity: "warning",
                  title: "Large expense — should this be capitalised?",
                  body: `${amountDisplay} posted to ${acctResult.value.name}. Amounts over ${thresholdDisplay} may need to be recorded as fixed assets. Use check_capitalisation to verify.`,
                  data: { transactionId: tx.id, accountId: line.accountId, amount: line.amount, threshold },
                  actionType: "navigate",
                  actionData: { url: "/fixed-assets" },
                });
                break; // One notification per transaction
              }
            }
          }
        } catch { /* Capitalisation check is best-effort */ }
      }

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

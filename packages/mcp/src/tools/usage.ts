// ---------------------------------------------------------------------------
// get_usage tool — aggregate stats for a ledger
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "@kounta/core";
import { toolOk, toolErr } from "../lib/helpers.js";

export function registerUsageTool(
  server: McpServer,
  db: Database,
): void {
  server.tool(
    "get_usage",
    "Get usage statistics for a ledger: account count, transaction count, line item count.",
    {
      ledgerId: z.string().describe("Ledger ID"),
    },
    async ({ ledgerId }) => {
      // Verify ledger exists
      const ledger = await db.get<{ id: string }>(
        "SELECT id FROM ledgers WHERE id = ?",
        [ledgerId],
      );

      if (!ledger) {
        return toolErr({
          code: "LEDGER_NOT_FOUND",
          message: `Ledger ${ledgerId} not found`,
        });
      }

      const accountCount = await db.get<{ count: number }>(
        "SELECT COUNT(*) as count FROM accounts WHERE ledger_id = ?",
        [ledgerId],
      );

      const transactionCount = await db.get<{ count: number }>(
        "SELECT COUNT(*) as count FROM transactions WHERE ledger_id = ?",
        [ledgerId],
      );

      const lineItemCount = await db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM line_items li
         JOIN transactions t ON li.transaction_id = t.id
         WHERE t.ledger_id = ?`,
        [ledgerId],
      );

      return toolOk({
        ledgerId,
        accounts: accountCount?.count ?? 0,
        transactions: transactionCount?.count ?? 0,
        lineItems: lineItemCount?.count ?? 0,
      });
    },
  );
}

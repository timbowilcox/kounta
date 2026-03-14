// ---------------------------------------------------------------------------
// get_statement tool — income statement, balance sheet, cash flow
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerEngine } from "@kounta/core";
import { handleResult, toolErr } from "../lib/helpers.js";

export function registerStatementTools(
  server: McpServer,
  engine: LedgerEngine,
): void {
  server.tool(
    "get_statement",
    "Generate a financial statement: income statement (P&L), balance sheet, or cash flow statement.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      type: z
        .enum(["pnl", "balance_sheet", "cash_flow"])
        .describe("Statement type: pnl, balance_sheet, or cash_flow"),
      startDate: z.string().optional().describe("Period start date (required for pnl and cash_flow)"),
      endDate: z.string().optional().describe("Period end date (required for pnl and cash_flow)"),
      asOfDate: z.string().optional().describe("Point-in-time date (required for balance_sheet)"),
    },
    async ({ ledgerId, type, startDate, endDate, asOfDate }) => {
      switch (type) {
        case "pnl": {
          if (!startDate || !endDate) {
            return toolErr({
              code: "VALIDATION_ERROR",
              message: "startDate and endDate are required for income statement",
            });
          }
          const result = await engine.generateIncomeStatement(ledgerId, startDate, endDate);
          return handleResult(result);
        }

        case "balance_sheet": {
          if (!asOfDate) {
            return toolErr({
              code: "VALIDATION_ERROR",
              message: "asOfDate is required for balance sheet",
            });
          }
          const result = await engine.generateBalanceSheet(ledgerId, asOfDate);
          return handleResult(result);
        }

        case "cash_flow": {
          if (!startDate || !endDate) {
            return toolErr({
              code: "VALIDATION_ERROR",
              message: "startDate and endDate are required for cash flow statement",
            });
          }
          const result = await engine.generateCashFlow(ledgerId, startDate, endDate);
          return handleResult(result);
        }
      }
    },
  );
}

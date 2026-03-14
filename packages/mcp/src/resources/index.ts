// ---------------------------------------------------------------------------
// MCP Resources — read-only views into ledger data.
//
// Resources use URI templates (RFC 6570) so clients can enumerate them.
// ---------------------------------------------------------------------------

import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerEngine } from "@kounta/core";
import { resourceJson } from "../lib/helpers.js";

export function registerResources(
  server: McpServer,
  engine: LedgerEngine,
): void {
  // -----------------------------------------------------------------------
  // Chart of Accounts
  // -----------------------------------------------------------------------
  server.resource(
    "chart-of-accounts",
    new ResourceTemplate("ledger://{id}/chart-of-accounts", { list: undefined }),
    async (uri, { id }) => {
      const ledgerId = String(id);
      const result = await engine.listAccounts(ledgerId);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return resourceJson(uri.href, result.value);
    },
  );

  // -----------------------------------------------------------------------
  // Income Statement (P&L)
  // -----------------------------------------------------------------------
  server.resource(
    "pnl",
    new ResourceTemplate("ledger://{id}/pnl{?start,end}", { list: undefined }),
    async (uri, { id, start, end }) => {
      const ledgerId = String(id);
      const startDate = String(start ?? "");
      const endDate = String(end ?? "");

      if (!startDate || !endDate) {
        throw new Error("start and end query parameters are required for P&L");
      }

      const result = await engine.generateIncomeStatement(ledgerId, startDate, endDate);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return resourceJson(uri.href, result.value);
    },
  );

  // -----------------------------------------------------------------------
  // Balance Sheet
  // -----------------------------------------------------------------------
  server.resource(
    "balance-sheet",
    new ResourceTemplate("ledger://{id}/balance-sheet{?as_of}", { list: undefined }),
    async (uri, { id, as_of }) => {
      const ledgerId = String(id);
      const asOfDate = String(as_of ?? "");

      if (!asOfDate) {
        throw new Error("as_of query parameter is required for balance sheet");
      }

      const result = await engine.generateBalanceSheet(ledgerId, asOfDate);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return resourceJson(uri.href, result.value);
    },
  );

  // -----------------------------------------------------------------------
  // Recent Transactions
  // -----------------------------------------------------------------------
  server.resource(
    "recent-transactions",
    new ResourceTemplate("ledger://{id}/recent-transactions{?limit}", {
      list: undefined,
    }),
    async (uri, { id, limit }) => {
      const ledgerId = String(id);
      const pageLimit = limit ? Number(limit) : 20;

      const result = await engine.listTransactions(ledgerId, { limit: pageLimit });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return resourceJson(uri.href, result.value);
    },
  );
}

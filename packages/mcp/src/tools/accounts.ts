// ---------------------------------------------------------------------------
// list_accounts and create_account tools
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerEngine } from "@kounta/core";
import { handleResult } from "../lib/helpers.js";

export function registerAccountTools(
  server: McpServer,
  engine: LedgerEngine,
): void {
  // -----------------------------------------------------------------------
  // list_accounts
  // -----------------------------------------------------------------------
  server.tool(
    "list_accounts",
    "List all accounts for a ledger with their current balances.",
    {
      ledgerId: z.string().describe("Ledger ID"),
    },
    async ({ ledgerId }) => {
      const result = await engine.listAccounts(ledgerId);
      return handleResult(result);
    },
  );

  // -----------------------------------------------------------------------
  // create_account
  // -----------------------------------------------------------------------
  server.tool(
    "create_account",
    "Create a new account in the chart of accounts.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      code: z.string().describe("Account code (e.g. 1000, 4100)"),
      name: z.string().describe("Account display name"),
      type: z
        .enum(["asset", "liability", "equity", "revenue", "expense"])
        .describe("Account type"),
      parentCode: z.string().optional().describe("Parent account code for sub-accounts"),
      metadata: z.record(z.unknown()).optional().describe("Additional metadata (JSON)"),
    },
    async ({ ledgerId, code, name, type, parentCode, metadata }) => {
      const result = await engine.createAccount({
        ledgerId,
        code,
        name,
        type,
        parentCode,
        metadata,
      });
      return handleResult(result);
    },
  );
}

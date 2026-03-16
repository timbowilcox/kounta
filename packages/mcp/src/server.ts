// ---------------------------------------------------------------------------
// MCP Server factory — assembles the McpServer with all tools, resources,
// and prompts. Transport-agnostic; the caller connects the transport.
// ---------------------------------------------------------------------------

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerEngine, Database, BankFeedProvider } from "@kounta/core";
import { createBankFeedProvider } from "@kounta/core";
import type { ProviderConfig } from "@kounta/core";

import { registerSetupTools } from "./tools/setup-ledger.js";
import { registerTransactionTools } from "./tools/transactions.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerStatementTools } from "./tools/statements.js";
import { registerImportTools } from "./tools/import.js";
import { registerBankFeedTools } from "./tools/bank-feeds.js";
import { registerNotificationTools } from "./tools/notifications.js";
import { registerUsageTool } from "./tools/usage.js";
import { registerCurrencyTools } from "./tools/currencies.js";
import { registerClassificationTools } from "./tools/classification.js";
import { registerRecurringTools } from "./tools/recurring.js";
import { registerStripeTools } from "./tools/stripe.js";
import { registerRevenueTools } from "./tools/revenue.js";
import { registerFixedAssetTools } from "./tools/fixed-assets.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

export function createMcpServer(
  engine: LedgerEngine,
  systemUserId: string,
  db: Database,
): McpServer {
  const server = new McpServer({
    name: "kounta-mcp",
    version: "0.1.0",
  });

  // Bank feed provider (optional — requires BASIQ_API_KEY)
  let bankFeedProvider: BankFeedProvider | null = null;
  const basiqApiKey = process.env["BASIQ_API_KEY"];
  if (basiqApiKey) {
    const config: ProviderConfig = { basiq: { apiKey: basiqApiKey } };
    bankFeedProvider = createBankFeedProvider("basiq", config);
  }

  // Tools
  registerSetupTools(server, engine, systemUserId);
  registerTransactionTools(server, engine);
  registerAccountTools(server, engine);
  registerStatementTools(server, engine);
  registerImportTools(server, engine);
  registerBankFeedTools(server, engine, bankFeedProvider);
  registerNotificationTools(server, engine, systemUserId);
  registerUsageTool(server, db);
  registerCurrencyTools(server, engine, systemUserId);
  registerClassificationTools(server, engine);
  registerRecurringTools(server, engine);
  registerStripeTools(server, engine, db);
  registerRevenueTools(server, engine, db);
  registerFixedAssetTools(server, engine, db);

  // Resources
  registerResources(server, engine);

  // Prompts
  registerPrompts(server);

  return server;
}

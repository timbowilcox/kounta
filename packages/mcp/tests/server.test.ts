// ---------------------------------------------------------------------------
// @kounta/mcp integration tests
//
// Uses InMemoryTransport + Client from the MCP SDK to test the full server
// end-to-end, including tools, resources, and prompts.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { initDatabase } from "../src/lib/db.js";
import { createMcpServer } from "../src/server.js";
import type { LedgerEngine, Database } from "@kounta/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let engine: LedgerEngine;
let db: Database;
let systemUserId: string;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  // Boot DB + engine
  const init = await initDatabase();
  engine = init.engine;
  db = init.db;
  systemUserId = init.systemUserId;

  // Create server + transports
  server = createMcpServer(engine, systemUserId, db);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  client = new Client({ name: "test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await server.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the JSON text from a tool result's first content block. */
function parseToolResult(result: { content: unknown[] }): unknown {
  const first = result.content[0] as { type: string; text: string };
  return JSON.parse(first.text);
}

// ---------------------------------------------------------------------------
// Tool Discovery
// ---------------------------------------------------------------------------

describe("Tool discovery", () => {
  it("lists all 79 tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "approve_bill",
      "check_capitalisation",
      "classify_bank_transaction",
      "classify_transaction",
      "complete_setup",
      "confirm_bank_match",
      "confirm_matches",
      "convert_amount",
      "create_account",
      "create_bill",
      "create_classification_rule",
      "create_customer",
      "create_fixed_asset",
      "create_invoice",
      "create_recurring_entry",
      "create_revenue_schedule",
      "create_vendor",
      "dispose_fixed_asset",
      "enable_currency",
      "generate_insights",
      "get_ap_aging",
      "get_ar_aging",
      "get_asset_register_summary",
      "get_bill",
      "get_bill_summary",
      "get_customer",
      "get_deferred_revenue",
      "get_depreciation_due",
      "get_depreciation_schedule",
      "get_import_batch",
      "get_invoice",
      "get_invoice_summary",
      "get_mrr",
      "get_notification",
      "get_revenue_schedule",
      "get_setup_guide",
      "get_statement",
      "get_stripe_status",
      "get_usage",
      "get_vendor",
      "import_file",
      "list_accounts",
      "list_bank_accounts",
      "list_bank_connections",
      "list_bank_transactions",
      "list_bills",
      "list_classification_rules",
      "list_customers",
      "list_exchange_rates",
      "list_fixed_assets",
      "list_invoices",
      "list_merchant_aliases",
      "list_notifications",
      "list_recurring_entries",
      "list_revenue_schedules",
      "list_vendors",
      "map_bank_account",
      "pause_recurring_entry",
      "post_transaction",
      "record_bill_payment",
      "record_invoice_payment",
      "resume_recurring_entry",
      "revalue_accounts",
      "reverse_transaction",
      "run_depreciation",
      "search_transactions",
      "send_invoice",
      "set_exchange_rate",
      "setup_ledger",
      "sync_bank_account",
      "sync_stripe",
      "update_customer",
      "update_fixed_asset",
      "update_jurisdiction",
      "update_notification",
      "update_recurring_entry",
      "update_vendor",
      "void_bill",
      "void_invoice",
    ]);
  });
});

// ---------------------------------------------------------------------------
// setup_ledger (high confidence)
// ---------------------------------------------------------------------------

describe("setup_ledger", () => {
  it("auto-provisions a ledger for a high-confidence description", async () => {
    const result = await client.callTool({
      name: "setup_ledger",
      arguments: {
        description: "SaaS subscription business with recurring monthly billing",
      },
    });

    const data = parseToolResult(result) as {
      status: string;
      ledger: { id: string; name: string };
      template: { slug: string };
      accounts: unknown[];
      confidence: number;
    };

    expect(data.status).toBe("complete");
    expect(data.ledger.id).toBeDefined();
    expect(data.template.slug).toBe("saas");
    expect(data.accounts.length).toBeGreaterThan(0);
    expect(data.confidence).toBeGreaterThanOrEqual(6);
  });

  it("returns questions for a vague description", async () => {
    const result = await client.callTool({
      name: "setup_ledger",
      arguments: {
        description: "small business",
      },
    });

    const data = parseToolResult(result) as {
      status: string;
      questions: string[];
    };

    expect(data.status).toBe("needs_input");
    expect(data.questions).toBeDefined();
    expect(data.questions.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// complete_setup
// ---------------------------------------------------------------------------

describe("complete_setup", () => {
  it("finalizes ledger with a chosen template", async () => {
    const result = await client.callTool({
      name: "complete_setup",
      arguments: {
        templateSlug: "ecommerce",
        name: "My E-Commerce Store",
        currency: "EUR",
      },
    });

    const data = parseToolResult(result) as {
      status: string;
      ledger: { id: string; name: string; currency: string };
      template: { slug: string };
      accounts: unknown[];
    };

    expect(data.status).toBe("complete");
    expect(data.ledger.name).toBe("My E-Commerce Store");
    expect(data.ledger.currency).toBe("EUR");
    expect(data.template.slug).toBe("ecommerce");
    expect(data.accounts.length).toBeGreaterThan(0);
  });

  it("returns error for unknown template", async () => {
    const result = await client.callTool({
      name: "complete_setup",
      arguments: { templateSlug: "nonexistent" },
    });

    expect(result.isError).toBe(true);
    const error = parseToolResult(result) as { code: string };
    expect(error.code).toBe("TEMPLATE_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// post_transaction (balanced + unbalanced)
// ---------------------------------------------------------------------------

describe("post_transaction", () => {
  let ledgerId: string;

  beforeAll(async () => {
    // Set up a ledger with the SaaS template for transaction tests
    const setup = await client.callTool({
      name: "setup_ledger",
      arguments: { description: "SaaS subscription startup with monthly plans" },
    });
    const data = parseToolResult(setup) as { ledger: { id: string } };
    ledgerId = data.ledger.id;
  });

  it("posts a balanced transaction", async () => {
    const result = await client.callTool({
      name: "post_transaction",
      arguments: {
        ledgerId,
        date: "2024-03-15",
        memo: "Monthly subscription revenue",
        lines: [
          { accountCode: "1000", amount: 10000, direction: "debit" },
          { accountCode: "4000", amount: 10000, direction: "credit" },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    const data = parseToolResult(result) as {
      id: string;
      memo: string;
      lines: unknown[];
      sourceType: string;
    };

    expect(data.id).toBeDefined();
    expect(data.memo).toBe("Monthly subscription revenue");
    expect(data.lines).toHaveLength(2);
    expect(data.sourceType).toBe("mcp");
  });

  it("rejects an unbalanced transaction", async () => {
    const result = await client.callTool({
      name: "post_transaction",
      arguments: {
        ledgerId,
        date: "2024-03-15",
        memo: "Bad transaction",
        lines: [
          { accountCode: "1000", amount: 5000, direction: "debit" },
          { accountCode: "4000", amount: 3000, direction: "credit" },
        ],
      },
    });

    expect(result.isError).toBe(true);
    const error = parseToolResult(result) as { code: string };
    expect(error.code).toBe("UNBALANCED_TRANSACTION");
  });
});

// ---------------------------------------------------------------------------
// reverse_transaction
// ---------------------------------------------------------------------------

describe("reverse_transaction", () => {
  let ledgerId: string;
  let transactionId: string;

  beforeAll(async () => {
    // Set up ledger + post a transaction to reverse
    const setup = await client.callTool({
      name: "complete_setup",
      arguments: { templateSlug: "saas", name: "Reversal Test" },
    });
    const ledger = parseToolResult(setup) as { ledger: { id: string } };
    ledgerId = ledger.ledger.id;

    const txn = await client.callTool({
      name: "post_transaction",
      arguments: {
        ledgerId,
        date: "2024-03-01",
        memo: "To be reversed",
        lines: [
          { accountCode: "1000", amount: 2000, direction: "debit" },
          { accountCode: "4000", amount: 2000, direction: "credit" },
        ],
      },
    });
    const txnData = parseToolResult(txn) as { id: string };
    transactionId = txnData.id;
  });

  it("reverses a transaction", async () => {
    const result = await client.callTool({
      name: "reverse_transaction",
      arguments: {
        transactionId,
        reason: "Customer refund",
      },
    });

    expect(result.isError).toBeFalsy();
    const data = parseToolResult(result) as {
      id: string;
      memo: string;
      lines: { direction: string }[];
    };

    expect(data.id).toBeDefined();
    expect(data.id).not.toBe(transactionId);
    expect(data.memo).toContain("Reversal");
    // Reversal should have opposite directions
    expect(data.lines).toHaveLength(2);
  });

  it("rejects double-reversal", async () => {
    const result = await client.callTool({
      name: "reverse_transaction",
      arguments: {
        transactionId,
        reason: "Try again",
      },
    });

    expect(result.isError).toBe(true);
    const error = parseToolResult(result) as { code: string };
    expect(error.code).toBe("TRANSACTION_ALREADY_REVERSED");
  });
});

// ---------------------------------------------------------------------------
// list_accounts + create_account
// ---------------------------------------------------------------------------

describe("Account operations", () => {
  let ledgerId: string;

  beforeAll(async () => {
    const setup = await client.callTool({
      name: "complete_setup",
      arguments: { templateSlug: "saas", name: "Account Test Ledger" },
    });
    const data = parseToolResult(setup) as { ledger: { id: string } };
    ledgerId = data.ledger.id;
  });

  it("lists accounts with balances", async () => {
    const result = await client.callTool({
      name: "list_accounts",
      arguments: { ledgerId },
    });

    expect(result.isError).toBeFalsy();
    const accounts = parseToolResult(result) as { code: string; name: string; balance: number }[];
    expect(accounts.length).toBeGreaterThan(0);
    // Each account should have a balance field
    expect(accounts[0]).toHaveProperty("balance");
  });

  it("creates a custom account", async () => {
    const result = await client.callTool({
      name: "create_account",
      arguments: {
        ledgerId,
        code: "1050",
        name: "Petty Cash",
        type: "asset",
      },
    });

    expect(result.isError).toBeFalsy();
    const account = parseToolResult(result) as { code: string; name: string; type: string };
    expect(account.code).toBe("1050");
    expect(account.name).toBe("Petty Cash");
    expect(account.type).toBe("asset");
  });

  it("rejects duplicate account code", async () => {
    const result = await client.callTool({
      name: "create_account",
      arguments: {
        ledgerId,
        code: "1050",
        name: "Duplicate",
        type: "asset",
      },
    });

    expect(result.isError).toBe(true);
    const error = parseToolResult(result) as { code: string };
    expect(error.code).toBe("DUPLICATE_ACCOUNT_CODE");
  });
});

// ---------------------------------------------------------------------------
// get_statement
// ---------------------------------------------------------------------------

describe("get_statement", () => {
  let ledgerId: string;

  beforeAll(async () => {
    // Create ledger with transactions for statement generation
    const setup = await client.callTool({
      name: "complete_setup",
      arguments: { templateSlug: "saas", name: "Statement Test" },
    });
    const data = parseToolResult(setup) as { ledger: { id: string } };
    ledgerId = data.ledger.id;

    // Post some transactions
    await client.callTool({
      name: "post_transaction",
      arguments: {
        ledgerId,
        date: "2024-03-01",
        memo: "Revenue",
        lines: [
          { accountCode: "1000", amount: 50000, direction: "debit" },
          { accountCode: "4000", amount: 50000, direction: "credit" },
        ],
      },
    });

    await client.callTool({
      name: "post_transaction",
      arguments: {
        ledgerId,
        date: "2024-03-15",
        memo: "Hosting expense",
        lines: [
          { accountCode: "5010", amount: 8000, direction: "debit" },
          { accountCode: "1000", amount: 8000, direction: "credit" },
        ],
      },
    });
  });

  it("generates an income statement", async () => {
    const result = await client.callTool({
      name: "get_statement",
      arguments: {
        ledgerId,
        type: "pnl",
        startDate: "2024-03-01",
        endDate: "2024-03-31",
      },
    });

    expect(result.isError).toBeFalsy();
    const stmt = parseToolResult(result) as {
      statementType: string;
      sections: unknown[];
      totals: Record<string, number>;
    };

    expect(stmt.statementType).toBe("pnl");
    expect(stmt.sections.length).toBeGreaterThan(0);
    expect(stmt.totals).toBeDefined();
  });

  it("generates a balance sheet", async () => {
    const result = await client.callTool({
      name: "get_statement",
      arguments: {
        ledgerId,
        type: "balance_sheet",
        asOfDate: "2024-03-31",
      },
    });

    expect(result.isError).toBeFalsy();
    const stmt = parseToolResult(result) as {
      statementType: string;
      sections: unknown[];
    };
    expect(stmt.statementType).toBe("balance_sheet");
    expect(stmt.sections.length).toBeGreaterThan(0);
  });

  it("generates a cash flow statement", async () => {
    const result = await client.callTool({
      name: "get_statement",
      arguments: {
        ledgerId,
        type: "cash_flow",
        startDate: "2024-03-01",
        endDate: "2024-03-31",
      },
    });

    expect(result.isError).toBeFalsy();
    const stmt = parseToolResult(result) as {
      statementType: string;
      sections: unknown[];
    };
    expect(stmt.statementType).toBe("cash_flow");
    expect(stmt.sections.length).toBeGreaterThan(0);
  });

  it("rejects pnl without dates", async () => {
    const result = await client.callTool({
      name: "get_statement",
      arguments: {
        ledgerId,
        type: "pnl",
      },
    });

    expect(result.isError).toBe(true);
    const error = parseToolResult(result) as { code: string };
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects balance_sheet without asOfDate", async () => {
    const result = await client.callTool({
      name: "get_statement",
      arguments: {
        ledgerId,
        type: "balance_sheet",
      },
    });

    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// search_transactions
// ---------------------------------------------------------------------------

describe("search_transactions", () => {
  let ledgerId: string;

  beforeAll(async () => {
    const setup = await client.callTool({
      name: "complete_setup",
      arguments: { templateSlug: "consulting", name: "Search Test" },
    });
    const data = parseToolResult(setup) as { ledger: { id: string } };
    ledgerId = data.ledger.id;

    // Post a few transactions
    for (let i = 0; i < 3; i++) {
      await client.callTool({
        name: "post_transaction",
        arguments: {
          ledgerId,
          date: `2024-03-${String(i + 1).padStart(2, "0")}`,
          memo: `Transaction ${i + 1}`,
          lines: [
            { accountCode: "1000", amount: 1000 * (i + 1), direction: "debit" },
            { accountCode: "4000", amount: 1000 * (i + 1), direction: "credit" },
          ],
        },
      });
    }
  });

  it("lists transactions with pagination", async () => {
    const result = await client.callTool({
      name: "search_transactions",
      arguments: { ledgerId, limit: 2 },
    });

    expect(result.isError).toBeFalsy();
    const data = parseToolResult(result) as {
      data: unknown[];
      nextCursor: string | null;
    };

    expect(data.data).toHaveLength(2);
    expect(data.nextCursor).toBeDefined();
  });

  it("follows pagination cursor", async () => {
    const first = await client.callTool({
      name: "search_transactions",
      arguments: { ledgerId, limit: 2 },
    });

    const firstData = parseToolResult(first) as {
      data: unknown[];
      nextCursor: string;
    };

    const second = await client.callTool({
      name: "search_transactions",
      arguments: { ledgerId, limit: 2, cursor: firstData.nextCursor },
    });

    const secondData = parseToolResult(second) as {
      data: unknown[];
      nextCursor: string | null;
    };

    expect(secondData.data.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// import_file + confirm_matches + get_import_batch
// ---------------------------------------------------------------------------

describe("Import tools", () => {
  let ledgerId: string;

  beforeAll(async () => {
    const setup = await client.callTool({
      name: "complete_setup",
      arguments: { templateSlug: "saas", name: "Import Test Ledger" },
    });
    const data = parseToolResult(setup) as { ledger: { id: string } };
    ledgerId = data.ledger.id;

    // Post a transaction so the matcher has something to compare against
    await client.callTool({
      name: "post_transaction",
      arguments: {
        ledgerId,
        date: "2024-06-15",
        memo: "Acme Corp subscription payment",
        lines: [
          { accountCode: "1000", amount: 9999, direction: "debit" },
          { accountCode: "4000", amount: 9999, direction: "credit" },
        ],
      },
    });
  });

  it("imports a CSV file and creates batch with match results", async () => {
    const csvContent = [
      "date,amount,payee,memo",
      "2024-06-15,99.99,Acme Corp,subscription payment",
      "2024-06-20,250.00,Office Supplies Inc,paper and toner",
    ].join("\n");

    const result = await client.callTool({
      name: "import_file",
      arguments: {
        ledgerId,
        format: "csv",
        content: csvContent,
        filename: "bank-june.csv",
      },
    });

    expect(result.isError).toBeFalsy();
    const data = parseToolResult(result) as {
      batch: {
        id: string;
        status: string;
        rowCount: number;
      };
      rows: {
        id: string;
        matchStatus: string;
        confidence: number | null;
        payee: string;
      }[];
    };

    expect(data.batch.status).toBe("complete");
    expect(data.batch.rowCount).toBe(2);
    expect(data.rows).toHaveLength(2);

    // First row should have some match (same date, same amount)
    const acmeRow = data.rows.find((r) => r.payee === "Acme Corp");
    expect(acmeRow).toBeDefined();
    expect(acmeRow!.confidence).toBeGreaterThan(0);

    // Second row should be unmatched (no existing txn)
    const officeRow = data.rows.find((r) => r.payee === "Office Supplies Inc");
    expect(officeRow).toBeDefined();
    expect(officeRow!.matchStatus).toBe("unmatched");
  });

  it("imports an OFX file", async () => {
    const ofxContent = `OFXHEADER:100
DATA:OFXSGML
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240615120000
<TRNAMT>-50.00
<NAME>Coffee Shop
<MEMO>Morning coffee
<FITID>TXN001
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

    const result = await client.callTool({
      name: "import_file",
      arguments: {
        ledgerId,
        format: "ofx",
        content: ofxContent,
      },
    });

    expect(result.isError).toBeFalsy();
    const data = parseToolResult(result) as {
      batch: { id: string; status: string; rowCount: number };
      rows: { payee: string; amount: number }[];
    };

    expect(data.batch.status).toBe("complete");
    expect(data.batch.rowCount).toBe(1);
    expect(data.rows[0]!.payee).toBe("Coffee Shop");
    expect(data.rows[0]!.amount).toBe(-5000);
  });

  it("returns IMPORT_PARSE_ERROR for invalid CSV", async () => {
    const result = await client.callTool({
      name: "import_file",
      arguments: {
        ledgerId,
        format: "csv",
        content: "this is not a csv file at all",
      },
    });

    expect(result.isError).toBe(true);
    const error = parseToolResult(result) as { code: string };
    expect(error.code).toBe("IMPORT_PARSE_ERROR");
  });

  it("retrieves an import batch via get_import_batch", async () => {
    const csvContent = "date,amount,payee\n2024-07-01,100.00,Test Vendor";
    const importResult = await client.callTool({
      name: "import_file",
      arguments: { ledgerId, format: "csv", content: csvContent },
    });
    const importData = parseToolResult(importResult) as { batch: { id: string } };

    const getResult = await client.callTool({
      name: "get_import_batch",
      arguments: { batchId: importData.batch.id },
    });

    expect(getResult.isError).toBeFalsy();
    const data = parseToolResult(getResult) as {
      batch: { id: string; status: string };
      rows: { payee: string }[];
    };

    expect(data.batch.id).toBe(importData.batch.id);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]!.payee).toBe("Test Vendor");
  });

  it("returns IMPORT_NOT_FOUND for nonexistent batch", async () => {
    const result = await client.callTool({
      name: "get_import_batch",
      arguments: { batchId: "00000000-0000-0000-0000-000000000000" },
    });

    expect(result.isError).toBe(true);
    const error = parseToolResult(result) as { code: string };
    expect(error.code).toBe("IMPORT_NOT_FOUND");
  });

  it("confirms and rejects matches via confirm_matches", async () => {
    const csvContent = "date,amount,payee\n2024-06-15,99.99,Acme Corp";
    const importResult = await client.callTool({
      name: "import_file",
      arguments: { ledgerId, format: "csv", content: csvContent },
    });
    const importData = parseToolResult(importResult) as {
      batch: { id: string };
      rows: { id: string; matchStatus: string }[];
    };

    // Find a row that has been matched or suggested
    const matchedRow = importData.rows.find(
      (r) => r.matchStatus === "matched" || r.matchStatus === "suggested",
    );

    if (matchedRow) {
      const confirmResult = await client.callTool({
        name: "confirm_matches",
        arguments: {
          batchId: importData.batch.id,
          actions: [{ rowId: matchedRow.id, action: "reject" }],
        },
      });

      expect(confirmResult.isError).toBeFalsy();
      const data = parseToolResult(confirmResult) as {
        batch: { id: string };
        rows: { id: string; matchStatus: string }[];
      };

      const updatedRow = data.rows.find((r) => r.id === matchedRow.id);
      expect(updatedRow!.matchStatus).toBe("unmatched");
    }
  });
});

// ---------------------------------------------------------------------------
// get_usage
// ---------------------------------------------------------------------------

describe("get_usage", () => {
  let ledgerId: string;

  beforeAll(async () => {
    const setup = await client.callTool({
      name: "complete_setup",
      arguments: { templateSlug: "agency", name: "Usage Test" },
    });
    const data = parseToolResult(setup) as { ledger: { id: string } };
    ledgerId = data.ledger.id;

    // Post one transaction
    await client.callTool({
      name: "post_transaction",
      arguments: {
        ledgerId,
        date: "2024-04-01",
        memo: "Client payment",
        lines: [
          { accountCode: "1000", amount: 25000, direction: "debit" },
          { accountCode: "4000", amount: 25000, direction: "credit" },
        ],
      },
    });
  });

  it("returns accurate usage stats", async () => {
    const result = await client.callTool({
      name: "get_usage",
      arguments: { ledgerId },
    });

    expect(result.isError).toBeFalsy();
    const data = parseToolResult(result) as {
      ledgerId: string;
      accounts: number;
      transactions: number;
      lineItems: number;
    };

    expect(data.ledgerId).toBe(ledgerId);
    expect(data.accounts).toBeGreaterThan(0);
    expect(data.transactions).toBe(1);
    expect(data.lineItems).toBe(2);
  });

  it("returns error for nonexistent ledger", async () => {
    const result = await client.callTool({
      name: "get_usage",
      arguments: { ledgerId: "nonexistent-id" },
    });

    expect(result.isError).toBe(true);
    const error = parseToolResult(result) as { code: string };
    expect(error.code).toBe("LEDGER_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

describe("Resources", () => {
  let ledgerId: string;

  beforeAll(async () => {
    const setup = await client.callTool({
      name: "complete_setup",
      arguments: { templateSlug: "saas", name: "Resource Test" },
    });
    const data = parseToolResult(setup) as { ledger: { id: string } };
    ledgerId = data.ledger.id;

    await client.callTool({
      name: "post_transaction",
      arguments: {
        ledgerId,
        date: "2024-06-01",
        memo: "June revenue",
        lines: [
          { accountCode: "1000", amount: 30000, direction: "debit" },
          { accountCode: "4000", amount: 30000, direction: "credit" },
        ],
      },
    });
  });

  it("lists resource templates", async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    const uris = resourceTemplates.map((r) => r.uriTemplate);

    expect(uris).toContain("ledger://{id}/chart-of-accounts");
    expect(uris).toContain("ledger://{id}/pnl{?start,end}");
    expect(uris).toContain("ledger://{id}/balance-sheet{?as_of}");
    expect(uris).toContain("ledger://{id}/recent-transactions{?limit}");
  });

  it("reads chart-of-accounts resource", async () => {
    const result = await client.readResource({
      uri: `ledger://${ledgerId}/chart-of-accounts`,
    });

    expect(result.contents).toHaveLength(1);
    const content = result.contents[0]!;
    expect(content.mimeType).toBe("application/json");

    const accounts = JSON.parse(content.text as string);
    expect(Array.isArray(accounts)).toBe(true);
    expect(accounts.length).toBeGreaterThan(0);
  });

  it("reads pnl resource", async () => {
    const result = await client.readResource({
      uri: `ledger://${ledgerId}/pnl?start=2024-06-01&end=2024-06-30`,
    });

    expect(result.contents).toHaveLength(1);
    const stmt = JSON.parse(result.contents[0]!.text as string);
    expect(stmt.statementType).toBe("pnl");
  });

  it("reads balance-sheet resource", async () => {
    const result = await client.readResource({
      uri: `ledger://${ledgerId}/balance-sheet?as_of=2024-06-30`,
    });

    expect(result.contents).toHaveLength(1);
    const stmt = JSON.parse(result.contents[0]!.text as string);
    expect(stmt.statementType).toBe("balance_sheet");
  });

  it("reads recent-transactions resource", async () => {
    const result = await client.readResource({
      uri: `ledger://${ledgerId}/recent-transactions?limit=5`,
    });

    expect(result.contents).toHaveLength(1);
    const data = JSON.parse(result.contents[0]!.text as string);
    expect(data.data).toBeDefined();
    expect(Array.isArray(data.data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

describe("Prompts", () => {
  it("lists all 3 prompts", async () => {
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name).sort();
    expect(names).toEqual(["explain-statement", "monthly-close", "reconcile-bank"]);
  });

  it("gets monthly-close prompt with arguments", async () => {
    const result = await client.getPrompt({
      name: "monthly-close",
      arguments: { ledgerId: "test-123", month: "2024-03" },
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.role).toBe("user");
    const text = (result.messages[0]!.content as { text: string }).text;
    expect(text).toContain("test-123");
    expect(text).toContain("2024-03");
    expect(text).toContain("month-end close");
  });

  it("gets reconcile-bank prompt", async () => {
    const result = await client.getPrompt({
      name: "reconcile-bank",
      arguments: {
        ledgerId: "test-456",
        accountCode: "1000",
        statementBalance: "150000",
      },
    });

    expect(result.messages).toHaveLength(1);
    const text = (result.messages[0]!.content as { text: string }).text;
    expect(text).toContain("1000");
    expect(text).toContain("150000");
  });

  it("gets explain-statement prompt", async () => {
    const result = await client.getPrompt({
      name: "explain-statement",
      arguments: {
        ledgerId: "test-789",
        statementType: "pnl",
        startDate: "2024-01-01",
        endDate: "2024-12-31",
      },
    });

    expect(result.messages).toHaveLength(1);
    const text = (result.messages[0]!.content as { text: string }).text;
    expect(text).toContain("pnl");
    expect(text).toContain("Revenue");
  });
});

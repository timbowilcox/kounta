// ---------------------------------------------------------------------------
// import_file, confirm_matches, get_import_batch tools
//
// Wire the MCP tool interface to the core engine's import/matching methods.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerEngine } from "@kounta/core";
import { handleResult } from "../lib/helpers.js";

export function registerImportTools(
  server: McpServer,
  engine: LedgerEngine,
): void {
  // -----------------------------------------------------------------------
  // import_file
  // -----------------------------------------------------------------------
  server.tool(
    "import_file",
    "Import a CSV or OFX bank statement file. Parses the file, normalizes dates and amounts, and runs the reconciliation engine to match rows against existing ledger transactions.",
    {
      ledgerId: z.string().describe("Ledger ID to import into"),
      format: z.enum(["csv", "ofx"]).describe("File format: csv or ofx"),
      content: z.string().describe("File content as a string"),
      filename: z.string().optional().describe("Original filename for reference"),
    },
    async ({ ledgerId, format, content, filename }) => {
      const result = await engine.createImport({
        ledgerId,
        fileContent: content,
        fileType: format,
        filename,
      });
      return handleResult(result);
    },
  );

  // -----------------------------------------------------------------------
  // confirm_matches
  // -----------------------------------------------------------------------
  server.tool(
    "confirm_matches",
    "Confirm, reject, or override suggested transaction matches from an import batch. Use after import_file to finalize match decisions.",
    {
      batchId: z.string().describe("Import batch ID"),
      actions: z
        .array(
          z.object({
            rowId: z.string().describe("Import row ID"),
            action: z
              .enum(["confirm", "reject", "override"])
              .describe("Action: confirm a suggested match, reject it, or override with a specific transaction"),
            overrideTransactionId: z
              .string()
              .optional()
              .describe("Transaction ID to match against (required for override action)"),
          }),
        )
        .min(1)
        .describe("Match decisions for import rows"),
    },
    async ({ batchId, actions }) => {
      const result = await engine.confirmMatches({ batchId, actions });
      return handleResult(result);
    },
  );

  // -----------------------------------------------------------------------
  // get_import_batch
  // -----------------------------------------------------------------------
  server.tool(
    "get_import_batch",
    "Get details of an import batch including all rows with their match status and confidence scores.",
    {
      batchId: z.string().describe("Import batch ID"),
    },
    async ({ batchId }) => {
      const result = await engine.getImportBatch(batchId);
      return handleResult(result);
    },
  );
}

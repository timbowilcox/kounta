// ---------------------------------------------------------------------------
// Stripe Connect MCP tools — check status, trigger sync.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerEngine, Database } from "@kounta/core";
import {
  getConnectionByLedger,
  backfillAll,
} from "@kounta/core";
import { toolOk, toolErr } from "../lib/helpers.js";

export function registerStripeTools(
  server: McpServer,
  engine: LedgerEngine,
  db: Database,
): void {
  // -----------------------------------------------------------------------
  // get_stripe_status
  // -----------------------------------------------------------------------
  server.tool(
    "get_stripe_status",
    "Check if a Stripe account is connected to a ledger. Returns connection details including last sync time, or null if not connected.",
    {
      ledgerId: z.string().describe("Ledger ID"),
    },
    async ({ ledgerId }) => {
      try {
        const connection = await getConnectionByLedger(db, ledgerId);
        if (!connection) {
          return toolOk({ connected: false, connection: null });
        }
        return toolOk({
          connected: true,
          connection: {
            id: connection.id,
            stripeAccountId: connection.stripeAccountId,
            status: connection.status,
            lastSyncedAt: connection.lastSyncedAt,
            createdAt: connection.createdAt,
          },
        });
      } catch (e) {
        return toolErr({
          code: "INTERNAL_ERROR",
          message: `Failed to check Stripe status: ${e instanceof Error ? e.message : String(e)}`,
          details: [],
        });
      }
    },
  );

  // -----------------------------------------------------------------------
  // sync_stripe
  // -----------------------------------------------------------------------
  server.tool(
    "sync_stripe",
    "Trigger a manual sync of Stripe charges and payouts for the last N days (default 90). Returns immediately — sync runs in the background.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      days: z.number().int().positive().optional().describe("Number of days to sync (default: 90)"),
    },
    async ({ ledgerId, days }) => {
      try {
        const connection = await getConnectionByLedger(db, ledgerId);
        if (!connection) {
          return toolErr({
            code: "NOT_FOUND",
            message: "No active Stripe connection found for this ledger.",
            details: [],
          });
        }

        const syncDays = days ?? 90;

        // Run async — respond immediately
        backfillAll(db, engine, connection, syncDays).catch((e) => {
          console.error("Stripe MCP sync error:", e);
        });

        return toolOk({
          syncing: true,
          message: `Sync started for last ${syncDays} days`,
          stripeAccountId: connection.stripeAccountId,
        });
      } catch (e) {
        return toolErr({
          code: "INTERNAL_ERROR",
          message: `Failed to start Stripe sync: ${e instanceof Error ? e.message : String(e)}`,
          details: [],
        });
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Revenue Recognition MCP tools — schedules, metrics, recognition.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerEngine, Database } from "@ledge/core";
import {
  listRevenueSchedules,
  getRevenueSchedule,
  createRevenueSchedule,
  getRevenueMetrics,
  ensureRevenueAccounts,
} from "@ledge/core";
import { toolOk, toolErr } from "../lib/helpers.js";

export function registerRevenueTools(
  server: McpServer,
  engine: LedgerEngine,
  db: Database,
): void {
  // -----------------------------------------------------------------------
  // list_revenue_schedules
  // -----------------------------------------------------------------------
  server.tool(
    "list_revenue_schedules",
    "List revenue recognition schedules for a ledger. Optionally filter by status (active, completed, cancelled, paused) or customer name.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      status: z.enum(["active", "completed", "cancelled", "paused"]).optional().describe("Filter by schedule status"),
      customerName: z.string().optional().describe("Filter by customer name (partial match)"),
      limit: z.number().int().positive().max(200).optional().describe("Max results (default: 50, max: 200)"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async ({ ledgerId, status, customerName, limit, cursor }) => {
      try {
        const result = await listRevenueSchedules(db, ledgerId, {
          status,
          customerName,
          limit,
          cursor,
        });
        return toolOk(result);
      } catch (e) {
        return toolErr({
          code: "INTERNAL_ERROR",
          message: `Failed to list revenue schedules: ${e instanceof Error ? e.message : String(e)}`,
          details: [],
        });
      }
    },
  );

  // -----------------------------------------------------------------------
  // get_revenue_schedule
  // -----------------------------------------------------------------------
  server.tool(
    "get_revenue_schedule",
    "Get a single revenue schedule with all its recognition entries. Shows total amount, recognised vs remaining, and per-period entry status.",
    {
      scheduleId: z.string().describe("Revenue schedule ID"),
    },
    async ({ scheduleId }) => {
      try {
        const result = await getRevenueSchedule(db, scheduleId);
        if (!result.ok) {
          return toolErr({
            code: result.error.code,
            message: result.error.message,
            details: result.error.details ?? [],
          });
        }
        return toolOk(result.value);
      } catch (e) {
        return toolErr({
          code: "INTERNAL_ERROR",
          message: `Failed to get revenue schedule: ${e instanceof Error ? e.message : String(e)}`,
          details: [],
        });
      }
    },
  );

  // -----------------------------------------------------------------------
  // create_revenue_schedule
  // -----------------------------------------------------------------------
  server.tool(
    "create_revenue_schedule",
    "Create a manual revenue recognition schedule. Spreads a payment over a service period (e.g., $6,000 over 12 months = $500/month). Automatically creates deferred revenue and subscription revenue accounts if needed.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      totalAmount: z.number().int().positive().describe("Total payment amount in cents"),
      recognitionStart: z.string().describe("Start date of recognition period (YYYY-MM-DD)"),
      recognitionEnd: z.string().describe("End date of recognition period (YYYY-MM-DD)"),
      currency: z.string().optional().describe("Currency code (default: USD)"),
      customerName: z.string().optional().describe("Customer name for reference"),
      description: z.string().optional().describe("Description of the revenue source"),
      sourceRef: z.string().optional().describe("External reference (e.g., invoice number)"),
      deferredRevenueAccountId: z.string().optional().describe("Deferred revenue account ID (auto-created if omitted)"),
      revenueAccountId: z.string().optional().describe("Revenue account ID (auto-created if omitted)"),
    },
    async ({ ledgerId, totalAmount, recognitionStart, recognitionEnd, currency, customerName, description, sourceRef, deferredRevenueAccountId, revenueAccountId }) => {
      try {
        // Auto-create accounts if not provided
        let deferredId = deferredRevenueAccountId;
        let revenueId = revenueAccountId;
        if (!deferredId || !revenueId) {
          const accounts = await ensureRevenueAccounts(db, engine, ledgerId);
          deferredId = deferredId ?? accounts.deferredRevenueAccountId;
          revenueId = revenueId ?? accounts.revenueAccountId;
        }

        const result = await createRevenueSchedule(db, {
          ledgerId,
          totalAmount,
          recognitionStart,
          recognitionEnd,
          currency,
          customerName,
          description,
          sourceRef,
          sourceType: "manual",
          deferredRevenueAccountId: deferredId,
          revenueAccountId: revenueId,
        });

        if (!result.ok) {
          return toolErr({
            code: result.error.code,
            message: result.error.message,
            details: result.error.details ?? [],
          });
        }
        return toolOk(result.value);
      } catch (e) {
        return toolErr({
          code: "INTERNAL_ERROR",
          message: `Failed to create revenue schedule: ${e instanceof Error ? e.message : String(e)}`,
          details: [],
        });
      }
    },
  );

  // -----------------------------------------------------------------------
  // get_mrr
  // -----------------------------------------------------------------------
  server.tool(
    "get_mrr",
    "Get current Monthly Recurring Revenue (MRR), Annual Recurring Revenue (ARR), and other revenue metrics including deferred revenue balance and recognised revenue this month/year.",
    {
      ledgerId: z.string().describe("Ledger ID"),
    },
    async ({ ledgerId }) => {
      try {
        const metrics = await getRevenueMetrics(db, ledgerId);
        return toolOk(metrics);
      } catch (e) {
        return toolErr({
          code: "INTERNAL_ERROR",
          message: `Failed to get MRR: ${e instanceof Error ? e.message : String(e)}`,
          details: [],
        });
      }
    },
  );

  // -----------------------------------------------------------------------
  // get_deferred_revenue
  // -----------------------------------------------------------------------
  server.tool(
    "get_deferred_revenue",
    "Get the current deferred revenue balance — total unrecognised revenue across all active schedules. Also returns a breakdown by schedule.",
    {
      ledgerId: z.string().describe("Ledger ID"),
    },
    async ({ ledgerId }) => {
      try {
        const metrics = await getRevenueMetrics(db, ledgerId);
        const schedules = await listRevenueSchedules(db, ledgerId, { status: "active" });

        return toolOk({
          totalDeferred: metrics.deferredRevenueBalance,
          activeSchedules: metrics.activeSchedules,
          schedules: schedules.data.map((s) => ({
            id: s.id,
            customerName: s.customerName,
            totalAmount: s.totalAmount,
            amountRecognised: s.amountRecognised,
            amountRemaining: s.amountRemaining,
            recognitionEnd: s.recognitionEnd,
          })),
        });
      } catch (e) {
        return toolErr({
          code: "INTERNAL_ERROR",
          message: `Failed to get deferred revenue: ${e instanceof Error ? e.message : String(e)}`,
          details: [],
        });
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Recurring entry MCP tools — list, create, update, pause/resume.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerEngine } from "@kounta/core";
import { toolOk, toolErr } from "../lib/helpers.js";

const lineItemSchema = z.object({
  accountId: z.string().describe("Account ID (UUID)"),
  amount: z.number().int().positive().describe("Amount in smallest currency unit (e.g. cents)"),
  direction: z.enum(["debit", "credit"]).describe("Debit or credit"),
});

export function registerRecurringTools(
  server: McpServer,
  engine: LedgerEngine,
): void {
  // -----------------------------------------------------------------------
  // list_recurring_entries
  // -----------------------------------------------------------------------
  server.tool(
    "list_recurring_entries",
    "List all recurring journal entries for a ledger. Shows active and paused entries with their schedule and next run date.",
    {
      ledgerId: z.string().describe("Ledger ID"),
    },
    async ({ ledgerId }) => {
      const result = await engine.listRecurringEntries(ledgerId);
      if (!result.ok) return toolErr(result.error);
      return toolOk(result.value);
    },
  );

  // -----------------------------------------------------------------------
  // create_recurring_entry
  // -----------------------------------------------------------------------
  server.tool(
    "create_recurring_entry",
    "Create a new recurring journal entry for automated periodic postings (depreciation, accruals, etc.). Line items must balance (debits = credits). Uses account IDs, not codes.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      userId: z.string().describe("User ID who owns the entry"),
      description: z.string().describe("Description of the recurring entry (e.g. 'Monthly depreciation')"),
      lineItems: z.array(lineItemSchema).min(2).describe("Balanced line items (debits must equal credits)"),
      frequency: z.enum(["weekly", "monthly", "quarterly", "annually"]).describe("How often to post"),
      dayOfMonth: z.number().int().min(1).max(28).optional().describe("Day of month for monthly/quarterly/annually (1-28)"),
      nextRunDate: z.string().describe("First run date (YYYY-MM-DD)"),
      autoReverse: z.boolean().optional().describe("Auto-reverse on 1st of next period (for accruals)"),
    },
    async ({ ledgerId, userId, description, lineItems, frequency, dayOfMonth, nextRunDate, autoReverse }) => {
      const result = await engine.createRecurringEntry({
        ledgerId,
        userId,
        description,
        lineItems,
        frequency,
        dayOfMonth: dayOfMonth ?? null,
        nextRunDate,
        autoReverse: autoReverse ?? false,
      });
      if (!result.ok) return toolErr(result.error);
      return toolOk(result.value);
    },
  );

  // -----------------------------------------------------------------------
  // update_recurring_entry
  // -----------------------------------------------------------------------
  server.tool(
    "update_recurring_entry",
    "Update a recurring journal entry. Only provided fields are changed.",
    {
      entryId: z.string().describe("Recurring entry ID"),
      description: z.string().optional().describe("New description"),
      lineItems: z.array(lineItemSchema).min(2).optional().describe("New balanced line items"),
      frequency: z.enum(["weekly", "monthly", "quarterly", "annually"]).optional().describe("New frequency"),
      dayOfMonth: z.number().int().min(1).max(28).nullable().optional().describe("New day of month"),
      nextRunDate: z.string().optional().describe("New next run date (YYYY-MM-DD)"),
      autoReverse: z.boolean().optional().describe("New auto-reverse setting"),
    },
    async ({ entryId, ...input }) => {
      const result = await engine.updateRecurringEntry(entryId, input);
      if (!result.ok) return toolErr(result.error);
      return toolOk(result.value);
    },
  );

  // -----------------------------------------------------------------------
  // pause_recurring_entry
  // -----------------------------------------------------------------------
  server.tool(
    "pause_recurring_entry",
    "Pause a recurring entry so it won't be processed on its next run date. Can be resumed later.",
    {
      entryId: z.string().describe("Recurring entry ID"),
    },
    async ({ entryId }) => {
      const result = await engine.pauseRecurringEntry(entryId);
      if (!result.ok) return toolErr(result.error);
      return toolOk(result.value);
    },
  );

  // -----------------------------------------------------------------------
  // resume_recurring_entry
  // -----------------------------------------------------------------------
  server.tool(
    "resume_recurring_entry",
    "Resume a paused recurring entry so it will be processed again.",
    {
      entryId: z.string().describe("Recurring entry ID"),
    },
    async ({ entryId }) => {
      const result = await engine.resumeRecurringEntry(entryId);
      if (!result.ok) return toolErr(result.error);
      return toolOk(result.value);
    },
  );
}

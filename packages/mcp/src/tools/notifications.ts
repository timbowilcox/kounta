// ---------------------------------------------------------------------------
// Notification MCP tools — list, read, update, generate insights.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerEngine } from "@kounta/core";
import { handleResult, toolOk, toolErr } from "../lib/helpers.js";

export function registerNotificationTools(
  server: McpServer,
  engine: LedgerEngine,
  systemUserId: string,
): void {
  // -----------------------------------------------------------------------
  // list_notifications
  // -----------------------------------------------------------------------
  server.tool(
    "list_notifications",
    "List notifications (insights, alerts, anomalies) for a ledger. Filter by status or type.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      status: z
        .enum(["unread", "read", "dismissed", "actioned"])
        .optional()
        .describe("Filter by notification status"),
      type: z
        .enum([
          "monthly_summary",
          "cash_position",
          "anomaly",
          "unclassified_transactions",
          "sync_complete",
          "reconciliation_needed",
          "system",
        ])
        .optional()
        .describe("Filter by notification type"),
      limit: z.number().int().min(1).max(100).optional().describe("Max results (default 50)"),
    },
    async ({ ledgerId, status, type, limit }) => {
      const result = await engine.listNotifications(ledgerId, systemUserId, {
        status,
        type,
        limit,
      });
      if (!result.ok) return toolErr(result.error);
      return toolOk(result.value.notifications);
    },
  );

  // -----------------------------------------------------------------------
  // get_notification
  // -----------------------------------------------------------------------
  server.tool(
    "get_notification",
    "Get full details of a specific notification by ID.",
    {
      notificationId: z.string().describe("Notification ID"),
    },
    async ({ notificationId }) => {
      const result = await engine.getNotification(notificationId);
      return handleResult(result);
    },
  );

  // -----------------------------------------------------------------------
  // update_notification
  // -----------------------------------------------------------------------
  server.tool(
    "update_notification",
    "Update the status of a notification (mark as read, dismissed, or actioned).",
    {
      notificationId: z.string().describe("Notification ID"),
      status: z
        .enum(["unread", "read", "dismissed", "actioned"])
        .describe("New status for the notification"),
    },
    async ({ notificationId, status }) => {
      const result = await engine.updateNotificationStatus(notificationId, status);
      return handleResult(result);
    },
  );

  // -----------------------------------------------------------------------
  // generate_insights
  // -----------------------------------------------------------------------
  server.tool(
    "generate_insights",
    "Analyze the ledger and generate insight notifications: monthly summary, cash position, anomaly detection, and unclassified transaction alerts.",
    {
      ledgerId: z.string().describe("Ledger ID"),
    },
    async ({ ledgerId }) => {
      const result = await engine.generateInsights(ledgerId, systemUserId);
      if (!result.ok) return toolErr(result.error);
      return toolOk({
        generated: result.value.length,
        notifications: result.value,
      });
    },
  );
}

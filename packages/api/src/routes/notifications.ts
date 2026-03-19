// ---------------------------------------------------------------------------
// Notification routes — /v1/ledgers/:ledgerId/notifications
//
// All routes require API key auth. Notifications are the intelligence layer's
// outward-facing surface: insights, alerts, anomalies, and actionable items.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { errorResponse, success, paginated } from "../lib/responses.js";
import type { NotificationStatus, NotificationType } from "@kounta/core";

export const notificationRoutes = new Hono<Env>();

notificationRoutes.use("/*", apiKeyAuth);

// ---------------------------------------------------------------------------
// GET / — list notifications for the authenticated user
// ---------------------------------------------------------------------------

notificationRoutes.get("/", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const ledgerId = c.req.param("ledgerId")!;

  const status = c.req.query("status") as NotificationStatus | undefined;
  const type = c.req.query("type") as NotificationType | undefined;
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined;
  const cursor = c.req.query("cursor");

  const result = await engine.listNotifications(ledgerId, apiKeyInfo.userId, {
    status,
    type,
    limit,
    cursor: cursor ?? undefined,
  });

  if (!result.ok) return errorResponse(c, result.error);
  return paginated(c, result.value.notifications, result.value.nextCursor);
});

// ---------------------------------------------------------------------------
// POST /generate — trigger insight generation for this ledger
// ---------------------------------------------------------------------------

notificationRoutes.post("/generate", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const ledgerId = c.req.param("ledgerId")!;

  const result = await engine.generateInsights(ledgerId, apiKeyInfo.userId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, { generated: result.value.length, notifications: result.value });
});

// ---------------------------------------------------------------------------
// GET /preferences — get notification preferences
// ---------------------------------------------------------------------------

notificationRoutes.get("/preferences", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const ledgerId = c.req.param("ledgerId")!;

  const result = await engine.getNotificationPreferences(apiKeyInfo.userId, ledgerId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// PUT /preferences/:type — set a notification preference
// ---------------------------------------------------------------------------

notificationRoutes.put("/preferences/:type", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const ledgerId = c.req.param("ledgerId")!;
  const type = c.req.param("type") as NotificationType;
  const body = await c.req.json<{ enabled: boolean }>();

  if (typeof body.enabled !== "boolean") {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "'enabled' must be a boolean",
          requestId: c.get("requestId"),
        },
      },
      400
    );
  }

  const result = await engine.setNotificationPreference(
    apiKeyInfo.userId,
    ledgerId,
    type,
    body.enabled
  );
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// GET /:notificationId — get a single notification
// ---------------------------------------------------------------------------

notificationRoutes.get("/:notificationId", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const ledgerId = c.req.param("ledgerId")!;
  const notificationId = c.req.param("notificationId");

  const result = await engine.getNotification(notificationId);
  if (!result.ok) return errorResponse(c, result.error);

  // Verify the notification belongs to the authenticated ledger and user
  if (result.value.ledgerId !== ledgerId || result.value.userId !== apiKeyInfo.userId) {
    return c.json({ error: { code: "NOT_FOUND", message: "Notification not found", requestId: c.get("requestId") } }, 404);
  }

  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// PATCH /:notificationId — update notification status (read, dismissed, actioned)
// ---------------------------------------------------------------------------

notificationRoutes.patch("/:notificationId", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const ledgerId = c.req.param("ledgerId")!;
  const notificationId = c.req.param("notificationId");

  // Verify the notification belongs to the authenticated ledger before updating
  const existing = await engine.getNotification(notificationId);
  if (!existing.ok) return errorResponse(c, existing.error);
  if (existing.value.ledgerId !== ledgerId || existing.value.userId !== apiKeyInfo.userId) {
    return c.json({ error: { code: "NOT_FOUND", message: "Notification not found", requestId: c.get("requestId") } }, 404);
  }
  const body = await c.req.json<{ status: NotificationStatus }>();

  const validStatuses: NotificationStatus[] = ["unread", "read", "dismissed", "actioned"];
  if (!body.status || !validStatuses.includes(body.status)) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid status. Must be one of: unread, read, dismissed, actioned",
          requestId: c.get("requestId"),
        },
      },
      400
    );
  }

  const result = await engine.updateNotificationStatus(notificationId, body.status);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

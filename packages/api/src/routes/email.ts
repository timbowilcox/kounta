// ---------------------------------------------------------------------------
// Email routes — /v1/email
//
// Manage email preferences, trigger digests, and verify action tokens.
// Admin routes require admin auth, preference routes use API key auth.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth, adminAuth } from "../middleware/auth.js";
import { success } from "../lib/responses.js";
import {
  getEmailPreferences,
  updateEmailPreferences,
  verifyActionToken,
  markTokenUsed,
  checkAndSendDigests,
} from "@kounta/core";

export const emailRoutes = new Hono<Env>();

// ---------------------------------------------------------------------------
// GET /preferences — get the authenticated user's email preferences
// ---------------------------------------------------------------------------

emailRoutes.get("/preferences", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const prefs = await getEmailPreferences(engine.getDb(), apiKeyInfo.userId);
  if (!prefs) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Email preferences not found. They will be created automatically on next sign-in.",
          requestId: c.get("requestId"),
        },
      },
      404,
    );
  }

  return success(c, prefs);
});

// ---------------------------------------------------------------------------
// PUT /preferences — update email preferences
// ---------------------------------------------------------------------------

emailRoutes.put("/preferences", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const body = await c.req.json<{
    weeklyDigest?: boolean;
    monthlyClose?: boolean;
    urgentAlerts?: boolean;
    quarterlyTax?: boolean;
    timezone?: string;
    digestDay?: string;
  }>();

  // Validate digestDay
  const validDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  if (body.digestDay && !validDays.includes(body.digestDay.toLowerCase())) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid digest_day. Must be a day of the week (e.g., 'monday').",
          details: [
            {
              field: "digestDay",
              actual: body.digestDay,
              expected: validDays.join(", "),
            },
          ],
          requestId: c.get("requestId"),
        },
      },
      400,
    );
  }

  const updated = await updateEmailPreferences(engine.getDb(), apiKeyInfo.userId, {
    weeklyDigest: body.weeklyDigest,
    monthlyClose: body.monthlyClose,
    urgentAlerts: body.urgentAlerts,
    quarterlyTax: body.quarterlyTax,
    timezone: body.timezone,
    digestDay: body.digestDay?.toLowerCase(),
  });

  if (!updated) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Email preferences not found for this user.",
          requestId: c.get("requestId"),
        },
      },
      404,
    );
  }

  return success(c, updated);
});

// ---------------------------------------------------------------------------
// POST /send-digest — manually trigger digest for a user (admin)
// ---------------------------------------------------------------------------

emailRoutes.post("/send-digest", adminAuth, async (c) => {
  const engine = c.get("engine");

  const sentCount = await checkAndSendDigests(engine);

  return success(c, { sentCount });
});

// ---------------------------------------------------------------------------
// POST /verify-token — verify an email action token
// ---------------------------------------------------------------------------

emailRoutes.post("/verify-token", adminAuth, async (c) => {
  const engine = c.get("engine");
  const body = await c.req.json<{ token: string }>();

  if (!body.token) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Token is required",
          details: [{ field: "token", suggestion: "Provide the action token from the email link." }],
          requestId: c.get("requestId"),
        },
      },
      400,
    );
  }

  const tokenData = await verifyActionToken(engine.getDb(), body.token);
  if (!tokenData) {
    return c.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid, expired, or already-used token",
          requestId: c.get("requestId"),
        },
      },
      401,
    );
  }

  // Mark the token as used
  await markTokenUsed(engine.getDb(), body.token);

  return success(c, {
    userId: tokenData.userId,
    action: tokenData.action,
    payload: tokenData.payload,
  });
});

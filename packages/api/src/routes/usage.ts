// ---------------------------------------------------------------------------
// Usage routes — /v1/usage
//
// Provides tier-based usage information, history, and tier configuration.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { success, errorResponse } from "../lib/responses.js";
import {
  TIER_CONFIGS,
  createError,
  ErrorCode,
} from "@kounta/core";

export const usageRoutes = new Hono<Env>();

// ---------------------------------------------------------------------------
// GET /v1/tiers — public tier configuration (no auth)
// ---------------------------------------------------------------------------

usageRoutes.get("/tiers", async (c) => {
  return success(c, TIER_CONFIGS);
});

// ---------------------------------------------------------------------------
// Auth-protected usage routes
// ---------------------------------------------------------------------------

/** GET /v1/usage — current billing period usage summary */
usageRoutes.get("/", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  try {
    const summary = await engine.getUsageSummary(apiKeyInfo.userId);
    return success(c, summary);
  } catch (e) {
    return errorResponse(c, createError(
      ErrorCode.INTERNAL_ERROR,
      `Failed to get usage summary: ${e instanceof Error ? e.message : String(e)}`,
    ));
  }
});

/** GET /v1/usage/history — usage records for the last 12 months */
usageRoutes.get("/history", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  try {
    const history = await engine.getUsageHistory(apiKeyInfo.userId);
    return success(c, history);
  } catch (e) {
    return errorResponse(c, createError(
      ErrorCode.INTERNAL_ERROR,
      `Failed to get usage history: ${e instanceof Error ? e.message : String(e)}`,
    ));
  }
});

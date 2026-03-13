// ---------------------------------------------------------------------------
// Period close routes — /v1/ledgers/:ledgerId/periods
//
// Manage period closes and reopens for a ledger.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { errorResponse, success } from "../lib/responses.js";

export const periodRoutes = new Hono<Env>();

/** POST /close — Close a period through the given date */
periodRoutes.post("/close", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const ledgerId = c.req.param("ledgerId")!;
  const body = await c.req.json();

  if (!body.periodEnd) {
    return c.json({
      error: {
        code: "VALIDATION_ERROR",
        message: "periodEnd is required (ISO date string YYYY-MM-DD)",
        details: [{ field: "periodEnd", suggestion: "Provide the last day of the period to close, e.g. '2026-02-28'" }],
      },
    }, 400);
  }

  const result = await engine.closePeriod(ledgerId, body.periodEnd, apiKeyInfo.userId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

/** POST /reopen — Reopen a previously closed period */
periodRoutes.post("/reopen", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const ledgerId = c.req.param("ledgerId")!;
  const body = await c.req.json();

  if (!body.periodEnd) {
    return c.json({
      error: {
        code: "VALIDATION_ERROR",
        message: "periodEnd is required (ISO date string YYYY-MM-DD)",
        details: [{ field: "periodEnd", suggestion: "Provide the period_end date to reopen" }],
      },
    }, 400);
  }

  const result = await engine.reopenPeriod(ledgerId, body.periodEnd, apiKeyInfo.userId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

/** GET /closed — List all closed periods */
periodRoutes.get("/closed", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId")!;
  const periods = await engine.listClosedPeriods(ledgerId);
  return success(c, periods);
});

// ---------------------------------------------------------------------------
// Ledger routes — /v1/ledgers
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { adminAuth, apiKeyAuth } from "../middleware/auth.js";
import { errorResponse, created, success } from "../lib/responses.js";

export const ledgerRoutes = new Hono<Env>();

/** POST /v1/ledgers — Create a new ledger (admin auth required) */
ledgerRoutes.post("/", adminAuth, async (c) => {
  const engine = c.get("engine");
  const body = await c.req.json();

  // The apiKeyInfo is set for API-key auth; for admin secret auth it won't be set.
  // For ledger creation via admin secret, ownerId must be provided in the body.
  const apiKeyInfo = c.get("apiKeyInfo");
  const ownerId = body.ownerId ?? apiKeyInfo?.userId;

  if (!ownerId) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "ownerId is required",
          details: [
            {
              field: "ownerId",
              suggestion:
                "Provide an ownerId in the request body. This should be the UUID of the user who owns the ledger.",
            },
          ],
          requestId: c.get("requestId"),
        },
      },
      400
    );
  }

  const result = await engine.createLedger({
    name: body.name,
    currency: body.currency,
    fiscalYearStart: body.fiscalYearStart,
    accountingBasis: body.accountingBasis,
    ownerId,
    businessContext: body.businessContext,
  });

  if (!result.ok) {
    return errorResponse(c, result.error);
  }

  return created(c, result.value);
});

/** GET /v1/ledgers/:ledgerId — Get a ledger (API key auth required) */
ledgerRoutes.get("/:ledgerId", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId");

  const result = await engine.getLedger(ledgerId);
  if (!result.ok) {
    return errorResponse(c, result.error);
  }

  return success(c, result.value);
});

/** PATCH /v1/ledgers/:ledgerId — Update ledger settings (API key auth required) */
ledgerRoutes.patch("/:ledgerId", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId");
  const body = await c.req.json();

  const result = await engine.updateLedger(ledgerId, {
    name: body.name,
    fiscalYearStart: body.fiscalYearStart,
  });

  if (!result.ok) {
    return errorResponse(c, result.error);
  }

  return success(c, result.value);
});

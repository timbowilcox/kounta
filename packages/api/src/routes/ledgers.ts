// ---------------------------------------------------------------------------
// Ledger routes — /v1/ledgers
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/context.js";
import { adminAuth, apiKeyAuth } from "../middleware/auth.js";
import { errorResponse, created, success } from "../lib/responses.js";
import { validateBody } from "../lib/validate.js";
import { currencyCode, accountingBasis } from "@kounta/core";

export const ledgerRoutes = new Hono<Env>();

// Schema for ledger creation (validated at API boundary)
const createLedgerBodySchema = z.object({
  name: z.string().min(1).max(255),
  currency: currencyCode.default("USD"),
  templateSlug: z.string().optional(),
  businessType: z.string().optional(),
  naturalLanguageDescription: z.string().optional(),
  businessContext: z.record(z.unknown()).optional(),
  fiscalYearStart: z.number().int().min(1).max(12).default(1),
  accountingBasis: accountingBasis.default("accrual"),
  ownerId: z.string().min(1).optional(),
});

/** POST /v1/ledgers — Create a new ledger (admin auth required) */
ledgerRoutes.post("/", adminAuth, async (c) => {
  const engine = c.get("engine");
  const body = await validateBody(c, createLedgerBodySchema);
  if (body instanceof Response) return body;

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

  // Check ledger limit for the owner
  try {
    const limitCheck = await engine.checkLimit(ownerId, undefined, "ledgers");
    if (!limitCheck.allowed) {
      return c.json(
        {
          error: {
            code: "PLAN_LIMIT_EXCEEDED",
            message: limitCheck.message,
            details: [{ field: "ledgers", actual: String(limitCheck.used), expected: String(limitCheck.limit) }],
            limit: limitCheck.limit,
            used: limitCheck.used,
            upgrade_url: (process.env["NEXT_PUBLIC_APP_URL"] || "https://kounta.ai") + "/billing",
            requestId: c.get("requestId"),
          },
        },
        403,
      );
    }
  } catch { /* fail open if tier check unavailable */ }

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

/** GET /v1/ledgers — List all ledgers owned by the authenticated user */
ledgerRoutes.get("/", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo");
  if (!apiKeyInfo?.userId) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "No user context", details: [], requestId: c.get("requestId") } }, 401);
  }

  const result = await engine.findLedgersByOwner(apiKeyInfo.userId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
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

// Schema for ledger update
const updateLedgerBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  fiscalYearStart: z.number().int().min(1).max(12).optional(),
});

/** PATCH /v1/ledgers/:ledgerId — Update ledger settings (API key auth required) */
ledgerRoutes.patch("/:ledgerId", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId");
  const body = await validateBody(c, updateLedgerBodySchema);
  if (body instanceof Response) return body;

  const result = await engine.updateLedger(ledgerId, {
    name: body.name,
    fiscalYearStart: body.fiscalYearStart,
  });

  if (!result.ok) {
    return errorResponse(c, result.error);
  }

  return success(c, result.value);
});

/** DELETE /v1/ledgers/:ledgerId — Soft-delete a ledger (admin auth required) */
ledgerRoutes.delete("/:ledgerId", adminAuth, async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId");
  const body = await c.req.json().catch(() => ({})) as { userId?: string };

  const userId = body.userId ?? c.get("apiKeyInfo")?.userId;
  if (!userId) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "userId is required", details: [], requestId: c.get("requestId") } }, 400);
  }

  const result = await engine.softDeleteLedger(ledgerId, userId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

/** GET /v1/ledgers/:ledgerId/jurisdiction — Get jurisdiction settings */
ledgerRoutes.get("/:ledgerId/jurisdiction", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId");

  const result = await engine.getLedgerJurisdiction(ledgerId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

/** PATCH /v1/ledgers/:ledgerId/jurisdiction — Update jurisdiction settings */
ledgerRoutes.patch("/:ledgerId/jurisdiction", adminAuth, async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId");
  const body = await c.req.json() as {
    jurisdiction?: string;
    taxId?: string | null;
    taxBasis?: string;
  };

  const result = await engine.updateLedgerJurisdiction(ledgerId, body);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

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

/** GET /v1/ledgers/:ledgerId/jurisdiction — Get jurisdiction settings */
ledgerRoutes.get("/:ledgerId/jurisdiction", apiKeyAuth, async (c) => {
  const db = c.get("engine").getDb();
  const ledgerId = c.req.param("ledgerId");

  const row = await db.get<{ jurisdiction: string; tax_id: string | null; tax_basis: string; fiscal_year_start: number }>(
    "SELECT jurisdiction, tax_id, tax_basis, fiscal_year_start FROM ledgers WHERE id = ?",
    [ledgerId],
  );

  return success(c, {
    jurisdiction: row?.jurisdiction ?? "AU",
    taxId: row?.tax_id ?? null,
    taxBasis: row?.tax_basis ?? "accrual",
    fiscalYearStart: row?.fiscal_year_start ?? 1,
  });
});

/** PATCH /v1/ledgers/:ledgerId/jurisdiction — Update jurisdiction settings */
ledgerRoutes.patch("/:ledgerId/jurisdiction", apiKeyAuth, async (c) => {
  const db = c.get("engine").getDb();
  const ledgerId = c.req.param("ledgerId");
  const body = await c.req.json() as {
    jurisdiction?: string;
    taxId?: string | null;
    taxBasis?: string;
  };

  const sets: string[] = [];
  const params: unknown[] = [];

  if (body.jurisdiction !== undefined) {
    sets.push("jurisdiction = ?");
    params.push(body.jurisdiction);
  }
  if (body.taxId !== undefined) {
    sets.push("tax_id = ?");
    params.push(body.taxId);
  }
  if (body.taxBasis !== undefined) {
    sets.push("tax_basis = ?");
    params.push(body.taxBasis);
  }

  if (sets.length === 0) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "No fields to update", details: [] } }, 400);
  }

  sets.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(ledgerId);

  await db.run(`UPDATE ledgers SET ${sets.join(", ")} WHERE id = ?`, params);

  // Return updated jurisdiction data
  const row = await db.get<{ jurisdiction: string; tax_id: string | null; tax_basis: string }>(
    "SELECT jurisdiction, tax_id, tax_basis FROM ledgers WHERE id = ?",
    [ledgerId],
  );

  return success(c, {
    jurisdiction: row?.jurisdiction ?? "AU",
    taxId: row?.tax_id ?? null,
    taxBasis: row?.tax_basis ?? "accrual",
  });
});

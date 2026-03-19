// ---------------------------------------------------------------------------
// Account routes — /v1/ledgers/:ledgerId/accounts
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { errorResponse, created, success } from "../lib/responses.js";
import { validateBody } from "../lib/validate.js";
import { accountType, normalBalance, currencyCode } from "@kounta/core";

export const accountRoutes = new Hono<Env>();

// All account routes require API key auth
accountRoutes.use("/*", apiKeyAuth);

// Schema for account creation (validated at API boundary)
const createAccountBodySchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  type: accountType,
  normalBalance: normalBalance.optional(),
  parentCode: z.string().optional(),
  currency: currencyCode.optional(),
  metadata: z.record(z.unknown()).optional(),
});

/** POST /v1/ledgers/:ledgerId/accounts — Create an account */
accountRoutes.post("/", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId");
  const body = await validateBody(c, createAccountBodySchema);
  if (body instanceof Response) return body;

  const result = await engine.createAccount({
    ledgerId: ledgerId!,
    code: body.code,
    name: body.name,
    type: body.type,
    normalBalance: body.normalBalance,
    parentCode: body.parentCode,
    metadata: body.metadata,
  });

  if (!result.ok) {
    return errorResponse(c, result.error);
  }

  return created(c, result.value);
});

/** GET /v1/ledgers/:ledgerId/accounts — List all accounts */
accountRoutes.get("/", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId");

  const result = await engine.listAccounts(ledgerId!);
  if (!result.ok) {
    return errorResponse(c, result.error);
  }

  return success(c, result.value);
});

/** GET /v1/ledgers/:ledgerId/accounts/:accountId — Get a single account with balance */
accountRoutes.get("/:accountId", async (c) => {
  const engine = c.get("engine");
  const accountId = c.req.param("accountId");

  const result = await engine.getAccount(accountId);
  if (!result.ok) {
    return errorResponse(c, result.error);
  }

  // Enforce that the account belongs to the scoped ledger
  const ledgerId = c.req.param("ledgerId");
  if (result.value.ledgerId !== ledgerId) {
    return c.json(
      {
        error: {
          code: "ACCOUNT_NOT_FOUND",
          message: "Account not found in this ledger",
          details: [
            {
              field: "accountId",
              actual: accountId,
              suggestion:
                "This account exists but belongs to a different ledger. Verify you are using the correct ledger ID in the URL.",
            },
          ],
          requestId: c.get("requestId"),
        },
      },
      404
    );
  }

  return success(c, result.value);
});

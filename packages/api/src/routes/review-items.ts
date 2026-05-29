// ---------------------------------------------------------------------------
// Review-queue routes — /v1/ledgers/:ledgerId/review-items
//
// Ledger-scoped escalations needing a human decision (held CSV candidates,
// removed reconciled transactions). API-key auth; ledger scope enforced by the
// :ledgerId param in apiKeyAuth.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { errorResponse, success } from "../lib/responses.js";
import { createError, ErrorCode } from "@kounta/core";
import type { ReviewItemStatus } from "@kounta/core";

export const reviewItemRoutes = new Hono<Env>();

reviewItemRoutes.use("/*", apiKeyAuth);

/** GET /v1/ledgers/:ledgerId/review-items?status=open — list review items */
reviewItemRoutes.get("/", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId")!;
  const status = c.req.query("status") as ReviewItemStatus | undefined;
  const result = await engine.listReviewItems(ledgerId, status);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

/** POST /v1/ledgers/:ledgerId/review-items/:id/resolve — resolve a review item */
reviewItemRoutes.post("/:id/resolve", async (c) => {
  const engine = c.get("engine");
  const id = c.req.param("id")!;
  const body = await c.req.json().catch(() => ({}));
  const action = body.action;
  if (!["import", "dismiss", "acknowledge"].includes(action)) {
    return errorResponse(
      c,
      createError(ErrorCode.VALIDATION_ERROR, 'action must be "import", "dismiss", or "acknowledge"', [
        { field: "action", actual: String(action), suggestion: "Use import/dismiss for held candidates, acknowledge/dismiss for removed transactions." },
      ]),
    );
  }
  const result = await engine.resolveReviewItem(id, action);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// Provision route — POST /v1/admin/provision
//
// Single atomic endpoint for the NextAuth session-to-API-key bridge.
// Finds or creates a user, finds or creates a ledger, and issues an API key.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { adminAuth } from "../middleware/auth.js";
import { errorResponse, success } from "../lib/responses.js";
import type { Ledger } from "@ledge/core";

export const provisionRoutes = new Hono<Env>();

/** POST /v1/admin/provision — Provision a user with a ledger and API key */
provisionRoutes.post("/provision", adminAuth, async (c) => {
  const engine = c.get("engine");
  const body = await c.req.json();

  const { email, name, authProvider, authProviderId, templateSlug } = body;

  if (!email || !name || !authProvider || !authProviderId) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "email, name, authProvider, and authProviderId are required",
          details: [
            { field: "email", suggestion: "The user's email address" },
            { field: "name", suggestion: "The user's display name" },
            { field: "authProvider", suggestion: "OAuth provider (github, google)" },
            { field: "authProviderId", suggestion: "Provider-specific user ID" },
          ],
          requestId: c.get("requestId"),
        },
      },
      400
    );
  }

  // 1. Find or create user
  const existingResult = await engine.findUserByProvider(authProvider, authProviderId);
  if (!existingResult.ok) return errorResponse(c, existingResult.error);

  let user = existingResult.value;
  let isNew = false;

  if (!user) {
    isNew = true;
    const createResult = await engine.createUser({ email, name, authProvider, authProviderId });
    if (!createResult.ok) return errorResponse(c, createResult.error);
    user = createResult.value;
  }

  // 2. Find or create ledger
  const ledgersResult = await engine.findLedgersByOwner(user.id);
  if (!ledgersResult.ok) return errorResponse(c, ledgersResult.error);

  let ledger: Ledger | undefined;
  let needsTemplate = false;

  const firstLedger = ledgersResult.value[0];
  if (firstLedger) {
    ledger = firstLedger;
    needsTemplate = !firstLedger.templateId;
  } else {
    const ledgerResult = await engine.createLedger({
      name: name + "'s Ledger",
      ownerId: user.id,
    });
    if (!ledgerResult.ok) return errorResponse(c, ledgerResult.error);
    ledger = ledgerResult.value;
    needsTemplate = true;

    // Apply template if provided
    if (templateSlug) {
      const tplResult = await engine.applyTemplate(ledger.id, templateSlug);
      if (tplResult.ok) needsTemplate = false;
    }
  }

  if (!ledger) return errorResponse(c, { code: "INTERNAL_ERROR", message: "Failed to resolve ledger" } as never);

  // 3. Revoke old dashboard keys, then issue a fresh one
  const existingKeys = await engine.listApiKeys(ledger.id);
  if (existingKeys.ok) {
    for (const key of existingKeys.value) {
      if (key.name.startsWith("dashboard-") && key.status === "active") {
        await engine.revokeApiKey(key.id);
      }
    }
  }

  const keyResult = await engine.createApiKey({
    userId: user.id,
    ledgerId: ledger.id,
    name: "dashboard-" + authProvider,
  });
  if (!keyResult.ok) return errorResponse(c, keyResult.error);

  return success(c, {
    user,
    ledger,
    apiKey: {
      id: keyResult.value.apiKey.id,
      userId: keyResult.value.apiKey.userId,
      ledgerId: keyResult.value.apiKey.ledgerId,
      prefix: keyResult.value.apiKey.prefix,
      name: keyResult.value.apiKey.name,
      rawKey: keyResult.value.rawKey,
      status: keyResult.value.apiKey.status,
      createdAt: keyResult.value.apiKey.createdAt,
    },
    needsTemplate,
    isNew,
  });
});

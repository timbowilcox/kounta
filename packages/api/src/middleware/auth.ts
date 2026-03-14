// ---------------------------------------------------------------------------
// Authentication middleware for the Kounta API.
//
// Two modes:
//   1. API key auth: `Authorization: Bearer kounta_live_xxx` or `X-Api-Key: kounta_live_xxx`
//      - Validates the key via SHA-256 hash lookup
//      - Sets apiKeyInfo (userId, ledgerId) in context
//      - Enforces ledger scoping on routes that have :ledgerId param
//
//   2. Admin auth: `Authorization: Bearer <KOUNTA_ADMIN_SECRET>`
//      - For bootstrap operations (creating ledgers, managing API keys)
//      - Validates against KOUNTA_ADMIN_SECRET environment variable
// ---------------------------------------------------------------------------

import { createMiddleware } from "hono/factory";
import type { Env } from "../lib/context.js";

/**
 * API key authentication middleware.
 * Validates Bearer token against hashed API keys scoped to a specific ledger.
 */
export const apiKeyAuth = createMiddleware<Env>(async (c, next) => {
  const engine = c.get("engine");
  const rawKey = extractToken(c);

  if (!rawKey) {
    return c.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Missing API key",
          details: [
            {
              field: "Authorization",
              suggestion:
                'Provide an API key via "Authorization: Bearer kounta_live_xxx" header or "X-Api-Key: kounta_live_xxx" header. Create keys at POST /v1/api-keys.',
            },
          ],
          requestId: c.get("requestId"),
        },
      },
      401
    );
  }

  const result = await engine.validateApiKey(rawKey);
  if (!result.ok) {
    return c.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: result.error.message,
          details: [
            {
              field: "Authorization",
              actual: "kounta_live_***",
              suggestion:
                "The provided API key is invalid or has been revoked. Verify the key is correct, or create a new one at POST /v1/api-keys.",
            },
          ],
          requestId: c.get("requestId"),
        },
      },
      401
    );
  }

  const apiKey = result.value;

  // Enforce ledger scoping: if the route has a :ledgerId param, it must match the key
  const ledgerId = c.req.param("ledgerId");
  if (ledgerId && ledgerId !== apiKey.ledgerId) {
    return c.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "API key is not scoped to this ledger",
          details: [
            {
              field: "ledgerId",
              actual: ledgerId,
              expected: apiKey.ledgerId,
              suggestion:
                "This API key is scoped to a different ledger. Use an API key created for this ledger, or verify you are using the correct ledger ID in the URL.",
            },
          ],
          requestId: c.get("requestId"),
        },
      },
      403
    );
  }

  c.set("apiKeyInfo", {
    id: apiKey.id,
    userId: apiKey.userId,
    ledgerId: apiKey.ledgerId,
  });

  await next();
});

/**
 * Admin authentication middleware.
 * Validates against KOUNTA_ADMIN_SECRET env var or falls through to API key auth.
 */
export const adminAuth = createMiddleware<Env>(async (c, next) => {
  const token = extractToken(c);
  const adminSecret = process.env["KOUNTA_ADMIN_SECRET"];

  if (!token) {
    return c.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Missing authentication",
          details: [
            {
              field: "Authorization",
              suggestion:
                'Provide the admin secret via "Authorization: Bearer <KOUNTA_ADMIN_SECRET>" header, or use an API key. Admin routes require elevated privileges.',
            },
          ],
          requestId: c.get("requestId"),
        },
      },
      401
    );
  }

  // If admin secret is configured and token matches, grant admin access
  if (adminSecret && token === adminSecret) {
    await next();
    return;
  }

  // Otherwise try API key auth for admin routes
  const engine = c.get("engine");
  const result = await engine.validateApiKey(token);
  if (!result.ok) {
    return c.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid credentials",
          details: [
            {
              field: "Authorization",
              suggestion:
                'The provided token is not a valid admin secret or API key. Use "Authorization: Bearer <KOUNTA_ADMIN_SECRET>" for admin access, or provide a valid API key.',
            },
          ],
          requestId: c.get("requestId"),
        },
      },
      401
    );
  }

  c.set("apiKeyInfo", {
    id: result.value.id,
    userId: result.value.userId,
    ledgerId: result.value.ledgerId,
  });

  await next();
});

/** Extract Bearer token from Authorization header or X-Api-Key header */
const extractToken = (c: { req: { header: (name: string) => string | undefined } }): string | undefined => {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return c.req.header("X-Api-Key") ?? undefined;
};

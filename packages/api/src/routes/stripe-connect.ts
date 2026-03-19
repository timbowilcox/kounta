// ---------------------------------------------------------------------------
// Stripe Connect routes — /v1/stripe-connect
//
// Native Stripe integration for importing charges, refunds, and payouts.
// SEPARATE from billing.ts — this connects to the USER's Stripe account.
// Webhook endpoint is PUBLIC (no auth). All other routes require API key.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { success } from "../lib/responses.js";
import {
  getOAuthUrl,
  exchangeCode,
  verifyWebhookSignature,
} from "@kounta/core";

const STRIPE_CONNECT_CLIENT_ID = process.env["STRIPE_CONNECT_CLIENT_ID"];
const STRIPE_SECRET_KEY = process.env["STRIPE_SECRET_KEY"];
const DASHBOARD_URL = process.env["NEXT_PUBLIC_APP_URL"] || "https://kounta.ai";
const API_BASE_URL = process.env["API_BASE_URL"] || "https://api.kounta.ai";

export const stripeConnectRoutes = new Hono<Env>();

// ---------------------------------------------------------------------------
// Webhook — PUBLIC (no auth, signature-verified)
// Must be registered BEFORE auth-protected routes.
// ---------------------------------------------------------------------------

/** POST /v1/stripe-connect/webhook — Handle Stripe Connect webhook events */
stripeConnectRoutes.post("/webhook", async (c) => {
  const body = await c.req.text();
  const sig = c.req.header("stripe-signature");

  if (!sig) {
    return c.json({ error: "Missing stripe-signature header" }, 400);
  }

  let event: { id: string; type: string; data: { object: Record<string, unknown> }; account?: string };
  try {
    event = JSON.parse(body) as typeof event;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const engine = c.get("engine");

  // The event.account field contains the connected account ID
  const accountId = event.account;
  if (!accountId) {
    return c.json({ received: true, skipped: "no account field" }, 200);
  }

  // Look up connection by stripe_account_id
  const connRow = await engine.getStripeConnectionByAccountId(accountId);
  if (!connRow) {
    return c.json({ received: true, skipped: "unknown account" }, 200);
  }

  // Verify signature if webhook_secret is configured
  if (connRow.webhookSecret) {
    const valid = verifyWebhookSignature(body, sig, connRow.webhookSecret);
    if (!valid) {
      return c.json({ error: "Invalid signature" }, 400);
    }
  }

  // Get full connection
  const connection = await engine.getStripeConnectionByLedger(connRow.ledgerId);
  if (!connection) {
    return c.json({ received: true, skipped: "connection not found" }, 200);
  }

  // Only handle events we care about
  if (["charge.succeeded", "charge.refunded", "payout.paid", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
    try {
      await engine.handleStripeEvent(connection, event as Parameters<typeof engine.handleStripeEvent>[1]);
    } catch (e) {
      console.error("Error handling Stripe webhook event:", e);
    }
  }

  return c.json({ received: true }, 200);
});

// ---------------------------------------------------------------------------
// Auth-protected routes
// ---------------------------------------------------------------------------

/** GET /v1/stripe-connect/authorize — Returns the Stripe OAuth URL for the client to redirect to */
stripeConnectRoutes.get("/authorize", apiKeyAuth, async (c) => {
  if (!STRIPE_CONNECT_CLIENT_ID) {
    return c.json(
      { error: { code: "SERVICE_UNAVAILABLE", message: "Stripe Connect is not configured", details: [{ field: "STRIPE_CONNECT_CLIENT_ID", suggestion: "Set STRIPE_CONNECT_CLIENT_ID environment variable." }] } },
      503,
    );
  }

  const apiKeyInfo = c.get("apiKeyInfo")!;
  const state = Buffer.from(
    JSON.stringify({ userId: apiKeyInfo.userId, ledgerId: apiKeyInfo.ledgerId }),
  ).toString("base64url");

  const redirectUri = `${API_BASE_URL}/v1/stripe-connect/callback`;
  const url = getOAuthUrl(STRIPE_CONNECT_CLIENT_ID, redirectUri, state);
  return success(c, { url });
});

/** GET /v1/stripe-connect/callback — Handle OAuth callback */
stripeConnectRoutes.get("/callback", async (c) => {
  if (!STRIPE_CONNECT_CLIENT_ID || !STRIPE_SECRET_KEY) {
    return c.redirect(`${DASHBOARD_URL}/settings?tab=connections&error=not_configured`);
  }

  const code = c.req.query("code");
  const error = c.req.query("error");

  if (error || !code) {
    return c.redirect(`${DASHBOARD_URL}/settings?tab=connections&error=${error || "no_code"}`);
  }

  const engine = c.get("engine");

  try {
    const tokens = await exchangeCode(STRIPE_CONNECT_CLIENT_ID, STRIPE_SECRET_KEY, code);

    const state = c.req.query("state");
    let userId: string;
    let ledgerId: string;

    if (state) {
      try {
        const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
        userId = parsed.userId;
        ledgerId = parsed.ledgerId;
      } catch {
        return c.redirect(`${DASHBOARD_URL}/settings?tab=connections&error=invalid_state`);
      }
    } else {
      return c.redirect(`${DASHBOARD_URL}/settings?tab=connections&error=missing_state`);
    }

    // Create the connection
    const connection = await engine.createStripeConnection({
      userId,
      ledgerId,
      stripeAccountId: tokens.stripeUserId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      stripePublishableKey: tokens.stripePublishableKey,
    });

    // Ensure required accounts exist
    await engine.ensureStripeAccounts(ledgerId);

    // Trigger backfill asynchronously (don't block redirect)
    engine.backfillStripe(connection, 90).catch((e) => {
      console.error("Stripe backfill error:", e);
    });

    // Update onboarding checklist if exists
    await engine.completeOnboardingItem(userId, "connect_stripe");

    return c.redirect(`${DASHBOARD_URL}/settings?tab=connections&success=stripe`);
  } catch (e) {
    console.error("Stripe OAuth callback error:", e);
    return c.redirect(`${DASHBOARD_URL}/settings?tab=connections&error=oauth_failed`);
  }
});

/** GET /v1/stripe-connect/status — Connection status */
stripeConnectRoutes.get("/status", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const connection = await engine.getStripeConnectionByLedger(apiKeyInfo.ledgerId);
  if (!connection) {
    return success(c, null);
  }

  return success(c, {
    id: connection.id,
    stripeAccountId: connection.stripeAccountId,
    status: connection.status,
    lastSyncedAt: connection.lastSyncedAt,
    createdAt: connection.createdAt,
  });
});

/** POST /v1/stripe-connect/disconnect — Disconnect Stripe */
stripeConnectRoutes.post("/disconnect", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const connection = await engine.getStripeConnectionByLedger(apiKeyInfo.ledgerId);
  if (!connection) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "No active Stripe connection found" } },
      404,
    );
  }

  await engine.disconnectStripeConnection(connection.id);
  return success(c, { disconnected: true });
});

/** POST /v1/stripe-connect/sync — Manually trigger backfill */
stripeConnectRoutes.post("/sync", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const connection = await engine.getStripeConnectionByLedger(apiKeyInfo.ledgerId);
  if (!connection) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "No active Stripe connection found" } },
      404,
    );
  }

  // Run async — respond immediately
  engine.backfillStripe(connection, 90).catch((e) => {
    console.error("Stripe sync error:", e);
  });

  return success(c, { syncing: true, message: "Sync started for last 90 days" });
});

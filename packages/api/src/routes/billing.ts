// ---------------------------------------------------------------------------
// Billing routes — /v1/billing
//
// Handles Stripe Checkout, Customer Portal, Webhooks, and usage status.
// All routes except webhook require API key auth.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { success, errorResponse } from "../lib/responses.js";
import { createError, ErrorCode } from "@ledge/core";

const DASHBOARD_URL = process.env["NEXT_PUBLIC_APP_URL"] || "https://useledge.ai";
const STRIPE_SECRET_KEY = process.env["STRIPE_SECRET_KEY"];
const STRIPE_WEBHOOK_SECRET = process.env["STRIPE_WEBHOOK_SECRET"];

// Map Stripe price IDs to plan names
const PRICE_TO_PLAN: Record<string, string> = {
  "price_1T9ttSCyIk44TybLLuV2rf1e": "builder",
  "price_1T9tthCyIk44TybLKSNDey0u": "pro",
  "price_1T9tu7CyIk44TybLy8wONtPv": "platform",
};

// Lazy Stripe initialization
let stripeInstance: import("stripe").default | null = null;
const getStripe = async () => {
  if (stripeInstance) return stripeInstance;
  if (!STRIPE_SECRET_KEY) return null;
  const { default: Stripe } = await import("stripe");
  stripeInstance = new Stripe(STRIPE_SECRET_KEY);
  return stripeInstance;
};

export const billingRoutes = new Hono<Env>();

// ---------------------------------------------------------------------------
// Webhook — no auth (uses Stripe signature verification)
// Must be registered BEFORE auth-protected routes.
// ---------------------------------------------------------------------------

/** POST /v1/billing/webhook — Handle Stripe webhook events */
billingRoutes.post("/webhook", async (c) => {
  const stripe = await getStripe();
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return c.json({ error: "Billing webhooks not configured" }, 503);
  }

  const body = await c.req.text();
  const sig = c.req.header("stripe-signature");

  if (!sig) {
    return c.json({ error: "Missing stripe-signature header" }, 400);
  }

  let event: import("stripe").default.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("Webhook signature verification failed:", e);
    return c.json({ error: "Invalid signature" }, 400);
  }

  const engine = c.get("engine");

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as import("stripe").default.Checkout.Session;
      const userId = session.metadata?.ledge_user_id;
      if (userId) {
        // Determine plan from the subscription's price
        let plan = "builder";
        if (session.subscription && typeof session.subscription === "string") {
          try {
            const sub = await stripe.subscriptions.retrieve(session.subscription);
            const priceId = sub.items.data[0]?.price?.id;
            if (priceId && PRICE_TO_PLAN[priceId]) {
              plan = PRICE_TO_PLAN[priceId];
            }
          } catch (e) {
            console.error("Error retrieving subscription for plan detection:", e);
          }
        }

        await engine.updateUserPlan(
          userId,
          plan,
          session.customer as string,
          session.subscription as string,
        );

        // Post all pending transactions for user ledgers
        try {
          const ledgers = await engine.findLedgersByOwner(userId);
          if (ledgers.ok) {
            for (const ledger of ledgers.value) {
              await engine.postPendingTransactions(ledger.id);
            }
          }
        } catch (e) {
          console.error("Error posting pending transactions:", e);
        }
      }
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as import("stripe").default.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : (invoice.customer as { id: string } | null)?.id;
      if (customerId) {
        try {
          const userResult = await engine.findUserByStripeCustomer(customerId);
          if (userResult.ok && userResult.value) {
            const periodStart = invoice.period_start
              ? new Date(invoice.period_start * 1000).toISOString()
              : undefined;
            const periodEnd = invoice.period_end
              ? new Date(invoice.period_end * 1000).toISOString()
              : undefined;

            await engine.updateUserPlan(
              userResult.value.id,
              userResult.value.plan,
              undefined,
              undefined,
              periodStart,
              periodEnd,
            );

            // Reset usage counters for all user ledgers
            const ledgers = await engine.findLedgersByOwner(userResult.value.id);
            if (ledgers.ok) {
              for (const ledger of ledgers.value) {
                await engine.resetUsage(ledger.id);
              }
            }
          }
        } catch (e) {
          console.error("Error handling invoice.payment_succeeded:", e);
        }
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as import("stripe").default.Invoice;
      console.warn("Payment failed for customer " + invoice.customer + ", invoice " + invoice.id);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as import("stripe").default.Subscription;
      const customerId = typeof subscription.customer === "string" ? subscription.customer : (subscription.customer as { id: string } | null)?.id;
      if (customerId) {
        try {
          const userResult = await engine.findUserByStripeCustomer(customerId);
          if (userResult.ok && userResult.value) {
            await engine.updateUserPlan(
              userResult.value.id,
              "free",
            );
            console.log("Downgraded user " + userResult.value.id + " to free plan after subscription deletion");
          }
        } catch (e) {
          console.error("Error handling subscription deletion:", e);
        }
      }
      break;
    }

    default:
      console.log("Unhandled webhook event: " + event.type);
  }

  return c.json({ received: true }, 200);
});

// ---------------------------------------------------------------------------
// Auth-protected billing routes (checkout, portal, status)
// ---------------------------------------------------------------------------

/** POST /v1/billing/checkout — Create a Stripe Checkout session */
billingRoutes.post("/checkout", apiKeyAuth, async (c) => {
  const stripe = await getStripe();
  if (!stripe) {
    return c.json(
      { error: { code: "SERVICE_UNAVAILABLE", message: "Billing is not configured", details: [{ field: "stripe", suggestion: "Set STRIPE_SECRET_KEY environment variable to enable billing." }] } },
      503
    );
  }

  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const userResult = await engine.getUserByLedger(apiKeyInfo.ledgerId);
  if (!userResult.ok || !userResult.value) {
    return errorResponse(c, createError(ErrorCode.INTERNAL_ERROR, "User not found"));
  }
  const user = userResult.value;

  // Accept price_id from the request body
  const body = await c.req.json().catch(() => ({}));
  const priceId = body.price_id;

  if (!priceId || typeof priceId !== "string") {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "price_id is required", details: [{ field: "price_id", suggestion: "Provide a valid Stripe Price ID in the request body." }] } },
      400
    );
  }

  // Create or reuse Stripe customer
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { ledge_user_id: user.id },
    });
    customerId = customer.id;
    await engine.updateUserPlan(user.id, user.plan, customerId);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: DASHBOARD_URL + "/billing?success=true",
    cancel_url: DASHBOARD_URL + "/billing?canceled=true",
    metadata: { ledge_user_id: user.id },
  });

  return success(c, { url: session.url });
});

/** POST /v1/billing/portal — Create a Stripe Customer Portal session */
billingRoutes.post("/portal", apiKeyAuth, async (c) => {
  const stripe = await getStripe();
  if (!stripe) {
    return c.json(
      { error: { code: "SERVICE_UNAVAILABLE", message: "Billing is not configured", details: [{ field: "stripe", suggestion: "Set STRIPE_SECRET_KEY environment variable to enable billing." }] } },
      503
    );
  }

  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const userResult = await engine.getUserByLedger(apiKeyInfo.ledgerId);
  if (!userResult.ok || !userResult.value) {
    return errorResponse(c, createError(ErrorCode.INTERNAL_ERROR, "User not found"));
  }
  const user = userResult.value;

  if (!user.stripeCustomerId) {
    return c.json(
      { error: { code: "VALIDATION_ERROR", message: "No billing account found. Please upgrade first.", details: [] } },
      400
    );
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: DASHBOARD_URL + "/billing",
  });

  return success(c, { url: session.url });
});

/** GET /v1/billing/status — Get current billing status and usage */
billingRoutes.get("/status", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const userResult = await engine.getUserByLedger(apiKeyInfo.ledgerId);
  if (!userResult.ok || !userResult.value) {
    return errorResponse(c, createError(ErrorCode.INTERNAL_ERROR, "User not found"));
  }
  const user = userResult.value;

  const usageResult = await engine.getUsage(apiKeyInfo.ledgerId);
  const usage = usageResult.ok ? usageResult.value : { count: 0, limit: 500, periodStart: "", periodEnd: "" };

  // Calculate next reset date
  const endDate = new Date(usage.periodEnd || new Date());
  endDate.setDate(endDate.getDate() + 1);
  const nextResetDate = endDate.toISOString().split("T")[0];

  return success(c, {
    plan: user.plan,
    usage: {
      count: usage.count,
      limit: usage.limit === -1 ? null : usage.limit,
    },
    periodStart: usage.periodStart,
    periodEnd: usage.periodEnd,
    nextResetDate,
  });
});


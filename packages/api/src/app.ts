// ---------------------------------------------------------------------------
// Hono app factory — creates a configured Ledge API application.
//
// Separated from the server entry point for testability:
//   - Tests create an in-memory DB and call createApp(engine)
//   - The server entry point creates a real DB and calls createApp(engine)
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { generateId } from "@ledge/core";
import type { LedgerEngine, AttachmentStorage } from "@ledge/core";
import type { Env } from "./lib/context.js";
import { ledgerRoutes } from "./routes/ledgers.js";
import { accountRoutes } from "./routes/accounts.js";
import { transactionRoutes } from "./routes/transactions.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { auditRoutes } from "./routes/audit.js";
import { templateRoutes } from "./routes/templates.js";
import { reportRoutes } from "./routes/reports.js";
import { importRoutes, importBatchRoutes } from "./routes/imports.js";
import { bankFeedRoutes } from "./routes/bank-feeds.js";
import { classificationRoutes } from "./routes/classification.js";
import { notificationRoutes } from "./routes/notifications.js";
import { currencyRoutes } from "./routes/currencies.js";
import { conversationRoutes } from "./routes/conversations.js";
import { provisionRoutes } from "./routes/provision.js";
import { billingRoutes } from "./routes/billing.js";
import { emailRoutes } from "./routes/email.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { transactionAttachmentRoutes, attachmentRoutes } from "./routes/attachments.js";
import { recurringRoutes, recurringAdminRoutes } from "./routes/recurring.js";
import { periodRoutes } from "./routes/periods.js";
import { stripeConnectRoutes } from "./routes/stripe-connect.js";
import { revenueRoutes } from "./routes/revenue.js";

export const createApp = (engine: LedgerEngine, storage?: AttachmentStorage): Hono<Env> => {
  const app = new Hono<Env>();

  // ---------------------------------------------------------------------------
  // Global middleware — runs on every request
  // ---------------------------------------------------------------------------

  // Inject engine and request ID into every request context
  app.use("*", async (c, next) => {
    c.set("engine", engine);
    c.set("requestId", generateId());
    if (storage) c.set("storage", storage);
    await next();
  });

  // Global error handler
  app.onError((error, c) => {
    console.error(`[${c.get("requestId")}] Unhandled error:`, error);
    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
          details: [
            {
              field: "request",
              suggestion:
                "This is a server error. Retry the request, and if the problem persists, contact support with the requestId from this response.",
            },
          ],
          requestId: c.get("requestId"),
        },
      },
      500
    );
  });

  // ---------------------------------------------------------------------------
  // Health check — no auth required
  // ---------------------------------------------------------------------------

  app.get("/v1/health", (c) =>
    c.json({ status: "ok", version: "0.1.0", timestamp: new Date().toISOString() })
  );

  // ---------------------------------------------------------------------------
  // Route groups
  // ---------------------------------------------------------------------------

  app.route("/v1/ledgers/:ledgerId/accounts", accountRoutes);
  app.route("/v1/ledgers/:ledgerId/transactions", transactionRoutes);
  app.route("/v1/ledgers/:ledgerId/audit", auditRoutes);
  app.route("/v1/ledgers/:ledgerId/reports", reportRoutes);
  app.route("/v1/ledgers/:ledgerId/imports", importRoutes);
  app.route("/v1/ledgers/:ledgerId/bank-feeds", bankFeedRoutes);
  app.route("/v1/ledgers/:ledgerId/classification", classificationRoutes);
  app.route("/v1/ledgers/:ledgerId/notifications", notificationRoutes);
  app.route("/v1/ledgers/:ledgerId/currencies", currencyRoutes);
  app.route("/v1/ledgers/:ledgerId/conversations", conversationRoutes);
  app.route("/v1/ledgers/:ledgerId/transactions/:transactionId/attachments", transactionAttachmentRoutes);
  app.route("/v1/attachments", attachmentRoutes);
  app.route("/v1/imports/:batchId", importBatchRoutes);
  app.route("/v1/ledgers", ledgerRoutes);
  app.route("/v1/templates", templateRoutes);
  app.route("/v1/api-keys", apiKeyRoutes);
  app.route("/v1/admin", provisionRoutes);
  app.route("/v1/billing", billingRoutes);
  app.route("/v1/email", emailRoutes);
  app.route("/v1/ledgers/:ledgerId/recurring", recurringRoutes);
  app.route("/v1/recurring", recurringAdminRoutes);
  app.route("/v1/onboarding", onboardingRoutes);
  app.route("/v1/ledgers/:ledgerId/periods", periodRoutes);
  app.route("/v1/stripe-connect", stripeConnectRoutes);
  app.route("/v1/revenue", revenueRoutes);

  // ---------------------------------------------------------------------------
  // 404 fallback
  // ---------------------------------------------------------------------------

  app.notFound((c) =>
    c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: `Route not found: ${c.req.method} ${c.req.path}`,
          details: [
            {
              field: "path",
              actual: `${c.req.method} ${c.req.path}`,
              suggestion:
                "Check the URL path and HTTP method. All API routes are prefixed with /v1/. See GET /v1/health for a connectivity test.",
            },
          ],
        },
      },
      404
    )
  );

  return app;
};

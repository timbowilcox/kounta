// ---------------------------------------------------------------------------
// Revenue recognition routes — /v1/revenue
//
// Schedule management, recognition processing, and metrics.
// All routes require API key auth.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { success, created, errorResponse, paginated } from "../lib/responses.js";
import {
  createRevenueSchedule,
  getRevenueSchedule,
  listRevenueSchedules,
  updateRevenueSchedule,
  processRevenueRecognition,
  getRevenueMetrics,
  getMrrHistory,
  ensureRevenueAccounts,
} from "@ledge/core";
import type { CreateScheduleInput, UpdateScheduleInput } from "@ledge/core";

export const revenueRoutes = new Hono<Env>();

revenueRoutes.use("/*", apiKeyAuth);

// ---------------------------------------------------------------------------
// GET /schedules — list revenue schedules
// ---------------------------------------------------------------------------

revenueRoutes.get("/schedules", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const status = c.req.query("status");
  const customerName = c.req.query("customerName");
  const stripeSubscriptionId = c.req.query("stripeSubscriptionId");
  const cursor = c.req.query("cursor");
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;

  const result = await listRevenueSchedules(db, apiKeyInfo.ledgerId, {
    status: status ?? undefined,
    customerName: customerName ?? undefined,
    stripeSubscriptionId: stripeSubscriptionId ?? undefined,
    cursor: cursor ?? undefined,
    limit,
  });

  return paginated(c, result.data, result.nextCursor);
});

// ---------------------------------------------------------------------------
// GET /schedules/:id — get schedule with entries
// ---------------------------------------------------------------------------

revenueRoutes.get("/schedules/:id", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const scheduleId = c.req.param("id");

  const result = await getRevenueSchedule(db, scheduleId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /schedules — create a manual revenue schedule
// ---------------------------------------------------------------------------

interface CreateBody {
  totalAmount: number;
  currency?: string;
  recognitionStart: string;
  recognitionEnd: string;
  frequency?: "daily" | "monthly";
  sourceType?: "stripe" | "manual" | "import";
  sourceRef?: string;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
  customerName?: string;
  deferredRevenueAccountId?: string;
  revenueAccountId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

revenueRoutes.post("/schedules", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const body = await c.req.json<CreateBody>();

  if (!body.totalAmount || !body.recognitionStart || !body.recognitionEnd) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Missing required fields: totalAmount, recognitionStart, recognitionEnd",
          details: [
            { field: "totalAmount", suggestion: "Provide the total payment amount in cents." },
            { field: "recognitionStart", suggestion: "YYYY-MM-DD" },
            { field: "recognitionEnd", suggestion: "YYYY-MM-DD" },
          ],
          requestId: c.get("requestId"),
        },
      },
      400,
    );
  }

  // Auto-create revenue accounts if needed and no explicit IDs given
  let deferredRevenueAccountId = body.deferredRevenueAccountId;
  let revenueAccountId = body.revenueAccountId;

  if (!deferredRevenueAccountId || !revenueAccountId) {
    const accounts = await ensureRevenueAccounts(db, engine, apiKeyInfo.ledgerId);
    deferredRevenueAccountId = deferredRevenueAccountId ?? accounts.deferredRevenueAccountId;
    revenueAccountId = revenueAccountId ?? accounts.revenueAccountId;
  }

  const input: CreateScheduleInput = {
    ledgerId: apiKeyInfo.ledgerId,
    totalAmount: body.totalAmount,
    currency: body.currency,
    recognitionStart: body.recognitionStart,
    recognitionEnd: body.recognitionEnd,
    frequency: body.frequency,
    sourceType: body.sourceType ?? "manual",
    sourceRef: body.sourceRef,
    stripeSubscriptionId: body.stripeSubscriptionId,
    stripeCustomerId: body.stripeCustomerId,
    customerName: body.customerName,
    deferredRevenueAccountId,
    revenueAccountId,
    description: body.description,
    metadata: body.metadata,
  };

  const result = await createRevenueSchedule(db, input);
  if (!result.ok) return errorResponse(c, result.error);
  return created(c, result.value);
});

// ---------------------------------------------------------------------------
// PUT /schedules/:id — update schedule (pause, cancel, resume)
// ---------------------------------------------------------------------------

revenueRoutes.put("/schedules/:id", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const scheduleId = c.req.param("id");
  const body = await c.req.json<UpdateScheduleInput>();

  const validActions = ["pause", "cancel", "resume"];
  if (!body.action || !validActions.includes(body.action)) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid action. Must be one of: pause, cancel, resume",
          details: [{ field: "action", suggestion: "Use 'pause', 'cancel', or 'resume'." }],
          requestId: c.get("requestId"),
        },
      },
      400,
    );
  }

  const result = await updateRevenueSchedule(db, scheduleId, body);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /process — manually trigger recognition processing
// ---------------------------------------------------------------------------

revenueRoutes.post("/process", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const result = await processRevenueRecognition(db, engine, apiKeyInfo.ledgerId);
  return success(c, result);
});

// ---------------------------------------------------------------------------
// GET /metrics — MRR, ARR, deferred balance, recognised this month/year
// ---------------------------------------------------------------------------

revenueRoutes.get("/metrics", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const metrics = await getRevenueMetrics(db, apiKeyInfo.ledgerId);
  return success(c, metrics);
});

// ---------------------------------------------------------------------------
// GET /mrr-history — MRR over time (last N months)
// ---------------------------------------------------------------------------

revenueRoutes.get("/mrr-history", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const months = c.req.query("months") ? Number(c.req.query("months")) : 12;
  const history = await getMrrHistory(db, apiKeyInfo.ledgerId, months);
  return success(c, history);
});

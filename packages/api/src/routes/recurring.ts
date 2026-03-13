// ---------------------------------------------------------------------------
// Recurring entry routes — /v1/ledgers/:ledgerId/recurring
//
// CRUD + pause/resume for automated periodic journal postings.
// All routes require API key auth except POST /process (admin auth).
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth, adminAuth } from "../middleware/auth.js";
import { errorResponse, success, created } from "../lib/responses.js";
import type {
  Frequency,
  RecurringLineItem,
  CreateRecurringEntryInput,
  UpdateRecurringEntryInput,
} from "@ledge/core";

export const recurringRoutes = new Hono<Env>();

recurringRoutes.use("/*", apiKeyAuth);

// ---------------------------------------------------------------------------
// GET / — list recurring entries for this ledger
// ---------------------------------------------------------------------------

recurringRoutes.get("/", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const result = await engine.listRecurringEntries(apiKeyInfo.ledgerId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST / — create a recurring entry
// ---------------------------------------------------------------------------

interface CreateBody {
  description: string;
  lineItems: readonly RecurringLineItem[];
  frequency: Frequency;
  dayOfMonth?: number | null;
  nextRunDate: string;
  autoReverse?: boolean;
}

recurringRoutes.post("/", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const body = await c.req.json<CreateBody>();

  const validFrequencies: Frequency[] = ["weekly", "monthly", "quarterly", "annually"];
  if (!body.frequency || !validFrequencies.includes(body.frequency)) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid frequency. Must be one of: weekly, monthly, quarterly, annually",
          requestId: c.get("requestId"),
        },
      },
      400,
    );
  }

  if (!body.description || !body.lineItems || !body.nextRunDate) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Missing required fields: description, lineItems, nextRunDate",
          requestId: c.get("requestId"),
        },
      },
      400,
    );
  }

  const input: CreateRecurringEntryInput = {
    ledgerId: apiKeyInfo.ledgerId,
    userId: apiKeyInfo.userId,
    description: body.description,
    lineItems: body.lineItems,
    frequency: body.frequency,
    dayOfMonth: body.dayOfMonth ?? null,
    nextRunDate: body.nextRunDate,
    autoReverse: body.autoReverse ?? false,
  };

  const result = await engine.createRecurringEntry(input);
  if (!result.ok) return errorResponse(c, result.error);
  return created(c, result.value);
});

// ---------------------------------------------------------------------------
// GET /:id — get a recurring entry with recent logs
// ---------------------------------------------------------------------------

recurringRoutes.get("/:id", async (c) => {
  const engine = c.get("engine");
  const id = c.req.param("id");

  const result = await engine.getRecurringEntry(id);
  if (!result.ok) return errorResponse(c, result.error);

  const logs = await engine.getRecurringEntryLogs(id, 10);
  return success(c, { ...result.value, recentLogs: logs });
});

// ---------------------------------------------------------------------------
// PUT /:id — update a recurring entry
// ---------------------------------------------------------------------------

recurringRoutes.put("/:id", async (c) => {
  const engine = c.get("engine");
  const id = c.req.param("id");
  const body = await c.req.json<UpdateRecurringEntryInput>();

  const result = await engine.updateRecurringEntry(id, body);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// DELETE /:id — delete a recurring entry
// ---------------------------------------------------------------------------

recurringRoutes.delete("/:id", async (c) => {
  const engine = c.get("engine");
  const id = c.req.param("id");

  const result = await engine.deleteRecurringEntry(id);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /:id/pause — pause a recurring entry
// ---------------------------------------------------------------------------

recurringRoutes.post("/:id/pause", async (c) => {
  const engine = c.get("engine");
  const id = c.req.param("id");

  const result = await engine.pauseRecurringEntry(id);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /:id/resume — resume a recurring entry
// ---------------------------------------------------------------------------

recurringRoutes.post("/:id/resume", async (c) => {
  const engine = c.get("engine");
  const id = c.req.param("id");

  const result = await engine.resumeRecurringEntry(id);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// Admin-only route for manual trigger
// ---------------------------------------------------------------------------

export const recurringAdminRoutes = new Hono<Env>();

recurringAdminRoutes.use("/*", adminAuth);

recurringAdminRoutes.post("/process", async (c) => {
  const engine = c.get("engine");
  const result = await engine.processRecurringEntries();
  return success(c, result);
});

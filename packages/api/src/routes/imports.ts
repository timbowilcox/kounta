// ---------------------------------------------------------------------------
// Import routes — /v1/ledgers/:ledgerId/imports and /v1/imports/:batchId
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { errorResponse, created, success, paginated } from "../lib/responses.js";
import { parseBoundedInt } from "../lib/validate.js";
import { createError, ErrorCode } from "@kounta/core";

// ---------------------------------------------------------------------------
// Ledger-scoped routes: /v1/ledgers/:ledgerId/imports
// ---------------------------------------------------------------------------

export const importRoutes = new Hono<Env>();

importRoutes.use("/*", apiKeyAuth);

/** POST /v1/ledgers/:ledgerId/imports — Create a new import batch */
importRoutes.post("/", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId");
  const body = await c.req.json();

  const result = await engine.createImport({
    ledgerId: ledgerId!,
    fileContent: body.fileContent,
    fileType: body.fileType,
    filename: body.filename,
  });

  if (!result.ok) {
    return errorResponse(c, result.error);
  }

  return created(c, result.value);
});

// ---------------------------------------------------------------------------
// Manual CSV import — column mapping, preview, commit (cross-channel dedup).
// Lands in the dashboard /bank-feeds area; ledger scope enforced by apiKeyAuth.
// ---------------------------------------------------------------------------

const requireCsvBody = (body: { ledgerAccountId?: unknown; fileContent?: unknown; mapping?: unknown }) => {
  if (typeof body.ledgerAccountId !== "string" || !body.ledgerAccountId) {
    return "ledgerAccountId is required";
  }
  if (typeof body.fileContent !== "string" || !body.fileContent) {
    return "fileContent is required";
  }
  if (typeof body.mapping !== "object" || body.mapping === null) {
    return "mapping is required";
  }
  return null;
};

/** POST /v1/ledgers/:ledgerId/imports/csv/preview — Dry-run a CSV import */
importRoutes.post("/csv/preview", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId")!;
  const body = await c.req.json().catch(() => ({}));

  const validationMessage = requireCsvBody(body);
  if (validationMessage) {
    return errorResponse(c, createError(ErrorCode.VALIDATION_ERROR, validationMessage));
  }

  const result = await engine.previewCsvImport({
    ledgerId,
    ledgerAccountId: body.ledgerAccountId,
    fileContent: body.fileContent,
    mapping: body.mapping,
  });
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

/** POST /v1/ledgers/:ledgerId/imports/csv/commit — Commit a CSV import */
importRoutes.post("/csv/commit", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId")!;
  const body = await c.req.json().catch(() => ({}));

  const validationMessage = requireCsvBody(body);
  if (validationMessage) {
    return errorResponse(c, createError(ErrorCode.VALIDATION_ERROR, validationMessage));
  }

  const result = await engine.commitCsvImport({
    ledgerId,
    ledgerAccountId: body.ledgerAccountId,
    fileContent: body.fileContent,
    mapping: body.mapping,
    filename: body.filename,
  });
  if (!result.ok) return errorResponse(c, result.error);
  return created(c, result.value);
});

// --- Reusable per-bank mapping profiles ------------------------------------

/** GET /v1/ledgers/:ledgerId/imports/mappings — List mapping profiles */
importRoutes.get("/mappings", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId")!;
  const result = await engine.listMappingProfiles(ledgerId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

/** POST /v1/ledgers/:ledgerId/imports/mappings — Create a mapping profile */
importRoutes.post("/mappings", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId")!;
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.name !== "string" || !body.name) {
    return errorResponse(c, createError(ErrorCode.VALIDATION_ERROR, "name is required"));
  }
  const result = await engine.createMappingProfile({ ledgerId, name: body.name, mapping: body.mapping });
  if (!result.ok) return errorResponse(c, result.error);
  return created(c, result.value);
});

/** GET /v1/ledgers/:ledgerId/imports/mappings/:profileId — Get a mapping profile */
importRoutes.get("/mappings/:profileId", async (c) => {
  const engine = c.get("engine");
  const result = await engine.getMappingProfile(c.req.param("profileId")!);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

/** PUT /v1/ledgers/:ledgerId/imports/mappings/:profileId — Update a mapping profile */
importRoutes.put("/mappings/:profileId", async (c) => {
  const engine = c.get("engine");
  const body = await c.req.json().catch(() => ({}));
  const result = await engine.updateMappingProfile(c.req.param("profileId")!, {
    name: body.name,
    mapping: body.mapping,
  });
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

/** DELETE /v1/ledgers/:ledgerId/imports/mappings/:profileId — Delete a mapping profile */
importRoutes.delete("/mappings/:profileId", async (c) => {
  const engine = c.get("engine");
  const result = await engine.deleteMappingProfile(c.req.param("profileId")!);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, { id: c.req.param("profileId"), deleted: true });
});

/** GET /v1/ledgers/:ledgerId/imports — List import batches (paginated) */
importRoutes.get("/", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId");
  const cursor = c.req.query("cursor");
  const limit = parseBoundedInt(c.req.query("limit"), { min: 1, max: 200, defaultValue: 50 });

  const result = await engine.listImportBatches(ledgerId!, { cursor, limit });
  if (!result.ok) {
    return errorResponse(c, result.error);
  }

  return paginated(c, result.value.data, result.value.nextCursor);
});

// ---------------------------------------------------------------------------
// Batch-scoped routes: /v1/imports/:batchId
// ---------------------------------------------------------------------------

export const importBatchRoutes = new Hono<Env>();

importBatchRoutes.use("/*", apiKeyAuth);

/** GET /v1/imports/:batchId — Get import batch detail */
importBatchRoutes.get("/", async (c) => {
  const engine = c.get("engine");
  const batchId = c.req.param("batchId");

  const result = await engine.getImportBatch(batchId!);
  if (!result.ok) {
    return errorResponse(c, result.error);
  }

  return success(c, result.value);
});

/** POST /v1/imports/:batchId/confirm — Confirm/reject/override matches */
importBatchRoutes.post("/confirm", async (c) => {
  const engine = c.get("engine");
  const batchId = c.req.param("batchId");
  const body = await c.req.json();

  const result = await engine.confirmMatches({
    batchId: batchId!,
    actions: body.actions,
  });

  if (!result.ok) {
    return errorResponse(c, result.error);
  }

  return success(c, result.value);
});

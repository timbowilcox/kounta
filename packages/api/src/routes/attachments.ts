// ---------------------------------------------------------------------------
// Attachment routes
//
// Transaction-scoped: /v1/ledgers/:ledgerId/transactions/:transactionId/attachments
//   POST /   — upload attachment (multipart)
//   GET /    — list attachments for a transaction
//
// Standalone: /v1/attachments
//   GET /:id/download  — download attachment binary
//   DELETE /:id        — delete attachment
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { errorResponse, created, success } from "../lib/responses.js";
import {
  createError,
  ErrorCode,
  generateId,
  createAttachment,
  listAttachments,
  getAttachment,
  deleteAttachment,
} from "@ledge/core";

// ---------------------------------------------------------------------------
// Transaction-scoped routes (mounted under /v1/ledgers/:ledgerId/transactions/:transactionId/attachments)
// ---------------------------------------------------------------------------

export const transactionAttachmentRoutes = new Hono<Env>();
transactionAttachmentRoutes.use("/*", apiKeyAuth);

/** POST / — Upload an attachment */
transactionAttachmentRoutes.post("/", async (c) => {
  const engine = c.get("engine");
  const storage = c.get("storage");

  if (!storage) {
    return errorResponse(
      c,
      createError(ErrorCode.INTERNAL_ERROR, "Attachment storage is not configured", [
        { field: "storage", suggestion: "Set LEDGE_ATTACHMENTS_DIR environment variable to enable attachments." },
      ])
    );
  }

  const ledgerId = c.req.param("ledgerId")!;
  const transactionId = c.req.param("transactionId")!;
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const body = await c.req.parseBody();
  const file = body["file"];

  if (!file || typeof file === "string") {
    return errorResponse(
      c,
      createError(ErrorCode.VALIDATION_ERROR, "No file uploaded", [
        { field: "file", suggestion: "Send a multipart form with a 'file' field containing the attachment." },
      ])
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const fileData = Buffer.from(arrayBuffer);
  const filename = file.name || "attachment";
  const mimeType = file.type || "application/octet-stream";
  const sizeBytes = fileData.length;

  // Build storage key: ledgerId/transactionId/uuid-filename
  const storageKey = `${ledgerId}/${transactionId}/${generateId()}-${filename}`;

  const db = engine.getDb();
  const result = await createAttachment(db, storage, {
    transactionId,
    ledgerId,
    filename,
    mimeType,
    sizeBytes,
    storageKey,
    uploadedBy: apiKeyInfo.userId,
  }, fileData);

  if (!result.ok) return errorResponse(c, result.error);

  return created(c, result.value);
});

/** GET / — List attachments for a transaction */
transactionAttachmentRoutes.get("/", async (c) => {
  const engine = c.get("engine");
  const transactionId = c.req.param("transactionId")!;

  const db = engine.getDb();
  const result = await listAttachments(db, transactionId);

  if (!result.ok) return errorResponse(c, result.error);

  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// Standalone routes (mounted under /v1/attachments)
// ---------------------------------------------------------------------------

export const attachmentRoutes = new Hono<Env>();
attachmentRoutes.use("/*", apiKeyAuth);

/** GET /:id/download — Download attachment binary */
attachmentRoutes.get("/:id/download", async (c) => {
  const engine = c.get("engine");
  const storage = c.get("storage");

  if (!storage) {
    return errorResponse(
      c,
      createError(ErrorCode.INTERNAL_ERROR, "Attachment storage is not configured")
    );
  }

  const attachmentId = c.req.param("id")!;
  const db = engine.getDb();

  const result = await getAttachment(db, attachmentId);
  if (!result.ok) return errorResponse(c, result.error);

  const attachment = result.value;

  try {
    const { data, mimeType } = await storage.download(attachment.storageKey);
    return new Response(data, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${attachment.filename}"`,
        "Content-Length": String(data.length),
      },
    });
  } catch (e) {
    return errorResponse(
      c,
      createError(ErrorCode.INTERNAL_ERROR, `Failed to download attachment: ${e instanceof Error ? e.message : String(e)}`)
    );
  }
});

/** DELETE /:id — Delete attachment */
attachmentRoutes.delete("/:id", async (c) => {
  const engine = c.get("engine");
  const storage = c.get("storage");

  if (!storage) {
    return errorResponse(
      c,
      createError(ErrorCode.INTERNAL_ERROR, "Attachment storage is not configured")
    );
  }

  const attachmentId = c.req.param("id")!;
  const db = engine.getDb();

  const result = await deleteAttachment(db, storage, attachmentId);
  if (!result.ok) return errorResponse(c, result.error);

  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// Attachment CRUD — transaction receipt/document management.
// ---------------------------------------------------------------------------

import type { Database } from "../db/database.js";
import type { AttachmentStorage } from "../storage/types.js";
import type { Result } from "../types/index.js";
import { createError, ErrorCode, ok, err } from "../errors/index.js";
import { generateId } from "../engine/id.js";
import type {
  TransactionAttachment,
  TransactionAttachmentRow,
  CreateAttachmentInput,
} from "./types.js";
import { toTransactionAttachment } from "./types.js";

/** Maximum file size: 10 MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Allowed MIME types */
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/svg+xml",
  "application/pdf",
]);

export const createAttachment = async (
  db: Database,
  storage: AttachmentStorage,
  input: CreateAttachmentInput,
  fileData: Buffer,
): Promise<Result<TransactionAttachment>> => {
  // Validate size
  if (input.sizeBytes > MAX_FILE_SIZE) {
    return err(
      createError(ErrorCode.VALIDATION_ERROR, `File too large: ${input.sizeBytes} bytes (max ${MAX_FILE_SIZE})`, [
        { field: "file", actual: String(input.sizeBytes), expected: `<= ${MAX_FILE_SIZE}`, suggestion: "Upload a file smaller than 10 MB." },
      ])
    );
  }

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    return err(
      createError(ErrorCode.VALIDATION_ERROR, `Unsupported file type: ${input.mimeType}`, [
        { field: "mimeType", actual: input.mimeType, expected: Array.from(ALLOWED_MIME_TYPES).join(", "), suggestion: "Upload an image (JPEG, PNG, GIF, WebP) or PDF." },
      ])
    );
  }

  const id = generateId();

  // Upload to storage
  try {
    await storage.upload(input.storageKey, fileData, input.mimeType);
  } catch (e) {
    return err(
      createError(ErrorCode.INTERNAL_ERROR, `Storage upload failed: ${e instanceof Error ? e.message : String(e)}`)
    );
  }

  // Insert DB row
  await db.run(
    `INSERT INTO transaction_attachments (id, transaction_id, ledger_id, filename, mime_type, size_bytes, storage_key, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.transactionId, input.ledgerId, input.filename, input.mimeType, input.sizeBytes, input.storageKey, input.uploadedBy],
  );

  const row = await db.get<TransactionAttachmentRow>(
    "SELECT * FROM transaction_attachments WHERE id = ?",
    [id],
  );

  return ok(toTransactionAttachment(row!));
};

export const listAttachments = async (
  db: Database,
  transactionId: string,
): Promise<Result<readonly TransactionAttachment[]>> => {
  const rows = await db.all<TransactionAttachmentRow>(
    "SELECT * FROM transaction_attachments WHERE transaction_id = ? ORDER BY created_at ASC",
    [transactionId],
  );
  return ok(rows.map(toTransactionAttachment));
};

export const getAttachment = async (
  db: Database,
  attachmentId: string,
): Promise<Result<TransactionAttachment>> => {
  const row = await db.get<TransactionAttachmentRow>(
    "SELECT * FROM transaction_attachments WHERE id = ?",
    [attachmentId],
  );
  if (!row) {
    return err(
      createError(ErrorCode.ATTACHMENT_NOT_FOUND, `Attachment ${attachmentId} not found`, [
        { field: "id", actual: attachmentId, suggestion: "Check the attachment ID." },
      ])
    );
  }
  return ok(toTransactionAttachment(row));
};

export const deleteAttachment = async (
  db: Database,
  storage: AttachmentStorage,
  attachmentId: string,
): Promise<Result<{ id: string; deleted: true }>> => {
  const row = await db.get<TransactionAttachmentRow>(
    "SELECT * FROM transaction_attachments WHERE id = ?",
    [attachmentId],
  );
  if (!row) {
    return err(
      createError(ErrorCode.ATTACHMENT_NOT_FOUND, `Attachment ${attachmentId} not found`, [
        { field: "id", actual: attachmentId, suggestion: "Check the attachment ID." },
      ])
    );
  }

  // Delete from storage (best-effort)
  try {
    await storage.delete(row.storage_key);
  } catch (e) {
    console.error("Storage delete error (continuing):", e);
  }

  await db.run("DELETE FROM transaction_attachments WHERE id = ?", [attachmentId]);

  return ok({ id: attachmentId, deleted: true as const });
};

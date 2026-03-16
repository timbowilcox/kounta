// ---------------------------------------------------------------------------
// Invoice routes — /v1/invoices
//
// Full Accounts Receivable lifecycle: create, send (approve), record payment,
// void, summary, and AR aging. All routes require API key auth.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { success, created, errorResponse, paginated } from "../lib/responses.js";
import {
  createInvoice,
  updateInvoice,
  sendInvoice,
  recordPayment,
  voidInvoice,
  getInvoice,
  listInvoices,
  getInvoiceSummary,
  getARAging,
} from "@kounta/core";
import type { CreateInvoiceInput, UpdateInvoiceInput, RecordPaymentInput } from "@kounta/core";

export const invoiceRoutes = new Hono<Env>();

invoiceRoutes.use("/*", apiKeyAuth);

// ---------------------------------------------------------------------------
// GET / — list invoices
// ---------------------------------------------------------------------------

invoiceRoutes.get("/", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const status = c.req.query("status");
  const customer = c.req.query("customer");
  const fromDate = c.req.query("from_date");
  const toDate = c.req.query("to_date");
  const cursor = c.req.query("cursor");
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;

  const result = await listInvoices(db, apiKeyInfo.ledgerId, {
    status: status ?? undefined,
    customerName: customer ?? undefined,
    dateFrom: fromDate ?? undefined,
    dateTo: toDate ?? undefined,
    cursor: cursor ?? undefined,
    limit,
  });

  return paginated(c, result.data, result.cursor);
});

// ---------------------------------------------------------------------------
// GET /summary — invoice summary
// ---------------------------------------------------------------------------

invoiceRoutes.get("/summary", async (c) => {
  const db = c.get("engine").getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const summary = await getInvoiceSummary(db, apiKeyInfo.ledgerId);
  return success(c, summary);
});

// ---------------------------------------------------------------------------
// GET /aging — AR aging report
// ---------------------------------------------------------------------------

invoiceRoutes.get("/aging", async (c) => {
  const db = c.get("engine").getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const buckets = await getARAging(db, apiKeyInfo.ledgerId);
  return success(c, buckets);
});

// ---------------------------------------------------------------------------
// POST / — create invoice
// ---------------------------------------------------------------------------

invoiceRoutes.post("/", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const body = await c.req.json() as Omit<CreateInvoiceInput, "ledgerId">;

  const result = await createInvoice(db, apiKeyInfo.ledgerId, apiKeyInfo.userId ?? "system", body);
  if (!result.ok) return errorResponse(c, result.error);
  return created(c, result.value);
});

// ---------------------------------------------------------------------------
// GET /:id — get invoice with line items and payments
// ---------------------------------------------------------------------------

invoiceRoutes.get("/:id", async (c) => {
  const db = c.get("engine").getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const invoiceId = c.req.param("id");

  // Verify invoice belongs to ledger
  const existing = await db.get<{ ledger_id: string }>(
    "SELECT ledger_id FROM invoices WHERE id = ?",
    [invoiceId],
  );
  if (!existing || existing.ledger_id !== apiKeyInfo.ledgerId) {
    return errorResponse(c, { code: "INVOICE_NOT_FOUND", message: `Invoice not found: ${invoiceId}` });
  }

  const result = await getInvoice(db, invoiceId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// PATCH /:id — update draft invoice
// ---------------------------------------------------------------------------

invoiceRoutes.patch("/:id", async (c) => {
  const db = c.get("engine").getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const invoiceId = c.req.param("id");

  const existing = await db.get<{ ledger_id: string }>(
    "SELECT ledger_id FROM invoices WHERE id = ?",
    [invoiceId],
  );
  if (!existing || existing.ledger_id !== apiKeyInfo.ledgerId) {
    return errorResponse(c, { code: "INVOICE_NOT_FOUND", message: `Invoice not found: ${invoiceId}` });
  }

  const body = await c.req.json() as UpdateInvoiceInput;
  const result = await updateInvoice(db, invoiceId, body);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /:id/send — approve and post AR journal entry
// ---------------------------------------------------------------------------

invoiceRoutes.post("/:id/send", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const invoiceId = c.req.param("id");

  const existing = await db.get<{ ledger_id: string }>(
    "SELECT ledger_id FROM invoices WHERE id = ?",
    [invoiceId],
  );
  if (!existing || existing.ledger_id !== apiKeyInfo.ledgerId) {
    return errorResponse(c, { code: "INVOICE_NOT_FOUND", message: `Invoice not found: ${invoiceId}` });
  }

  const result = await sendInvoice(db, engine, invoiceId, apiKeyInfo.ledgerId, apiKeyInfo.userId ?? "system");
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /:id/payment — record payment against invoice
// ---------------------------------------------------------------------------

invoiceRoutes.post("/:id/payment", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const invoiceId = c.req.param("id");

  const existing = await db.get<{ ledger_id: string }>(
    "SELECT ledger_id FROM invoices WHERE id = ?",
    [invoiceId],
  );
  if (!existing || existing.ledger_id !== apiKeyInfo.ledgerId) {
    return errorResponse(c, { code: "INVOICE_NOT_FOUND", message: `Invoice not found: ${invoiceId}` });
  }

  const body = await c.req.json() as RecordPaymentInput;
  const result = await recordPayment(db, engine, invoiceId, apiKeyInfo.ledgerId, apiKeyInfo.userId ?? "system", body);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /:id/void — void invoice and reverse AR entry
// ---------------------------------------------------------------------------

invoiceRoutes.post("/:id/void", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const invoiceId = c.req.param("id");

  const existing = await db.get<{ ledger_id: string }>(
    "SELECT ledger_id FROM invoices WHERE id = ?",
    [invoiceId],
  );
  if (!existing || existing.ledger_id !== apiKeyInfo.ledgerId) {
    return errorResponse(c, { code: "INVOICE_NOT_FOUND", message: `Invoice not found: ${invoiceId}` });
  }

  const result = await voidInvoice(db, engine, invoiceId, apiKeyInfo.ledgerId, apiKeyInfo.userId ?? "system");
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// DELETE /:id — delete draft invoice (no accounting impact)
// ---------------------------------------------------------------------------

invoiceRoutes.delete("/:id", async (c) => {
  const db = c.get("engine").getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const invoiceId = c.req.param("id");

  const existing = await db.get<{ ledger_id: string; status: string }>(
    "SELECT ledger_id, status FROM invoices WHERE id = ?",
    [invoiceId],
  );
  if (!existing || existing.ledger_id !== apiKeyInfo.ledgerId) {
    return errorResponse(c, { code: "INVOICE_NOT_FOUND", message: `Invoice not found: ${invoiceId}` });
  }
  if (existing.status !== "draft") {
    return errorResponse(c, {
      code: "INVOICE_INVALID_STATE",
      message: "Only draft invoices can be deleted",
      details: [{ field: "status", actual: existing.status, expected: "draft" }],
    });
  }

  await db.run("DELETE FROM invoice_line_items WHERE invoice_id = ?", [invoiceId]);
  await db.run("DELETE FROM invoices WHERE id = ?", [invoiceId]);

  return success(c, { deleted: true, id: invoiceId });
});

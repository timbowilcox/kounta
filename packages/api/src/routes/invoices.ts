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
  generateInvoicePDF,
  getJurisdictionConfig,
  getResendClient,
  sendEmail,
  generateInvoiceEmail,
  emailLayout,
} from "@kounta/core";
import type { CreateInvoiceInput, UpdateInvoiceInput, RecordPaymentInput, InvoicePDFConfig } from "@kounta/core";

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
// GET /:id/pdf — generate and download invoice PDF
// ---------------------------------------------------------------------------

invoiceRoutes.get("/:id/pdf", async (c) => {
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

  const result = await getInvoice(db, invoiceId);
  if (!result.ok) return errorResponse(c, result.error);
  const invoice = result.value;

  // Get ledger + jurisdiction info for PDF config
  const ledger = await db.get<{
    name: string; jurisdiction: string; currency: string;
    business_name: string | null; business_address: string | null;
    business_email: string | null; business_phone: string | null;
    tax_id: string | null;
  }>(
    `SELECT name, jurisdiction, currency,
            business_name, business_address, business_email, business_phone, tax_id
     FROM ledgers WHERE id = ?`,
    [apiKeyInfo.ledgerId],
  );

  const jur = ledger?.jurisdiction ?? "AU";
  const jConfig = getJurisdictionConfig(jur);

  const pdfConfig: InvoicePDFConfig = {
    businessName: ledger?.business_name ?? ledger?.name ?? "Business",
    businessAddress: ledger?.business_address ?? undefined,
    businessEmail: ledger?.business_email ?? undefined,
    businessPhone: ledger?.business_phone ?? undefined,
    taxId: ledger?.tax_id ?? undefined,
    taxIdLabel: jConfig.taxIdLabel,
    jurisdiction: jur,
    currencySymbol: jConfig.currencySymbol,
    currency: invoice.currency,
  };

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateInvoicePDF(invoice, pdfConfig);
  } catch (err) {
    console.error("[pdf] Generation failed:", err);
    return errorResponse(c, { code: "PDF_GENERATION_FAILED", message: "Failed to generate invoice PDF" });
  }

  return new Response(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoiceNumber}.pdf"`,
      "Content-Length": String(pdfBuffer.length),
    },
  });
});

// ---------------------------------------------------------------------------
// POST /:id/email — send invoice email with PDF attachment
// ---------------------------------------------------------------------------

invoiceRoutes.post("/:id/email", async (c) => {
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

  const result = await getInvoice(db, invoiceId);
  if (!result.ok) return errorResponse(c, result.error);
  const invoice = result.value;

  if (!invoice.customerEmail) {
    return errorResponse(c, {
      code: "INVOICE_NO_EMAIL",
      message: "Invoice has no customer email address",
      details: [{ field: "customerEmail", expected: "non-null email address", actual: "null" }],
    });
  }

  // Get ledger + jurisdiction for PDF + email
  const ledger = await db.get<{
    name: string; jurisdiction: string; currency: string;
    business_name: string | null; business_address: string | null;
    business_email: string | null; business_phone: string | null;
    tax_id: string | null;
  }>(
    `SELECT name, jurisdiction, currency,
            business_name, business_address, business_email, business_phone, tax_id
     FROM ledgers WHERE id = ?`,
    [apiKeyInfo.ledgerId],
  );

  const jur = ledger?.jurisdiction ?? "AU";
  const jConfig = getJurisdictionConfig(jur);
  const businessName = ledger?.business_name ?? ledger?.name ?? "Business";

  // Generate PDF
  const pdfConfig: InvoicePDFConfig = {
    businessName,
    businessAddress: ledger?.business_address ?? undefined,
    businessEmail: ledger?.business_email ?? undefined,
    businessPhone: ledger?.business_phone ?? undefined,
    taxId: ledger?.tax_id ?? undefined,
    taxIdLabel: jConfig.taxIdLabel,
    jurisdiction: jur,
    currencySymbol: jConfig.currencySymbol,
    currency: invoice.currency,
  };

  const pdfBuffer = await generateInvoicePDF(invoice, pdfConfig);

  // Send email via Resend
  const resend = getResendClient();
  if (!resend) {
    return errorResponse(c, {
      code: "EMAIL_NOT_CONFIGURED",
      message: "Email sending is not configured. Set RESEND_API_KEY to enable.",
    });
  }

  const emailBody = generateInvoiceEmail({
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.customerName,
    total: invoice.total,
    currency: invoice.currency,
    dueDate: invoice.dueDate,
    businessName,
    notes: invoice.notes ?? undefined,
  });
  const htmlContent = emailLayout(emailBody);

  const emailResult = await resend.emails.send({
    from: `${businessName} <notifications@kounta.ai>`,
    to: [invoice.customerEmail],
    subject: `Invoice ${invoice.invoiceNumber} from ${businessName}`,
    html: htmlContent,
    attachments: [
      {
        filename: `${invoice.invoiceNumber}.pdf`,
        content: pdfBuffer.toString("base64"),
      },
    ],
  });

  // Log the email
  await sendEmail(
    db,
    apiKeyInfo.userId,
    invoice.customerEmail,
    `Invoice ${invoice.invoiceNumber} from ${businessName}`,
    htmlContent,
    "invoice",
    { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, resendId: emailResult.data?.id },
  );

  // Update sent_at on the invoice; also upgrade status from 'approved' to 'sent' if applicable
  const statusUpdate = invoice.status === "approved" ? ", status = 'sent'" : "";
  await db.run(
    `UPDATE invoices SET sent_at = datetime('now'), updated_at = datetime('now')${statusUpdate} WHERE id = ?`,
    [invoiceId],
  );

  return success(c, { sent: true, to: invoice.customerEmail, invoiceNumber: invoice.invoiceNumber });
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

  // Parse body to determine whether to email the invoice
  const body = await c.req.json().catch(() => ({})) as { sendEmail?: boolean; send_email?: boolean };
  const wantsEmail = body.sendEmail ?? body.send_email ?? false;

  // Check if email can actually be sent (customer has email + Resend configured)
  const invoiceRow = await db.get<{ customer_email: string | null }>(
    "SELECT customer_email FROM invoices WHERE id = ?",
    [invoiceId],
  );
  const canEmail = wantsEmail && !!invoiceRow?.customer_email;

  const result = await sendInvoice(db, engine, invoiceId, apiKeyInfo.ledgerId, apiKeyInfo.userId ?? "system", { sendEmail: canEmail });
  if (!result.ok) return errorResponse(c, result.error);

  const invoice = result.value;

  // Actually send the email (best-effort)
  if (canEmail && invoice.customerEmail) {
    try {
      const resend = getResendClient();
      if (resend) {
        const ledger = await db.get<{
          name: string; jurisdiction: string; currency: string;
          business_name: string | null; business_address: string | null;
          business_email: string | null; business_phone: string | null;
          tax_id: string | null;
        }>(
          `SELECT name, jurisdiction, currency,
                  business_name, business_address, business_email, business_phone, tax_id
           FROM ledgers WHERE id = ?`,
          [apiKeyInfo.ledgerId],
        );

        const jur = ledger?.jurisdiction ?? "AU";
        const jConfig = getJurisdictionConfig(jur);
        const businessName = ledger?.business_name ?? ledger?.name ?? "Business";

        const pdfConfig: InvoicePDFConfig = {
          businessName,
          businessAddress: ledger?.business_address ?? undefined,
          businessEmail: ledger?.business_email ?? undefined,
          businessPhone: ledger?.business_phone ?? undefined,
          taxId: ledger?.tax_id ?? undefined,
          taxIdLabel: jConfig.taxIdLabel,
          jurisdiction: jur,
          currencySymbol: jConfig.currencySymbol,
          currency: invoice.currency,
        };

        const pdfBuffer = await generateInvoicePDF(invoice, pdfConfig);
        const emailBody = generateInvoiceEmail({
          invoiceNumber: invoice.invoiceNumber,
          customerName: invoice.customerName,
          total: invoice.total,
          currency: invoice.currency,
          dueDate: invoice.dueDate,
          businessName,
          notes: invoice.notes ?? undefined,
        });

        await resend.emails.send({
          from: `${businessName} <notifications@kounta.ai>`,
          to: [invoice.customerEmail],
          subject: `Invoice ${invoice.invoiceNumber} from ${businessName}`,
          html: emailLayout(emailBody),
          attachments: [{ filename: `${invoice.invoiceNumber}.pdf`, content: pdfBuffer.toString("base64") }],
        });

        await db.run(
          "UPDATE invoices SET sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
          [invoiceId],
        );
      }
    } catch {
      // Best-effort — email failure should not block the send operation
    }
  }

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

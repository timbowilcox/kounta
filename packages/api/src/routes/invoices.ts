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
  generateInvoicePDF,
  getJurisdictionConfig,
  getResendClient,
  generateInvoiceEmail,
  emailLayout,
} from "@kounta/core";
import type { CreateInvoiceInput, UpdateInvoiceInput, RecordPaymentInput, InvoicePDFConfig } from "@kounta/core";
import { tierLimitCheck, tierUsageIncrement, tierFeatureGate } from "../middleware/tier-enforcement.js";

export const invoiceRoutes = new Hono<Env>();

invoiceRoutes.use("/*", apiKeyAuth);

// Helper: build PDF config from ledger business info
const buildPdfConfig = (ledger: { name: string; jurisdiction: string; businessName: string | null; businessAddress: string | null; businessEmail: string | null; businessPhone: string | null; taxId: string | null }, currency: string): InvoicePDFConfig => {
  const jConfig = getJurisdictionConfig(ledger.jurisdiction);
  return {
    businessName: ledger.businessName ?? ledger.name ?? "Business",
    businessAddress: ledger.businessAddress ?? undefined,
    businessEmail: ledger.businessEmail ?? undefined,
    businessPhone: ledger.businessPhone ?? undefined,
    taxId: ledger.taxId ?? undefined,
    taxIdLabel: jConfig.taxIdLabel,
    jurisdiction: ledger.jurisdiction,
    currencySymbol: jConfig.currencySymbol,
    currency,
  };
};

// ---------------------------------------------------------------------------
// GET / — list invoices
// ---------------------------------------------------------------------------

invoiceRoutes.get("/", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const status = c.req.query("status");
  const customer = c.req.query("customer");
  const fromDate = c.req.query("from_date");
  const toDate = c.req.query("to_date");
  const cursor = c.req.query("cursor");
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;

  const result = await engine.listInvoices(apiKeyInfo.ledgerId, {
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
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const summary = await engine.getInvoiceSummary(apiKeyInfo.ledgerId);
  return success(c, summary);
});

// ---------------------------------------------------------------------------
// GET /aging — AR aging report
// ---------------------------------------------------------------------------

invoiceRoutes.get("/aging", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const buckets = await engine.getARAging(apiKeyInfo.ledgerId);
  return success(c, buckets);
});

// ---------------------------------------------------------------------------
// POST / — create invoice
// ---------------------------------------------------------------------------

invoiceRoutes.post("/", tierLimitCheck("invoices"), tierUsageIncrement("invoices"), async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const body = await c.req.json() as Omit<CreateInvoiceInput, "ledgerId">;

  const result = await engine.createInvoice(apiKeyInfo.ledgerId, apiKeyInfo.userId ?? "system", body);
  if (!result.ok) return errorResponse(c, result.error);
  return created(c, result.value);
});

// ---------------------------------------------------------------------------
// GET /:id — get invoice with line items and payments
// ---------------------------------------------------------------------------

invoiceRoutes.get("/:id", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const invoiceId = c.req.param("id");

  if (!(await engine.verifyInvoiceBelongsToLedger(invoiceId, apiKeyInfo.ledgerId))) {
    return errorResponse(c, { code: "INVOICE_NOT_FOUND", message: `Invoice not found: ${invoiceId}` });
  }

  const result = await engine.getInvoice(invoiceId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// GET /:id/pdf — generate and download invoice PDF
// ---------------------------------------------------------------------------

invoiceRoutes.get("/:id/pdf", tierFeatureGate("pdfExport"), async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const invoiceId = c.req.param("id");

  if (!(await engine.verifyInvoiceBelongsToLedger(invoiceId, apiKeyInfo.ledgerId))) {
    return errorResponse(c, { code: "INVOICE_NOT_FOUND", message: `Invoice not found: ${invoiceId}` });
  }

  const result = await engine.getInvoice(invoiceId);
  if (!result.ok) return errorResponse(c, result.error);
  const invoice = result.value;

  const ledgerResult = await engine.getLedgerBusinessInfo(apiKeyInfo.ledgerId);
  if (!ledgerResult.ok) return errorResponse(c, ledgerResult.error);
  const ledger = ledgerResult.value;

  const pdfConfig = buildPdfConfig(ledger, invoice.currency);

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
      "Content-Disposition": `attachment; filename="${invoice.invoiceNumber.replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf"`,
      "Content-Length": String(pdfBuffer.length),
    },
  });
});

// ---------------------------------------------------------------------------
// POST /:id/email — send invoice email with PDF attachment
// ---------------------------------------------------------------------------

invoiceRoutes.post("/:id/email", tierFeatureGate("invoiceEmail"), async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const invoiceId = c.req.param("id");

  if (!(await engine.verifyInvoiceBelongsToLedger(invoiceId, apiKeyInfo.ledgerId))) {
    return errorResponse(c, { code: "INVOICE_NOT_FOUND", message: `Invoice not found: ${invoiceId}` });
  }

  const result = await engine.getInvoice(invoiceId);
  if (!result.ok) return errorResponse(c, result.error);
  const invoice = result.value;

  if (!invoice.customerEmail) {
    return errorResponse(c, {
      code: "INVOICE_NO_EMAIL",
      message: "Invoice has no customer email address",
      details: [{ field: "customerEmail", expected: "non-null email address", actual: "null" }],
    });
  }

  const ledgerResult = await engine.getLedgerBusinessInfo(apiKeyInfo.ledgerId);
  if (!ledgerResult.ok) return errorResponse(c, ledgerResult.error);
  const ledger = ledgerResult.value;
  const businessName = ledger.businessName ?? ledger.name ?? "Business";

  const pdfConfig = buildPdfConfig(ledger, invoice.currency);
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
  await engine.sendEmailLog(
    apiKeyInfo.userId,
    invoice.customerEmail,
    `Invoice ${invoice.invoiceNumber} from ${businessName}`,
    htmlContent,
    "invoice",
    { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, resendId: emailResult.data?.id },
  );

  // Update sent_at on the invoice; also upgrade status from 'approved' to 'sent' if applicable
  await engine.markInvoiceSent(invoiceId, invoice.status === "approved");

  return success(c, { sent: true, to: invoice.customerEmail, invoiceNumber: invoice.invoiceNumber });
});

// ---------------------------------------------------------------------------
// PATCH /:id — update draft invoice
// ---------------------------------------------------------------------------

invoiceRoutes.patch("/:id", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const invoiceId = c.req.param("id");

  if (!(await engine.verifyInvoiceBelongsToLedger(invoiceId, apiKeyInfo.ledgerId))) {
    return errorResponse(c, { code: "INVOICE_NOT_FOUND", message: `Invoice not found: ${invoiceId}` });
  }

  const body = await c.req.json() as UpdateInvoiceInput;
  const result = await engine.updateInvoice(invoiceId, body);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /:id/send — approve and post AR journal entry
// ---------------------------------------------------------------------------

invoiceRoutes.post("/:id/send", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const invoiceId = c.req.param("id");

  if (!(await engine.verifyInvoiceBelongsToLedger(invoiceId, apiKeyInfo.ledgerId))) {
    return errorResponse(c, { code: "INVOICE_NOT_FOUND", message: `Invoice not found: ${invoiceId}` });
  }

  // Parse body to determine whether to email the invoice
  const body = await c.req.json().catch(() => ({})) as { sendEmail?: boolean; send_email?: boolean };
  const wantsEmail = body.sendEmail ?? body.send_email ?? false;

  // Check if email can actually be sent (customer has email + Resend configured)
  const invoiceResult = await engine.getInvoice(invoiceId);
  const canEmail = wantsEmail && invoiceResult.ok && !!invoiceResult.value.customerEmail;

  const result = await engine.sendInvoice(invoiceId, apiKeyInfo.ledgerId, apiKeyInfo.userId ?? "system", { sendEmail: canEmail });
  if (!result.ok) return errorResponse(c, result.error);

  const invoice = result.value;

  // Actually send the email (best-effort)
  if (canEmail && invoice.customerEmail) {
    try {
      const resend = getResendClient();
      if (resend) {
        const ledgerResult = await engine.getLedgerBusinessInfo(apiKeyInfo.ledgerId);
        if (ledgerResult.ok) {
          const ledger = ledgerResult.value;
          const businessName = ledger.businessName ?? ledger.name ?? "Business";
          const pdfConfig = buildPdfConfig(ledger, invoice.currency);

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

          await engine.markInvoiceSent(invoiceId, false);
        }
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
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const invoiceId = c.req.param("id");

  if (!(await engine.verifyInvoiceBelongsToLedger(invoiceId, apiKeyInfo.ledgerId))) {
    return errorResponse(c, { code: "INVOICE_NOT_FOUND", message: `Invoice not found: ${invoiceId}` });
  }

  const body = await c.req.json() as RecordPaymentInput;
  const result = await engine.recordInvoicePayment(invoiceId, apiKeyInfo.ledgerId, apiKeyInfo.userId ?? "system", body);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /:id/void — void invoice and reverse AR entry
// ---------------------------------------------------------------------------

invoiceRoutes.post("/:id/void", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const invoiceId = c.req.param("id");

  if (!(await engine.verifyInvoiceBelongsToLedger(invoiceId, apiKeyInfo.ledgerId))) {
    return errorResponse(c, { code: "INVOICE_NOT_FOUND", message: `Invoice not found: ${invoiceId}` });
  }

  const result = await engine.voidInvoice(invoiceId, apiKeyInfo.ledgerId, apiKeyInfo.userId ?? "system");
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// DELETE /:id — delete draft invoice (no accounting impact)
// ---------------------------------------------------------------------------

invoiceRoutes.delete("/:id", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const invoiceId = c.req.param("id");

  const result = await engine.deleteInvoiceDraft(invoiceId, apiKeyInfo.ledgerId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

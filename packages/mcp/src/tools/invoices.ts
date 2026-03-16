// ---------------------------------------------------------------------------
// Invoice MCP tools — create, send, record payment, void, summary, aging
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerEngine, Database } from "@kounta/core";
import {
  createInvoice,
  sendInvoice,
  recordPayment,
  voidInvoice,
  getInvoice,
  listInvoices,
  getInvoiceSummary,
  getARAging,
} from "@kounta/core";
import { toolOk, toolErr } from "../lib/helpers.js";

export function registerInvoiceTools(
  server: McpServer,
  engine: LedgerEngine,
  db: Database,
): void {
  // -----------------------------------------------------------------------
  // create_invoice
  // -----------------------------------------------------------------------
  server.tool(
    "create_invoice",
    "Create a new invoice for a customer. Provide the customer name, line items with descriptions and prices, and optionally a due date. Tax is automatically calculated based on the ledger's jurisdiction (e.g. 10% GST for Australian ledgers). The invoice starts in 'draft' status — use send_invoice to approve it and post the accounting entry.\n\nExample: 'Create an invoice for Acme Corp for 10 hours of consulting at $150/hour, due in 30 days'",
    {
      ledgerId: z.string().describe("Ledger ID"),
      customerName: z.string().describe("Customer name"),
      customerEmail: z.string().optional().describe("Customer email address"),
      lineItems: z.array(z.object({
        description: z.string().describe("Line item description"),
        quantity: z.number().describe("Quantity"),
        unitPriceCents: z.number().int().describe("Unit price in cents"),
        taxRate: z.number().optional().describe("Per-line tax rate override (e.g. 0.10 for 10%)"),
      })).describe("Invoice line items"),
      dueDate: z.string().optional().describe("Due date (ISO YYYY-MM-DD). Defaults to 30 days from today"),
      issueDate: z.string().optional().describe("Issue date (ISO YYYY-MM-DD). Defaults to today"),
      notes: z.string().optional().describe("Notes to appear on the invoice"),
      taxInclusive: z.boolean().optional().describe("Whether prices include tax (default: false)"),
      invoiceNumber: z.string().optional().describe("Custom invoice number (auto-generated if omitted)"),
    },
    async (params) => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const dueDate = params.dueDate ?? (() => {
          const d = new Date();
          d.setDate(d.getDate() + 30);
          return d.toISOString().slice(0, 10);
        })();

        const result = await createInvoice(db, params.ledgerId, "mcp-agent", {
          customerName: params.customerName,
          customerEmail: params.customerEmail,
          issueDate: params.issueDate ?? today,
          dueDate,
          lineItems: params.lineItems.map((li) => ({
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPriceCents,
            taxRate: li.taxRate,
          })),
          notes: params.notes,
          taxInclusive: params.taxInclusive,
          invoiceNumber: params.invoiceNumber,
        });

        if (!result.ok) return toolErr(result.error);
        return toolOk(result.value);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // list_invoices
  // -----------------------------------------------------------------------
  server.tool(
    "list_invoices",
    "List invoices with optional filters. Shows customer name, amount, status, and days outstanding. Use to check who owes money, find overdue invoices, or review recent billing.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      status: z.enum(["draft", "sent", "paid", "partially_paid", "overdue", "void"]).optional().describe("Filter by status"),
      customer: z.string().optional().describe("Filter by customer name (partial match)"),
    },
    async (params) => {
      try {
        const result = await listInvoices(db, params.ledgerId, {
          status: params.status,
          customerName: params.customer,
        });
        return toolOk({
          invoices: result.data.map((inv) => ({
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            customerName: inv.customerName,
            total: inv.total,
            amountDue: inv.amountDue,
            status: inv.status,
            issueDate: inv.issueDate,
            dueDate: inv.dueDate,
            currency: inv.currency,
            lineItemCount: inv.lineItems.length,
          })),
          count: result.data.length,
        });
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // get_invoice
  // -----------------------------------------------------------------------
  server.tool(
    "get_invoice",
    "Get full details of a specific invoice including all line items, payment history, and the linked journal entries.",
    {
      invoiceId: z.string().describe("Invoice ID"),
    },
    async ({ invoiceId }) => {
      try {
        const result = await getInvoice(db, invoiceId);
        if (!result.ok) return toolErr(result.error);
        return toolOk(result.value);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // send_invoice
  // -----------------------------------------------------------------------
  server.tool(
    "send_invoice",
    "Approve and send an invoice. This changes the status from 'draft' to 'sent' and posts the Accounts Receivable journal entry (debit AR, credit Revenue, credit GST/VAT if applicable). Once sent, the invoice cannot be edited — only voided.\n\nThe accounting entry makes this invoice appear on the Balance Sheet (AR) and Income Statement (Revenue).",
    {
      ledgerId: z.string().describe("Ledger ID"),
      invoiceId: z.string().describe("Invoice ID"),
    },
    async ({ ledgerId, invoiceId }) => {
      try {
        const result = await sendInvoice(db, engine, invoiceId, ledgerId, "mcp-agent");
        if (!result.ok) return toolErr(result.error);
        return toolOk(result.value);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // record_invoice_payment
  // -----------------------------------------------------------------------
  server.tool(
    "record_invoice_payment",
    "Record a payment received against an invoice. Posts a journal entry (debit Cash/Bank, credit Accounts Receivable). Automatically updates the invoice status to 'paid' if the full amount is received, or 'partially_paid' if less than the total.\n\nUse when a bank feed transaction matches an outstanding invoice, or when recording a manual payment.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      invoiceId: z.string().describe("Invoice ID"),
      amountCents: z.number().int().positive().describe("Payment amount in cents"),
      paymentDate: z.string().describe("Payment date (ISO YYYY-MM-DD)"),
      paymentMethod: z.string().optional().describe("Payment method (bank_transfer, stripe, cash, other)"),
      reference: z.string().optional().describe("Bank reference or Stripe charge ID"),
      bankAccountId: z.string().optional().describe("ID of the bank/cash account receiving the payment"),
    },
    async (params) => {
      try {
        const result = await recordPayment(db, engine, params.invoiceId, params.ledgerId, "mcp-agent", {
          amount: params.amountCents,
          paymentDate: params.paymentDate,
          paymentMethod: params.paymentMethod,
          reference: params.reference,
          bankAccountId: params.bankAccountId,
        });
        if (!result.ok) return toolErr(result.error);
        return toolOk(result.value);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // void_invoice
  // -----------------------------------------------------------------------
  server.tool(
    "void_invoice",
    "Void an invoice. Reverses the AR journal entry if one was posted. Cannot void an invoice that has payments recorded — record a credit note instead. Use for invoices sent in error.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      invoiceId: z.string().describe("Invoice ID"),
    },
    async ({ ledgerId, invoiceId }) => {
      try {
        const result = await voidInvoice(db, engine, invoiceId, ledgerId, "mcp-agent");
        if (!result.ok) return toolErr(result.error);
        return toolOk(result.value);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // get_invoice_summary
  // -----------------------------------------------------------------------
  server.tool(
    "get_invoice_summary",
    "Get a summary of accounts receivable: total outstanding, total overdue, number of open invoices, and average days to payment. Use for a quick financial health check or morning brief.",
    {
      ledgerId: z.string().describe("Ledger ID"),
    },
    async ({ ledgerId }) => {
      try {
        const summary = await getInvoiceSummary(db, ledgerId);
        return toolOk(summary);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // get_ar_aging
  // -----------------------------------------------------------------------
  server.tool(
    "get_ar_aging",
    "Get an accounts receivable aging report showing outstanding invoices grouped by how overdue they are: Current, 1-30 days, 31-60 days, 61-90 days, and 90+ days. Use for cash flow planning and identifying collection issues.",
    {
      ledgerId: z.string().describe("Ledger ID"),
    },
    async ({ ledgerId }) => {
      try {
        const buckets = await getARAging(db, ledgerId);
        return toolOk({ buckets });
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );
}

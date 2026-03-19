// ---------------------------------------------------------------------------
// Bill MCP tools — create, approve, record payment, void, summary, aging
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerEngine, Database } from "@kounta/core";
import {
  createBill,
  approveBill,
  recordBillPayment,
  voidBill,
  getBill,
  listBills,
  getBillSummary,
  getAPAging,
} from "@kounta/core";
import { incrementUsage } from "@kounta/core";
import { toolOk, toolErr } from "../lib/helpers.js";
import { mcpCheckLimit, getLedgerOwner } from "../lib/tier-check.js";

export function registerBillTools(
  server: McpServer,
  engine: LedgerEngine,
  db: Database,
): void {
  // -----------------------------------------------------------------------
  // create_bill
  // -----------------------------------------------------------------------
  server.tool(
    "create_bill",
    "Create a new bill (accounts payable) from a vendor. Provide the vendor name, line items with descriptions and prices, and optionally a due date. Tax is automatically calculated based on the ledger's jurisdiction. The bill starts in 'draft' status — use approve_bill to post the AP journal entry.\n\nExample: 'Create a bill from Office Supplies Co for 5 boxes of paper at $45 each, due in 30 days'",
    {
      ledgerId: z.string().describe("Ledger ID"),
      vendorId: z.string().optional().describe("Vendor ID — auto-fills name, email, and payment terms from the vendor record"),
      vendorName: z.string().describe("Vendor/supplier name"),
      vendorEmail: z.string().optional().describe("Vendor email address"),
      paymentTerms: z.enum(["due_on_receipt", "net_7", "net_14", "net_15", "net_30", "net_45", "net_60", "net_90"]).optional().describe("Payment terms (defaults to vendor's terms or net_30)"),
      lineItems: z.array(z.object({
        description: z.string().describe("Line item description"),
        quantity: z.number().describe("Quantity"),
        unitPriceCents: z.number().int().describe("Unit price in cents"),
        taxRate: z.number().optional().describe("Per-line tax rate override (e.g. 0.10 for 10%)"),
        accountId: z.string().optional().describe("Expense account ID for this line"),
      })).describe("Bill line items"),
      dueDate: z.string().optional().describe("Due date (ISO YYYY-MM-DD). Defaults to 30 days from today"),
      billDate: z.string().optional().describe("Bill date (ISO YYYY-MM-DD). Defaults to today"),
      reference: z.string().optional().describe("Vendor's invoice/reference number"),
      notes: z.string().optional().describe("Notes about this bill"),
      taxInclusive: z.boolean().optional().describe("Whether prices include tax (default: false)"),
      billNumber: z.string().optional().describe("Custom bill number (auto-generated if omitted)"),
    },
    async (params) => {
      try {
        const ownerId = await getLedgerOwner(db, params.ledgerId);
        if (ownerId) {
          const limitErr = await mcpCheckLimit(db, ownerId, params.ledgerId, "bills");
          if (limitErr) return limitErr;
        }

        const today = new Date().toISOString().slice(0, 10);

        const result = await createBill(db, params.ledgerId, "mcp-agent", {
          vendorId: params.vendorId,
          vendorName: params.vendorName,
          vendorEmail: params.vendorEmail,
          paymentTerms: params.paymentTerms,
          billDate: params.billDate ?? today,
          dueDate: params.dueDate,
          lineItems: params.lineItems.map((li) => ({
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPriceCents,
            taxRate: li.taxRate,
            accountId: li.accountId,
          })),
          reference: params.reference,
          notes: params.notes,
          taxInclusive: params.taxInclusive,
          billNumber: params.billNumber,
        });

        if (!result.ok) return toolErr(result.error);

        if (ownerId) {
          try { await incrementUsage(db, ownerId, params.ledgerId, "bills_count"); } catch { /* best-effort */ }
        }

        return toolOk(result.value);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // list_bills
  // -----------------------------------------------------------------------
  server.tool(
    "list_bills",
    "List bills with optional filters. Shows vendor name, amount, status, and due date. Use to check outstanding payables, find overdue bills, or review recent purchases.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      status: z.enum(["draft", "approved", "paid", "partially_paid", "overdue", "void"]).optional().describe("Filter by status"),
      vendor: z.string().optional().describe("Filter by vendor name (partial match)"),
    },
    async (params) => {
      try {
        const result = await listBills(db, params.ledgerId, {
          status: params.status,
          vendorName: params.vendor,
        });
        return toolOk({
          bills: result.data.map((bill) => ({
            id: bill.id,
            billNumber: bill.billNumber,
            vendorName: bill.vendorName,
            total: bill.total,
            amountDue: bill.amountDue,
            status: bill.status,
            billDate: bill.billDate,
            dueDate: bill.dueDate,
            currency: bill.currency,
            reference: bill.reference,
            lineItemCount: bill.lineItems.length,
          })),
          count: result.data.length,
        });
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // get_bill
  // -----------------------------------------------------------------------
  server.tool(
    "get_bill",
    "Get full details of a specific bill including all line items, payment history, and the linked journal entries.",
    {
      billId: z.string().describe("Bill ID"),
    },
    async ({ billId }) => {
      try {
        const result = await getBill(db, billId);
        if (!result.ok) return toolErr(result.error);
        return toolOk(result.value);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // approve_bill
  // -----------------------------------------------------------------------
  server.tool(
    "approve_bill",
    "Approve a bill and post the Accounts Payable journal entry (debit Expense, credit AP; debit Input Tax Credit if applicable). Once approved, the bill cannot be edited — only voided.\n\nThe accounting entry makes this bill appear on the Balance Sheet (AP liability) and as an expense on the Income Statement.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      billId: z.string().describe("Bill ID"),
    },
    async ({ ledgerId, billId }) => {
      try {
        const result = await approveBill(db, engine, billId, ledgerId, "mcp-agent");
        if (!result.ok) return toolErr(result.error);
        return toolOk(result.value);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // record_bill_payment
  // -----------------------------------------------------------------------
  server.tool(
    "record_bill_payment",
    "Record a payment made against a bill. Posts a journal entry (debit AP, credit Cash/Bank). Automatically updates the bill status to 'paid' if the full amount is paid, or 'partially_paid' if less.\n\nUse when a bank feed transaction matches an outstanding bill, or when recording a manual payment.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      billId: z.string().describe("Bill ID"),
      amountCents: z.number().int().positive().describe("Payment amount in cents"),
      paymentDate: z.string().describe("Payment date (ISO YYYY-MM-DD)"),
      paymentMethod: z.string().optional().describe("Payment method (bank_transfer, check, cash, other)"),
      reference: z.string().optional().describe("Bank reference or payment confirmation number"),
      bankAccountId: z.string().optional().describe("ID of the bank/cash account the payment was made from"),
    },
    async (params) => {
      try {
        const result = await recordBillPayment(db, engine, params.billId, params.ledgerId, "mcp-agent", {
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
  // void_bill
  // -----------------------------------------------------------------------
  server.tool(
    "void_bill",
    "Void a bill. Reverses the AP journal entry if one was posted. Cannot void a bill that has payments recorded. Use for bills entered in error.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      billId: z.string().describe("Bill ID"),
    },
    async ({ ledgerId, billId }) => {
      try {
        const result = await voidBill(db, engine, billId, ledgerId, "mcp-agent");
        if (!result.ok) return toolErr(result.error);
        return toolOk(result.value);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // get_bill_summary
  // -----------------------------------------------------------------------
  server.tool(
    "get_bill_summary",
    "Get a summary of accounts payable: total outstanding, total overdue, number of open bills, and average days to payment. Use for a quick financial health check.",
    {
      ledgerId: z.string().describe("Ledger ID"),
    },
    async ({ ledgerId }) => {
      try {
        const summary = await getBillSummary(db, ledgerId);
        return toolOk(summary);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // get_ap_aging
  // -----------------------------------------------------------------------
  server.tool(
    "get_ap_aging",
    "Get an accounts payable aging report showing outstanding bills grouped by how overdue they are: Current, 1-30 days, 31-60 days, 61-90 days, and 90+ days. Use for cash flow planning and identifying payment priorities.",
    {
      ledgerId: z.string().describe("Ledger ID"),
    },
    async ({ ledgerId }) => {
      try {
        const buckets = await getAPAging(db, ledgerId);
        return toolOk({ buckets });
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );
}

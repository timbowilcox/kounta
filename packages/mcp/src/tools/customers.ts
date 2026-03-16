// ---------------------------------------------------------------------------
// Customer MCP tools — CRUD operations on customer contact records
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "@kounta/core";
import type { LedgerEngine } from "@kounta/core";
import {
  createCustomer,
  updateCustomer,
  getCustomer,
  listCustomers,
} from "@kounta/core";
import { toolOk, toolErr } from "../lib/helpers.js";

export function registerCustomerTools(
  server: McpServer,
  _engine: LedgerEngine,
  db: Database,
): void {
  // -----------------------------------------------------------------------
  // list_customers
  // -----------------------------------------------------------------------
  server.tool(
    "list_customers",
    "List customers for a ledger. Use to find a customer before creating an invoice, or to review your customer base. Supports search by name or email.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      search: z.string().optional().describe("Search by name or email (partial match)"),
      active: z.boolean().optional().describe("Filter by active status (default: all)"),
    },
    async (params) => {
      try {
        const result = await listCustomers(db, params.ledgerId, {
          search: params.search,
          isActive: params.active,
        });
        return toolOk({
          customers: result.data.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            phone: c.phone,
            paymentTerms: c.paymentTerms,
            isActive: c.isActive,
          })),
          count: result.data.length,
        });
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // create_customer
  // -----------------------------------------------------------------------
  server.tool(
    "create_customer",
    "Create a new customer record. Stores contact details and default payment terms so future invoices can auto-fill. Payment terms options: due_on_receipt, net_7, net_14, net_15, net_30, net_45, net_60, net_90.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      name: z.string().describe("Customer name"),
      email: z.string().optional().describe("Customer email address"),
      phone: z.string().optional().describe("Customer phone number"),
      address: z.string().optional().describe("Customer address"),
      taxId: z.string().optional().describe("Customer tax ID (ABN, VAT number, etc.)"),
      paymentTerms: z.enum([
        "due_on_receipt", "net_7", "net_14", "net_15",
        "net_30", "net_45", "net_60", "net_90",
      ]).optional().describe("Default payment terms (default: net_30)"),
      notes: z.string().optional().describe("Internal notes about this customer"),
    },
    async (params) => {
      try {
        const result = await createCustomer(db, params.ledgerId, {
          name: params.name,
          email: params.email,
          phone: params.phone,
          address: params.address,
          taxId: params.taxId,
          paymentTerms: params.paymentTerms,
          notes: params.notes,
        });
        if (!result.ok) return toolErr(result.error);
        return toolOk(result.value);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // get_customer
  // -----------------------------------------------------------------------
  server.tool(
    "get_customer",
    "Get full details of a customer including contact info, payment terms, and notes.",
    {
      customerId: z.string().describe("Customer ID"),
    },
    async ({ customerId }) => {
      try {
        const result = await getCustomer(db, customerId);
        if (!result.ok) return toolErr(result.error);
        return toolOk(result.value);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // update_customer
  // -----------------------------------------------------------------------
  server.tool(
    "update_customer",
    "Update a customer's contact details or payment terms. Only provide the fields you want to change.",
    {
      customerId: z.string().describe("Customer ID"),
      name: z.string().optional().describe("Customer name"),
      email: z.string().optional().describe("Customer email"),
      phone: z.string().optional().describe("Customer phone"),
      address: z.string().optional().describe("Customer address"),
      taxId: z.string().optional().describe("Customer tax ID"),
      paymentTerms: z.enum([
        "due_on_receipt", "net_7", "net_14", "net_15",
        "net_30", "net_45", "net_60", "net_90",
      ]).optional().describe("Default payment terms"),
      notes: z.string().optional().describe("Internal notes"),
      isActive: z.boolean().optional().describe("Active status"),
    },
    async (params) => {
      try {
        const result = await updateCustomer(db, params.customerId, {
          name: params.name,
          email: params.email,
          phone: params.phone,
          address: params.address,
          taxId: params.taxId,
          paymentTerms: params.paymentTerms,
          notes: params.notes,
          isActive: params.isActive,
        });
        if (!result.ok) return toolErr(result.error);
        return toolOk(result.value);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Vendor MCP tools — CRUD operations on vendor contact records
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "@kounta/core";
import type { LedgerEngine } from "@kounta/core";
import {
  createVendor,
  updateVendor,
  getVendor,
  listVendors,
} from "@kounta/core";
import { incrementUsage } from "@kounta/core";
import { toolOk, toolErr } from "../lib/helpers.js";
import { mcpCheckLimit, getLedgerOwner } from "../lib/tier-check.js";

export function registerVendorTools(
  server: McpServer,
  _engine: LedgerEngine,
  db: Database,
): void {
  // -----------------------------------------------------------------------
  // list_vendors
  // -----------------------------------------------------------------------
  server.tool(
    "list_vendors",
    "List vendors for a ledger. Use to find a vendor before creating a bill, or to review your vendor/supplier base. Supports search by name or email.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      search: z.string().optional().describe("Search by name or email (partial match)"),
      active: z.boolean().optional().describe("Filter by active status (default: all)"),
    },
    async (params) => {
      try {
        const result = await listVendors(db, params.ledgerId, {
          search: params.search,
          isActive: params.active,
        });
        return toolOk({
          vendors: result.data.map((v) => ({
            id: v.id,
            name: v.name,
            email: v.email,
            phone: v.phone,
            paymentTerms: v.paymentTerms,
            defaultExpenseAccountId: v.defaultExpenseAccountId,
            isActive: v.isActive,
          })),
          count: result.data.length,
        });
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // create_vendor
  // -----------------------------------------------------------------------
  server.tool(
    "create_vendor",
    "Create a new vendor/supplier record. Stores contact details, default expense account, and payment terms so future bills can auto-fill. Payment terms options: due_on_receipt, net_7, net_14, net_15, net_30, net_45, net_60, net_90.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      name: z.string().describe("Vendor/supplier name"),
      email: z.string().optional().describe("Vendor email address"),
      phone: z.string().optional().describe("Vendor phone number"),
      address: z.string().optional().describe("Vendor address"),
      taxId: z.string().optional().describe("Vendor tax ID (ABN, VAT number, etc.)"),
      paymentTerms: z.enum([
        "due_on_receipt", "net_7", "net_14", "net_15",
        "net_30", "net_45", "net_60", "net_90",
      ]).optional().describe("Default payment terms (default: net_30)"),
      defaultExpenseAccountId: z.string().optional().describe("Default expense account for bills from this vendor"),
      notes: z.string().optional().describe("Internal notes about this vendor"),
    },
    async (params) => {
      try {
        const ownerId = await getLedgerOwner(db, params.ledgerId);
        if (ownerId) {
          const limitErr = await mcpCheckLimit(db, ownerId, params.ledgerId, "vendors");
          if (limitErr) return limitErr;
        }

        const result = await createVendor(db, params.ledgerId, {
          name: params.name,
          email: params.email,
          phone: params.phone,
          address: params.address,
          taxId: params.taxId,
          paymentTerms: params.paymentTerms,
          defaultExpenseAccountId: params.defaultExpenseAccountId,
          notes: params.notes,
        });
        if (!result.ok) return toolErr(result.error);

        if (ownerId) {
          try { await incrementUsage(db, ownerId, params.ledgerId, "vendors_count"); } catch { /* best-effort */ }
        }

        return toolOk(result.value);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // get_vendor
  // -----------------------------------------------------------------------
  server.tool(
    "get_vendor",
    "Get full details of a vendor including contact info, default expense account, payment terms, and notes.",
    {
      vendorId: z.string().describe("Vendor ID"),
    },
    async ({ vendorId }) => {
      try {
        const result = await getVendor(db, vendorId);
        if (!result.ok) return toolErr(result.error);
        return toolOk(result.value);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // update_vendor
  // -----------------------------------------------------------------------
  server.tool(
    "update_vendor",
    "Update a vendor's contact details, expense account, or payment terms. Only provide the fields you want to change.",
    {
      vendorId: z.string().describe("Vendor ID"),
      name: z.string().optional().describe("Vendor name"),
      email: z.string().optional().describe("Vendor email"),
      phone: z.string().optional().describe("Vendor phone"),
      address: z.string().optional().describe("Vendor address"),
      taxId: z.string().optional().describe("Vendor tax ID"),
      paymentTerms: z.enum([
        "due_on_receipt", "net_7", "net_14", "net_15",
        "net_30", "net_45", "net_60", "net_90",
      ]).optional().describe("Default payment terms"),
      defaultExpenseAccountId: z.string().optional().describe("Default expense account ID"),
      notes: z.string().optional().describe("Internal notes"),
      isActive: z.boolean().optional().describe("Active status"),
    },
    async (params) => {
      try {
        const result = await updateVendor(db, params.vendorId, {
          name: params.name,
          email: params.email,
          phone: params.phone,
          address: params.address,
          taxId: params.taxId,
          paymentTerms: params.paymentTerms,
          defaultExpenseAccountId: params.defaultExpenseAccountId,
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

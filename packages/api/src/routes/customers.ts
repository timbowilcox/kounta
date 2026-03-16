// ---------------------------------------------------------------------------
// Customer routes — /v1/customers
//
// CRUD operations for customer contact records. All routes require API key auth.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { success, created, errorResponse, paginated } from "../lib/responses.js";
import {
  createCustomer,
  updateCustomer,
  getCustomer,
  listCustomers,
  deleteCustomer,
  listInvoices,
} from "@kounta/core";
import type { CreateCustomerInput, UpdateCustomerInput } from "@kounta/core";
import { tierLimitCheck, tierUsageIncrement } from "../middleware/tier-enforcement.js";

export const customerRoutes = new Hono<Env>();

customerRoutes.use("/*", apiKeyAuth);

// ---------------------------------------------------------------------------
// GET / — list customers
// ---------------------------------------------------------------------------

customerRoutes.get("/", async (c) => {
  const db = c.get("engine").getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const search = c.req.query("search");
  const active = c.req.query("active");
  const cursor = c.req.query("cursor");
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;

  const result = await listCustomers(db, apiKeyInfo.ledgerId, {
    search: search ?? undefined,
    isActive: active !== undefined ? active !== "false" : undefined,
    cursor: cursor ?? undefined,
    limit,
  });

  return paginated(c, result.data, result.cursor);
});

// ---------------------------------------------------------------------------
// POST / — create customer
// ---------------------------------------------------------------------------

customerRoutes.post("/", tierLimitCheck("customers"), tierUsageIncrement("customers"), async (c) => {
  const db = c.get("engine").getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const body = await c.req.json() as CreateCustomerInput;

  const result = await createCustomer(db, apiKeyInfo.ledgerId, body);
  if (!result.ok) return errorResponse(c, result.error);
  return created(c, result.value);
});

// ---------------------------------------------------------------------------
// GET /:id — get customer
// ---------------------------------------------------------------------------

customerRoutes.get("/:id", async (c) => {
  const db = c.get("engine").getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const customerId = c.req.param("id");

  const result = await getCustomer(db, customerId);
  if (!result.ok) return errorResponse(c, result.error);

  // Verify customer belongs to this ledger
  if (result.value.ledgerId !== apiKeyInfo.ledgerId) {
    return errorResponse(c, { code: "CUSTOMER_NOT_FOUND", message: `Customer not found: ${customerId}` });
  }

  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// PATCH /:id — update customer
// ---------------------------------------------------------------------------

customerRoutes.patch("/:id", async (c) => {
  const db = c.get("engine").getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const customerId = c.req.param("id");

  // Verify customer belongs to this ledger
  const existing = await getCustomer(db, customerId);
  if (!existing.ok || existing.value.ledgerId !== apiKeyInfo.ledgerId) {
    return errorResponse(c, { code: "CUSTOMER_NOT_FOUND", message: `Customer not found: ${customerId}` });
  }

  const body = await c.req.json() as UpdateCustomerInput;
  const result = await updateCustomer(db, customerId, body);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// DELETE /:id — delete or deactivate customer
// ---------------------------------------------------------------------------

customerRoutes.delete("/:id", async (c) => {
  const db = c.get("engine").getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const customerId = c.req.param("id");

  // Verify customer belongs to this ledger
  const existing = await getCustomer(db, customerId);
  if (!existing.ok || existing.value.ledgerId !== apiKeyInfo.ledgerId) {
    return errorResponse(c, { code: "CUSTOMER_NOT_FOUND", message: `Customer not found: ${customerId}` });
  }

  const result = await deleteCustomer(db, customerId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, { deleted: true, id: customerId });
});

// ---------------------------------------------------------------------------
// GET /:id/invoices — list invoices for a customer
// ---------------------------------------------------------------------------

customerRoutes.get("/:id/invoices", async (c) => {
  const db = c.get("engine").getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const customerId = c.req.param("id");

  // Verify customer belongs to this ledger
  const existing = await getCustomer(db, customerId);
  if (!existing.ok || existing.value.ledgerId !== apiKeyInfo.ledgerId) {
    return errorResponse(c, { code: "CUSTOMER_NOT_FOUND", message: `Customer not found: ${customerId}` });
  }

  const result = await listInvoices(db, apiKeyInfo.ledgerId, {
    customerId,
  });

  return paginated(c, result.data, result.cursor);
});

// ---------------------------------------------------------------------------
// GET /:id/statement — customer statement (outstanding invoices summary)
// ---------------------------------------------------------------------------

customerRoutes.get("/:id/statement", async (c) => {
  const db = c.get("engine").getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const customerId = c.req.param("id");

  // Verify customer belongs to this ledger
  const existing = await getCustomer(db, customerId);
  if (!existing.ok || existing.value.ledgerId !== apiKeyInfo.ledgerId) {
    return errorResponse(c, { code: "CUSTOMER_NOT_FOUND", message: `Customer not found: ${customerId}` });
  }

  const customer = existing.value;

  // Get all invoices for this customer
  const result = await listInvoices(db, apiKeyInfo.ledgerId, { customerId });
  const invoices = result.data;

  const outstanding = invoices.filter((i) =>
    ["sent", "partially_paid", "overdue"].includes(i.status),
  );

  const totalOutstanding = outstanding.reduce((sum, i) => sum + i.amountDue, 0);
  const totalOverdue = outstanding
    .filter((i) => i.status === "overdue")
    .reduce((sum, i) => sum + i.amountDue, 0);

  return success(c, {
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
    },
    totalOutstanding,
    totalOverdue,
    currency: invoices[0]?.currency ?? "USD",
    invoices: outstanding.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      total: i.total,
      amountPaid: i.amountPaid,
      amountDue: i.amountDue,
      status: i.status,
    })),
  });
});

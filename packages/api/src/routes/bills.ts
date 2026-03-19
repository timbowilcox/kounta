// ---------------------------------------------------------------------------
// Bill routes — /v1/bills
//
// Full Accounts Payable lifecycle: create, approve, record payment,
// void, summary, and AP aging. All routes require API key auth.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { success, created, errorResponse, paginated } from "../lib/responses.js";
import type { CreateBillInput, UpdateBillInput, RecordBillPaymentInput } from "@kounta/core";
import { tierLimitCheck, tierUsageIncrement } from "../middleware/tier-enforcement.js";

export const billRoutes = new Hono<Env>();

billRoutes.use("/*", apiKeyAuth);

// ---------------------------------------------------------------------------
// GET / — list bills
// ---------------------------------------------------------------------------

billRoutes.get("/", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const status = c.req.query("status");
  const vendor = c.req.query("vendor");
  const fromDate = c.req.query("from_date");
  const toDate = c.req.query("to_date");
  const cursor = c.req.query("cursor");
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;

  const result = await engine.listBills(apiKeyInfo.ledgerId, {
    status: status ?? undefined,
    vendorName: vendor ?? undefined,
    dateFrom: fromDate ?? undefined,
    dateTo: toDate ?? undefined,
    cursor: cursor ?? undefined,
    limit,
  });

  return paginated(c, result.data, result.cursor);
});

// ---------------------------------------------------------------------------
// GET /summary — bill summary
// ---------------------------------------------------------------------------

billRoutes.get("/summary", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const summary = await engine.getBillSummary(apiKeyInfo.ledgerId);
  return success(c, summary);
});

// ---------------------------------------------------------------------------
// GET /aging — AP aging report
// ---------------------------------------------------------------------------

billRoutes.get("/aging", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const buckets = await engine.getAPAging(apiKeyInfo.ledgerId);
  return success(c, buckets);
});

// ---------------------------------------------------------------------------
// POST / — create bill
// ---------------------------------------------------------------------------

billRoutes.post("/", tierLimitCheck("bills"), tierUsageIncrement("bills"), async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const body = await c.req.json() as Omit<CreateBillInput, "ledgerId">;

  const result = await engine.createBill(apiKeyInfo.ledgerId, apiKeyInfo.userId ?? "system", body);
  if (!result.ok) return errorResponse(c, result.error);
  return created(c, result.value);
});

// ---------------------------------------------------------------------------
// GET /:id — get bill with line items and payments
// ---------------------------------------------------------------------------

billRoutes.get("/:id", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const billId = c.req.param("id");

  if (!(await engine.verifyBillBelongsToLedger(billId, apiKeyInfo.ledgerId))) {
    return errorResponse(c, { code: "BILL_NOT_FOUND", message: `Bill not found: ${billId}` });
  }

  const result = await engine.getBill(billId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// PATCH /:id — update draft bill
// ---------------------------------------------------------------------------

billRoutes.patch("/:id", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const billId = c.req.param("id");

  if (!(await engine.verifyBillBelongsToLedger(billId, apiKeyInfo.ledgerId))) {
    return errorResponse(c, { code: "BILL_NOT_FOUND", message: `Bill not found: ${billId}` });
  }

  const body = await c.req.json() as UpdateBillInput;
  const result = await engine.updateBill(billId, body);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /:id/approve — approve bill, post AP journal entry
// ---------------------------------------------------------------------------

billRoutes.post("/:id/approve", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const billId = c.req.param("id");

  if (!(await engine.verifyBillBelongsToLedger(billId, apiKeyInfo.ledgerId))) {
    return errorResponse(c, { code: "BILL_NOT_FOUND", message: `Bill not found: ${billId}` });
  }

  const result = await engine.approveBill(billId, apiKeyInfo.ledgerId, apiKeyInfo.userId ?? "system");
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /:id/payment — record payment against bill
// ---------------------------------------------------------------------------

billRoutes.post("/:id/payment", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const billId = c.req.param("id");

  if (!(await engine.verifyBillBelongsToLedger(billId, apiKeyInfo.ledgerId))) {
    return errorResponse(c, { code: "BILL_NOT_FOUND", message: `Bill not found: ${billId}` });
  }

  const body = await c.req.json() as RecordBillPaymentInput;
  const result = await engine.recordBillPayment(billId, apiKeyInfo.ledgerId, apiKeyInfo.userId ?? "system", body);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /:id/void — void bill and reverse AP entry
// ---------------------------------------------------------------------------

billRoutes.post("/:id/void", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const billId = c.req.param("id");

  if (!(await engine.verifyBillBelongsToLedger(billId, apiKeyInfo.ledgerId))) {
    return errorResponse(c, { code: "BILL_NOT_FOUND", message: `Bill not found: ${billId}` });
  }

  const result = await engine.voidBill(billId, apiKeyInfo.ledgerId, apiKeyInfo.userId ?? "system");
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// DELETE /:id — delete draft bill (no accounting impact)
// ---------------------------------------------------------------------------

billRoutes.delete("/:id", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const billId = c.req.param("id");

  const result = await engine.deleteBillDraft(billId, apiKeyInfo.ledgerId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

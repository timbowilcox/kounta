// ---------------------------------------------------------------------------
// Vendor routes — /v1/vendors
//
// Vendor contact management for Accounts Payable.
// All routes require API key auth.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { success, created, errorResponse, paginated } from "../lib/responses.js";
import type { CreateVendorInput, UpdateVendorInput } from "@kounta/core";
import { tierLimitCheck, tierUsageIncrement } from "../middleware/tier-enforcement.js";

export const vendorRoutes = new Hono<Env>();

vendorRoutes.use("/*", apiKeyAuth);

// ---------------------------------------------------------------------------
// GET / — list vendors
// ---------------------------------------------------------------------------

vendorRoutes.get("/", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const search = c.req.query("search");
  const active = c.req.query("active");
  const cursor = c.req.query("cursor");
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;

  const result = await engine.listVendors(apiKeyInfo.ledgerId, {
    search: search ?? undefined,
    isActive: active !== undefined ? active === "true" : undefined,
    cursor: cursor ?? undefined,
    limit,
  });

  return paginated(c, result.data, result.cursor);
});

// ---------------------------------------------------------------------------
// POST / — create vendor
// ---------------------------------------------------------------------------

vendorRoutes.post("/", tierLimitCheck("vendors"), tierUsageIncrement("vendors"), async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const body = await c.req.json() as CreateVendorInput;

  const result = await engine.createVendor(apiKeyInfo.ledgerId, body);
  if (!result.ok) return errorResponse(c, result.error);
  return created(c, result.value);
});

// ---------------------------------------------------------------------------
// GET /:id — get vendor
// ---------------------------------------------------------------------------

vendorRoutes.get("/:id", async (c) => {
  const engine = c.get("engine");
  const vendorId = c.req.param("id");

  const result = await engine.getVendor(vendorId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// PATCH /:id — update vendor
// ---------------------------------------------------------------------------

vendorRoutes.patch("/:id", async (c) => {
  const engine = c.get("engine");
  const vendorId = c.req.param("id");

  const body = await c.req.json() as UpdateVendorInput;
  const result = await engine.updateVendor(vendorId, body);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// DELETE /:id — delete or deactivate vendor
// ---------------------------------------------------------------------------

vendorRoutes.delete("/:id", async (c) => {
  const engine = c.get("engine");
  const vendorId = c.req.param("id");

  const result = await engine.deleteVendor(vendorId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// GET /:id/bills — list bills for vendor
// ---------------------------------------------------------------------------

vendorRoutes.get("/:id/bills", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const vendorId = c.req.param("id");

  const result = await engine.listBills(apiKeyInfo.ledgerId, {
    vendorId,
  });

  return paginated(c, result.data, result.cursor);
});

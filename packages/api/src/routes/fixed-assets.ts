// ---------------------------------------------------------------------------
// Fixed Asset routes — /v1/fixed-assets
//
// Asset registration, depreciation schedules, processing, disposal, and
// capitalisation advisory. All routes require API key auth.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { success, created, errorResponse, paginated } from "../lib/responses.js";
import { adviseOnCapitalisation } from "@kounta/core";
import type { CreateFixedAssetInput, UpdateFixedAssetInput, DisposeAssetInput } from "@kounta/core";
import { tierLimitCheck, tierUsageIncrement } from "../middleware/tier-enforcement.js";

export const fixedAssetRoutes = new Hono<Env>();

fixedAssetRoutes.use("/*", apiKeyAuth);

// ---------------------------------------------------------------------------
// GET / — list fixed assets
// ---------------------------------------------------------------------------

fixedAssetRoutes.get("/", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const status = c.req.query("status") ?? "active";
  const cursor = c.req.query("cursor");
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;

  const result = await engine.listFixedAssets(apiKeyInfo.ledgerId, {
    status, cursor: cursor ?? undefined, limit,
  });

  return paginated(c, result.data, result.nextCursor);
});

// ---------------------------------------------------------------------------
// GET /summary — asset register summary
// ---------------------------------------------------------------------------

fixedAssetRoutes.get("/summary", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const summary = await engine.getAssetSummary(apiKeyInfo.ledgerId);
  return success(c, summary);
});

// ---------------------------------------------------------------------------
// GET /pending — pending depreciation entries
// ---------------------------------------------------------------------------

fixedAssetRoutes.get("/pending", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const result = await engine.getPendingDepreciation(apiKeyInfo.ledgerId);
  return success(c, result);
});

// ---------------------------------------------------------------------------
// POST /capitalisation-check — check if amount should be capitalised
// ---------------------------------------------------------------------------

fixedAssetRoutes.post("/capitalisation-check", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const body = await c.req.json() as {
    amount: number;
    asset_type: string;
    purchase_date: string;
    annual_turnover?: number;
  };

  const jurResult = await engine.getLedgerJurisdiction(apiKeyInfo.ledgerId);
  const jurisdiction = jurResult.ok ? jurResult.value.jurisdiction : "AU";
  const purchaseYear = new Date(body.purchase_date).getUTCFullYear();

  const advice = adviseOnCapitalisation(
    body.amount,
    jurisdiction,
    body.annual_turnover ?? null,
    purchaseYear,
    body.asset_type,
  );

  return success(c, { ...advice, jurisdiction });
});

// ---------------------------------------------------------------------------
// POST / — create fixed asset
// ---------------------------------------------------------------------------

fixedAssetRoutes.post("/", tierLimitCheck("fixed_assets"), tierUsageIncrement("fixed_assets"), async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const body = await c.req.json() as Omit<CreateFixedAssetInput, "ledgerId">;

  const result = await engine.createFixedAsset({
    ...body,
    ledgerId: apiKeyInfo.ledgerId,
  });

  if (!result.ok) return errorResponse(c, result.error);
  return created(c, result.value);
});

// ---------------------------------------------------------------------------
// GET /:id — get fixed asset with schedule
// ---------------------------------------------------------------------------

fixedAssetRoutes.get("/:id", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const assetId = c.req.param("id");

  const result = await engine.getFixedAsset(assetId);
  if (!result.ok) return errorResponse(c, result.error);

  // Verify the asset belongs to the authenticated ledger
  if (result.value.ledgerId !== apiKeyInfo.ledgerId) {
    return errorResponse(c, { code: "FIXED_ASSET_NOT_FOUND", message: `Fixed asset ${assetId} not found` });
  }

  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// PATCH /:id — update fixed asset
// ---------------------------------------------------------------------------

fixedAssetRoutes.patch("/:id", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const assetId = c.req.param("id");

  if (!(await engine.verifyFixedAssetBelongsToLedger(assetId, apiKeyInfo.ledgerId))) {
    return errorResponse(c, {
      code: "FIXED_ASSET_NOT_FOUND",
      message: `Fixed asset ${assetId} not found`,
    });
  }

  const body = await c.req.json() as Omit<UpdateFixedAssetInput, never>;
  const result = await engine.updateFixedAsset(assetId, body);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// GET /:id/schedule — get depreciation schedule
// ---------------------------------------------------------------------------

fixedAssetRoutes.get("/:id/schedule", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const assetId = c.req.param("id");

  if (!(await engine.verifyFixedAssetBelongsToLedger(assetId, apiKeyInfo.ledgerId))) {
    return errorResponse(c, { code: "FIXED_ASSET_NOT_FOUND", message: `Fixed asset ${assetId} not found` });
  }

  const result = await engine.getAssetSchedule(assetId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /:id/dispose — dispose of a fixed asset
// ---------------------------------------------------------------------------

fixedAssetRoutes.post("/:id/dispose", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const assetId = c.req.param("id");

  if (!(await engine.verifyFixedAssetBelongsToLedger(assetId, apiKeyInfo.ledgerId))) {
    return errorResponse(c, { code: "FIXED_ASSET_NOT_FOUND", message: `Fixed asset ${assetId} not found` });
  }

  const body = await c.req.json() as DisposeAssetInput;

  const result = await engine.disposeFixedAsset(assetId, body);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /run-depreciation — post all pending depreciation entries
// ---------------------------------------------------------------------------

fixedAssetRoutes.post("/run-depreciation", async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const result = await engine.runDepreciation(apiKeyInfo.ledgerId);
  return success(c, result);
});

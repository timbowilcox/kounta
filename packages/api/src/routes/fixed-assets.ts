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
import {
  createFixedAsset,
  getFixedAsset,
  listFixedAssets,
  getAssetSchedule,
  getPendingDepreciation,
  runDepreciation,
  getAssetSummary,
  disposeFixedAsset,
  adviseOnCapitalisation,
  updateFixedAsset,
} from "@kounta/core";
import type { CreateFixedAssetInput, UpdateFixedAssetInput, DisposeAssetInput } from "@kounta/core";
import { tierLimitCheck, tierUsageIncrement } from "../middleware/tier-enforcement.js";

export const fixedAssetRoutes = new Hono<Env>();

fixedAssetRoutes.use("/*", apiKeyAuth);

// ---------------------------------------------------------------------------
// GET / — list fixed assets
// ---------------------------------------------------------------------------

fixedAssetRoutes.get("/", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const status = c.req.query("status") ?? "active";
  const cursor = c.req.query("cursor");
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;

  const result = await listFixedAssets(db, apiKeyInfo.ledgerId, {
    status, cursor: cursor ?? undefined, limit,
  });

  return paginated(c, result.data, result.nextCursor);
});

// ---------------------------------------------------------------------------
// GET /summary — asset register summary
// ---------------------------------------------------------------------------

fixedAssetRoutes.get("/summary", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const summary = await getAssetSummary(db, apiKeyInfo.ledgerId);
  return success(c, summary);
});

// ---------------------------------------------------------------------------
// GET /pending — pending depreciation entries
// ---------------------------------------------------------------------------

fixedAssetRoutes.get("/pending", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const result = await getPendingDepreciation(db, apiKeyInfo.ledgerId);
  return success(c, result);
});

// ---------------------------------------------------------------------------
// POST /capitalisation-check — check if amount should be capitalised
// ---------------------------------------------------------------------------

fixedAssetRoutes.post("/capitalisation-check", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const body = await c.req.json() as {
    amount: number;
    asset_type: string;
    purchase_date: string;
    annual_turnover?: number;
  };

  // Get ledger jurisdiction
  const ledger = await db.get<{ jurisdiction: string }>(
    "SELECT jurisdiction FROM ledgers WHERE id = ?",
    [apiKeyInfo.ledgerId],
  );
  const jurisdiction = ledger?.jurisdiction ?? "AU";
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
  const db = engine.getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const body = await c.req.json() as Omit<CreateFixedAssetInput, "ledgerId">;

  const result = await createFixedAsset(db, {
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
  const db = c.get("engine").getDb();
  const assetId = c.req.param("id");

  const result = await getFixedAsset(db, assetId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// PATCH /:id — update fixed asset
// ---------------------------------------------------------------------------

fixedAssetRoutes.patch("/:id", async (c) => {
  const db = c.get("engine").getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const assetId = c.req.param("id");

  // Verify asset belongs to the authenticated ledger
  const existing = await db.get<{ ledger_id: string }>(
    "SELECT ledger_id FROM fixed_assets WHERE id = ?",
    [assetId],
  );
  if (!existing || existing.ledger_id !== apiKeyInfo.ledgerId) {
    return errorResponse(c, {
      code: "FIXED_ASSET_NOT_FOUND",
      message: `Fixed asset ${assetId} not found`,
    });
  }

  const body = await c.req.json() as Omit<UpdateFixedAssetInput, never>;
  const result = await updateFixedAsset(db, assetId, body);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// GET /:id/schedule — get depreciation schedule
// ---------------------------------------------------------------------------

fixedAssetRoutes.get("/:id/schedule", async (c) => {
  const db = c.get("engine").getDb();
  const assetId = c.req.param("id");

  const result = await getAssetSchedule(db, assetId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /:id/dispose — dispose of a fixed asset
// ---------------------------------------------------------------------------

fixedAssetRoutes.post("/:id/dispose", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const assetId = c.req.param("id");
  const body = await c.req.json() as DisposeAssetInput;

  const result = await disposeFixedAsset(db, engine, assetId, body);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /run-depreciation — post all pending depreciation entries
// ---------------------------------------------------------------------------

fixedAssetRoutes.post("/run-depreciation", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const result = await runDepreciation(db, engine, apiKeyInfo.ledgerId);
  return success(c, result);
});

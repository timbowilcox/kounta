// ---------------------------------------------------------------------------
// Usage routes — /v1/usage
//
// Provides tier-based usage information, history, and tier configuration.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { success, errorResponse } from "../lib/responses.js";
import {
  getUsageSummary,
  TIER_CONFIGS,
  createError,
  ErrorCode,
} from "@kounta/core";

export const usageRoutes = new Hono<Env>();

// ---------------------------------------------------------------------------
// GET /v1/tiers — public tier configuration (no auth)
// ---------------------------------------------------------------------------

usageRoutes.get("/tiers", async (c) => {
  return success(c, TIER_CONFIGS);
});

// ---------------------------------------------------------------------------
// Auth-protected usage routes
// ---------------------------------------------------------------------------

/** GET /v1/usage — current billing period usage summary */
usageRoutes.get("/", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  try {
    const summary = await getUsageSummary(engine.getDb(), apiKeyInfo.userId);
    return success(c, summary);
  } catch (e) {
    return errorResponse(c, createError(
      ErrorCode.INTERNAL_ERROR,
      `Failed to get usage summary: ${e instanceof Error ? e.message : String(e)}`,
    ));
  }
});

/** GET /v1/usage/history — usage records for the last 12 months */
usageRoutes.get("/history", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const db = engine.getDb();

  try {
    const rows = await db.all<{
      period_start: string;
      period_end: string;
      ledger_id: string | null;
      transactions_count: number;
      invoices_count: number;
      customers_count: number;
      fixed_assets_count: number;
    }>(
      `SELECT period_start, period_end, ledger_id, transactions_count, invoices_count, customers_count, fixed_assets_count
       FROM usage_tracking
       WHERE user_id = ?
       ORDER BY period_start DESC
       LIMIT 120`,
      [apiKeyInfo.userId],
    );

    // Group by period
    const periods = new Map<string, {
      periodStart: string;
      periodEnd: string;
      transactions: number;
      invoices: number;
      customers: number;
      fixedAssets: number;
    }>();

    for (const row of rows) {
      const existing = periods.get(row.period_start);
      if (existing) {
        existing.transactions += row.transactions_count;
        existing.invoices += row.invoices_count;
        existing.customers += row.customers_count;
        existing.fixedAssets += row.fixed_assets_count;
      } else {
        periods.set(row.period_start, {
          periodStart: row.period_start,
          periodEnd: row.period_end,
          transactions: row.transactions_count,
          invoices: row.invoices_count,
          customers: row.customers_count,
          fixedAssets: row.fixed_assets_count,
        });
      }
    }

    return success(c, Array.from(periods.values()).slice(0, 12));
  } catch (e) {
    return errorResponse(c, createError(
      ErrorCode.INTERNAL_ERROR,
      `Failed to get usage history: ${e instanceof Error ? e.message : String(e)}`,
    ));
  }
});

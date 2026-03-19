// ---------------------------------------------------------------------------
// MCP tier enforcement helpers — check limits and features before MCP tools.
// ---------------------------------------------------------------------------

import type { Database } from "@kounta/core";
import { checkLimit, hasFeature } from "@kounta/core";
import type { TierFeature } from "@kounta/core";
import { toolErr } from "./helpers.js";

const UPGRADE_URL = "https://kounta.ai/billing";

/** Check a usage limit before executing an MCP tool. Returns an error response if over limit, or null if allowed. */
export async function mcpCheckLimit(
  db: Database,
  userId: string,
  ledgerId: string | undefined,
  resource: string,
): Promise<ReturnType<typeof toolErr> | null> {
  try {
    const result = await checkLimit(db, userId, ledgerId, resource);
    if (!result.allowed) {
      return toolErr({
        code: "PLAN_LIMIT_EXCEEDED",
        message: `${result.message} Upgrade at ${UPGRADE_URL}`,
        limit: result.limit,
        used: result.used,
        upgrade_url: UPGRADE_URL,
      });
    }
  } catch (e) {
    // Log but allow — MCP runs locally, tier check is advisory
    console.warn("[mcp/tier-check] Limit check failed:", e instanceof Error ? e.message : String(e));
  }
  return null;
}

/** Check if a feature is available on the user's tier. Returns an error response if not, or null if allowed. */
export async function mcpCheckFeature(
  db: Database,
  userId: string,
  feature: TierFeature,
): Promise<ReturnType<typeof toolErr> | null> {
  try {
    const user = await db.get<{ plan: string | null }>(
      "SELECT plan FROM users WHERE id = ?",
      [userId],
    );
    const tier = user?.plan || "free";
    if (!hasFeature(tier, feature)) {
      return toolErr({
        code: "FORBIDDEN",
        message: `This feature requires a higher tier. Your current plan: ${tier}. Upgrade at ${UPGRADE_URL}`,
        tier,
        upgrade_url: UPGRADE_URL,
      });
    }
  } catch (e) {
    // Log but allow — MCP runs locally, tier check is advisory
    console.warn("[mcp/tier-check] Feature check failed:", e instanceof Error ? e.message : String(e));
  }
  return null;
}

/** Get the user ID that owns a ledger. Returns null if not found. */
export async function getLedgerOwner(db: Database, ledgerId: string): Promise<string | null> {
  const row = await db.get<{ owner_id: string }>(
    "SELECT owner_id FROM ledgers WHERE id = ?",
    [ledgerId],
  );
  return row?.owner_id ?? null;
}

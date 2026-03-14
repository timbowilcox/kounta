// ---------------------------------------------------------------------------
// Plan enforcement — checks usage limits before transaction posting.
//
// Free plan: 0–499 post normally, 500–599 accepted as pending, 600+ rejected.
// Paid plans: no limit.
// ---------------------------------------------------------------------------

import type { LedgerEngine, PlanEnforcementResult } from "@kounta/core";

const FREE_SOFT_LIMIT = 500;
const FREE_HARD_LIMIT = 600;

export const DASHBOARD_URL = process.env["NEXT_PUBLIC_APP_URL"] || "https://kounta.ai";
export const UPGRADE_URL = `${DASHBOARD_URL}/billing`;

export async function enforcePlanLimit(
  engine: LedgerEngine,
  ledgerId: string,
): Promise<PlanEnforcementResult & { count?: number; limit?: number; nextResetDate?: string }> {
  const usageResult = await engine.getUsage(ledgerId);
  if (!usageResult.ok) {
    // If we can't check usage, allow the transaction (fail open)
    return { allowed: true, status: "posted" };
  }

  const { count, plan, periodEnd } = usageResult.value;

  // Paid plans have no limits
  if (plan !== "free") {
    return { allowed: true, status: "posted", count, limit: -1, nextResetDate: periodEnd };
  }

  // Calculate next reset date (1st of next month)
  const endDate = new Date(periodEnd);
  endDate.setDate(endDate.getDate() + 1);
  const nextResetDate = endDate.toISOString().split("T")[0];

  if (count < FREE_SOFT_LIMIT) {
    return { allowed: true, status: "posted", count, limit: FREE_SOFT_LIMIT, nextResetDate };
  }

  if (count < FREE_HARD_LIMIT) {
    return { allowed: true, status: "pending", count, limit: FREE_SOFT_LIMIT, nextResetDate };
  }

  return { allowed: false, count, limit: FREE_SOFT_LIMIT, nextResetDate };
}

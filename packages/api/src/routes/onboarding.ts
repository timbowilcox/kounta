// ---------------------------------------------------------------------------
// Onboarding routes — /v1/onboarding
//
// Manage onboarding state, checklist, and setup execution.
// All routes use API key auth scoped to the authenticated user.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { success } from "../lib/responses.js";
import {
  getOnboardingState,
  createOnboardingState,
  updateOnboardingState,
  getChecklist,
  initChecklist,
  completeChecklistItem,
  dismissChecklist,
  executeSetup,
  autoCreateAccountForBankAccount,
  getUnclassifiedTransactionStats,
} from "@kounta/core";
import type { ChecklistItemKey } from "@kounta/core";

export const onboardingRoutes = new Hono<Env>();

// ---------------------------------------------------------------------------
// GET /state — get onboarding state for the authenticated user
// ---------------------------------------------------------------------------

onboardingRoutes.get("/state", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const state = await getOnboardingState(engine.getDb(), apiKeyInfo.userId);
  return success(c, state);
});

// ---------------------------------------------------------------------------
// POST /state — create or get onboarding state
// ---------------------------------------------------------------------------

onboardingRoutes.post("/state", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const state = await createOnboardingState(engine.getDb(), apiKeyInfo.userId);
  return success(c, state);
});

// ---------------------------------------------------------------------------
// PUT /state — update onboarding state
// ---------------------------------------------------------------------------

onboardingRoutes.put("/state", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const body = await c.req.json();
  const state = await updateOnboardingState(engine.getDb(), apiKeyInfo.userId, body);
  return success(c, state);
});

// ---------------------------------------------------------------------------
// POST /setup — execute the automated setup (create ledger, apply template)
// ---------------------------------------------------------------------------

onboardingRoutes.post("/setup", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;

  const state = await getOnboardingState(engine.getDb(), apiKeyInfo.userId);
  if (!state) {
    return c.json({
      error: {
        code: "ONBOARDING_NOT_FOUND",
        message: "No onboarding state found. Create one first.",
      },
    }, 404);
  }

  try {
    const result = await executeSetup(engine, apiKeyInfo.userId, state);
    return success(c, result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Setup failed";
    return c.json({
      error: { code: "SETUP_FAILED", message: msg },
    }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /checklist — get checklist items
// ---------------------------------------------------------------------------

onboardingRoutes.get("/checklist", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const items = await getChecklist(engine.getDb(), apiKeyInfo.userId);
  return success(c, items);
});

// ---------------------------------------------------------------------------
// POST /checklist/init — initialize checklist with default items
// ---------------------------------------------------------------------------

onboardingRoutes.post("/checklist/init", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const items = await initChecklist(engine.getDb(), apiKeyInfo.userId);
  return success(c, items);
});

// ---------------------------------------------------------------------------
// POST /checklist/:item/complete — mark a checklist item complete
// ---------------------------------------------------------------------------

onboardingRoutes.post("/checklist/:item/complete", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const item = c.req.param("item") as ChecklistItemKey;
  await completeChecklistItem(engine.getDb(), apiKeyInfo.userId, item);
  return success(c, { item, completed: true });
});

// ---------------------------------------------------------------------------
// POST /checklist/dismiss — dismiss entire checklist
// ---------------------------------------------------------------------------

onboardingRoutes.post("/checklist/dismiss", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  await dismissChecklist(engine.getDb(), apiKeyInfo.userId);
  return success(c, { dismissed: true });
});

// ---------------------------------------------------------------------------
// GET /classification-stats — get unclassified transaction counts
// ---------------------------------------------------------------------------

onboardingRoutes.get("/classification-stats", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const stats = await getUnclassifiedTransactionStats(engine.getDb(), apiKeyInfo.ledgerId);
  return success(c, stats);
});

// ---------------------------------------------------------------------------
// POST /auto-account — auto-create ledger account for bank connection
// ---------------------------------------------------------------------------

onboardingRoutes.post("/auto-account", apiKeyAuth, async (c) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const body = await c.req.json();

  const { bankAccountName, bankAccountType } = body;
  if (!bankAccountName || !bankAccountType) {
    return c.json({
      error: {
        code: "VALIDATION_ERROR",
        message: "bankAccountName and bankAccountType are required",
      },
    }, 400);
  }

  const result = await autoCreateAccountForBankAccount(
    engine,
    apiKeyInfo.ledgerId,
    bankAccountName,
    bankAccountType,
  );

  if (!result) {
    return c.json({
      error: { code: "AUTO_ACCOUNT_FAILED", message: "Failed to create account" },
    }, 500);
  }

  return success(c, result);
});

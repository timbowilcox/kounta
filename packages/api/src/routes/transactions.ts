// ---------------------------------------------------------------------------
// Transaction routes — /v1/ledgers/:ledgerId/transactions
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { errorResponse, created, accepted, success, paginated } from "../lib/responses.js";
import { enforcePlanLimit, UPGRADE_URL } from "../middleware/plan.js";
import { planLimitExceededError, getJurisdictionConfig, checkLimit, incrementUsage as incrementTierUsage } from "@kounta/core";

export const transactionRoutes = new Hono<Env>();

// All transaction routes require API key auth
transactionRoutes.use("/*", apiKeyAuth);

/** POST /v1/ledgers/:ledgerId/transactions — Post a new transaction */
transactionRoutes.post("/", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId");
  const body = await c.req.json();

  // Support Idempotency-Key header as an alternative to body field
  const headerKey = c.req.header("Idempotency-Key");
  const idempotencyKey = body.idempotencyKey ?? headerKey;

  // Tier-based usage limit check (new system)
  try {
    const apiKeyInfo = c.get("apiKeyInfo");
    if (apiKeyInfo) {
      const tierCheck = await checkLimit(engine.getDb(), apiKeyInfo.userId, ledgerId!, "transactions");
      if (!tierCheck.allowed) {
        return c.json(
          {
            error: {
              code: "PLAN_LIMIT_EXCEEDED",
              message: tierCheck.message,
              details: [{ field: "transactions", actual: String(tierCheck.used), expected: String(tierCheck.limit) }],
              limit: tierCheck.limit,
              used: tierCheck.used,
              upgrade_url: UPGRADE_URL,
              requestId: c.get("requestId"),
            },
          },
          429,
        );
      }
    }
  } catch { /* fail open if tier check unavailable */ }

  // Legacy plan enforcement — check usage limits before posting
  let enforcement: Awaited<ReturnType<typeof enforcePlanLimit>>;
  try {
    enforcement = await enforcePlanLimit(engine, ledgerId!);
  } catch {
    // If plan enforcement fails (e.g. migration not applied), allow the transaction
    enforcement = { allowed: true, status: "posted" as const };
  }

  if (!enforcement.allowed) {
    const nextReset = enforcement.nextResetDate ?? "next month";
    c.header("X-Kounta-Usage", String(enforcement.count ?? 0) + "/" + String(enforcement.limit ?? 500));
    return errorResponse(c, planLimitExceededError(
      enforcement.count ?? 0,
      enforcement.limit ?? 500,
      nextReset,
      UPGRADE_URL,
    ));
  }

  const statusOverride = enforcement.status;

  const result = await engine.postTransaction({
    ledgerId: ledgerId!,
    date: body.date,
    effectiveDate: body.effectiveDate,
    memo: body.memo,
    lines: body.lines,
    idempotencyKey,
    sourceType: body.sourceType ?? "api",
    sourceRef: body.sourceRef,
    agentId: body.agentId,
    metadata: body.metadata,
    statusOverride,
  });

  if (!result.ok) {
    return errorResponse(c, result.error);
  }

  // Increment usage counters (best-effort — migration may not be applied)
  try { await engine.incrementUsage(ledgerId!); } catch { /* ignore */ }
  try {
    const apiKeyInfo = c.get("apiKeyInfo");
    if (apiKeyInfo) {
      await incrementTierUsage(engine.getDb(), apiKeyInfo.userId, ledgerId!, "transactions_count");
    }
  } catch { /* ignore */ }

  // Receipt prompt — notify for expenses over $75 (7500 cents)
  try {
    const RECEIPT_THRESHOLD = 7500;
    const tx = result.value;
    const expenseDebits = tx.lines.filter((l) => l.direction === "debit" && l.amount >= RECEIPT_THRESHOLD);
    if (expenseDebits.length > 0) {
      // Check if any debit line targets an expense account
      for (const line of expenseDebits) {
        const acctResult = await engine.getAccount(line.accountId);
        if (acctResult.ok && acctResult.value.type === "expense") {
          const apiKeyInfo = c.get("apiKeyInfo");
          if (apiKeyInfo) {
            const amountDisplay = `$${(line.amount / 100).toFixed(2)}`;
            await engine.createNotification({
              ledgerId: ledgerId!,
              userId: apiKeyInfo.userId,
              type: "receipt_prompt",
              severity: "info",
              title: `Attach receipt for ${amountDisplay} expense`,
              body: `Transaction "${tx.memo}" includes a ${amountDisplay} expense. Consider attaching a receipt for audit readiness.`,
              data: { transactionId: tx.id, accountId: line.accountId, amount: line.amount },
              actionType: "attach_receipt",
              actionData: { transactionId: tx.id },
            });
          }
          break; // One notification per transaction
        }
      }
    }
  } catch { /* Receipt prompt is best-effort — never block transaction creation */ }

  // Capitalisation check — notify when large expenses may need to be capitalised
  try {
    const tx = result.value;

    // Skip depreciation entries (posted by the depreciation scheduler)
    const isDepreciation = tx.idempotencyKey?.startsWith("depreciation-") || tx.memo?.startsWith("Depreciation:");

    // Skip transactions linked to recurring entries
    const db = engine.getDb();
    const recurringLink = await db.get<{ id: string }>(
      "SELECT id FROM recurring_entry_log WHERE transaction_id = ? LIMIT 1",
      [tx.id],
    );
    const isRecurring = !!recurringLink;

    if (!isDepreciation && !isRecurring) {
      // Account name keywords to exclude (legitimate recurring large expenses)
      const EXCLUDE_KEYWORDS = /\b(rent|insurance|subscription|lease|payroll|salary|wages|tax|utilities)\b/i;

      // Get jurisdiction config for threshold
      const ledgerRow = await db.get<{ jurisdiction: string }>(
        "SELECT jurisdiction FROM ledgers WHERE id = ?",
        [ledgerId],
      );
      const jurisdiction = ledgerRow?.jurisdiction ?? "AU";
      const jConfig = getJurisdictionConfig(jurisdiction);
      const threshold = jConfig.capitalisationThreshold;

      if (threshold > 0) {
        // Find expense debits exceeding the threshold
        const expenseDebits = tx.lines.filter((l) => l.direction === "debit" && l.amount >= threshold);
        for (const line of expenseDebits) {
          const acctResult = await engine.getAccount(line.accountId);
          if (!acctResult.ok || acctResult.value.type !== "expense") continue;

          // Skip accounts with excluded keywords in the name
          if (EXCLUDE_KEYWORDS.test(acctResult.value.name)) continue;

          const apiKeyInfo = c.get("apiKeyInfo");
          if (!apiKeyInfo) break;

          const amountDisplay = `$${(line.amount / 100).toFixed(2)}`;
          const thresholdDisplay = `$${(threshold / 100).toFixed(2)}`;
          await engine.createNotification({
            ledgerId: ledgerId!,
            userId: apiKeyInfo.userId,
            type: "capitalisation_check",
            severity: "warning",
            title: "Large expense — should this be capitalised?",
            body: `${amountDisplay} posted to ${acctResult.value.name}. Amounts over ${thresholdDisplay} may need to be recorded as fixed assets. Use check_capitalisation to verify.`,
            data: { transactionId: tx.id, accountId: line.accountId, amount: line.amount, threshold },
            actionType: "navigate",
            actionData: { url: "/fixed-assets" },
          });
          break; // One notification per transaction
        }
      }
    }
  } catch { /* Capitalisation check is best-effort — never block transaction creation */ }

  // Add usage header
  const newCount = (enforcement.count ?? 0) + 1;
  c.header("X-Kounta-Usage", String(newCount) + "/" + String(enforcement.limit ?? 500));

  if (statusOverride === "pending") {
    return accepted(c, {
      ...result.value,
      _billing: {
        status: "pending",
        reason: "plan_limit_reached",
        upgradeUrl: UPGRADE_URL,
      },
    });
  }

  return created(c, result.value);
});

/** GET /v1/ledgers/:ledgerId/transactions — List transactions (paginated) */
transactionRoutes.get("/", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId");
  const cursor = c.req.query("cursor");
  const limitStr = c.req.query("limit");
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;

  const result = await engine.listTransactions(ledgerId!, { cursor, limit });
  if (!result.ok) {
    return errorResponse(c, result.error);
  }

  // Add usage header to list response (best-effort)
  try {
    const usageInfo = await enforcePlanLimit(engine, ledgerId!);
    if (usageInfo.count !== undefined && usageInfo.limit !== undefined) {
      c.header("X-Kounta-Usage", String(usageInfo.count) + "/" + String(usageInfo.limit));
    }
  } catch { /* ignore — billing migration may not be applied */ }

  return paginated(c, result.value.data, result.value.nextCursor);
});

/** GET /v1/ledgers/:ledgerId/transactions/:transactionId — Get a single transaction */
transactionRoutes.get("/:transactionId", async (c) => {
  const engine = c.get("engine");
  const transactionId = c.req.param("transactionId");

  const result = await engine.getTransaction(transactionId);
  if (!result.ok) {
    return errorResponse(c, result.error);
  }

  // Enforce that the transaction belongs to the scoped ledger
  const ledgerId = c.req.param("ledgerId");
  if (result.value.ledgerId !== ledgerId) {
    return c.json(
      {
        error: {
          code: "TRANSACTION_NOT_FOUND",
          message: "Transaction not found in this ledger",
          details: [
            {
              field: "transactionId",
              actual: transactionId,
              suggestion:
                "This transaction exists but belongs to a different ledger. Verify you are using the correct ledger ID in the URL.",
            },
          ],
          requestId: c.get("requestId"),
        },
      },
      404
    );
  }

  return success(c, result.value);
});

/** POST /v1/ledgers/:ledgerId/transactions/:transactionId/reverse — Reverse a transaction */
transactionRoutes.post("/:transactionId/reverse", async (c) => {
  const engine = c.get("engine");
  const transactionId = c.req.param("transactionId");
  const body = await c.req.json();

  if (!body.reason || typeof body.reason !== "string") {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "reason is required",
          details: [
            {
              field: "reason",
              suggestion:
                'Provide a "reason" string in the request body explaining why the transaction is being reversed.',
            },
          ],
          requestId: c.get("requestId"),
        },
      },
      400
    );
  }

  // Verify the transaction belongs to the scoped ledger
  const getResult = await engine.getTransaction(transactionId);
  if (!getResult.ok) {
    return errorResponse(c, getResult.error);
  }

  const ledgerId = c.req.param("ledgerId");
  if (getResult.value.ledgerId !== ledgerId) {
    return c.json(
      {
        error: {
          code: "TRANSACTION_NOT_FOUND",
          message: "Transaction not found in this ledger",
          details: [
            {
              field: "transactionId",
              actual: transactionId,
              suggestion:
                "This transaction exists but belongs to a different ledger. Verify you are using the correct ledger ID in the URL.",
            },
          ],
          requestId: c.get("requestId"),
        },
      },
      404
    );
  }

  const result = await engine.reverseTransaction(transactionId, body.reason);
  if (!result.ok) {
    return errorResponse(c, result.error);
  }

  return created(c, result.value);
});

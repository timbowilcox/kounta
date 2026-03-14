// ---------------------------------------------------------------------------
// Bank Feed routes — /v1/ledgers/:ledgerId/bank-feeds
//
// All routes require API key auth and Builder plan or higher.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { errorResponse, created, success } from "../lib/responses.js";
import {
  createError,
  ErrorCode,
  createBankFeedProvider,
} from "@kounta/core";
import type { ProviderName, ProviderConfig, BankFeedProvider } from "@kounta/core";

export const bankFeedRoutes = new Hono<Env>();

bankFeedRoutes.use("/*", apiKeyAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Enforce Builder plan or higher. Returns error response if free plan. */
const requirePaidPlan = async (c: Context<Env>) => {
  const engine = c.get("engine");
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const userResult = await engine.getUserByLedger(apiKeyInfo.ledgerId);
  if (!userResult.ok || !userResult.value) {
    return errorResponse(c, createError(ErrorCode.INTERNAL_ERROR, "User not found"));
  }
  if (userResult.value.plan === "free") {
    return errorResponse(
      c,
      createError(ErrorCode.FORBIDDEN, "Bank feeds require a Builder plan or higher", [
        {
          field: "plan",
          actual: "free",
          expected: "builder, pro, or platform",
          suggestion: "Upgrade your plan at the billing page to enable bank feed connections.",
        },
      ])
    );
  }
  return null;
};

/** Get the configured bank feed provider or return error response. */
const getProvider = (c: Context<Env>): { provider: BankFeedProvider; error: null } | { provider: null; error: Response } => {
  const basiqApiKey = process.env["BASIQ_API_KEY"];
  if (!basiqApiKey) {
    return {
      provider: null,
      error: errorResponse(
        c,
        createError(ErrorCode.BANK_FEED_NOT_CONFIGURED, "Bank feed provider is not configured", [
          {
            field: "provider",
            suggestion:
              "Set BASIQ_API_KEY environment variable to enable bank feeds.",
          },
        ])
      ) as unknown as Response,
    };
  }

  const providerName: ProviderName = "basiq";
  const config: ProviderConfig = {
    basiq: { apiKey: basiqApiKey },
  };

  return { provider: createBankFeedProvider(providerName, config), error: null };
};

// ---------------------------------------------------------------------------
// Connection routes
// ---------------------------------------------------------------------------

/** POST /v1/ledgers/:ledgerId/bank-feeds/connect — Create connection session */
bankFeedRoutes.post("/connect", async (c) => {
  const planError = await requirePaidPlan(c);
  if (planError) return planError;

  const result = getProvider(c);
  if (!result.provider) return result.error;
  const provider = result.provider;

  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId")!;
  const apiKeyInfo = c.get("apiKeyInfo")!;
  const body = await c.req.json();

  try {
    const session = await provider.createConnectionSession({
      userId: apiKeyInfo.userId,
      institutionId: body.institutionId,
      redirectUrl: body.redirectUrl ?? "",
    });

    // Store the connection record
    const connResult = await engine.createBankConnection({
      ledgerId,
      provider: provider.name,
      providerConnectionId: session.connectionId,
      institutionId: body.institutionId ?? "",
      institutionName: body.institutionName ?? "",
    });

    if (!connResult.ok) return errorResponse(c, connResult.error);

    return created(c, {
      connection: connResult.value,
      sessionUrl: session.sessionUrl,
    });
  } catch (e) {
    return errorResponse(
      c,
      createError(
        ErrorCode.BANK_FEED_PROVIDER_ERROR,
        `Provider error: ${e instanceof Error ? e.message : String(e)}`
      )
    );
  }
});

/** GET /v1/ledgers/:ledgerId/bank-feeds/connections — List connections */
bankFeedRoutes.get("/connections", async (c) => {
  const planError = await requirePaidPlan(c);
  if (planError) return planError;

  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId")!;

  const result = await engine.listBankConnections(ledgerId);
  if (!result.ok) return errorResponse(c, result.error);

  return success(c, result.value);
});

/** GET /v1/ledgers/:ledgerId/bank-feeds/connections/:connectionId — Get connection */
bankFeedRoutes.get("/connections/:connectionId", async (c) => {
  const planError = await requirePaidPlan(c);
  if (planError) return planError;

  const engine = c.get("engine");
  const connectionId = c.req.param("connectionId")!;

  const result = await engine.getBankConnection(connectionId);
  if (!result.ok) return errorResponse(c, result.error);

  return success(c, result.value);
});

/** DELETE /v1/ledgers/:ledgerId/bank-feeds/connections/:connectionId — Disconnect */
bankFeedRoutes.delete("/connections/:connectionId", async (c) => {
  const planError = await requirePaidPlan(c);
  if (planError) return planError;

  const providerResult = getProvider(c);
  if (!providerResult.provider) return providerResult.error;
  const provider = providerResult.provider;

  const engine = c.get("engine");
  const connectionId = c.req.param("connectionId")!;

  // Get connection to find provider connection ID
  const connResult = await engine.getBankConnection(connectionId);
  if (!connResult.ok) return errorResponse(c, connResult.error);

  try {
    await provider.disconnect(connResult.value.providerConnectionId);
  } catch (e) {
    console.error("Provider disconnect error (continuing):", e);
  }

  const result = await engine.updateBankConnectionStatus(connectionId, "disconnected");
  if (!result.ok) return errorResponse(c, result.error);

  return success(c, { id: connectionId, status: "disconnected" });
});

// ---------------------------------------------------------------------------
// Account routes
// ---------------------------------------------------------------------------

/** GET /v1/ledgers/:ledgerId/bank-feeds/connections/:connectionId/accounts — List bank accounts */
bankFeedRoutes.get("/connections/:connectionId/accounts", async (c) => {
  const planError = await requirePaidPlan(c);
  if (planError) return planError;

  const engine = c.get("engine");
  const connectionId = c.req.param("connectionId")!;

  const result = await engine.listBankAccounts(connectionId);
  if (!result.ok) return errorResponse(c, result.error);

  return success(c, result.value);
});

/** POST /v1/ledgers/:ledgerId/bank-feeds/accounts/:bankAccountId/map — Map bank account to ledger account */
bankFeedRoutes.post("/accounts/:bankAccountId/map", async (c) => {
  const planError = await requirePaidPlan(c);
  if (planError) return planError;

  const engine = c.get("engine");
  const bankAccountId = c.req.param("bankAccountId")!;
  const body = await c.req.json();

  if (!body.accountId) {
    return errorResponse(
      c,
      createError(ErrorCode.VALIDATION_ERROR, "accountId is required", [
        {
          field: "accountId",
          suggestion: "Provide the ledger account ID to map this bank account to.",
        },
      ])
    );
  }

  const result = await engine.mapBankAccountToLedgerAccount(bankAccountId, body.accountId);
  if (!result.ok) return errorResponse(c, result.error);

  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// Sync routes
// ---------------------------------------------------------------------------

/** POST /v1/ledgers/:ledgerId/bank-feeds/accounts/:bankAccountId/sync — Trigger sync */
bankFeedRoutes.post("/accounts/:bankAccountId/sync", async (c) => {
  const planError = await requirePaidPlan(c);
  if (planError) return planError;

  const providerResult = getProvider(c);
  if (!providerResult.provider) return providerResult.error;
  const provider = providerResult.provider;

  const engine = c.get("engine");
  const bankAccountId = c.req.param("bankAccountId")!;
  const body = await c.req.json().catch(() => ({}));

  // Default sync window: last 90 days
  const toDate = body.toDate ?? new Date().toISOString().split("T")[0]!;
  const fromDate =
    body.fromDate ??
    new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;

  // Look up bank account to get connectionId
  const acctResult = await engine.getBankAccount(bankAccountId);
  if (!acctResult.ok) return errorResponse(c, acctResult.error);

  const result = await engine.syncBankAccount(provider, acctResult.value.connectionId, bankAccountId, fromDate, toDate);
  if (!result.ok) return errorResponse(c, result.error);

  return success(c, result.value);
});

/** GET /v1/ledgers/:ledgerId/bank-feeds/sync-log — Get sync history */
bankFeedRoutes.get("/sync-log", async (c) => {
  const planError = await requirePaidPlan(c);
  if (planError) return planError;

  const engine = c.get("engine");
  const connectionId = c.req.query("connectionId");

  if (!connectionId) {
    return errorResponse(
      c,
      createError(ErrorCode.VALIDATION_ERROR, "connectionId query parameter is required", [
        {
          field: "connectionId",
          suggestion: "Provide ?connectionId=xxx to filter sync logs by connection.",
        },
      ])
    );
  }

  const result = await engine.listSyncLogs(connectionId);
  if (!result.ok) return errorResponse(c, result.error);

  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// Transaction routes
// ---------------------------------------------------------------------------

/** GET /v1/ledgers/:ledgerId/bank-feeds/transactions — List bank transactions */
bankFeedRoutes.get("/transactions", async (c) => {
  const planError = await requirePaidPlan(c);
  if (planError) return planError;

  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId")!;
  const bankAccountId = c.req.query("bankAccountId");
  const status = c.req.query("status") as "pending" | "matched" | "posted" | "ignored" | undefined;
  const isPersonalStr = c.req.query("isPersonal");
  const isPersonal = isPersonalStr === "true" ? true : isPersonalStr === "false" ? false : undefined;
  const limitStr = c.req.query("limit");
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;

  if (!bankAccountId && !ledgerId) {
    return errorResponse(
      c,
      createError(ErrorCode.VALIDATION_ERROR, "bankAccountId or ledgerId is required", [
        {
          field: "bankAccountId",
          suggestion: "Provide ?bankAccountId=xxx to list transactions for a specific bank account, or use the ledgerId from the URL path.",
        },
      ])
    );
  }

  const result = await engine.listBankTransactions({
    bankAccountId: bankAccountId ?? undefined,
    ledgerId,
    status,
    isPersonal,
    limit,
  });
  if (!result.ok) return errorResponse(c, result.error);

  return success(c, result.value);
});

/** POST /v1/ledgers/:ledgerId/bank-feeds/transactions/:bankTransactionId/confirm — Confirm/ignore match */
bankFeedRoutes.post("/transactions/:bankTransactionId/confirm", async (c) => {
  const planError = await requirePaidPlan(c);
  if (planError) return planError;

  const engine = c.get("engine");
  const bankTransactionId = c.req.param("bankTransactionId")!;
  const body = await c.req.json();

  // action: "confirm" | "ignore"
  // overrideTransactionId: optional for manual match override
  const action = body.action;
  if (!action || !["confirm", "ignore"].includes(action)) {
    return errorResponse(
      c,
      createError(ErrorCode.VALIDATION_ERROR, 'action must be "confirm" or "ignore"', [
        {
          field: "action",
          actual: action,
          suggestion: 'Use "confirm" to accept a suggested match, or "ignore" to skip this transaction.',
        },
      ])
    );
  }

  const result = await engine.confirmBankTransactionMatch(
    bankTransactionId,
    action,
    body.overrideTransactionId
  );
  if (!result.ok) return errorResponse(c, result.error);

  return success(c, result.value);
});

/** POST /v1/ledgers/:ledgerId/bank-feeds/transactions/:bankTransactionId/mark-personal — Mark as personal */
bankFeedRoutes.post("/transactions/:bankTransactionId/mark-personal", async (c) => {
  const planError = await requirePaidPlan(c);
  if (planError) return planError;

  const engine = c.get("engine");
  const bankTransactionId = c.req.param("bankTransactionId")!;

  // classifyBankTransaction sets is_personal and auto-generates a rule
  const result = await engine.classifyBankTransaction(
    bankTransactionId,
    "", // no target account — personal transactions don't map to a ledger account
    true, // isPersonal
  );
  if (!result.ok) return errorResponse(c, result.error);

  // Also set status to ignored so it won't appear in pending lists
  await engine.confirmBankTransactionMatch(bankTransactionId, "ignore");

  // Return the updated bank transaction from the classify result
  return success(c, result.value);
});

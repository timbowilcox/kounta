// ---------------------------------------------------------------------------
// Shared response helpers for consistent API responses.
// ---------------------------------------------------------------------------

import type { Context } from "hono";
import { ErrorCode } from "@kounta/core";
import type { KountaError } from "@kounta/core";
import type { Env } from "./context.js";

/** Map error codes to HTTP status codes */
const httpStatusForCode: Record<string, number> = {
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.UNBALANCED_TRANSACTION]: 400,
  [ErrorCode.ACCOUNT_INACTIVE]: 400,
  [ErrorCode.ACCOUNT_WRONG_LEDGER]: 400,
  [ErrorCode.PERIOD_CLOSED]: 400,
  [ErrorCode.IMPORT_PARSE_ERROR]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.ACCOUNT_NOT_FOUND]: 404,
  [ErrorCode.LEDGER_NOT_FOUND]: 404,
  [ErrorCode.TRANSACTION_NOT_FOUND]: 404,
  [ErrorCode.TEMPLATE_NOT_FOUND]: 404,
  [ErrorCode.IMPORT_NOT_FOUND]: 404,
  [ErrorCode.API_KEY_NOT_FOUND]: 404,
  [ErrorCode.TRANSACTION_ALREADY_REVERSED]: 409,
  [ErrorCode.IDEMPOTENCY_CONFLICT]: 409,
  [ErrorCode.DUPLICATE_ACCOUNT_CODE]: 409,
  [ErrorCode.BANK_FEED_SYNC_IN_PROGRESS]: 409,
  [ErrorCode.PLAN_LIMIT_EXCEEDED]: 429,
  [ErrorCode.BANK_CONNECTION_NOT_FOUND]: 404,
  [ErrorCode.BANK_ACCOUNT_NOT_FOUND]: 404,
  [ErrorCode.BANK_FEED_PROVIDER_ERROR]: 502,
  [ErrorCode.BANK_FEED_NOT_CONFIGURED]: 503,
  [ErrorCode.NOTIFICATION_NOT_FOUND]: 404,
  [ErrorCode.ATTACHMENT_NOT_FOUND]: 404,
  [ErrorCode.EXCHANGE_RATE_NOT_FOUND]: 404,
  [ErrorCode.CURRENCY_NOT_ENABLED]: 400,
  [ErrorCode.CURRENCY_MISMATCH]: 400,
  [ErrorCode.FIXED_ASSET_NOT_FOUND]: 404,
  [ErrorCode.FIXED_ASSET_INVALID_STATE]: 400,
  [ErrorCode.INTERNAL_ERROR]: 500,
};

/** Return a JSON error response for a KountaError */
export const errorResponse = (c: Context<Env>, error: KountaError) => {
  const status = httpStatusForCode[error.code] ?? 500;
  return c.json(
    {
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? [],
        requestId: c.get("requestId"),
      },
    },
    status as Parameters<typeof c.json>[1]
  );
};

/** Return a 201 Created JSON response */
export const created = <T>(c: Context<Env>, data: T) =>
  c.json({ data }, 201);

/** Return a 202 Accepted JSON response */
export const accepted = <T>(c: Context<Env>, data: T) =>
  c.json({ data }, 202);

/** Return a 200 OK JSON response */
export const success = <T>(c: Context<Env>, data: T) =>
  c.json({ data });

/** Return a paginated 200 OK JSON response */
export const paginated = <T>(
  c: Context<Env>,
  data: readonly T[],
  nextCursor: string | null
) => c.json({ data, nextCursor });

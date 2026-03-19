// ---------------------------------------------------------------------------
// Zod validation helper for API routes.
//
// Provides a type-safe way to validate request bodies against Zod schemas
// with consistent error responses.
// ---------------------------------------------------------------------------

import type { Context } from "hono";
import type { z } from "zod";
import type { Env } from "./context.js";

/**
 * Validate a request body against a Zod schema.
 *
 * Returns the parsed (and typed) data on success, or a Response on failure.
 * Callers should check `instanceof Response` and return early.
 *
 * @example
 * ```ts
 * const body = await validateBody(c, createAccountSchema);
 * if (body instanceof Response) return body;
 * // body is fully typed from the schema
 * ```
 */
export const validateBody = async <T extends z.ZodTypeAny>(
  c: Context<Env>,
  schema: T,
): Promise<z.infer<T> | Response> => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid JSON in request body",
          details: [{ field: "body", suggestion: "Send a valid JSON object in the request body." }],
          requestId: c.get("requestId"),
        },
      },
      400,
    );
  }

  const result = schema.safeParse(raw);

  if (!result.success) {
    const details = result.error.issues.map((issue: z.ZodIssue) => ({
      field: issue.path.join(".") || "body",
      expected: issue.message,
      suggestion: issue.message,
    }));

    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request body validation failed",
          details,
          requestId: c.get("requestId"),
        },
      },
      400,
    );
  }

  return result.data as z.infer<T>;
};

/**
 * Validate query parameters against a Zod schema.
 *
 * Returns the parsed data on success, or a Response on failure.
 */
export const validateQuery = <T extends z.ZodTypeAny>(
  c: Context<Env>,
  schema: T,
): z.infer<T> | Response => {
  const raw = c.req.query();

  // Convert numeric-looking strings for Zod number fields
  const coerced: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    const num = Number(value);
    coerced[key] = !Number.isNaN(num) && value !== "" ? num : value;
  }

  const result = schema.safeParse(coerced);

  if (!result.success) {
    const details = result.error.issues.map((issue: z.ZodIssue) => ({
      field: issue.path.join(".") || "query",
      expected: issue.message,
      suggestion: issue.message,
    }));

    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Query parameter validation failed",
          details,
          requestId: c.get("requestId"),
        },
      },
      400,
    );
  }

  return result.data as z.infer<T>;
};

import type { MiddlewareHandler } from "hono";
import type { Env } from "../lib/context.js";

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyFn?: (c: any) => string;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

/**
 * In-memory sliding-window rate limiter.
 * Suitable for single-instance / self-hosted deployments.
 * For multi-instance, use a reverse proxy (Cloudflare, nginx) instead.
 */
export function rateLimit(config: RateLimitConfig): MiddlewareHandler<Env> {
  const windows = new Map<string, WindowEntry>();

  // Cleanup expired entries every 60s to prevent memory leak
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windows) {
      if (entry.resetAt <= now) windows.delete(key);
    }
  }, 60_000);
  cleanup.unref();

  return async (c, next) => {
    const key = config.keyFn
      ? config.keyFn(c)
      : c.get("apiKeyInfo")?.id ?? c.req.header("x-forwarded-for") ?? "anonymous";

    const now = Date.now();
    let entry = windows.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + config.windowMs };
      windows.set(key, entry);
    }

    entry.count++;

    // Set standard rate limit headers
    c.header("X-RateLimit-Limit", String(config.maxRequests));
    c.header("X-RateLimit-Remaining", String(Math.max(0, config.maxRequests - entry.count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > config.maxRequests) {
      return c.json(
        {
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: `Too many requests. Limit: ${config.maxRequests} per ${config.windowMs / 1000}s. Try again at ${new Date(entry.resetAt).toISOString()}.`,
            details: [],
            requestId: c.get("requestId"),
          },
        },
        429,
      );
    }

    await next();
  };
}

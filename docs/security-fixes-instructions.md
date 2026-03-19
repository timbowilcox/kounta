# Security Fixes — Implementation Instructions

## Fix Now (3 items)

---

### Fix #8: Missing Audit Entries

**Problem:** Three mutations skip the audit trail, violating the "audit everything" invariant.

**Pattern to follow** — every existing audit call in the engine looks like this:
```typescript
const auditId = generateId();
await this.db.run(
  `INSERT INTO audit_entries (id, ledger_id, entity_type, entity_id, action, actor_type, actor_id, snapshot, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [auditId, ledgerId, entityType, entityId, action, actorType, actorId, JSON.stringify(snapshot), now]
);
```

**Three places to fix:**

#### 8a. `createAccount()` — no audit on account creation

**File:** `packages/core/src/engine/index.ts` ~line 905 (after the INSERT INTO accounts, before the return)

Add:
```typescript
const auditId = generateId();
await this.db.run(
  `INSERT INTO audit_entries (id, ledger_id, entity_type, entity_id, action, actor_type, actor_id, snapshot, created_at)
   VALUES (?, ?, 'account', ?, 'created', 'system', 'engine', ?, ?)`,
  [auditId, params.ledgerId, id, JSON.stringify(toAccount(row)), now]
);
```

Place it right after the `SELECT * FROM accounts WHERE id = ?` query that confirms the insert succeeded, before the `return ok(...)`.

#### 8b. `revokeApiKey()` — no audit on key revocation

**File:** `packages/core/src/engine/index.ts` ~line 1505 (after `UPDATE api_keys SET status = 'revoked'`)

Add:
```typescript
const auditId = generateId();
await this.db.run(
  `INSERT INTO audit_entries (id, ledger_id, entity_type, entity_id, action, actor_type, actor_id, snapshot, created_at)
   VALUES (?, ?, 'api_key', ?, 'revoked', 'system', 'engine', ?, ?)`,
  [auditId, row.ledger_id, keyId, JSON.stringify(toApiKey(updated!)), new Date().toISOString()]
);
```

Place it right after the re-SELECT of the updated key, before `return ok(...)`.

#### 8c. Ledger soft-delete — no audit on deletion

This one is currently raw SQL in the API route (`packages/api/src/routes/ledgers.ts` line 203). It will be fixed as part of Fix #9 below — the new `softDeleteLedger()` engine method should include the audit entry.

**Testing:** After each change, verify the audit entry is created:
```typescript
// In your test, after the mutation:
const audits = await engine.listAuditEntries(ledgerId, { entityType: 'account', entityId: accountId });
expect(audits.ok && audits.value.data.length).toBeGreaterThan(0);
expect(audits.ok && audits.value.data[0].action).toBe('created');
```

---

### Fix #9: Domain Logic in API Routes

**Problem:** Raw SQL in API routes bypasses the engine, skipping validation, audit, and making routes untestable in isolation.

**Approach:** Extract raw SQL into engine methods, then call from routes.

#### 9a. `GET /v1/ledgers` — list ledgers (ledgers.ts lines 97-134)

**Current:** Raw SQL `SELECT id, name, currency, ... FROM ledgers WHERE owner_id = ?`

**Fix:** `engine.findLedgersByOwner(userId)` already exists at engine line 833. BUT it returns `Ledger[]` which may not include `jurisdiction`. Two options:

- **Option A (preferred):** Update `findLedgersByOwner()` to include jurisdiction in its query and `toLedger()` mapping. The `Ledger` type in core should already have jurisdiction if the column exists.
- **Option B:** Add a `findLedgersByOwnerWithJurisdiction()` method if the Ledger type shouldn't carry jurisdiction.

Then replace the route handler body with:
```typescript
const result = await engine.findLedgersByOwner(apiKeyInfo.userId);
if (!result.ok) return errorResponse(c, result.error);
return success(c, result.value);
```

#### 9b. `DELETE /v1/ledgers/:ledgerId` — soft delete (ledgers.ts lines 174-216)

**Current:** Raw SQL `UPDATE ledgers SET status = 'deleted'` + loop to revoke API keys.

**Fix:** Create `engine.softDeleteLedger(ledgerId, userId)` in `packages/core/src/engine/index.ts`:
```typescript
async softDeleteLedger(ledgerId: string, userId: string): Promise<Result<{ id: string; status: string }>> {
  // 1. Verify ledger exists
  const ledgerResult = await this.getLedger(ledgerId);
  if (!ledgerResult.ok) return ledgerResult;

  // 2. Verify ownership
  if (ledgerResult.value.ownerId !== userId) {
    return err(createError(ErrorCode.FORBIDDEN, "User does not own this ledger"));
  }

  // 3. Check it's not the user's only ledger
  const ledgersResult = await this.findLedgersByOwner(userId);
  if (ledgersResult.ok && ledgersResult.value.length <= 1) {
    return err(createError(ErrorCode.VALIDATION_ERROR, "Cannot delete your only ledger"));
  }

  // 4. Soft-delete
  const now = new Date().toISOString();
  await this.db.run("UPDATE ledgers SET status = 'deleted', updated_at = ? WHERE id = ?", [now, ledgerId]);

  // 5. Revoke all active API keys
  const keysResult = await this.listApiKeys(ledgerId);
  if (keysResult.ok) {
    for (const key of keysResult.value) {
      if (key.status === "active") {
        await this.revokeApiKey(key.id);
      }
    }
  }

  // 6. Audit entry
  const auditId = generateId();
  await this.db.run(
    `INSERT INTO audit_entries (id, ledger_id, entity_type, entity_id, action, actor_type, actor_id, snapshot, created_at)
     VALUES (?, ?, 'ledger', ?, 'deleted', 'user', ?, ?, ?)`,
    [auditId, ledgerId, ledgerId, userId, JSON.stringify({ id: ledgerId, status: "deleted" }), now]
  );

  return ok({ id: ledgerId, status: "deleted" });
}
```

Then the DELETE route becomes:
```typescript
ledgerRoutes.delete("/:ledgerId", adminAuth, async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId");
  const body = await c.req.json().catch(() => ({})) as { userId?: string };
  const userId = body.userId ?? c.get("apiKeyInfo")?.userId;

  if (!userId) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "userId is required", details: [], requestId: c.get("requestId") } }, 400);
  }

  const result = await engine.softDeleteLedger(ledgerId, userId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});
```

#### 9c. Jurisdiction endpoints (ledgers.ts lines 218-283)

**GET /jurisdiction:** Create `engine.getLedgerJurisdiction(ledgerId)` that returns `{ jurisdiction, taxId, taxBasis, fiscalYearStart }`.

**PATCH /jurisdiction:** Create `engine.updateLedgerJurisdiction(ledgerId, updates)` that handles the dynamic SET clause.

#### 9d. invoices.ts — 16 raw SQL calls

This is the biggest offender. The repeated pattern is `SELECT ledger_id FROM invoices WHERE id = ?` for authorization checks. **Strategy:**

1. Create a helper in the engine: `getInvoiceLedgerId(invoiceId: string): Promise<string | null>` — or reuse the existing `getInvoice()` method and check `.ledgerId` on the result.

2. For each of the ~10 permission checks, replace:
   ```typescript
   const row = await db.get<{ ledger_id: string }>("SELECT ledger_id FROM invoices WHERE id = ?", [invoiceId]);
   ```
   with:
   ```typescript
   const invoice = await engine.getInvoice(ledgerId, invoiceId);
   if (!invoice.ok) return errorResponse(c, invoice.error);
   ```

3. For ledger data fetches (`SELECT name, jurisdiction FROM ledgers`), use `engine.getLedger()`.

4. For `UPDATE invoices SET sent_at = ...` and `DELETE FROM invoices`, create engine methods: `engine.markInvoiceSent()`, `engine.deleteInvoiceDraft()`.

**Priority:** Focus on the DELETE and UPDATE statements first (mutation logic in routes is worse than reads). Permission-check SELECTs are lower priority.

**Don't forget** to add the `softDeleteLedger` method signature to the engine interface/type if one exists.

---

### Fix #37: Rate Limiting Middleware

**Problem:** No HTTP request-rate-limiting. Tier enforcement limits usage counts, not request velocity.

#### Create `packages/api/src/middleware/rate-limit.ts`:

```typescript
import type { MiddlewareHandler } from "hono";
import type { Env } from "../lib/context.js";

interface RateLimitConfig {
  windowMs: number;       // Time window in milliseconds
  maxRequests: number;    // Max requests per window per key
  keyFn?: (c: any) => string; // Extract rate limit key (default: API key or IP)
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
      : c.get("apiKeyInfo")?.prefix ?? c.req.header("x-forwarded-for") ?? "anonymous";

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
```

#### Apply in `packages/api/src/app.ts`:

Add after the CORS middleware, before route mounting:
```typescript
import { rateLimit } from "./middleware/rate-limit.js";

// Apply rate limiting globally
app.use("*", rateLimit({
  windowMs: 60_000,    // 1 minute
  maxRequests: 120,    // 120 requests per minute per key
}));
```

Optionally, apply stricter limits to write endpoints:
```typescript
// Stricter limit for mutations
const writeLimiter = rateLimit({ windowMs: 60_000, maxRequests: 30 });
app.use("/v1/*/post", writeLimiter);    // transaction posting
app.use("/v1/*/create", writeLimiter);  // creation endpoints
```

#### Environment configuration:

Add to `packages/api/src/index.ts`:
```typescript
const rateLimitMax = parseInt(process.env["RATE_LIMIT_MAX"] ?? "120", 10);
const rateLimitWindowMs = parseInt(process.env["RATE_LIMIT_WINDOW_MS"] ?? "60000", 10);
```

Pass into `createApp()` or configure directly.

#### Testing:

```typescript
import { describe, it, expect } from "vitest";
// ... setup test app

it("returns 429 when rate limit exceeded", async () => {
  // Send maxRequests + 1 requests
  for (let i = 0; i < 121; i++) {
    const res = await app.request("/v1/health");
    if (i < 120) {
      expect(res.status).not.toBe(429);
    } else {
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    }
  }
});

it("sets rate limit headers", async () => {
  const res = await app.request("/v1/health");
  expect(res.headers.get("X-RateLimit-Limit")).toBe("120");
  expect(res.headers.get("X-RateLimit-Remaining")).toBeDefined();
});
```

---

## Defer (3 items — document and move on)

---

### Defer #6: Atomic Idempotency Check

**File:** `packages/core/src/engine/index.ts` ~lines 996-1020

**Current problem:** The idempotency check does SELECT then INSERT in two separate queries. There's a theoretical race condition where two concurrent requests with the same key could both pass the SELECT check and attempt to INSERT.

**Why it's safe for now:** SQLite is single-writer (serialized). The `UNIQUE(ledger_id, idempotency_key)` constraint on the transactions table catches any race at the DB level — the second INSERT would fail with a constraint violation. The risk is only an ugly error instead of a graceful idempotency return.

**Future fix (when moving to PostgreSQL multi-instance):**

Option A — Use `INSERT ... ON CONFLICT`:
```sql
INSERT INTO transactions (id, ledger_id, idempotency_key, date, memo, ...)
VALUES (?, ?, ?, ?, ?, ...)
ON CONFLICT (ledger_id, idempotency_key) DO NOTHING
RETURNING *;
```
If no row returned, SELECT the existing one.

Option B — Wrap in serializable transaction:
```typescript
await this.db.run("BEGIN");
try {
  const existing = await this.db.get("SELECT ...");
  if (existing) { await this.db.run("COMMIT"); return ok(existing); }
  await this.db.run("INSERT ...");
  await this.db.run("COMMIT");
} catch {
  await this.db.run("ROLLBACK");
  throw;
}
```

**Also missing:** The current code doesn't verify that the existing transaction's parameters (memo, lines, date) match the new request. A proper implementation should either:
- Return the existing transaction with a flag indicating it was deduplicated
- Compare inputs and return 409 Conflict if the key matches but parameters differ

**Add this TODO comment** at line ~1006:
```typescript
// TODO(#6): Atomic idempotency — use INSERT ON CONFLICT when moving to PostgreSQL.
// Also: compare input parameters against existing transaction to detect key reuse with different data.
```

---

### Defer #19: Consolidate getDb() Usage

**Scope:** ~80 `getDb()` calls across API routes, with ~46 raw SQL statements.

**Current state:** Every route handler calls `const db = engine.getDb()` and writes SQL directly. This bypasses the engine's domain logic layer.

**Why defer:** This is a large refactor touching every route file. Doing it all at once risks regressions. Instead, chip away at it incrementally:

1. Fix #9 above removes the worst offenders (ledgers.ts, invoices.ts)
2. Future PRs can tackle one route file at a time
3. Track remaining raw SQL count per file:

| Route File | Current Raw SQL | After Fix #9 |
|------------|----------------|--------------|
| invoices.ts | 16 | ~4 (reads) |
| oauth.ts | 16 | 16 (separate concern) |
| ledgers.ts | 5 | 0 |
| fixed-assets.ts | 4 | 4 |
| transactions.ts | 2 | 2 |
| stripe-connect.ts | 2 | 2 |
| usage.ts | 1 | 1 |

**End goal:** Routes should only call `engine.methodName()` — never touch `db` directly. The engine is the single source of truth for all data access.

**Add this TODO comment** in `packages/api/src/app.ts`:
```typescript
// TODO(#19): Eliminate getDb() usage in routes. All data access should go through engine methods.
// See docs/security-fixes-instructions.md for tracking table.
```

---

### Defer #32: Connection Pooling & Graceful Shutdown

**File:** `packages/api/src/index.ts` lines 59-71, 501-505

**Current state:**
- SQLite via sql.js runs in-memory, persisted to disk every 60s and on SIGTERM/SIGINT
- No explicit `db.close()` call before exit
- No error handling in the shutdown handler
- No connection pooling (N/A for SQLite — it's single-connection by design)

**Why defer:** SQLite is inherently single-connection. Connection pooling only matters for PostgreSQL multi-instance deployment, which isn't the current architecture.

**Future fix (two parts):**

#### Part 1 — Improve shutdown handler (quick, can do anytime):
```typescript
const shutdown = async () => {
  console.log("Shutting down gracefully...");
  try {
    persistDatabase(sqliteDb, dbPath);
    console.log("Database persisted successfully.");
  } catch (e) {
    console.error("Failed to persist database on shutdown:", e);
  }
  process.exit(0);
};
```

#### Part 2 — PostgreSQL connection pooling (when needed):
- Use `pg-pool` with configurable pool size
- Add `engine.close()` method to the `LedgerEngine` interface
- Call `await engine.close()` in the shutdown handler
- Add health check endpoint that verifies pool connectivity

**Add this TODO comment** in `packages/api/src/index.ts` near the shutdown handler:
```typescript
// TODO(#32): Add error handling to shutdown. When moving to PostgreSQL,
// implement connection pooling via pg-pool and call engine.close() here.
```

---

## Verification Checklist

After completing the "Fix Now" items, run:

```sh
pnpm typecheck        # All 4 packages should pass
pnpm test             # No regressions (baseline: core 421, API 105/107, MCP 43/44, SDK 33/35)
```

Specific things to verify:
- [ ] `createAccount()` produces an audit entry
- [ ] `revokeApiKey()` produces an audit entry
- [ ] `softDeleteLedger()` produces an audit entry
- [ ] No raw SQL remains in `ledgers.ts` routes
- [ ] Rate limit returns 429 with correct headers
- [ ] Rate limit headers present on all responses
- [ ] TODO comments added for deferred issues #6, #19, #32

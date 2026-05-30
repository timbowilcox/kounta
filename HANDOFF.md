# HANDOFF — Migration & Test-Integrity (Blocker Sprint, Session A)

**Branch:** `feat/migration-integrity` (cut from `main` after PR #1)
**Scope:** `SPRINT.md` — close the migration drift + test/prod divergence: one source of
truth for the migration set, an anti-drift guard, re-point all fixtures, fix the suites that
passed only via tier fail-open. **Test-only; no production-DB-affecting change was made.**
**Status:** test-only criteria met, full suite green, guard proven to catch drift. **NOT
self-certifying mergeable** — a fresh evaluator should re-verify (see Definition of Done).

## Production-safety: 028/029/030 are still NOT registered (by design)
Registering them is the one live-DB-affecting action in this sprint and is **gated on the
live Railway checks below**, which cannot be run from here. They remain in
`PENDING_MIGRATIONS` (documented, not applied). **Do not register them until the checks pass.**

### Findings (why this matters — flagged for the 028–030 reconciliation)
- **030 — HIGH, audit-integrity (core invariant "Audit everything").** `engine.revokeApiKey`
  writes audit `action='revoked'` ([engine/index.ts:1699](packages/core/src/engine/index.ts:1699))
  and `softDeleteLedger` writes `action='deleted'`
  ([engine/index.ts:1738](packages/core/src/engine/index.ts:1738)). Prod's `audit_action` is
  `{created,reversed,archived}` (001) + `updated` (002 inline) — **not `revoked`/`deleted`**
  (those come from 030, unapplied). So in prod those INSERTs throw: the key/ledger is mutated
  but **no audit entry is written and the request 500s**. The engine already worked around
  this in `writeBankTxnAudit` ([engine/index.ts:3106](packages/core/src/engine/index.ts:3106))
  but the revoke/delete paths were missed. Two tests that only passed because the *old* fixture
  hand-picked 030 are now `it.skip` with a TODO tying them to 030: api `revokes an API key`,
  sdk `revokes an API key (admin)`.
- **029 — HIGH, mounted-but-dead feature.** `/v1/bills` + `/v1/vendors` are mounted
  ([app.ts:146](packages/api/src/app.ts:146)), plus MCP tools, core engine, and tier limits all
  reference `bills`/`vendors`/`bill_line_items`/`bill_payments` and `usage_tracking.bills_count`/
  `vendors_count`. None exist in prod (029 unapplied) → any bills/vendors call fails. The tier
  fail-open does **not** save it on Postgres: the swallow regex is `/no such (table|column)/i`
  ([usage.ts:397](packages/core/src/tiers/usage.ts:397)) — SQLite phrasing; PG says
  `relation … does not exist`, so it propagates → 500.
- **028 — LOW/MED, missing defence-in-depth.** Perf indexes + an audit-immutability trigger.
  Nothing references it; its absence just means prod has no DB-level guard against UPDATE/DELETE
  on `audit_entries` and lacks the indexes. Note 028's `CREATE TRIGGER` is **not** idempotent
  (no `IF NOT EXISTS`).

### Live-DB checks I still owe before 028/029/030 can be registered
Run read-only first; do any mutation only on a **clone/branch**, never live prod:
1. **Applied state:** `SELECT name, applied_at FROM _migrations ORDER BY name;` — confirm it
   ends at 027 (and whether 031/032 are already applied from PR #1's deploy); confirm
   028/029/030 absent.
2. **028:** `SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_audit_no_update','trg_audit_no_delete');`
   must be empty (else its non-`IF NOT EXISTS` `CREATE TRIGGER` fails). Verify every
   column/table its indexes reference exists: `ledgers.owner_id`, `users.stripe_customer_id`,
   `classification_rules.auto_generated`+`rule_type`, `global_classifications.canonical_merchant`,
   `merchant_aliases.alias`, `recurring_entry_log`, `email_log`.
3. **029:** `SELECT tablename FROM pg_tables WHERE tablename IN ('vendors','bills','bill_line_items','bill_payments');`
   (expect empty; all `IF NOT EXISTS` so safe either way). Confirm `usage_tracking` exists (027).
4. **030 + runner caveat:** `SELECT enumlabel FROM pg_enum WHERE enumtypid='audit_action'::regtype ORDER BY enumsortorder;`
   → expect `{created,reversed,archived,updated}`. **030 must be runner-special-cased like
   017/020/022 before registration** — `ALTER TYPE … ADD VALUE` is unsafe inside a transaction
   block, and `PostgresDatabase.exec` sends the whole file as one `query()`. Add a per-statement
   `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'x'` branch in
   [index.ts](packages/api/src/index.ts:251); do NOT just add the file to the list.
5. **Quantify the gap:** `SELECT count(*) FROM api_keys WHERE status='revoked';` vs
   `SELECT count(*) FROM audit_entries WHERE entity_type='api_key' AND action='revoked';`
   (the latter is 0 in prod) — how many revocations already have no audit trail.
6. **Dry-run on a clone:** apply 028→029→030 in order, twice, prove clean + re-runnable; take a
   fresh backup before the deploy that registers them.

Once the checks pass: move the verified stems from `PENDING_MIGRATIONS` into
`REGISTERED_MIGRATIONS` (manifest), special-case 030 in the runner, flip the parity assertions
in `migration-parity.test.ts`, and re-enable the two skipped revoke tests.

## What's done (test-only, no prod-DB impact)
1. **Single source of truth** — `REGISTERED_MIGRATIONS` (001-027, 031, 032) + `PENDING_MIGRATIONS`
   (028/029/030) in `packages/core/src/db/migration-manifest.ts` (side-effect-free). The prod
   runner lists in `packages/api/src/migrations.ts` now **derive** from it (verified byte-for-byte
   identical to the old hardcoded lists — prod apply behaviour unchanged). `index.ts` untouched.
   CLAUDE.md note updated.
2. **Anti-drift guard** — `packages/core/tests/migration-drift.test.ts` FAILS if any migration
   file on disk is in neither REGISTERED nor PENDING (or a listed stem has no file). 028/029/030
   are explicit documented PENDING exceptions. Proven to catch drift three ways incl. a **real
   file dropped into the migrations dir** (cleaned up after).
3. **All fixtures derive from the manifest** — core `createFullTestDb` (no more `readdirSync`),
   every core unit-test fixture, api/sdk `createTestDb`, and mcp `initSqlite` (was only 001-016).
   Fixtures now match the prod schema exactly. **All `usage_tracking` fail-open warnings are
   gone.**
4. **Tier fail-open suites fixed** — api `enforces ledger scoping` now puts the owner on a plan
   that allows 2 ledgers and asserts the 2nd is created, so the 403 is real cross-ledger scoping
   (not a free-`maxLedgers=1` block on an undefined id). sdk integration account is on an
   unrestricted plan so tier checks RUN and return allowed (genuine, not fail-open). Limit-hit
   behaviour stays covered by `tier-enforcement.test.ts`.
5. **Parity assertions** — `migration-parity.test.ts` now also proves the prod schema lacks the
   PENDING effects (no bills/vendors tables/columns; audit CHECK has no 'revoked'/'deleted'),
   i.e. fixtures match prod exactly, not as a superset.

## Test status
Full suite **green**, run serially (`pnpm test --concurrency=1`): **661 passing, 8 skipped**
(core 474 · mcp 44 · api 109/7-skip · sdk 34/1-skip). `Tasks: 12 successful, 12 total`.
Typecheck **9/9 clean**. **0** `usage_tracking` fail-open warnings (was ~13 at baseline).
Baseline before this work: 655 passing / 6 skipped. Delta: +5 anti-drift guard tests, +3 parity
assertions, +2 skips (the two 030-gated revoke tests).

## Exact next step
Fresh evaluator (do NOT trust this handoff's self-assessment):
1. Confirm the anti-drift guard catches a deliberately-added unregistered migration —
   `migration-drift.test.ts` does this with a real temp file; optionally drop a `033_x.sqlite.sql`
   in `packages/core/src/db/migrations/` and confirm `pnpm --filter @kounta/core test` goes red,
   then remove it.
2. Confirm no suite passes via fail-open: `pnpm test 2>&1 | grep -i "no such table: usage_tracking\|Tier schema not ready\|mcp/tier-check"` returns nothing.
3. Confirm 028/029/030 are NOT registered and the prod lists are byte-for-byte unchanged.
Then the human owes the live-DB checks above before 028/029/030 can ship.

## Files changed
**new:** `packages/core/src/db/migration-manifest.ts`, `packages/core/tests/migration-drift.test.ts`.
**core:** `src/index.ts` (export manifest), `tests/helpers/migrate.ts`, and fixtures
`tests/{engine,classification,email,global-classification,import,recurring,revenue,stripe-revenue,stripe,templates}.test.ts`,
`src/fixed-assets/engine.test.ts`, `src/invoicing/{customers,engine}.test.ts`, `src/tiers/tiers.test.ts`.
**api:** `src/migrations.ts` (derive from manifest), `tests/{api,oauth,benchmark,fixed-assets,invoices,tier-enforcement,migration-parity}.test.ts`.
**mcp:** `src/lib/db.ts` (initSqlite from manifest).
**sdk:** `tests/sdk.test.ts`.
**docs:** `CLAUDE.md`.
Commits on `feat/migration-integrity`: `66c354b` manifest single source of truth ·
`20ea930` anti-drift guard · `9da6a32` re-point fixtures + tier fail-open fixes + parity · this HANDOFF.

## Out of scope (untouched, per SPRINT)
Registering 028/029/030; the engine revoke/delete audit-write fix; bills/vendors schema; token
encryption; Basiq webhook signature; transaction audit-snapshot completeness (Session B).

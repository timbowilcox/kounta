# EVALUATION-4 — Migration & Test-Integrity sprint (adversarial QA)

> Written as `EVALUATION-4.md` (not overwriting the tracked `EVALUATION.md` / `-2` / `-3`,
> which document the earlier PR #1 bank-ingestion sprint — this repo versions evaluations).

**Branch:** `feat/migration-integrity` @ `9c7ba8b`
**Evaluator stance:** skeptical/adversarial; every claim independently re-derived, not trusted.
**Verdict: MERGEABLE.** All 7 audit items independently verified solid. Four minor
observations (none blocking) are listed at the end.

## Suite (independent, forced, serial)
`pnpm test --force --concurrency=1` → `Cached: 0 cached, 12 total` (genuinely re-executed, not
replayed): **core 474 · mcp 44 · api 109 (7 skipped) · sdk 34 (1 skipped) = 661 passing,
8 skipped, Tasks 12/12.** `grep` for `no such table: usage_tracking` / `Tier schema not ready`
/ `mcp/tier-check` = **0**. Matches the build session's claim exactly.

---

## 1. Byte-for-byte prod-list equality — CONFIRMED SOLID (highest priority)
Reconstructed the OLD hardcoded lists from the pre-refactor commit `5e5db87` (parent of the
first manifest commit; note `main` is stale — see Obs. 2) and diffed against what the new
manifest derives (`registeredPgMigrationFiles()` / `registeredSqliteMigrationFiles()`):
- PG: **identical, membership AND order**, 29 entries.
- SQLite: **identical, membership AND order**, 29 entries.
- `002_audit_action_updated.sql` (PG-virtual, file-less) present in NEW PG list. ✓
- 028/029/030 absent from both NEW lists. ✓
- `git diff 5e5db87 HEAD -- packages/api/src/index.ts` is **empty** — the runner is
  byte-unchanged.

Conclusion: prod migration behaviour does NOT change on next deploy. The "test-only" safety
claim holds at the byte level.

## 2. Anti-drift guard, both directions — CONFIRMED SOLID
Independently exercised against the live tree:
- **(a) unregistered file:** dropped `044_eval_unregistered.sqlite.sql` into the migrations dir
  → guard RED, `unregisteredSqlite: ["044_eval_unregistered.sqlite.sql"]`. Removed → 5 passed,
  clean tree.
- **(b) phantom registered stem:** added `"099_phantom_registered"` to `REGISTERED_MIGRATIONS`
  → guard RED, `missingSqlite`/`missingPg` both list it. Reverted clean.
- `PENDING` is pinned by a dedicated test to exactly `{028,029,030}`; a brand-new file is NOT
  silently tolerated (proven by (a)). The guard fails CI in both directions.

## 3. Core fixture inversion risk — CONFIRMED SOLID
The OLD core fixture used `readdirSync` (verified at `5e5db87:.../helpers/migrate.ts`), so it
DID load 028/029/030; the new fixture excludes them. Verified no core test depended on the lost
schema:
- `grep` core tests for 028 (trigger/append-only/UPDATE|DELETE audit_entries), 029
  (bills/vendors), 030 (revoked/deleted/revokeApiKey/softDeleteLedger): **none** (the only 030
  hit is the literal string inside the drift guard's PENDING assertion).
- Per-file it/skip/expect counts pre-refactor vs now: every pre-existing core file is
  **unchanged**; totals `it 469→474` (+5 = the new guard file only), `skip 0→0`,
  `expect 1274→1284` (+10 = the guard file only). Nothing masked, nothing weakened. The 469 is
  genuine.

## 4. Skip audit — CONFIRMED SOLID (not green-washing)
Baseline 6 skipped → now 8. The +2 are EXACTLY:
- `api.test.ts > revokes an API key` (`it.skip`, TODO references migration 030 + manifest +
  HANDOFF)
- `sdk.test.ts > revokes an API key (admin)` (`it.skip`, same TODO)
The other skips (`api includes snapshots in audit entries`, `benchmark Performance benchmark`,
`oauth lists active connections`) are pre-existing from `d60f330` — unchanged. No assertions
were deleted anywhere: `expect` deltas are api `+1` (scoping guard), migration-parity `+6`
(new assertions), sdk `0`, mcp `0`. These two skips document a REAL pre-existing prod bug that
the OLD fixture was *masking* (it hand-picked 030); skipping is the honest choice given the fix
is out of scope/gated, not a regression hidden to reach green.

## 5. Tier enforcement genuinely exercised — CONFIRMED SOLID
- **Scoping test tests the right thing:** temporarily neutered the scope check
  (`auth.ts:76` → `if (false && …)`) → `enforces ledger scoping` went RED
  (`AssertionError: expected 200 to be 403`). Reverted → green. So the 403 is a real
  cross-ledger-scoping rejection, and the test now creates 2 ledgers (asserts `ledger2.id`
  exists) under a sufficient tier.
- **usage_tracking-backed enforcement is real:** `tier-enforcement.test.ts` seeds
  `usage_tracking.transactions_count` at the cap and asserts a `429 PLAN_LIMIT_EXCEEDED` on the
  next POST (plus 2nd/4th-ledger 403s and feature-gate 403s) — against the present (027) schema.
- **sdk plan change is not masking fail-open:** reverting the sdk user to free made the suite
  RED with `Ledger limit reached (1/1)` — enforcement is live; the `platform` plan simply makes
  the (genuinely-running) checks return allowed. Zero fail-open warnings in the forced run.

## 6. Scope adherence — CONFIRMED SOLID
`git diff 5e5db87 HEAD --stat`: changes limited to the manifest (new), `api/src/migrations.ts`,
`core/src/index.ts` (export), the fixtures (core/api/sdk tests + `mcp/src/lib/db.ts` +
`tests/helpers/migrate.ts`), the guard test (new), the 2 skips, the parity assertions
(`migration-parity.test.ts`), the CLAUDE.md note, and HANDOFF.md. Targeted diff over
`engine/`, `api/src/index.ts`, `crypto/`, `bank-feeds/`, `audit*` = **empty**: the engine
revoke/delete paths, the runner, token encryption, and the Basiq webhook are all untouched.
028/029/030 are NOT registered. Working tree carries only a pre-existing, uncommitted `SPRINT.md`
edit (present at session start; not part of the branch commits).

## 7. HIGH findings accurately characterised — CONFIRMED
- **030 (revoke/delete audit bug):** engine writes `action='revoked'` ([index.ts:1699](packages/core/src/engine/index.ts:1699))
  and `action='deleted'` ([index.ts:1738](packages/core/src/engine/index.ts:1738)); the runner's
  002 special-case adds only `'updated'` to the PG enum ([index.ts:344](packages/api/src/index.ts:344));
  001 SQLite CHECK is `('created','reversed','archived')`. The api revoke test's actual failure
  (`CHECK constraint failed: action IN ('created','reversed','archived','updated')`)
  independently proves prod rejects `'revoked'`. Accurate.
- **029 (mounted-but-dead):** `/v1/bills` + `/v1/vendors` mounted ([app.ts:146](packages/api/src/app.ts:146));
  029 absent from the prod lists (parity test confirms tables absent on the prod schema). The
  fail-open swallow regex is `/no such (table|column)/i` ([usage.ts:397](packages/core/src/tiers/usage.ts:397))
  — SQLite phrasing only, so on PG (`relation … does not exist`) it does NOT fail open → 500.
  Accurate.

The live-DB check list in HANDOFF.md can be trusted.

---

## Rubric (Kounta: standard 8 + fail-closed + test/prod migration parity)
| Dimension | Score | Evidence |
|---|---|---|
| Correctness | PASS | Prod lists byte-identical; index.ts unchanged; suite green forced/serial. |
| Test coverage (hard blocker) | PASS | +5 guard tests + 3 parity assertions; no test weakened; guard proven both directions. |
| Auth (hard blocker) | PASS | Ledger-scoping test proven to fail when scope check is broken; auth middleware untouched. |
| Fail-closed (hard blocker) | PASS | usage_tracking present everywhere → 0 fail-open; tier limits genuinely enforced (429/403 verified); sdk-free revert fires real limit. |
| Test/prod parity (hard blocker, now first-class) | PASS | One manifest; anti-drift guard (both directions) + schema-level parity assertions prove fixtures == prod, not a superset; no other list/readdirSync remains. |
| Error handling | PASS | Guard emits actionable drift detail; parity assertions documented. |
| Maintainability | PASS | Single source of truth; CLAUDE.md updated to the new location. |
| Security/immutability | NOTE | 028 audit-immutability trigger remains unshipped in prod (pre-existing; correctly flagged as a PENDING/live-DB item, not introduced or regressed here). |
| Docs/handoff | PASS | HANDOFF accurate; live-DB checks specific and correct. |

**Hard blockers (test-coverage, auth, fail-closed, test/prod parity): all PASS.**

## Observations (non-blocking)
- **Obs. 1 — "test-only" is slightly imprecise.** `packages/mcp/src/lib/db.ts` is *runtime*
  code (local SQLite/stdio dev path), not a test file; it now applies the full registered set
  (was 001–016). This is the necessary way to re-point the MCP test fixture and is strictly an
  improvement, with **no production-DB impact** (prod MCP uses Postgres via `initPostgres`,
  which does not run these migrations). Recommend the HANDOFF say "no production-DB-affecting
  change" (true) rather than "test-only" (loose). mcp tests pass (44), so the full set applies
  cleanly there.
- **Obs. 2 — local `main` ref is stale.** `merge-base(main, HEAD) = d60f330`; `main` does not
  contain PR #1 (`5e5db87`), so `git diff main...HEAD` over-reports (bundles PR #1). The true
  base for this work is `5e5db87`. Re-run the scope diff against the updated main before merge.
- **Obs. 3 — a third hardcoded migration-name list exists, uncovered by the guard.** The PG
  back-fill probe table in `packages/api/src/index.ts` (anchor-probes 001–027) is a separate
  hardcoded list that does NOT derive from the manifest and is NOT checked by the anti-drift
  guard. It is pre-existing, byte-unchanged, and only used to back-fill `_migrations` on legacy
  DBs (not to apply migrations), so it is low severity — but a future ticket should either
  derive it from the manifest or extend the guard to cover it. (It also stops at 027, i.e. does
  not back-fill 031/032 — pre-existing.)
- **Obs. 4 — the two revoke skips hide a real, live prod bug from CI.** Appropriately
  documented + gated, but worth emphasising: API-key revocation and ledger soft-delete currently
  fail to write their audit entry in production. Prioritise the 030 live-DB checks + engine fix;
  do not let the green suite imply this path works.

## Bottom line
All 7 items independently verified. The refactor is genuinely behaviour-preserving for prod, the
guard is real and bidirectional, no coverage was lost or skipped to fake green, tier enforcement
is genuinely exercised, and scope is clean. **Mergeable**, subject to the human running the
live-Railway-DB checks in HANDOFF.md before any future registration of 028/029/030 (explicitly
out of scope here) and noting Obs. 1–4.

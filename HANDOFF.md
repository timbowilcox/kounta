# HANDOFF — Bank Ingestion: B1/B2/B3 fix session (PR #1)

**Branch:** `feat/bank-ingestion-mock-plaid-csv`
**Scope:** `SPRINT.md` (fix the three blockers in `EVALUATION.md`).
**Status:** all three blockers fixed, red→green. **Ready for a fresh evaluator pass** — I am NOT self-certifying mergeable (per DoD, a separate evaluator session re-verifies B1/B2/B3 before merge).

## Test status

Forced full run: **645 passing** (core 463 + api 103 + mcp 44 + sdk 35), 6 skipped — up from the 636 baseline (+9 new regression tests), **no regressions**. Typecheck clean across 9 packages; no new `any`/`ts-ignore`.

The `usage_tracking` "no such table" warnings still print from the api/mcp/sdk fixtures — that's the pre-existing tier fail-open in *those* fixtures, **explicitly out of scope** for this sprint (handed to the blocker sprint).

## What's fixed (with red→green evidence)

### B1 — migration 031 registered in the production runner
Root cause: `packages/api/src/index.ts` applies a **hardcoded** migration list, not a directory scan; the lists stopped at `027`, so `031` never shipped — and since this sprint made `upsertBankTransactions` write `line_fingerprint`, existing Basiq sync would throw in prod.
- Added `031` to **both** `pgMigrations` and `SQLITE_MIGRATION_FILES` (after `027`). 031 depends only on `001`/`004`, so it applies cleanly with `028–030` still absent.
- Hoisted `SQLITE_MIGRATION_FILES` to a module export so the regression test consumes the **real production list**, never `readdirSync`.
- Red→green: `packages/api/tests/migration-parity.test.ts` — builds a DB from the production list; before: `table bank_transactions has no column named line_fingerprint`; after: `upsertBankTransactions` (a Basiq-provider connection) succeeds and `mapping_profiles` exists.

### B2 — escalate-when-uncertain dedup (money correctness)
Root cause: a single fingerprint-set hard-skip — simultaneously over-collapsing genuine duplicates and double-counting the same txn described differently across channels.
- **Same-source (manual vs prior manual): occurrence-aware.** The Nth identical row is a duplicate only if N identical rows already exist from this source; provider id is now `fingerprint#occurrence`. Genuine same-day duplicates persist; re-import adds zero.
- **Cross-source exact** (date+amount+description) → `duplicate` (auto-skip).
- **Cross-source loose** (date+amount, different description) → `possible_duplicate`: **held by default** and surfaced in the preview; importable only via an explicit per-row decision. Never auto-merged, never silently double-counted.
- Provenance: each row's decision + reason recorded in `rawData._dedup`; preview exposes `dedupStatus`/`dedupReason`/`dedupKey`; commit takes `decisions` and reports `possibleDuplicates`.
- UI: dashboard shows New / Duplicate / **Possible duplicate + "import anyway"** with a held-by-default explanation; verified in the browser preview (ticking the toggle moves the button "Import 1 row" → "Import 2 rows").
- Red→green: `packages/core/tests/csv-dedup-edge.test.ts` — two coffees both stored; re-import adds zero; a third later coffee is recordable; OFFICEWORKS-0123 vs OFFICEWORKS-0123-SYDNEY stays exactly one (count-asserted). The prior test that had encoded the over-collapse bug was corrected.

### B3 — removed-sync audit integrity
Root cause: `removed` flipped matched/posted rows to `ignored` with no audit, and hard-deleted pending rows with no trace.
- `removeBankTransactions` now: **pending** → delete **with** an audit entry; **matched/posted** → status left **unchanged** (guarded), audit entry written, counted as `flaggedForReview`. The immutable ledger is never touched.
- Audit actions limited to `archived`/`updated` — the only removal-ish actions the **production** audit CHECK allows (001+002); `deleted`/`revoked` come from `030`, which prod doesn't apply.
- Red→green: `packages/core/tests/removed-sync-audit.test.ts` — matched row stays `matched` and the change is audited; pending row deleted but audited.

### Recurrence prevention (in-sprint)
- `CLAUDE.md` now documents that production registers migrations via the hardcoded lists in `index.ts`, and that a green `readdirSync` suite is **not** proof a migration ships.
- The "Test/prod migration parity" rubric criterion is in `SPRINT.md`.

## Commits (this session)
`6df0363` B1 register 031 · `ff11caa` B3 audit+guard removed · `4afdcbd` B2 core dedup · `e0d153b` B2 surface (SDK/API/UI) · docs commit (CLAUDE.md/SPRINT.md/HANDOFF).

## Files changed
- `packages/api/src/index.ts` (register 031 + export list), `packages/api/src/routes/imports.ts` (decisions), `packages/api/tests/migration-parity.test.ts` (new).
- `packages/core/src/engine/index.ts` (dedup context/classifier, preview/commit, removeBankTransactions audit+guard), `packages/core/src/bank-feeds/normalize.ts` (+index.ts) (looseKey), `packages/core/src/import/csv-mapping.ts` (+index.ts) (dedup types).
- `packages/core/tests/{csv-dedup-edge,removed-sync-audit}.test.ts` (new), `csv-import-dedup.test.ts` (corrected).
- `packages/sdk/src/index.ts` (decisions + types), `packages/dashboard/src/lib/actions.ts` + `.../bank-feeds/csv-import.tsx` (3-state UI + decisions).
- `CLAUDE.md` (migration-list note), `SPRINT.md` (this session's scope).

## NOT done — deliberately out of scope (→ security/integrity blocker sprint)
1. **Single-source migration mechanism + anti-drift guard** (the systemic fix behind B1). I registered `031` only.
2. **`028`/`029`/`030` are still unregistered** in the prod runner. They must be verified safe/idempotent against EXISTING production databases before registering — not blindly swept in with 031. (Note: `030` would add `revoked`/`deleted` audit actions; until it's applied, prod audit writes must avoid those — which is why B3 uses `archived`/`updated`.)
3. **api/mcp/sdk test fixtures still hand-pick migrations** (tier fail-open in those suites). Re-pointing them + fixing the setups they break is the blocker sprint.
4. Token-encryption fail-closed, Basiq webhook signature, transaction audit-snapshot completeness; live Plaid client; classification/algorithm changes; OFX/QIF/MT940.

## Exact next step
Run a **fresh evaluator pass** that independently re-verifies B1/B2/B3 (rebuild from the production migration list for B1; the two dedup scenarios with count assertions for B2; the removed-on-matched scenario for B3). If it confirms green, PR #1 is mergeable. The blocker-sprint items above are tracked separately and are not gating this PR's specific three blockers.

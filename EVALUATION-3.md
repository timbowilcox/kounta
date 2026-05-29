# Adversarial QA Round 3 — Re-verification of the items 4/5/6 fix-pass (PR #1)

**Reviewer stance:** skeptical senior engineer; verified by independent execution, not by trusting the fix's tests.
**Date:** 2026-05-30
**Verdict: PASS — no blocking findings.** Items 4, 5, and 6 are genuinely fixed and hold up under attack on the new surfaces. The originals (B1/B2/B3) do not regress. Two minor, non-blocking follow-ups noted. The branch is in mergeable shape pending the owner's call on those.

---

## Baseline (independently re-run, forced, no cache)
core 469 + api 107 (+6 skipped) + mcp 44 + sdk 35 = **655 passing**, `12 successful, 12 total`, exit 0. No regressions. (Ran fast and clean — confirming the transient 3-failure seen mid-fix-session was preview-server contention tripping the 5s test timeout, not a logic fault.)

---

## Re-verify items 4/5/6 (independent probes)

### Item 4 — cross-source date tolerance — CONFIRMED-SOLID (bounded)
`classifyDedup` flags `possible_duplicate` when a feed row shares the signed amount within ±5 days ([`engine/index.ts` `dedupContextForLedgerAccount`/`classifyDedup`](packages/core/src/engine/index.ts); `CROSS_SOURCE_DATE_TOLERANCE_DAYS = 5`). Verified:
```
[bound] +5d dedupStatus= possible_duplicate   → 89.95-debit rows = 1 (held, not double-counted)
[bound] +6d dedupStatus= new                  → 89.95-debit rows = 2 (double-counted)
```
The original off-by-one (1 day) double-count is fixed. **Residual edge (by design):** the same transaction drifting >5 days from the feed is treated as distinct and double-counts. This is the agreed tolerance margin (Plaid pending→posted drift >5 days is rare); it is bounded and the over-flag cost is cheap because candidates are resolvable. Not a blocker — documented limitation.

### Item 5 — resolvable held candidates + dedup-bypass — CONFIRMED-SOLID
Held candidates persist to `review_items` (migration 032) and never touch `bank_transactions` until resolved. The critical required addition — resolve→import must bypass the dedup classifier — is robust:
```
[bypass] afterImport=1  reimport.imported=0  reimport.possibleDuplicates=0  afterReimport=1  open=0
```
Importing stages exactly once; re-importing the same file adds nothing and raises **no new review item** (the staged row is now an occurrence-aware same-source `duplicate`, short-circuiting before the feed check). No re-flag/re-hold loop. `dismiss` closes without staging; `createReviewItem` is idempotent per `(ledger,type,ref_key)`.

### Item 6 — escalation surfaced + ledger-safe — CONFIRMED-SOLID
A removed-on-matched event raises a `removed_reconciled_txn` review item (plus the audit entry), `syncBankAccount` no longer discards `flaggedForReview`, and `acknowledge` closes it with the bank transaction still `matched` and the ledger transaction still `posted`. (Covered by the fix's regression test, which passed in the independent full run.)

### Dismiss durability — CONFIRMED-SOLID (one minor note)
```
[dismiss] re-import: open=0  dismissed=1  bunnings stored=0
```
A dismissed candidate stays dismissed on re-import (idempotent skip), is not staged, and does not clutter the open queue. **Minor follow-up:** there is no in-product "un-dismiss / import-from-dismissed" action — a candidate dismissed by mistake is recoverable only by listing `dismissed` items (the API supports the filter) but cannot be re-imported through the queue. Data is not lost (the source CSV and the dismissed record both persist). Non-blocking.

---

## Re-verify originals (no regression)
B1/B2/B3 regression tests (`migration-parity`, `csv-dedup-edge`, `csv-import-dedup`, `channel-equivalence`, `removed-sync-audit`) all passed in the independent forced run. B1 specifically: the production-list build (now from the side-effect-free `migrations.ts`) still yields `mapping_profiles` + `review_items` and a working `upsertBankTransactions`.

## New-regression check — the migration-module extraction
The fix-pass extracted the prod lists to `packages/api/src/migrations.ts` to stop tests booting the server (EADDRINUSE). Verified: **no test imports `src/index.js`**; 031 and 032 are present in **both** `PG_MIGRATIONS` and `SQLITE_MIGRATION_FILES`; the api run is clean (no unhandled errors). Good fix — and it caught a self-introduced regression before it shipped.

## Scope check — CONFIRMED-SOLID
`git diff 297845d..HEAD` touches only in-scope files. **Not touched:** migrations `028/029/030`, `crypto/tokens.ts`, `bank-feeds/basiq.ts`, `api/tests/{api,tier-enforcement,oauth}.test.ts`, mcp/sdk fixtures, the systemic migration mechanism. The `usage_tracking` console noise in api/mcp/sdk remains (pre-existing fail-open in those fixtures) — out of scope, not failing the run.

---

## Rubric (8 + fail-closed + test/prod parity)
1. **Test coverage** (hard) — SOLID. 655; items 4/5/6 + originals + a real-stack E2E.
2. **Auth** (hard) — SOLID. review-items routes ledger-scoped; cross-ledger key → 403 (E2E).
3. **Package boundaries** — SOLID. Review/dedup logic in core; dashboard renders + calls; `migrations.ts` side-effect-free.
4. **Env / secrets** — SOLID. None added.
5. **Stripe** — SOLID. Untouched.
6. **Bank feeds — idempotent; errors surface** (hard) — SOLID (bounded). Cross-source double-count fixed within ±5 days; >5-day drift is the documented edge.
7. **MCP contract** — SOLID. Unchanged; 44/44.
8. **TypeScript** — SOLID. Typecheck 9/9; no new `any`.
9. **Fail-closed** (hard) — SOLID. Held candidates resolvable (not dropped); guarded rows surfaced + resolvable; resolve→import bypasses dedup (no loop). Minor: no un-dismiss path.
10. **Test/prod migration parity** (NEW) — SOLID. `migration-parity` builds 031+032 from the production list; lists isolated in a side-effect-free module.

**10/10 solid**, with two minor non-blocking follow-ups (>±5-day double-count by design; no un-dismiss action).

---

## Conclusion
The three commissioned items (4/5/6) are independently verified fixed; the dedup-bypass, date-tolerance, review-queue persistence, and escalation surfacing all hold under attack; the originals do not regress; scope is clean; and the fix-pass even caught and resolved a self-introduced EADDRINUSE regression. No blocking findings. Recommend merge once the owner has noted the two minor follow-ups (consider a wider/parameterised tolerance or amount-band review for >5-day drift, and an un-dismiss/import-from-dismissed action) — both are safe to defer.

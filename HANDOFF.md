# HANDOFF — Bank Ingestion: items 4/5/6 fix-pass (PR #1)

**Branch:** `feat/bank-ingestion-mock-plaid-csv`
**Scope:** `SPRINT.md` — fix the three items in `EVALUATION-2.md` (date tolerance, resolvable held candidates, escalation visibility).
**Status:** all three fixed, red→green. **Ready for a fresh evaluator pass** — I am NOT self-certifying mergeable (a separate evaluator re-verifies 4/5/6).

## Test status
Forced full suite (preview server stopped): **655 passing** (core 469 + api 107 + mcp 44 + sdk 35), 6 skipped — up from 645 (+10 new regression/E2E tests), `Tasks: 12 successful, 12 total`. Typecheck clean (9/9); no new `any`.

Flakiness note: under a heavily-loaded *forced parallel* run with a dev server also running, a few core tests can trip vitest's 5s timeout (import times balloon to ~300s+). With the preview server stopped the forced suite is green; core-alone is deterministically 469. Not a logic issue — but an evaluator on a loaded machine should run packages serially or close other servers.

## What's fixed (red→green)

### Item 4 — cross-source date tolerance (no double-count on a date shift)
`dedupContextForLedgerAccount` now keys feed rows by signed-amount → dates; `classifyDedup` flags `possible_duplicate` when a feed row shares the amount within **±5 calendar days** (covers Plaid pending→posted/settlement drift incl. long weekends). Exact same-day+amount+description stays an auto `duplicate`; tolerance only widens the *candidate* flag. A one-day shift is now held for review instead of imported as a new row.
- Evidence: `core/tests/dedup-review-queue.test.ts` "item 4" — off-by-one same-merchant import → `possible_duplicate`, the 89.95 debit exists exactly once (was 2).

### Item 5 — held candidates are persisted and resolvable
New ledger-scoped `review_items` table (migration **032**). A held `possible_duplicate` (and only held — never written to `bank_transactions` until resolved) is recorded as a `possible_duplicate_import` review item, idempotent per `(ledger, type, ref_key)` so re-import doesn't pile up. `resolveReviewItem(import)` stages the confirmed candidate **directly** (it **bypasses the dedup classifier** — required so a confirmed row can't re-flag/re-hold in a loop) and runs only classify/match; `dismiss` closes it.
- Evidence: same test file — held candidate creates an open review item; resolve→import stages exactly once and leaves the queue empty (no re-flag loop); resolve→dismiss stages nothing; re-import is idempotent. Plus the API E2E below.

### Item 6 — escalation surfaced into the same queue
`removeBankTransactions` matched/posted guard now raises a `removed_reconciled_txn` review item (in addition to the audit entry), and `syncBankAccount` no longer discards `flaggedForReview` (logs it; the durable surface is the queue). The guarded bank transaction and the immutable ledger are untouched.
- Evidence: same test file — removed-on-matched raises an open review item; acknowledge closes it with the bank txn still `matched` and the ledger txn still `posted`.

### Surface + real-stack E2E (not a stub)
API `GET /v1/ledgers/:id/review-items[?status]` + `POST .../review-items/:id/resolve` (ledger-scoped under `apiKeyAuth`); SDK `reviewItems.list/resolve`; dashboard `ReviewQueue` panel on `/bank-feeds`. `api/tests/review-queue-e2e.test.ts` drives the **real HTTP stack on the production migration schema**: seed → mock feed sync → commit holds a candidate → it appears in the queue → resolve(import) stages it / dismiss closes it; cross-ledger key → 403.

## Migration discipline (did not re-break B1)
032 registered in **both** production lists. Those lists now live in `packages/api/src/migrations.ts` (`PG_MIGRATIONS`, `SQLITE_MIGRATION_FILES`) — a **side-effect-free** module, so tests import the real production list without loading `index.ts` (whose body boots the server; importing it from two test files caused an EADDRINUSE that failed the api run — now fixed). `migration-parity.test.ts` builds from that production list and asserts `review_items` exists. CLAUDE.md note updated to the new location.

## Commits (this session)
`e463297` items 4/5/6 core + migration 032 · `39a6104` review-queue API/SDK/dashboard + E2E · `5c56448` move migration lists to a side-effect-free module (fix EADDRINUSE) · this HANDOFF.

## Files changed
core: `engine/index.ts` (date tolerance, held→review, removed→review, review CRUD with dedup-bypass import), `types/index.ts` (ReviewItem), `errors/index.ts` (REVIEW_ITEM_NOT_FOUND), `db/migrations/032_review_items.{sql,sqlite.sql}`, `tests/dedup-review-queue.test.ts`. api: `migrations.ts` (new), `index.ts`, `routes/review-items.ts` (new), `app.ts`, `tests/{migration-parity,review-queue-e2e}.test.ts`. sdk: `index.ts`. dashboard: `bank-feeds/{review-queue.tsx,page.tsx}`, `lib/actions.ts`. `CLAUDE.md`.

## NOT done — out of scope (→ security/integrity blocker sprint)
`028/029/030` still unregistered; the systemic single-source migration mechanism / anti-drift guard; re-pointing the api/mcp/sdk fixtures (the `usage_tracking` fail-open console noise is theirs — pre-existing, not failing the run); token-encryption fail-closed; Basiq webhook signature; transaction audit-snapshot completeness; live Plaid client.

## Exact next step
Fresh evaluator pass re-verifying items 4/5/6: off-by-one no longer double-counts; a held candidate is persisted to `review_items` and resolvable (import bypasses dedup, no loop); removed-on-matched raises a resolvable review item — plus the real-stack E2E (`review-queue-e2e.test.ts`). If green, PR #1's commissioned blockers are all resolved. Run packages serially / with no dev server up to avoid the forced-parallel timeout flakiness.

# Adversarial QA — Bank Ingestion Sprint (PR #1, `feat/bank-ingestion-mock-plaid-csv`)

**Reviewer stance:** skeptical senior engineer; nothing accepted without independent execution.
**Date:** 2026-05-29
**Verdict: NOT MERGEABLE.** 3 blockers (1 ship-blocking regression, 1 money-correctness, 1 audit-integrity).

---

## Baseline (independently re-run, forced, no cache)

456 core + 101 api + 44 mcp + 35 sdk = **636 passing**, 6 skipped, exit 0. Matches the claim; no regressions in the suite. **But the suite is green and still ships a production-breaking bug (B1) — see below.** Green ≠ correct.

---

## BLOCKERS

### B1 — Migration `031` is NOT registered in the production migration runner (ship-blocker + regression to existing bank sync)

Production applies migrations from **hardcoded lists** in [`packages/api/src/index.ts`](packages/api/src/index.ts), not a directory scan:
- `pgMigrations` (line 325) ends at `027_tier_usage_tracking.sql` (line 352).
- `migrationFiles` (SQLite, line 467) ends at `027_tier_usage_tracking.sqlite.sql` (line 494).

`031_csv_import` appears **nowhere** in production source (`grep -rn 031 packages/api/src packages/core/src` excluding tests → 0 hits). The sprint's "full-migration" *test* fixture (`tests/helpers/migrate.ts`) uses `readdirSync`, so it loads `031` and every test passes — **the test harness diverged from the prod runner and hid this completely.**

Consequence — proved against the exact production migration set (001–027 only):
```
[2b] upsert on prod schema threw: table bank_transactions has no column named line_fingerprint
[2b] mapping_profiles present on prod schema: false
```
This sprint modified `engine.upsertBankTransactions` to write `line_fingerprint` (a column added by 031). In production that column does not exist, so **every bank-feed upsert throws — including existing Basiq sync.** This is not just "the new feature is absent"; it is a **regression that breaks already-shipped functionality** the moment this branch deploys. `mapping_profiles` and `bank_accounts.sync_cursor` are likewise absent → CSV import and cursor sync also throw.

**Fix:** register `031` (and address P1 below) in BOTH lists in `api/src/index.ts`; add a test that asserts every `migrations/*.sqlite.sql` file is present in the runner list (or make the runner readdir-based) so the fixture and prod can never drift again.

### B2 — Cross-channel dedup is wrong in BOTH directions (money correctness; SPRINT calls this a correctness requirement)

Fingerprint = `date | signed-amount | normalizeDescription(desc)` ([`normalize.ts:61-83`](packages/core/src/bank-feeds/normalize.ts)). `normalizeDescription` only lowercases + collapses non-alphanumerics. Dedup is exact-on-normalised-description. Proved both failure modes:

**(a) False positive → silent data loss.** Two genuinely distinct identical transactions collapse to one:
```
[1a-onefile] imported=1 duplicates=1 stored=1     # two real $4.50 coffees, same café, same day → one survives
[1a-second]  imported=0 duplicates=1 stored=1     # a later, legitimately-distinct identical coffee can NEVER be recorded
```
A business that buys two identical coffees in a day **cannot represent that via CSV** — the second is silently dropped, understating expenses. The generator's own test "dedups within a single file (two identical rows)" asserts this loss as *correct* behaviour.

**(b) False negative → double count.** The same real transaction described differently across channels is NOT deduped:
```
[1b] beforeCsv=6  csv.imported=1  csv.duplicates=0  afterCsv=7   # Plaid "OFFICEWORKS 0123" vs CSV "OFFICEWORKS 0123 SYDNEY AU"
[1b-control] imported=0 duplicates=1                              # identical strings DO dedup
```
Plaid enriches/cleans merchant names, so cross-channel descriptions routinely differ. The PR/HANDOFF claim "a manual CSV row overlapping a synced Plaid transaction is suppressed" holds **only when the description strings match exactly after normalisation** — a narrow happy path. Case/whitespace/punctuation are canonicalised; merchant-suffix/location/card differences are not.

**Fix:** dedup must distinguish "re-import of the same row" from "two genuinely distinct identical rows" (e.g. occurrence-indexed fingerprints, or surface suspected duplicates in the preview for explicit user decision rather than auto-suppressing). For the false-negative, either strengthen matching (amount+date+fuzzy description with a review step) or **honestly document** that cross-channel dedup requires matching descriptions — do not claim general cross-channel dedup.

### B3 — `removed` sync path silently mutates/deletes reconciled bank data with no audit entry

[`engine.removeBankTransactions`](packages/core/src/engine/index.ts): pending rows `DELETE`d; non-pending (matched/posted) flipped to `status='ignored'`. Proved:
```
[4]         matched bt status after removed = ignored | ledger txn still posted = posted | audit entries before/after = 3 / 3
[4-pending] row still exists = false | audit before/after = 1 / 1
```
Good news: the immutable double-entry ledger is **not** touched (the posted transaction survives — books stay balanced). But:
- A **matched/reconciled** staging row is silently flipped to `ignored` with **no audit entry** — violates the CLAUDE.md invariant "Audit everything: every mutation … gets an append-only audit entry."
- A pending row is **hard-deleted with no trace.**
- There is **no guard** preventing a `matched`/`posted` row from being removed.

The shipped mock only ever `removes` a pending row (txnB), so this is latent until the live Plaid client — but the engine code is shipped and wrong.

**Fix:** write an audit entry for every removal/ignore; refuse (or require explicit, audited handling) to remove a row already reconciled/posted; never hard-delete without a trace.

---

## PRE-EXISTING (not introduced by this sprint, but compounds B1 and must be known)

### P1 — Migrations `028`, `029`, `030` are also absent from the production runner lists
Both lists in `api/src/index.ts` stop at `027`. `028_sql_review_fixes`, `029_bills`, `030_audit_action_revoked_deleted` are never applied in prod. Notably `030` extends the `audit_entries.action` CHECK to allow `revoked`/`deleted`; without it, audit inserts using those actions would fail in production. Root cause is the same hardcoded-list drift as B1. The B1 fix should sweep these in and add the anti-drift guard.

---

## Item-by-item (as requested)

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1a | Dedup false-positive / silent loss | **BROKEN** | `[1a-*]` above; two identical coffees → one stored |
| 1b | Dedup false-negative / double count | **BROKEN** | `[1b]` 6→7; description divergence defeats dedup |
| 2 | Tier fail-open | **NUANCED — see below** | tier-enforcement.test.ts 8/8 (loads 027); api.test.ts breaks under full migrations |
| 3 | Real-stack E2E (not stub) | **CONFIRMED at API level; gap above it** | HTTP E2E passed; browser→action→SDK still unverified |
| 4 | `removed` on matched/posted | **NEEDS-FIX** | `[4]`,`[4-pending]`; silent mutation/delete, no audit |
| 5 | DI seam fail-closed | **CONFIRMED-SOLID (minor note)** | only caller `page.tsx:45` passes no `api`; no override exists |

**Item 2 detail.** Tier enforcement IS genuinely tested — `tier-enforcement.test.ts` loads `027` and passes 8/8 with real `usage_tracking`. The fail-open warnings come from *other* suites whose fixtures omit `027`. I retrofitted `api.test.ts`'s fixture to the full migration set and ran it: **`"enforces ledger scoping"` then FAILS** — `createLedger` for a 2nd ledger now returns an error (`ledger2` undefined → `.id` throws) because the free-plan ledger limit is now enforced. So that suite's multi-ledger setups only succeed *because* `usage_tracking` is absent (fail-open in the test env). Production itself enforces correctly (all migrations applied — assuming B1/P1 are fixed). This is a **test-integrity finding**, pre-existing: the api/mcp/sdk suites do not reflect production tier behaviour, and retrofitting their fixtures requires fixing the setups (give test users headroom / use admin). The generator's HANDOFF labelled this "debt"; the empirical result shows it is real fail-open in those test envs.

**Item 3 detail.** Drove the full HTTP stack (Hono app → apiKeyAuth → route → core → bank_transactions → dedup):
```
[3] preview status=200 newCount=2 errorCount=0      [3] commit status=201 imported=2
[3] cross-channel commit imported=1 duplicates=1     [3] mapping create status=201
[3] cross-ledger key status=403
```
API↔core wiring is solid and ledger-scope auth is enforced over HTTP. The DoD screenshot was indeed produced from a stubbed `api` on a temporary demo route; the **browser → server-action → SDK** hop is still not exercised end-to-end (OAuth wall), though the API contract it targets is now E2E-verified.

---

## Rubric scoring (honest; "Pass 7/8", test-coverage + auth are hard blockers)

1. **Test coverage** (hard) — **NEEDS-FIX.** 636 green, but the fixture diverges from the prod runner (hid B1) and there is zero coverage of the dedup edge cases, which are broken (B2). Happy-path only.
2. **Auth patterns** (hard) — **CONFIRMED-SOLID.** New endpoints under `apiKeyAuth`; cross-ledger key → 403 verified over HTTP.
3. **Package boundaries** — **CONFIRMED-SOLID.** Core imports nothing from api/dashboard; parsing/normalisation in core; dashboard sends raw file + mapping and renders core's response.
4. **Env / secrets** — **CONFIRMED-SOLID (minor).** `BANK_FEED_PROVIDER` documented; no hardcoded secrets. Not added to `.env.example`.
5. **Bank feeds (idempotent; errors surface)** — **BROKEN.** Single-channel idempotency on `provider_transaction_id` is fine, but cross-channel dedup is wrong both ways (B2) and `removed` mutates reconciled data without audit (B3).
6. **MCP contract** — **CONFIRMED-SOLID.** No MCP changes; 44/44 pass.
7. **TypeScript** — **CONFIRMED-SOLID.** Typecheck clean across 9 packages; no new `any`; no `ts-ignore`.
8. **Fail-closed (NEW)** — **NEEDS-FIX.** Explicit cases pass (mock throws in prod; ambiguous mapping rejected; DI seam defaults to real). But B1 makes the feature *crash* at runtime in prod (not gracefully closed), and B3 mutates silently.

**Solid: 4/8 (2, 3, 6, 7). Both hard blockers split: auth solid, test-coverage not.** Not 8/8.

---

## Required before merge
1. **B1:** register `031` (and `028`–`030`, P1) in both migration lists in `api/src/index.ts`; add an anti-drift guard test (every migration file is in the runner). Re-prove `upsertBankTransactions` works on the prod schema.
2. **B2:** fix dedup to not lose genuine duplicates and not double-count description-divergent matches — or scope/document the guarantee honestly. Add edge-case tests (the two coffees; the divergent-description overlap).
3. **B3:** audit removals; guard reconciled/posted rows; no untraced hard deletes.
4. Re-point the api/mcp/sdk test fixtures at the full migration set and fix the setups they break (item 2) so tier behaviour in tests matches production.

Do **not** merge until 1–3 are fixed and independently re-verified.

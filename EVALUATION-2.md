# Adversarial QA Round 2 — Re-verification of B1/B2/B3 fixes (PR #1, `feat/bank-ingestion-mock-plaid-csv`)

**Reviewer stance:** skeptical senior engineer; nothing accepted without independent execution.
**Date:** 2026-05-30
**Verdict: NOT mergeable as-is.** The three commissioned blockers (B1/B2/B3) are genuinely fixed, correctly scoped, and independently re-verified. **But re-verification surfaced a new money-correctness gap (item 4) that reopens the "bank-feeds ingestion idempotent" hard rubric blocker**, plus two lesser gaps (items 5, 6). Item 4 should be fixed (or consciously accepted) before merge.

---

## Baseline (independently re-run, forced, no cache)
core 463 + api 103 (+6 skipped) + mcp 44 + sdk 35 = **645 passing**, exit 0. Matches the claim; no regressions.

---

## RE-VERIFY the original three — all CONFIRMED-SOLID (independent probes, not trusting the new tests)

### B1 — migration 031 in the production runner — CONFIRMED-SOLID
Built a DB from the **exported production list** (`SQLITE_MIGRATION_FILES` in [`packages/api/src/index.ts`](packages/api/src/index.ts), not `readdirSync`):
- `SQLITE_MIGRATION_FILES` contains `031_csv_import.sqlite.sql`; `pgMigrations` contains `031_csv_import.sql`.
- `upsertBankTransactions` succeeds on that schema; `mapping_profiles` table exists.
- **Existing Basiq sync works**: a date-range `fetchTransactions` provider driven through `engine.syncBankAccount` stored 1 row on the production schema (the regression that threw `no column named line_fingerprint` is gone).

### B2 — dedup correctness (the commissioned scenarios) — CONFIRMED-SOLID
Count-asserted: two identical coffees → both stored (2); re-import → +0 (stays 2); a third → recordable (3); OFFICEWORKS-0123 (exact) overlapping a synced feed → stays exactly 1.

### B3 — removed-sync audit + guard (the commissioned scenario) — CONFIRMED-SOLID
`removeBankTransactions`: a `matched` row keeps status `matched` (not silently re-stated) and the change is audited; a `pending` row is deleted and the deletion is audited. The immutable ledger is untouched.

---

## ATTACK the new surfaces — 3 findings

### Item 4 — cross-source dedup has NO date tolerance → double-counts on a one-day shift. **BROKEN.**
The loose matcher is exact `date|signed-amount` membership ([`engine/index.ts` `classifyDedup`](packages/core/src/engine/index.ts), `ctx.feedLooseKeys.has(looseKeyFromFingerprint(fp))`). Plaid commonly reports a pending/auth date that differs from the posted date a bank CSV exports. Reproduced — feed has `OFFICEWORKS 0123 @ 89.95 on 2026-04-04`, CSV exports the **same merchant, same amount, posted 2026-04-05**:
```
[4] off-by-one dedupStatus= new | imported= 1 | 89.95-debit rows now= 2  (2 => double-counted same txn)
```
This is the **same money-correctness class the sprint set out to eliminate**, re-triggered by date drift instead of description drift. The fix closed the description path and left the date path open. **Fix:** give the loose matcher a small date tolerance (e.g. ±3–4 days) when surfacing cross-source candidates. (Note: SPRINT.md's B2 criteria only named the description-divergence scenario, so this is technically beyond the written acceptance list — but it directly defeats the rubric's "ingestion idempotent" hard blocker, so it cannot be ignored.)

### Item 5 — held `possible_duplicate` rows are not persistently resolvable → genuine distinct expense can be silently omitted. **NEEDS-FIX.**
A genuinely different purchase that merely coincides on date+amount with a feed row (Bunnings vs Officeworks, both 89.95 on 2026-04-04) is flagged `possible_duplicate` and **held**. On commit without a decision:
```
[5] dedupStatus= possible_duplicate | possibleDuplicates= 1 | Bunnings stored= 0 | persisted anywhere= 0
```
The held row is not written to `bank_transactions` and is **not persisted anywhere** — only an ephemeral `possibleDuplicates` count is returned. There is no held-review queue; to recover the row the user must re-upload the CSV. It IS shown in the preview before commit (so not fully silent), but it is **not persistently resolvable** afterwards — the mirror image of the original double-count bug (understatement instead of overstatement). **Fix:** persist held candidates (e.g. stage as a `needs_review`/held status) so they are resolvable after commit, rather than dropping them.

### Item 6 — guarded-row escalation is audit-log-only; `flaggedForReview` is discarded. **NEEDS-FIX.**
`removeBankTransactions` returns `flaggedForReview`, but `syncBankAccount` ignores the return value ([`engine/index.ts:3753`](packages/core/src/engine/index.ts) — `await this.removeBankTransactions(...)`, result dropped). No notification is created and `bank_sync_log` records nothing about it:
```
[6] flaggedForReview= 1 | notifications created= 0 | (syncBankAccount discards this count)
```
The B3 **guard** works (reconciled rows aren't mutated, and an audit entry is written), but "surfaced for user review" is satisfied only by a raw `audit_entries` row — guarded rows accumulate invisibly unless someone queries the audit log. **Fix:** surface `flaggedForReview` (sync-log field or a notification) so it's user-resolvable.

---

## Item 7 — cleanup — CONFIRMED-SOLID
- No `demoSample` / `csvdemo` residue anywhere in `packages/dashboard/src`.
- `middleware.ts` `publicRoutes = ["/signin", "/api/auth"]` (the `/csvdemo` allowance is gone).
- The permanent `api` DI seam remains (`CsvImportApi`, `api = defaultApi`), defaulting to the real server actions.
- Working tree clean.

## Scope check — CONFIRMED-SOLID
Diff `56f8760..HEAD` touches only in-scope files. Confirmed **NOT touched**: migrations `028/029/030`, `crypto/tokens.ts` (token encryption), `bank-feeds/basiq.ts` (Basiq webhook), `api/tests/api.test.ts`, `api/tests/tier-enforcement.test.ts`, mcp/sdk fixtures, the systemic migration mechanism. `index.ts` added `031` only (the SQLite list goes 001–027 then 031; no 028–030).

---

## Rubric (8 + fail-closed + test/prod parity), with evidence

1. **Test coverage** (hard) — **CONFIRMED-SOLID for scope.** The three blockers have count-asserted regression tests; suite 645 ≥ 636. Caveat: no coverage of items 4/5 (date drift / held-row omission).
2. **Auth** (hard) — **CONFIRMED-SOLID.** New endpoints unchanged from round 1; ledger-scope enforced (`apiKeyAuth` on `:ledgerId`).
3. **Package boundaries** — **CONFIRMED-SOLID.** All dedup/normalisation logic stays in core; no new core→api/dashboard import.
4. **Env / secrets** — **CONFIRMED-SOLID.** None hardcoded.
5. **Stripe** — **CONFIRMED-SOLID.** Untouched.
6. **Bank feeds — ingestion idempotent; errors surface** (hard) — **NEEDS-FIX.** Same-source idempotency holds, but **item 4 proves cross-source ingestion is NOT idempotent** when the same transaction's date shifts by a day → double count. This hard blocker is not fully closed.
7. **MCP contract** — **CONFIRMED-SOLID.** No MCP changes; 44/44.
8. **TypeScript** — **CONFIRMED-SOLID.** Typecheck clean (9/9); no new `any`.
9. **Fail-closed** (hard) — **MOSTLY-SOLID, with caveats.** B3 guards reconciled rows; mock prod-guard and ambiguous-mapping rejection intact. But item 5 (silent omission of a held distinct expense) and item 6 (escalation not surfaced) are residual fail-open-ish data-handling gaps.
10. **Test/prod migration parity** (NEW) — **CONFIRMED-SOLID.** `migration-parity.test.ts` builds from the production list; CLAUDE.md documents the hardcoded-list mechanism and the "readdir-green ≠ ships" trap.

**Solid: 7/10.** Hard blockers: test-coverage ✓, auth ✓, **bank-feeds-idempotent ✗ (item 4)**, fail-closed ~ (items 5/6).

---

## Verdict & required-before-merge
The fix session did exactly what it was commissioned to do: B1, B2, and B3 are genuinely resolved per their acceptance criteria, the work is cleanly scoped, and cleanup is complete. **However, I cannot stamp this mergeable** because re-verification reopened the money-correctness hard blocker via a different, common trigger:

1. **Item 4 (must fix or consciously accept):** add a date tolerance to cross-source candidate matching so a Plaid pending/posted date shift does not double-count. Add a regression test (off-by-one date, same merchant → flagged, not double-counted).
2. **Item 5 (should fix):** persist held `possible_duplicate` rows so a genuine distinct expense is resolvable after commit, not dropped to an ephemeral count.
3. **Item 6 (should fix):** surface `flaggedForReview` to the user (sync-log/notification), not audit-log-only; stop discarding the `removeBankTransactions` return.

Recommend one more fix pass on item 4 (small: a tolerance window) before merge, with 5/6 either fixed or explicitly recorded as accepted known-limitations. The three original blockers themselves are independently verified solid and do not regress.

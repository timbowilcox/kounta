# SPRINT — Session C fix: ledger soft-delete migration (unblock merge)

## Context
EVALUATION-6 blocked the merge: softDeleteLedger writes status='deleted', but ledger_status permits
only ('active','archived') on BOTH backends, so the UPDATE throws on the constraint before any audit
write — the atomicity proof is vacuous and DELETE /v1/ledgers/:ledgerId 500s in prod. SAME class as
030: the engine intent ('deleted') is correct; the schema enum/CHECK never got the value. Fix the
schema, not the op. Everything else in Session C verified solid.

Continue on feat/fail-closed-hardening (unmerged), worktree C:\dev\kounta-hardening.

## Scope
Add 'deleted' to ledger_status via a new migration 033 (mirror 030's audit_action add); register it;
make softDeleteLedger genuinely work and its atomicity proof real. NO change to the engine write —
it already writes 'deleted' correctly.

## Before any code
1. Read SPRINT.md, CLAUDE.md, HANDOFF.md, EVALUATION-6.md (esp. the softDeleteLedger finding).
2. Orient: 030 (PG ALTER TYPE ADD VALUE + SQLite table-recreate) as the template; the runner's
   special-case branches (017/020/022/030, now narrowed to swallow only 42710); the manifest;
   softDeleteLedger + its vacuous audit test; any TS ledger_status union; the ledger get/list/access
   queries (soft-delete must actually HIDE the ledger).
3. Baseline: pnpm test --concurrency=1 → confirm 690/5-skip/0-fail.

## The work
1. Migration 033 (033_ledger_status_deleted): PG `ALTER TYPE ledger_status ADD VALUE IF NOT EXISTS
   'deleted'`; SQLite table-recreate adding 'deleted' to the CHECK (mirror 030's .sqlite.sql).
   Append-only — 033 is new, never edit an applied migration.
2. Register 033 in the manifest (REGISTERED, after 032); anti-drift guard stays green. Update any TS
   ledger_status union to include 'deleted'.
3. Runner: add the 033 PG ALTER TYPE special-case mirroring 030 (per-statement db.exec, the
   now-narrowed 42710-only catch). 033 is the only runner addition.
4. Checkpoint — report before changing read behaviour: do the ledger get/list/access paths exclude
   status='deleted'? A soft-deleted ledger must not be returned to normal reads. If they don't hide
   it, fixing that is part of making the op genuinely work.
5. Make the proof REAL: the existing audit test must now reach the audit write and prove (a)
   happy-path soft-delete works and hides the ledger, (b) the nested softDeleteLedger→revokeApiKey
   audit-injection rolls back BOTH the ledger status AND the key revocations. Add the missing
   happy-path test (there is none today).
6. Update any parity assertion enumerating ledger_status values.

## Definition of done (proof, not assertion)
- Real-PG: full manifest 001–033 applies clean from empty on a UTF-8 throwaway Postgres, twice
  (33 applied / re-runnable), 033's ALTER TYPE succeeding via its special-case. Reuse the Session C
  proof harness; init UTF-8.
- softDeleteLedger happy-path works on real PG and the ledger is hidden from reads; the
  audit-injection test genuinely rolls back the nested op — prove non-vacuity by unwrapping →
  RED → revert.
- Full suite green serially, 0 fail-open warnings, typecheck clean.

## Scope guardrails
ONLY: migration 033 + registration + runner special-case + read-path hiding + the softDeleteLedger
tests + the TS union. Do NOT touch the other Session C fixes, the Stripe-webhook secret (post-merge
follow-up), or commitCsvImport (deferred). No squashing.

## At the end
- HANDOFF.md: 033 added + proven on real PG, softDeleteLedger now works + proof is real, the
  read-path decision, test status, files changed.
- Commit per chunk. Do NOT self-certify mergeable — the evaluator re-checks the softDeleteLedger
  path (happy + nested rollback) and the real-PG 001–033 apply, then the whole Session C branch
  merges.
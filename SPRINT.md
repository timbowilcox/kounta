# SPRINT — Launch migration registration (028/029/030)

## Context
Production has been offline ~3 months; the postgres-volume holds only disposable
pre-launch data and WILL be replaced with a fresh empty volume at launch. The Session A
production-safety gate that blocked registering 028/029/030 (it protected a live prod with
real data) is therefore VOID — there is no live data and no reconciliation. These migrations
will apply, in order, to a fresh empty Postgres on first boot. Registering them is now safe.

## Scope
Move 028/029/030 from PENDING to REGISTERED; make the runner apply 030 correctly; un-skip the
two 030-gated tests; prove the full manifest 001–032 applies cleanly to a fresh empty Postgres.

## Before any code
1. Read SPRINT.md, CLAUDE.md, HANDOFF.md, EVALUATION-4.md.
2. Orient:
   - the migration manifest in @kounta/core (migration-manifest.ts): REGISTERED vs PENDING
   - the API runner packages/api/src/index.ts — specifically the per-statement special-cases
     for 017/020/022 (ALTER TYPE ... ADD VALUE can't run inside the implicit txn that
     PostgresDatabase.exec wraps each file in). This is the pattern 030 needs.
   - migration 030 (PG + SQLite) and the audit_action enum lineage: 001 CREATE TYPE,
     002 inline 'updated', 030 'revoked'/'deleted'
   - the engine's writeBankTxnAudit (engine index.ts): the workaround restricting bank-txn
     audit actions to archived/updated BECAUSE 030 wasn't applied
   - the two it.skip'd revoke tests (api.test.ts, sdk.test.ts) and their 030 TODOs
   - the anti-drift guard's PENDING exceptions
3. Baseline: pnpm test --concurrency=1 → confirm 661 / 8-skipped / 0 fail-open warnings.

## GATE — report, then proceed (no human go required; prod is disposable/offline)
Before writing the runner change, report:
   - exactly how 017/020/022 are special-cased, confirming 030 needs identical treatment
   - your recommendation on whether to LIFT the writeBankTxnAudit workaround now that 030 lands
     (does any bank-txn path legitimately need revoked/deleted, or is archived/updated correct
     there regardless?) — recommend, don't assume
   - confirmation that on a FRESH empty DB the back-fill probe (001–027 anchors in index.ts)
     back-fills nothing, then the runner applies 001–032 in order
There is no irreversible prod action in this sprint, so proceed after reporting — but STOP and
flag anything surprising.

## The work
- Manifest: move 028, 029, 030 from PENDING to REGISTERED in correct order
  (…027, 028, 029, 030, 031, 032). PENDING becomes empty. Re-derive PG + SQLite lists; verify
  they extend the old lists by exactly {028,029,030} in the right positions.
- Runner (packages/api/src/index.ts): add the per-statement special-case for 030's ALTER TYPE,
  mirroring 017/020/022. This is the ONLY runner change.
- Engine: lift the writeBankTxnAudit workaround IF the gate concluded it should be — else leave
  it and document why.
- Un-skip both revoke tests (api + sdk). They must now PASS because the schema accepts
  'revoked'/'deleted'. Confirm they pass for the RIGHT reason (audit row written with the
  correct action), not via a weakened assertion.
- Anti-drift guard: PENDING list now empty; guard must still pass AND still catch a deliberate
  drift.
- Parity assertions: flip the ones that proved ABSENCE of bills/vendors / 030-actions to prove
  PRESENCE — the test schema now matches the full manifest.
- FRESH-PG PROOF (the real DoD): stand up a throwaway Postgres (local docker or a Railway
  branch — NOT the dormant prod volume) and apply the full manifest 001–032 from empty, TWICE,
  proving clean apply + 030's ALTER TYPE succeeds on real PG + re-runnability. sql.js does NOT
  exercise the PG ALTER TYPE path, so this is mandatory. If no PG is reachable in-session,
  statically verify the 030 special-case byte-matches the 017/020/022 pattern AND document the
  exact fresh-PG apply command for the human to run once before launch.

## Scope guardrails
DO NOT touch token encryption, the Basiq webhook, or the audit-snapshot — those are Session C.
No feature work. Do NOT squash migrations. The only runner change permitted is the 030
special-case.

## End
- HANDOFF.md: what's done, the fresh-PG apply result (or the documented manual command), the
  writeBankTxnAudit decision, test status, the launch precondition below, exact next step
  (Session C: fail-closed hardening), files changed.
- LAUNCH PRECONDITION to record: provision a FRESH empty Postgres volume at launch; do NOT
  reattach the dormant volume.
- Commit per logical chunk. "Done" = 028/029/030 registered, 030 applies on real PG (or
  documented), both tests un-skipped and genuinely passing, PENDING empty, guard still catches
  drift, parity flipped to presence, full suite green serially.
- Do NOT self-certify mergeable. A fresh evaluator verifies the real-PG 030 apply, that the
  un-skips pass for the right reason, and that PENDING-empty hasn't blinded the guard.
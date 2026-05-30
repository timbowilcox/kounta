# SPRINT — Fail-closed hardening (Session C)

## Context
The original audit found a systemic FAIL-OPEN posture: on failure the system silently
degrades or proceeds rather than refusing. For an accounting/audit product that's backwards —
the correct default is fail CLOSED (refuse, error loudly), never silently proceed. This sprint
converts the four remaining fail-open paths to fail-closed. Production is disposable/pre-launch
(no real tokens, no webhook history, no users), so NONE of these fixes need a data migration or
backfill — which simplifies the crypto and audit changes especially.

Touches security-sensitive code (auth tokens, webhook verification, audit writes, the migration
runner) but NO production-DB action and NO new migrations.

## Scope — four fail-closed fixes
1. Migration-runner fail-closed (EVALUATION-5 §10).
2. Token encryption fail-closed (remove the plaintext fallback).
3. Basiq webhook signature verification (reject unverified).
4. Audit-write/snapshot fail-closed (no swallowed audit failures; complete snapshots).

## Before any code
1. Read SPRINT.md, CLAUDE.md, HANDOFF.md, EVALUATION-5.md.
2. Locate each fail-open path precisely (file:line):
   - Runner (packages/api/src/index.ts): the special-case catch { /* already exists */ } on the
     017/020/022/030 branches (swallows ALL exceptions silently and still marks applied), AND the
     generic per-migration catch that logs "continuing" + failed++ without aborting boot.
   - Token encryption: the path that stores/reads a token as plaintext when the key is missing or
     decryption fails.
   - Basiq webhook: the handler that accepts events without verifying authenticity; determine
     Basiq's actual signature scheme (signing secret / HMAC header).
   - Audit: any audit write whose failure is swallowed (op proceeds without an audit entry) and
     any snapshot missing full before/after state. NB: 030 fixed the enum-rejection that made
     revoke/delete audit writes throw — confirm what swallow paths remain post-030.
3. Baseline: pnpm test --concurrency=1 → confirm green, record the count.

## GATE — report current behaviour + fix plan + dependencies (STOP, report, then proceed)
For each of the four: the exact current fail-open behaviour (file:line), the fail-closed fix, and
its blast radius. Proceed after reporting — but STOP and flag if any fix:
   - needs a data migration/backfill (shouldn't, given disposable prod — confirm),
   - materially changes deploy/boot behaviour (the runner abort-on-failure DOES: a bad migration
     now takes the service down instead of degrading silently — flag it as a conscious choice),
   - needs a secret Tim must set in Railway (the Basiq signing secret — name the env var; code
     reads it and fails closed if absent),
   - is materially larger than a contained fix (flag for a possible split).
No human go strictly required, but flag surprises before charging ahead on crypto/webhook.

## The work (fail closed everywhere; an injected-failure test for each)
1. Runner: narrow the special-case catch to swallow ONLY duplicate/"already exists" (match the
   specific PG error code/message; rethrow everything else). Make boot ABORT (non-zero / throw) if
   any migration failed — a half-migrated DB must not serve.
2. Token encryption: remove the plaintext fallback. Missing/invalid key → fail (startup or op).
   Decryption failure → error, never return plaintext. No data migration (disposable prod).
3. Basiq webhook: verify the signature on every inbound event; reject (401/403) with ZERO side
   effects on missing/invalid signature. Read the signing secret from env; absent → fail closed.
4. Audit: audit writes fail closed — if the audit entry can't be written, the op fails/rolls back
   (or is loudly surfaced), never silently committed without audit. Snapshots capture complete
   before/after state.

(Optional, only if you're already in usage.ts: the tier-check swallow regex is SQLite-only
("no such table|column"), so on PG a missing table 500s instead of failing closed cleanly. Latent
on a full schema — don't gate the sprint on it.)

## Definition of done (proof, not assertion)
Each fix has a test that INJECTS its failure and proves fail-CLOSED:
   - runner: a deliberately-broken migration on a throwaway REAL Postgres aborts boot (non-zero),
     DB not left serving; a genuine "already exists" on re-run is still swallowed (idempotent
     re-run still works). sql.js won't exercise the PG error path — real-PG proof required, as in
     Session B.
   - token: no key → fails closed (not plaintext); corrupt ciphertext → read fails closed.
   - webhook: valid signature → processed; missing/invalid → rejected, zero side effects.
   - audit: audited op whose audit write fails → op fails/rolls back, not silently committed.
Full suite green serially, no fail-open warnings, typecheck clean.

## Scope guardrails
No new migrations, no prod-DB action, no feature work. Do NOT touch the manifest or the 028/029/030
registration (done). Fix ONLY the four fail-open paths; the runner change is limited to
catch-narrowing + abort-on-failure — no other runner refactor.

## At the end
- HANDOFF.md: each fix + its injected-failure proof, the env var Tim must set in Railway (Basiq
  secret), the deploy-behaviour change (boot now aborts on migration failure), test status, files
  changed, exact next step.
- Sweep the two stale "028/029/030 are PENDING" comments now on main
  (packages/api/src/migrations.ts header + migration-drift.test.ts) — trivial, fix while here.
- Commit per fix. Do NOT self-certify mergeable. A fresh evaluator injects each failure mode and
  confirms fail-CLOSED (not open), with the runner proof on real PG.
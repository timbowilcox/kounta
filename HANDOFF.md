# HANDOFF — Fail-closed hardening (Session C)

**Branch:** `feat/fail-closed-hardening` (cut from `main` @ `1f32509`, after PRs #1/#2/#4).
**Scope:** `SPRINT.md` — convert the four remaining FAIL-OPEN paths to fail CLOSED. No prod-DB
action, no new migrations, no manifest/028-029-030 changes.
**Status:** all four fixed, each with an injected-failure test; runner proven on a real throwaway
Postgres. Full suite green serially (**690 pass / 5 skip / 0 fail**), typecheck 9/9 clean, 0
fail-open warnings. **NOT self-certifying mergeable** — a fresh evaluator should inject each
failure mode (see Definition of Done).

## UPDATE — ledger soft-delete migration (033) — unblocks EVALUATION-6

EVALUATION-6 blocked the merge: `softDeleteLedger` writes `status='deleted'`, but `ledger_status`
permitted only `('active','archived')` on BOTH backends, so the `UPDATE` threw on the constraint
before any audit write — the atomicity proof was vacuous and `DELETE /v1/ledgers/:ledgerId` 500'd in
prod. SAME class as 030 (the engine intent was correct; the schema value was never added). Fixed the
schema, not the op.

- **Migration 033 (`033_ledger_status_deleted`)** — PG: `ALTER TYPE ledger_status ADD VALUE IF NOT
  EXISTS 'deleted'`. SQLite: table-recreate widening the `ledgers.status` CHECK to include `'deleted'`
  (SQLite cannot ALTER a CHECK). Unlike 030's `audit_entries`, `ledgers` is referenced by many tables,
  so the recreate runs under `PRAGMA foreign_keys=OFF` and **rebuilds every attached object**: all 16
  columns (001's 12 + 019's 4), `idx_ledgers_owner` (001), `idx_ledgers_owner_status` (028), and the
  `trg_ledgers_updated_at` trigger (001). Registered in the manifest after 032; PENDING stays empty;
  anti-drift guard green.
- **Runner special-case** ([packages/api/src/index.ts](packages/api/src/index.ts)): a 033 branch
  mirroring 030 — `ALTER TYPE … ADD VALUE` via its own `db.exec()` (autocommit; can't run in a txn),
  with the now-narrowed `isDuplicateValueError` (42710-only) catch. 033 is the only runner addition.
- **Read-path decision (SPRINT step 4):** the owner list (`findLedgersByOwner`) already filtered
  `status='active'` (hides deleted), and `validateApiKey` requires `status='active'` so the
  delete-time key revocation already blocks API access. The gap was the by-id read — `getLedger` now
  treats `status='deleted'` as not-found. (OAuth tokens are not revoked on delete — noted as a
  separate follow-up, out of this fix's scope.)
- **TS:** `LedgerStatus` union and the `ledgerStatus` zod enum extended with `'deleted'` (the zod enum
  is defined-only, not wired into any input parse, so this opens no write path).
- **Proof is now REAL** (was vacuous):
  - `packages/core/tests/audit-fail-closed.test.ts` — the softDeleteLedger test now REACHES the audit
    write (`auditAttempts > 0`) and proves the nested rollback: an audit failure rolls back BOTH the
    ledger delete AND the key revocations. A new happy-path test proves the delete succeeds, hides the
    ledger (`getLedger` err + absent from the owner list), revokes the key, and writes the `'deleted'`
    audit row. Non-vacuity confirmed by unwrapping the transaction → nested test RED
    (`expected 'deleted' to be 'active'`) → reverted.
  - `packages/api/tests/migration-parity.test.ts` — added a 033 assertion: the production SQLite
    schema's `ledgers` CHECK contains `'deleted'`, 019's columns survived, and both indexes + the
    trigger are present.
  - **Real PG** (`scripts/eval-033-pg-proof.sh` + `eval-033-softdelete-pg.mjs`; UTF-8 throwaway):
    A fresh DB → `33 applied / 0 / 0` + serves; B re-run → `0 applied / 33 skipped / 0` + serves
    (033 ALTER TYPE idempotent); C `ledger_status = active,archived,deleted`; D softDeleteLedger
    happy-path on real PG passes every assertion. `scripts/runner-failclosed-proof.sh` updated 32→33
    and re-run green (A 33/0/0, B 0/33/0, C broken-migration aborts non-zero).
- **Test status:** full suite `pnpm test --force --concurrency=1` → **692 pass / 5 skip / 0 fail**
  (core 501 · mcp 44 · api 112/5-skip · sdk 35), 0 cached, 0 fail-open warnings; `pnpm typecheck
  --force` 9/9.
- **Files changed:** `migration-manifest.ts`, `033_ledger_status_deleted.sql` +
  `.sqlite.sql` (new), `api/src/index.ts` (runner), `engine/index.ts` (getLedger),
  `schemas/index.ts`, `types/index.ts`, `audit-fail-closed.test.ts`, `migration-parity.test.ts`,
  `scripts/eval-033-pg-proof.sh` + `eval-033-softdelete-pg.mjs` (new), `runner-failclosed-proof.sh`
  (count bump), `SPRINT.md`. **Not self-certifying mergeable** — the evaluator re-checks the
  softDeleteLedger path (happy + nested rollback) and the real-PG 001–033 apply.

---

## Baseline at session start
`pnpm test --force --concurrency=1` → **663 pass / 6 skip / 0 fail** (core 474 · api 110/6-skip ·
mcp 44 · sdk 35), 12/12 tasks, 0 fail-open warnings. (Fresh worktree needed `pnpm install`.)

## The four fixes (each: current fail-open → fix → injected-failure proof)

### 1. Migration runner — `fix(api)` `2d47eda`
- **Was:** the enum special-case branches (002/017/020/022/030) `catch { /* already exists */ }`
  swallowed EVERY exception then unconditionally marked the migration applied; the generic
  per-migration catch logged "(continuing)" + `failed++` but boot proceeded against a half-migrated
  DB. A broken `ALTER TYPE` read as "applied / 0 failed".
- **Fix** ([packages/api/src/index.ts](packages/api/src/index.ts)): `isDuplicateValueError()` narrows
  the enum catches to swallow ONLY SQLSTATE `42710` / "already exists" (rethrow else); after the
  apply loop, `failed > 0` throws; `main().catch` now `process.exit(1)`.
- **Deploy-behaviour change (conscious):** a bad migration now ABORTS boot (non-zero exit → Railway
  healthcheck fails) instead of silently degrading. A half-migrated DB never serves.
- **Proof — real Postgres 18.3** (`scripts/runner-failclosed-proof.sh`; sql.js can't exercise the
  PG error path):
  - **A** fresh empty DB → `32 applied, 0 skipped, 0 failed`, server starts.
  - **B** re-run same DB → `0 applied, 32 skipped, 0 failed`, server starts (idempotent; genuine
    "already applied" still skipped).
  - **C** a deliberately-broken migration → `31 applied, 1 failed`, **exit 1**, logs "refusing to
    start" + "Fatal: server startup failed", server does NOT listen.
  - Cluster is created with `-E UTF8` to match prod — see "Encoding finding" below.

### 2. Token encryption — `fix(core)` `8aa4fdc`
- **Was:** `encryptToken` returned the plaintext UNCHANGED when `KOUNTA_TOKEN_ENCRYPTION_KEY` was
  missing/malformed (stored Stripe tokens in cleartext — forbidden by CLAUDE.md); `decryptToken`
  returned any non-`enc:` value verbatim.
- **Fix** ([packages/core/src/crypto/tokens.ts](packages/core/src/crypto/tokens.ts)):
  `getEncryptionKey()` throws (`TokenEncryptionError`) on a missing/non-64-hex key; `encryptToken`
  never returns plaintext; `decryptToken` requires a valid key AND an `enc:` envelope — missing key,
  non-encrypted value, malformed envelope, wrong key, or tampered ciphertext (GCM auth-tag) all
  throw. No data migration (disposable prod, no real tokens).
- **Proof** (`packages/core/tests/token-crypto.test.ts`, 10 tests): no key → encrypt/decrypt throw
  (not plaintext); malformed key → throw; corrupt ciphertext → throw; wrong key → throw;
  non-encrypted value → throw; round-trip works with a valid key.
- **Blast radius:** smaller than estimated at the gate — **no existing test broke**. The two Stripe
  tests build `StripeConnection` objects directly and never call `decryptToken`; the oauth tests use
  a different (OAuth) token system.

### 3. Basiq webhook signature — `fix(core)` `22cae13`
- **Was:** `BasiqProvider.handleWebhook(payload, _signature)` ignored the signature entirely and
  processed every event. (Latent — no route invokes `handleWebhook` yet — but unsafe by
  construction.)
- **Fix** ([packages/core/src/bank-feeds/basiq.ts](packages/core/src/bank-feeds/basiq.ts)):
  implements Basiq's real scheme (Svix): signed content `${webhook-id}.${webhook-timestamp}.${rawBody}`,
  HMAC-SHA256 with the base64-decoded `whsec_` secret body, base64 output, matched timing-safe against
  any space-delimited `v1,<sig>` entry, 5-minute replay window. New exported
  `verifyBasiqWebhookSignature`. `handleWebhook` reads `BASIQ_WEBHOOK_SECRET` and verifies BEFORE
  interpreting the body; missing secret / invalid signature / stale timestamp / bad body all return
  `shouldSync:false` + `connectionId:null` (zero side effects). The shared `BankFeedProvider.handleWebhook`
  was widened to a `WebhookVerificationInput` (rawBody + headers); mock/plaid updated (no call sites).
- **Proof** (`packages/core/tests/basiq-webhook.test.ts`, 12 tests): valid signed event → processed
  (correct `shouldSync`/`connectionId`); tampered body, wrong secret, stale timestamp, missing headers,
  missing secret → all rejected with zero side effects.

### 4. Audit writes — `fix(core)` `76bb519`
- **Was:** no swallowed audit writes exist (verified every catch near an audit insert). The fail-open
  was **atomicity**: several audited mutations wrote their `audit_entries` row OUTSIDE a DB
  transaction, so a failed audit write left the mutation committed with no audit row.
- **Fix** ([packages/core/src/engine/index.ts](packages/core/src/engine/index.ts)): wrapped
  `createAccount`, `revokeApiKey`, `softDeleteLedger`, `closePeriod`, `reopenPeriod`,
  `removeBankTransactions` in `this.db.transaction()` (nests via SAVEPOINT, so
  `softDeleteLedger → revokeApiKey` is safe). `postTransaction` now snapshots the COMPLETE posted
  entity (txn + lines) instead of the bare request input; the previously-skipped "includes snapshots
  in audit entries" test is un-skipped (its TODO was stale — it matched the first `created` entry, an
  account; now filtered by `entityType`).
- **Proof** (`packages/core/tests/audit-fail-closed.test.ts`, 4 tests): a `Database` wrapper that
  throws on every `INSERT INTO audit_entries` proves `createAccount` / `revokeApiKey` /
  `postTransaction` / `softDeleteLedger` all roll back (mutation NOT persisted) when the audit write
  fails.

## ⚠ Env vars Tim must set in Railway
1. **`BASIQ_WEBHOOK_SECRET`** — the `whsec_…` value from the Basiq dashboard. Absent → all Basiq
   webhooks fail closed (rejected). NEW.
2. **`KOUNTA_TOKEN_ENCRYPTION_KEY`** — 64 hex chars (32 bytes). Was optional; now REQUIRED wherever
   Stripe Connect is used (create/read a connection). Absent → those ops fail closed.

## ⚠ Flags / things the evaluator must know
- **Deploy behaviour changed** (runner): boot now aborts non-zero on any migration failure. This is
  the intended fail-closed posture but means a malformed migration = hard deploy failure.
- **Encoding finding (real-PG):** the runner proof first ran on a Windows-default **WIN1252** cluster
  and the fail-closed runner correctly ABORTED — 006/014 contain UTF-8 chars (currency symbols
  `€`/`£` in seed data, box-drawing/em-dashes in comments) that WIN1252 can't store, and 028 then
  cascaded. This is NOT a code or migration bug: prod (Railway/Linux) is UTF-8, where all 32 apply
  (proven). Implication worth noting: the OLD swallow-and-continue runner, on a non-UTF-8 DB, would
  have SILENTLY dropped `global_classifications`/multi-currency tables; the new runner turns that into
  a loud boot failure. **Provision a UTF-8 Postgres** (default — just don't override).
- **OUT-OF-SCOPE bug surfaced by fix #2 — Stripe-Connect webhook secret (recommend follow-up):**
  `getStripeConnectionByAccountId` ([engine/index.ts:2088](packages/core/src/engine/index.ts:2088))
  returns `webhook_secret` UNDECRYPTED, and the Stripe-Connect webhook route
  ([stripe-connect.ts:62-63](packages/api/src/routes/stripe-connect.ts:62)) uses it as the HMAC key.
  With encryption now mandatory the stored secret is `enc:…`, so legitimate Stripe-Connect webhooks
  will be REJECTED (fail-closed, safe, but broken). One-line fix when in scope:
  `webhookSecret: row.webhook_secret ? decryptToken(row.webhook_secret) : null`. Left untouched
  (it's a fail-CLOSED correctness bug, not one of the four fail-open paths, and Stripe-Connect webhook
  correctness needs its own test).
- **`commitCsvImport` NOT wrapped** ([engine/index.ts](packages/core/src/engine/index.ts), CSV audit
  at the end of the method): its audit is still non-transactional. Wrapping its heavy
  upsert→classify→match pipeline in one transaction is a materially larger atomicity change; bounded
  out per the gate. Candidate follow-up.
- **`usage.ts` PG swallow regex** (SPRINT optional item) — not touched; SQLite-only `"no such
  table|column"` regex, latent on a full schema. Not gated.

## Test status
Full suite green serial (`pnpm test --force --concurrency=1`): **690 pass / 5 skip / 0 fail**
(core 500 · mcp 44 · api 111/5-skip · sdk 35), 12/12 tasks. Typecheck **9/9 clean**. **0** fail-open
warnings. Delta vs start (663/6): **+27 pass** (+26 new core tests: token 10, basiq 12, audit 4; +1
un-skipped snapshot), **−1 skip**. Remaining 5 skips are pre-existing and unrelated (benchmark ×4,
oauth "lists active connections" ×1).

## Reproduce the runner PG proof
```sh
bash scripts/runner-failclosed-proof.sh
# Expect: ALL PROOFS PASSED (A 32/0/0 serves · B 0/32/0 serves · C aborted non-zero 31/0/1)
# Needs scoop Postgres (initdb/pg_ctl/psql on PATH). Stands up a throwaway UTF-8 cluster on :55450,
# applies the real prod entrypoint, tears the cluster down. No prod/Railway is touched.
```

## Files changed (vs `1f32509`)
**core:** `src/crypto/tokens.ts` (fail-closed), `src/index.ts` (export `TokenEncryptionError`),
`src/bank-feeds/{basiq,mock,plaid,types,index}.ts` (webhook verify + interface),
`src/engine/index.ts` (audit atomicity + full snapshot).
**api:** `src/index.ts` (runner), `src/migrations.ts` (stale comment), `tests/api.test.ts`
(un-skip snapshot test).
**core tests (new):** `token-crypto.test.ts`, `basiq-webhook.test.ts`, `audit-fail-closed.test.ts`;
**modified:** `tests/migration-drift.test.ts` (stale comment).
**scripts (new):** `runner-failclosed-proof.sh`. **docs:** `SPRINT.md`, `HANDOFF.md`.
Commits: `64bf3fc` SPRINT · `2d47eda` runner · `8aa4fdc` token · `22cae13` webhook · `76bb519`
audit · `b0933c8` comment sweep + proof script.

## Definition of Done — fresh evaluator owes (do NOT trust this self-assessment)
- **runner:** re-run `scripts/runner-failclosed-proof.sh` on a throwaway PG → A 32/0/0 + serves,
  B 0/32/0 + serves, C broken-migration aborts non-zero and does NOT serve. Confirm a non-UTF-8
  cluster aborts (the WIN1252 case) rather than silently dropping tables.
- **token:** `vitest run tests/token-crypto.test.ts` — no key → throws (not plaintext); corrupt
  ciphertext → throws.
- **webhook:** `vitest run tests/basiq-webhook.test.ts` — valid → processed; missing/invalid/stale →
  rejected, zero side effects.
- **audit:** `vitest run tests/audit-fail-closed.test.ts` — audited op whose audit write fails →
  mutation rolled back, not persisted.
- Full suite green serially, typecheck clean, 0 fail-open warnings.

## Exact next step
1. Fresh evaluator injects each failure mode above (esp. the runner on real PG) and confirms
   fail-CLOSED, not open.
2. Decide on the two flagged follow-ups: the Stripe-Connect webhook-secret decrypt (one-liner) and
   `commitCsvImport` atomicity.
3. Set `BASIQ_WEBHOOK_SECRET` and `KOUNTA_TOKEN_ENCRYPTION_KEY` in Railway before launch.

# HANDOFF — Launch migration registration (028/029/030)

**Branch:** `feat/launch-migrations` (cut from `main` after PR #1 + PR #2).
**Scope:** `SPRINT.md` — graduate 028/029/030 from PENDING to REGISTERED, make the runner
apply 030 correctly, un-skip the two 030-gated revoke tests, and PROVE the full manifest
001–032 applies cleanly to a fresh empty Postgres. The Session A live-DB safety gate is VOID:
prod has been offline ~3 months with only disposable pre-launch data and a FRESH empty Postgres
volume is provisioned at launch — so the three migrations apply, in order, to an empty DB on
first boot.
**Status:** all SPRINT criteria met; full suite green serially; **fresh-PG apply proven on real
Postgres 18.3, twice, from empty.** **NOT self-certifying mergeable** — a fresh evaluator should
re-verify (see Definition of Done / next step).

## What's done
1. **Manifest** (`packages/core/src/db/migration-manifest.ts`) — 028/029/030 moved into
   `REGISTERED_MIGRATIONS` in order (`…027, 028, 029, 030, 031, 032`). `PENDING_MIGRATIONS` is
   now `[]`. The derived PG + SQLite lists extend the old lists by **exactly** {028,029,030} in
   the right positions (29 → 32 entries; all other entries unchanged in membership and order).
2. **Runner** (`packages/api/src/index.ts`) — added the per-statement special-case for 030's
   `ALTER TYPE audit_action ADD VALUE`, mirroring 017/020/022: three separate `db.exec()` calls
   (`'updated'`/`'revoked'`/`'deleted'`, each `IF NOT EXISTS`) so each runs in autocommit. A
   multi-statement file sent as one query is an implicit transaction, and Postgres rejects
   `ALTER TYPE … ADD VALUE` inside a txn block. **This is the only runner change.**
3. **029 Postgres bug fix** (`packages/core/src/db/migrations/029_bills.sql`) — **caught by the
   fresh-PG apply, not by sql.js.** 029's PG file declared all ids/FKs as `UUID`, but
   `ledgers.id` / `accounts.id` / `transactions.id` are `TEXT` schema-wide (UUID v7 stored as
   text). Postgres rejected the FKs (`foreign key constraint … cannot be implemented` —
   incompatible types uuid/text) and the runner (which swallows per-file errors and continues)
   **silently dropped all four AP tables** — exactly the "mounted-but-dead in prod" failure 029
   was meant to close. Changed all 16 `UUID` → `TEXT`; now matches the SQLite dialect and every
   sibling migration. SQLite's dynamic typing had masked this; only a real-PG apply surfaces it.
4. **Engine** (`packages/core/src/engine/index.ts`) — `writeBankTxnAudit` **left as-is**
   (`archived`/`updated`); only its now-stale doc-comment was rewritten. See decision below.
5. **Tests** — both revoke tests un-skipped and **strengthened**: each now reads the audit log
   back (api via `GET /v1/ledgers/:id/audit` with a second active key; sdk via
   `client.audit.list`) and asserts an `api_key` entry with `action='revoked'` — so they pass
   because the audit row is genuinely written, not merely because the call returned 200.
   `migration-parity.test.ts` flipped its three 028/029/030 assertions from **absence to
   presence** (AP tables exist; `usage_tracking` has `bills_count`/`vendors_count`; audit CHECK
   accepts `revoked`/`deleted`). `migration-drift.test.ts` now asserts `PENDING` is empty; its
   synthetic + real-dropped-file tests still prove the guard catches a new unregistered
   migration, so an empty PENDING does **not** blind it.

## writeBankTxnAudit decision — KEEP archived/updated (do NOT widen to revoked/deleted)
The genuine 030 prod bug was `revokeApiKey` (`action='revoked'`,
[engine/index.ts:1699](packages/core/src/engine/index.ts:1699)) and `softDeleteLedger`
(`action='deleted'`, [engine/index.ts:1738](packages/core/src/engine/index.ts:1738)) throwing
against the unmigrated enum — those write their actions **directly** and are fixed by 030 itself,
no engine change. `writeBankTxnAudit` is independent and not a bug: its callers write `archived`
(a provider-reported-removed *pending* mirror row is deleted — a `bank_transaction` is an
external-feed staging mirror, not a posted domain entity) and `updated` (a reconciled row is
guarded/flagged). No bank-txn path needs `revoked` (API-key-specific); `deleted` would be only a
cosmetic relabel of a correct, audited, working path, and editing it edges into the
bank-feed/Basiq removal area that is Session C. So the behaviour stays; the comment that
justified it as a "030 isn't applied" workaround was rewritten to state the real, post-030
rationale.

## FRESH-PG PROOF (the real DoD) — DONE, on a throwaway local Postgres
No Railway/prod touched. Stood up a throwaway **PostgreSQL 18.3** cluster locally
(`initdb` → `pg_ctl` on port 55432, DB `kounta_proof`), pointed the **real** production
entrypoint at it (`node packages/api/dist/index.js` with `DATABASE_URL`), applied the full
manifest from empty **twice**, then verified the schema and tore the cluster down.
- **Run #1 (empty):** `Migrations: 32 applied, 0 skipped, 0 failed`.
- **Run #2 (same DB):** `Migrations: 0 applied, 32 skipped, 0 failed` — re-runnable via the
  `_migrations` tracking table.
- **030 on real PG:** `audit_action` enum = `{created,reversed,archived,updated,revoked,deleted}`;
  `'revoked'`/`'deleted'` cast successfully **and** an actual
  `INSERT INTO audit_entries (… action='revoked')` succeeds (the exact prod bug, now fixed).
- **029 on real PG:** all four AP tables exist; `vendors.ledger_id` is `text` and the FK
  `vendors_ledger_id_fkey` is actually built; `usage_tracking` has `bills_count`/`vendors_count`.
- **028 on real PG:** both immutability triggers exist and a `UPDATE audit_entries` is rejected
  (`audit_entries is append-only: UPDATE operations are forbidden`).
- **Fresh-DB back-fill:** confirmed the `schemaExists` probe (no `ledgers` table) skips the entire
  001–027 anchor-probe back-fill block, so nothing is back-filled — the runner just applies
  001–032 in order. (EVALUATION-4 Obs.3 about the non-manifest probe list is moot on a fresh DB.)

### Exact command to reproduce the fresh-PG apply (for re-verification)
```sh
# any empty Postgres; here a local throwaway on :55432, DB kounta_proof
pnpm --filter @kounta/api build
DATABASE_URL="postgres://postgres@localhost:55432/kounta_proof" PORT=3999 \
  node packages/api/dist/index.js   # watch for "Migrations: 32 applied, 0 skipped, 0 failed", then Ctrl-C
# re-run the same command against the same DB → "0 applied, 32 skipped, 0 failed"
```

## Test status
Full suite **green**, serial (`pnpm test --concurrency=1`): **663 passing, 6 skipped**
(core 474 · mcp 44 · api 110/6-skip · sdk 35). `Tasks: 12 successful, 12 total`.
Typecheck **9/9 clean**. **0** fail-open warnings. Delta vs session start (661/8): **+2 passing,
-2 skipped** — the two revoke tests now run and pass for the right reason.

## LAUNCH PRECONDITION (record this)
**Provision a FRESH empty Postgres volume at launch. Do NOT reattach the dormant prod volume.**
The whole sprint rests on 001–032 applying to an empty DB on first boot. Reattaching the old
volume reintroduces the live-data reconciliation problem the Session A gate existed for (e.g.
028's non-idempotent `CREATE TRIGGER` assumes the triggers are absent), and the back-fill probe
would run against legacy schema. Empty volume only.

## Exact next step
1. **Fresh evaluator (do NOT trust this self-assessment):** re-run the fresh-PG apply above on a
   throwaway PG and confirm `32 applied / 0 failed` then `0 applied / 32 skipped`, the enum has
   `revoked`/`deleted`, and the four AP tables + FKs exist. Confirm the two un-skips pass because
   the **audit row** is written (not a weakened 200), and that `PENDING=[]` has not blinded the
   drift guard (drop a `033_x.sqlite.sql` → `pnpm --filter @kounta/core test` must go red).
2. **Then Session C: fail-closed hardening** — token encryption, the Basiq webhook signature,
   and the transaction audit-snapshot completeness (all explicitly out of scope here).

## Files changed
**core:** `src/db/migration-manifest.ts` (register 028/029/030, PENDING empty),
`src/db/migrations/029_bills.sql` (UUID→TEXT), `src/engine/index.ts` (writeBankTxnAudit comment),
`tests/migration-drift.test.ts` (PENDING empty assertion).
**api:** `src/index.ts` (030 special-case), `tests/api.test.ts` (un-skip+strengthen revoke),
`tests/migration-parity.test.ts` (flip to presence).
**sdk:** `tests/sdk.test.ts` (un-skip+strengthen revoke).
**docs:** `SPRINT.md` (this sprint's scope).
Commits on `feat/launch-migrations`: `a9a712b` SPRINT · `55f8eda` manifest register ·
`091b5a0` 029 PG TEXT fix · `9971b0f` 030 runner special-case · `4950086` engine comment ·
`071c9b2` tests · this HANDOFF.

## Definition of Done (met)
028/029/030 registered · 030 applies on real PG (proven) · 029 applies on real PG (bug fixed) ·
both revoke tests un-skipped and genuinely passing (audit row asserted) · PENDING empty · drift
guard still catches drift · parity flipped to presence · full suite green serially. **Do not
self-certify mergeable** — fresh evaluator owes the re-verification above.

## Out of scope (untouched, per SPRINT)
Token encryption; the Basiq webhook signature; the transaction audit-snapshot (Session C). No
feature work; no migration squashing; the only runner change is the 030 special-case.

# EVALUATION-7 — Session C FIX (migration 033 + softDeleteLedger) — adversarial QA

> Evaluator stance: **skeptical**. EVALUATION-6 verified the runner, token-crypto, and Basiq-webhook
> fixes solid and BLOCKED the merge on ONE thing: the `softDeleteLedger` audit-atomicity proof was
> vacuous (the op wrote `status='deleted'`, which `ledger_status` forbade on both backends, so it threw
> before any audit write). This evaluation verifies the DELTA (migration 033 + the read-path change)
> closes that blocker without new breakage, and confirms the three already-solid fixes are undisturbed.
> Everything re-derived from git, my OWN throwaway PostgreSQL 18.3, and my OWN sql.js.

**Branch:** `feat/fail-closed-hardening` @ `2ee08a1`
**True base:** `git merge-base origin/main HEAD = 1f32509` (confirmed). EVALUATION-6 commit = `82bd696`.
**Delta under review:** `82bd696..HEAD` (5 commits): migration 033, runner special-case, getLedger
hiding, the real proof, docs.

## VERDICT: **DELTA VERIFIED — closes the EVALUATION-6 blocker, no regressions** (one real, tracked residual)

The blocker is definitively closed: `ledger_status` now permits `'deleted'` on both backends, the
operation works end-to-end, and the atomicity proof is now REAL (reaches the audit write; non-vacuity
re-proven by unwrap→RED→revert) on SQLite **and** real PG. The SQLite table-recreate — the riskiest
artifact — is faithful and FK-safe on both the fresh (test) and populated (self-host upgrade) paths.
The three EVALUATION-6-verified fixes are byte-unchanged. Scope, skips, and history are clean.

The one substantive finding is the **OAuth residual** (§4): soft-delete is hidden from the by-id read,
the owner list, and API-key access, but a pre-existing unexpired OAuth token still reaches the deleted
ledger's sub-resources. It is REAL, was explicitly flagged out-of-scope by the build, does NOT
reintroduce the EVALUATION-6 blocker, and is tracked — but it means "soft-delete fully ISOLATES the
ledger" is **not yet true**. It should be the top post-merge follow-up (and a hard gate before OAuth
third-party access is GA).

---

## Suite (independent, forced, serial)
`pnpm test --force --concurrency=1` → `Cached: 0 cached, 12 total` (genuinely re-executed): **core 501 ·
mcp 44 · api 112 (5 skipped) · sdk 35 = 692 pass / 5 skip / 0 fail.** `Tasks: 12 successful`. Grep for
`fail.?open|no such table|Tier schema not ready` = **0**. `pnpm typecheck --force` → **9/9**, no errors.
Delta vs base: **+2 tests** (softDeleteLedger happy-path +1, parity-033 +1); skips unchanged at 5.

---

## 1. SQLITE LEDGERS TABLE-RECREATE — **CONFIRMED SOLID** (highest risk)

**Fidelity (source + empirical).** Independently enumerated the true pre-033 `ledgers` shape: 001's 12
columns + 019's 4 `ADD COLUMN`s = 16, no other `ALTER TABLE ledgers` anywhere. The 033 `ledgers_new`
reproduces all 16 in identical order with identical type/NOT NULL/default — verified column-by-column
via `PRAGMA table_info` (incl. the `strftime(...)` defaults on created_at/updated_at and DEFAULT 'AU' /
'07-01' / 'accrual' on the 019 columns). The **only** change is `'deleted'` added to the status CHECK.

**No silently-dropped object.** Enumerated EVERY object attached to `ledgers` across ALL migrations
(catching multi-line defs): indexes `idx_ledgers_owner` (001) and `idx_ledgers_owner_status` (028, a
two-line CREATE), trigger `trg_ledgers_updated_at` (001); no views. 033 recreates **all three** — and I
confirmed the trigger actually fires (an UPDATE bumps `updated_at` off a stale value).

**Fresh apply (the test path — PRAGMA stripped, FK ON, empty DB).** Built from the manifest: 16
columns, both indexes, the trigger; `status='deleted'` accepted, `active`/`archived` accepted, `bogus`
rejected.

**Populated recreate (the real self-host upgrade — 033 applied VERBATIM, PRAGMA honored).** On a
pre-033 DB with a ledger (non-default currency/jurisdiction/tax_id/status) + child rows (account,
api_key, transaction): the ledger row survived **byte-identical**, all children survived, `PRAGMA
foreign_key_check` returned **CLEAN** (no orphans), child FKs resolve to the NEW table (good ref
inserts; bad `ledger_id` rejected), `UPDATE status='deleted'` works post-migration, and
`foreign_keys` is back ON at the end.

**The PRAGMA-in-transaction trap.** Read the runtime SQLite runner
([packages/api/src/index.ts](packages/api/src/index.ts) `applySqliteMigrations`): it applies each file
with a bare `await db.exec(sql)` — **NO** transaction wrapper — and `SqliteDatabase.exec` is a raw
sql.js `exec`. So the migration's `PRAGMA foreign_keys=OFF` is honored, not a no-op. I confirmed the
PRAGMA is **load-bearing**: applying 033 with PRAGMA stripped on a POPULATED DB throws `FOREIGN KEY
constraint failed` (and leaves the original tables intact — fails closed, no cascade-corruption). The
test fixture strips PRAGMA but only ever builds a FRESH-empty DB, so it exercises the **same final
schema** as runtime; the FK-handling divergence is invisible on an empty DB (nothing to cascade) and I
covered the populated path separately. **Severity:** PG is the launch target (§2), so any
SQLite-populated concern is self-host-only; the fresh SQLite path (which the suite depends on) is
correct. No defect found.

## 2. REAL-PG 001–033 — **CONFIRMED SOLID** (my own UTF-8 cluster, `:55493` / `/c/pgeval7`)
Ran the real production entrypoint against a throwaway UTF-8 cluster (distinct port/datadir from the
build): **A** fresh → `33 applied / 0 / 0`, server **RUNNING**, `Applied PostgreSQL migration:
033_…` present; **B** re-run → `0 applied / 33 skipped / 0`, **RUNNING** (idempotent); **C**
`SELECT … FROM pg_enum` → `ledger_status = active,archived,deleted` (exactly 3, in order); **D**
`'deleted'::ledger_status` casts. 033's `ALTER TYPE` applies via its special-case (the `if (migName
=== "033…")` branch precedes the generic file-read with `continue`; the catch reuses the
EVALUATION-6-verified `isDuplicateValueError`, swallowing only SQLSTATE 42710). The api/index.ts delta
since EVALUATION-6 is **purely additive** (+17, the 033 block only). Migration files **006/014/028/030**
are byte-unchanged vs base.

## 3. softDeleteLedger PROOF NOW REAL — **CONFIRMED SOLID** (the blocker)
`tests/audit-fail-closed.test.ts` now passes 5/5. The nested test asserts `failing.auditAttempts > 0`
— the audit write is genuinely REACHED (it was 0 in the vacuous EVALUATION-6 version, where the op died
on the CHECK first). Injecting the audit-INSERT failure on the nested
`softDeleteLedger → revokeApiKey` rolls back the WHOLE unit: ledger stays `active`, BOTH keys stay
`active`, no `'deleted'`/`'revoked'` audit rows. **Non-vacuity re-proven independently:** I unwrapped
`softDeleteLedger`'s `this.db.transaction(...)` → the nested test went RED (`expected 'deleted' to be
'active'`) → reverted (engine byte-clean). The happy-path test asserts `status==='deleted'` and that
the ledger is hidden. I additionally re-ran the real-PG engine happy-path (scenario D of the committed
harness): on real Postgres softDeleteLedger deletes, hides via getLedger, drops from the owner list,
keeps the other ledger, revokes the key, and writes the `'deleted'` audit row — all PASS.

## 4. READ-PATH HIDING — **CONFIRMED for the primary surfaces; REAL OAuth residual (tracked, needs-fix)**
- `getLedger` now treats `status='deleted'` as not-found. Its only callers are the GET
  `/v1/ledgers/:id` route (→ 404, correct) and `softDeleteLedger`'s own pre-check (ledger is still
  active there) — **no internal caller is broken**.
- The owner list (`findLedgersByOwner`) filters `status='active'`; `validateApiKey` is active-only and
  the delete revokes the ledger's keys → **API-key access blocked** (proven by the happy-path test).
- **RESIDUAL (empirically sized):** the hiding is achieved by getLedger + owner-list filter + key
  revocation — **not** by status-filtering across read methods. `validateOAuthToken`
  ([oauth-scopes.ts:108](packages/api/src/lib/oauth-scopes.ts)) checks token expiry/revocation/scope
  but **not ledger status**, and `softDeleteLedger` never touches `oauth_tokens`. I demonstrated: after
  soft-delete, `getLedger` is hidden, BUT (a) an existing OAuth token STILL validates for the deleted
  ledger, and (b) `listAccounts` (and by the same `SELECT * FROM ledgers WHERE id=?`-with-only-`if
  (!row)` pattern, every other sub-resource: listTransactions, statements, etc.) STILL returns the
  deleted ledger's data. The admin-secret path (`adminAuth` → those same methods) bypasses it too.
- **Sizing:** REAL partial isolation gap on a less-common path (a previously-authorized, unexpired
  OAuth token; bounded by token lifetime). It does NOT reintroduce the EVALUATION-6 blocker (the proof
  is real, the op works), and the build explicitly flagged "OAuth tokens are not revoked on delete" as
  out-of-scope. But it means **"soft-delete fully isolates the ledger" is not yet true** — a deleted
  ledger remains readable/writable via OAuth or admin. **needs-fix follow-up** (revoke OAuth grants on
  delete and/or status-check in `validateOAuthToken`/read methods); hard gate before OAuth GA. Not a
  blocker for THIS delta's purpose.

## 5. DELTA DID NOT DISTURB THE THREE SOLID FIXES — **CONFIRMED SOLID**
`git diff 82bd696..HEAD` of `crypto/tokens.ts`, `bank-feeds/*`, and `core/src/index.ts` is **empty**
(byte-unchanged). The only `api/src/index.ts` change is the additive 033 block — the runner fail-closed
logic (`isDuplicateValueError`, `failed>0` abort, `main().catch → exit(1)`) is untouched.
`token-crypto.test.ts` + `basiq-webhook.test.ts` = **22/22** pass.

## 6. SCOPE / SKIP / HISTORY — **CONFIRMED SOLID**
Delta = 14 files, all in the allowed set: 033 PG+SQLite migrations (added), manifest (033 added only;
**PENDING stays `[]`**), runner special-case, `getLedger`, the `LedgerStatus` union + `ledgerStatus`
zod enum, the 2 test files, SPRINT/HANDOFF, and the proof scripts (`eval-033-pg-proof.sh` +
`eval-033-softdelete-pg.mjs` added, `runner-failclosed-proof.sh` count-bumped 32→33). **No other
migration file changed** (only 033 vs base). `commitCsvImport` is byte-untouched (bounded out). Skips
still **5** (`describe.skip` benchmark ×4 + oauth "lists active connections" ×1); no `.only`/`xit`; the
+2 tests both assert real paths (happy-path + parity). Commit subjects clean — **no stray `@`**.
Cumulative branch diff coherent.

## 7. TRACKED FOLLOW-UPS — confirmed documented (note, don't fix)
- **OAuth-not-revoked-on-delete** (§4) — HANDOFF; the real isolation residual. *(Highest priority.)*
- **Stripe-Connect webhook-secret decrypt** — `getStripeConnectionByAccountId` returns `webhook_secret`
  undecrypted (byte-unchanged by this branch); HANDOFF §flags. Gate before Stripe-Connect GA.
- **commitCsvImport atomicity** — only remaining non-atomic audit path; HANDOFF + EVALUATION-6 §10.

---

## Rubric (8 + fail-closed + test/prod parity; **test/prod parity and SQLite-recreate fidelity weighted**)
| Dimension | Score | Evidence |
|---|---|---|
| Correctness | PASS | 033 correct on both backends (real-PG enum + cast; sql.js CHECK); recreate faithful; softDeleteLedger works end-to-end on SQLite + real PG. |
| Test coverage | PASS | Proof now REAL (auditAttempts>0) and non-vacuous (unwrap→RED→revert); +2 tests assert happy/failure paths; nothing weakened. |
| Auth | PASS (delta) | API-key access blocked on delete (revoke + active-only). OAuth/admin residual flagged §4 (tracked). |
| Fail-closed | PASS | Audit atomicity genuinely proven (nested full rollback); runner abort logic untouched. |
| **Test/prod parity (weighted)** | **PASS** | Fixture (fresh, PRAGMA-stripped) and runtime (fresh, PRAGMA-honored) yield the SAME schema; real-PG 001–033 matches; runner not transaction-wrapped so the migration's PRAGMA is honored at runtime. |
| **SQLite recreate fidelity (weighted)** | **PASS** | 16 columns exact (type/NOT NULL/default); all 3 attached objects rebuilt; populated recreate byte-identical with clean `foreign_key_check`; PRAGMA load-bearing + runner-compatible. |
| Error handling | PASS | 033 special-case rethrows non-42710; recreate fails closed if PRAGMA absent (no cascade-corruption). |
| Maintainability | PASS | Single-source manifest intact; recreate documents + rebuilds every attached object; comments accurate. |
| Security/immutability | PASS (delta) | No regression to the verified fixes. OAuth residual = isolation gap, tracked §4/§7. |
| Docs/handoff | PASS | 033 + read-path decision + test status documented; all 3 follow-ups tracked. |

## Standing launch precondition (carried)
Provision a **FRESH empty UTF-8 Postgres** volume at launch (033's `ALTER TYPE` and 028's
non-idempotent triggers assume a clean first-boot apply). PG is the launch target; the SQLite
populated-upgrade path is correct but self-host-only.

## Bottom line
The EVALUATION-6 blocker is **closed and independently re-verified** — schema fixed via 033 (proven on
real PG twice + sql.js fresh/populated), softDeleteLedger works, the atomicity proof is genuine and
non-vacuous, the riskiest artifact (the FK-laden SQLite recreate) is faithful and FK-safe, and the
three prior fixes are undisturbed with clean scope/history. The 033 delta is **sound and ready to
merge**, subject to (1) the tracked follow-ups — chiefly **OAuth-revoke-on-delete**, since soft-delete
does not yet fully isolate the ledger — and (2) the fresh-empty-UTF-8-volume launch precondition.

# EVALUATION-5 — Launch migration registration (028/029/030) — adversarial QA

> Written as `EVALUATION-5.md` (this repo versions evaluations; `-`/`-2`/`-3` cover PR #1,
> `-4` covers PR #2 / migration-integrity). Evaluator stance: skeptical. Every headline claim
> was re-derived from git and from my OWN throwaway Postgres — the build's self-report was
> distrusted throughout.

**Branch:** `feat/launch-migrations` @ `91d2263`
**True base:** `git merge-base origin/main HEAD = 84a89d5` (`Feat/migration integrity (#2)`).
Local `main` was NOT trusted; the base was recomputed. All diffs below are `84a89d5...HEAD`.

**VERDICT: MERGEABLE** — subject to the standing LAUNCH PRECONDITION (provision a FRESH empty
Postgres volume; do NOT reattach the dormant volume) and the non-blocking backlog item in §10.
All 10 audit items independently verified solid; the only findings are documentation-accuracy
nits and a pre-existing runner-robustness gap explicitly scoped out as "note, don't fix."

---

## Suite (independent, forced, serial)
`pnpm test --force --concurrency=1` → `Cached: 0 cached, 12 total` (genuinely re-executed, not
replayed): **core 474 · mcp 44 · api 110 (6 skipped) · sdk 35 = 663 passing, 6 skipped, 0 failed.**
`Tasks: 12 successful, 12 total`. Grep for `no such table: usage_tracking` / `Tier schema not
ready` / `failed` / fail-open = **0**. Matches the HANDOFF's 663 / 6-skip / 0-fail exactly.

---

## 1. INDEPENDENT FRESH-PG APPLY — CONFIRMED SOLID (headline DoD)
Stood up my OWN throwaway cluster, deliberately on a **different port + data dir** than the build
(build: `:55432`/`kounta_proof`; mine: **PostgreSQL 18.3**, `initdb` → `pg_ctl` on **`:55440`**,
data dir `C:\pgeval5`, DB `kounta_proof_eval5`). Pointed the **real production entrypoint**
(`node packages/api/dist/index.js` with `DATABASE_URL=postgres://postgres@localhost:55440/kounta_proof_eval5`)
at the empty DB.

- **Run #1 (empty):** `Migrations: 32 applied, 0 skipped, 0 failed`. Full runner log grepped for
  `failed:|error|cannot|does not exist|continuing|warn|skipping|not found` → **ZERO matches.** A
  green boot was NOT taken as proof; the schema was inspected directly (below).
- **`_migrations` = exactly 32 rows**, `001_initial_schema.sql` … `032_review_items.sql`, no gaps,
  no dupes — including the file-less virtual `002_audit_action_updated.sql` (applied inline).
- **`audit_action` enum** = `{created, reversed, archived, updated, revoked, deleted}` — exactly the
  six expected.
- **029 schema EXISTS (a swallowed CREATE would leave it missing):** all four AP tables
  (`vendors`, `bills`, `bill_line_items`, `bill_payments`) present; the FK that previously failed,
  **`vendors_ledger_id_fkey`, is actually built** (along with all 12 AP FKs); every id/FK column is
  `text`. (My adversarial "non-text id" query flagged `bills.amount_paid = integer` — a false
  positive: the SQL `_` in `LIKE '%_id'` is a wildcard so "paid" matched; `amount_paid` is a money
  integer, not an id.)
- **`usage_tracking`** has `bills_count` + `vendors_count` (both `integer`).
- **028 EXISTS:** both immutability triggers (`trg_audit_no_update`, `trg_audit_no_delete`) + the
  `prevent_audit_modification()` function; and **all 17** of 028's perf/functional indexes are
  present (none silently dropped — 028's CREATEs reference 001–027 columns).
- **Re-run #2 (same DB):** `Migrations: 0 applied, 32 skipped, 0 failed` — genuinely re-runnable via
  the `_migrations` table.
- **Original prod bug GONE:** `INSERT INTO audit_entries (… action='revoked')` **and**
  `action='deleted'` both succeed; an `UPDATE audit_entries` and a `DELETE FROM audit_entries` are
  **rejected** by the 028 triggers (`audit_entries is append-only: UPDATE/DELETE operations are
  forbidden`); the row is left intact.
- **Teardown:** `pg_ctl -m fast stop`; **no stray `postgres` processes**, **nothing listening on
  3998/3999**, data dir removed.

**Swallow-trap analysis (the reason this item matters).** I read the runner. The generic path
(`index.ts:427-439`) runs `db.exec(file)`; only on success does it INSERT `_migrations`, print
`Applied`, and `applied++` — a throw goes to `catch { console.error("… failed (continuing)"); failed++ }`.
`PostgresDatabase.exec` = `client.query(sql)`, so a multi-statement file is one implicit txn; the
old broken-029 FK error would have surfaced as **`failed: 1` + a logged error**, not a silent
"32 applied" (that is presumably how it was caught). The genuinely-silent swallow is the
special-case branch's `catch { /* already exists */ }` (§10) — which is why I verified the schema
objects directly rather than trusting the count.

## 2. THE 029 IN-PLACE FIX (091b5a0) — CONFIRMED SOLID
- **Premise holds (in-place edit is therefore correct, not a forward fix-up):** 029 was introduced
  in `bff7abb` (an ancestor of the base). `git log -S "029_bills" -- api/src/migrations.ts
  api/src/index.ts` across **all** history = **empty**: the stem never appeared in any production
  runner list. At PR #1 (`5e5db87`) the hardcoded list explicitly skipped it ("028–030 are
  intentionally NOT registered yet"); the manifest (created at base) only ever held 029 in
  `PENDING` until this sprint. So **no persistent DB ever applied the broken version** — there is no
  real environment carrying it, so an in-place edit is the right call (a forward fix-up would only
  be needed if some live DB had already run the broken 029).
- **Completeness/correctness:** all **16** `UUID`→`TEXT` tokens are id/PK/FK columns; the PG file
  now has **zero** remaining `UUID` (only the explanatory comment). Every referenced PK
  (`ledgers.id`, `accounts.id`, `transactions.id`, `vendors.id`, `bills.id`) is `TEXT` — proven by
  the FKs actually building on real PG. The file now matches the **SQLite 029 dialect** and the
  001 schema-wide `TEXT PRIMARY KEY` convention. Nothing that should have stayed `UUID` was changed
  (money/quantity columns untouched).
- **It actually SHIPS:** the runner reads `.sql` from `findMigrationsDir()`. Prod uses
  **`Dockerfile:72  COPY packages/core/src/db/migrations packages/core/migrations`** — the edited
  source file is copied **verbatim** (no `tsc` transform on `.sql`); the dev/dist path resolves the
  same source dir. There is **no shadow/stale copy** (only the two source files exist; `dist/` holds
  no migrations). So the edit ships regardless of deploy path.
- **Consistency:** 030/031/032 reference neither bills/vendors nor `UUID`; bill/vendor ids are
  generated by the same `generateId()` (UUID-v7 **string**) as every entity; no zod `.uuid()`
  validator constrains AP ids; 028 carries **no** bills/vendors index (those tables postdate 028 —
  their indexes live in 029, all present on real PG). `TEXT` is transparent to the TS layer and
  strictly more permissive than `UUID`.

## 3. MANIFEST LIST EQUALITY — CONFIRMED SOLID (membership AND order)
Reconstructed both lists from base and diffed programmatically:
- BASE `REGISTERED` = 29, `PENDING` = `{028,029,030}`. HEAD `REGISTERED` = 32, `PENDING` = `[]`.
- `EXPECTED(base with 028/029/030 inserted right after 027) === HEAD REGISTERED` (ordered) → **true.**
- Added to REGISTERED: **exactly** `{028,029,030}`; removed: **none**; all base entries keep their
  relative order; positions `027@26, 028@27, 029@28, 030@29, 031@30` (contiguous, after 027, before
  031). `002_audit_action_updated` (PG-virtual) intact in REGISTERED and in the derived PG list
  (`registeredPgMigrationFiles()` includes `002_audit_action_updated.sql`). Derived PG + SQLite
  lists both length 32. `api/src/migrations.ts` is **byte-unchanged** and still derives from the
  manifest (not hand-edited). This matches my live apply (001–032 in order).

## 4. RUNNER CHANGE ISOLATION — CONFIRMED SOLID
`index.ts` diff = **one hunk, +20 / -0** (purely additive). The 030 branch (`index.ts:405-417`) is a
structural **byte-mirror** of 017 (`:356-369`): `if (migName === "030_…sql")` → each `ALTER TYPE
audit_action ADD VALUE IF NOT EXISTS '…'` as its **own** `db.exec()` (autocommit) inside
`try { } catch { /* already exists */ }`, then the identical `INSERT INTO _migrations … ON CONFLICT
DO NOTHING`, `console.log(Applied)`, `applied++`, `continue`. Targets the correct enum
(`audit_action`) with `updated`/`revoked`/`deleted` (`updated` idempotent from 002). With 0
deletions, the back-fill anchor-probe and the generic apply path are byte-identical to base
(confirmed: probe region absent from the diff).

## 5. ENGINE COMMENT-ONLY — CONFIRMED SOLID
`engine/index.ts` diff = **one hunk; every changed line is a comment.** No code body changed
(`revokeApiKey`/`softDeleteLedger`/`writeBankTxnAudit` bodies absent from the diff). The comment is
**accurate and type-enforced**: `writeBankTxnAudit`'s signature is literally
`action: "archived" | "updated"` (the restriction is compile-time, not a runtime workaround), while
`revokeApiKey` writes `'revoked'` directly (`:1699`) and `softDeleteLedger` writes `'deleted'`
directly (`:1738`) — exactly as the new comment states (deliberate staging-mirror semantics, fixed
by 030 itself, not a 030 workaround). No behavioural change.

## 6. DRIFT GUARD, BOTH DIRECTIONS, PENDING EMPTY — CONFIRMED SOLID
Exercised against the **real** on-disk guard:
- **(a)** Dropped a real `033_eval_unregistered.sqlite.sql` into the migrations dir → guard **RED**,
  `unregisteredSqlite: ["033_eval_unregistered.sqlite.sql"]`. This proves `PENDING=[]` does **not**
  create a hole — a brand-new unregistered file is still caught.
- **(b)** Added `"098_phantom_registered"` to `REGISTERED_MIGRATIONS` (no file) → guard **RED**,
  `missingSqlite` + `missingPg` both list it.
- Removed both → **5 passed**, working tree clean, manifest byte-identical to HEAD.

## 7. SKIP / ASSERTION AUDIT + UN-SKIP RIGHT-REASON — CONFIRMED SOLID
- Base had **5** skip statements; HEAD has **3**. The −2 are **exactly** `it.skip("revokes an API
  key")` (api) and `it.skip("revokes an API key (admin)")` (sdk). The remaining 3 (`benchmark`
  `describe.skip`, `includes snapshots in audit entries`, oauth `lists active connections`) are
  pre-existing and unchanged (the benchmark `describe.skip` expands to 4 tests → 6 skipped total).
- No assertions stripped: `expect()` deltas are api **+2**, sdk **+1** (the new audit-row reads),
  migration-parity **0** (flipped in place). Only 4 test files changed (api, sdk, parity, drift);
  benchmark/oauth/all core tests untouched.
- **Right-reason proof (the strongest available):** I made `revokeApiKey` write a *valid-but-wrong*
  audit action (`'revoked'`→`'archived'`) and **rebuilt core** (api/sdk tests import the built core
  dist, not src — see note). The HTTP call still returns 200 and the api_key `status` is still
  `revoked`, so a "merely-200" test would PASS — yet **both** revoke tests went **RED** with
  `AssertionError: expected 'archived' to be 'revoked'`. They genuinely read the audit log back and
  assert `action='revoked'`. Reverted + rebuilt; both green again; tree clean.
  *Note:* api/sdk tests resolve `@kounta/core` to `packages/core/dist` (no src alias), so
  cross-package correctness depends on a core rebuild — `pnpm test` (turbo) does this first, so the
  headline 663 is valid, but a bare `vitest run` without a rebuild tests stale code.

## 8. PARITY ASSERTIONS NON-VACUOUS — CONFIRMED SOLID
`buildFromProductionList()` applies the registered `.sql` from disk via sql.js. I broke the
**schema** (not the test): commented out 029's `usage_tracking` ALTERs and removed `revoked`/
`deleted` from 030's SQLite CHECK. Result: exactly the two corresponding assertions went **RED**
(`expected [...] to include 'bills_count'`; `expected '…audit_entries…' to contain ''revoked''`)
while **"029: bills/vendors tables exist" stayed green** — proving the presence assertions are both
specific and non-vacuous. Reverted → 6 passed; tree clean.

## 9. SCOPE ADHERENCE — CONFIRMED SOLID
`git diff 84a89d5...HEAD`: **10 files, all MODIFIED; 0 added, 0 deleted, 0 renamed** (nothing
squashed). Every file is in allowed scope: manifest, api runner (030 branch only), engine comment,
`029_bills.sql`, parity assertions, drift guard, the 2 revoke tests, HANDOFF.md, SPRINT.md.
- **029_bills.sql is the ONLY migration file whose contents changed** (`git diff --name-only … --
  migrations/*` = just that one).
- **Session C areas untouched:** filename grep for `crypto|token|basiq|webhook|snapshot|encrypt`
  over the diff = empty.
- **"3 new doc files" claim is UNSUPPORTED:** the branch added **zero** files (and the tree has no
  untracked files). HANDOFF.md and SPRINT.md are **modifications** of files that have existed since
  PR #1 (`5e5db87`); EVALUATION-4.md predates the base (`84a89d5`). There are no new doc files —
  the build produced 2 modified docs, not 3 new ones.

## 10. RUNNER ROBUSTNESS — FLAGGED (Session C / backlog; "note, don't fix")
The swallow-and-continue is real and has two shapes:
- **Generic path** (`index.ts:436-439`): a failing file logs `… failed (continuing)` and `failed++`
  but the **server still boots against a half-migrated schema**, and the file is **never recorded in
  `_migrations` so it is retried every boot** — i.e. a deterministically-broken migration (like
  old-029 on PG) leaves the feature "mounted-but-dead" indefinitely while the process serves traffic.
- **Special-case path** (017/020/022 **and the new 030**): `catch { /* already exists */ }` swallows
  **every** exception with **no log and no `failed++`**, then **unconditionally** records the
  migration as applied + prints `Applied` + `applied++`. Here a genuinely-broken `ALTER TYPE` reads
  as **"applied / 0 failed"** with no error — the exact "an applied count can hide a broken
  migration" trap. Independent schema inspection (which I did — enum has all six values, the INSERT
  works) is currently the **only** thing that would catch it.

The 030 branch faithfully mirrors the existing 017/020/022 pattern (as the sprint required), so this
is **not a regression introduced here** — but it is a latent gap. Recommend for Session C
fail-closed hardening: **abort boot (non-zero exit / failing healthcheck / alert) on any migration
failure** rather than silently continuing, and **narrow the special-case `catch`** to the real
"already exists" condition (check the PG error code) instead of swallowing all errors. This sits
with EVALUATION-4's Obs. 3 (the back-fill anchor-probe is a separate hardcoded 001–027 list the
drift guard does not cover; pre-existing, byte-unchanged, moot on a fresh DB).

---

## Rubric (Kounta: standard 8 + fail-closed + test/prod parity — parity weighted, per this sprint)
| Dimension | Score | Evidence |
|---|---|---|
| Correctness | PASS | 32/0/0 on real PG, schema verified object-by-object; re-runnable 0/32/0; suite green forced/serial. |
| Test coverage (hard blocker) | PASS | Un-skips proven right-reason (valid-but-wrong action → both RED); parity presence assertions proven non-vacuous; drift guard RED in both directions. No assertion weakened. |
| Auth (hard blocker) | PASS | Out of scope here and untouched; revoke path now audits correctly (`revoked` row written + asserted). |
| Fail-closed (hard blocker) | PASS (with §10 note) | 0 fail-open in forced run; 028 append-only triggers reject UPDATE/DELETE on real PG. Runner swallow-and-continue flagged as backlog (not introduced here). |
| **Test/prod parity (hard blocker, weighted)** | **PASS** | One manifest derives runner + every fixture; my fresh-PG apply exercised the real `ALTER TYPE`/FK paths sql.js cannot, and matched the fixtures' presence assertions. Membership AND order equal base+{028,029,030}. The PG-only 029 bug is exactly the class this weighting exists to catch — caught and fixed. |
| Error handling | PASS | Drift guard emits actionable detail; special-case `catch` over-broad (§10). |
| Maintainability | PASS (nits) | Single source of truth intact. Stale comments: `api/src/migrations.ts:17-19` and `migration-drift.test.ts:10-14` still describe 028/029/030 as PENDING — code is correct (runtime-derived), comments are not. |
| Security/immutability | PASS | 028 immutability now ships and is enforced on real PG (UPDATE+DELETE rejected); audit `revoked`/`deleted` now accepted. |
| Docs/handoff | PASS (nits) | HANDOFF accurate on substance; "silently dropped" slightly overstates the generic path (it logs `failed: 1`); the eval prompt's "3 new doc files" is unsupported (0 files added). |

**Hard blockers (test-coverage, auth, fail-closed, test/prod parity): all PASS.**

## Observations (non-blocking)
- **Obs. 1 — stale comments.** `packages/api/src/migrations.ts:17-19` and
  `packages/core/tests/migration-drift.test.ts:10-14` still call 028/029/030 "PENDING / not
  registered." Behaviour is correct (both derive from the manifest at runtime / the test body was
  updated), but a reader could be misled. One-line doc fixes.
- **Obs. 2 — runner robustness (§10).** Swallow-and-continue; special-case `catch {}` can mark a
  broken `ALTER TYPE` as applied. Session C / backlog, per scope.
- **Obs. 3 — back-fill anchor-probe list** (carried from EVALUATION-4 Obs. 3) is a second hardcoded
  001–027 list not covered by the drift guard. Pre-existing, byte-unchanged, moot on a fresh empty
  DB.
- **Obs. 4 — test build coupling.** api/sdk tests run against the built core `dist`; correctness
  relies on a prior core build (turbo handles it in `pnpm test`). Worth a note so a bare `vitest
  run` is not mistaken for a source-accurate run.

## LAUNCH PRECONDITION (standing — must hold for this verdict)
Provision a **FRESH empty Postgres volume** at launch; do **NOT** reattach the dormant prod volume.
Everything above rests on 001–032 applying to an empty DB on first boot (028's `CREATE TRIGGER` is
non-idempotent; the special-case `catch` would mask a re-apply failure; the back-fill probe would
run against legacy schema). Empty volume only.

## Bottom line
All 10 audit items independently re-derived from git and from my own throwaway PostgreSQL 18.3 —
**confirmed solid**. The PG-only 029 bug sql.js could not see is genuinely caught and fixed, the
edit genuinely ships via the Dockerfile source copy, the manifest extends the base by exactly
{028,029,030} in order, the runner change is an isolated byte-mirror of 017, the un-skips and parity
flips pass for the right reason (proven by breaking them), the drift guard catches drift in both
directions with PENDING empty, and scope is clean with nothing squashed. The only findings are
documentation nits and the pre-existing swallow-and-continue robustness gap (explicitly "note, don't
fix"). **MERGEABLE**, subject to the fresh-empty-volume launch precondition and the §10 backlog item.

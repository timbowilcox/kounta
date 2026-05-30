# EVALUATION-6 — Fail-closed hardening (Session C) — adversarial QA

> Evaluator stance: **skeptical**. Every headline claim was re-derived from git and from my
> OWN throwaway PostgreSQL 18.3 (scoop), on a **different port/datadir** than the build's script.
> For each fail-closed fix I INJECTED the failure and confirmed it REFUSES — not merely that the
> happy-path passes. The build's self-report (HANDOFF) was distrusted throughout.

**Branch:** `feat/fail-closed-hardening` @ `4973a6c`
**True base:** `git merge-base origin/main HEAD = 1f32509` (confirmed; expected `1f32509`). All
diffs below are `1f32509...HEAD`.

## VERDICT: **NOT MERGEABLE (one contained blocker + one tracked follow-up)**

Three of the four security fixes — **migration runner, token crypto, Basiq webhook** — are
independently verified fail-CLOSED and solid. The fourth (audit atomicity) is solid in **mechanism**
and proven fail-closed for **5 of its 6 wrapped ops + the snapshot**, BUT the one case the prompt
singled out as highest-value — the nested **`softDeleteLedger → revokeApiKey`** rollback — is
**NOT verifiable**: its injected-failure test is **vacuous** (it passes on a pre-existing
schema-constraint violation that fires *before* the audit write is ever attempted), and
`softDeleteLedger` is in fact **broken on both PostgreSQL and SQLite** (a pre-existing
`ledger_status` enum/CHECK bug). The transaction wrap added to it is harmless and correct, but its
fail-closed proof is fake and the operation it guards does not work.

Because the strict bar is "do not declare mergeable unless every item is independently verified,"
and this item is not, the branch is **not mergeable as-claimed**. The blocker is contained and the
remedies are small (see §1). The Stripe-Connect finding (§5) is real but out of this sprint's scope
— track it.

---

## Suite (independent, forced, serial)
`pnpm test --force --concurrency=1` → `Cached: 0 cached, 12 total` (genuinely re-executed):
**core 500 · mcp 44 · api 111 (5 skipped) · sdk 35 = 690 passing, 5 skipped, 0 failed.**
`Tasks: 12 successful`. Grep of the forced log for `fail.?open|no such table|Tier schema not ready`
= **0**. Matches HANDOFF's 690 / 5-skip / 0-fail exactly. `pnpm typecheck --force` → **9/9**, no errors.

---

## 1. AUDIT ATOMICITY — **NEEDS-FIX** (5/6 ops + mechanism solid; softDeleteLedger proof vacuous)

**Diff shape.** Engine diff is 309 lines, entirely the 6 `this.db.transaction()` wraps + the
postTransaction snapshot move. For each wrapped op I diffed vs base: the SQL strings, parameter
arrays, and return values are **byte-identical** to base; the change is the wrapper + indentation.
Two deliberate, justified exceptions to "pure reindentation":
- **`softDeleteLedger`** adds `const revoked = await this.revokeApiKey(key.id); if (!revoked.ok) throw …`
  (base ignored the revoke result). This is a *correct* fail-closed addition (a failed nested revoke
  now aborts the whole delete), not a regression.
- **`removeBankTransactions`** wraps the existing `for` loop in a transaction without re-indenting
  the body (cosmetic; functionally the loop is inside the transaction — its only audit writer
  `writeBankTxnAudit` is called at lines 3199/3209, inside the wrap).

No early-return was swallowed: `createAccount`'s `if (!row) return err(INTERNAL_ERROR)` is preserved
(translated to a sentinel throw `CREATE_ACCOUNT_NO_ROW` caught and re-`err`'d; any other error
rethrows → nothing commits).

**`postTransaction` snapshot — CONFIRMED.** Independent test: posted a balanced txn, read its
`audit_entries.snapshot`. It now contains the **full posted entity** — `snapshot.id` = txn id,
`snapshot.status === "posted"`, and `snapshot.lines` = 2 persisted lines each with `id`, `accountId`,
numeric `amount` (4242/4242). The bare `{memo, lines: input.lines}` of the base (input had
`accountCode`, no ids, no status) is gone.

**Injected rollback — CONFIRMED for revokeApiKey / createAccount / postTransaction.** The provided
`AuditFailingDb` wraps the real DB, throws on `INSERT INTO audit_entries`, and delegates
`transaction()` to the real connection (so BEGIN/COMMIT/ROLLBACK run for real while the audit insert
throws). The three tests assert the mutation did NOT persist.

**Non-vacuity proof (the strongest available).** I removed the `db.transaction()` wrap from
`revokeApiKey` (inlined the UPDATE + audit insert) and re-ran `audit-fail-closed.test.ts`: the
matching test went **RED** — `AssertionError: expected 'revoked' to be 'active'` — because without
the transaction the UPDATE commits before the audit throw. Reverted (engine diff byte-clean again).
So that test genuinely verifies rollback.

**Savepoint nesting MECHANISM — CONFIRMED.** Independent test: inside an outer `real.transaction`,
call `revokeApiKey` (which opens a nested transaction → SAVEPOINT, RELEASEd on success), then throw
to abort the outer txn. The key returns to `active` — a released inner savepoint is correctly undone
by the outer ROLLBACK. Both adapters implement nesting via SAVEPOINT (`postgres.ts:80-109`,
`sqlite.ts:69-101`) and rollback-on-throw.

**Every other engine audit write is atomic.** I inventoried all 12 `INSERT INTO audit_entries` in
`engine/index.ts` and confirmed each is inside an enclosing `this.db.transaction()`: createAccount
(1050), postTransaction (1292, pre-existing txn), reverseTransaction (1442, pre-existing),
revokeApiKey (1716), softDeleteLedger (1764), createImport (2608, pre-existing), confirmMatches
(2736, pre-existing), postPendingTransactions (2840, pre-existing), `writeBankTxnAudit` helper (3155,
only called inside removeBankTransactions's wrap), closePeriod (5104), reopenPeriod (5153). The lone
exception is **commitCsvImport** (3555) — see §10.

### ⛔ FINDING 1a — the `softDeleteLedger` injected-failure test is VACUOUS (blocker)
`softDeleteLedger` begins its transaction with `UPDATE ledgers SET status = 'deleted' …`. But the
`ledgers.status` domain forbids `'deleted'` on **both** backends:
- SQLite `001_initial_schema.sqlite.sql:56`: `CHECK (status IN ('active', 'archived'))`.
- PostgreSQL `001_initial_schema.sql:23`: `CREATE TYPE ledger_status AS ENUM ('active','archived')`.

No later migration ever adds `'deleted'` to `ledger_status` (grep of all migrations: the only
`'deleted'` is in 030's *audit_action* enum — a different column).

Independently proven:
- **SQLite (runtime):** `softDeleteLedger` throws `CHECK constraint failed: status IN ('active',
  'archived')` even with **no injection** — i.e. its happy path cannot succeed.
- **PostgreSQL (my cluster):** `SELECT 'deleted'::ledger_status` →
  `ERROR: 22P02: invalid input value for enum ledger_status: "deleted"`.

Consequence for the proof: the audit-failing test
(`audit-fail-closed.test.ts:150 "softDeleteLedger: ledger stays ACTIVE when its audit write fails"`)
uses `rejects.toThrow()` with **no message matcher** and does not assert `auditAttempts`. I confirmed
with my own probe that it throws on the `ledgers` CHECK/enum **before any audit insert is reached**
(`auditAttempts === 0`). So:
- It does **not** exercise the audit-write rollback it claims to.
- The **nested `softDeleteLedger → revokeApiKey` savepoint rollback** — explicitly the case the
  prompt asked to verify — is **never reached** (execution dies on the first statement). The key
  revocations are not exercised at all.
- `expect(led.value.status).not.toBe("deleted")` is trivially true (status never changed).

This is a genuine fail-closed-coverage defect in a sprint whose entire purpose is fail-closed proof,
**and** it surfaces a pre-existing broken endpoint: `DELETE /v1/ledgers/:ledgerId` (admin auth,
`api/src/routes/ledgers.ts:148→158`) is live and would **500 in prod** (22P02). The wrap itself is
harmless; the proof and the underlying op are not.

**Remedies (small, pick one):** (a) make `softDeleteLedger` set `status = 'archived'` (a valid
value) so the op works and the test becomes real — no migration needed; (b) extend `ledger_status`
with `'deleted'` — needs a migration, which this sprint scoped out, so defer; (c) at minimum rewrite
the vacuous test to actually reach the audit write (and explicitly flag `softDeleteLedger` as broken)
so the sprint stops claiming coverage it does not have. Until one is done, the audit-atomicity item
is **not fully verified**.

---

## 2. RUNNER FAIL-CLOSED ON REAL PG — **CONFIRMED SOLID** (re-proven independently)

Ran the **real production entrypoint** (`node packages/api/dist/index.js`, rebuilt from HEAD) against
my OWN throwaway clusters (PostgreSQL 18.3, `initdb` → `:55460` UTF-8 and `:55461` WIN1252, data dirs
`/c/pgeval6*` — distinct from the build's `:55450`/`/c/pgeval-failclosed`):

- **A — fresh empty UTF-8:** `Migrations: 32 applied, 0 skipped, 0 failed`, server **RUNNING**.
- **B — re-run same DB:** `0 applied, 32 skipped, 0 failed`, **RUNNING** (idempotent).
- **C — mid-list broken migration** (I injected a bad `SELECT` into `016`, *not* the last file like
  the build's script used): `30 applied, 0 skipped, 2 failed`, **exit 1**, logs `refusing to start`
  + `Fatal: server startup failed`, server did **NOT** serve. Proves the `failed > 0` check
  accumulates across the whole loop and aborts even when later migrations would succeed.
- **E — WIN1252 cluster:** exactly **006_multi_currency, 014_global_classifications,
  028_sql_review_fixes** fail → `29 applied, 3 failed`, **exit 1**. Independently reproduces the
  build's "3 silently-failing migrations" claim and validates that the new runner turns the silent
  drop into a **loud abort**.

**Special-case catch swallows ONLY the benign duplicate.** Captured real PG SQLSTATEs:
- duplicate `ALTER TYPE … ADD VALUE` → `42710 enum label "…" already exists` → `isDuplicateValueError`
  true → swallowed (correct).
- `ALTER TYPE does_not_exist ADD VALUE` (a non-duplicate enum error) → `42704 type "…" does not
  exist`, message lacks "already exists" → predicate **false** → **rethrown**.
- `ADD VALUE IF NOT EXISTS` on a dup is a NOTICE, not an error, so the catch is belt-and-suspenders.

Structural check (`index.ts:352-431`): each special-case `catch (e) { if (!isDuplicateValueError(e))
throw e; }` sits inside the per-migration `try`; a rethrow lands at `failed++` **before** the
`INSERT INTO _migrations`/`applied++`, so a non-dup failure is never marked applied and aborts boot.
`main().catch → process.exit(1)` (proven by C's exit 1).

**Encoding finding validated at the byte level.** `git diff` confirms **no migration file changed**
(006/014/028 PG+SQLite all byte-unchanged) — the runner did not dodge the artifact by editing files.
006/014/028 each contain non-ASCII UTF-8 (em-dashes, box-drawing `─`, `→` in comments), which a
WIN1252 cluster cannot accept — hence E. All 32 apply on UTF-8 (A). *Doc nit:* HANDOFF attributes
006's non-ASCII to "currency symbols €/£ in seed data"; it is actually box-drawing/em-dashes in
**comments** (and a `→` in 014). Substance (encoding artifact, prod is UTF-8) holds.

*Minor:* `isDuplicateValueError`'s `/already exists/i` message branch is broader than SQLSTATE 42710
in principle, but harmless here — the catches wrap only fixed `ALTER TYPE … ADD VALUE` statements,
whose only realistic errors are 42710 / 42704 / syntax, and the `INSERT INTO _migrations` is outside
the try.

---

## 3. TOKEN CRYPTO — **CONFIRMED SOLID** (security-critical)

Read every line of `crypto/tokens.ts`; **no path returns plaintext**. `git show 1f32509:…/tokens.ts`
confirms the removed fallbacks (`if (!key) return plaintext` in encrypt, `return stored` for any
non-`enc:` value in decrypt, `getEncryptionKey` returning `null`). New `getEncryptionKey()` throws
`TokenEncryptionError` on missing / non-64-hex key.

Independent standalone injection (against built dist, outside the test framework):
- no-key `encryptToken` → **throws**; no-key `decryptToken("sk_…")` → **throws** (does not return the
  plaintext); valid-key round-trip → lossless and envelope does not contain the secret;
  tampered ciphertext (flipped char) → **throws** (GCM auth); wrong key → **throws**; 64-char non-hex
  key → **throws**. The in-repo `token-crypto.test.ts` (10 real-crypto tests, no mocks) independently
  re-run green.

**Op-level, not boot-level (confirmed).** `getEncryptionKey` is called only inside
encrypt/decrypt; the only callers are Stripe-Connect connection **create** (`stripe/connection.ts:86-88`)
and **read** (`stripe/types.ts:154-157`). No module-top-level/boot call. `KOUNTA_TOKEN_ENCRYPTION_KEY`
appears in tests **only** in `token-crypto.test.ts` (set/unset per-test, restored), so the suite's
green does **not** depend on the key being silently absent — Stripe tests never touch the crypto path.

---

## 4. BASIQ WEBHOOK (Svix) — **CONFIRMED SOLID** — but it is **DEAD CODE** (scrutinise accordingly)

Independent Svix construction (fresh 32-byte key, hand-rolled HMAC, against built dist) — all as
expected:
- genuine signed event → **accept**; wrong body → reject; tampered signature → reject; missing
  `webhook-signature` → reject; **stale** ts (−301s) → reject; **future** ts (+301s) → reject (replay
  guard is `Math.abs`, both directions); empty secret → reject.
- **Raw-body proof:** sign body B, verify against a semantically-equal but re-serialized
  (key-reordered) body → **reject**. Confirms the HMAC is over the RAW bytes, not a re-encoded parse.
- `handleWebhook` end-to-end: valid → `{event, connectionId:"u_99", shouldSync:true}`; tampered →
  `{event:"invalid_signature", connectionId:null, shouldSync:false}` (zero side effects).

Compare is timing-safe (`timingSafeEqual` with a length guard before the compare; `basiq.ts:65-71`)
— not `==`/`===`. The in-repo `basiq-webhook.test.ts` computes signatures **independently** (raw
`createHmac(...).digest("base64")`, not by calling the verifier) → genuine signatures, not a
self-referential mock.

**Interface widening is clean and compiles.** `WebhookVerificationInput {rawBody, headers}` added;
`BankFeedProvider.handleWebhook` widened. **Mock** was *improved* not weakened — it now HMACs the
**raw body** (was `JSON.stringify(payload)`), still timing-safe; its no-secret "accept" path is
dev-only (constructor throws when `NODE_ENV==='production'`, `mock.ts:45-49`). **Plaid** stub still
`throw NOT_IMPLEMENTED`. `pnpm typecheck --force` → 9/9.

**⚠ Caveat the build also flagged, independently confirmed:** `grep` shows **no route calls
`handleWebhook`** — the Basiq verification is currently **dead code**. The unit test is the *only*
guard. The logic is correct, but it protects no live endpoint until someone wires a Basiq webhook
route and passes it the **raw** body + lower-cased headers. *Minor:* the verifier matches any
`vN,<sig>` prefix (takes the part after the comma), not strictly `v1` — not a security issue since
the HMAC must still match.

---

## 5. STRIPE-CONNECT WEBHOOK-SECRET — **REAL bug, correctly characterised; OUT OF SCOPE; TRACK IT**

Confirmed end-to-end:
- `getStripeConnectionByAccountId` (`engine/index.ts:2088-2094`) does a raw `SELECT … webhook_secret`
  and returns it **UNDECRYPTED** (`webhookSecret: row.webhook_secret`) — unlike `toStripeConnection`
  (`stripe/types.ts:157`) which *does* `decryptToken`.
- The Stripe-Connect webhook route (`api/src/routes/stripe-connect.ts:56-63`) HMAC-verifies with that
  value as the key.
- `createStripeConnection` encrypts the secret on store (`stripe/connection.ts:88`). With encryption
  now **mandatory** the stored value is always `enc:…`, so the route HMACs with the ciphertext →
  **every legitimate Stripe-Connect webhook is rejected (400)**.

Both `getStripeConnectionByAccountId` and the route are **byte-unchanged** by this sprint (pre-existing;
fix #2 merely flips the latent condition from "only when a key was set" to "always"). **Severity:** if
Stripe Connect ingestion is live for any launch tenant, this breaks **all** of its webhooks (fail-closed
/ safe, but the feature is dead); it does **not** block the core ledger launch. The route is wired
(unlike Basiq). **Fix** is essentially the claimed one-liner — `webhookSecret: row.webhook_secret ?
decryptToken(row.webhook_secret) : null` — *plus* an import of `decryptToken` into `engine/index.ts`
(not currently imported there). Needs its own test. Track before enabling Stripe Connect.

---

## 6. SCOPE ADHERENCE — **CONFIRMED SOLID**
`git diff 1f32509...HEAD --name-status` = **18 files, 13 Modified + 3 Added test files + … ** all in
the allowed set:
- api: `src/index.ts` (runner), `src/migrations.ts` (stale comment only), `tests/api.test.ts`
  (un-skip).
- core: `crypto/tokens.ts`, `bank-feeds/{basiq,mock,plaid,types,index}.ts`, `engine/index.ts`
  (6 wraps + snapshot), `src/index.ts` (+`TokenEncryptionError` re-export — the one extra file,
  trivially in-scope).
- new tests: `audit-fail-closed.test.ts`, `basiq-webhook.test.ts`, `token-crypto.test.ts`;
  `tests/migration-drift.test.ts` (stale comment only).
- `scripts/runner-failclosed-proof.sh` (new); `SPRINT.md`, `HANDOFF.md`.

Verified: **NO migration file changed** (`--name-only -- migrations/*` empty); `migration-manifest.ts`
**byte-unchanged** (028/029/030 registration untouched); **commitCsvImport bounded OUT** (untouched —
§10) and flagged in HANDOFF. Only docs touched are HANDOFF/SPRINT — **no memory file** and no
`CLAUDE.md`/other EVALUATION file was edited by the build.

## 7. SKIP / ASSERTION AUDIT — **CONFIRMED** (with the §1a caveat)
Skip lines base→head: base `{api: snapshot, api: benchmark describe.skip, oauth: lists active
connections}`; head drops **exactly** the snapshot one → 6 skipped tests → **5** (benchmark ×4 + oauth
×1). No `.only/xit/xdescribe/.todo` anywhere in HEAD tests. The un-skip was **strengthened** (filters
`entityType === 'transaction'`, adds `expect(entry).toBeDefined()`), `expect()` count `api.test.ts`
93→**94** (+1, none deleted); `migration-drift.test.ts` comment-only (10→10). The +26 new tests
(token 10, webhook 12, audit 4) are real failure-path assertions — **except** the `softDeleteLedger`
audit test asserts the wrong failure path (§1a).

## 8. COMMIT / HISTORY INTEGRITY — **CONFIRMED SOLID**
7 commits, all authored+committed by `timbowilcox`. Subjects clean — the only `@` is in the
`Co-Authored-By: … <noreply@anthropic.com>` trailer; no `<<<`/`>>>`/`@@` mangling; no empty commits.
Per-commit insertion/deletion sums (`149+112+303+258+147+40+75 = 1084` ins, `…= 350` del) equal the
cumulative `1f32509 HEAD` diff (**18 files, 1084 / 350**) exactly → nothing lost or duplicated in the
soft-reset/amend rebuilds.

## 9. NET-NEW ENV VARS FAIL CLOSED — **CONFIRMED**
- `KOUNTA_TOKEN_ENCRYPTION_KEY` absent → encrypt **and** decrypt throw (§3).
- `BASIQ_WEBHOOK_SECRET` absent → `handleWebhook` returns `shouldSync:false, connectionId:null`
  (`event:"webhook_secret_not_configured"`) (§4) — fails closed (though currently dead code).
Both **must be set in Railway** before launch (HANDOFF documents this).

## 10. ONLY REMAINING NON-ATOMIC AUDIT PATH — **CONFIRMED: `commitCsvImport`**
`commitCsvImport` (`engine/index.ts:3465`) runs `upsertBankTransactions → classifyPending… →
matchBankTransactions` and then a **bare** `this.db.run("INSERT INTO audit_entries …")` at line 3555
with **no enclosing `this.db.transaction()`** — a failed audit write leaves the import committed
without its row. All 11 other engine audit writes are inside transactions (§1). This is the lone
remaining non-atomic audit path; **flag for follow-up** (wrapping its heavy pipeline is a materially
larger change, correctly bounded out per the gate).

---

## Rubric (Kounta: standard 8 + fail-closed + test/prod parity — fail-closed weighted, per this sprint)
| Dimension | Score | Evidence |
|---|---|---|
| Correctness | **PASS (1 defect)** | Runner/token/basiq correct on real PG / real crypto. 5/6 audit wraps byte-identical + atomic; snapshot now full entity. Defect: `softDeleteLedger` op broken on both backends (pre-existing), its wrap unproven. |
| Test coverage (hard blocker) | **NEEDS-FIX** | Non-vacuity proven by breaking revokeApiKey (RED). Runner PG proof excellent. BUT the `softDeleteLedger` injected-failure test is **vacuous** — passes on a CHECK/enum violation before the audit write (`auditAttempts===0`); the nested case is never exercised. |
| Auth (hard blocker) | PASS | Out of scope; untouched. API-key revoke path now audits atomically (proven RED when unwrapped). |
| **Fail-closed (hard blocker, weighted)** | **MOSTLY PASS — 1 unverified** | Runner aborts boot non-zero on any failure (A/B/C/E on real PG); token never returns plaintext; Basiq rejects unsigned/tampered/stale with zero side effects. Nested `softDeleteLedger` rollback **unverifiable** (op broken). |
| Test/prod parity (hard blocker) | PASS | Real-PG runner proof exercises the `ALTER TYPE`/encoding paths sql.js can't; 32/0/0 on UTF-8, loud abort on WIN1252. The `ledger_status` mismatch in §1a exists identically on both backends (parity preserved — both reject `'deleted'`). |
| Error handling | PASS | Runner narrows the catch to 42710 and rethrows else; crypto/webhook return typed errors. |
| Maintainability | PASS | Single-source manifest intact; stale 028/029/030 comments swept (migrations.ts + drift test). |
| Security/immutability | PASS | Token crypto fail-closed (no plaintext); webhook HMAC timing-safe over raw body; audit writes atomic (except commitCsvImport, flagged). |
| Docs/handoff | PASS (nits) | HANDOFF accurate on substance. Nits: 006 non-ASCII is box-drawing/em-dashes in comments, not "€/£ in seed data"; HANDOFF claims its audit test proves softDeleteLedger rollback — it does not (§1a). |

**Hard blockers:** auth PASS, parity PASS, fail-closed mostly-PASS (1 unverified), **test-coverage
NEEDS-FIX**. One hard blocker is not green → not mergeable.

---

## What must happen before merge
1. **(blocker) Fix the vacuous `softDeleteLedger` proof + the broken op.** Simplest no-migration path:
   make `softDeleteLedger` set `status='archived'` (valid on both backends) so the op works and the
   audit-rollback / nested-savepoint test actually exercises the audit write; OR rewrite the test to
   reach the audit insert and explicitly flag `softDeleteLedger` as broken-pending-fix. Do not let the
   sprint claim audit-atomicity coverage it does not have.
2. **(track, out of scope)** Stripe-Connect webhook-secret decrypt at
   `getStripeConnectionByAccountId` (§5) — breaks all Stripe-Connect webhooks under mandatory
   encryption; fix + test before enabling Stripe Connect.
3. **(track, out of scope)** `commitCsvImport` audit atomicity (§10).
4. **(ops)** Set `BASIQ_WEBHOOK_SECRET` and `KOUNTA_TOKEN_ENCRYPTION_KEY` in Railway; provision a
   **fresh empty UTF-8** Postgres volume (carried standing precondition).

## Independent verification method (reproducibility)
- Suite: `pnpm test --force --concurrency=1` (0 cached) + `pnpm typecheck --force`.
- Runner: own scoop PG 18.3 clusters on `:55460` (UTF-8) and `:55461` (WIN1252), data dirs
  `/c/pgeval6*`; ran the real `packages/api/dist/index.js` for A/B/C/E; captured SQLSTATEs for the
  42710-vs-42704 catch boundary; `'deleted'::ledger_status` rejection on a separate `:55480` cluster.
  All clusters torn down; no stray `postgres` processes, no leftover data dirs.
- Audit/crypto/webhook: throwaway tests + standalone `node` injections against the built dist; the one
  scratch test file and scratch proof script I created were **deleted** — working tree is clean and
  byte-identical to `4973a6c` (the revoke-unwrap probe was reverted).

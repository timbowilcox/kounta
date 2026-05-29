# HANDOFF — Bank Data Ingestion: Mock Plaid Feed + Manual CSV Import

**Branch:** `feat/bank-ingestion-mock-plaid-csv`
**Date:** 2026-05-29
**Spec:** `SPRINT.md` (committed on this branch)
**Baseline:** 601 passing → **636 passing** (+35, no regressions)

---

## Status: COMPLETE

Both acquisition channels (mock Plaid feed + manual CSV import) converge on the
existing `bank_transactions` → classify → match pipeline through one
normalisation boundary. All SPRINT.md acceptance criteria are met with evidence.

### Test results (forced, no cache)

| Package | Passed | Skipped |
|---|---|---|
| @kounta/core | 456 | — |
| @kounta/api | 101 | 6 (pre-existing: 4 benchmark + 2) |
| @kounta/mcp | 44 | — |
| @kounta/sdk | 35 | — |
| **Total** | **636** | 6 |

`typecheck`: 9/9 packages clean. No new `any`, no `ts-ignore`.

---

## Acceptance checklist — all ticked, with evidence

### Mock Plaid feed
- [x] Implements existing `BankFeedProvider`; selected via `BANK_FEED_PROVIDER=mock`; **throws if `NODE_ENV=production`** — `bank-feeds/mock.ts`, `factory.ts`, API `getProvider`. Tests: `bank-feeds-mock.test.ts` ("throws when constructed in production", "factory builds the mock and refuses production").
- [x] Fixtures emit the real Plaid shape (`transaction_id, account_id, amount, iso_currency_code, date, name, merchant_name, pending, personal_finance_category`) — `bank-feeds/fixtures.ts`. Test: "emit the real Plaid shape".
- [x] `/transactions/sync` model — added/modified/removed + `next_cursor`, pagination, **pending→posted transition** — `getSyncPage`/`syncTransactions`. Tests: "returns added/modified/removed + next_cursor and paginates", "exercises a pending -> posted transition and a removal".
- [x] Single `normalizePlaidTransaction` boundary; normalised output equals expected Kounta records — `bank-feeds/normalize.ts`. Tests assert exact `toEqual` records (sign, cents, type, category).
- [x] Sync idempotent (dedup on `provider_transaction_id`) — end-to-end test "ingests the first sync, then applies modified/removed without duplicating" (3rd sync is a no-op).
- [x] Each fixture carries a ground-truth category label (accuracy-harness seed) — `labeledFixtures[].groundTruthCategory`. Test: "each carries a non-empty ground-truth category label".

### Manual CSV import
- [x] Upload in dashboard `/bank-feeds`; headers/quoted fields/BOM handled; **malformed rows surfaced, never dropped** — `import/csv-mapping.ts`, `csv-import.tsx`. Tests: "malformed rows are surfaced", "handles quoted fields … and strips a BOM".
- [x] User selects the ledger account — UI dropdown + `commitCsvImport({ ledgerAccountId })`.
- [x] Column-mapping: date, description, amount (single signed OR debit/credit), optional balance/reference/currency — `csvMappingSchema` + UI.
- [x] Date-format selector (default **DD/MM/YYYY**) + explicit sign-convention control — `parseDateStrict`, mapping schema. Tests: date-format + sign-convention cases.
- [x] Preview shows parsed rows + counts before any write; commit only on confirm — `previewCsvImport` (no writes). Test: "previews without writing, then commits".
- [x] Reusable per-bank mapping profiles — `mapping_profiles` table + CRUD. Test: "creates, fetches, updates, lists, and deletes … preserving the mapping".
- [x] **Cross-channel dedup** via line-fingerprint (date + amount + normalised description + account scope); overlapping re-import does not double-count — `commitCsvImport` + `existingFingerprintsForLedgerAccount`. Test: "does not double-count a manual row that overlaps a Plaid feed transaction".
- [x] Imported rows flow into the same classify + reconcile pipeline as feeds — `commitCsvImport` stages into `bank_transactions` then runs `classifyPendingBankTransactions` + `matchBankTransactions`.

### Shared
- [x] Both channels produce identical internal records for equivalent input — `channel-equivalence.test.ts`.
- [x] Parsing/normalisation in core, not dashboard — dashboard only renders the mapping UI and calls the API.
- [x] Tests added for every listed category (Plaid normalisation, sync idempotency + modified/removed, CSV edge cases, cross-channel dedup, mapping-profile round-trip).

### Definition of Done
- [x] Acceptance criteria checked with evidence (tests + mapping-UI screenshot captured in the build session).
- [x] Tests passing; 636 ≥ 601; no regressions.
- [x] No new TypeScript errors; no new `any`.
- [x] HANDOFF.md (this file).
- [x] Committed on a feature branch.

### Quality rubric — 8/8
Test coverage ✓ (hard) · Auth ✓ (hard, new endpoints under `apiKeyAuth` with `:ledgerId` scope) · Package boundaries ✓ · Env/secrets ✓ (`BANK_FEED_PROVIDER` documented below) · Bank feeds idempotent + errors surfaced ✓ · MCP signatures unchanged ✓ · TypeScript ✓ · Fail-closed ✓.

---

## Architecture (one pipeline, two channels)

```
Mock Plaid  ─ normalizePlaidTransaction ─┐
                                          ├─► ProviderBankTransaction ─► upsertBankTransactions
CSV upload  ─ applyMapping (+ dedup)  ────┘        (bank_transactions)          │
                                                                                 ▼
                                                    classifyPendingBankTransactions + matchBankTransactions
```

- **Single normalisation boundary:** `packages/core/src/bank-feeds/normalize.ts` (`normalizePlaidTransaction`). The live Plaid client drops onto this and `syncTransactions` with no pipeline change.
- **Cross-channel dedup:** shared `lineFingerprint(date, amount, type, description)`. Stored on every `bank_transactions` row (`line_fingerprint`). Manual imports skip a row if any bank account **mapped to the same ledger account** already has that fingerprint (covers Plaid/Basiq/manual). Manual rows also synthesize `provider_transaction_id = manual:<fingerprint>` so manual-vs-manual dedups via the unique index.
- **Cursor sync:** optional `syncTransactions()` added to `BankFeedProvider` (additive — Basiq/Plaid-stub unaffected). `engine.syncBankAccount` prefers it, persists `bank_accounts.sync_cursor`, and applies removals via `removeBankTransactions`.

## New env var
- `BANK_FEED_PROVIDER` — `mock` | `basiq` (default `basiq`). `mock` emits Plaid-shaped fixtures for dev/test and **fail-closes in production**.

## Migration
- `031_csv_import.{sql,sqlite.sql}` — `mapping_profiles` table, `bank_transactions.line_fingerprint`, `bank_accounts.sync_cursor`. Auto-loaded by the new full-migration test fixture.

## Test-fixture hardening
- `packages/core/tests/helpers/migrate.ts` — `createFullTestDb()` loads the **full** SQLite migration set in order. New core tests use it, so a new table can never silently become "no such table" (this is the `usage_tracking` fail-open class the launch brief flagged). Smoke test: `migration-fixture.test.ts`.

---

## NOT done / known issues / debt

1. **Live Plaid client — out of scope (by design).** The mock + boundary make it a near-drop-in: implement a real `PlaidProvider.syncTransactions` that calls `/transactions/sync` and maps each txn via `normalizePlaidTransaction`. No pipeline changes needed.
2. **`usage_tracking` fail-open warnings persist in api/mcp/sdk tests.** Those packages still hand-pick migrations in their own fixtures (the core fixture is fixed and guarantees migration 031 loads). Fix path: have those fixtures adopt a full-migration loader like `createFullTestDb`. **Risk:** enabling `usage_tracking` would make tier checks actually enforce in those tests, which may change current outcomes — do it deliberately, not as a drive-by.
3. **Dashboard `lint` is broken (pre-existing).** `"lint": "next lint"` errors with "Invalid project directory … \dashboard\lint" on `main` too — a `next lint` invocation/version issue, unrelated to this work. Not a DoD gate. Typecheck is clean.
4. **Accuracy harness:** labelled fixtures are delivered and exported (`labeledFixtures`) as the seed; a full *scored* accuracy run is future work and depends on classification tuning, which is explicitly out of scope.
5. **Plaid pending→posted fidelity:** the mock models the transition as a `modified` event on the same `transaction_id`. Real Plaid issues a new id for the posted txn with `pending_transaction_id` linking back; reconciling that is a live-client concern (out of scope).
6. **Removed handling:** removed pending rows are deleted; already-reconciled rows are flagged `ignored` (never silently dropped).
7. **Security/integrity blocker sprint** (token-encryption fail-closed, audit snapshot) — separate, tracked elsewhere; must land before real banks connect.

## Exact next step
Open a PR for `feat/bank-ingestion-mock-plaid-csv` → `main`. Then (separate task) implement the live `PlaidProvider` against `normalizePlaidTransaction` + `syncTransactions`, and decide on retrofitting the api/mcp/sdk test fixtures to the full-migration loader (item 2).

## Files changed (26 files, +3018 / −17)
Core: `bank-feeds/{mock,normalize,plaid-types,fixtures,factory,types,index}.ts`, `import/{csv-mapping,index}.ts`, `engine/index.ts`, `errors/index.ts`, `db/migrations/031_csv_import.{sql,sqlite.sql}`, `tests/helpers/migrate.ts` + 5 test files.
API: `routes/{imports,bank-feeds}.ts`. SDK: `index.ts`. Dashboard: `bank-feeds/{csv-import.tsx,page.tsx}`, `lib/actions.ts`. Plus `SPRINT.md`.

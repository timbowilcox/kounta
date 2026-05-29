# Sprint: Bank Ingestion — Fix B1/B2/B3 from Evaluation
Date: 2026-05-29
Repo: kounta
Branch: feat/bank-ingestion-mock-plaid-csv (fixes land on the existing PR #1)

## Scope
Fix the three blockers the evaluator proved in EVALUATION.md so PR #1 is correct and
mergeable: B1 (migration 031 unregistered in the production runner → breaks existing Basiq
sync in prod), B2 (cross-channel dedup wrong in both directions → silent data loss and
double-counting), B3 (removed-sync path silently mutates/deletes reconciled rows with no
audit entry). Read EVALUATION.md first — it contains the exact reproductions; each fix must
make the specific failing scenario pass.

Explicitly NOT in scope (handed to the security-and-integrity blocker sprint): the systemic
single-source-of-truth migration mechanism + anti-drift guard; reconciliation of the
pre-existing unregistered migrations 028/029/030; re-pointing api/mcp/sdk fixtures to the
full set and fixing suites that pass via tier fail-open; the other audit fail-open items
(token encryption, Basiq webhook signature, transaction audit-snapshot completeness).

## Acceptance Criteria

### B1 — Register migration 031 (the prod regression)
- [ ] 031 registered in BOTH production runner lists in packages/api/src/index.ts
      (pgMigrations and SQLite migrationFiles), in correct order.
- [ ] A test builds a DB from the PRODUCTION migration list (not the readdirSync fixture)
      and asserts upsertBankTransactions succeeds — i.e. the evaluator's
      "no column named line_fingerprint" failure now passes.
- [ ] A test asserts existing Basiq bank sync still works against the production migration
      set (the regression to existing functionality is gone).
- [ ] mapping_profiles table is present when built from the production migration list.

### B2 — Dedup correctness, both directions
- [ ] Same-source is occurrence-aware: a CSV with two genuinely identical rows (same
      date/amount/description/account — the two $4.50 coffees) stores BOTH; re-importing the
      same file adds zero. Asserted on stored count.
- [ ] Cross-source overlap is neither auto-collapsed nor double-counted: when a CSV row and a
      feed row represent the same real transaction with differing descriptions (Plaid
      "OFFICEWORKS 0123" vs CSV "OFFICEWORKS 0123 SYDNEY AU"), the importer surfaces it as a
      CANDIDATE duplicate for user confirmation in the existing preview step — it does not
      silently merge and does not silently double-count. Asserted: candidate flagged, no
      silent count change.
- [ ] Both exact scenarios the evaluator used to break dedup have explicit regression tests
      with count assertions.
- [ ] Dedup outcomes (deduped / flagged-candidate / distinct) are recorded with enough
      provenance to audit why each decision was made.

### B3 — Removed-sync audit integrity
- [ ] Every removal or state change on the removed path writes an audit entry (no silent
      mutation; audit count changes as expected).
- [ ] A removed event affecting a reconciled or posted bank transaction does NOT silently
      delete or re-state it — it is guarded and surfaced for user review.
- [ ] Pending (unreconciled, unposted) rows may still be removed, but each with an audit entry.
- [ ] Regression test reproducing the evaluator's scenario (removed flips matched/posted →
      ignored and hard-deletes pending) now shows audit entries written and reconciled rows
      guarded.

### Recurrence prevention (cheap, in-sprint)
- [ ] CLAUDE.md documents that production registers migrations via the hardcoded lists in
      packages/api/src/index.ts, and that a green suite using readdirSync is NOT proof a
      migration ships to prod.
- [ ] Kounta rubric gains a "test/prod migration parity" criterion.

## Definition of Done
- [ ] All acceptance criteria checked with executable evidence
- [ ] Tests passing; total ≥ 636 or justified delta; no regressions
- [ ] No new TypeScript errors; no new `any` without comment
- [ ] HANDOFF.md updated
- [ ] Committed to the branch; EVALUATION.md re-verification noted
- [ ] A FRESH evaluator pass independently re-verifies B1, B2, B3 before merge

## Quality Rubric (Kounta)
- Test coverage (hard): new logic tested; suite ≥ 636. Was the failed hard blocker — must pass.
- Auth patterns (hard): ledger-scoping intact. No bypass.
- Package boundaries: core imports nothing from api/dashboard.
- Env / secrets: none hardcoded.
- Stripe handling: unchanged, idempotency intact.
- Bank feeds: ingestion idempotent; errors surface, not swallowed. Was failing — must pass.
- MCP contract: @kounta/mcp signatures unchanged.
- TypeScript: no `any` without comment; no `ts-ignore` without justification.
- Fail-closed: no silent fail-open on secrets/webhooks/limits/audit. Was failing — must pass.
- NEW — Test/prod migration parity: tests must not certify schema production won't have.

Pass 9/10; test-coverage, auth, bank-feeds-idempotent, and fail-closed are hard blockers.

## Out of Scope (→ blocker sprint)
- Single source-of-truth migration mechanism + anti-drift guard (so fixtures and prod can't
  diverge again — the systemic fix behind B1)
- Reconcile unregistered migrations 028/029/030: investigate contents, verify safe and
  idempotent against EXISTING production databases, then register. Affects live prod — must
  be done with prod-schema verification, not blindly registered alongside 031.
- Re-point api/mcp/sdk fixtures to the full set; fix suites passing via tier fail-open.
- Token-encryption fail-closed; Basiq webhook signature; transaction audit-snapshot completeness.
- Live Plaid client; classification/reconciliation algorithm changes; OFX/QIF/MT940.
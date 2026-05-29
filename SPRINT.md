# Sprint: Bank Data Ingestion — Mock Plaid Feed + Manual CSV Import
Date: 2026-05-29
Repo: kounta

## Scope
Build two new bank-data acquisition channels that converge on Kounta's existing
normalised ingestion pipeline, so the full ingest → categorise → reconcile loop can be
developed and tested before the live Plaid account is finalised.

(1) A mock Plaid provider implementing the same provider interface as the existing
(throwing) Plaid stub, emitting fixtures shaped exactly like real Plaid responses and
flowing through the same Plaid→Kounta normalisation boundary the live client will use.

(2) A manual CSV import facility with a dashboard UI for mapping arbitrary bank-file
columns to Kounta's canonical transaction fields, with preview, reusable per-bank
mapping profiles, and cross-channel dedup.

Explicitly NOT in scope: the live Plaid client/credentials; any new categorisation or
reconciliation logic (both channels feed the existing engine unchanged); OFX/QIF/MT940.

## Acceptance Criteria

### Mock Plaid feed
- [ ] Mock provider implements the existing bank-feed provider interface; selected via
      explicit config (e.g. BANK_FEED_PROVIDER=mock) and THROWS if NODE_ENV=production.
- [ ] Fixtures emit the real Plaid shape (transaction_id, account_id, amount,
      iso_currency_code, date, name, merchant_name, pending, personal_finance_category).
- [ ] Mock mimics the /transactions/sync model — returns added/modified/removed arrays
      with a next_cursor, and exercises a pending→posted transition.
- [ ] Data flows through the SAME Plaid→internal normalisation function the live client
      will use; a test asserts normalised output equals expected Kounta transactions.
- [ ] Sync is idempotent: re-running does not duplicate (dedup on provider_transaction_id,
      consistent with existing bank-sync).
- [ ] Each fixture transaction carries a ground-truth category label, so the dataset
      doubles as the seed for the categorisation accuracy harness.

### Manual CSV import
- [ ] Upload CSV in the dashboard /bank-feeds area; parser handles header rows, quoted
      fields, and encodings defensively — malformed rows are SURFACED, never silently dropped.
- [ ] User selects which ledger account the rows belong to.
- [ ] Column-mapping UI maps file columns → canonical fields: date, description, amount
      (single signed column OR separate debit/credit), optional balance, reference, currency.
- [ ] Date-format selector defaulting to DD/MM/YYYY (AU); explicit sign-convention control
      (which sign is money out).
- [ ] Preview step shows parsed rows with mapping applied + row count before any write;
      nothing is committed until the user confirms.
- [ ] Mapping saved as a reusable per-bank profile so re-import skips remapping.
- [ ] Import dedups against ALL existing transactions in that account regardless of source
      (Plaid/Basiq/manual), using the engine's line-fingerprint (date + amount + normalised
      description + account), since manual CSVs lack a stable provider id. Re-importing an
      overlapping range does not double-count.
- [ ] Imported rows flow into the same categorisation + reconciliation pipeline as feeds.

### Shared
- [ ] Both channels produce identical internal transaction records for equivalent input.
- [ ] Parsing + normalisation logic lives in core (or a feed package), NOT in dashboard;
      the dashboard only renders the mapping UI and calls the API.
- [ ] Tests added: Plaid normalisation, sync idempotency + modified/removed handling, CSV
      edge cases (debit/credit split, sign convention, bad dates, malformed rows),
      cross-channel dedup, mapping-profile round-trip.

## Definition of Done
- [ ] All acceptance criteria checked with evidence (test output / screenshots)
- [ ] Tests passing; total ≥ 601 or justified delta. No regressions.
- [ ] No new TypeScript errors; no new `any` without comment
- [ ] HANDOFF.md updated
- [ ] Committed to git on a feature branch

## Quality Rubric (Kounta)
- Test coverage: new logic tested; suite ≥ 601. Non-negotiable.
- Auth patterns: new import endpoints check session/ledger scope. No bypass. Non-negotiable.
- Package boundaries: core imports nothing from api/dashboard; parsing lives below the UI.
- Env / secrets: no hardcoded secrets; new vars documented.
- Bank feeds: ingestion idempotent; errors surface to user, not swallowed.
- MCP contract: existing @kounta/mcp tool signatures unchanged.
- TypeScript: no `any` without comment; no `ts-ignore` without justification.
- NEW — Fail-closed: mock provider throws in production; import rejects ambiguous mappings
  rather than guessing; no silent fail-open anywhere in the new code.

Pass 7/8. Test coverage and auth are hard blockers.

## Out of Scope
- Live Plaid client + credentials (near-drop-in later, given the normalisation boundary)
- Categorisation / reconciliation algorithm changes
- OFX/QIF/MT940 formats
- The security-and-integrity blocker sprint (token-encryption fail-closed, audit snapshot)
  — tracked separately; must land before real users connect real banks.
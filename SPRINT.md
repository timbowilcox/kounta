# Sprint: Bank Ingestion — Fix Pass (Items 4/5/6 from EVALUATION-2)
Date: 2026-05-29
Repo: kounta
Branch: feat/bank-ingestion-mock-plaid-csv (fixes land on PR #1)

## Scope
Close the three escalation-edge gaps the re-evaluation found (see EVALUATION-2.md), built
around one durable review/exception surface: item 4 (cross-source dedup has no date tolerance
→ a pending→posted day shift double-counts), item 5 (held possible_duplicate rows aren't
persisted → silent omission after commit), item 6 (guarded removals surface only in the audit
log → invisible escalation). Items 5 and 6 feed a single ledger-scoped review queue — the
first instance of the escalation-as-first-class primitive the product needs anyway. Read
EVALUATION-2.md first; each fix must make its specific reproduction pass.

Explicitly NOT in scope (→ blocker sprint): migrations 028/029/030 reconciliation; the
systemic single-source migration mechanism / anti-drift guard; re-pointing api/mcp/sdk
fixtures; token encryption; Basiq webhook signature; audit-snapshot completeness. Also out of
scope: a general exception-queue beyond the two escalation types needed now.

## Acceptance Criteria

### Item 4 — cross-source date tolerance
- [ ] Cross-source loose matcher flags possible_duplicate on same amount + date within ±N days
      (N documented with rationale, ~3 to cover Plaid pending→posted), regardless of
      description — not exact-date-only.
- [ ] Regression: the EVALUATION-2 off-by-one case (89.95 debit, 1-day shift across channels)
      now flags as a candidate; stored count stays 1, no double-count. Add an off-by-3 case.
- [ ] Exact cross-source duplicates still auto-skip; same-source recurring (e.g. a weekly
      subscription via one feed) is unaffected — it stays in the occurrence-aware path, not
      loose-flagged.

### Item 5 — held candidates persist and are resolvable
- [ ] possible_duplicate candidates held at import are persisted durably and resolvable AFTER
      commit, not ephemeral preview counts.
- [ ] Held items are excluded from balances/reports until resolved (no overstatement) and
      cannot silently vanish (no understatement).
- [ ] A post-commit resolve path exists — confirm-import or discard — each writing an audit entry.
- [ ] Regression: the EVALUATION-2 Bunnings case (genuine distinct expense, same date+amount)
      is now persisted and resolvable (persisted count > 0), not dropped.

### Item 6 — guarded removals surface for review
- [ ] syncBankAccount no longer discards flaggedForReview (the line ~3753 drop); guarded
      removed-but-reconciled rows surface in the SAME review queue as item 5.
- [ ] Each guarded removal carries its reason (upstream-removed-but-reconciled) and a resolve
      path (keep / remove-with-audit); each resolution is audited.
- [ ] Regression: a removed event on a matched/posted row produces a visible, resolvable
      review item — not audit-log-only.

### Review queue (the unifying surface)
- [ ] Items 5 and 6 feed ONE ledger-scoped review surface with a shape general enough that new
      escalation types are additive later. Do not build types beyond the two needed now.
- [ ] Minimal dashboard surfacing: a review list + resolve actions, driven END-TO-END through
      the real stack (seed DB → mock provider → create a held candidate → resolve via the
      actual API path). Not a stub-only screenshot.

### If a schema change is needed (recurrence discipline — do not re-break B1)
- [ ] Any new migration is registered in BOTH production runner lists in
      packages/api/src/index.ts, in order.
- [ ] A test verifies the new schema against the PRODUCTION migration list (the exported
      SQLite list), NOT readdirSync — per the CLAUDE.md note.
- [ ] Any new table is ledger-scoped.

## Definition of Done
- [ ] All acceptance criteria checked with executable evidence (red→green per item)
- [ ] Full suite passing; total ≥ 645 or justified delta; no regressions
- [ ] No new TypeScript errors; no new `any` without comment
- [ ] HANDOFF.md updated
- [ ] Committed to the branch
- [ ] A FRESH evaluator pass re-verifies items 4/5/6 before merge (B1/B2/B3 already confirmed
      twice — only a full-suite regression check needed for them)

## Quality Rubric (Kounta)
- Test coverage (hard) · Auth/ledger-scope (hard) · Bank-feeds-idempotent (hard — item 4
  reopened it, must pass) · Fail-closed (hard — items 5/6, must pass) · Package boundaries ·
  Env/secrets · Stripe · MCP unchanged · TypeScript · Test/prod migration parity (if a
  migration is added). Pass 9/10; the four hard blockers are non-negotiable.

## Out of Scope (→ blocker sprint)
- 028/029/030 reconciliation (now the TOP blocker-sprint item — B3 already had to contort
  around 030 being absent in prod)
- Single-source migration mechanism + anti-drift guard
- Re-pointing api/mcp/sdk fixtures; tier fail-open in those suites
- Token encryption; Basiq webhook signature; audit-snapshot completeness
- Live Plaid client; classification/reconciliation algorithm changes; OFX/QIF/MT940
- A general exception-queue beyond the two types needed now
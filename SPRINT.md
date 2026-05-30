# SPRINT — Session D: close the residual isolation + Stripe-Connect gaps

## Context
Session C merged the fail-closed hardening. Two gaps the evaluators surfaced remain — both things
that pass auth/encryption but then leak or break:
1. Soft-delete only HALF-isolates a ledger — an existing OAuth token still validates against a
   deleted ledger, and ledger-scoped reads (listAccounts, etc.) do raw `SELECT * FROM ledgers`
   with only `if (!ledger)` (no status filter), so they return a deleted ledger's data. (API-key
   access, the by-id getLedger, and the owner list are already closed.)
2. getStripeConnectionByAccountId returns webhook_secret UNDECRYPTED; the Stripe-Connect webhook
   route HMACs with it, so now that encryption is mandatory, legit Stripe webhooks 400.
No new migrations, no prod-DB action.

Cut feat/session-d-residuals from main (Session C merged). Dedicated worktree.

## Scope — two contained fixes
1. Deleted-ledger isolation (the bigger one).  2. Stripe-Connect webhook-secret decrypt (small).

## Before any code
1. Read SPRINT.md, CLAUDE.md, HANDOFF.md, EVALUATION-6.md, EVALUATION-7.md (the OAuth-residual +
   Stripe findings).
2. Locate precisely:
   - validateOAuthToken (oauth-scopes.ts) — confirm no ledger-status check; oauth_tokens +
     its revoked_at column; softDeleteLedger (confirm it doesn't touch oauth_tokens).
   - validateApiKey / the auth chokepoint (active-only check — already correct; the model to mirror).
   - the ledger-scoped engine reads doing raw `SELECT * FROM ledgers WHERE id=?` (listAccounts and
     the rest) — enumerate them; this is the data-layer leak.
   - getStripeConnectionByAccountId + toStripeConnection (already decrypts) + the stripe-connect
     webhook route consuming webhookSecret; enumerate ALL callers of getStripeConnectionByAccountId.
3. Baseline: pnpm test --concurrency=1 → expect 692/5/0.

## GATE — report findings + fix plan + blast radius (STOP, report, then proceed)
Item 1's must-fix is the auth-layer closure; the data-layer centralization has a real blast-radius
call. Report:
   - every external + internal path that resolves to / reads a ledger, and which leak vs already reject
   - your chokepoint design: one shared "resolve active ledger / assert accessible" helper the
     ledger-scoped reads route through, vs patching each raw SELECT — and how many methods it touches
   - the OAuth-revoke-on-delete plan (mirror the API-key revocation already in softDeleteLedger)
   - for item 2: confirm every caller of getStripeConnectionByAccountId expects DECRYPTED (so
     decrypting won't double-decrypt), and whether the clean fix is routing it through
     toStripeConnection rather than its raw SELECT
Proceed after reporting. STOP and flag if the data-layer centralization is materially large (then do
the auth closure + a bounded data-layer fix and flag the rest).

## The work
Item 1:
- softDeleteLedger: also revoke the ledger's OAuth tokens (set revoked_at), INSIDE the existing
  transaction wrapper — so the audit-injection rollback still undoes it.
- validateOAuthToken: reject a token whose ledger is status='deleted' (belt for any issued/raced token).
- Data-layer gate: route ledger-scoped reads through a shared accessible-ledger check so a deleted
  ledger is uniformly not-found/forbidden (per the gate's bounded design).
Item 2:
- getStripeConnectionByAccountId returns the webhook_secret (and tokens) DECRYPTED — ideally by
  reusing toStripeConnection's decryption, not a raw SELECT (+ decryptToken import). The webhook
  route then HMACs with the plaintext secret.

## Definition of done (proof, not assertion)
Item 1 — an isolation proof (the inverse of EVALUATION-7's leak demo): create a ledger + API key +
   OAuth token + child account; soft-delete; then assert ALL of: OAuth token no longer validates,
   API key rejected, getLedger not-found, listAccounts (+ a sample of other ledger-scoped reads)
   return not-found/forbidden — the deleted ledger leaks nowhere. Confirm the softDeleteLedger
   audit-injection rollback still fully rolls back (now incl. the OAuth revocation) — prove
   non-vacuity by unwrapping → RED → revert.
Item 2 — a Stripe-Connect webhook signed with the PLAINTEXT secret is now ACCEPTED (was 400); a
   tampered/wrong-secret one is still REJECTED. Confirm no caller double-decrypts.
Full suite green serially, 0 fail-open warnings, typecheck clean.

## Scope guardrails
No new migrations (oauth_tokens.revoked_at already exists). No prod-DB action. Don't touch the merged
Session C fixes beyond wiring OAuth-revoke into softDeleteLedger. commitCsvImport stays deferred. No
launch-strategy / feature work.

## At the end
- HANDOFF.md: both fixes + proofs, the chokepoint design + any bounded-out remainder, callers checked,
  test status, files changed, next step.
- Commit per item. Do NOT self-certify mergeable — a fresh evaluator re-runs the isolation proof
  (every access path closed) + the Stripe accept/reject, and re-proves non-vacuity.
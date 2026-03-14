# Kounta

Accounting infrastructure for builders. A programmable double-entry ledger and reporting engine, embeddable via API, SDK, and MCP.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **API:** Hono
- **Database:** PostgreSQL (primary), SQLite (self-hosted)
- **Validation:** Zod
- **Dashboard:** Next.js
- **Monorepo:** Turborepo

## Monorepo Structure
```
packages/
  core/       # @kounta/core — double-entry engine, domain logic
  api/        # @kounta/api — REST API (Hono)
  mcp/        # @kounta/mcp — MCP server
  sdk/        # @kounta/sdk — client SDK
  dashboard/  # @kounta/dashboard — Next.js dashboard
```

## Current Scope

In scope: core ledger engine, 8 business templates, REST API, MCP server, TypeScript SDK, CSV/OFX import with basic reconciliation, three financial statements (P&L, Balance Sheet, Cash Flow indirect method), minimal dashboard (auth, template picker, API keys, ledger viewer, statements), self-hosted Docker image.

Out of scope: bank feed APIs (Plaid, Basiq), notification layer, health dashboard, multi-currency, multi-entity, consolidation, RBAC, multi-agent access, tax compliance packs, budgeting, forecasting, revenue recognition, depreciation schedules.

## Core Invariants

- **Double-entry balance constraint:** Debits must equal credits on every transaction. Enforced at the database level, not just application code.
- **Immutable transactions:** Never modify or delete a posted transaction. Reversals create new offsetting entries.
- **Amounts are integers** in the smallest currency unit (e.g., cents). No floats. `$12.50` = `1250`.
- **UUIDs:** All entities use UUID v7 primary keys.
- **Timestamps:** All timestamps are UTC, stored and returned as ISO 8601.
- **Idempotency:** Every transaction has an idempotency_key unique per ledger. Re-posting the same key returns the original transaction without side effects.
- **Audit everything:** Every mutation to the ledger gets an append-only audit entry with actor, action, timestamp, and full entity snapshot.

## Do Not

- Do not use floating-point numbers for money. Ever.
- Do not modify or delete posted transactions. Only reverse.
- Do not put domain logic in @kounta/api or @kounta/mcp — it belongs in @kounta/core.
- Do not build a full accounting UI in the dashboard. It is a viewer and credential manager only.
- Do not add tax, multi-currency, multi-entity, or RBAC. These are out of scope.
- Do not store API keys in cleartext. Store SHA-256 hashes. The key is shown once at creation.
- Do not use default exports. Use named exports throughout.

## Data Model (Core Entities)

- **Ledger** — top-level container, one per business/product. Holds currency, template_id, business_context (JSONB), fiscal_year_start, accounting_basis (accrual|cash).
- **Account** — node in chart of accounts tree. Five root types: asset, liability, equity, revenue, expense. Type and normal_balance are immutable after creation. Accounts form a tree via parent_id with unlimited depth.
- **Transaction** — immutable balanced journal entry. Has idempotency_key (unique per ledger), date, memo, status (posted|reversed), source_type (api|mcp|import|manual), agent_id.
- **LineItem** — single debit or credit within a transaction. Amount is integer in smallest currency unit. Direction is debit or credit. SUM(debits) must equal SUM(credits) per transaction.
- **Reversal** — links original_transaction_id to reversal_transaction_id with a reason. The original is marked reversed, never modified.
- **AuditEntry** — append-only. Records entity_type, entity_id, action (created|reversed|archived), actor_type (user|agent|system), actor_id, evidence_ref, and full entity snapshot as JSONB.
- **ImportBatch** — tracks file imports (CSV, OFX) with row_count, matched_count, unmatched_count, status.
- **ImportRow** — individual rows from an import. Has match_status (matched|suggested|unmatched), matched_transaction_id, confidence score.
- **User** — authenticated via GitHub or Google OAuth. No email/password auth.
- **ApiKey** — scoped to a single ledger. Stored as SHA-256 hash with an 8-character prefix for display.
- **Template** — seeded data, not user-created. Contains slug, business_type, and full chart_of_accounts tree as JSONB.

## API Keys

- Format: `kounta_live_` prefix for production, `kounta_test_` for sandbox
- Shown once at creation, stored as SHA-256 hash
- Scoped to a single ledger
- A user can have multiple keys per ledger

## Conventions

- Validate all inputs at the boundary with Zod schemas.
- Keep domain logic in `@kounta/core`; other packages import from core, never the reverse.
- Zod schemas are shared between API validation, SDK types, and MCP tool parameter definitions.
- Database migrations live alongside the package that owns the schema.
- Use explicit error types, not thrown strings. Prefer `Result<T, E>` patterns where practical.
- Every error response includes: error code, human-readable message, field-level details (field, expected, actual), and a suggested correction where determinable.
- Tests should cover the balance constraint — every test that creates a transaction must assert debits === credits.
- All list endpoints use cursor-based pagination: `?cursor=xxx&limit=50`. Default limit 50, max 200.

## Style

- Prefer `const` over `let`. No `var`.
- Use named exports, not default exports.
- Colocate types with the code that uses them. Shared types go in `@kounta/core`.
- Keep functions small. If a function needs a comment explaining what it does, it should be split or renamed.
- SQL: use snake_case for columns/tables. TypeScript: use camelCase for variables, PascalCase for types.

## Commands
```sh
pnpm install          # install dependencies
pnpm dev              # start all packages in dev mode
pnpm build            # build all packages
pnpm test             # run tests across all packages
pnpm lint             # lint all packages
pnpm typecheck        # type-check all packages
```

## File Writing Rules (Windows / OneDrive)

These rules exist because OneDrive sync can cause the Write tool to
fail with EEXIST even when no directory exists at that path. Heredocs
also break on JSX/template literals. Follow these rules on every file
operation — no exceptions.

### Writing new files
- **Never use shell heredocs** for any file containing JSX, CSS-in-JS,
  template literals, or single quotes. Use Node.js base64 write instead:
```bash
  node -e "require('fs').writeFileSync('path/to/file.tsx', Buffer.from('BASE64STRING', 'base64').toString())"
```

  Generate the base64 string with:
```bash
  node -e "console.log(Buffer.from(\`FILE CONTENT HERE\`).toString('base64'))"
```

- **Never batch-create multiple components in a single bash call.**
  Write one file at a time. Verify before moving to the next.

- **After every file write**, confirm it landed correctly:
```bash
  wc -l path/to/file && head -3 path/to/file
```

### Handling EEXIST errors
If the Write tool returns EEXIST on a file path (not a directory):
1. `rm path/to/file`
2. Recreate using the Node.js base64 method above
3. Never retry Write directly after EEXIST — it will fail again

### Updating PROGRESS.md
- Do **not** use the Write tool to replace the whole file
- Use the Edit tool to make targeted insertions, **or**
- `rm PROGRESS.md` then recreate the full file fresh
- Always verify the section you edited looks correct after writing:
```bash
  grep -n "your new section heading" PROGRESS.md
```

### General hygiene
- If a component creation fails mid-batch, treat ALL files from that
  batch as suspect — re-read each one before using it
- A 0-line or truncated file is worse than no file — always check
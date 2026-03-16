# Kounta — Build Progress

## Project Overview

Kounta is a programmable double-entry ledger and reporting engine, embeddable via API, SDK, and MCP.
Monorepo with 5 packages + 3 example apps, ~189 TypeScript files, 312+ tests passing.

## Tech Stack

- TypeScript (strict), Hono (API), sql.js/SQLite (embedded DB), Zod (validation)
- Next.js (dashboard), Turborepo (monorepo), Vitest (tests)
- Docker (single-container deployment)

## Repository

- **GitHub**: https://github.com/timbowilcox/kounta
- **Branch**: main
- **Deployed**: Vercel (all three example apps)

## Monorepo Structure

```
packages/
  core/       # @kounta/core — double-entry engine, domain logic
  api/        # @kounta/api — REST API via Hono
  mcp/        # @kounta/mcp — MCP server (63 tools)
  sdk/        # @kounta/sdk — TypeScript client SDK (13 modules)
  dashboard/  # @kounta/dashboard — Next.js dashboard (14 pages)
examples/
  saas-tracker/        # SaaS subscription revenue tracker
  invoice-manager/     # Freelancer invoice manager
  expense-tracker/     # Expense tracker with CSV import
```

## Completed Stages

### Phase 1 — Foundation (Stages 1–13)

1. **Core Engine** — Double-entry ledger with balance enforcement, immutable transactions, idempotency keys, amounts as integers
2. **REST API** — 25+ HTTP endpoints via Hono, API key + admin auth, cursor pagination
3. **Templates & Statements** — 8 business templates, Income Statement, Balance Sheet, Cash Flow
4. **MCP Server** — 12 initial tools, 4 resources, 3 prompts
5. **Import & Reconciliation** — CSV/OFX parsing, confidence-scored matching engine
6. **TypeScript SDK** — Full client SDK with typed modules
7. **Next.js Dashboard** — 11 pages with auth, sidebar, data tables, statements viewer
8. **Example Apps** — SaaS tracker (Stripe), invoice manager, expense tracker (CSV import)
9. **Docker & Performance** — Multi-stage Dockerfile, 989 txn/s throughput, error review
10. **Documentation** — API reference (1,009 lines), SDK guide, MCP guide, template reference
11. **Dashboard Styling** — Tailwind v4, Sana Labs-inspired design system
12. **Vercel Deployment** — Build fixes, seed scripts, fallback UIs
13. **Billing** — Migration 003, Stripe integration, plan enforcement (Free/Builder/Pro)

### Phase 2, Block 1 — Platform Features

14. **Bank Feeds** (Migration 004)
    - Provider abstraction (Basiq for AU/NZ, Plaid stub)
    - Auto-reconciliation with confidence scoring
    - Dashboard: `/bank-feeds` page with connected accounts, transaction feed, match review
    - MCP tools: `connect_bank`, `list_bank_accounts`, `sync_bank_feed`, `list_bank_transactions`, `match_bank_transaction`
    - SDK: `bankFeeds` module (8 methods)
    - Plan enforcement: Builder tier only

15. **Intelligence Layer** (Migration 005)
    - Notification types: monthly summaries, cash alerts, anomaly detection, decision prompts
    - Smart insights engine with severity scoring
    - Dashboard: `/notifications` page with notification bell, insights cards
    - MCP tools: `list_notifications`, `get_unread_count`, `action_notification`
    - SDK: `notifications` module (6 methods)
    - Plan enforcement: Builder tier only

### Phase 2, Block 2 — Advanced Features

16. **Multi-Currency** (Migration 006)
    - `line_items.amount` = base currency (balance constraint unchanged)
    - New columns: `currency`, `original_amount`, `exchange_rate` (integer × 1,000,000 precision)
    - New tables: `currency_settings`, `exchange_rates`
    - Currency utility functions: `toSmallestUnit()`, `fromSmallestUnit()`, `convertAmount()`
    - Engine methods: enableCurrency, setExchangeRate, getExchangeRate, listExchangeRates, convertAmount, revalueAccounts
    - API routes: `/currencies`, `/exchange-rates`, `/exchange-rates/convert`, `/revalue`
    - MCP tools (5): `enable_currency`, `set_exchange_rate`, `list_exchange_rates`, `convert_amount`, `revalue_accounts`
    - SDK: `currencies` module (6 methods)
    - Dashboard: `/currencies` page with enabled currencies table, exchange rates table
    - Import parsers updated to use `toSmallestUnit()` for correct decimal handling (JPY=0, BHD=3, etc.)
    - Plan enforcement: Pro tier only

### Phase 2, Block 3 — Fixed Assets & Jurisdiction

17. **Jurisdiction Foundation** (Migration 019)
    - 6 jurisdictions: AU, US, UK, NZ, CA, SG + OTHER fallback
    - Jurisdiction config: tax year, currency, tax authority, VAT/GST, tax ID label
    - GET/PATCH `/v1/ledgers/:ledgerId/jurisdiction`
    - Dashboard: Jurisdiction settings card in Settings page
    - AI assistant jurisdiction context

18. **Fixed Assets & Depreciation** (Migration 018, 019, 020)
    - Complete depreciation engine: 12 methods (straight-line, diminishing value, prime cost, MACRS, WDA, instant write-off, Section 179, AIA, CCA, bonus depreciation, declining balance, units of production)
    - MACRS half-year convention, first-period pro-rata
    - Automatic schedule generation from jurisdiction rules
    - Asset disposal with gain/loss calculation and AU CGT detection
    - Capitalisation advisory (adviseOnCapitalisation with jurisdiction-aware thresholds)
    - Proactive capitalisation check notifications on large expenses
    - Depreciation scheduler with startup run for reliability
    - Dashboard: Fixed Assets page with Add Asset modal, inline capitalisation check, schedule preview, "Record as expense" pre-fill
    - Dashboard: Overview depreciation alert banner
    - MCP: 12 fixed asset tools (check_capitalisation, create_fixed_asset, list_fixed_assets, get_depreciation_schedule, get_depreciation_due, run_depreciation, get_asset_register_summary, dispose_fixed_asset, update_fixed_asset, update_jurisdiction, get_setup_guide)
    - SDK: FixedAssetsModule
    - 77+ new tests (63 engine + 14 API integration)

### Phase 2, Block 4 — Invoicing / Accounts Receivable

19. **Invoicing** (Migration 021)
    - Full AR lifecycle: create draft, send (approve), record payment, void
    - Invoice line items with per-line tax rate overrides
    - Multiple payments per invoice (partial payment support)
    - AR journal entry posted on send (debit AR, credit Revenue, credit GST/VAT)
    - Payment journal entry posted on payment (debit Cash/Bank, credit AR)
    - Void reverses AR journal entry
    - Invoice summary and AR aging report (Current, 1-30, 31-60, 61-90, 90+ days)
    - Overdue scheduler (daily check, marks past-due invoices as overdue)
    - API: 10 endpoints (GET list, POST create, GET summary, GET aging, GET by ID, PATCH update, POST send, POST payment, POST void, DELETE draft)
    - MCP: 8 invoice tools (create_invoice, list_invoices, get_invoice, send_invoice, record_invoice_payment, void_invoice, get_invoice_summary, get_ar_aging)
    - SDK: InvoicesModule with 10 methods
    - Dashboard: 7 AI assistant tools with write confirmations for send and payment
    - 48 new tests (30 core engine + 18 API integration)

## Current State

### Test Status

| Package | Tests | Status |
|---------|-------|--------|
| @kounta/core | 350 | ✅ passing |
| @kounta/mcp | 44 | ✅ passing |
| @kounta/api | 67 (63 integration + 4 benchmark) | ✅ passing |
| @kounta/sdk | 35 | ✅ passing |
| **Total** | **496+** | **all passing** |

### Database Migrations

| # | Name | Description |
|---|------|-------------|
| 001 | initial_schema | Full schema (accounts, transactions, line_items, audit, api_keys, users, ledgers) |
| 002 | audit_action_updated | Adds 'updated' action to audit trail |
| 003 | billing | Billing plans, Stripe integration |
| 004 | bank_feeds | Bank connections, accounts, transactions, sync logs |
| 005 | intelligence | Notifications, notification preferences |
| 006 | multi_currency | Currency settings, exchange rates, line_item currency columns |
| 007 | conversations | AI assistant conversation history |
| 008 | classification | Transaction classification rules |
| 009 | email | Email forwarding and parsing |
| 010 | onboarding | User onboarding state and progress |
| 011 | attachments | File attachments for transactions |
| 012 | recurring_entries | Recurring/scheduled transactions |
| 013 | closed_periods | Period closing and lock dates |
| 014 | global_classifications | Global classification taxonomy |
| 015 | stripe_connect | Stripe Connect for marketplace billing |
| 016 | revenue_recognition | Revenue recognition schedules |
| 017 | bank_feeds_metadata | Bank feeds provider metadata |
| 018 | fixed_assets | Fixed asset register and depreciation schedules |
| 019 | jurisdiction | Jurisdiction configuration (AU, US, UK, NZ, CA, SG) |
| 020 | capitalisation_notification | Capitalisation check notification type |
| 021 | invoicing | Invoices, invoice line items, invoice payments (AR lifecycle) |

### MCP Tools (63 total)

setup_ledger, complete_setup, post_transaction, reverse_transaction, search_transactions, list_accounts, create_account, get_statement, import_file, confirm_matches, get_import_batch, get_usage, connect_bank, list_bank_accounts, sync_bank_feed, list_bank_transactions, match_bank_transaction, list_notifications, get_unread_count, action_notification, manage_preferences, generate_insights, enable_currency, set_exchange_rate, list_exchange_rates, convert_amount, revalue_accounts, check_capitalisation, create_fixed_asset, list_fixed_assets, get_depreciation_schedule, get_depreciation_due, run_depreciation, get_asset_register_summary, dispose_fixed_asset, update_fixed_asset, update_jurisdiction, get_setup_guide, create_invoice, list_invoices, get_invoice, send_invoice, record_invoice_payment, void_invoice, get_invoice_summary, get_ar_aging

### SDK Modules (14)

ledgers, accounts, transactions, reports, audit, imports, templates, apiKeys, admin, bankFeeds, notifications, currencies, fixedAssets, invoices

### Dashboard Pages (16)

/, /accounts, /transactions, /statements, /bank-feeds, /notifications, /currencies, /fixed-assets, /settings, /api-keys, /mcp, /billing, /templates, /signin + auth API route

### API Endpoints (55+)

Health, Ledgers (CRUD), Accounts (CRUD), Transactions (post/list/get/reverse), Reports (P&L/BS/CF), Audit, Templates (list/get/recommend/apply), Imports (upload/list/get/confirm), API Keys (create/list/revoke), Currencies (list/enable), Exchange Rates (list/set/convert), Revalue, Bank Feeds (connect/list/sync/match), Notifications (list/get/action/preferences/generate), Billing/Usage, Fixed Assets (create/list/get/update/dispose/depreciation-schedule/depreciation-due/run-depreciation/register-summary/capitalisation-check), Jurisdiction (get/patch), Invoices (list/create/get/update/send/payment/void/delete/summary/aging)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3001 | HTTP port |
| KOUNTA_DATA_DIR | (in-memory) | Directory for persistent SQLite file |
| KOUNTA_ADMIN_SECRET | (auto-generated) | Admin secret for bootstrap operations |
| KOUNTA_API_URL | - | API URL for dashboard/SDK |
| STRIPE_SECRET_KEY | - | Stripe API key for billing |
| AUTH_GITHUB_ID/SECRET | - | GitHub OAuth for dashboard |
| AUTH_GOOGLE_ID/SECRET | - | Google OAuth for dashboard |

## Build Commands

```sh
pnpm install          # install dependencies
pnpm dev              # start all packages in dev mode
pnpm build            # build all packages
pnpm test             # run tests across all packages
pnpm lint             # lint all packages
pnpm typecheck        # type-check all packages
```

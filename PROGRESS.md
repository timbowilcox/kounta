# Kounta — Build Progress

## Project Overview

Kounta is a programmable double-entry ledger and reporting engine, embeddable via API, SDK, and MCP.
Monorepo with 5 packages + 3 example apps, ~189 TypeScript files, 235 tests passing.

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
  mcp/        # @kounta/mcp — MCP server (27 tools)
  sdk/        # @kounta/sdk — TypeScript client SDK (12 modules)
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

## Current State

### Test Status

| Package | Tests | Status |
|---------|-------|--------|
| @kounta/core | 129 | ✅ passing |
| @kounta/mcp | 36 | ✅ passing |
| @kounta/api | 35 (31 integration + 4 benchmark) | ✅ passing |
| @kounta/sdk | 35 | ✅ passing |
| **Total** | **235** | **all passing** |

### Database Migrations

| # | Name | Description |
|---|------|-------------|
| 001 | initial_schema | Full schema (accounts, transactions, line_items, audit, api_keys, users, ledgers) |
| 002 | audit_action_updated | Adds 'updated' action to audit trail |
| 003 | billing | Billing plans, Stripe integration |
| 004 | bank_feeds | Bank connections, accounts, transactions, sync logs |
| 005 | intelligence | Notifications, notification preferences |
| 006 | multi_currency | Currency settings, exchange rates, line_item currency columns |

### MCP Tools (27 total)

setup_ledger, complete_setup, post_transaction, reverse_transaction, search_transactions, list_accounts, create_account, get_statement, import_file, confirm_matches, get_import_batch, get_usage, connect_bank, list_bank_accounts, sync_bank_feed, list_bank_transactions, match_bank_transaction, list_notifications, get_unread_count, action_notification, manage_preferences, generate_insights, enable_currency, set_exchange_rate, list_exchange_rates, convert_amount, revalue_accounts

### SDK Modules (12)

ledgers, accounts, transactions, reports, audit, imports, templates, apiKeys, admin, bankFeeds, notifications, currencies

### Dashboard Pages (14)

/, /accounts, /transactions, /statements, /bank-feeds, /notifications, /currencies, /api-keys, /mcp, /billing, /templates, /signin + auth API route

### API Endpoints (30+)

Health, Ledgers (CRUD), Accounts (CRUD), Transactions (post/list/get/reverse), Reports (P&L/BS/CF), Audit, Templates (list/get/recommend/apply), Imports (upload/list/get/confirm), API Keys (create/list/revoke), Currencies (list/enable), Exchange Rates (list/set/convert), Revalue, Bank Feeds (connect/list/sync/match), Notifications (list/get/action/preferences/generate), Billing/Usage

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

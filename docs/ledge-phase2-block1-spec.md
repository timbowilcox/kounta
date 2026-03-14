# KOUNTA — Phase 2 Block 1: Make It Real

**Development Specification** | March 2026 | Confidential

*Companion to Phase 1 Development Specification and Product Specification v4.2*

---

# Overview

Phase 1 delivered a working engine: 235 tests passing, a Docker image, a deployed dashboard at kounta.ai, an SDK, MCP server, three example apps, and full documentation. But the product is not end-to-end functional. The dashboard shows mock data. Auth is stubbed. There is no hosted API. A builder cannot sign up and use Kounta today.

Block 1 closes that gap. When Block 1 is complete, a builder can sign up with GitHub or Google, pick a template, get API keys, integrate Kounta into their app, see live financial statements, and upgrade to a paid plan when they outgrow the free tier. Every interaction is real, not mocked.

## Block 1 Deliverables

- Hosted API at api.kounta.ai (or similar) running on Railway with persistent PostgreSQL

- Dashboard wired to the live API — all mock data replaced with real SDK calls

- Working GitHub and Google OAuth with NextAuth v5

- Stripe billing integration with free tier enforcement, graceful degradation, and upgrade flow

- Custom domain configured for dashboard and API

## Dependency Chain

Each deliverable depends on the previous one. The build order is fixed:

- 1\. Deploy API — the dashboard and SDK need a live endpoint to call

- 2\. Wire dashboard — replace mock data with real API calls via the SDK

- 3\. Auth — enable real signup/signin so users can create accounts

- 4\. Billing — enforce free tier limits, enable upgrades via Stripe

- 5\. Domain — point kounta.ai at the dashboard and API

# Deploy the API

The API currently runs in a Docker container with embedded SQLite. For production, it needs a hosted environment with persistent storage, HTTPS, and a public URL.

## Hosting: Railway

Railway is the recommended hosting provider for the API. It supports Docker deployments from GitHub, provides managed PostgreSQL, handles HTTPS automatically, and costs roughly \$5–20/month at low traffic. The deployment flow:

- Connect the GitHub repository (timbowilcox/kounta) to a new Railway project

- Railway detects the Dockerfile and builds the image automatically

- Add a Railway-managed PostgreSQL database to the project

- Set environment variables: KOUNTA_ADMIN_SECRET, DATABASE_URL (from the PostgreSQL addon), PORT

- Railway assigns a public URL like kounta-api-production.up.railway.app

- Verify the health endpoint returns 200 at /v1/health

## Database Migration: SQLite to PostgreSQL

Phase 1 uses SQLite via sql.js. Production should use PostgreSQL for concurrency, durability, and managed backups. The migration path:

- The PostgreSQL migration file already exists at packages/core/src/db/migrations/001_initial_schema.sql

- Create a new database adapter that uses the pg library instead of sql.js

- The adapter must implement the same Database interface (run, get, all, exec, transaction, close)

- Add a DATABASE_URL environment variable check at boot — if present, use PostgreSQL; if absent, fall back to SQLite

- Run the existing PostgreSQL migration on first boot

- The deferred constraint trigger for balance enforcement (trg_check_balance) works natively in PostgreSQL

### PostgreSQL Adapter

Create packages/core/src/db/postgres.ts implementing the Database interface:

import { Pool } from 'pg'

class PostgresDatabase implements Database {

private pool: Pool

constructor(connectionString: string) { this.pool = new Pool({ connectionString }) }

async run(sql, params?) { await this.pool.query(sql, params); return { changes: ... } }

async get\<T\>(sql, params?) { const r = await this.pool.query(sql, params); return r.rows\[0\] }

async all\<T\>(sql, params?) { const r = await this.pool.query(sql, params); return r.rows }

async transaction\<T\>(fn) { const client = await this.pool.connect(); try { ... } }

}

The key difference: PostgreSQL uses \$1, \$2 parameter placeholders instead of SQLite’s ?. The adapter must translate parameter styles, or the engine queries must be updated to use numbered parameters. The cleanest approach is to update the engine to use numbered parameters (\$1, \$2) and add a thin translation layer in the SQLite adapter that converts them to ?.

## Environment Variables

|                           |                                                                                         |
|---------------------------|-----------------------------------------------------------------------------------------|
| **Variable**              | **Description**                                                                         |
| **DATABASE_URL**          | PostgreSQL connection string. If absent, SQLite fallback.                               |
| **KOUNTA_ADMIN_SECRET**    | Admin auth secret for ledger creation and API key management. Auto-generated if absent. |
| **PORT**                  | API listen port. Default 3001.                                                          |
| **KOUNTA_HOST**            | Bind address. Default 0.0.0.0 for Docker/Railway.                                       |
| **STRIPE_SECRET_KEY**     | Stripe secret key for billing (added in Block 1 Step 4).                                |
| **STRIPE_WEBHOOK_SECRET** | Stripe webhook signing secret for verifying events.                                     |

## Verification

- GET /v1/health returns { status: 'ok', version: '0.1.0' }

- POST /v1/ledgers with admin secret creates a ledger in PostgreSQL

- POST a balanced transaction and verify it appears in GET /v1/ledgers/:id/transactions

- Generate a P&L and verify it returns correct figures

- Run the SDK against the hosted URL and verify all 35 SDK tests pass

# Wire the Dashboard to the Live API

Every dashboard screen currently renders hardcoded mock data. Replace all mock data with real SDK calls to the hosted API. The SDK is already built with the correct method signatures for every screen.

## Configuration

Add environment variables to the Vercel dashboard deployment:

NEXT_PUBLIC_KOUNTA_API_URL=https://api.kounta.ai

KOUNTA_API_URL=https://api.kounta.ai (server-side)

Create a shared SDK instance in the dashboard:

// lib/kounta.ts

import { Kounta } from '@kounta/sdk'

export const kounta = new Kounta({

baseUrl: process.env.KOUNTA_API_URL ?? process.env.NEXT_PUBLIC_KOUNTA_API_URL,

apiKey: // from session after auth

})

## Screen-by-Screen Wiring

|                     |                                                                            |                                                                               |
|---------------------|----------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| **Screen**          | **Mock Data to Replace**                                                   | **SDK Call**                                                                  |
| **Overview (/)**    | Transaction count, account count, ledger value, usage, recent transactions | kounta.ledgers.get(), kounta.transactions.list({ limit: 5 }), kounta.usage.get() |
| **Accounts**        | Account tree with balances                                                 | kounta.accounts.list()                                                         |
| **Transactions**    | Paginated transaction list                                                 | kounta.transactions.list({ cursor, limit: 8 })                                 |
| **Statements**      | P&L, Balance Sheet, Cash Flow                                              | kounta.reports.incomeStatement(), .balanceSheet(), .cashFlow()                 |
| **API Keys**        | Key list, create, revoke                                                   | kounta.apiKeys.list(), .create(), .revoke()                                    |
| **Template Picker** | Template list and selection                                                | kounta.templates.list(), .apply()                                              |

## Data Flow After Auth

Once auth is working (Step 3), the data flow is: user signs in → session contains the user’s API key → SDK initialises with that key → all dashboard calls are authenticated and scoped to the user’s ledger. Until auth is wired, use a hardcoded API key from the admin bootstrap for testing.

# Authentication

The auth UI and route structure already exist from Phase 1. The sign-in page has GitHub and Google buttons. The NextAuth route handler is at /api/auth/\[...nextauth\]. What is missing is real OAuth credentials and the session-to-API-key bridge.

## OAuth Provider Setup

### GitHub

- Go to github.com/settings/developers and create a new OAuth App

- Application name: Kounta

- Homepage URL: https://kounta.ai (or the Vercel URL)

- Callback URL: https://kounta.ai/api/auth/callback/github

- Copy the Client ID and generate a Client Secret

- Set GITHUB_ID and GITHUB_SECRET as environment variables in Vercel

### Google

- Go to console.cloud.google.com and create a project

- Enable the Google+ API (or People API)

- Create OAuth 2.0 credentials with Web application type

- Add https://kounta.ai/api/auth/callback/google as an authorised redirect URI

- Copy the Client ID and Client Secret

- Set GOOGLE_ID and GOOGLE_SECRET as environment variables in Vercel

## Auth Secret

Generate a random 32+ character string and set it as AUTH_SECRET in Vercel. This is used by NextAuth to encrypt session tokens.

openssl rand -base64 32

## Session-to-API-Key Bridge

When a user signs in for the first time, Kounta needs to create an account in the API and issue an API key. The flow:

- User clicks “Continue with GitHub” and completes OAuth

- NextAuth’s signIn callback fires with the user’s email and provider info

- The callback calls the Kounta API (via admin secret) to create a user record if one does not exist

- The callback creates an API key scoped to the user’s default ledger (or creates a ledger if this is their first sign-in)

- The API key is stored in the NextAuth session (encrypted, server-side only)

- Every subsequent dashboard page reads the API key from the session and initialises the SDK with it

If the user has no ledger yet (first sign-in), they are redirected to /templates to pick one. After selecting a template, the ledger is created and the API key is issued. Subsequent sign-ins go straight to the dashboard.

## Environment Variables

|                   |                                                    |
|-------------------|----------------------------------------------------|
| **Variable**      | **Description**                                    |
| **AUTH_SECRET**   | NextAuth encryption secret. 32+ random characters. |
| **GITHUB_ID**     | GitHub OAuth App Client ID.                        |
| **GITHUB_SECRET** | GitHub OAuth App Client Secret.                    |
| **GOOGLE_ID**     | Google OAuth Client ID.                            |
| **GOOGLE_SECRET** | Google OAuth Client Secret.                        |

## Target: Under 60 Seconds

The signup flow must be completable in under 60 seconds: click sign in → GitHub/Google OAuth → template picker → dashboard with live data. No email verification, no credit card, no multi-step onboarding wizard.

# Billing

Billing enables the free-to-paid conversion that funds the business. The design principle is: the builder’s app never breaks. Hitting the free tier limit degrades visibility, not functionality. Data is always safe.

## Tier Structure

|              |              |               |                                                                                                             |
|--------------|--------------|---------------|-------------------------------------------------------------------------------------------------------------|
| **Tier**     | **Price**    | **Txn Limit** | **Features**                                                                                                |
| **Free**     | \$0          | 500/month     | Full API + MCP, single entity, basic statements, CSV import                                                 |
| **Builder**  | \$49/month   | Unlimited     | Everything in Free plus: bank feeds, auto-reconciliation, intelligence layer, forecasting, priority support |
| **Platform** | \$149–199/mo | Unlimited     | Everything in Builder plus: multi-entity, consolidation, multi-jurisdiction, RBAC, policy controls          |

Block 1 implements Free and Builder only. Platform is a future milestone.

## Data Model Changes

Add the following columns and table:

ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'

CHECK (plan IN ('free', 'builder', 'platform'));

ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;

ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;

ALTER TABLE users ADD COLUMN plan_period_start TIMESTAMP;

ALTER TABLE users ADD COLUMN plan_period_end TIMESTAMP;

Add a new transaction status:

-- The transactions.status field gains a third value: 'pending'

-- pending transactions exist in the DB but are excluded from

-- balance calculations and statement generation.

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;

ALTER TABLE transactions ADD CONSTRAINT transactions_status_check

CHECK (status IN ('posted', 'reversed', 'pending'));

Add a usage tracking table:

CREATE TABLE usage_periods (

id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

ledger_id UUID NOT NULL REFERENCES ledgers(id),

period_start DATE NOT NULL,

period_end DATE NOT NULL,

transaction_count INTEGER NOT NULL DEFAULT 0,

UNIQUE (ledger_id, period_start)

);

## Graceful Degradation Model

The free tier limit is enforced through progressive degradation, not a hard wall. The builder’s app never crashes. The consequence of not upgrading is delayed visibility — pending transactions are not reflected in statements or balances.

### At 400 Transactions (80%)

- API responses include an X-Kounta-Usage: 400/500 header

- Dashboard shows a yellow banner: “You’ve used 400 of 500 free transactions this month”

- Banner includes a direct “Upgrade to Builder” button

- MCP tool responses include a usage_warning field

- All transactions continue to post normally

### At 500 Transactions (100%)

- API returns a PLAN_LIMIT_REACHED status code on new posts

- The transaction is accepted and stored but with status = 'pending' instead of 'posted'

- Pending transactions have full audit trails but are excluded from balance calculations and statement generation

- Dashboard shows an orange banner: “You’ve reached your free tier limit. New transactions are queued. Upgrade to post them immediately.”

- Direct upgrade button in the banner

- The builder’s app receives a 202 Accepted response (not 200 OK) so the app knows the transaction was queued, not posted

- The response body includes { status: 'pending', reason: 'plan_limit_reached', upgrade_url: '...' }

### At 600 Transactions (120%)

- Hard stop. API returns 429 PLAN_LIMIT_EXCEEDED with a JSON error body

- The response includes: error code, current usage, limit, next reset date, and upgrade URL

- Dashboard shows a red banner: “Transaction posting is paused. 100 transactions are queued. Upgrade to post them, or they’ll be posted on \[reset date\].”

- Direct upgrade button

- The builder’s app receives a 429 response with a Retry-After header set to the next month reset date

### Monthly Reset

- On the 1st of each month, the usage counter resets to zero

- All pending transactions are automatically posted in chronological order

- Statements and balances update to reflect the newly posted transactions

- The builder is back on the free tier with zero usage

- If the builder has exceeded the limit three months in a row, the notification says: “You’ve exceeded the free tier 3 months running. Your business is outgrowing the free plan.”

### On Upgrade

- All pending transactions are immediately posted in chronological order

- Statements and balances update instantly

- Usage limit is removed

- The transition is seamless — no data loss, no reprocessing, no downtime

## Stripe Integration

### Setup

- Create a Stripe account and product with two prices: Builder monthly (\$49/month) and Builder annual (\$490/year, 2 months free)

- Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET as environment variables

- Create a webhook endpoint in the API at POST /v1/billing/webhook pointing to the Railway URL

### Checkout Flow

- User clicks “Upgrade to Builder” in the dashboard

- Dashboard calls POST /v1/billing/checkout which creates a Stripe Checkout Session

- The session is configured with the user’s email, the Builder price, and success/cancel URLs

- User is redirected to Stripe’s hosted checkout page — Kounta never touches card numbers

- After payment, Stripe redirects to the dashboard success page

- The webhook confirms the subscription and Kounta updates the user’s plan

### Webhook Events

|                                   |                                                                                                                 |
|-----------------------------------|-----------------------------------------------------------------------------------------------------------------|
| **Event**                         | **Action**                                                                                                      |
| **checkout.session.completed**    | Set user plan to 'builder'. Store stripe_customer_id and stripe_subscription_id. Post all pending transactions. |
| **invoice.payment_succeeded**     | Update plan_period_start and plan_period_end. Reset usage counter.                                              |
| **invoice.payment_failed**        | Send notification: “Your payment failed. Update your card to keep Builder features.” Grace period: 7 days.      |
| **customer.subscription.deleted** | Downgrade to free tier. Free tier limits apply from the next billing period.                                    |

### API Endpoints for Billing

POST /v1/billing/checkout → Create Stripe Checkout session

POST /v1/billing/portal → Create Stripe Customer Portal session (manage subscription)

POST /v1/billing/webhook → Stripe webhook handler

GET /v1/billing/status → Current plan, usage, limits, next reset date

## Dashboard Billing Page

A new screen at /billing in the dashboard showing:

- Current plan name and price

- Usage bar: transactions used / limit with percentage

- Next reset date

- Upgrade button (if on free tier) → redirects to Stripe Checkout

- Manage subscription button (if on Builder) → redirects to Stripe Customer Portal

- Invoice history pulled from Stripe

## Plan Enforcement Middleware

Add middleware to the transaction posting endpoint that checks the plan and usage before allowing a post:

async function enforcePlanLimit(ledgerId, userId) {

const user = await getUser(userId)

if (user.plan !== 'free') return { allowed: true, status: 'posted' }

const usage = await getCurrentMonthUsage(ledgerId)

if (usage \< 500) return { allowed: true, status: 'posted' }

if (usage \< 600) return { allowed: true, status: 'pending' }

return { allowed: false, status: 'rejected' }

}

# Domain and DNS

Configure a custom domain so the product has a professional URL instead of vercel.app and railway.app subdomains.

## Domain Structure

|                      |                                    |                             |
|----------------------|------------------------------------|-----------------------------|
| **Subdomain**        | **Points To**                      | **Purpose**                 |
| **kounta.ai**      | Vercel                             | Dashboard / marketing site  |
| **api.kounta.ai**  | Railway                            | REST API                    |
| **mcp.kounta.ai**  | Railway (same or separate service) | MCP server (SSE transport)  |
| **docs.kounta.ai** | Vercel or GitHub Pages             | Documentation site (future) |

## DNS Configuration

- Register kounta.ai (or similar available domain)

- Add a CNAME record for the root domain pointing to Vercel

- Add a CNAME record for api.kounta.ai pointing to Railway

- Add a CNAME record for mcp.kounta.ai pointing to the MCP server host

- Configure SSL certificates (automatic via Vercel and Railway)

- Update all OAuth callback URLs to use the new domain

- Update Stripe webhook endpoint to use the new domain

- Update CORS settings in the API to allow the new domain

# Testing

## New Tests Required

- PostgreSQL adapter: all existing engine tests must pass against PostgreSQL, not just SQLite

- Plan enforcement: verify that transactions at 0–499 post normally, 500–599 post as pending, 600+ are rejected

- Pending transactions: verify they are excluded from balance calculations and statement generation

- Monthly reset: verify that pending transactions are posted and usage counter resets

- Upgrade flow: verify that pending transactions post immediately on plan change

- Stripe webhook: verify each event type triggers the correct state change

- Auth flow: verify sign-in creates a user, issues an API key, and stores it in session

- Dashboard wiring: verify each screen renders data from the live API, not mock data

## End-to-End Test

A single test that exercises the complete user journey:

- Sign up with GitHub OAuth

- Select the SaaS template

- Arrive at the dashboard with a live ledger

- Post 5 transactions via the API

- Verify the P&L and Balance Sheet reflect those transactions

- Post 500 more transactions to hit the free tier limit

- Verify the next transaction is posted as pending

- Upgrade to Builder via Stripe (test mode)

- Verify the pending transaction is now posted

- Verify statements reflect all transactions

# Definition of Done

Block 1 is complete when all of the following are true:

- A builder can visit kounta.ai, sign up with GitHub or Google in under 60 seconds, and arrive at a dashboard with live data

- The API is hosted at api.kounta.ai and passes all 235 existing tests against PostgreSQL

- Every dashboard screen displays real data from the API, not mock data

- A free tier user can post up to 500 transactions per month normally

- Transactions 501–600 are accepted as pending and excluded from statements

- Transactions beyond 600 are rejected with a clear error and upgrade URL

- The builder can click “Upgrade to Builder” and complete a Stripe Checkout session

- On upgrade, all pending transactions post immediately and statements update

- On the 1st of each month, pending transactions post and the usage counter resets

- The dashboard billing page shows current plan, usage, and invoice history

- OAuth callback URLs, Stripe webhook, and CORS are configured for the custom domain

- The MCP server is hosted at mcp.kounta.ai and accessible to Claude Code and Cursor

**KOUNTA** — Phase 2 Block 1 — Make It Real — *Confidential*

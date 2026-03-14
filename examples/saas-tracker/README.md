# SaaS Subscription Tracker

A Next.js example app that uses **@kounta/sdk** to track SaaS subscription revenue with proper double-entry accounting. When a Stripe webhook fires for a payment event, it posts a journal entry to Kounta (debit Cash, credit Subscription Revenue). The app renders a live **Income Statement (P&L)** and **Balance Sheet** by calling the Kounta SDK.

## What This Example Shows

- **Stripe webhook integration** — receives `invoice.payment_succeeded` events and records them as balanced journal entries
- **Live financial statements** — P&L and Balance Sheet rendered server-side on every page load using `ledge.reports.incomeStatement()` and `ledge.reports.balanceSheet()`
- **SaaS template** — uses Kounta's built-in SaaS chart of accounts (18 accounts including Subscription Revenue, Deferred Revenue, Hosting & Infrastructure, etc.)
- **Idempotent transaction posting** — Stripe invoice IDs used as idempotency keys prevent duplicate entries
- **Simulate payments** — click a button to simulate payments without needing a real Stripe account

## Architecture

```
┌─────────────┐     webhook      ┌───────────────────┐      SDK       ┌──────────────┐
│   Stripe     │ ──────────────> │  Next.js App       │ ────────────> │  Kounta API   │
│   (payments) │                 │  /api/webhooks/    │               │  :3001       │
└─────────────┘                 │  stripe            │               └──────────────┘
                                 │                     │                       │
                                 │  Dashboard (SSR)    │ <─────────────────────┘
                                 │  - P&L statement    │   reports.incomeStatement()
                                 │  - Balance Sheet    │   reports.balanceSheet()
                                 │  - Transactions     │   transactions.list()
                                 └───────────────────┘
```

When a payment succeeds in Stripe, the webhook handler:

1. Receives the `invoice.payment_succeeded` event
2. Extracts the amount, customer email, and invoice ID
3. Posts a journal entry via the Kounta SDK:
   - **Debit** Cash (account 1000) — money received
   - **Credit** Subscription Revenue (account 4000) — revenue earned
4. Uses the Stripe invoice ID as an idempotency key for safe retries

## Prerequisites

- **Node.js** 18+
- **pnpm** (the Kounta monorepo package manager)
- The Kounta API running locally (port 3001)

## Quick Start

### 1. Start the Kounta API

From the **repository root**:

```bash
pnpm install
pnpm dev
```

This starts the Kounta API on `http://localhost:3001`. Note the admin secret printed in the console output.

### 2. Install example dependencies

```bash
cd examples/saas-tracker
pnpm install
```

### 3. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local` and set `KOUNTA_ADMIN_SECRET` to the value from step 1.

### 4. Seed sample data

```bash
KOUNTA_ADMIN_SECRET=your-secret pnpm seed
```

This creates a ledger with the SaaS template, generates an API key, and posts 12 sample transactions. Copy the output values into `.env.local`:

```
KOUNTA_BASE_URL=http://localhost:3001
KOUNTA_ADMIN_SECRET=your-admin-secret
KOUNTA_API_KEY=ldg_xxxxxxxx
KOUNTA_LEDGER_ID=01234567-89ab-cdef-...
```

### 5. Start the example app

```bash
pnpm dev
```

Open [http://localhost:3300](http://localhost:3300) to see the dashboard with:

- **KPI cards** — Revenue, Net Income, Cash, Total Assets
- **Income Statement** — Revenue, Cost of Revenue, Operating Expenses, Net Income
- **Balance Sheet** — Assets, Liabilities, Equity
- **Recent Transactions** — last 10 journal entries
- **Simulate Payment** button — posts a random subscription payment

## Stripe Webhook Setup (Optional)

For real Stripe integration:

### 1. Add Stripe keys to `.env.local`

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 2. Set up the Stripe CLI for local testing

```bash
stripe listen --forward-to localhost:3300/api/webhooks/stripe
```

### 3. Trigger a test event

```bash
stripe trigger invoice.payment_succeeded
```

The webhook handler verifies the Stripe signature when `STRIPE_WEBHOOK_SECRET` is set. Without it, the handler accepts raw JSON (for development).

## Project Structure

```
examples/saas-tracker/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout with header
│   │   ├── page.tsx                # Main dashboard (SSR)
│   │   ├── globals.css             # Tailwind + custom styles
│   │   └── api/
│   │       ├── webhooks/
│   │       │   └── stripe/
│   │       │       └── route.ts    # Stripe webhook handler
│   │       └── seed/
│   │           └── route.ts        # Simulate payment endpoint
│   ├── components/
│   │   ├── statement-table.tsx     # P&L / Balance Sheet renderer
│   │   ├── recent-transactions.tsx # Transaction list table
│   │   └── simulate-payment.tsx    # Payment simulation button
│   └── lib/
│       ├── ledge.ts                # Kounta SDK client singleton
│       ├── format.ts               # Currency/date formatters
│       └── seed.ts                 # CLI seed script
├── .env.example                    # Environment template
├── next.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

## Key Code Paths

### Posting a transaction (webhook handler)

```typescript
const txn = await kounta.transactions.post(LEDGER_ID, {
  date: new Date().toISOString(),
  memo: `${description} — ${customerEmail}`,
  idempotencyKey: `stripe:${invoice.id}`,
  lines: [
    { accountCode: "1000", amount: amountCents, direction: "debit" },
    { accountCode: "4000", amount: amountCents, direction: "credit" },
  ],
});
```

### Fetching financial statements (dashboard)

```typescript
const pnl = await kounta.reports.incomeStatement(LEDGER_ID, startDate, today);
const balanceSheet = await kounta.reports.balanceSheet(LEDGER_ID, today);
```

### SaaS Chart of Accounts

| Code | Account                       | Type      |
|------|-------------------------------|-----------|
| 1000 | Cash                          | Asset     |
| 1100 | Accounts Receivable           | Asset     |
| 1200 | Prepaid Expenses              | Asset     |
| 1500 | Equipment & Hardware          | Asset     |
| 2000 | Accounts Payable              | Liability |
| 2100 | Deferred Revenue              | Liability |
| 2200 | Accrued Expenses              | Liability |
| 3000 | Owner's Equity                | Equity    |
| 3100 | Retained Earnings             | Equity    |
| 4000 | Subscription Revenue          | Revenue   |
| 4100 | Professional Services Revenue | Revenue   |
| 4200 | Usage-Based Revenue           | Revenue   |
| 5000 | Hosting & Infrastructure      | Expense   |
| 5100 | Third-Party Services          | Expense   |
| 6000 | Salaries & Benefits           | Expense   |
| 6100 | Marketing & Advertising       | Expense   |
| 6200 | Research & Development        | Expense   |
| 6300 | General & Administrative      | Expense   |

## Extending This Example

- **Add more Stripe events** — handle `charge.refunded` to post reversal entries
- **Track deferred revenue** — when a customer prepays annually, debit Cash / credit Deferred Revenue, then recognize monthly
- **Add usage-based billing** — post metered usage from your billing system to account 4200
- **Connect your bank** — use `ledge.imports.upload()` to reconcile bank statements against Kounta entries

# Invoice Manager — Kounta Example

A freelancer invoice manager built with **Next.js** and **@kounta/sdk**. Demonstrates how to use Kounta's double-entry accounting engine to track invoices, payments, and expenses for a consulting business.

## What It Does

```
┌─────────────────────────────────────────────────────────────┐
│                    Invoice Manager                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─── Create Invoice ──┐  ┌─── Record Payment ─┐           │
│  │ Debit  1100 AR      │  │ Debit  1000 Cash   │           │
│  │ Credit 4000 Revenue │  │ Credit 1100 AR     │           │
│  └─────────────────────┘  └────────────────────┘           │
│                                                             │
│  ┌─── Record Expense ──┐                                    │
│  │ Debit  6xxx Expense │                                    │
│  │ Credit 1000 Cash    │                                    │
│  └─────────────────────┘                                    │
│                                                             │
│  ┌─── Reports ─────────────────────────────────────────┐    │
│  │ Income Statement  │  Balance Sheet  │  Acct Balances │   │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Three Core Workflows

1. **Create Invoice** — When you invoice a client, the app posts a journal entry that debits Accounts Receivable and credits Consulting Fees. Revenue is recognized immediately.

2. **Record Payment** — When a client pays, the app debits Cash and credits Accounts Receivable. Your AR balance goes down, cash goes up.

3. **Record Expense** — When you spend money (subcontractors, travel, software, etc.), the app debits the appropriate expense account and credits Cash.

Every action is a proper double-entry journal entry. The P&L and Balance Sheet update automatically.

## Quick Start

### Prerequisites

- The Kounta API running locally (from the monorepo root: `pnpm dev`)
- Node.js 18+, pnpm

### Setup

```bash
# From the monorepo root
cd examples/invoice-manager

# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env

# Seed the ledger with sample data
pnpm seed
# → Copy the KOUNTA_LEDGER_ID and KOUNTA_API_KEY into .env

# Start the dev server
pnpm dev
```

Open [http://localhost:3400](http://localhost:3400).

## Chart of Accounts (Consulting Template)

| Code | Account                    | Type    |
| ---- | -------------------------- | ------- |
| 1000 | Cash                       | Asset   |
| 1100 | Accounts Receivable        | Asset   |
| 1200 | Prepaid Expenses           | Asset   |
| 2000 | Accounts Payable           | Liability |
| 2100 | Deferred Revenue           | Liability |
| 2200 | Tax Liabilities            | Liability |
| 3000 | Owner's Equity             | Equity  |
| 3100 | Retained Earnings          | Equity  |
| 4000 | Consulting Fees            | Revenue |
| 4100 | Advisory Retainers         | Revenue |
| 4200 | Workshop & Training Revenue| Revenue |
| 5000 | Subcontractor Costs        | Expense (COGS) |
| 6000 | Salaries & Benefits        | Expense |
| 6100 | Travel & Entertainment     | Expense |
| 6200 | Professional Development   | Expense |
| 6300 | Insurance                  | Expense |
| 6400 | General & Administrative   | Expense |

## Seed Data

The seed script creates 8 sample transactions:

- **Invoice #1001** — Website Redesign for Acme Corp ($5,000)
- **Invoice #1002** — Strategy Workshop for Beta Inc ($2,500)
- **Payment** — Invoice #1001 paid ($5,000)
- **Invoice #1003** — Advisory Retainer for Gamma LLC ($3,500)
- **Expense** — Subcontractor UI design ($1,200)
- **Expense** — Flight to NYC ($450)
- **Expense** — Figma subscription ($144)
- **Expense** — Online TypeScript course ($199)

## Project Structure

```
src/
  app/
    page.tsx              # SSR dashboard — fetches P&L, Balance Sheet, accounts, transactions
    layout.tsx            # Root layout with header
    globals.css           # Dark theme styles
    api/
      invoice/route.ts    # POST — create invoice (debit AR, credit revenue)
      pay/route.ts        # POST — record payment (debit cash, credit AR)
      expense/route.ts    # POST — record expense (debit expense, credit cash)
  components/
    create-invoice.tsx    # Client form for creating invoices
    mark-paid.tsx         # Client form for recording payments
    record-expense.tsx    # Client form with expense category picker
    statement-table.tsx   # Renders StatementResponse (P&L / Balance Sheet)
    account-balances.tsx  # Renders all account balances grouped by type
    recent-transactions.tsx # Transaction journal
  lib/
    ledge.ts              # Kounta SDK singleton
    format.ts             # Currency and date formatters
    seed.ts               # CLI seed script
```

## Extending This Example

- Add invoice numbering with auto-increment
- Track individual invoices with metadata and link payments to specific invoices
- Add expense receipt uploads using Kounta transaction metadata
- Build an aging report for outstanding receivables
- Add tax calculation and withholding (debit expense, credit Tax Liabilities)
- Generate PDF invoices from transaction data

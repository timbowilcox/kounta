# Expense Tracker with CSV Import

A Next.js app using **@kounta/sdk** that demonstrates Kounta's import and reconciliation engine. Record expenses manually, import a bank statement CSV, and let the matching engine automatically reconcile imported rows against your recorded transactions — complete with confidence scores and a confirm/reject workflow.

## Features

- **Record Expenses** — Categorize expenses across 7 account types (COGS, Shipping, Marketing, Salaries, Platform Fees, G&A, Packaging)
- **CSV Import** — Upload a bank statement CSV; Kounta parses and matches rows automatically
- **Reconciliation Engine** — Confidence scoring (0–100%) based on date proximity, amount match, and text similarity
- **Match Review** — Visual confidence bars, status badges (matched/suggested/unmatched), and per-row confirm/reject toggles
- **Financial Statements** — Live Income Statement (P&L) and Balance Sheet
- **Double-Entry Accounting** — Every expense debits the expense account and credits Cash

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Next.js App                     │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  Record   │  │  Import  │  │   Match      │  │
│  │  Expense  │  │   CSV    │  │   Review     │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │              │               │           │
│  POST /api/    POST /api/     POST /api/        │
│  expense       import         confirm            │
└───────┼──────────┼───────────────┼───────────────┘
        │          │               │
        ▼          ▼               ▼
   ┌──────────────────────────────────────┐
   │           @kounta/sdk                  │
   │                                       │
   │  transactions.post()                  │
   │  imports.upload()                     │
   │  imports.confirmMatches()             │
   │  reports.incomeStatement()            │
   │  reports.balanceSheet()               │
   └──────────────────────────────────────┘
                    │
                    ▼
            Kounta API Server
```

## Reconciliation Flow

1. **Record expenses** — Creates double-entry transactions (debit expense, credit cash)
2. **Import CSV** — `ledge.imports.upload()` parses the CSV and runs the matching engine
3. **Matching engine scores** each imported row against existing transactions:
   - **Date score** (0–40 points): Exact match = 40, within 1 day = 30, within 3 days = 20
   - **Amount score** (0–40 points): Exact match = 40, within 1% = 30, within 5% = 20
   - **Text score** (0–20 points): Fuzzy matching on payee/memo text
   - **Total**: 0–100, normalized to 0.0–1.0
4. **Auto-match threshold**: >= 0.95 → `matched`, >= 0.60 → `suggested`, < 0.60 → `unmatched`
5. **Review & confirm** — User toggles Keep/Reject per row, then confirms all matches

## Setup

### Prerequisites

- Kounta API server running on `http://localhost:3001`
- Node.js 18+ and pnpm

### 1. Start the Kounta API

```bash
# From the repo root
pnpm dev
```

### 2. Seed Sample Data

```bash
cd examples/expense-tracker
cp .env.example .env.local
# Edit .env.local — set KOUNTA_ADMIN_SECRET from the API server output

pnpm seed
# Outputs: KOUNTA_API_KEY and KOUNTA_LEDGER_ID — paste these into .env.local
```

### 3. Start the App

```bash
pnpm dev
# Open http://localhost:3500
```

### 4. Test the Reconciliation

1. Open the app at `http://localhost:3500`
2. Click **Choose CSV File** and upload `sample-bank-statement.csv`
3. The matching engine runs automatically — review matched/suggested/unmatched rows
4. Toggle **Keep** or **Reject** on each matched row
5. Click **Confirm Matches** to reconcile

## Sample Data

The seed script creates 10 transactions using the **E-commerce** template:

| Date | Description | Account | Amount |
|------|-------------|---------|--------|
| 2026-02-03 | AWS hosting bill | 6300 G&A | $185.00 |
| 2026-02-05 | Google Ads campaign | 6100 Marketing | $450.00 |
| 2026-02-07 | Office supplies | 6300 G&A | $87.50 |
| 2026-02-10 | Shopify subscription | 6200 Platform Fees | $79.00 |
| 2026-02-12 | Team lunch | 6300 G&A | $124.00 |
| 2026-02-15 | Facebook ads | 6100 Marketing | $250.00 |
| 2026-02-18 | Shipping supplies | 5100 Shipping | $32.00 |
| 2026-02-20 | Zoom subscription | 6300 G&A | $149.90 |
| 2026-02-01 | Shopify payment transfer | 4000 Revenue | $8,500.00 |
| 2026-02-14 | Shopify payment transfer | 4000 Revenue | $4,200.00 |

The `sample-bank-statement.csv` has 12 rows — 10 that overlap with these transactions (producing high confidence matches) plus 2 new ones (Uber $45.60, Adobe $54.99) that won't match.

## Kounta SDK Methods Used

| Method | Purpose |
|--------|---------|
| `ledge.transactions.post()` | Record an expense |
| `ledge.transactions.list()` | Show recent transactions |
| `ledge.accounts.list()` | Get account balances |
| `ledge.imports.upload()` | Parse CSV and run matching |
| `ledge.imports.confirmMatches()` | Confirm/reject matches |
| `ledge.reports.incomeStatement()` | Generate P&L |
| `ledge.reports.balanceSheet()` | Generate balance sheet |

## Extension Ideas

- **Bulk expense upload** — Import expenses from a spreadsheet
- **Recurring expenses** — Auto-create monthly entries for subscriptions
- **Multi-currency** — Track expenses in multiple currencies
- **Receipt OCR** — Extract expense data from receipt images
- **Budget tracking** — Set per-category budgets and show burn rate
- **Export** — Download reconciled data as CSV for accountant

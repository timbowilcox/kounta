# LEDGE — Phase 2 Block 3: Make It Effortless

**Development Specification** | March 2026 | Confidential

*Companion to Block 1 (Deploy & Bill) and Block 2 (Bank Feeds, Intelligence, Multi-Currency)*

---

# Guiding Principle

Ledge should never add a burden. The founder should forget Ledge exists most weeks. The system runs in the background, classifies transactions, tracks revenue, and only reaches out when it genuinely needs human input — and even then, the founder should be able to resolve it from their inbox without logging in.

The cadence is:
- **Real-time:** Ledge processes everything silently
- **Weekly:** One email digest with a summary and any pending actions
- **Monthly:** Close prompt with one-click confirmation
- **Quarterly:** Tax prep summary
- **On-demand:** The founder opens Ledge when they want to understand their finances, not because they have to

---

# Target User Profile

The typical early-stage SaaS founder (pre-Series A, $0–$50K MRR):

**Their money situation is messy.** Revenue comes into Stripe. Stripe pays out to a bank account also used for personal spending. They pay for Vercel, AWS, Supabase, and Render on a personal credit card. Some months they pay contractors via Wise or PayPal.

**They don't have an accountant.** Or they have a cheap one they talk to once a year at tax time who asks for "a spreadsheet of your income and expenses."

**What they actually need:**
1. Know how much money they're making (real profit, not just Stripe revenue)
2. Know their burn rate and runway
3. Know what they can deduct at tax time
4. Not think about accounting more than 10 minutes per month
5. Have something they can hand to an accountant that isn't a mess

**What they absolutely will not do:**
- Learn debits and credits
- Manually categorise 200 transactions a month
- Set up a chart of accounts from scratch
- Post journal entries
- Reconcile anything manually on a regular basis

---

# Feature Status

| # | Feature | Status | Sessions Est. |
|---|---------|--------|---------------|
| 1 | Classification Rules Engine | ✅ COMPLETE | Done |
| 2 | Communication System | ❌ Not started | 2-3 |
| 3 | Onboarding Flow UI | ❌ Not started | 2-3 |
| 4 | Personal Transaction Exclusion | ⚠️ Partial (flag exists) | 1 |
| 5 | Receipt/Document Attachments | ❌ Not started | 1 |
| 6 | Stripe Connector | ❌ Not started | 3-4 |
| 7 | Recurring Journal Entries | ❌ Not started | 1-2 |

---

# 1. Classification Rules Engine ✅ COMPLETE

Built and deployed. Three-layer classification system:

- **Layer 1 — Exact rules:** User-defined or auto-generated exact/contains/regex rules per ledger
- **Layer 2 — Fuzzy matching:** Merchant alias table normalises bank feed descriptions (19 SaaS vendors pre-seeded with common bank statement variations)
- **Layer 3 — Global consensus:** Anonymous aggregate merchant-to-category mappings across all users. When 85%+ of users classify a merchant the same way, new users get automatic classification. Privacy-preserving: stores only canonical_merchant → account_type/account_name mappings with counts, never user IDs or amounts.

Auto-rule generation: after a user classifies the same merchant to the same account twice, an exact-match rule is auto-created. Every classification (manual, auto-rule, or confirmed suggestion) updates the global_classifications table asynchronously.

Migration 008 deployed. 19 classification tests passing. 5 MCP tools, SDK module, 6 API endpoints.

**AI Classification (Layer 4 — Future):** Not yet built. Will use the Anthropic API to classify transactions that don't match any rule or global consensus. Confidence-scored: >=95% auto-classify silently, 80-94% classify but flag in digest, 60-79% include in digest for confirmation, <60% ask explicitly.

---

# 2. Communication System

## The Problem

Ledge only communicates through the dashboard. Notifications and classification requests sit in the UI waiting for the user to log in. A SaaS founder heads-down building won't log into Ledge daily. Pending items accumulate, books get stale, and the product feels broken when they finally check.

## The Solution: Email-First, Action-From-Inbox

Every communication Ledge sends should be resolvable without logging in. The email itself contains the action. The founder taps a button in the email and the thing is done.

### Email Infrastructure

Use Resend for transactional email. Create a Ledge-branded email template system.

- **Sender:** notifications@useledge.ai (configure Resend domain verification for useledge.ai)
- **Reply-to:** No reply (actions are via links, not email replies)
- **Style:** Clean, monochrome, white background, #0A0A0A text, minimal colour. Blue (#0066FF) buttons for primary actions. Ledge logo at top. Unsubscribe link at bottom. Mobile-responsive (max-width 600px, single column). Geist-like aesthetic.

### Email Types

#### 1. Weekly Digest (every Monday 9am in user's timezone)

Subject: "Your week in numbers — $X revenue, $Y expenses"

Content:
```
Hey Tim,

Here's your week at a glance:

Revenue:     $2,450
Expenses:    $1,120
Net:         $1,330
Cash:        $14,200

---

5 transactions need your input:

$42.99 — NOTION.SO (Mar 8)
[Software Tools]  [Marketing]  [Personal]  [Other →]

$129.00 — HETZNER ONLINE (Mar 9)
[Hosting]  [Infrastructure]  [Personal]  [Other →]

$19.99 — NETFLIX.COM (Mar 10)
[Personal]  [Entertainment]  [Other →]

[Classify all in Ledge →]

---

Insights:
• Hosting costs are 23% higher than your 3-month average
• You've received 3 Stripe payouts this week totalling $2,450

Have a great week.
— Ledge
```

**Classification buttons are real action links.** Each button is a signed URL: `https://useledge.ai/api/email-action?action=classify&txn=UUID&category=CATEGORY&token=SIGNED_TOKEN`. Clicking classifies the transaction immediately and shows a confirmation page: "✓ Classified as Software Tools. [Undo]". No login required.

The signed token contains: transaction ID, ledger ID, user ID, selected category, and expiry (7 days). Verified server-side. Single-use — can't be replayed.

#### 2. Monthly Close Prompt (1st of each month, 9am)

Subject: "March is done — close your books in one click"

Content: Monthly summary (revenue, expenses, net income, cash), one-click "Close March →" button. If pending classifications exist: "3 transactions still need classification before closing. [Classify now →]"

#### 3. Urgent Alerts (immediate, max 2 per week)

Only sent for genuinely urgent situations:
- **Large unusual transaction:** "$5,000 payment to UNKNOWN VENDOR — is this expected?"
- **Failed bank connection:** "Your CBA connection stopped syncing 2 days ago. [Reconnect →]"
- **Low cash alert:** "Your cash balance is $2,100. At your current burn rate, that's 1.2 months of runway."
- **Plan limit approaching:** "You've used 450 of 500 free transactions this month."

Never send urgent alerts for routine classification. That's what the weekly digest is for.

#### 4. Quarterly Tax Summary (end of each quarter)

Subject: "Q1 2026 tax summary ready"

Content: Revenue, deductible expenses by category, estimated tax liability (if configured), link to download full report as PDF.

#### 5. Onboarding Sequence (days 1, 3, 7 after signup)

- Day 1 (immediate): "Welcome to Ledge — connect your bank to get started" (only if they didn't connect during onboarding)
- Day 3: "Your first transactions are ready to classify" (only if bank connected but items unclassified)
- Day 7: "Here's your first weekly financial snapshot" (first weekly digest, even if it's not Monday)

### Data Model

```sql
CREATE TABLE email_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekly_digest BOOLEAN NOT NULL DEFAULT true,
  monthly_close BOOLEAN NOT NULL DEFAULT true,
  urgent_alerts BOOLEAN NOT NULL DEFAULT true,
  quarterly_tax BOOLEAN NOT NULL DEFAULT true,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  digest_day TEXT NOT NULL DEFAULT 'monday',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  email_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resend_id TEXT,
  metadata JSONB
);

CREATE TABLE email_action_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Email Action Endpoint

```
GET /api/email-action
  Query params: action, txn, category, token

  Verifies token (not expired, not used)
  Executes action:
  - classify: POST /v1/bank-feeds/transactions/:txn/classify
  - close: close the specified period
  - reconnect: redirect to Basiq consent flow
  - unsubscribe: update email_preferences

  Returns minimal HTML confirmation page: "✓ Done" with Undo link
  Invalid/expired token: error page with "Open Ledge" link
```

### Email Scheduling

The API process runs a lightweight scheduler (same pattern as intelligence layer):
- Every hour: check if weekly digests are due (9am in user's timezone on their digest_day, not yet sent this week)
- Every hour on the 1st: check if monthly close prompts are due
- After bank feed sync: check if transaction triggers an urgent alert
- On signup: queue onboarding sequence

### API Endpoints

```
GET  /v1/email/preferences — get user's email preferences
PUT  /v1/email/preferences — update preferences
POST /v1/email/send-digest — manually trigger digest (admin)
POST /v1/email/verify-token — verify an action token
```

### Settings UI

In Settings, add an "Email" section:
- Toggle for each email type (weekly digest, monthly close, urgent alerts, quarterly tax)
- Timezone selector
- Digest day selector (Monday-Sunday)

Auto-create default email_preferences when a user is provisioned.

---

# 3. Onboarding Flow UI

## Current Flow (being replaced)

1. OAuth sign-in → 2. Template picker (8 templates) → 3. Empty dashboard

Problems: cold template choice with no context, empty dashboard with no guidance, no path from signup to financial picture.

## New Flow: AI-Guided Conversational Setup

### Route: /onboarding

After OAuth sign-in, if user has no ledger, redirect to /onboarding instead of the dashboard. Full-width page, no sidebar, clean. Ledge logo top-left, progress indicator top-right.

### Step 1: Business Type (1 click)

```
Welcome to Ledge.
Let's set up your books in about 3 minutes.
What kind of business are you running?

[I'm building a SaaS product]
[I freelance or consult]
[I run an ecommerce store]
[Something else]
```

Clickable cards: 80px height, white bg, border #E5E5E5, icon on left, text 14px font-medium. Selected: border #0066FF, bg #F0F6FF.

### Step 2: Business Details (6 clicks)

```
A few quick details:

Currency:           [USD ▾] (auto-detected from browser locale)
How long running?   [Just started] [< 1 year] [1-3 years] [3+ years]
Payment processor:  [Stripe] [PayPal] [Other] [None yet]
Bank situation:     [Separate business account] [Mixed personal/business] [Not sure]
Business structure: [Sole proprietor] [LLC] [S-Corp / C-Corp] [Not incorporated] [Australian Pty Ltd] [Australian Sole Trader]
Country:            [Auto-detected, editable]
```

All segmented buttons or dropdowns. No text input.

### Step 3: Setting Up (automated, 2-3 seconds)

Animated progress with 400ms stagger:
```
✓ Created chart of accounts (18 accounts for SaaS)
✓ Added Stripe revenue tracking
✓ Added standard SaaS expense categories
✓ Configured USD / accrual basis
✓ Set up classification rules for common vendors
```

This step creates the ledger and seeds accounts using the appropriate template. Customise based on answers:
- payment_processor = stripe → add 1050 Stripe Balance account
- bank_situation = mixed → add Personal Account, enable personal transaction detection
- Set currency from selection

### Step 4: Connect Money (1 click)

```
Now let's connect your money.

[Connect bank account →]   (primary, starts Basiq flow)
[Connect Stripe →]         (secondary, or "Coming soon")
[Skip for now →]           (ghost link)
```

After connecting or skipping → redirect to dashboard.

### Step 5: First Classification (after first bank sync)

Modal overlay on dashboard when bank_transactions exist but many are unclassified:

```
I pulled in 47 transactions from the last 30 days.
I recognised 31 automatically. Here are 16 that need your input.

$42.99 — NOTION.SO — Mar 8
[Software Tools]  [Marketing]  [Personal]  [Other →]
```

Cards stack vertically. Each classification is a single tap — card slides up, next appears. Progress bar: "5 of 16 classified." "I'll do this later →" dismisses.

After completion: financial snapshot (revenue, expenses, net income, cash) + "Go to dashboard →"

### Progress Checklist

Persistent (but dismissible) progress bar on overview page:

```
Getting started with Ledge              4/6 complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 67%

✓ Business profile configured
✓ Chart of accounts created
✓ Bank account connected
✓ First transactions classified
○ Connect Stripe (recommended)
○ Set up tax profile
```

Each incomplete item is actionable. Disappears after all complete, or after 30 days, or user dismisses.

### Auto-Create Accounts for Bank Connections

When a user connects a bank account via Basiq, automatically create the corresponding Ledge account:

| Basiq Account Type | Ledge Account Type | Code Range |
|--------------------|--------------------|------------|
| Transaction/Savings | Asset | 1000-series |
| Credit card | Liability | 2100-series |
| Loan | Liability | 2200-series |

Use the account name from Basiq: "CBA Everyday Account" → "1001 CBA Everyday Account (Asset)". Auto-assign next available code in the appropriate range. Map the bank_account to this new Ledge account automatically.

### Data Model

```sql
CREATE TABLE onboarding_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_type TEXT,
  business_age TEXT,
  payment_processor TEXT,
  bank_situation TEXT,
  business_structure TEXT,
  country TEXT,
  currency TEXT,
  completed_steps JSONB NOT NULL DEFAULT '[]',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE onboarding_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  dismissed BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(user_id, item)
);
```

---

# 4. Personal Transaction Exclusion

## Status

The `is_personal` boolean flag already exists on `bank_transactions` (added in migration 008). Classification rules can set `is_personal = true`. What remains is the downstream integration.

## Statement Exclusion

All statement generation queries (income statement, balance sheet, cash flow) must exclude personal transactions. Add `WHERE is_personal = false` or equivalent filter to any query that pulls from bank-feed-sourced transactions. Manually posted transactions are never personal.

## Overview Page

Exclude personal transactions from revenue, expenses, and cash balance calculations on the overview stat cards.

## Dashboard Integration

**Bank feeds page:** Add filter toggle: "Business" (default) | "Personal" | "All". Personal transactions shown with muted styling and "Personal" badge.

**Transactions page:** Personal transactions hidden by default. Toggle to show/hide. When shown, display with muted text and "Personal" badge.

**Classification UI:** Every classification interface (bank feeds page, first-classification modal, email action links) must include "Personal — exclude" as a prominent option alongside category buttons. Visually distinct — grey instead of blue.

---

# 5. Receipt/Document Attachments

## Why This Matters

The IRS requires supporting documentation for business expenses. For every expense, records must identify: the payee, the amount paid, proof of payment, the date incurred, and a description of the item or service. Bank feed data covers payee, amount, date, and proof of payment. The gap is receipts and invoices — especially for expenses over $75 and for travel/entertainment.

## Data Model

```sql
CREATE TABLE transaction_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_attachments_transaction ON transaction_attachments(transaction_id);
```

## Storage Abstraction

```typescript
interface AttachmentStorage {
  upload(key: string, data: Buffer, mimeType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getUrl(key: string): Promise<string>;
}
```

Implement `LocalFileStorage` for now (files saved to /data/attachments on Railway). Interface allows swapping to S3 or Supabase Storage later.

## API Endpoints

```
POST   /v1/ledgers/:id/transactions/:txnId/attachments — multipart upload, max 10MB, image/* or application/pdf
GET    /v1/ledgers/:id/transactions/:txnId/attachments — list attachments
GET    /v1/attachments/:id/download — download file
DELETE /v1/attachments/:id — delete attachment
```

## Dashboard

Transaction detail view (expanded row): add "Attachments" section below line items. Thumbnails for images, PDF icon for PDFs. "Attach receipt" button, upload progress, delete with confirmation.

## Intelligence Layer Integration

Prompt for receipts on expenses over $75: "You posted a $450 expense. Attach the receipt for tax purposes. [Attach now →]". Add `receipt_reminder` notification type. Include in weekly digest if recent unattached expenses over $75 exist.

---

# 6. Stripe Connector

## Why This Matters

Bank feeds show Stripe payouts as lump sums: "$4,200 from STRIPE." A native Stripe integration posts every charge, refund, and fee as a separate double-entry transaction. The founder can see actual MRR, churn impact, and processing costs.

## Architecture

```
Stripe → OAuth → Ledge stores access token + subscribes to webhooks
Stripe events → Ledge webhook → Individual ledger transactions
                              → Reconciles against bank feed payout
```

## Data Model

```sql
CREATE TABLE stripe_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  stripe_account_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  stripe_publishable_key TEXT,
  webhook_secret TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disconnected', 'error')),
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, stripe_account_id)
);

CREATE TABLE stripe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES stripe_connections(id),
  stripe_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ledger_transaction_id UUID REFERENCES transactions(id),
  metadata JSONB,
  UNIQUE(connection_id, stripe_event_id)
);
```

## Webhook Event Handling

| Event | Debit | Credit | Notes |
|-------|-------|--------|-------|
| charge.succeeded | 1050 Stripe Balance | 4000 Revenue | Gross amount, includes customer/plan metadata |
| charge.refunded | 4100 Refunds | 1050 Stripe Balance | Linked to original charge |
| payout.paid | 1000 Cash/Bank | 1050 Stripe Balance | Reconciles against bank feed |
| Fee (calculated) | 5200 Processing Fees | 1050 Stripe Balance | charge.amount − charge.amount_after_fees |

Deduplication via stripe_events table. Payout reconciliation: match bank feed deposit by amount + date (±2 days tolerance).

## Account Auto-Creation

When Stripe connected, add if missing: 1050 Stripe Balance (Asset), 4100 Refunds (Revenue contra), 5200 Payment Processing Fees (Expense).

## API Endpoints

```
GET  /v1/stripe/connect — redirect to Stripe OAuth
GET  /v1/stripe/callback — handle callback, store tokens, trigger 90-day backfill
GET  /v1/stripe/status — connection status
POST /v1/stripe/disconnect — disconnect
POST /v1/stripe/sync — manual re-sync
POST /v1/stripe/webhook — handle events (public, signature-verified)
```

## Environment Variables

`STRIPE_CONNECT_CLIENT_ID` — OAuth client ID from Stripe Connect settings.

---

# 7. Recurring Journal Entries

## What It Solves

Monthly depreciation, amortisation, accruals, and other periodic entries require manual posting today. Recurring entries automate this completely.

## Data Model

```sql
CREATE TABLE recurring_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  user_id UUID NOT NULL REFERENCES users(id),
  description TEXT NOT NULL,
  line_items JSONB NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'annually')),
  day_of_month INTEGER,
  next_run_date DATE NOT NULL,
  last_run_date DATE,
  auto_reverse BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE recurring_entry_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_entry_id UUID NOT NULL REFERENCES recurring_entries(id),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  posted_date DATE NOT NULL,
  reversal_transaction_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Processing Logic

Hourly scheduler checks entries where `next_run_date <= today` and `is_active = true`:

1. Post transaction using stored line_items
2. Log in recurring_entry_log
3. If auto_reverse = true, create reversal dated 1st of next period
4. Advance next_run_date based on frequency
5. Include in monthly close email: "3 recurring entries were posted this month"

Edge case: day_of_month = 31 for shorter months → use last day of month.

## API, SDK, MCP, Dashboard

- API: CRUD endpoints + pause/resume + manual process trigger
- SDK: RecurringModule
- MCP: list/create/update/pause tools
- Dashboard: Settings → Recurring Entries section
- Assistant: create_recurring_entry tool

---

# Cash Account Structure

A single "Cash" account is insufficient. Each bank account, credit card, and payment processor needs its own account:

| Code | Name | Type |
|------|------|------|
| 1000 | Business Checking | Asset |
| 1010 | Business Savings | Asset |
| 1020 | Personal Account (mixed) | Asset |
| 1050 | Stripe Balance | Asset |
| 1060 | PayPal Balance | Asset |
| 2100 | Credit Card | Liability |

Connected accounts are auto-created during onboarding/bank connection. The SaaS Starter template should include this base structure.

---

# Audit Readiness (US / IRS)

**What Ledge captures automatically:** payee, amount, date, proof of payment (bank feeds), customer and charge details (Stripe), expense category (classification engine), immutable audit trail (reversals only, never deletions).

**What requires user input:** receipt attachments for expenses (especially >$75), business purpose notes for travel/entertainment, asset tracking for large purchases (>$500).

**Retention:** All data retained minimum 7 years. Ledge never auto-deletes financial data.

**Export (Block 4):** Year-end tax pack — categorised transactions, receipts, P&L, balance sheet, depreciation schedules — packaged for accountant handoff.

---

# Ongoing Manual Interventions

## Weekly (2-3 minutes, via email)
- Classify <5 new/unusual transactions (directly from email buttons)
- Review weekly summary (no action unless something looks wrong)

## Monthly (1-2 minutes, via email)
- Confirm monthly close (one click)
- Review auto-posted recurring entries

## Quarterly (15-20 minutes)
- Review tax prep summary, answer flagged questions, send to accountant

## Annually
- Generate tax-ready export, hand to accountant

---

# Build Sequence

| Session | Feature | Est. Sessions |
|---------|---------|---------------|
| 1 | Communication System | 2-3 |
| 2 | Onboarding Flow | 2-3 |
| 3 | Personal Exclusion + Receipt Attachments | 1 |
| 4 | Stripe Connector | 3-4 |
| 5 | Recurring Journal Entries | 1-2 |
| | **Total** | **10-14** |

---

# Definition of Done

Block 3 is complete when:

- A SaaS founder signs up, answers 4 questions, and has books configured automatically — no template picker, no chart of accounts
- Connected bank accounts auto-create corresponding Ledge accounts (checking = asset, credit card = liability)
- Bank transactions auto-classified with <5/week needing manual input after 60 days
- Weekly email digest with financial summary and email-based classification (no login required)
- Monthly close is one click from email
- Urgent alerts sent immediately, rate-limited to 2/week
- Personal transactions on mixed accounts excluded from financial statements
- Receipts/invoices attachable to transactions for audit readiness
- Intelligence layer prompts for missing receipts on expenses >$75
- Stripe charges, refunds, and fees posted as individual double-entry transactions
- Stripe payouts reconcile against bank feeds without double-counting
- Recurring entries auto-post on schedule with optional auto-reverse
- Founder spends <5 minutes/week on books, zero minutes most weeks

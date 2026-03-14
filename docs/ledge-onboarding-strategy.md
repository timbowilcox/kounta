# Kounta — Onboarding & Operational Intelligence
## For Solo SaaS Founders

---

## The SaaS Founder's Reality

Before designing the solution, we need to understand the person we're building for. The typical early-stage SaaS founder (pre-Series A, $0–$50K MRR) has a very specific financial reality:

**Their money situation is messy.** They don't have clean corporate accounts. Revenue comes into Stripe. Stripe pays out to a bank account that's also used for personal spending. They pay for Vercel, AWS, Supabase, and Render on a personal credit card. Some months they pay contractors via Wise or PayPal. They might have a separate business bank account, but half their business expenses still hit the personal card because that's what was saved in Chrome when they signed up for Hetzner at 2am.

**They don't have an accountant.** Or they have a cheap one they talk to once a year at tax time, who asks for "a spreadsheet of your income and expenses" and they spend a panicked weekend pulling Stripe exports and scrolling through bank statements.

**They know they should track finances properly.** They've tried QuickBooks (too complex, designed for accountants), Wave (too basic, felt like a toy), Xero (too expensive for what they need, interface assumes you know accounting). They gave up and went back to a spreadsheet, which they update sporadically, or they stopped tracking entirely and just look at their Stripe dashboard and bank balance.

**What they actually need:**
1. Know how much money they're making (real profit, not just Stripe revenue)
2. Know their burn rate and runway
3. Know what they can deduct at tax time
4. Not think about accounting more than 10 minutes per month
5. Have something they can hand to an accountant or tax professional that isn't a mess

**What they absolutely will not do:**
- Learn debits and credits
- Manually categorise 200 transactions a month
- Set up a chart of accounts from scratch
- Post journal entries
- Reconcile anything manually on a regular basis

---

## Current Onboarding Flow

Today, when someone signs up at kounta.ai:

```
1. Click "Sign in with GitHub" or "Sign in with Google"
2. OAuth redirects back to Kounta
3. Provision endpoint creates a user + ledger
4. Template picker appears (8 templates: SaaS, Freelancer, 
   Ecommerce, Restaurant, Nonprofit, Agency, Property, General)
5. Template seeds the chart of accounts (15-25 accounts)
6. User lands on the Overview page with zero data
7. They see empty stat cards, empty transaction list, and 
   quick action buttons
```

**What's wrong with this:**

- The template picker is a cold choice with no context. The user has to know which template fits them. "SaaS Starter" sounds right but they don't know what accounts it creates or why.
- After template selection, they land on an empty dashboard with no guidance. The product feels dead.
- There's no explanation of what to do next. Connect a bank? Post a transaction? What?
- The "Post transaction" button assumes they know what a transaction is in accounting terms.
- There's no path from "I just signed up" to "I can see my financial picture."
- The critical first action — connecting their bank or importing Stripe data — is buried in a sidebar nav item.

---

## Redesigned Onboarding: The AI-Guided Setup

The onboarding should be delivered by Kounta's own assistant, not the user's external AI agent. The user's MCP-connected agent (Claude Code, Cursor) is for building integrations later. The onboarding assistant is Kounta's product experience — it knows the product, knows the user's context, and guides them through setup conversationally.

### Flow: First 5 Minutes

**Step 1: Welcome + Context Gathering (60 seconds)**

After OAuth, instead of a template picker, the user lands on a single-purpose onboarding screen. Full width, clean, no dashboard chrome yet. The assistant greets them:

```
"Welcome to Kounta. I'm going to set up your books in about 
3 minutes. I just need to understand your business.

What kind of business are you running?"
```

Options (clickable cards, not a dropdown):
- I'm building a SaaS product
- I freelance / consult
- I run an ecommerce store
- Something else

When they click "SaaS product":

```
"Got it. A few more quick questions:

- What currency do you operate in? [Auto-detect from locale, 
  show as pre-selected with option to change]
- Roughly how long have you been running? 
  [Just started / Under a year / 1-3 years / 3+ years]
- Do you process payments through Stripe? [Yes / No / Other]
- Do you have a separate business bank account, or does 
  business money flow through your personal account? 
  [Separate / Mixed / Not sure]
```

This is 4 quick clicks. From these answers, the assistant knows:
- Which template to use (SaaS Starter)
- Which accounts to emphasise (Stripe as a cash source, hosting/infrastructure as key expense categories)
- Whether to set up personal/business expense splitting
- What the first integration should be (Stripe connector or bank feed)

**Step 2: Automatic Setup (30 seconds)**

```
"Setting up your books now..."

✓ Created your chart of accounts (18 accounts tailored for SaaS)
✓ Added Stripe Revenue, Subscription Revenue, and Refunds 
  accounts
✓ Added standard SaaS expense categories: Hosting, 
  Infrastructure, Marketing, Contractors, Software Tools
✓ Set USD as your base currency
✓ Configured accrual basis accounting

"Your books are ready. Now let's connect your money."
```

No template picker. No choice paralysis. The assistant made the right decision based on their answers.

**Step 3: Connect the Money (90 seconds)**

```
"The fastest way to get your financial picture is to connect 
your bank account. I'll pull in your transactions automatically 
and start categorising them.

[Connect bank account →]

Or if you'd rather start with Stripe:
[Connect Stripe →]

You can also skip this and add data later.
[Skip for now]
```

If they click "Connect bank account" → Basiq consent flow.
If they click "Connect Stripe" → Stripe OAuth flow (future feature, but the button should exist from day one even if it shows "Coming soon — we'll notify you").
If they skip → go to dashboard with a persistent banner: "Connect your bank account to see your financial picture."

**Step 4: First Categorisation (60 seconds)**

If they connected a bank account, transactions start flowing in. The assistant immediately starts working:

```
"I've pulled in 47 transactions from the last 30 days. Let me 
categorise them for you..."

"I recognise 31 of these:
- 12 Stripe payouts → Revenue
- 4 AWS charges → Hosting & Infrastructure
- 3 Vercel charges → Hosting & Infrastructure
- 2 GitHub charges → Software Tools
- 10 others I'm confident about

That leaves 16 I need your help with. Let me show you the 
first few — once I learn your patterns, I won't ask again."
```

Then a rapid-fire classification interface:

```
$42.99 — NOTION.SO
[Software Tools] [Marketing] [Other...] [Personal — exclude]

$129.00 — HETZNER
[Hosting] [Infrastructure] [Other...] [Personal — exclude]

$19.99 — NETFLIX.COM
[Personal — exclude] [Entertainment] [Other...]
```

Key insight: **the "Personal — exclude" option is critical.** SaaS founders with mixed accounts need a one-tap way to say "this isn't business." Excluded transactions aren't deleted — they're tagged as personal and hidden from financial statements but kept for audit trail.

After classifying 5-8 transactions, the assistant learns:
- Netflix = always personal
- Notion = always Software Tools
- Any transaction containing "AWS" or "AMAZON WEB SERVICES" = Hosting

```
"Got it. I'll handle these automatically going forward. You 
can always change a classification later.

Here's your first financial snapshot:"
```

**Step 5: First Financial Snapshot (immediate)**

The dashboard loads with real data:

```
Revenue this month: $4,200
Expenses this month: $1,850
Net income: $2,350
Cash balance: $12,400
Burn rate: $1,850/month
Runway: 6.7 months (at current burn)
```

The user went from "I just signed up" to "I can see my financial picture" in under 5 minutes. That's the experience.

---

## Ongoing Manual Interventions Required

Even with the best automation, the founder will need to do some things manually. The goal is to minimise these and make each one take less than 30 seconds.

### Weekly (2-3 minutes total)

**1. Classify new/unusual transactions**
Bank feeds bring in everything. Most get auto-classified by learned patterns. New vendors or unusual amounts surface as notifications: "I don't recognise this $2,400 payment to ACME CORP. What is it?" One tap to classify.

Target: <5 transactions per week need manual classification after the first month of learning.

**2. Review the assistant's weekly summary**
The intelligence layer generates: "This week: $1,200 revenue, $640 expenses. Your hosting costs increased 20% — Vercel bill was higher than usual."

No action required unless something looks wrong.

### Monthly (5-10 minutes total)

**1. Confirm the monthly close**
Notification: "March is complete. Revenue: $4,800, Expenses: $2,100, Net income: $2,700. Close the books for March?" One click.

**2. Handle any suggested accruals**
If the system detects a pattern (e.g., annual domain renewal paid in January but benefits all 12 months), it suggests: "Should I spread the $120 GoDaddy charge across 12 months?" Yes/No.

**3. Review contractor payments (if applicable)**
If they pay contractors, the system flags: "You paid @designer $3,000 this month. Is this a one-time project or ongoing?" This helps with expense categorisation and potential 1099 implications.

### Quarterly (15-20 minutes)

**1. Tax prep review**
The intelligence layer generates a tax summary: estimated revenue, deductible expenses by category, and estimated tax liability. The founder reviews it, answers any flagged questions ("Is your home office 15% of your home? I need this for the deduction calculation."), and either sends it to their accountant or files themselves.

**2. Review P&L trends**
The assistant proactively surfaces: "Your infrastructure costs grew 40% quarter-over-quarter but revenue only grew 15%. Your gross margin is shrinking." The founder decides if action is needed.

### Annually

**1. Tax filing**
Generate a tax-ready export. For US founders: Schedule C data (sole prop) or 1120-S data (S-Corp). For Australian founders: BAS summary and tax return data. The founder hands this to their accountant or uses it for self-filing.

---

## Eliminating Manual Interventions

For each manual intervention, here's how we reduce or eliminate it:

### Classification → Rules Engine + Pattern Learning

**Current state:** Manual classification of unknown transactions.

**Solution: Three-layer classification system**

Layer 1 — Exact match rules: "VERCEL INC" always maps to "5100 Hosting." Created automatically after the user classifies a vendor twice. Zero ambiguity, zero interaction needed.

Layer 2 — Fuzzy pattern matching: "AMAZON WEB SERVICES" and "AWS" and "AMZN WEB SVCS" all resolve to "5100 Hosting." Uses string similarity and merchant name normalisation.

Layer 3 — AI classification: For truly unknown transactions, the assistant analyses the amount, frequency, merchant category code (from bank data), and description to suggest a category. Confidence > 90% = auto-classify silently. Confidence 60-90% = suggest with one-tap confirm. Confidence < 60% = ask.

**Expected result:** After 60 days, <2 transactions per week need manual input.

### Stripe Revenue → Native Connector

**Current state:** Stripe payouts appear as lump sums in bank feeds. A $4,200 payout might represent 47 individual subscription payments, 2 refunds, and Stripe's processing fees. The bank feed just shows "$4,200 from STRIPE."

**The problem:** This is useless for understanding revenue. The founder can't see MRR, churn, or revenue by customer.

**Solution: Stripe connector that posts granular transactions:**

- Each Stripe charge → separate revenue transaction with customer name, plan, and amount
- Each refund → separate refund transaction linked to the original charge
- Stripe fees → separate fee expense transaction
- Payout → reconciliation entry that matches the bank deposit

This means the P&L shows real revenue numbers, not Stripe payout totals. And the founder can see "Customer X is on the $49/month plan" in their books.

**Implementation:** Stripe OAuth → webhook subscription → on each charge.succeeded / refund.created / payout.paid event, post a Kounta transaction automatically. No user intervention after initial connection.

### Recurring Entries → Auto-posting

**Current state:** Depreciation, amortisation, and accruals require manual journal entries every month.

**Solution:** Recurring transaction templates.

The user (or assistant) creates a template once: "Post $100 depreciation on computer equipment on the 1st of every month." Kounta posts it automatically. The monthly close notification includes: "3 recurring entries were posted this month" with a one-click review.

### Personal/Business Splitting → Smart Detection

**Current state:** Founder manually marks transactions as "personal — exclude."

**Solution:** The classification engine learns personal spending patterns. After marking Netflix, Uber Eats, and Woolworths as personal a few times, the system auto-excludes similar merchants. It also uses amount patterns: a $4.50 coffee is probably personal; a $450 software subscription is probably business.

Additional: allow the user to tag specific bank accounts or cards as "mixed" during onboarding. For mixed accounts, every transaction gets a business/personal classification step. For business-only accounts, everything is assumed business.

### Tax Preparation → Automated Export

**Current state:** Founder manually compiles data for their accountant.

**Solution:** One-click tax pack generation.

Based on the business structure (sole prop, LLC, S-Corp, Australian sole trader, Pty Ltd) selected during onboarding, generate a tax-ready document at year-end:

- Revenue summary by category
- Expense summary by deductible category
- Home office calculation (if configured)
- Depreciation schedule
- Quarterly estimated tax summary
- Formatted for the relevant tax form (Schedule C, BAS, etc.)

The accountant gets a clean PDF or CSV, not a raw data dump.

---

## The Agentic Onboarding Architecture

### Why Kounta's Assistant, Not the User's Agent

The onboarding is delivered by Kounta's built-in assistant because:

1. **It knows the product.** The Kounta assistant understands the chart of accounts, the template system, the bank feed setup flow, and the classification engine. A user's Claude Code session doesn't.

2. **It has product context.** It knows what step the user is on, what they've connected, what's missing. It can guide them through a multi-step process that spans days.

3. **It persists across sessions.** The onboarding isn't a one-time wizard — it's an ongoing relationship. The assistant checks in: "You connected your bank last week but haven't classified the 16 unknown transactions yet. Want to do that now? It'll take about 2 minutes."

4. **It's zero-setup.** The user doesn't need to configure an MCP server or install Claude Code to get started. They sign in and the assistant is there.

### The User's AI Agent (MCP) Comes Later

The MCP server and external AI agents serve a different purpose: **building integrations.** Once the founder's books are set up and data is flowing, they use Claude Code or Cursor to:

- Build a Stripe webhook handler that posts transactions to Kounta
- Create a custom dashboard in their own app using the SDK
- Automate invoice generation when a customer subscribes
- Build a financial reporting page in their admin panel

This is the builder-tier value proposition: Kounta is infrastructure that AI coding assistants can program against. But the onboarding and daily accounting happen through Kounta's own assistant.

---

## Onboarding Completion Checklist

The assistant tracks progress and shows a completion indicator (not a wizard — a persistent, gentle progress bar):

```
Getting started with Kounta              4/6 complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 67%

✓ Business profile configured
✓ Chart of accounts created  
✓ Bank account connected
✓ First transactions classified
○ Connect Stripe (recommended)
○ Set up tax profile
```

Each incomplete item is actionable: clicking it opens the assistant with that specific task queued.

The checklist disappears after all items are complete, or after 30 days, whichever comes first. It never reappears once dismissed.

---

## What This Means for the Build

To implement this onboarding experience, the following features are needed:

### Already built:
- OAuth sign-in (GitHub, Google)
- Template system with chart of accounts
- Bank feeds via Basiq
- Auto-reconciliation engine
- AI assistant with tool access
- Intelligence layer with notifications
- Transaction posting via API

### Needs building:
1. **Onboarding flow UI** — the conversational setup screen that replaces the template picker
2. **Classification rules engine** — the three-layer system that learns from user actions
3. **Onboarding progress tracker** — persistent checklist with completion state stored per user
4. **Personal transaction exclusion** — "personal — exclude" option on bank transactions, hidden from statements
5. **Stripe connector** — OAuth + webhook handler for granular revenue tracking
6. **Recurring journal entries** — template-based auto-posting on a schedule
7. **Tax profile and export** — business structure selection, jurisdiction-specific tax pack generation

### Priority order for maximum impact:
1. Classification rules engine (makes bank feeds 10x more useful)
2. Onboarding flow UI (first impression, conversion driver)
3. Personal transaction exclusion (essential for mixed-account founders)
4. Stripe connector (the single most requested integration for SaaS founders)
5. Recurring entries (reduces monthly manual work)
6. Onboarding progress tracker (retention mechanic)
7. Tax profile and export (quarterly/annual value)

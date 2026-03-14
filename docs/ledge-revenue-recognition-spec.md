# KOUNTA — Revenue Recognition Specification

**Development Specification** | March 2026 | Confidential

---

# Why This Matters

Revenue recognition is the single biggest accounting complexity for SaaS founders. When a customer pays $1,200 for an annual subscription, that's not $1,200 of revenue on day one. Under accrual accounting (which every serious SaaS company uses), it's $100/month of recognised revenue spread over 12 months. The remaining $1,100 sits as **deferred revenue** — a liability on the balance sheet — and moves to revenue month by month.

Get this wrong and your financials are meaningless. Your P&L shows a revenue spike in January (when annual renewals hit) and a trough in February. Your burn rate looks wildly different month to month. Investors see through this immediately.

Today, Kounta's Stripe connector posts `charge.succeeded` as a single revenue entry on the charge date. This is cash-basis revenue — correct for cash accounting, but wrong for accrual. A SaaS founder on accrual basis (which the onboarding defaults to) gets misleading financials from day one.

Puzzle handles this automatically. Kounta needs to as well.

---

# How Revenue Recognition Works for SaaS

## The Core Concept

When money comes in, ask: "Have I earned this yet?"

- **Monthly subscription, $50/month:** Customer pays $50 on March 1. You deliver the service throughout March. Revenue is earned in March. Recognise $50 in March. Simple.

- **Annual subscription, $600/year:** Customer pays $600 on March 1. You deliver the service over 12 months. Revenue is earned $50/month. On March 1: record $600 as deferred revenue (liability). Each month: move $50 from deferred revenue to recognised revenue.

- **Quarterly subscription, $150/quarter:** Same concept. $150 deferred on payment. $50/month recognised over 3 months.

## The Journal Entries

### On payment (annual, $600):
```
From: Deferred Revenue (liability)     $600
To:   Cash / Stripe Balance (asset)    $600
```

### Each month (recognition):
```
From: Subscription Revenue (revenue)   $50
To:   Deferred Revenue (liability)     $50
```

After 12 months, the deferred revenue balance for this subscription is $0 and total recognised revenue is $600.

### On refund (partial, 6 months remaining):
```
From: Cash / Stripe Balance            $300
To:   Deferred Revenue                 $300
```
The $300 of unearned revenue is reversed. No impact on already-recognised revenue.

### On upgrade (mid-cycle):
Customer upgrades from $600/year to $1,200/year at month 6. $300 of the original subscription is still deferred. Stripe charges the prorated difference.
- Cancel remaining deferred revenue from old plan
- Create new deferred revenue for the upgraded plan
- Recognise at the new rate going forward

---

# What Kounta Needs to Build

## 1. Revenue Schedules

A revenue schedule is a plan for how a single payment gets recognised over time. Each Stripe charge (or manually created revenue entry) can have an associated schedule.

### Data Model

```sql
CREATE TABLE IF NOT EXISTS revenue_schedules (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  -- Source reference
  source_type TEXT NOT NULL DEFAULT 'stripe'
    CHECK (source_type IN ('stripe', 'manual', 'import')),
  source_ref TEXT,                    -- stripe:charge:ch_xxx or manual entry ID
  stripe_subscription_id TEXT,        -- Stripe subscription ID if applicable
  stripe_customer_id TEXT,
  customer_name TEXT,
  -- Schedule parameters
  total_amount BIGINT NOT NULL,       -- total payment in cents
  currency TEXT NOT NULL DEFAULT 'USD',
  recognition_start DATE NOT NULL,    -- first day of recognition
  recognition_end DATE NOT NULL,      -- last day of recognition
  frequency TEXT NOT NULL DEFAULT 'monthly'
    CHECK (frequency IN ('daily', 'monthly')),
  -- Status
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled', 'paused')),
  amount_recognised BIGINT NOT NULL DEFAULT 0,
  amount_remaining BIGINT NOT NULL DEFAULT 0,
  -- Accounts
  deferred_revenue_account_id TEXT NOT NULL REFERENCES accounts(id),
  revenue_account_id TEXT NOT NULL REFERENCES accounts(id),
  -- Metadata
  description TEXT,
  metadata TEXT,                      -- JSON: plan name, billing interval, etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rev_sched_ledger 
  ON revenue_schedules(ledger_id, status);
CREATE INDEX IF NOT EXISTS idx_rev_sched_stripe_sub 
  ON revenue_schedules(stripe_subscription_id);

-- Individual recognition entries (one per period)
CREATE TABLE IF NOT EXISTS revenue_schedule_entries (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES revenue_schedules(id) ON DELETE CASCADE,
  ledger_id TEXT NOT NULL REFERENCES ledgers(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  amount BIGINT NOT NULL,             -- amount to recognise in this period
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'posted', 'skipped')),
  transaction_id TEXT REFERENCES transactions(id),  -- the posted recognition entry
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rev_entry_schedule 
  ON revenue_schedule_entries(schedule_id);
CREATE INDEX IF NOT EXISTS idx_rev_entry_period 
  ON revenue_schedule_entries(ledger_id, period_start, status);
```

### How Schedules Are Created

**From Stripe (automatic):**
When the Stripe connector processes a `charge.succeeded` event and the charge is associated with a subscription:

1. Look up the subscription's billing interval (monthly, quarterly, annual)
2. If monthly → no schedule needed, recognise immediately (service period = billing period)
3. If quarterly or annual → create a revenue schedule:
   - `total_amount` = charge amount (gross, before fees)
   - `recognition_start` = subscription current period start
   - `recognition_end` = subscription current period end
   - Generate `revenue_schedule_entries` for each month in the range
   - Each entry gets `amount = total_amount / number_of_months` (with rounding adjustment on the last entry)

4. Post the initial journal entry:
   - Debit: Cash/Stripe Balance
   - Credit: Deferred Revenue (instead of Revenue)

5. The monthly recognition entries are posted by the scheduler.

**From manual entry:**
A user (or the assistant) can create a revenue schedule manually:
"I received $6,000 for a 12-month contract starting March 1."
The assistant creates the schedule and the initial deferred revenue entry.

### How Recognition Happens

The recurring entry scheduler (already built) runs daily. Add a revenue recognition check:

1. Find all `revenue_schedule_entries` where `period_end <= today` and `status = 'pending'`
2. For each, post a transaction:
   - Debit: Deferred Revenue account
   - Credit: Revenue account
   - Description: "Revenue recognition: [customer] [period]"
   - Amount: entry amount
3. Update entry: `status = 'posted'`, `transaction_id = new txn ID`
4. Update schedule: `amount_recognised += entry amount`, `amount_remaining -= entry amount`
5. If `amount_remaining = 0`, set schedule `status = 'completed'`

## 2. Account Auto-Creation

When revenue recognition is enabled, ensure these accounts exist:

| Code | Name | Type |
|------|------|------|
| 2500 | Deferred Revenue | Liability |
| 4000 | Subscription Revenue | Revenue (if not already present) |
| 4010 | Service Revenue | Revenue |

Create during onboarding if `payment_processor = stripe`, or when the first revenue schedule is created.

## 3. Stripe Connector Changes

### Modified Webhook Handler

Currently `handleChargeSucceeded` posts:
```
Debit: Stripe Balance
Credit: Revenue
```

Change to:
1. Check if the charge is associated with a Stripe subscription
2. If yes, check the subscription's billing interval:
   - Monthly → post as current (Debit Stripe Balance, Credit Revenue) — no schedule
   - Quarterly/Annual → create revenue schedule, post as deferred (Debit Stripe Balance, Credit Deferred Revenue)
3. If no subscription (one-time charge) → post as current revenue (no schedule)

### Subscription Metadata

The `charge.succeeded` event includes `invoice.subscription` which links to the subscription. Use the Stripe API to fetch:
- `subscription.items.data[0].price.recurring.interval` (month/year)
- `subscription.current_period_start` and `current_period_end`
- `subscription.customer` (for customer name)

Cache subscription data in `stripe_events.metadata` to avoid repeated API calls.

### Handle Subscription Changes

**Upgrade/downgrade (`customer.subscription.updated`):**
1. Find the active revenue schedule for this subscription
2. Calculate remaining unrecognised amount
3. Cancel the old schedule (set remaining entries to 'skipped')
4. Create a new schedule for the upgraded subscription
5. Post an adjustment entry if needed

**Cancellation with refund (`charge.refunded`):**
1. Find the active revenue schedule
2. Calculate how much was already recognised vs refunded
3. If refund <= remaining deferred: reduce deferred revenue
4. If refund > remaining deferred: reverse some recognised revenue
5. Cancel remaining schedule entries

**Trial periods:**
No revenue to recognise during trial. The schedule starts when the first paid period begins.

## 4. Revenue Dashboard

### Metrics (on Overview or dedicated Revenue page)

- **MRR (Monthly Recurring Revenue):** Sum of all active monthly subscription amounts, normalised to monthly. An annual $1,200 subscription contributes $100/month to MRR.
- **ARR:** MRR × 12
- **Deferred Revenue Balance:** Total unrecognised revenue across all active schedules
- **Revenue This Month:** Recognised revenue for the current month (from schedule entries + one-time charges)
- **Revenue Growth:** Month-over-month percentage change

### Revenue Explorer

A dedicated section or page showing:
- Revenue by customer (top 10)
- Revenue by plan/product
- Recognised vs deferred revenue over time (stacked area chart)
- MRR trend (line chart, last 12 months)
- Cohort-based revenue (when customers signed up vs how much they're paying now)

### Revenue Schedule Detail

For each schedule, show:
- Customer name, plan, total amount
- Recognition timeline (visual bar showing recognised vs remaining)
- Individual entries with status (posted ✓, pending ○, skipped ×)
- Link to each posted transaction

## 5. Reporting Changes

### Income Statement
- Split revenue into: Subscription Revenue (recognised), Service Revenue, Other Revenue
- Show deferred revenue movement in notes

### Balance Sheet
- Deferred Revenue appears under Current Liabilities
- Show the total deferred revenue balance

### Cash Flow Statement
- Cash from subscriptions appears in operating activities
- The deferred/recognised split is handled automatically since the cash flow already tracks actual cash movement

## 6. Intelligence Layer

New notification types:
- **Monthly recognition summary:** "March revenue recognition: $4,200 recognised from 12 schedules. $18,600 still deferred."
- **Schedule completion:** "Annual subscription from Acme Corp fully recognised. Total: $12,000."
- **Large deferred balance alert:** "Deferred revenue is $45,000. This represents 4.2 months of pre-paid revenue."

## 7. MCP Tools

New tools:
- `list_revenue_schedules` — list all schedules with status filter
- `get_revenue_schedule` — detail view of a single schedule with entries
- `create_revenue_schedule` — manually create a schedule
- `get_mrr` — current MRR calculation
- `get_deferred_revenue` — current deferred revenue balance

## 8. API Endpoints

```
GET    /v1/revenue/schedules — list schedules (filterable by status, customer)
GET    /v1/revenue/schedules/:id — get schedule with entries
POST   /v1/revenue/schedules — create a manual schedule
PUT    /v1/revenue/schedules/:id — update schedule (pause, cancel)
POST   /v1/revenue/process — manually trigger recognition processing
GET    /v1/revenue/metrics — MRR, ARR, deferred balance, recognised this month
GET    /v1/revenue/mrr-history — MRR over time (last 12 months)
```

## 9. SDK Module

Add `RevenueModule`:
- `listSchedules(ledgerId, opts?)`
- `getSchedule(ledgerId, scheduleId)`
- `createSchedule(ledgerId, input)`
- `updateSchedule(ledgerId, scheduleId, input)`
- `processRecognition(ledgerId)`
- `getMetrics(ledgerId)`
- `getMrrHistory(ledgerId)`

---

# What Changes to Existing Code

| Component | Change |
|-----------|--------|
| Stripe webhook handler | Check billing interval, create schedule for non-monthly, post to deferred instead of revenue |
| Recurring entry scheduler | Add revenue recognition processing alongside recurring entries |
| Account templates (SaaS) | Add 2500 Deferred Revenue account |
| Onboarding | If payment_processor = stripe, add deferred revenue account |
| Overview page | Add MRR stat card when Stripe connected |
| Statements (P&L) | Revenue breakdown by type |
| Statements (Balance Sheet) | Deferred revenue under current liabilities |
| Intelligence layer | New notification types for recognition events |
| Settings | Revenue recognition settings (default recognition method) |

---

# Build Sequence

| Session | Scope | Est. |
|---------|-------|------|
| 1 | Data model (migration), core engine (schedule CRUD, entry generation, recognition processing), accounts auto-creation | 2 sessions |
| 2 | Stripe connector changes (billing interval detection, deferred posting, subscription metadata) | 1-2 sessions |
| 3 | API endpoints, SDK module, MCP tools | 1 session |
| 4 | Dashboard (revenue page, schedule detail, MRR metrics, overview integration) | 1-2 sessions |
| 5 | Intelligence layer notifications, reporting changes | 1 session |
| **Total** | | **6-8 sessions** |

---

# Definition of Done

Revenue recognition is complete when:

- An annual Stripe subscription charge automatically creates a 12-month revenue schedule with deferred revenue
- Monthly recognition entries post automatically on the 1st of each month
- The P&L shows recognised revenue (not cash received) for the period
- The balance sheet shows the deferred revenue balance as a current liability
- MRR is calculated correctly from active subscriptions (monthly normalised)
- The dashboard shows MRR, ARR, and deferred revenue metrics
- Manual revenue schedules can be created via the assistant or API
- Subscription upgrades/downgrades adjust the schedule correctly
- Refunds reverse the appropriate amount of deferred and/or recognised revenue
- All existing tests pass unchanged
- Revenue recognition tools are available via API, SDK, and MCP

---

# Key Accounting Standards Reference

For US SaaS companies, revenue recognition follows **ASC 606** (Revenue from Contracts with Customers). The five-step model:

1. Identify the contract (subscription agreement)
2. Identify performance obligations (deliver the software service)
3. Determine the transaction price (subscription amount)
4. Allocate the price to obligations (typically 1:1 for simple SaaS)
5. Recognise revenue when obligations are satisfied (over time, ratably)

For a simple SaaS subscription with one product and no usage-based components, this simplifies to: spread the payment evenly over the service period. That's what this implementation does.

Kounta does NOT need to handle complex multi-element arrangements, variable consideration, or contract modifications beyond simple upgrades/downgrades. Those are enterprise accounting concerns that our target user (solo SaaS founder) won't encounter.

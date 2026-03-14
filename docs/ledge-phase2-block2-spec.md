# KOUNTA — Phase 2 Block 2: Make It Useful

**Development Specification** | March 2026 | Confidential

*Companion to Phase 2 Block 1 Specification*

---

# Overview

Block 1 made the product real — a builder can sign up, pick a template, get API keys, see live statements, and upgrade to Builder. Block 2 makes the product useful enough that builders stay and pay. These three features are the conversion lever from Free to Builder ($19/month).

The build order is fixed by dependency:

1. **Bank feeds** — automatic transaction import from real bank accounts. Without this, builders upload CSVs manually. This is the single biggest friction point.
2. **Intelligence layer** — the notification system that tells builders what their finances mean in plain language. Without this, the dashboard is a data viewer. This is what makes the builder open Kounta every day.
3. **Multi-currency** — support for transactions and reporting in multiple currencies. Without this, any builder with international customers can't use Kounta properly. This unlocks the global market.

## What Changes for Each Tier

| Feature | Free | Builder ($19) |
|---------|------|---------------|
| Bank feeds | Not available | Basiq (AU/NZ), Plaid (US/UK/EU) ready |
| Auto-reconciliation | Not available | Automatic matching on bank feed import |
| Intelligence layer | Not available | Health feed, cash alerts, decision prompts |
| Multi-currency | Single currency only | Multi-currency with exchange rates |

These features are the reason someone upgrades. Free tier users see them in the UI but can't use them — the upgrade prompt appears when they try.

---

# 1. Bank Feeds

## Architecture: Provider-Agnostic Abstraction

The bank feed system is built around a provider abstraction so multiple aggregators can be supported without changing the core logic. The interface:

```typescript
interface BankFeedProvider {
  // Initiate a connection flow — returns a URL or widget token
  createConnectionSession(params: {
    userId: string;
    institutionId?: string;
    redirectUrl: string;
  }): Promise<{ sessionUrl: string; connectionId: string }>;

  // List connected accounts for a user
  listConnections(userId: string): Promise<BankConnection[]>;

  // Fetch transactions for a connected account
  fetchTransactions(params: {
    connectionId: string;
    accountId: string;
    fromDate: string; // ISO date
    toDate: string;   // ISO date
  }): Promise<BankTransaction[]>;

  // Disconnect an account
  disconnect(connectionId: string): Promise<void>;

  // Handle webhook from the provider
  handleWebhook(payload: unknown, signature: string): Promise<WebhookResult>;
}

interface BankConnection {
  id: string;
  providerId: string; // 'basiq' | 'plaid'
  institutionName: string;
  accounts: BankAccount[];
  status: 'active' | 'stale' | 'disconnected';
  lastSyncedAt: string;
}

interface BankAccount {
  id: string;
  name: string;
  type: 'transaction' | 'savings' | 'credit' | 'loan';
  currency: string;
  currentBalance: number; // in smallest currency unit
  availableBalance: number;
}

interface BankTransaction {
  id: string; // provider's transaction ID
  date: string;
  amount: number; // in smallest currency unit, negative for debits
  description: string;
  category?: string;
  merchantName?: string;
  pending: boolean;
  raw: Record<string, unknown>; // full provider response
}
```

## Basiq Integration (Australia/NZ — First Provider)

### What Basiq Provides

Basiq is the dominant open banking aggregator in Australia and New Zealand. It connects to all major Australian banks (CBA, Westpac, ANZ, NAB) and most credit unions and neobanks via the Consumer Data Right (CDR) framework. It provides account data, transaction history, and real-time transaction notifications.

### Setup

1. Create a Basiq account at basiq.io
2. Get API key from the Basiq dashboard
3. Set `BASIQ_API_KEY` as an environment variable on Railway
4. Basiq uses server-to-server auth (API key), not OAuth — simpler than Plaid

### Connection Flow

1. Builder clicks "Connect bank account" in the Kounta dashboard
2. Kounta calls Basiq's API to create a consent session
3. Builder is redirected to Basiq's hosted consent UI (or embedded widget)
4. Builder selects their bank, authenticates with their bank credentials
5. Basiq establishes the connection and redirects back to Kounta
6. Kounta stores the connection ID and fetches initial transaction history
7. Subsequent syncs happen automatically via webhook or scheduled poll

### Basiq API Endpoints Used

```
POST /users                          → Create a Basiq user
POST /users/{id}/auth_links          → Create consent/auth link
GET  /users/{id}/accounts            → List connected accounts
GET  /users/{id}/transactions        → Fetch transactions (paginated)
DELETE /users/{id}/connections/{id}   → Disconnect
```

### Basiq Adapter Implementation

Create `packages/core/src/bank-feeds/basiq.ts` implementing the `BankFeedProvider` interface:

- `createConnectionSession()` → creates a Basiq user (if needed) + auth link
- `listConnections()` → GET /users/{id}/accounts, maps to BankConnection[]
- `fetchTransactions()` → GET /users/{id}/transactions with date filters, maps to BankTransaction[]
- `disconnect()` → DELETE connection
- `handleWebhook()` → process Basiq webhook events (transaction.created, connection.updated)

### Plaid Adapter (Future — Interface Ready)

Create `packages/core/src/bank-feeds/plaid.ts` as a stub that implements the same interface. The Plaid integration uses:

- Plaid Link (frontend widget) for connection
- `/transactions/sync` for incremental transaction fetching
- Webhooks for real-time updates

The stub should throw `NOT_IMPLEMENTED` errors so the interface is validated at compile time but doesn't require Plaid credentials.

## Data Model

### New Tables

```sql
-- Bank feed connections
CREATE TABLE bank_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  user_id UUID NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK (provider IN ('basiq', 'plaid')),
  provider_user_id TEXT,          -- Basiq user ID or Plaid item ID
  provider_connection_id TEXT,     -- provider's connection identifier
  institution_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'stale', 'disconnected', 'error')),
  last_synced_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bank accounts linked via a connection
CREATE TABLE bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  provider_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('transaction', 'savings', 'credit', 'loan')),
  currency TEXT NOT NULL DEFAULT 'AUD',
  current_balance BIGINT,
  available_balance BIGINT,
  -- Link to the Kounta account this bank account maps to
  mapped_account_id UUID REFERENCES accounts(id),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, provider_account_id)
);

-- Raw bank transactions before reconciliation
CREATE TABLE bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  provider_transaction_id TEXT NOT NULL,
  date DATE NOT NULL,
  amount BIGINT NOT NULL,    -- smallest currency unit, negative for debits
  description TEXT,
  category TEXT,
  merchant_name TEXT,
  is_pending BOOLEAN NOT NULL DEFAULT false,
  -- Reconciliation state
  match_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('matched', 'suggested', 'unmatched', 'ignored')),
  matched_transaction_id UUID REFERENCES transactions(id),
  match_confidence REAL,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bank_account_id, provider_transaction_id)
);

-- Sync log for tracking feed history
CREATE TABLE bank_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES bank_connections(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  transactions_fetched INTEGER DEFAULT 0,
  transactions_matched INTEGER DEFAULT 0,
  transactions_new INTEGER DEFAULT 0,
  error_message TEXT
);
```

### Migration

Write as `004_bank_feeds.sql` (PostgreSQL) and `004_bank_feeds.sqlite.sql` (SQLite). Apply at boot alongside existing migrations.

## Auto-Reconciliation

When bank transactions arrive (via sync or webhook), the reconciliation engine runs automatically:

1. **Deduplication** — skip any bank transaction whose `provider_transaction_id` already exists for this bank account
2. **Matching** — run the existing matching engine (from Phase 1 import system) against the bank transaction. Score against existing Kounta transactions using date proximity, amount match, and description similarity
3. **Auto-match** — confidence >= 95% → set `match_status = 'matched'`, link to the Kounta transaction
4. **Suggested match** — confidence 60-94% → set `match_status = 'suggested'`, store the suggested Kounta transaction ID and confidence score
5. **Unmatched** — confidence < 60% → set `match_status = 'unmatched'`. These appear in the dashboard for the builder to classify manually
6. **Auto-create** — for unmatched bank transactions that look like clear income or expenses (based on amount sign and category), optionally auto-create a Kounta transaction. This is a Builder-tier feature and can be toggled per connection.

The matching engine already exists in `packages/core/src/import/matcher.ts`. Extend it to work with `BankTransaction` objects in addition to `ParsedRow` objects.

## API Endpoints

```
POST   /v1/bank-feeds/connect         → Start a bank connection flow (returns redirect URL)
GET    /v1/bank-feeds/connections      → List all connections for the user's ledger
GET    /v1/bank-feeds/connections/:id  → Get connection details with accounts
DELETE /v1/bank-feeds/connections/:id  → Disconnect a bank account
POST   /v1/bank-feeds/sync/:id        → Trigger a manual sync for a connection
GET    /v1/bank-feeds/transactions     → List bank transactions (filterable by status, account, date)
POST   /v1/bank-feeds/transactions/:id/match    → Confirm a suggested match
POST   /v1/bank-feeds/transactions/:id/ignore   → Mark a bank transaction as ignored
POST   /v1/bank-feeds/transactions/:id/create   → Create a Kounta transaction from a bank transaction
POST   /v1/bank-feeds/webhook/basiq   → Basiq webhook handler (public, signature verified)
POST   /v1/bank-feeds/webhook/plaid   → Plaid webhook handler (future, public)
```

All endpoints except webhooks require API key auth. All endpoints except webhooks are Builder-tier only — free tier users get a 403 with an upgrade prompt.

## Dashboard: Bank Feeds Screen

New screen at `/bank-feeds` in the dashboard sidebar:

### Connected Accounts View
- List of connected bank accounts with institution name, account name, type, balance, last synced time, and status indicator (green dot for active, amber for stale, red for error)
- "Connect new account" button (opens Basiq consent flow)
- "Sync now" button per connection
- "Disconnect" button per connection with confirmation

### Transaction Feed View
- Tabs: All | Matched | Suggested | Unmatched
- Each row shows: date, description, amount, bank account name, match status badge, confidence score (for suggested), and action buttons
- Suggested matches show the proposed Kounta transaction alongside the bank transaction with a "Confirm" or "Reject" button
- Unmatched transactions show a "Create transaction" button that opens a form pre-filled with the bank transaction data, asking only for the target account (expense category)
- Bulk actions: "Confirm all suggested" (above 90% confidence), "Ignore all below $X"

### Account Mapping
- Each bank account can be mapped to a Kounta account (e.g. bank account "Everyday Account" maps to Kounta account "1000 Cash")
- This mapping determines which Kounta account is debited/credited when auto-creating transactions from bank data

## MCP Tools

Add to the existing MCP server:

```
connect_bank        → Start bank connection flow, return URL
list_bank_accounts  → List connected accounts with balances
sync_bank_feed      → Trigger sync, return new/matched/unmatched counts
list_bank_transactions → List bank transactions by status
match_bank_transaction → Confirm or reject a suggested match
```

## Plan Enforcement

Bank feeds are Builder-tier only. When a free tier user calls any bank feed endpoint:
- Return 403 with `{ error: { code: "PLAN_REQUIRED", message: "Bank feeds require the Builder plan", upgrade_url: "https://kounta.ai/billing" } }`
- The dashboard shows the bank feeds screen but with an overlay: "Connect your bank account automatically. Upgrade to Builder to unlock bank feeds." with an upgrade button.

---

# 2. Intelligence Layer

## What It Is

The intelligence layer is a notification and insight system that tells builders what their finances mean in plain language. Instead of the builder having to read financial statements and interpret numbers, Kounta proactively surfaces insights, alerts, and decision prompts.

The builder should spend 2 minutes in Kounta, not 30. They open the dashboard and see: "You made $14,200 more than you spent this month. Your biggest expense was hosting at $3,200. Two invoices totalling $8,500 are overdue."

## Notification Types

### Health Feed
Periodic summaries of financial health, generated automatically:

- **Monthly summary** — "March: Revenue $31,750, Expenses $27,350, Net income $4,400. Revenue up 12% vs February."
- **Weekly cash position** — "Cash balance: $42,300. At current burn rate, you have 5.8 months of runway."
- **Quarterly trends** — "Q1 2026: Revenue grew 34% quarter-over-quarter. Your largest cost category shifted from payroll to hosting."

### Cash Alerts
Triggered by specific thresholds:

- **Low cash** — "Your cash balance dropped below $10,000. Current burn rate: $8,200/month."
- **Large transaction** — "A transaction of $15,000 was posted today — that's 3x your average transaction."
- **Unusual pattern** — "Hosting costs increased 45% this month compared to the 3-month average."

### Decision Prompts
Questions that require the builder's input, surfaced proactively:

- **Unclassified transaction** — "There's a $2,400 payment from Tuesday that looks like a Webflow annual subscription. Can you confirm? [Yes, it's Webflow] [No, classify differently]"
- **Missing invoice** — "You received a $5,000 payment from Acme Corp but there's no matching invoice. Create one? [Create invoice] [It's already tracked]"
- **Reconciliation gap** — "Your bank balance is $1,200 higher than your ledger cash balance. This usually means there are transactions in your bank that haven't been recorded yet."

### Compliance Nudges
Time-based reminders:

- **BAS due** — "Your BAS is due in 12 days. Books are up to date." (Australia)
- **Period close** — "March is over. Close the period to lock in your monthly figures?"
- **Tax deadline** — "Estimated tax payment due in 15 days. Based on your YTD income, the estimated amount is $4,200."

## Data Model

```sql
-- Notifications / insights
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN (
    'monthly_summary', 'weekly_cash', 'quarterly_trends',
    'low_cash', 'large_transaction', 'unusual_pattern',
    'unclassified_transaction', 'missing_invoice', 'reconciliation_gap',
    'bas_due', 'period_close', 'tax_deadline',
    'plan_limit_warning', 'plan_limit_reached'
  )),
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'urgent', 'action_required')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,          -- plain language, may include markdown
  data JSONB,                  -- structured data for the notification (amounts, dates, entity refs)
  action_type TEXT,            -- 'confirm', 'classify', 'create', 'upgrade', 'link'
  action_data JSONB,           -- data needed to execute the action
  status TEXT NOT NULL DEFAULT 'unread'
    CHECK (status IN ('unread', 'read', 'actioned', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  actioned_at TIMESTAMPTZ
);

CREATE INDEX idx_notifications_ledger_status ON notifications(ledger_id, status);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, status) WHERE status = 'unread';

-- Notification preferences per user
CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  channel TEXT NOT NULL DEFAULT 'dashboard'
    CHECK (channel IN ('dashboard', 'email', 'both')),
  threshold JSONB,             -- e.g. { "low_cash_threshold": 1000000 } (in cents)
  UNIQUE (user_id, type)
);
```

### Migration

Write as `005_intelligence.sql` and `005_intelligence.sqlite.sql`.

## Insight Generation Engine

Create `packages/core/src/intelligence/` with:

### `analyzer.ts` — Financial Analysis Functions

Pure functions that analyze ledger data and return structured insights:

```typescript
interface Insight {
  type: NotificationType;
  severity: 'info' | 'warning' | 'urgent' | 'action_required';
  title: string;
  body: string;
  data: Record<string, unknown>;
  actionType?: string;
  actionData?: Record<string, unknown>;
}

// Monthly summary
analyzeMonthlySummary(ledgerId: string, month: string): Promise<Insight>

// Cash position
analyzeCashPosition(ledgerId: string): Promise<Insight>

// Anomaly detection — compare current period to rolling average
detectAnomalies(ledgerId: string, period: string): Promise<Insight[]>

// Unclassified transactions
findUnclassifiedTransactions(ledgerId: string): Promise<Insight[]>

// Reconciliation gaps
findReconciliationGaps(ledgerId: string): Promise<Insight[]>
```

### `scheduler.ts` — When to Generate Insights

- **Monthly summary** — generated on the 1st of each month for the previous month
- **Weekly cash position** — generated every Monday
- **Anomaly detection** — runs after every bank feed sync (if connected) or daily
- **Unclassified transactions** — runs after every import or bank feed sync
- **Compliance nudges** — scheduled based on jurisdiction (BAS quarterly for AU, estimated tax quarterly for US)

For Phase 2, use a simple cron-like approach: a scheduled function that runs every hour, checks what's due, and generates notifications. No external job queue needed — the API process handles it.

### `renderer.ts` — Plain Language Templates

Each insight type has a template that converts structured data into plain language:

```typescript
function renderMonthlySummary(data: MonthlySummaryData): { title: string; body: string } {
  const trend = data.revenueChange > 0 ? 'up' : 'down';
  return {
    title: `${data.monthName}: ${data.netIncome >= 0 ? 'Profit' : 'Loss'} of ${formatCurrency(Math.abs(data.netIncome))}`,
    body: `Revenue ${formatCurrency(data.revenue)}, expenses ${formatCurrency(data.expenses)}. ` +
          `Revenue ${trend} ${Math.abs(data.revenueChange)}% vs ${data.previousMonthName}. ` +
          `Your biggest expense was ${data.topExpenseCategory} at ${formatCurrency(data.topExpenseAmount)}.`
  };
}
```

## API Endpoints

```
GET    /v1/notifications              → List notifications (filterable by status, type, severity)
GET    /v1/notifications/unread-count → Count of unread notifications
PATCH  /v1/notifications/:id          → Mark as read, actioned, or dismissed
POST   /v1/notifications/:id/action   → Execute the action (confirm classification, create invoice, etc.)
GET    /v1/notifications/preferences  → Get notification preferences
PUT    /v1/notifications/preferences  → Update notification preferences
```

## Dashboard: Notification Center

### Notification Bell
- Add a bell icon to the top-right of the dashboard header
- Show unread count as a badge
- Clicking opens a dropdown with the 5 most recent unread notifications
- "View all" link goes to the full notification page

### Notifications Page (new: `/notifications`)
- Full list of notifications, most recent first
- Filter by: All | Unread | Action Required
- Each notification shows: icon (based on severity), title, body text, timestamp, and action buttons
- Action buttons vary by type: "Confirm" for classifications, "Create" for missing invoices, "Upgrade" for plan prompts
- Dismissible via X button

### Overview Page Enhancement
- Add a "Recent Insights" card to the overview page showing the 3 most recent unread notifications
- This is the first thing the builder sees when they open the dashboard

## MCP Tools

```
list_notifications    → List recent notifications with status filter
get_unread_count      → Quick count for agent awareness
action_notification   → Execute a notification action (confirm, create, dismiss)
```

## Plan Enforcement

The intelligence layer is Builder-tier only. Free tier users see a locked "Insights" section on the overview page with an upgrade prompt. Notifications are still generated for free users (so they see value immediately on upgrade) but only plan_limit_warning and plan_limit_reached notifications are actually displayed.

---

# 3. Multi-Currency

## What Changes

Currently, all amounts are stored as integers in a single currency (the ledger's base currency). Multi-currency adds:

- Transactions can be posted in any currency
- Each line item has an optional `currency` and `exchange_rate`
- Balances are computed in the ledger's base (functional) currency
- Statements can be generated in the functional currency or a specified reporting currency
- Exchange rates are fetched automatically and cached
- Unrealised gains/losses on foreign currency balances are tracked

## Data Model Changes

### Modify Existing Tables

```sql
-- Add currency fields to line_items
ALTER TABLE line_items ADD COLUMN currency TEXT;        -- ISO 4217, null = ledger currency
ALTER TABLE line_items ADD COLUMN original_amount BIGINT; -- amount in the transaction currency
ALTER TABLE line_items ADD COLUMN exchange_rate NUMERIC(20, 10); -- rate to convert to ledger currency

-- The existing 'amount' field remains the ledger-currency equivalent
-- If currency is null, original_amount = amount and exchange_rate = 1.0
```

### New Tables

```sql
-- Exchange rate cache
CREATE TABLE exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency TEXT NOT NULL,    -- ISO 4217
  target_currency TEXT NOT NULL,  -- ISO 4217
  rate NUMERIC(20, 10) NOT NULL,  -- 1 base = rate target
  source TEXT NOT NULL DEFAULT 'ecb', -- 'ecb', 'openexchangerates', 'manual'
  effective_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (base_currency, target_currency, effective_date, source)
);

-- Unrealised gains/losses tracking
CREATE TABLE fx_revaluation_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledgers(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  currency TEXT NOT NULL,
  original_balance BIGINT NOT NULL,       -- balance in foreign currency
  previous_rate NUMERIC(20, 10) NOT NULL,
  current_rate NUMERIC(20, 10) NOT NULL,
  gain_loss BIGINT NOT NULL,              -- in ledger currency
  revaluation_transaction_id UUID REFERENCES transactions(id),
  period_end DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Migration

Write as `006_multi_currency.sql` and `006_multi_currency.sqlite.sql`.

## Exchange Rate Provider

Create `packages/core/src/fx/` with:

### `rates.ts` — Rate Fetching and Caching

```typescript
interface ExchangeRateProvider {
  getRate(base: string, target: string, date: string): Promise<number>;
  getRates(base: string, targets: string[], date: string): Promise<Record<string, number>>;
}
```

Default provider: **European Central Bank (ECB)** — free, no API key, daily rates for 30+ currencies. Fallback: **Open Exchange Rates** (free tier: 1,000 requests/month).

Rates are cached in the `exchange_rates` table. A rate is fetched once per currency pair per day and reused for all transactions on that date.

### `revaluation.ts` — Period-End Revaluation

At period close (or on demand), recalculate the ledger-currency value of all foreign-currency balances at the current rate. The difference between the booked rate and the current rate is posted as an unrealised FX gain or loss:

```typescript
async function revalueForeignBalances(
  ledgerId: string,
  asOfDate: string
): Promise<RevaluationResult> {
  // 1. Find all accounts with foreign-currency balances
  // 2. For each, compute: balance_in_foreign * (new_rate - old_rate)
  // 3. Post a revaluation journal entry:
  //    - Debit/Credit the account by the gain/loss amount
  //    - Credit/Debit "Unrealised FX Gains/Losses" account
  // 4. Record in fx_revaluation_entries
}
```

## Transaction Posting Changes

The `postTransaction` method in the engine needs to accept optional currency fields per line item:

```typescript
interface PostLineInput {
  accountCode: string;
  amount: number;        // in ledger currency (as before)
  direction: 'debit' | 'credit';
  memo?: string;
  // New fields for multi-currency
  currency?: string;     // ISO 4217, omit for ledger currency
  originalAmount?: number; // amount in transaction currency
  exchangeRate?: number;  // if omitted, Kounta fetches the rate for the date
}
```

Balance enforcement still works on the `amount` field (ledger currency). The `originalAmount` and `exchangeRate` are informational/audit fields that track the original transaction currency.

If `currency` is provided but `exchangeRate` is omitted, the engine fetches the rate from the cache (or the ECB API if not cached) for the transaction date.

## Statement Changes

### Balance Sheet
- Foreign-currency account balances can be displayed in both functional and original currency
- Add a "Currency breakdown" section that shows balances by currency

### Income Statement
- Revenue and expenses in foreign currencies are converted at the transaction-date rate (already stored in `amount`)
- No special handling needed since `amount` is always in ledger currency

### Cash Flow
- Foreign currency cash accounts show the functional-currency equivalent
- FX revaluation gains/losses appear in the operating activities section

## API Changes

```
GET  /v1/fx/rates?base=USD&targets=AUD,EUR&date=2026-03-12  → Get exchange rates
POST /v1/fx/revalue                                          → Trigger period-end revaluation
```

The existing transaction posting endpoint accepts the new optional fields without breaking existing integrations — all new fields are optional and default to the ledger currency.

## Dashboard Changes

### Transaction Posting
- Add optional currency selector when posting a transaction
- If a foreign currency is selected, show the exchange rate and converted amount
- Auto-fetch the rate when the currency and date are set

### Account Balances
- Show both ledger-currency and original-currency balances for foreign-currency accounts
- Add a currency filter to the account tree

### Statements
- Add a "Reporting currency" selector to the statement page
- Default to the ledger's functional currency

## MCP Tool Changes

The existing `post_transaction` tool accepts optional `currency`, `originalAmount`, and `exchangeRate` per line item. No new tools needed — the existing tools handle multi-currency transparently.

## Plan Enforcement

Multi-currency is Pro-tier ($49/month). When a free or Builder user tries to post a transaction with a foreign currency:
- Return 403 with `{ error: { code: "PLAN_REQUIRED", message: "Multi-currency requires the Pro plan" } }`

---

# Testing

## Bank Feeds Tests

- Connection flow: create session, verify URL returned
- Transaction fetch: mock Basiq API responses, verify parsing and dedup
- Auto-reconciliation: feed bank transactions, verify matching against existing Kounta transactions
- Plan enforcement: free tier user gets 403 on bank feed endpoints
- Webhook handling: verify Basiq webhook signature validation and event processing

## Intelligence Layer Tests

- Monthly summary: post known transactions, generate summary, verify text and numbers
- Cash alerts: set cash balance below threshold, verify notification created
- Anomaly detection: post unusual transaction, verify anomaly flagged
- Notification lifecycle: create → read → action → verify status transitions
- Preference enforcement: disable a notification type, verify it's not generated

## Multi-Currency Tests

- Post a foreign-currency transaction with explicit rate, verify amount conversion
- Post a foreign-currency transaction without rate, verify rate is fetched and applied
- Balance calculation: verify balances in both functional and original currency
- Statement generation: verify P&L uses transaction-date rates
- Revaluation: verify unrealised gains/losses are calculated correctly
- Plan enforcement: free/Builder user gets 403 on multi-currency transactions
- Backwards compatibility: existing single-currency tests still pass unchanged

---

# Build Sequence

The three features can be built in focused sessions, each independent of the others:

## Bank Feeds (estimate: 5-7 sessions)

1. Provider interface + Basiq adapter + Plaid stub
2. Data model (migration 004) + engine methods for connection and sync
3. Auto-reconciliation integration with existing matcher
4. API endpoints (10 routes)
5. Dashboard bank feeds screen (connected accounts + transaction feed)
6. MCP tools (5 tools)
7. Plan enforcement + webhook handling

## Intelligence Layer (estimate: 4-6 sessions)

1. Data model (migration 005) + notification types
2. Analyzer functions (monthly summary, cash position, anomaly detection)
3. Renderer templates + scheduler
4. API endpoints (6 routes)
5. Dashboard notification center (bell, page, overview card)
6. MCP tools (3 tools)

## Multi-Currency (estimate: 3-5 sessions)

1. Data model changes (migration 006) + exchange rate provider
2. Engine changes (posting with currency, balance calculation)
3. Statement changes (currency breakdown, reporting currency)
4. Revaluation engine
5. Dashboard and API changes

---

# Definition of Done

Block 2 is complete when:

- A Builder-tier user can connect their Australian bank account via Basiq and see transactions flowing into Kounta automatically
- Bank transactions are automatically matched against existing Kounta transactions with confidence scores
- The dashboard shows a notification bell with unread count, and the overview page displays recent financial insights
- Monthly summaries, cash alerts, and anomaly detection generate plain-language notifications
- A Pro-tier user can post transactions in foreign currencies with automatic exchange rate lookup
- Period-end FX revaluation creates the correct unrealised gain/loss entries
- All existing tests continue to pass
- Plan enforcement is correct: bank feeds require Builder, multi-currency requires Pro
- Free tier users see locked versions of these features with upgrade prompts

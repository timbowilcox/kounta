# Ledge SDK Guide

Complete reference for the Ledge TypeScript SDK. Every module, method, and type documented.

---

## Installation

```bash
npm install @ledge/sdk
```

---

## Initialization

```typescript
import { Ledge } from "@ledge/sdk";

const ledge = new Ledge({
  apiKey: "ledge_live_...",
  adminSecret: "...",        // optional, needed for admin endpoints
  baseUrl: "https://api.useledge.ai", // optional, defaults to https://api.getledge.ai
});
```

### Config Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `apiKey` | `string` | Yes | Your Ledge API key (`ledge_live_...` or `ledge_test_...`) |
| `adminSecret` | `string` | No | Admin secret for provisioning and key management |
| `baseUrl` | `string` | No | API base URL (defaults to `https://api.getledge.ai`) |
| `fetch` | `typeof fetch` | No | Custom fetch implementation |

---

## Modules

### ledge.ledgers

Manage top-level ledger containers.

```typescript
// create(input): Promise<Ledger>  -- requires admin auth
const ledger = await ledge.ledgers.create({
  name: "Acme Corp",
  currency: "USD",
  fiscalYearStart: "01-01",
  accountingBasis: "accrual",
  ownerId: "user-uuid",
  businessContext: { industry: "saas" },
});

// get(ledgerId): Promise<Ledger>
const l = await ledge.ledgers.get("ledger-uuid");

// update(ledgerId, input): Promise<Ledger>
const updated = await ledge.ledgers.update("ledger-uuid", {
  name: "Acme Corp (renamed)",
  fiscalYearStart: "04-01",
});
```

---

### ledge.accounts

Create and query accounts in the chart of accounts tree.

```typescript
// create(ledgerId, input): Promise<Account>
const account = await ledge.accounts.create("ledger-uuid", {
  code: "1000",
  name: "Cash",
  type: "asset",
  normalBalance: "debit",
  parentCode: undefined,
  metadata: { bankName: "First National" },
});

// list(ledgerId): Promise<AccountWithBalance[]>
const accounts = await ledge.accounts.list("ledger-uuid");

// get(ledgerId, accountId): Promise<AccountWithBalance>
const cash = await ledge.accounts.get("ledger-uuid", "account-uuid");
```

---

### ledge.transactions

Post, list, retrieve, and reverse immutable journal entries.

```typescript
// post(ledgerId, input): Promise<TransactionWithLines>
const txn = await ledge.transactions.post("ledger-uuid", {
  date: "2026-03-14",
  memo: "Office supplies purchase",
  idempotencyKey: "inv-2026-0042",
  sourceType: "api",
  lines: [
    { accountCode: "5100", amount: 4500, direction: "debit" },
    { accountCode: "1000", amount: 4500, direction: "credit" },
  ],
  effectiveDate: undefined,
  sourceRef: "receipt-123",
  agentId: undefined,
  metadata: {},
});

// list(ledgerId, opts?): Promise<PaginatedResult<TransactionWithLines>>
const page = await ledge.transactions.list("ledger-uuid", {
  cursor: undefined,
  limit: 50,
});

// get(ledgerId, transactionId): Promise<TransactionWithLines>
const t = await ledge.transactions.get("ledger-uuid", "txn-uuid");

// reverse(ledgerId, transactionId, reason): Promise<TransactionWithLines>
const reversal = await ledge.transactions.reverse(
  "ledger-uuid",
  "txn-uuid",
  "Duplicate entry"
);
```

---

### ledge.reports

Generate financial statements.

```typescript
// incomeStatement(ledgerId, startDate, endDate): Promise<StatementResponse>
const pnl = await ledge.reports.incomeStatement(
  "ledger-uuid",
  "2026-01-01",
  "2026-03-31"
);

// balanceSheet(ledgerId, asOfDate): Promise<StatementResponse>
const bs = await ledge.reports.balanceSheet("ledger-uuid", "2026-03-31");

// cashFlow(ledgerId, startDate, endDate): Promise<StatementResponse>
const cf = await ledge.reports.cashFlow(
  "ledger-uuid",
  "2026-01-01",
  "2026-03-31"
);
```

---

### ledge.audit

Query the append-only audit log.

```typescript
// list(ledgerId, opts?): Promise<PaginatedResult<AuditEntry>>
const entries = await ledge.audit.list("ledger-uuid", {
  cursor: undefined,
  limit: 100,
});
```

---

### ledge.imports

Upload files (CSV/OFX), review matches, and confirm.

```typescript
// upload(ledgerId, input): Promise<ImportResult>
const result = await ledge.imports.upload("ledger-uuid", {
  fileContent: csvString,
  fileType: "csv",
  filename: "march-bank-statement.csv",
});

// list(ledgerId, opts?): Promise<PaginatedResult<ImportBatch>>
const batches = await ledge.imports.list("ledger-uuid", { limit: 20 });

// get(batchId): Promise<ImportResult>
const batch = await ledge.imports.get("batch-uuid");

// confirmMatches(batchId, actions): Promise<ImportResult>
const confirmed = await ledge.imports.confirmMatches("batch-uuid", [
  { rowId: "row-1", action: "accept" },
  { rowId: "row-2", action: "reject" },
]);
```

---

### ledge.templates

Browse and apply pre-built chart-of-accounts templates. List, get, and recommend require no authentication.

```typescript
// list(): Promise<Template[]>  -- no auth
const templates = await ledge.templates.list();

// get(idOrSlug): Promise<Template>  -- no auth
const tpl = await ledge.templates.get("saas-startup");

// recommend(context): Promise<TemplateRecommendation[]>  -- no auth
const recs = await ledge.templates.recommend({
  industry: "technology",
  description: "B2B SaaS with monthly subscriptions",
  businessModel: "subscription",
});

// apply(ledgerId, templateSlug): Promise<{accounts, count}>  -- admin auth
const applied = await ledge.templates.apply("ledger-uuid", "saas-startup");
console.log(applied.count); // number of accounts created
```

---

### ledge.apiKeys

Manage API keys scoped to a ledger. All methods require admin auth.

```typescript
// create(input): Promise<ApiKeyWithRaw>  -- admin
const key = await ledge.apiKeys.create({
  userId: "user-uuid",
  ledgerId: "ledger-uuid",
  name: "Production Key",
});
// key.raw is the full key, shown only once

// list(ledgerId): Promise<ApiKeySafe[]>  -- admin
const keys = await ledge.apiKeys.list("ledger-uuid");

// revoke(keyId): Promise<ApiKeySafe>  -- admin
const revoked = await ledge.apiKeys.revoke("key-uuid");
```

---

### ledge.admin

Provision new users and their ledgers. Requires admin auth.

```typescript
// provision(input): Promise<ProvisionResult>  -- admin
const result = await ledge.admin.provision({
  email: "founder@acme.com",
  name: "Jane Doe",
  authProvider: "google",
  authProviderId: "google-uid-123",
  templateSlug: "saas-startup",
});
```

---

### ledge.bankFeeds

Connect bank accounts, sync transactions, and confirm matches.

```typescript
// listConnections(ledgerId): Promise<BankConnection[]>
const connections = await ledge.bankFeeds.listConnections("ledger-uuid");

// getConnection(ledgerId, connectionId): Promise<BankConnection>
const conn = await ledge.bankFeeds.getConnection("ledger-uuid", "conn-uuid");

// listAccounts(ledgerId, connectionId): Promise<BankAccount[]>
const bankAccts = await ledge.bankFeeds.listAccounts("ledger-uuid", "conn-uuid");

// mapAccount(ledgerId, bankAccountId, accountId): Promise<BankAccount>
const mapped = await ledge.bankFeeds.mapAccount(
  "ledger-uuid",
  "bank-acct-uuid",
  "ledger-account-uuid"
);

// sync(ledgerId, bankAccountId, opts?): Promise<BankSyncLog>
const syncLog = await ledge.bankFeeds.sync("ledger-uuid", "bank-acct-uuid", {
  fromDate: "2026-03-01",
  toDate: "2026-03-14",
});

// listSyncLogs(ledgerId, connectionId): Promise<BankSyncLog[]>
const logs = await ledge.bankFeeds.listSyncLogs("ledger-uuid", "conn-uuid");

// listTransactions(ledgerId, bankAccountId, opts?): Promise<BankTransaction[]>
const bankTxns = await ledge.bankFeeds.listTransactions(
  "ledger-uuid",
  "bank-acct-uuid",
  { status: "unmatched", limit: 100 }
);

// confirmMatch(ledgerId, bankTransactionId, action, overrideTransactionId?): Promise<BankTransaction>
const matched = await ledge.bankFeeds.confirmMatch(
  "ledger-uuid",
  "bank-txn-uuid",
  "accept",
  "override-txn-uuid"
);
```

---

### ledge.notifications

View and manage system notifications and insights.

```typescript
// list(ledgerId, opts?): Promise<PaginatedResult<Notification>>
const notifs = await ledge.notifications.list("ledger-uuid", {
  status: "unread",
  type: "anomaly",
  limit: 20,
  cursor: undefined,
});

// get(ledgerId, notificationId): Promise<Notification>
const n = await ledge.notifications.get("ledger-uuid", "notif-uuid");

// updateStatus(ledgerId, notificationId, status): Promise<Notification>
const read = await ledge.notifications.updateStatus(
  "ledger-uuid",
  "notif-uuid",
  "read"
);

// generateInsights(ledgerId): Promise<{generated, notifications}>
const insights = await ledge.notifications.generateInsights("ledger-uuid");

// getPreferences(ledgerId): Promise<NotificationPreference[]>
const prefs = await ledge.notifications.getPreferences("ledger-uuid");

// setPreference(ledgerId, type, enabled): Promise<NotificationPreference>
const pref = await ledge.notifications.setPreference(
  "ledger-uuid",
  "anomaly",
  true
);
```

---

### ledge.currencies

Manage multi-currency settings, exchange rates, and conversions.

```typescript
// list(ledgerId): Promise<CurrencySetting[]>
const currencies = await ledge.currencies.list("ledger-uuid");

// enable(ledgerId, input): Promise<CurrencySetting>
const eur = await ledge.currencies.enable("ledger-uuid", {
  currencyCode: "EUR",
  decimalPlaces: 2,
  symbol: "E",
});

// listRates(ledgerId, opts?): Promise<PaginatedResult<ExchangeRate>>
const rates = await ledge.currencies.listRates("ledger-uuid", { limit: 50 });

// setRate(ledgerId, input): Promise<ExchangeRate>
const rate = await ledge.currencies.setRate("ledger-uuid", {
  fromCurrency: "USD",
  toCurrency: "EUR",
  rate: 920000,
  effectiveDate: "2026-03-14",
});

// convert(ledgerId, input): Promise<ConvertAmountResult>
const converted = await ledge.currencies.convert("ledger-uuid", {
  amount: 100000,
  fromCurrency: "USD",
  toCurrency: "EUR",
});

// revalue(ledgerId, date): Promise<RevaluationResult[]>
const revaluations = await ledge.currencies.revalue("ledger-uuid", "2026-03-14");
```

---

### ledge.conversations

Manage AI-assisted conversations scoped to a ledger.

```typescript
// list(ledgerId, opts?): Promise<PaginatedResult<Conversation>>
const convos = await ledge.conversations.list("ledger-uuid", { limit: 10 });

// create(ledgerId, title?): Promise<Conversation>
const convo = await ledge.conversations.create("ledger-uuid", "Q1 Review");

// get(ledgerId, conversationId): Promise<Conversation>
const c = await ledge.conversations.get("ledger-uuid", "convo-uuid");

// update(ledgerId, conversationId, messages, title?): Promise<Conversation>
const updated = await ledge.conversations.update(
  "ledger-uuid",
  "convo-uuid",
  [{ role: "user", content: "What were our top expenses last month?" }],
  "Expense Analysis"
);

// delete(ledgerId, conversationId): Promise<void>
await ledge.conversations.delete("ledger-uuid", "convo-uuid");
```

---

### ledge.classification

Manage classification rules, merchant aliases, and auto-categorize transactions.

```typescript
// listRules(ledgerId, opts?): Promise<ClassificationRule[]>
const rules = await ledge.classification.listRules("ledger-uuid");

// createRule(ledgerId, input): Promise<ClassificationRule>
const rule = await ledge.classification.createRule("ledger-uuid", {
  pattern: "AMZN*",
  accountCode: "5100",
  description: "Amazon purchases",
});

// getRule(ledgerId, ruleId): Promise<ClassificationRule>
const r = await ledge.classification.getRule("ledger-uuid", "rule-uuid");

// updateRule(ledgerId, ruleId, input): Promise<ClassificationRule>
const updatedRule = await ledge.classification.updateRule(
  "ledger-uuid",
  "rule-uuid",
  { accountCode: "5200" }
);

// deleteRule(ledgerId, ruleId): Promise<void>
await ledge.classification.deleteRule("ledger-uuid", "rule-uuid");

// classify(ledgerId, input): Promise<ClassificationResult | null>
const match = await ledge.classification.classify("ledger-uuid", {
  description: "AMZN Mktp US*1A2B3C",
  amount: 4599,
});

// classifyBankTransaction(ledgerId, bankTransactionId, accountId, isPersonal?): Promise<BankTransaction>
const classified = await ledge.classification.classifyBankTransaction(
  "ledger-uuid",
  "bank-txn-uuid",
  "account-uuid",
  false
);

// listAliases(ledgerId): Promise<MerchantAlias[]>
const aliases = await ledge.classification.listAliases("ledger-uuid");

// addAlias(ledgerId, canonicalName, alias): Promise<MerchantAlias>
const alias = await ledge.classification.addAlias(
  "ledger-uuid",
  "Amazon",
  "AMZN Mktp US"
);
```

---

### ledge.recurring

Schedule and manage recurring journal entries.

```typescript
// list(ledgerId): Promise<RecurringEntry[]>
const entries = await ledge.recurring.list("ledger-uuid");

// create(ledgerId, input): Promise<RecurringEntry>
const entry = await ledge.recurring.create("ledger-uuid", {
  memo: "Monthly rent",
  frequency: "monthly",
  startDate: "2026-04-01",
  lines: [
    { accountCode: "5000", amount: 250000, direction: "debit" },
    { accountCode: "2000", amount: 250000, direction: "credit" },
  ],
});

// get(ledgerId, id): Promise<RecurringEntry & {recentLogs}>
const re = await ledge.recurring.get("ledger-uuid", "entry-uuid");

// update(ledgerId, id, input): Promise<RecurringEntry>
const updatedEntry = await ledge.recurring.update("ledger-uuid", "entry-uuid", {
  memo: "Monthly rent (updated)",
});

// delete(ledgerId, id): Promise<void>
await ledge.recurring.delete("ledger-uuid", "entry-uuid");

// pause(ledgerId, id): Promise<RecurringEntry>
const paused = await ledge.recurring.pause("ledger-uuid", "entry-uuid");

// resume(ledgerId, id): Promise<RecurringEntry>
const resumed = await ledge.recurring.resume("ledger-uuid", "entry-uuid");
```

---

### ledge.periods

Close and reopen accounting periods.

```typescript
// close(ledgerId, periodEnd): Promise<{periodEnd, closedAt}>
const closed = await ledge.periods.close("ledger-uuid", "2026-03-31");

// reopen(ledgerId, periodEnd): Promise<{periodEnd, reopenedAt}>
const reopened = await ledge.periods.reopen("ledger-uuid", "2026-03-31");

// list(ledgerId): Promise<ClosedPeriod[]>
const periods = await ledge.periods.list("ledger-uuid");
```

---

### ledge.stripeConnect

Connect and sync with Stripe via OAuth.

```typescript
// authorize(): Promise<{url}>
const { url } = await ledge.stripeConnect.authorize();
// Redirect the user to url to complete OAuth

// status(): Promise<StripeConnectStatus | null>
const status = await ledge.stripeConnect.status();

// disconnect(): Promise<{disconnected}>
const { disconnected } = await ledge.stripeConnect.disconnect();

// sync(): Promise<{syncing, message}>
const { syncing, message } = await ledge.stripeConnect.sync();
```

---

## Error Handling

All SDK methods throw a `LedgeApiError` on non-2xx responses. The error includes structured details to help you diagnose and recover from failures.

```typescript
import { Ledge, LedgeApiError } from "@ledge/sdk";

const ledge = new Ledge({ apiKey: "ledge_live_..." });

try {
  await ledge.transactions.post("ledger-uuid", {
    date: "2026-03-14",
    memo: "Unbalanced entry",
    lines: [
      { accountCode: "1000", amount: 5000, direction: "debit" },
      { accountCode: "2000", amount: 4000, direction: "credit" },
    ],
  });
} catch (err) {
  if (err instanceof LedgeApiError) {
    console.error(err.status);      // HTTP status code, e.g. 422
    console.error(err.code);        // Machine-readable error code, e.g. "UNBALANCED_TRANSACTION"
    console.error(err.message);     // Human-readable message
    console.error(err.details);     // Field-level details array:
    // [{ field: "lines", expected: "debits === credits", actual: "5000 !== 4000" }]
    console.error(err.suggestion);  // e.g. "Add a credit line for 1000 or adjust existing lines"
  }
}
```

### LedgeApiError Properties

| Property | Type | Description |
|----------|------|-------------|
| `status` | `number` | HTTP status code |
| `code` | `string` | Machine-readable error code |
| `message` | `string` | Human-readable error description |
| `details` | `Array<{field, expected, actual}>` | Field-level validation errors |
| `suggestion` | `string \| undefined` | Suggested corrective action |

---

## Pagination

All list endpoints that return large collections use cursor-based pagination. The default limit is 50 and the maximum is 200.

```typescript
let cursor: string | undefined;

do {
  const page = await ledge.transactions.list("ledger-uuid", { cursor, limit: 100 });
  for (const txn of page.data) {
    console.log(txn.id, txn.memo);
  }
  cursor = page.nextCursor;
} while (cursor);
```

# Kounta SDK Guide

Complete reference for the Kounta TypeScript SDK. Every module, method, and type documented.

---

## Installation

```bash
npm install @kounta/sdk
```

---

## Initialization

```typescript
import { Kounta } from "@kounta/sdk";

const kounta = new Kounta({
  apiKey: "kounta_live_...",
  adminSecret: "...",        // optional, needed for admin endpoints
  baseUrl: "https://api.kounta.ai", // optional, defaults to https://api.kounta.ai
});
```

### Config Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `apiKey` | `string` | Yes | Your Kounta API key (`kounta_live_...` or `kounta_test_...`) |
| `adminSecret` | `string` | No | Admin secret for provisioning and key management |
| `baseUrl` | `string` | No | API base URL (defaults to `https://api.kounta.ai`) |
| `fetch` | `typeof fetch` | No | Custom fetch implementation |

---

## Modules

### kounta.ledgers

Manage top-level ledger containers.

```typescript
// create(input): Promise<Ledger>  -- requires admin auth
const ledger = await kounta.ledgers.create({
  name: "Acme Corp",
  currency: "USD",
  fiscalYearStart: "01-01",
  accountingBasis: "accrual",
  ownerId: "user-uuid",
  businessContext: { industry: "saas" },
});

// get(ledgerId): Promise<Ledger>
const l = await kounta.ledgers.get("ledger-uuid");

// update(ledgerId, input): Promise<Ledger>
const updated = await kounta.ledgers.update("ledger-uuid", {
  name: "Acme Corp (renamed)",
  fiscalYearStart: "04-01",
});
```

---

### kounta.accounts

Create and query accounts in the chart of accounts tree.

```typescript
// create(ledgerId, input): Promise<Account>
const account = await kounta.accounts.create("ledger-uuid", {
  code: "1000",
  name: "Cash",
  type: "asset",
  normalBalance: "debit",
  parentCode: undefined,
  metadata: { bankName: "First National" },
});

// list(ledgerId): Promise<AccountWithBalance[]>
const accounts = await kounta.accounts.list("ledger-uuid");

// get(ledgerId, accountId): Promise<AccountWithBalance>
const cash = await kounta.accounts.get("ledger-uuid", "account-uuid");
```

---

### kounta.transactions

Post, list, retrieve, and reverse immutable journal entries.

```typescript
// post(ledgerId, input): Promise<TransactionWithLines>
const txn = await kounta.transactions.post("ledger-uuid", {
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
const page = await kounta.transactions.list("ledger-uuid", {
  cursor: undefined,
  limit: 50,
});

// get(ledgerId, transactionId): Promise<TransactionWithLines>
const t = await kounta.transactions.get("ledger-uuid", "txn-uuid");

// reverse(ledgerId, transactionId, reason): Promise<TransactionWithLines>
const reversal = await kounta.transactions.reverse(
  "ledger-uuid",
  "txn-uuid",
  "Duplicate entry"
);
```

---

### kounta.reports

Generate financial statements.

```typescript
// incomeStatement(ledgerId, startDate, endDate): Promise<StatementResponse>
const pnl = await kounta.reports.incomeStatement(
  "ledger-uuid",
  "2026-01-01",
  "2026-03-31"
);

// balanceSheet(ledgerId, asOfDate): Promise<StatementResponse>
const bs = await kounta.reports.balanceSheet("ledger-uuid", "2026-03-31");

// cashFlow(ledgerId, startDate, endDate): Promise<StatementResponse>
const cf = await kounta.reports.cashFlow(
  "ledger-uuid",
  "2026-01-01",
  "2026-03-31"
);
```

---

### kounta.audit

Query the append-only audit log.

```typescript
// list(ledgerId, opts?): Promise<PaginatedResult<AuditEntry>>
const entries = await kounta.audit.list("ledger-uuid", {
  cursor: undefined,
  limit: 100,
});
```

---

### kounta.imports

Upload files (CSV/OFX), review matches, and confirm.

```typescript
// upload(ledgerId, input): Promise<ImportResult>
const result = await kounta.imports.upload("ledger-uuid", {
  fileContent: csvString,
  fileType: "csv",
  filename: "march-bank-statement.csv",
});

// list(ledgerId, opts?): Promise<PaginatedResult<ImportBatch>>
const batches = await kounta.imports.list("ledger-uuid", { limit: 20 });

// get(batchId): Promise<ImportResult>
const batch = await kounta.imports.get("batch-uuid");

// confirmMatches(batchId, actions): Promise<ImportResult>
const confirmed = await kounta.imports.confirmMatches("batch-uuid", [
  { rowId: "row-1", action: "accept" },
  { rowId: "row-2", action: "reject" },
]);
```

---

### kounta.templates

Browse and apply pre-built chart-of-accounts templates. List, get, and recommend require no authentication.

```typescript
// list(): Promise<Template[]>  -- no auth
const templates = await kounta.templates.list();

// get(idOrSlug): Promise<Template>  -- no auth
const tpl = await kounta.templates.get("saas-startup");

// recommend(context): Promise<TemplateRecommendation[]>  -- no auth
const recs = await kounta.templates.recommend({
  industry: "technology",
  description: "B2B SaaS with monthly subscriptions",
  businessModel: "subscription",
});

// apply(ledgerId, templateSlug): Promise<{accounts, count}>  -- admin auth
const applied = await kounta.templates.apply("ledger-uuid", "saas-startup");
console.log(applied.count); // number of accounts created
```

---

### kounta.apiKeys

Manage API keys scoped to a ledger. All methods require admin auth.

```typescript
// create(input): Promise<ApiKeyWithRaw>  -- admin
const key = await kounta.apiKeys.create({
  userId: "user-uuid",
  ledgerId: "ledger-uuid",
  name: "Production Key",
});
// key.raw is the full key, shown only once

// list(ledgerId): Promise<ApiKeySafe[]>  -- admin
const keys = await kounta.apiKeys.list("ledger-uuid");

// revoke(keyId): Promise<ApiKeySafe>  -- admin
const revoked = await kounta.apiKeys.revoke("key-uuid");
```

---

### kounta.admin

Provision new users and their ledgers. Requires admin auth.

```typescript
// provision(input): Promise<ProvisionResult>  -- admin
const result = await kounta.admin.provision({
  email: "founder@acme.com",
  name: "Jane Doe",
  authProvider: "google",
  authProviderId: "google-uid-123",
  templateSlug: "saas-startup",
});
```

---

### kounta.bankFeeds

Connect bank accounts, sync transactions, and confirm matches.

```typescript
// listConnections(ledgerId): Promise<BankConnection[]>
const connections = await kounta.bankFeeds.listConnections("ledger-uuid");

// getConnection(ledgerId, connectionId): Promise<BankConnection>
const conn = await kounta.bankFeeds.getConnection("ledger-uuid", "conn-uuid");

// listAccounts(ledgerId, connectionId): Promise<BankAccount[]>
const bankAccts = await kounta.bankFeeds.listAccounts("ledger-uuid", "conn-uuid");

// mapAccount(ledgerId, bankAccountId, accountId): Promise<BankAccount>
const mapped = await kounta.bankFeeds.mapAccount(
  "ledger-uuid",
  "bank-acct-uuid",
  "ledger-account-uuid"
);

// sync(ledgerId, bankAccountId, opts?): Promise<BankSyncLog>
const syncLog = await kounta.bankFeeds.sync("ledger-uuid", "bank-acct-uuid", {
  fromDate: "2026-03-01",
  toDate: "2026-03-14",
});

// listSyncLogs(ledgerId, connectionId): Promise<BankSyncLog[]>
const logs = await kounta.bankFeeds.listSyncLogs("ledger-uuid", "conn-uuid");

// listTransactions(ledgerId, bankAccountId, opts?): Promise<BankTransaction[]>
const bankTxns = await kounta.bankFeeds.listTransactions(
  "ledger-uuid",
  "bank-acct-uuid",
  { status: "unmatched", limit: 100 }
);

// confirmMatch(ledgerId, bankTransactionId, action, overrideTransactionId?): Promise<BankTransaction>
const matched = await kounta.bankFeeds.confirmMatch(
  "ledger-uuid",
  "bank-txn-uuid",
  "accept",
  "override-txn-uuid"
);
```

---

### kounta.notifications

View and manage system notifications and insights.

```typescript
// list(ledgerId, opts?): Promise<PaginatedResult<Notification>>
const notifs = await kounta.notifications.list("ledger-uuid", {
  status: "unread",
  type: "anomaly",
  limit: 20,
  cursor: undefined,
});

// get(ledgerId, notificationId): Promise<Notification>
const n = await kounta.notifications.get("ledger-uuid", "notif-uuid");

// updateStatus(ledgerId, notificationId, status): Promise<Notification>
const read = await kounta.notifications.updateStatus(
  "ledger-uuid",
  "notif-uuid",
  "read"
);

// generateInsights(ledgerId): Promise<{generated, notifications}>
const insights = await kounta.notifications.generateInsights("ledger-uuid");

// getPreferences(ledgerId): Promise<NotificationPreference[]>
const prefs = await kounta.notifications.getPreferences("ledger-uuid");

// setPreference(ledgerId, type, enabled): Promise<NotificationPreference>
const pref = await kounta.notifications.setPreference(
  "ledger-uuid",
  "anomaly",
  true
);
```

---

### kounta.currencies

Manage multi-currency settings, exchange rates, and conversions.

```typescript
// list(ledgerId): Promise<CurrencySetting[]>
const currencies = await kounta.currencies.list("ledger-uuid");

// enable(ledgerId, input): Promise<CurrencySetting>
const eur = await kounta.currencies.enable("ledger-uuid", {
  currencyCode: "EUR",
  decimalPlaces: 2,
  symbol: "E",
});

// listRates(ledgerId, opts?): Promise<PaginatedResult<ExchangeRate>>
const rates = await kounta.currencies.listRates("ledger-uuid", { limit: 50 });

// setRate(ledgerId, input): Promise<ExchangeRate>
const rate = await kounta.currencies.setRate("ledger-uuid", {
  fromCurrency: "USD",
  toCurrency: "EUR",
  rate: 920000,
  effectiveDate: "2026-03-14",
});

// convert(ledgerId, input): Promise<ConvertAmountResult>
const converted = await kounta.currencies.convert("ledger-uuid", {
  amount: 100000,
  fromCurrency: "USD",
  toCurrency: "EUR",
});

// revalue(ledgerId, date): Promise<RevaluationResult[]>
const revaluations = await kounta.currencies.revalue("ledger-uuid", "2026-03-14");
```

---

### kounta.conversations

Manage AI-assisted conversations scoped to a ledger.

```typescript
// list(ledgerId, opts?): Promise<PaginatedResult<Conversation>>
const convos = await kounta.conversations.list("ledger-uuid", { limit: 10 });

// create(ledgerId, title?): Promise<Conversation>
const convo = await kounta.conversations.create("ledger-uuid", "Q1 Review");

// get(ledgerId, conversationId): Promise<Conversation>
const c = await kounta.conversations.get("ledger-uuid", "convo-uuid");

// update(ledgerId, conversationId, messages, title?): Promise<Conversation>
const updated = await kounta.conversations.update(
  "ledger-uuid",
  "convo-uuid",
  [{ role: "user", content: "What were our top expenses last month?" }],
  "Expense Analysis"
);

// delete(ledgerId, conversationId): Promise<void>
await kounta.conversations.delete("ledger-uuid", "convo-uuid");
```

---

### kounta.classification

Manage classification rules, merchant aliases, and auto-categorize transactions.

```typescript
// listRules(ledgerId, opts?): Promise<ClassificationRule[]>
const rules = await kounta.classification.listRules("ledger-uuid");

// createRule(ledgerId, input): Promise<ClassificationRule>
const rule = await kounta.classification.createRule("ledger-uuid", {
  pattern: "AMZN*",
  accountCode: "5100",
  description: "Amazon purchases",
});

// getRule(ledgerId, ruleId): Promise<ClassificationRule>
const r = await kounta.classification.getRule("ledger-uuid", "rule-uuid");

// updateRule(ledgerId, ruleId, input): Promise<ClassificationRule>
const updatedRule = await kounta.classification.updateRule(
  "ledger-uuid",
  "rule-uuid",
  { accountCode: "5200" }
);

// deleteRule(ledgerId, ruleId): Promise<void>
await kounta.classification.deleteRule("ledger-uuid", "rule-uuid");

// classify(ledgerId, input): Promise<ClassificationResult | null>
const match = await kounta.classification.classify("ledger-uuid", {
  description: "AMZN Mktp US*1A2B3C",
  amount: 4599,
});

// classifyBankTransaction(ledgerId, bankTransactionId, accountId, isPersonal?): Promise<BankTransaction>
const classified = await kounta.classification.classifyBankTransaction(
  "ledger-uuid",
  "bank-txn-uuid",
  "account-uuid",
  false
);

// listAliases(ledgerId): Promise<MerchantAlias[]>
const aliases = await kounta.classification.listAliases("ledger-uuid");

// addAlias(ledgerId, canonicalName, alias): Promise<MerchantAlias>
const alias = await kounta.classification.addAlias(
  "ledger-uuid",
  "Amazon",
  "AMZN Mktp US"
);
```

---

### kounta.recurring

Schedule and manage recurring journal entries.

```typescript
// list(ledgerId): Promise<RecurringEntry[]>
const entries = await kounta.recurring.list("ledger-uuid");

// create(ledgerId, input): Promise<RecurringEntry>
const entry = await kounta.recurring.create("ledger-uuid", {
  memo: "Monthly rent",
  frequency: "monthly",
  startDate: "2026-04-01",
  lines: [
    { accountCode: "5000", amount: 250000, direction: "debit" },
    { accountCode: "2000", amount: 250000, direction: "credit" },
  ],
});

// get(ledgerId, id): Promise<RecurringEntry & {recentLogs}>
const re = await kounta.recurring.get("ledger-uuid", "entry-uuid");

// update(ledgerId, id, input): Promise<RecurringEntry>
const updatedEntry = await kounta.recurring.update("ledger-uuid", "entry-uuid", {
  memo: "Monthly rent (updated)",
});

// delete(ledgerId, id): Promise<void>
await kounta.recurring.delete("ledger-uuid", "entry-uuid");

// pause(ledgerId, id): Promise<RecurringEntry>
const paused = await kounta.recurring.pause("ledger-uuid", "entry-uuid");

// resume(ledgerId, id): Promise<RecurringEntry>
const resumed = await kounta.recurring.resume("ledger-uuid", "entry-uuid");
```

---

### kounta.periods

Close and reopen accounting periods.

```typescript
// close(ledgerId, periodEnd): Promise<{periodEnd, closedAt}>
const closed = await kounta.periods.close("ledger-uuid", "2026-03-31");

// reopen(ledgerId, periodEnd): Promise<{periodEnd, reopenedAt}>
const reopened = await kounta.periods.reopen("ledger-uuid", "2026-03-31");

// list(ledgerId): Promise<ClosedPeriod[]>
const periods = await kounta.periods.list("ledger-uuid");
```

---

### kounta.stripeConnect

Connect and sync with Stripe via OAuth.

```typescript
// authorize(): Promise<{url}>
const { url } = await kounta.stripeConnect.authorize();
// Redirect the user to url to complete OAuth

// status(): Promise<StripeConnectStatus | null>
const status = await kounta.stripeConnect.status();

// disconnect(): Promise<{disconnected}>
const { disconnected } = await kounta.stripeConnect.disconnect();

// sync(): Promise<{syncing, message}>
const { syncing, message } = await kounta.stripeConnect.sync();
```

---

## Error Handling

All SDK methods throw a `KountaApiError` on non-2xx responses. The error includes structured details to help you diagnose and recover from failures.

```typescript
import { Kounta, KountaApiError } from "@kounta/sdk";

const kounta = new Kounta({ apiKey: "kounta_live_..." });

try {
  await kounta.transactions.post("ledger-uuid", {
    date: "2026-03-14",
    memo: "Unbalanced entry",
    lines: [
      { accountCode: "1000", amount: 5000, direction: "debit" },
      { accountCode: "2000", amount: 4000, direction: "credit" },
    ],
  });
} catch (err) {
  if (err instanceof KountaApiError) {
    console.error(err.status);      // HTTP status code, e.g. 422
    console.error(err.code);        // Machine-readable error code, e.g. "UNBALANCED_TRANSACTION"
    console.error(err.message);     // Human-readable message
    console.error(err.details);     // Field-level details array:
    // [{ field: "lines", expected: "debits === credits", actual: "5000 !== 4000" }]
    console.error(err.suggestion);  // e.g. "Add a credit line for 1000 or adjust existing lines"
  }
}
```

### KountaApiError Properties

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
  const page = await kounta.transactions.list("ledger-uuid", { cursor, limit: 100 });
  for (const txn of page.data) {
    console.log(txn.id, txn.memo);
  }
  cursor = page.nextCursor;
} while (cursor);
```

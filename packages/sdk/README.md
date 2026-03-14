# @kounta/sdk

Typed TypeScript client for the [Kounta](https://kounta.ai) REST API — double-entry accounting infrastructure for builders.

## Install

```bash
npm install @kounta/sdk
```

## Quick start

```typescript
import { Kounta } from "@kounta/sdk";

const ledge = new Kounta({
  apiKey: "ldg_live_...",             // your API key
  adminSecret: "sk_admin_...",        // optional — only for admin operations
  baseUrl: "https://api.kounta.ai", // optional — defaults to production
});
```

## Modules

The SDK is organised into modules that mirror the REST API:

| Module              | Description                                   |
| ------------------- | --------------------------------------------- |
| `ledge.ledgers`     | Create and retrieve ledgers                   |
| `ledge.accounts`    | Create, list, and retrieve accounts           |
| `ledge.transactions`| Post, list, retrieve, and reverse transactions|
| `ledge.reports`     | Income statement, balance sheet, cash flow     |
| `ledge.audit`       | List audit trail entries                       |
| `ledge.imports`     | Upload CSV/OFX files, review matches, confirm  |
| `ledge.templates`   | List, recommend, and apply chart-of-accounts   |
| `ledge.apiKeys`     | Create, list, and revoke API keys              |

## Post a transaction

Every transaction must balance — debits equal credits, amounts in integer cents.

```typescript
const txn = await ledge.transactions.post("ldg_abc123", {
  date: "2025-03-10",
  memo: "March subscription revenue",
  lines: [
    { accountCode: "1000", amount: 9900, direction: "debit" },  // Cash +$99.00
    { accountCode: "4000", amount: 9900, direction: "credit" },  // Revenue +$99.00
  ],
});

console.log(txn.id);     // UUIDv7
console.log(txn.status); // "posted"
```

## Generate a P&L (income statement)

```typescript
const pnl = await ledge.reports.incomeStatement(
  "ldg_abc123",
  "2025-01-01",  // startDate
  "2025-03-31",  // endDate
);

console.log(pnl.statementType);         // "pnl"
console.log(pnl.totals.netIncome);      // integer cents
console.log(pnl.plainLanguageSummary);   // human-readable summary

for (const section of pnl.sections) {
  console.log(`${section.title}: ${section.total}`);
  for (const line of section.lines) {
    console.log(`  ${line.accountCode} ${line.accountName}: ${line.amount}`);
  }
}
```

## Other reports

```typescript
// Balance sheet — point-in-time snapshot
const bs = await ledge.reports.balanceSheet("ldg_abc123", "2025-03-31");

// Cash-flow statement — period-based
const cf = await ledge.reports.cashFlow("ldg_abc123", "2025-01-01", "2025-03-31");
```

## Accounts

```typescript
// Create accounts
const cash = await ledge.accounts.create("ldg_abc123", {
  code: "1000",
  name: "Cash",
  type: "asset",
});

// List all accounts (with current balances)
const accounts = await ledge.accounts.list("ldg_abc123");

// Get a single account
const acct = await ledge.accounts.get("ldg_abc123", cash.id);
console.log(acct.balance); // integer cents
```

## Reversals

Transactions are immutable. To undo one, reverse it — this creates a new offsetting entry:

```typescript
const reversal = await ledge.transactions.reverse(
  "ldg_abc123",
  txn.id,
  "Customer refund",
);
```

## Pagination

List endpoints return `{ data, nextCursor }`:

```typescript
let cursor: string | undefined;
do {
  const page = await ledge.transactions.list("ldg_abc123", {
    limit: 50,
    cursor,
  });

  for (const txn of page.data) {
    console.log(txn.memo, txn.date);
  }

  cursor = page.nextCursor ?? undefined;
} while (cursor);
```

## CSV / OFX import

Upload a bank statement, review automatic matches, then confirm:

```typescript
import { readFileSync } from "node:fs";

// 1. Upload
const csv = readFileSync("bank-march.csv", "utf-8");
const result = await ledge.imports.upload("ldg_abc123", {
  fileContent: csv,
  fileType: "csv",
  filename: "bank-march.csv",
});

console.log(result.batch.rowCount);  // number of parsed rows
console.log(result.batch.matchedCount, result.batch.unmatchedCount);

// 2. Review rows
for (const row of result.rows) {
  console.log(row.payee, row.amount, row.matchStatus, row.confidence);
}

// 3. Confirm / reject / override matches
await ledge.imports.confirmMatches(result.batch.id, [
  { rowId: result.rows[0].id, action: "confirm" },
  { rowId: result.rows[1].id, action: "reject" },
  { rowId: result.rows[2].id, action: "override", overrideTransactionId: "txn_..." },
]);
```

## Templates

Bootstrap a ledger with a pre-built chart of accounts:

```typescript
// List available templates
const templates = await ledge.templates.list();

// Get AI-powered recommendations
const recs = await ledge.templates.recommend({
  industry: "software",
  businessModel: "subscription",
});
console.log(recs[0].template.name, recs[0].reason);

// Apply to a ledger (admin)
const applied = await ledge.templates.apply("ldg_abc123", "saas");
console.log(`Created ${applied.count} accounts`);
```

## Admin operations

Ledger creation, API key management, and template application require `adminSecret`:

```typescript
const admin = new Kounta({
  apiKey: "ldg_live_...",
  adminSecret: "sk_admin_...",
});

// Create a ledger
const ledger = await admin.ledgers.create({
  name: "Acme Corp",
  ownerId: "usr_...",
  currency: "USD",
  accountingBasis: "accrual",
});

// Create an API key for the ledger
const key = await admin.apiKeys.create({
  userId: "usr_...",
  ledgerId: ledger.id,
  name: "production",
});
console.log(key.rawKey); // only shown once

// List and revoke keys
const keys = await admin.apiKeys.list(ledger.id);
await admin.apiKeys.revoke(keys[0].id);
```

## Error handling

Non-2xx responses throw a `KountaApiError` with structured fields:

```typescript
import { KountaApiError, ErrorCode } from "@kounta/sdk";

try {
  await ledge.transactions.post("ldg_abc123", { /* unbalanced */ });
} catch (e) {
  if (e instanceof KountaApiError) {
    console.log(e.status);    // 400
    console.log(e.code);      // "UNBALANCED_TRANSACTION"
    console.log(e.message);   // human-readable message
    console.log(e.requestId); // for support tickets
  }
}
```

All error codes are available as `ErrorCode.*` constants:

```typescript
ErrorCode.LEDGER_NOT_FOUND
ErrorCode.DUPLICATE_ACCOUNT_CODE
ErrorCode.UNBALANCED_TRANSACTION
ErrorCode.TRANSACTION_ALREADY_REVERSED
ErrorCode.IMPORT_PARSE_ERROR
// ... and more
```

## Types

All domain types are re-exported from `@kounta/sdk` — no need to install `@kounta/core`:

```typescript
import type {
  Ledger,
  Account,
  AccountWithBalance,
  TransactionWithLines,
  LineItem,
  StatementResponse,
  ImportBatch,
  ImportRow,
  Template,
  AuditEntry,
  PaginatedResult,
} from "@kounta/sdk";
```

## Custom fetch

Pass a custom `fetch` for edge runtimes, testing, or middleware:

```typescript
const ledge = new Kounta({
  apiKey: "ldg_live_...",
  fetch: myCustomFetch,
});
```

# MCP Server Guide

## Overview
The Ledge MCP server exposes 39 tools, 4 resources, and 3 prompt templates for AI-powered accounting. Two transport modes:
- **Hosted (SSE)**: Connect to `https://mcp.useledge.ai` with your API key
- **Local (stdio)**: Run locally with `npx @ledge/mcp` for development

## Hosted Endpoint
URL: `https://mcp.useledge.ai`
Auth: API key via `Authorization: Bearer <key>`, `X-Api-Key: <key>`, or `?key=<key>` query param.
Health check: GET `https://mcp.useledge.ai/health`

## Connection Configs

### Claude Desktop (Hosted SSE)
```json
{
  "mcpServers": {
    "ledge": {
      "url": "https://mcp.useledge.ai/sse?key=YOUR_API_KEY"
    }
  }
}
```

### Claude Code (Local stdio)
`.claude/settings.json`:
```json
{
  "mcpServers": {
    "ledge": {
      "command": "npx",
      "args": ["@ledge/mcp", "--stdio"]
    }
  }
}
```

### Claude Code (Hosted SSE)
`.claude/settings.json`:
```json
{
  "mcpServers": {
    "ledge": {
      "url": "https://mcp.useledge.ai/sse?key=YOUR_API_KEY"
    }
  }
}
```

### Cursor (Local stdio)
`.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "ledge": {
      "command": "npx",
      "args": ["@ledge/mcp", "--stdio"]
    }
  }
}
```

### Cursor (Hosted SSE)
`.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "ledge": {
      "url": "https://mcp.useledge.ai/sse?key=YOUR_API_KEY"
    }
  }
}
```

## All 39 Tools

### Ledger Setup
1. **setup_ledger** — Auto-provision a ledger from a business description. Params: `description` (string, required)
2. **complete_setup** — Finalize ledger setup with a specific template. Params: `templateSlug` (string, required), `name?`, `currency?`

### Transactions
3. **post_transaction** — Record a balanced double-entry transaction. Params: `ledgerId`, `date`, `memo`, `lines[]` (accountCode, amount, direction), `idempotencyKey?`, `metadata?`
4. **reverse_transaction** — Reverse a posted transaction. Params: `transactionId`, `reason`
5. **search_transactions** — Search transactions with pagination. Params: `ledgerId`, `limit?`, `cursor?`, `startDate?`, `endDate?`

### Accounts
6. **list_accounts** — List all accounts with current balances. Params: `ledgerId`
7. **create_account** — Create a new account. Params: `ledgerId`, `code`, `name`, `type`, `parentCode?`

### Statements
8. **get_statement** — Generate P&L, balance sheet, or cash flow. Params: `ledgerId`, `type` (pnl|balance_sheet|cash_flow), `startDate?`, `endDate?`, `asOfDate?`

### Import
9. **import_file** — Import CSV or OFX bank data. Params: `ledgerId`, `format` (csv|ofx), `content`, `filename?`
10. **confirm_matches** — Confirm or reject import match suggestions. Params: `batchId`, `actions[]`
11. **get_import_batch** — Get import batch details with rows. Params: `batchId`

### Bank Feeds
12. **list_bank_connections** — List all bank feed connections. Params: `ledgerId`
13. **list_bank_accounts** — List bank accounts for a connection. Params: `ledgerId`, `connectionId`
14. **sync_bank_account** — Trigger a bank account sync. Params: `ledgerId`, `bankAccountId`, `fromDate?`, `toDate?`
15. **list_bank_transactions** — List synced bank transactions. Params: `ledgerId`, `bankAccountId?`, `status?`, `limit?`
16. **confirm_bank_match** — Confirm or ignore a bank transaction match. Params: `ledgerId`, `bankTransactionId`, `action`
17. **map_bank_account** — Map a bank account to a ledger account. Params: `ledgerId`, `bankAccountId`, `accountId`

### Notifications
18. **list_notifications** — List notifications with filters. Params: `ledgerId`, `status?`, `type?`, `limit?`
19. **get_notification** — Get a single notification. Params: `ledgerId`, `notificationId`
20. **update_notification** — Update notification status. Params: `ledgerId`, `notificationId`, `status`
21. **generate_insights** — Run analyzers and create insight notifications. Params: `ledgerId`

### Currencies
22. **enable_currency** — Enable a currency on a ledger. Params: `ledgerId`, `currencyCode`, `decimalPlaces?`, `symbol?`
23. **set_exchange_rate** — Set an exchange rate. Params: `ledgerId`, `fromCurrency`, `toCurrency`, `rate`, `effectiveDate`, `source?`
24. **list_exchange_rates** — List exchange rates. Params: `ledgerId`, `fromCurrency?`, `toCurrency?`, `limit?`
25. **convert_amount** — Convert between currencies. Params: `ledgerId`, `fromCurrency`, `toCurrency`, `amount`, `date?`
26. **revalue_accounts** — Revalue foreign-currency accounts. Params: `ledgerId`, `date`

### Classification
27. **classify_transaction** — Preview classification for a description. Params: `ledgerId`, `description`, `category?`, `amount?`
28. **classify_bank_transaction** — Classify a bank transaction to a ledger account. Params: `ledgerId`, `bankTransactionId`, `accountId`, `isPersonal?`
29. **create_classification_rule** — Create an auto-classification rule. Params: `ledgerId`, `ruleType`, `field`, `pattern`, `targetAccountId`, `priority?`, `isPersonal?`, `confidence?`
30. **list_classification_rules** — List classification rules. Params: `ledgerId`, `ruleType?`, `field?`
31. **list_merchant_aliases** — List merchant name aliases. Params: `ledgerId`

### Recurring Entries
32. **create_recurring_entry** — Create a recurring journal entry. Params: `ledgerId`, `description`, `lineItems`, `frequency`, `dayOfMonth?`, `nextRunDate`, `autoReverse?`
33. **list_recurring_entries** — List all recurring entries. Params: `ledgerId`
34. **update_recurring_entry** — Update a recurring entry. Params: `ledgerId`, `entryId`, `description?`, `frequency?`, etc.
35. **pause_recurring_entry** — Pause a recurring entry. Params: `ledgerId`, `entryId`
36. **resume_recurring_entry** — Resume a paused recurring entry. Params: `ledgerId`, `entryId`

### Usage
37. **get_usage** — Check account, transaction, and line item counts. Params: `ledgerId`

### Stripe
38. **get_stripe_status** — Get Stripe connection status. Params: `ledgerId`
39. **sync_stripe** — Trigger Stripe data sync. Params: `ledgerId`

## Resources (4)
1. `ledger://{id}/chart-of-accounts` — Full chart of accounts as JSON
2. `ledger://{id}/pnl{?start,end}` — Income statement for date range
3. `ledger://{id}/balance-sheet{?as_of}` — Balance sheet as of date
4. `ledger://{id}/recent-transactions{?limit}` — Most recent transactions

## Prompt Templates (3)
1. **monthly-close** — Guided month-end close workflow. Args: `ledgerId`, `month`
2. **reconcile-bank** — Bank reconciliation assistance. Args: `ledgerId`, `accountCode`, `statementBalance`
3. **explain-statement** — Financial statement explanation. Args: `ledgerId`, `statementType`, `startDate`, `endDate`

## Example Conversation

> **User:** Set up a ledger for my coffee shop and record today's sales of $425.

> **Claude:** I'll set up your ledger and record the transaction.
>
> First, I'll use `setup_ledger` with description "coffee shop" to auto-provision your chart of accounts. Then I'll use `post_transaction` to record the sale:
>
> ```
> Tool: post_transaction
> Params:
>   ledgerId: "<your-ledger-id>"
>   date: "2026-03-14"
>   memo: "Daily sales revenue"
>   lines:
>     - accountCode: "1000", amount: 42500, direction: "debit"   # Cash
>     - accountCode: "4000", amount: 42500, direction: "credit"  # Sales Revenue
> ```
>
> Your ledger is set up with the **cafe** template and the $425.00 sale has been posted. Debits equal credits. Want me to pull your P&L?

## Authentication
- **Hosted mode**: API key required (header, X-Api-Key, or `?key=` query param)
- **Local mode**: No auth needed (runs with embedded database)

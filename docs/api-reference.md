# Ledge API Reference

Complete reference for the Ledge REST API.

**Base URL:**
- Production: `https://api.useledge.ai`
- Local development: `http://localhost:3001`

**Conventions:**
- Amounts are integers in the smallest currency unit (cents). `$12.50` = `1250`
- All IDs are UUID v7
- All timestamps are UTC, returned as ISO 8601
- Cursor-based pagination: `cursor` + `limit` (default 50, max 200)

---

## Table of Contents

- [Authentication](#authentication)
- [Response Format](#response-format)
- [Pagination](#pagination)
- [Error Codes](#error-codes)
- [Endpoints](#endpoints)
  - [Health](#health)
  - [Ledgers](#ledgers)
  - [Accounts](#accounts)
  - [Transactions](#transactions)
  - [Reports](#reports)
  - [Audit](#audit)
  - [Templates](#templates)
  - [Imports](#imports)
  - [API Keys](#api-keys)
  - [Bank Feeds](#bank-feeds)
  - [Classification](#classification)
  - [Notifications](#notifications)
  - [Currencies](#currencies)
  - [Conversations](#conversations)
  - [Attachments](#attachments)
  - [Recurring Entries](#recurring-entries)
  - [Periods](#periods)
  - [Stripe Connect](#stripe-connect)
  - [Billing](#billing)
  - [Email](#email)
  - [Onboarding](#onboarding)
  - [Admin](#admin)
- [Quick Reference](#quick-reference)

---

## Authentication

Ledge uses two authentication modes:

### API Key Auth

For ledger operations (accounts, transactions, reports, imports, etc.). API keys are scoped to a single ledger.

Provide the key in either header:

```
Authorization: Bearer ledge_live_xxxxxxxxxxxxxxxx
```

or:

```
X-Api-Key: ledge_live_xxxxxxxxxxxxxxxx
```

API keys are created via `POST /v1/api-keys` and shown only once at creation time. Keys are stored as SHA-256 hashes.

Key prefixes:
- `ledge_live_` for production
- `ledge_test_` for sandbox

### Admin Auth

For bootstrap operations (creating ledgers, managing API keys, applying templates, provisioning). Uses the `LEDGE_ADMIN_SECRET` environment variable.

```
Authorization: Bearer <LEDGE_ADMIN_SECRET>
```

### No Auth

Some endpoints require no authentication: health check, template listing, Stripe/billing webhooks, and OAuth callbacks.

---

## Response Format

All responses return JSON. Successful responses wrap data in a `data` key:

```json
{
  "data": { }
}
```

List endpoints return an array with pagination metadata:

```json
{
  "data": [],
  "pagination": {
    "cursor": "next-cursor-value",
    "hasMore": true,
    "limit": 50
  }
}
```

---

## Pagination

All list endpoints use cursor-based pagination.

| Parameter | Type   | Default | Max | Description                     |
|-----------|--------|---------|-----|---------------------------------|
| `cursor`  | string | —       | —   | Opaque cursor from previous page |
| `limit`   | number | 50      | 200 | Number of items per page         |

---

## Error Codes

All error responses include structured details:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": [
      {
        "field": "amount",
        "expected": "positive integer",
        "actual": "-100"
      }
    ],
    "suggestion": "Provide a positive integer amount in the smallest currency unit"
  }
}
```

| HTTP Status | Error Code             | Description                                |
|-------------|------------------------|--------------------------------------------|
| 400         | `VALIDATION_ERROR`     | Invalid request body or query parameters   |
| 400         | `UNBALANCED_ENTRY`     | Debits do not equal credits                |
| 401         | `UNAUTHORIZED`         | Missing or invalid authentication          |
| 403         | `FORBIDDEN`            | Key does not have access to this ledger    |
| 404         | `NOT_FOUND`            | Resource does not exist                    |
| 409         | `IDEMPOTENCY_CONFLICT` | Idempotency key already used               |
| 409         | `ALREADY_REVERSED`     | Transaction has already been reversed      |
| 422         | `PERIOD_CLOSED`        | Cannot post to a closed period             |
| 429         | `RATE_LIMITED`         | Too many requests                          |
| 500         | `INTERNAL_ERROR`       | Server error                               |

---

## Endpoints

### Health

#### `GET /v1/health`

Health check. No authentication required.

**Response:**

```json
{
  "data": {
    "status": "ok",
    "timestamp": "2026-03-14T00:00:00.000Z"
  }
}
```

---

### Ledgers

#### `POST /v1/ledgers`

Create a new ledger.

**Auth:** Admin

**Request body:**

| Field              | Type   | Required | Description                                   |
|--------------------|--------|----------|-----------------------------------------------|
| `name`             | string | Yes      | Display name for the ledger                   |
| `currency`         | string | Yes      | ISO 4217 currency code (e.g., `USD`)          |
| `fiscalYearStart`  | string | No       | MM-DD format (default: `01-01`)               |
| `accountingBasis`  | string | No       | `accrual` or `cash` (default: `accrual`)      |
| `ownerId`          | string | Yes      | UUID of the owning user                       |
| `businessContext`  | object | No       | Freeform JSON with business metadata          |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "0192b3a4-...",
    "name": "My SaaS Ledger",
    "currency": "USD",
    "fiscalYearStart": "01-01",
    "accountingBasis": "accrual",
    "ownerId": "0192b3a4-...",
    "businessContext": {},
    "createdAt": "2026-03-14T00:00:00.000Z",
    "updatedAt": "2026-03-14T00:00:00.000Z"
  }
}
```

---

#### `GET /v1/ledgers/:ledgerId`

Get a ledger by ID.

**Auth:** API Key

**Response:** `200 OK` — Returns the ledger object.

---

#### `PATCH /v1/ledgers/:ledgerId`

Update a ledger.

**Auth:** API Key

**Request body:**

| Field             | Type   | Required | Description                        |
|-------------------|--------|----------|------------------------------------|
| `name`            | string | No       | Updated display name               |
| `fiscalYearStart` | string | No       | Updated fiscal year start (MM-DD)  |

**Response:** `200 OK` — Returns the updated ledger object.

---

### Accounts

#### `POST /v1/ledgers/:ledgerId/accounts`

Create a new account in the chart of accounts.

**Auth:** API Key

**Request body:**

| Field           | Type   | Required | Description                                             |
|-----------------|--------|----------|---------------------------------------------------------|
| `code`          | string | Yes      | Account code (e.g., `1000`, `2100`)                    |
| `name`          | string | Yes      | Account display name                                    |
| `type`          | string | Yes      | One of: `asset`, `liability`, `equity`, `revenue`, `expense` |
| `normalBalance` | string | Yes      | `debit` or `credit`                                     |
| `parentCode`    | string | No       | Code of parent account for nesting                      |
| `metadata`      | object | No       | Freeform JSON metadata                                  |

**Response:** `201 Created` — Returns the created account.

---

#### `GET /v1/ledgers/:ledgerId/accounts`

List all accounts for a ledger with computed balances.

**Auth:** API Key

**Response:** `200 OK` — Returns array of accounts with balance information.

---

#### `GET /v1/ledgers/:ledgerId/accounts/:accountId`

Get a single account by ID.

**Auth:** API Key

**Response:** `200 OK` — Returns the account object.

---

### Transactions

#### `POST /v1/ledgers/:ledgerId/transactions`

Create a new journal entry. Debits must equal credits or the request is rejected.

**Auth:** API Key

**Request body:**

| Field            | Type     | Required | Description                                             |
|------------------|----------|----------|---------------------------------------------------------|
| `date`           | string   | Yes      | Transaction date (ISO 8601)                             |
| `effectiveDate`  | string   | No       | Effective date if different from posting date            |
| `memo`           | string   | Yes      | Description of the transaction                          |
| `lines`          | array    | Yes      | Array of line items (see below)                         |
| `idempotencyKey` | string   | Yes      | Unique key per ledger to prevent duplicates             |
| `sourceType`     | string   | No       | One of: `api`, `mcp`, `import`, `manual`                |
| `sourceRef`      | string   | No       | External reference identifier                           |
| `agentId`        | string   | No       | ID of the agent creating the transaction                |
| `metadata`       | object   | No       | Freeform JSON metadata                                  |

**Line item fields:**

| Field       | Type    | Required | Description                                      |
|-------------|---------|----------|--------------------------------------------------|
| `accountId` | string  | Yes      | UUID of the target account                       |
| `amount`    | integer | Yes      | Amount in smallest currency unit (e.g., cents)   |
| `direction` | string  | Yes      | `debit` or `credit`                              |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "0192b3a4-...",
    "ledgerId": "0192b3a4-...",
    "date": "2026-03-14",
    "memo": "Monthly subscription revenue",
    "status": "posted",
    "idempotencyKey": "sub-2026-03",
    "lines": [
      { "accountId": "...", "amount": 9900, "direction": "debit" },
      { "accountId": "...", "amount": 9900, "direction": "credit" }
    ],
    "createdAt": "2026-03-14T00:00:00.000Z"
  }
}
```

---

#### `GET /v1/ledgers/:ledgerId/transactions`

List transactions for a ledger.

**Auth:** API Key

**Query parameters:**

| Parameter | Type   | Default | Description              |
|-----------|--------|---------|--------------------------|
| `cursor`  | string | —       | Pagination cursor        |
| `limit`   | number | 50      | Items per page (max 200) |

**Response:** `200 OK` — Paginated array of transactions.

---

#### `GET /v1/ledgers/:ledgerId/transactions/:transactionId`

Get a single transaction by ID.

**Auth:** API Key

**Response:** `200 OK` — Returns the transaction with all line items.

---

#### `POST /v1/ledgers/:ledgerId/transactions/:transactionId/reverse`

Reverse a posted transaction. Creates a new offsetting entry; the original is marked as `reversed`.

**Auth:** API Key

**Request body:**

| Field    | Type   | Required | Description              |
|----------|--------|----------|--------------------------|
| `reason` | string | Yes      | Reason for the reversal  |

**Response:** `201 Created` — Returns the reversal transaction.

---

### Reports

#### `GET /v1/ledgers/:ledgerId/reports/income-statement`

Generate a profit & loss (income statement) report.

**Auth:** API Key

**Query parameters:**

| Parameter   | Type   | Required | Description                      |
|-------------|--------|----------|----------------------------------|
| `startDate` | string | Yes      | Period start date (ISO 8601)     |
| `endDate`   | string | Yes      | Period end date (ISO 8601)       |

**Response:** `200 OK` — Returns revenue, expenses, and net income broken down by account.

---

#### `GET /v1/ledgers/:ledgerId/reports/balance-sheet`

Generate a balance sheet report.

**Auth:** API Key

**Query parameters:**

| Parameter  | Type   | Required | Description                       |
|------------|--------|----------|-----------------------------------|
| `asOfDate` | string | Yes      | Point-in-time date (ISO 8601)     |

**Response:** `200 OK` — Returns assets, liabilities, and equity balances.

---

#### `GET /v1/ledgers/:ledgerId/reports/cash-flow`

Generate a cash flow statement (indirect method).

**Auth:** API Key

**Query parameters:**

| Parameter   | Type   | Required | Description                      |
|-------------|--------|----------|----------------------------------|
| `startDate` | string | Yes      | Period start date (ISO 8601)     |
| `endDate`   | string | Yes      | Period end date (ISO 8601)       |

**Response:** `200 OK` — Returns cash flows from operating, investing, and financing activities.

---

### Audit

#### `GET /v1/ledgers/:ledgerId/audit`

List audit log entries for a ledger.

**Auth:** API Key

**Query parameters:**

| Parameter | Type   | Default | Description              |
|-----------|--------|---------|--------------------------|
| `cursor`  | string | —       | Pagination cursor        |
| `limit`   | number | 50      | Items per page (max 200) |

**Response:** `200 OK` — Paginated array of audit entries. Each entry includes entity_type, entity_id, action, actor information, timestamp, and a full entity snapshot.

---

### Templates

#### `GET /v1/templates`

List all available business templates.

**Auth:** None

**Response:** `200 OK` — Array of templates with slug, business_type, and summary.

---

#### `GET /v1/templates/:idOrSlug`

Get a template by ID or slug.

**Auth:** None

**Response:** `200 OK` — Returns the template including its full chart_of_accounts tree.

---

#### `POST /v1/templates/recommend`

Get a template recommendation based on business description.

**Auth:** None

**Request body:**

| Field           | Type   | Required | Description                            |
|-----------------|--------|----------|----------------------------------------|
| `industry`      | string | No       | Business industry                      |
| `description`   | string | No       | Free-text business description         |
| `businessModel` | string | No       | Business model type                    |

**Response:** `200 OK` — Returns recommended template(s).

---

#### `POST /v1/templates/apply`

Apply a template's chart of accounts to a ledger.

**Auth:** Admin

**Request body:**

| Field          | Type   | Required | Description                        |
|----------------|--------|----------|------------------------------------|
| `ledgerId`     | string | Yes      | UUID of the target ledger          |
| `templateSlug` | string | Yes      | Slug of the template to apply      |

**Response:** `200 OK` — Returns the created accounts.

---

### Imports

#### `POST /v1/ledgers/:ledgerId/imports`

Import transactions from a file (CSV or OFX).

**Auth:** API Key

**Request body:**

| Field         | Type   | Required | Description                          |
|---------------|--------|----------|--------------------------------------|
| `fileContent` | string | Yes      | Base64-encoded or raw file content   |
| `fileType`    | string | Yes      | `csv` or `ofx`                       |
| `filename`    | string | Yes      | Original filename                    |

**Response:** `201 Created` — Returns the import batch with row counts and match status.

---

#### `GET /v1/ledgers/:ledgerId/imports`

List import batches for a ledger.

**Auth:** API Key

**Query parameters:**

| Parameter | Type   | Default | Description              |
|-----------|--------|---------|--------------------------|
| `cursor`  | string | —       | Pagination cursor        |
| `limit`   | number | 50      | Items per page (max 200) |

**Response:** `200 OK` — Paginated array of import batches.

---

#### `GET /v1/imports/:batchId`

Get an import batch by ID with its rows.

**Auth:** API Key

**Response:** `200 OK` — Returns the batch with all import rows and their match statuses.

---

#### `POST /v1/imports/:batchId/confirm`

Confirm and apply matched import rows as transactions.

**Auth:** API Key

**Request body:**

| Field     | Type  | Required | Description                                     |
|-----------|-------|----------|-------------------------------------------------|
| `actions` | array | Yes      | Array of actions to take on individual rows      |

**Response:** `200 OK` — Returns created transactions and summary.

---

### API Keys

#### `POST /v1/api-keys`

Create a new API key. The key value is returned only in this response.

**Auth:** Admin

**Request body:**

| Field      | Type   | Required | Description                     |
|------------|--------|----------|---------------------------------|
| `userId`   | string | Yes      | UUID of the owning user         |
| `ledgerId` | string | Yes      | UUID of the ledger to scope to  |
| `name`     | string | Yes      | Display name for the key        |

**Response:** `201 Created`

```json
{
  "data": {
    "id": "0192b3a4-...",
    "key": "ledge_live_xxxxxxxxxxxxxxxx",
    "prefix": "xxxxxxxx",
    "name": "Production Key",
    "ledgerId": "0192b3a4-...",
    "createdAt": "2026-03-14T00:00:00.000Z"
  }
}
```

> **Note:** The `key` field is only returned at creation time. Store it securely.

---

#### `GET /v1/api-keys`

List API keys for a ledger.

**Auth:** Admin

**Query parameters:**

| Parameter  | Type   | Required | Description                   |
|------------|--------|----------|-------------------------------|
| `ledgerId` | string | Yes      | UUID of the ledger to list for |

**Response:** `200 OK` — Array of API key metadata (prefix, name, creation date). Keys are never returned.

---

#### `DELETE /v1/api-keys/:keyId`

Revoke an API key.

**Auth:** Admin

**Response:** `204 No Content`

---

### Bank Feeds

#### `POST /v1/ledgers/:ledgerId/bank-feeds/connect`

Initiate a bank feed connection.

**Auth:** API Key

**Request body:**

| Field             | Type   | Required | Description                          |
|-------------------|--------|----------|--------------------------------------|
| `institutionId`   | string | Yes      | Bank institution identifier          |
| `redirectUrl`     | string | Yes      | URL to redirect after auth           |
| `institutionName` | string | No       | Display name of the institution      |

**Response:** `200 OK` — Returns connection link/token for bank authorization.

---

#### `GET /v1/ledgers/:ledgerId/bank-feeds/connections`

List all bank feed connections for a ledger.

**Auth:** API Key

**Response:** `200 OK` — Array of bank feed connections.

---

#### `GET /v1/ledgers/:ledgerId/bank-feeds/connections/:connectionId`

Get a specific bank feed connection.

**Auth:** API Key

**Response:** `200 OK` — Returns the connection object.

---

#### `DELETE /v1/ledgers/:ledgerId/bank-feeds/connections/:connectionId`

Disconnect a bank feed.

**Auth:** API Key

**Response:** `204 No Content`

---

#### `GET /v1/ledgers/:ledgerId/bank-feeds/connections/:connectionId/accounts`

List bank accounts for a connection.

**Auth:** API Key

**Response:** `200 OK` — Array of bank accounts from the connected institution.

---

#### `POST /v1/ledgers/:ledgerId/bank-feeds/accounts/:bankAccountId/map`

Map a bank account to a ledger account.

**Auth:** API Key

**Request body:**

| Field       | Type   | Required | Description                          |
|-------------|--------|----------|--------------------------------------|
| `accountId` | string | Yes      | UUID of the ledger account to map to |

**Response:** `200 OK`

---

#### `POST /v1/ledgers/:ledgerId/bank-feeds/accounts/:bankAccountId/sync`

Trigger a sync for a bank account.

**Auth:** API Key

**Request body:**

| Field      | Type   | Required | Description                    |
|------------|--------|----------|--------------------------------|
| `fromDate` | string | No       | Start date for sync (ISO 8601) |
| `toDate`   | string | No       | End date for sync (ISO 8601)   |

**Response:** `200 OK` — Returns sync results with transaction counts.

---

#### `GET /v1/ledgers/:ledgerId/bank-feeds/sync-log`

Get sync history log.

**Auth:** API Key

**Query parameters:**

| Parameter      | Type   | Required | Description                     |
|----------------|--------|----------|---------------------------------|
| `connectionId` | string | No       | Filter by connection ID         |

**Response:** `200 OK` — Array of sync log entries.

---

#### `GET /v1/ledgers/:ledgerId/bank-feeds/transactions`

List bank feed transactions.

**Auth:** API Key

**Query parameters:**

| Parameter       | Type    | Required | Description                              |
|-----------------|---------|----------|------------------------------------------|
| `bankAccountId` | string  | No       | Filter by bank account                   |
| `status`        | string  | No       | Filter by status                         |
| `isPersonal`    | boolean | No       | Filter personal transactions             |
| `limit`         | number  | No       | Items per page                           |

**Response:** `200 OK` — Array of bank transactions with classification status.

---

#### `POST /v1/ledgers/:ledgerId/bank-feeds/transactions/:bankTransactionId/confirm`

Confirm a bank transaction match or create a new ledger transaction.

**Auth:** API Key

**Request body:**

| Field                    | Type   | Required | Description                                    |
|--------------------------|--------|----------|------------------------------------------------|
| `action`                 | string | Yes      | Action to take (e.g., confirm, create, skip)   |
| `overrideTransactionId`  | string | No       | Override the matched transaction ID            |

**Response:** `200 OK`

---

#### `POST /v1/ledgers/:ledgerId/bank-feeds/transactions/:bankTransactionId/mark-personal`

Mark a bank transaction as personal (exclude from bookkeeping).

**Auth:** API Key

**Response:** `200 OK`

---

### Classification

#### `GET /v1/ledgers/:ledgerId/classification/rules`

List classification rules.

**Auth:** API Key

**Query parameters:**

| Parameter       | Type    | Required | Description                         |
|-----------------|---------|----------|-------------------------------------|
| `ruleType`      | string  | No       | Filter by rule type                 |
| `field`         | string  | No       | Filter by field                     |
| `autoGenerated` | boolean | No       | Filter auto-generated rules         |
| `limit`         | number  | No       | Items per page                      |
| `offset`        | number  | No       | Offset for pagination               |

**Response:** `200 OK` — Array of classification rules.

---

#### `POST /v1/ledgers/:ledgerId/classification/rules`

Create a new classification rule.

**Auth:** API Key

**Request body:**

| Field             | Type    | Required | Description                               |
|-------------------|---------|----------|-------------------------------------------|
| `ruleType`        | string  | Yes      | Type of rule                              |
| `field`           | string  | Yes      | Field to match against                    |
| `pattern`         | string  | Yes      | Match pattern                             |
| `targetAccountId` | string  | Yes      | UUID of account to classify to            |
| `priority`        | number  | No       | Rule priority (higher = first)            |
| `isPersonal`      | boolean | No       | Whether to mark as personal               |
| `confidence`      | number  | No       | Confidence score (0-1)                    |

**Response:** `201 Created` — Returns the created rule.

---

#### `GET /v1/ledgers/:ledgerId/classification/rules/:ruleId`

Get a specific classification rule.

**Auth:** API Key

**Response:** `200 OK`

---

#### `PUT /v1/ledgers/:ledgerId/classification/rules/:ruleId`

Update a classification rule.

**Auth:** API Key

**Request body:**

| Field             | Type    | Required | Description                               |
|-------------------|---------|----------|-------------------------------------------|
| `priority`        | number  | No       | Updated priority                          |
| `pattern`         | string  | No       | Updated match pattern                     |
| `targetAccountId` | string  | No       | Updated target account                    |
| `isPersonal`      | boolean | No       | Updated personal flag                     |
| `confidence`      | number  | No       | Updated confidence score                  |

**Response:** `200 OK` — Returns the updated rule.

---

#### `DELETE /v1/ledgers/:ledgerId/classification/rules/:ruleId`

Delete a classification rule.

**Auth:** API Key

**Response:** `204 No Content`

---

#### `POST /v1/ledgers/:ledgerId/classification/classify`

Classify a transaction description against existing rules.

**Auth:** API Key

**Request body:**

| Field         | Type    | Required | Description                          |
|---------------|---------|----------|--------------------------------------|
| `description` | string  | Yes      | Transaction description to classify  |
| `category`    | string  | No       | Category hint                        |
| `amount`      | integer | No       | Amount for classification context    |

**Response:** `200 OK` — Returns matched rule and target account.

---

#### `POST /v1/ledgers/:ledgerId/classification/bank-transactions/:bankTransactionId`

Classify a specific bank transaction.

**Auth:** API Key

**Request body:**

| Field        | Type    | Required | Description                          |
|--------------|---------|----------|--------------------------------------|
| `accountId`  | string  | Yes      | UUID of the target account           |
| `isPersonal` | boolean | No       | Whether to mark as personal          |

**Response:** `200 OK`

---

#### `GET /v1/ledgers/:ledgerId/classification/aliases`

List merchant/payee name aliases.

**Auth:** API Key

**Response:** `200 OK` — Array of aliases with canonical names.

---

#### `POST /v1/ledgers/:ledgerId/classification/aliases`

Create a merchant/payee name alias.

**Auth:** API Key

**Request body:**

| Field           | Type   | Required | Description                          |
|-----------------|--------|----------|--------------------------------------|
| `canonicalName` | string | Yes      | The canonical merchant name          |
| `alias`         | string | Yes      | The alias to map to the canonical    |

**Response:** `201 Created`

---

### Notifications

#### `GET /v1/ledgers/:ledgerId/notifications`

List notifications for a ledger.

**Auth:** API Key

**Query parameters:**

| Parameter | Type   | Required | Description                      |
|-----------|--------|----------|----------------------------------|
| `status`  | string | No       | Filter by status                 |
| `type`    | string | No       | Filter by notification type      |
| `limit`   | number | No       | Items per page                   |
| `cursor`  | string | No       | Pagination cursor                |

**Response:** `200 OK` — Paginated array of notifications.

---

#### `POST /v1/ledgers/:ledgerId/notifications/generate`

Generate notifications based on current ledger state (e.g., anomalies, reminders).

**Auth:** API Key

**Response:** `200 OK` — Returns generated notifications.

---

#### `GET /v1/ledgers/:ledgerId/notifications/preferences`

Get notification preferences for the ledger.

**Auth:** API Key

**Response:** `200 OK` — Returns preference settings by notification type.

---

#### `PUT /v1/ledgers/:ledgerId/notifications/preferences/:type`

Update a notification preference.

**Auth:** API Key

**Request body:**

| Field     | Type    | Required | Description                      |
|-----------|---------|----------|----------------------------------|
| `enabled` | boolean | Yes      | Whether this notification is on  |

**Response:** `200 OK`

---

#### `GET /v1/ledgers/:ledgerId/notifications/:notificationId`

Get a specific notification.

**Auth:** API Key

**Response:** `200 OK`

---

#### `PATCH /v1/ledgers/:ledgerId/notifications/:notificationId`

Update a notification (e.g., mark as read).

**Auth:** API Key

**Request body:**

| Field    | Type   | Required | Description                              |
|----------|--------|----------|------------------------------------------|
| `status` | string | Yes      | New status (e.g., `read`, `dismissed`)   |

**Response:** `200 OK`

---

### Currencies

#### `GET /v1/ledgers/:ledgerId/currencies`

List currencies enabled for a ledger.

**Auth:** API Key

**Response:** `200 OK` — Array of currency objects.

---

#### `POST /v1/ledgers/:ledgerId/currencies`

Add a currency to the ledger.

**Auth:** API Key

**Request body:**

| Field           | Type    | Required | Description                          |
|-----------------|---------|----------|--------------------------------------|
| `currencyCode`  | string  | Yes      | ISO 4217 currency code               |
| `decimalPlaces` | number  | No       | Number of decimal places (default 2) |
| `symbol`        | string  | No       | Currency symbol                      |

**Response:** `201 Created`

---

#### `GET /v1/ledgers/:ledgerId/currencies/exchange-rates`

List exchange rates.

**Auth:** API Key

**Query parameters:**

| Parameter      | Type   | Required | Description                     |
|----------------|--------|----------|---------------------------------|
| `fromCurrency` | string | No       | Filter by source currency       |
| `toCurrency`   | string | No       | Filter by target currency       |
| `limit`        | number | No       | Items per page                  |
| `cursor`       | string | No       | Pagination cursor               |

**Response:** `200 OK` — Paginated array of exchange rates.

---

#### `POST /v1/ledgers/:ledgerId/currencies/exchange-rates`

Create an exchange rate entry.

**Auth:** API Key

**Request body:**

| Field           | Type   | Required | Description                           |
|-----------------|--------|----------|---------------------------------------|
| `fromCurrency`  | string | Yes      | Source currency code                  |
| `toCurrency`    | string | Yes      | Target currency code                  |
| `rate`          | number | Yes      | Exchange rate                         |
| `effectiveDate` | string | Yes      | Date the rate is effective (ISO 8601) |
| `source`        | string | No       | Source of the rate (e.g., manual)     |

**Response:** `201 Created`

---

#### `GET /v1/ledgers/:ledgerId/currencies/exchange-rates/convert`

Convert an amount between currencies.

**Auth:** API Key

**Query parameters:**

| Parameter      | Type    | Required | Description                          |
|----------------|---------|----------|--------------------------------------|
| `fromCurrency` | string  | Yes      | Source currency code                 |
| `toCurrency`   | string  | Yes      | Target currency code                 |
| `amount`       | integer | Yes      | Amount in smallest unit to convert   |
| `date`         | string  | No       | Date for historical rate (ISO 8601)  |

**Response:** `200 OK` — Returns converted amount and rate used.

---

#### `POST /v1/ledgers/:ledgerId/currencies/revalue`

Revalue foreign currency balances and generate gain/loss entries.

**Auth:** API Key

**Request body:**

| Field  | Type   | Required | Description                 |
|--------|--------|----------|-----------------------------|
| `date` | string | Yes      | Revaluation date (ISO 8601) |

**Response:** `200 OK` — Returns revaluation results and any generated transactions.

---

### Conversations

#### `GET /v1/ledgers/:ledgerId/conversations`

List conversations for a ledger.

**Auth:** API Key

**Query parameters:**

| Parameter | Type   | Default | Description              |
|-----------|--------|---------|--------------------------|
| `cursor`  | string | —       | Pagination cursor        |
| `limit`   | number | 50      | Items per page (max 200) |

**Response:** `200 OK` — Paginated array of conversations.

---

#### `POST /v1/ledgers/:ledgerId/conversations`

Create a new conversation.

**Auth:** API Key

**Request body:**

| Field   | Type   | Required | Description        |
|---------|--------|----------|--------------------|
| `title` | string | No       | Conversation title |

**Response:** `201 Created`

---

#### `GET /v1/ledgers/:ledgerId/conversations/:id`

Get a conversation by ID with its messages.

**Auth:** API Key

**Response:** `200 OK`

---

#### `PUT /v1/ledgers/:ledgerId/conversations/:id`

Update a conversation (add messages, change title).

**Auth:** API Key

**Request body:**

| Field      | Type   | Required | Description            |
|------------|--------|----------|------------------------|
| `messages` | array  | No       | Updated messages array |
| `title`    | string | No       | Updated title          |

**Response:** `200 OK`

---

#### `DELETE /v1/ledgers/:ledgerId/conversations/:id`

Delete a conversation.

**Auth:** API Key

**Response:** `204 No Content`

---

### Attachments

#### `POST /v1/ledgers/:ledgerId/transactions/:transactionId/attachments`

Upload a file attachment to a transaction. Uses multipart form data.

**Auth:** API Key

**Request:** Multipart form with a `file` field.

**Response:** `201 Created` — Returns the attachment metadata.

---

#### `GET /v1/ledgers/:ledgerId/transactions/:transactionId/attachments`

List attachments for a transaction.

**Auth:** API Key

**Response:** `200 OK` — Array of attachment metadata.

---

#### `GET /v1/attachments/:id/download`

Download an attachment file.

**Auth:** API Key

**Response:** Binary file with appropriate Content-Type header.

---

#### `DELETE /v1/attachments/:id`

Delete an attachment.

**Auth:** API Key

**Response:** `204 No Content`

---

### Recurring Entries

#### `GET /v1/ledgers/:ledgerId/recurring`

List recurring entry templates.

**Auth:** API Key

**Response:** `200 OK` — Array of recurring entry definitions.

---

#### `POST /v1/ledgers/:ledgerId/recurring`

Create a recurring entry template.

**Auth:** API Key

**Request body:**

| Field          | Type    | Required | Description                                       |
|----------------|---------|----------|---------------------------------------------------|
| `description`  | string  | Yes      | Description for generated transactions            |
| `lineItems`    | array   | Yes      | Line items template (same format as transactions) |
| `frequency`    | string  | Yes      | Recurrence frequency (e.g., `monthly`, `weekly`)  |
| `dayOfMonth`   | number  | No       | Day of month for monthly entries (1-31)           |
| `nextRunDate`  | string  | Yes      | Next scheduled run date (ISO 8601)                |
| `autoReverse`  | boolean | No       | Whether to auto-reverse on next period            |

**Response:** `201 Created`

---

#### `GET /v1/ledgers/:ledgerId/recurring/:id`

Get a specific recurring entry.

**Auth:** API Key

**Response:** `200 OK`

---

#### `PUT /v1/ledgers/:ledgerId/recurring/:id`

Update a recurring entry.

**Auth:** API Key

**Request body:** Accepts partial updates to any of the creation fields.

**Response:** `200 OK`

---

#### `DELETE /v1/ledgers/:ledgerId/recurring/:id`

Delete a recurring entry template.

**Auth:** API Key

**Response:** `204 No Content`

---

#### `POST /v1/ledgers/:ledgerId/recurring/:id/pause`

Pause a recurring entry.

**Auth:** API Key

**Response:** `200 OK`

---

#### `POST /v1/ledgers/:ledgerId/recurring/:id/resume`

Resume a paused recurring entry.

**Auth:** API Key

**Response:** `200 OK`

---

#### `POST /v1/recurring/process`

Trigger processing of all due recurring entries across all ledgers.

**Auth:** Admin

**Response:** `200 OK` — Returns count of processed entries and any errors.

---

### Periods

#### `POST /v1/ledgers/:ledgerId/periods/close`

Close an accounting period. Prevents new transactions from being posted to dates within the closed period.

**Auth:** API Key

**Request body:**

| Field       | Type   | Required | Description                                |
|-------------|--------|----------|--------------------------------------------|
| `periodEnd` | string | Yes      | End date of the period to close (ISO 8601) |

**Response:** `200 OK`

---

#### `POST /v1/ledgers/:ledgerId/periods/reopen`

Reopen a previously closed accounting period.

**Auth:** API Key

**Request body:**

| Field       | Type   | Required | Description                                  |
|-------------|--------|----------|----------------------------------------------|
| `periodEnd` | string | Yes      | End date of the period to reopen (ISO 8601)  |

**Response:** `200 OK`

---

#### `GET /v1/ledgers/:ledgerId/periods/closed`

List all closed periods for a ledger.

**Auth:** API Key

**Response:** `200 OK` — Array of closed period records.

---

### Stripe Connect

#### `POST /v1/stripe-connect/webhook`

Webhook endpoint for Stripe Connect events. Verified via Stripe signature.

**Auth:** None (Stripe signature verification)

**Response:** `200 OK`

---

#### `GET /v1/stripe-connect/authorize`

Get the Stripe Connect OAuth authorization URL.

**Auth:** API Key

**Response:** `200 OK` — Returns the OAuth URL to redirect the user to.

---

#### `GET /v1/stripe-connect/callback`

OAuth callback from Stripe. Handles the authorization code exchange.

**Auth:** None (redirects to dashboard)

**Response:** `302 Redirect` — Redirects to dashboard with connection status.

---

#### `GET /v1/stripe-connect/status`

Get the current Stripe Connect connection status.

**Auth:** API Key

**Response:** `200 OK` — Returns connection status and account info.

---

#### `POST /v1/stripe-connect/disconnect`

Disconnect the Stripe Connect integration.

**Auth:** API Key

**Response:** `200 OK`

---

#### `POST /v1/stripe-connect/sync`

Trigger a manual sync of Stripe transactions.

**Auth:** API Key

**Response:** `200 OK` — Returns sync results.

---

### Billing

#### `POST /v1/billing/webhook`

Webhook endpoint for Stripe billing events. Verified via Stripe signature.

**Auth:** None (Stripe signature verification)

**Response:** `200 OK`

---

#### `POST /v1/billing/checkout`

Create a Stripe Checkout session for subscription.

**Auth:** API Key

**Request body:**

| Field      | Type   | Required | Description                  |
|------------|--------|----------|------------------------------|
| `price_id` | string | Yes      | Stripe Price ID to subscribe |

**Response:** `200 OK` — Returns the Checkout session URL.

---

#### `POST /v1/billing/portal`

Create a Stripe Customer Portal session for managing subscription.

**Auth:** API Key

**Response:** `200 OK` — Returns the portal URL.

---

#### `GET /v1/billing/status`

Get the current billing/subscription status.

**Auth:** API Key

**Response:** `200 OK` — Returns subscription status, plan, and usage.

---

### Email

#### `GET /v1/email/preferences`

Get email preferences for the current user.

**Auth:** API Key

**Response:** `200 OK` — Returns email preference settings.

---

#### `PUT /v1/email/preferences`

Update email preferences.

**Auth:** API Key

**Request body:**

| Field          | Type    | Required | Description                              |
|----------------|---------|----------|------------------------------------------|
| `weeklyDigest` | boolean | No       | Enable weekly digest emails              |
| `monthlyClose` | boolean | No       | Enable monthly close reminders           |
| `urgentAlerts` | boolean | No       | Enable urgent alert emails               |
| `quarterlyTax` | boolean | No       | Enable quarterly tax reminders           |
| `timezone`     | string  | No       | User timezone (e.g., America/New_York)   |
| `digestDay`    | string  | No       | Day of week for digest (e.g., monday)    |

**Response:** `200 OK`

---

#### `POST /v1/email/send-digest`

Trigger sending of digest emails.

**Auth:** Admin

**Response:** `200 OK`

---

#### `POST /v1/email/verify-token`

Verify an email unsubscribe/preference token.

**Auth:** Admin

**Request body:**

| Field   | Type   | Required | Description        |
|---------|--------|----------|--------------------|
| `token` | string | Yes      | Verification token |

**Response:** `200 OK`

---

### Onboarding

#### `GET /v1/onboarding/state`

Get the current onboarding state.

**Auth:** API Key

**Response:** `200 OK` — Returns current onboarding step and status.

---

#### `POST /v1/onboarding/state`

Create initial onboarding state.

**Auth:** API Key

**Response:** `201 Created`

---

#### `PUT /v1/onboarding/state`

Update onboarding state (advance steps, save answers).

**Auth:** API Key

**Response:** `200 OK`

---

#### `POST /v1/onboarding/setup`

Execute the onboarding setup (provision ledger, apply template, etc.).

**Auth:** API Key

**Response:** `200 OK` — Returns the provisioned ledger and accounts.

---

#### `GET /v1/onboarding/checklist`

Get the onboarding checklist status.

**Auth:** API Key

**Response:** `200 OK` — Returns checklist items and completion status.

---

#### `POST /v1/onboarding/checklist/init`

Initialize the onboarding checklist for a ledger.

**Auth:** API Key

**Response:** `201 Created`

---

#### `POST /v1/onboarding/checklist/:item/complete`

Mark a checklist item as complete.

**Auth:** API Key

**Response:** `200 OK`

---

#### `POST /v1/onboarding/checklist/dismiss`

Dismiss the onboarding checklist.

**Auth:** API Key

**Response:** `200 OK`

---

#### `GET /v1/onboarding/classification-stats`

Get classification statistics for onboarding progress.

**Auth:** API Key

**Response:** `200 OK` — Returns classification coverage and accuracy stats.

---

#### `POST /v1/onboarding/auto-account`

Auto-create a ledger account based on bank account info.

**Auth:** API Key

**Request body:**

| Field             | Type   | Required | Description                           |
|-------------------|--------|----------|---------------------------------------|
| `bankAccountName` | string | Yes      | Name of the bank account              |
| `bankAccountType` | string | Yes      | Type of bank account (e.g., checking) |

**Response:** `201 Created` — Returns the created account.

---

### Admin

#### `POST /v1/admin/provision`

Provision a new user with a ledger in one step.

**Auth:** Admin

**Request body:**

| Field              | Type   | Required | Description                             |
|--------------------|--------|----------|-----------------------------------------|
| `email`            | string | Yes      | User email address                      |
| `name`             | string | Yes      | User display name                       |
| `authProvider`     | string | Yes      | OAuth provider (`github` or `google`)   |
| `authProviderId`   | string | Yes      | Provider user ID                        |
| `templateSlug`     | string | No       | Template to apply to the new ledger     |

**Response:** `201 Created` — Returns the created user, ledger, and API key.

---

## Quick Reference

| Method | Path | Auth |
|--------|------|------|
| GET | `/v1/health` | None |
| POST | `/v1/ledgers` | Admin |
| GET | `/v1/ledgers/:ledgerId` | API Key |
| PATCH | `/v1/ledgers/:ledgerId` | API Key |
| POST | `/v1/ledgers/:ledgerId/accounts` | API Key |
| GET | `/v1/ledgers/:ledgerId/accounts` | API Key |
| GET | `/v1/ledgers/:ledgerId/accounts/:accountId` | API Key |
| POST | `/v1/ledgers/:ledgerId/transactions` | API Key |
| GET | `/v1/ledgers/:ledgerId/transactions` | API Key |
| GET | `/v1/ledgers/:ledgerId/transactions/:transactionId` | API Key |
| POST | `/v1/ledgers/:ledgerId/transactions/:transactionId/reverse` | API Key |
| GET | `/v1/ledgers/:ledgerId/reports/income-statement` | API Key |
| GET | `/v1/ledgers/:ledgerId/reports/balance-sheet` | API Key |
| GET | `/v1/ledgers/:ledgerId/reports/cash-flow` | API Key |
| GET | `/v1/ledgers/:ledgerId/audit` | API Key |
| GET | `/v1/templates` | None |
| GET | `/v1/templates/:idOrSlug` | None |
| POST | `/v1/templates/recommend` | None |
| POST | `/v1/templates/apply` | Admin |
| POST | `/v1/ledgers/:ledgerId/imports` | API Key |
| GET | `/v1/ledgers/:ledgerId/imports` | API Key |
| GET | `/v1/imports/:batchId` | API Key |
| POST | `/v1/imports/:batchId/confirm` | API Key |
| POST | `/v1/api-keys` | Admin |
| GET | `/v1/api-keys` | Admin |
| DELETE | `/v1/api-keys/:keyId` | Admin |
| POST | `/v1/ledgers/:ledgerId/bank-feeds/connect` | API Key |
| GET | `/v1/ledgers/:ledgerId/bank-feeds/connections` | API Key |
| GET | `/v1/ledgers/:ledgerId/bank-feeds/connections/:connectionId` | API Key |
| DELETE | `/v1/ledgers/:ledgerId/bank-feeds/connections/:connectionId` | API Key |
| GET | `/v1/ledgers/:ledgerId/bank-feeds/connections/:connectionId/accounts` | API Key |
| POST | `/v1/ledgers/:ledgerId/bank-feeds/accounts/:bankAccountId/map` | API Key |
| POST | `/v1/ledgers/:ledgerId/bank-feeds/accounts/:bankAccountId/sync` | API Key |
| GET | `/v1/ledgers/:ledgerId/bank-feeds/sync-log` | API Key |
| GET | `/v1/ledgers/:ledgerId/bank-feeds/transactions` | API Key |
| POST | `/v1/ledgers/:ledgerId/bank-feeds/transactions/:bankTransactionId/confirm` | API Key |
| POST | `/v1/ledgers/:ledgerId/bank-feeds/transactions/:bankTransactionId/mark-personal` | API Key |
| GET | `/v1/ledgers/:ledgerId/classification/rules` | API Key |
| POST | `/v1/ledgers/:ledgerId/classification/rules` | API Key |
| GET | `/v1/ledgers/:ledgerId/classification/rules/:ruleId` | API Key |
| PUT | `/v1/ledgers/:ledgerId/classification/rules/:ruleId` | API Key |
| DELETE | `/v1/ledgers/:ledgerId/classification/rules/:ruleId` | API Key |
| POST | `/v1/ledgers/:ledgerId/classification/classify` | API Key |
| POST | `/v1/ledgers/:ledgerId/classification/bank-transactions/:bankTransactionId` | API Key |
| GET | `/v1/ledgers/:ledgerId/classification/aliases` | API Key |
| POST | `/v1/ledgers/:ledgerId/classification/aliases` | API Key |
| GET | `/v1/ledgers/:ledgerId/notifications` | API Key |
| POST | `/v1/ledgers/:ledgerId/notifications/generate` | API Key |
| GET | `/v1/ledgers/:ledgerId/notifications/preferences` | API Key |
| PUT | `/v1/ledgers/:ledgerId/notifications/preferences/:type` | API Key |
| GET | `/v1/ledgers/:ledgerId/notifications/:notificationId` | API Key |
| PATCH | `/v1/ledgers/:ledgerId/notifications/:notificationId` | API Key |
| GET | `/v1/ledgers/:ledgerId/currencies` | API Key |
| POST | `/v1/ledgers/:ledgerId/currencies` | API Key |
| GET | `/v1/ledgers/:ledgerId/currencies/exchange-rates` | API Key |
| POST | `/v1/ledgers/:ledgerId/currencies/exchange-rates` | API Key |
| GET | `/v1/ledgers/:ledgerId/currencies/exchange-rates/convert` | API Key |
| POST | `/v1/ledgers/:ledgerId/currencies/revalue` | API Key |
| GET | `/v1/ledgers/:ledgerId/conversations` | API Key |
| POST | `/v1/ledgers/:ledgerId/conversations` | API Key |
| GET | `/v1/ledgers/:ledgerId/conversations/:id` | API Key |
| PUT | `/v1/ledgers/:ledgerId/conversations/:id` | API Key |
| DELETE | `/v1/ledgers/:ledgerId/conversations/:id` | API Key |
| POST | `/v1/ledgers/:ledgerId/transactions/:transactionId/attachments` | API Key |
| GET | `/v1/ledgers/:ledgerId/transactions/:transactionId/attachments` | API Key |
| GET | `/v1/attachments/:id/download` | API Key |
| DELETE | `/v1/attachments/:id` | API Key |
| GET | `/v1/ledgers/:ledgerId/recurring` | API Key |
| POST | `/v1/ledgers/:ledgerId/recurring` | API Key |
| GET | `/v1/ledgers/:ledgerId/recurring/:id` | API Key |
| PUT | `/v1/ledgers/:ledgerId/recurring/:id` | API Key |
| DELETE | `/v1/ledgers/:ledgerId/recurring/:id` | API Key |
| POST | `/v1/ledgers/:ledgerId/recurring/:id/pause` | API Key |
| POST | `/v1/ledgers/:ledgerId/recurring/:id/resume` | API Key |
| POST | `/v1/recurring/process` | Admin |
| POST | `/v1/ledgers/:ledgerId/periods/close` | API Key |
| POST | `/v1/ledgers/:ledgerId/periods/reopen` | API Key |
| GET | `/v1/ledgers/:ledgerId/periods/closed` | API Key |
| POST | `/v1/stripe-connect/webhook` | None |
| GET | `/v1/stripe-connect/authorize` | API Key |
| GET | `/v1/stripe-connect/callback` | None |
| GET | `/v1/stripe-connect/status` | API Key |
| POST | `/v1/stripe-connect/disconnect` | API Key |
| POST | `/v1/stripe-connect/sync` | API Key |
| POST | `/v1/billing/webhook` | None |
| POST | `/v1/billing/checkout` | API Key |
| POST | `/v1/billing/portal` | API Key |
| GET | `/v1/billing/status` | API Key |
| GET | `/v1/email/preferences` | API Key |
| PUT | `/v1/email/preferences` | API Key |
| POST | `/v1/email/send-digest` | Admin |
| POST | `/v1/email/verify-token` | Admin |
| GET | `/v1/onboarding/state` | API Key |
| POST | `/v1/onboarding/state` | API Key |
| PUT | `/v1/onboarding/state` | API Key |
| POST | `/v1/onboarding/setup` | API Key |
| GET | `/v1/onboarding/checklist` | API Key |
| POST | `/v1/onboarding/checklist/init` | API Key |
| POST | `/v1/onboarding/checklist/:item/complete` | API Key |
| POST | `/v1/onboarding/checklist/dismiss` | API Key |
| GET | `/v1/onboarding/classification-stats` | API Key |
| POST | `/v1/onboarding/auto-account` | API Key |
| POST | `/v1/admin/provision` | Admin |

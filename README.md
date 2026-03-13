# Ledge

**Accounting infrastructure for builders.** A programmable double-entry ledger and reporting engine, embeddable via API, SDK, and MCP.

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![Hono](https://img.shields.io/badge/API-Hono-orange)](https://hono.dev/)
[![License](https://img.shields.io/badge/License-Proprietary-red)](#license)

## Key Numbers

| | |
|---|---|
| **39** MCP tools | AI-powered accounting |
| **17** SDK modules | Full TypeScript client |
| **80+** REST API endpoints | Complete programmatic access |
| **8** business templates | SaaS, marketplace, agency, ecommerce, creator, consulting, property, nonprofit |
| **3** financial statements | P&L, balance sheet, cash flow |

## Features

- **Double-entry accounting engine** with database-level balance constraint
- **Immutable transactions** — reversals create new entries, nothing is ever deleted
- **8 pre-built chart-of-accounts templates** for common business types
- **CSV and OFX import** with automatic reconciliation
- **Bank feed integration** via Basiq
- **Stripe Connect** for automatic transaction sync
- **AI-powered transaction classification**
- **Recurring journal entries**
- **Multi-currency support** with exchange rates
- **Period close/reopen**
- **File attachments** on transactions
- **Smart notifications and insights**
- **Full audit trail** — every mutation is logged with actor, action, and entity snapshot
- **Cursor-based pagination** on all list endpoints
- **Idempotent transaction posting** via idempotency keys

## Architecture

Monorepo powered by Turborepo:

```
packages/
  core/       # @ledge/core — Double-entry engine, domain logic
  api/        # @ledge/api — REST API (Hono, 80+ endpoints)
  mcp/        # @ledge/mcp — MCP server (39 tools)
  sdk/        # @ledge/sdk — TypeScript client SDK (17 modules)
  dashboard/  # @ledge/dashboard — Next.js dashboard
```

## Tech Stack

- **TypeScript** (strict mode)
- **PostgreSQL** (production) / **SQLite** (self-hosted)
- **Hono** — API framework
- **Zod** — validation (shared across API, SDK, and MCP)
- **Next.js** — dashboard
- **Turborepo** — monorepo orchestration

## Quick Start

### Use the hosted API

```typescript
import { Ledge } from "@ledge/sdk";

const ledge = new Ledge({
  apiKey: "ledge_live_...",
  baseUrl: "https://api.useledge.ai",
});

// Create accounts
await ledge.accounts.create(ledgerId, {
  code: "1000", name: "Cash", type: "asset",
});

// Post a transaction
await ledge.transactions.post(ledgerId, {
  date: "2026-03-14",
  memo: "Monthly subscription",
  lines: [
    { accountCode: "1000", amount: 4999, direction: "debit" },
    { accountCode: "4000", amount: 4999, direction: "credit" },
  ],
});

// Generate financial statements
const pnl = await ledge.reports.incomeStatement(ledgerId, "2026-01-01", "2026-03-31");
```

### Connect AI assistant via MCP

```json
{
  "mcpServers": {
    "ledge": {
      "url": "https://mcp.useledge.ai/sse?key=YOUR_API_KEY"
    }
  }
}
```

### Self-host with Docker

```bash
docker run -p 3001:3001 getledge/ledge
```

## Development

```bash
pnpm install          # install dependencies
pnpm dev              # start all packages in dev mode
pnpm build            # build all packages
pnpm test             # run tests across all packages
pnpm lint             # lint all packages
pnpm typecheck        # type-check all packages
```

## Documentation

- [API Reference](docs/api-reference.md)
- [SDK Guide](docs/sdk-guide.md)
- [MCP Guide](docs/mcp-guide.md)
- [Template Reference](docs/template-reference.md)

## Core Invariants

- Debits always equal credits (enforced at the database level)
- Transactions are immutable (reversals create new entries)
- Amounts are integers in the smallest currency unit (e.g., cents)
- All IDs are UUID v7
- All timestamps are UTC ISO 8601
- API keys stored as SHA-256 hashes (shown once at creation)

## License

Proprietary. All rights reserved.

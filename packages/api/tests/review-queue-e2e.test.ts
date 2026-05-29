// ---------------------------------------------------------------------------
// E2E: the held-candidate review/resolve path through the REAL HTTP stack
// (Hono app → apiKeyAuth → routes → core), on the PRODUCTION migration schema.
// Proves the wiring end to end — not a stubbed component.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteDatabase, LedgerEngine, MockPlaidProvider, MOCK_ACCOUNT_ID } from "@kounta/core";
import type { Database } from "@kounta/core";
import { createApp } from "../src/app.js";
import { SQLITE_MIGRATION_FILES } from "../src/migrations.js";
import type { Hono } from "hono";
import type { Env } from "../src/lib/context.js";

const migDir = resolve(__dirname, "../../core/src/db/migrations");
const buildFromProd = async (): Promise<Database> => {
  const db = await SqliteDatabase.create();
  for (const f of SQLITE_MIGRATION_FILES) {
    const p = resolve(migDir, f);
    if (existsSync(p)) db.exec(readFileSync(p, "utf-8").split("\n").filter((l) => !l.trim().toUpperCase().startsWith("PRAGMA")).join("\n"));
  }
  return db;
};

const MAP = { hasHeader: true, dateColumn: 0, dateFormat: "DD/MM/YYYY", descriptionColumn: 1, amountMode: "signed", amountColumn: 2, signConvention: "negative_is_outflow" };

describe("review-queue E2E over the real API (production schema)", () => {
  let db: Database; let engine: LedgerEngine; let app: Hono<Env>;
  let ledgerId: string; let accountId: string; let apiKey: string;

  beforeEach(async () => {
    db = await buildFromProd();
    engine = new LedgerEngine(db);
    app = createApp(engine);
    db.run(`INSERT INTO users (id,email,name,auth_provider,auth_provider_id,plan) VALUES (?,?,?,?,?,?)`, ["u1", "u@e.com", "U", "test", "t1", "builder"]);
    const ledger = await engine.createLedger({ name: "Co", currency: "AUD", ownerId: "u1" });
    ledgerId = ledger.value!.id;
    accountId = (await engine.createAccount({ ledgerId, name: "Bank", code: "1000", type: "asset", normalBalance: "debit" })).value!.id;
    apiKey = (await engine.createApiKey({ userId: "u1", ledgerId, name: "k" })).value!.rawKey!;
    // Sync the mock feed (OFFICEWORKS 0123 @ 89.95 on 2026-04-04), mapped to the ledger account.
    const conn = await engine.createBankConnection({ ledgerId, provider: "mock", providerConnectionId: "mc", institutionId: "i", institutionName: "M" });
    const ba = await engine.upsertBankAccount({ connectionId: conn.value!.id, ledgerId, providerAccountId: MOCK_ACCOUNT_ID, name: "P", accountNumber: "1", bsb: null, type: "transaction", currency: "AUD", currentBalance: 0, availableBalance: null });
    await engine.mapBankAccountToLedgerAccount(ba.value!.id, accountId);
    await engine.syncBankAccount(new MockPlaidProvider({ nodeEnv: "test" }), conn.value!.id, ba.value!.id, "2026-04-01", "2026-04-30");
  });

  const req = (method: string, path: string, body?: unknown, key = apiKey) =>
    app.request(path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: body ? JSON.stringify(body) : undefined });

  it("commit holds a candidate → it appears in the review queue → resolve imports it", async () => {
    // A genuinely distinct purchase coinciding on date+amount with the feed row.
    const csv = "date,desc,amount\n04/04/2026,BUNNINGS WAREHOUSE,-89.95";
    const commit = await req("POST", `/v1/ledgers/${ledgerId}/imports/csv/commit`, { ledgerAccountId: accountId, fileContent: csv, mapping: MAP });
    expect(commit.status).toBe(201);
    expect((await commit.json()).data.possibleDuplicates).toBe(1);

    // The held candidate is in the review queue (persisted, not an ephemeral count).
    const list = await req("GET", `/v1/ledgers/${ledgerId}/review-items?status=open`);
    const items = (await list.json()).data;
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("possible_duplicate_import");

    // Resolve → import: stages it; queue empties.
    const resolved = await req("POST", `/v1/ledgers/${ledgerId}/review-items/${items[0].id}/resolve`, { action: "import" });
    expect(resolved.status).toBe(200);
    expect((await resolved.json()).data.resolution).toBe("imported");

    const afterList = await req("GET", `/v1/ledgers/${ledgerId}/review-items?status=open`);
    expect((await afterList.json()).data).toHaveLength(0);

    // The confirmed candidate is now staged exactly once.
    const bunnings = await db.all<{ n: number }>("SELECT COUNT(*) n FROM bank_transactions WHERE description='BUNNINGS WAREHOUSE'").then((r) => Number(r[0]!.n));
    expect(bunnings).toBe(1);
  });

  it("resolve → dismiss closes it without staging", async () => {
    await req("POST", `/v1/ledgers/${ledgerId}/imports/csv/commit`, { ledgerAccountId: accountId, fileContent: "date,desc,amount\n04/04/2026,BUNNINGS WAREHOUSE,-89.95", mapping: MAP });
    const items = (await (await req("GET", `/v1/ledgers/${ledgerId}/review-items?status=open`)).json()).data;
    const r = await req("POST", `/v1/ledgers/${ledgerId}/review-items/${items[0].id}/resolve`, { action: "dismiss" });
    expect((await r.json()).data.status).toBe("dismissed");
    const bunnings = await db.all<{ n: number }>("SELECT COUNT(*) n FROM bank_transactions WHERE description='BUNNINGS WAREHOUSE'").then((x) => Number(x[0]!.n));
    expect(bunnings).toBe(0);
  });

  it("auth: a key scoped to another ledger cannot read the review queue (403)", async () => {
    db.run(`INSERT INTO users (id,email,name,auth_provider,auth_provider_id,plan) VALUES (?,?,?,?,?,?)`, ["u2", "v@e.com", "V", "test", "t2", "builder"]);
    const other = await engine.createLedger({ name: "Other", currency: "AUD", ownerId: "u2" });
    const otherKey = (await engine.createApiKey({ userId: "u2", ledgerId: other.value!.id, name: "k2" })).value!.rawKey!;
    const res = await req("GET", `/v1/ledgers/${ledgerId}/review-items?status=open`, undefined, otherKey);
    expect(res.status).toBe(403);
  });
});

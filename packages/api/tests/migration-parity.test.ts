// ---------------------------------------------------------------------------
// B1 regression — the feature's schema must be reachable through the PRODUCTION
// migration runner, not a directory scan. We build a DB from the exact list the
// runner uses (SQLITE_MIGRATION_FILES from src/index.ts) and exercise the
// bank-feed upsert that this sprint made write `line_fingerprint`.
//
// Red against the unfixed branch: 031 is absent from the list, so upsert throws
// "no column named line_fingerprint" and mapping_profiles does not exist.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteDatabase, LedgerEngine } from "@kounta/core";
import type { Database } from "@kounta/core";
import { SQLITE_MIGRATION_FILES } from "../src/index.js";

const migDir = resolve(__dirname, "../../core/src/db/migrations");

const buildFromProductionList = async (): Promise<Database> => {
  const db = await SqliteDatabase.create();
  for (const file of SQLITE_MIGRATION_FILES) {
    const path = resolve(migDir, file);
    if (!existsSync(path)) continue;
    const sql = readFileSync(path, "utf-8")
      .split("\n").filter((l) => !l.trim().toUpperCase().startsWith("PRAGMA")).join("\n");
    db.exec(sql);
  }
  return db;
};

describe("B1: production migration runner applies the bank-ingestion schema", () => {
  it("bank-feed upsert succeeds on the production schema (line_fingerprint column exists)", async () => {
    const db = await buildFromProductionList();
    const engine = new LedgerEngine(db);
    await db.run(`INSERT INTO users (id,email,name,auth_provider,auth_provider_id) VALUES (?,?,?,?,?)`, ["u1", "u@e.com", "U", "test", "t1"]);
    const ledger = await engine.createLedger({ name: "Co", currency: "AUD", ownerId: "u1" });
    const conn = await engine.createBankConnection({ ledgerId: ledger.value!.id, provider: "basiq", providerConnectionId: "c", institutionId: "i", institutionName: "B" });
    const ba = await engine.upsertBankAccount({ connectionId: conn.value!.id, ledgerId: ledger.value!.id, providerAccountId: "pa", name: "P", accountNumber: "1", bsb: null, type: "transaction", currency: "AUD", currentBalance: 0, availableBalance: null });

    const res = await engine.upsertBankTransactions(ba.value!.id, ledger.value!.id, [{
      providerTransactionId: "t1", date: "2026-04-01", amount: 1000, type: "debit",
      description: "Test", reference: null, category: null, balance: null, rawData: {},
    }]);
    expect(res.ok).toBe(true);
    expect(res.value!.created).toBe(1);
  });

  it("mapping_profiles table exists on the production schema", async () => {
    const db = await buildFromProductionList();
    const t = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='mapping_profiles'");
    expect(t.length).toBe(1);
  });
});

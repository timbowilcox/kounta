// ---------------------------------------------------------------------------
// B2 regression — cross-channel dedup correctness (money correctness).
// Reproductions from EVALUATION.md. These assert the FIXED behaviour and are
// red against the over-collapsing / double-counting implementation.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { LedgerEngine } from "../src/index.js";
import type { Database } from "../src/index.js";
import type { CsvMapping } from "../src/import/csv-mapping.js";
import { MockPlaidProvider, MOCK_ACCOUNT_ID } from "../src/bank-feeds/index.js";
import { createFullTestDb } from "./helpers/migrate.js";

const MAP: CsvMapping = {
  hasHeader: true, dateColumn: 0, dateFormat: "DD/MM/YYYY", descriptionColumn: 1,
  amountMode: "signed", amountColumn: 2, signConvention: "negative_is_outflow",
} as CsvMapping;
const U = "00000000-0000-7000-8000-000000000001";

async function setup() {
  const db = await createFullTestDb();
  const engine = new LedgerEngine(db);
  await db.run(`INSERT INTO users (id,email,name,auth_provider,auth_provider_id) VALUES (?,?,?,?,?)`, [U, "t@e.com", "T", "test", "t1"]);
  const ledger = await engine.createLedger({ name: "Co", currency: "AUD", ownerId: U });
  const acct = await engine.createAccount({ ledgerId: ledger.value!.id, name: "Bank", code: "1000", type: "asset", normalBalance: "debit" });
  return { db, engine, ledgerId: ledger.value!.id, ledgerAccountId: acct.value!.id };
}

const countFor = (db: Database, ledgerAccountId: string, where = "", params: unknown[] = []) =>
  db.all<{ n: number }>(
    `SELECT COUNT(*) n FROM bank_transactions bt JOIN bank_accounts ba ON bt.bank_account_id=ba.id WHERE ba.mapped_account_id=? ${where}`,
    [ledgerAccountId, ...params],
  ).then((r) => Number(r[0]!.n));

describe("B2(a) same-source: genuine duplicates persist; re-import adds zero", () => {
  it("two genuinely-distinct identical coffees in one file are BOTH recorded", async () => {
    const { db, engine, ledgerId, ledgerAccountId } = await setup();
    const csv = ["date,desc,amount", "01/04/2026,CoffeeClub,-4.50", "01/04/2026,CoffeeClub,-4.50"].join("\n");
    const res = await engine.commitCsvImport({ ledgerId, ledgerAccountId, fileContent: csv, mapping: MAP });
    expect(res.ok).toBe(true);
    expect(res.value!.imported).toBe(2);
    expect(await countFor(db, ledgerAccountId)).toBe(2);
  });

  it("re-importing the same file adds zero (idempotent, no growth)", async () => {
    const { db, engine, ledgerId, ledgerAccountId } = await setup();
    const csv = ["date,desc,amount", "01/04/2026,CoffeeClub,-4.50", "01/04/2026,CoffeeClub,-4.50"].join("\n");
    await engine.commitCsvImport({ ledgerId, ledgerAccountId, fileContent: csv, mapping: MAP });
    const second = await engine.commitCsvImport({ ledgerId, ledgerAccountId, fileContent: csv, mapping: MAP });
    expect(second.value!.imported).toBe(0);
    expect(await countFor(db, ledgerAccountId)).toBe(2); // still two, not four
  });

  it("a later, legitimately-distinct third identical coffee CAN be recorded", async () => {
    const { db, engine, ledgerId, ledgerAccountId } = await setup();
    const two = "date,desc,amount\n01/04/2026,CoffeeClub,-4.50\n01/04/2026,CoffeeClub,-4.50";
    const three = two + "\n01/04/2026,CoffeeClub,-4.50";
    await engine.commitCsvImport({ ledgerId, ledgerAccountId, fileContent: two, mapping: MAP });
    const res = await engine.commitCsvImport({ ledgerId, ledgerAccountId, fileContent: three, mapping: MAP });
    expect(res.value!.imported).toBe(1); // only the new third occurrence
    expect(await countFor(db, ledgerAccountId)).toBe(3);
  });
});

describe("B2(b) cross-source: same txn described differently must NOT double-count", () => {
  async function withFeed() {
    const s = await setup();
    const conn = await s.engine.createBankConnection({ ledgerId: s.ledgerId, provider: "mock", providerConnectionId: "mc", institutionId: "i", institutionName: "M" });
    const ba = await s.engine.upsertBankAccount({ connectionId: conn.value!.id, ledgerId: s.ledgerId, providerAccountId: MOCK_ACCOUNT_ID, name: "P", accountNumber: "1", bsb: null, type: "transaction", currency: "AUD", currentBalance: 0, availableBalance: null });
    await s.engine.mapBankAccountToLedgerAccount(ba.value!.id, s.ledgerAccountId);
    // Feed has txnD: "OFFICEWORKS 0123", 89.95 debit, 2026-04-04
    await s.engine.syncBankAccount(new MockPlaidProvider({ nodeEnv: "test" }), conn.value!.id, ba.value!.id, "2026-04-01", "2026-04-30");
    return s;
  }

  it("Plaid 'OFFICEWORKS 0123' vs CSV 'OFFICEWORKS 0123 SYDNEY AU' is not stored twice", async () => {
    const { db, engine, ledgerId, ledgerAccountId } = await withFeed();
    const csv = "date,desc,amount\n04/04/2026,OFFICEWORKS 0123 SYDNEY AU,-89.95";
    const res = await engine.commitCsvImport({ ledgerId, ledgerAccountId, fileContent: csv, mapping: MAP });
    expect(res.ok).toBe(true);
    // The same real transaction (date+amount+type) must exist exactly once.
    const occurrences = await countFor(db, ledgerAccountId, "AND bt.date=? AND bt.amount=? AND bt.type=?", ["2026-04-04", 8995, "debit"]);
    expect(occurrences).toBe(1);
  });

  it("control: exact-description cross-source match dedups (skipped)", async () => {
    const { db, engine, ledgerId, ledgerAccountId } = await withFeed();
    const res = await engine.commitCsvImport({ ledgerId, ledgerAccountId, fileContent: "date,desc,amount\n04/04/2026,OFFICEWORKS 0123,-89.95\n20/04/2026,Netflix,-15.99", mapping: MAP });
    expect(res.value!.imported).toBe(1); // Netflix only
    const occurrences = await countFor(db, ledgerAccountId, "AND bt.date=? AND bt.amount=? AND bt.type=?", ["2026-04-04", 8995, "debit"]);
    expect(occurrences).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Regression tests for EVALUATION-2 items 4/5/6.
//   4: cross-source date tolerance — a one-day shift must NOT double-count.
//   5: a held possible_duplicate must be persisted to a resolvable review queue.
//   6: a removed-on-matched row must raise a review item (not vanish).
// Red against the current branch (no date tolerance; no review_items table).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
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
  await engine.createAccount({ ledgerId: ledger.value!.id, name: "Rev", code: "4000", type: "revenue", normalBalance: "credit" });
  const acct = await engine.createAccount({ ledgerId: ledger.value!.id, name: "Bank", code: "1000", type: "asset", normalBalance: "debit" });
  return { db, engine, ledgerId: ledger.value!.id, ledgerAccountId: acct.value!.id };
}

async function withFeed() {
  const s = await setup();
  const conn = await s.engine.createBankConnection({ ledgerId: s.ledgerId, provider: "mock", providerConnectionId: "mc", institutionId: "i", institutionName: "M" });
  const ba = await s.engine.upsertBankAccount({ connectionId: conn.value!.id, ledgerId: s.ledgerId, providerAccountId: MOCK_ACCOUNT_ID, name: "P", accountNumber: "1", bsb: null, type: "transaction", currency: "AUD", currentBalance: 0, availableBalance: null });
  await s.engine.mapBankAccountToLedgerAccount(ba.value!.id, s.ledgerAccountId);
  await s.engine.syncBankAccount(new MockPlaidProvider({ nodeEnv: "test" }), conn.value!.id, ba.value!.id, "2026-04-01", "2026-04-30");
  return { ...s, bankAccountId: ba.value!.id };
}

const count8995 = (db: Database, la: string) =>
  db.all<{ n: number }>(
    `SELECT COUNT(*) n FROM bank_transactions bt JOIN bank_accounts ba ON bt.bank_account_id=ba.id
     WHERE ba.mapped_account_id=? AND bt.amount=8995 AND bt.type='debit'`, [la]).then((r) => Number(r[0]!.n));

const openReviewItems = (db: Database, ledgerId: string, type?: string) =>
  db.all<{ n: number }>(
    `SELECT COUNT(*) n FROM review_items WHERE ledger_id=? AND status='open'${type ? " AND type=?" : ""}`,
    type ? [ledgerId, type] : [ledgerId]).then((r) => Number(r[0]!.n));

describe("item 4: cross-source date tolerance (no double-count on a one-day shift)", () => {
  it("same merchant/amount, posted date off by one from the feed → flagged, not double-counted", async () => {
    const { db, engine, ledgerId, ledgerAccountId } = await withFeed(); // feed: OFFICEWORKS 0123 @ 89.95 on 2026-04-04
    const csv = "date,desc,amount\n05/04/2026,OFFICEWORKS 0123,-89.95"; // posted a day later
    const preview = await engine.previewCsvImport({ ledgerId, ledgerAccountId, fileContent: csv, mapping: MAP });
    expect(preview.value!.rows[0]!.dedupStatus).toBe("possible_duplicate");
    await engine.commitCsvImport({ ledgerId, ledgerAccountId, fileContent: csv, mapping: MAP }); // no decision → held
    expect(await count8995(db, ledgerAccountId)).toBe(1); // the one real txn, not two
  });
});

describe("item 5: held possible_duplicate is persisted to a resolvable review queue", () => {
  it("committing a held candidate creates an open review item", async () => {
    const { db, engine, ledgerId, ledgerAccountId } = await withFeed();
    // Genuinely distinct purchase coinciding on date+amount with the feed row.
    const csv = "date,desc,amount\n04/04/2026,BUNNINGS WAREHOUSE,-89.95";
    const commit = await engine.commitCsvImport({ ledgerId, ledgerAccountId, fileContent: csv, mapping: MAP });
    expect(commit.value!.possibleDuplicates).toBe(1);
    expect(await openReviewItems(db, ledgerId, "possible_duplicate_import")).toBe(1);
  });
});

describe("item 5: held candidate is resolvable; import bypasses the dedup-hold gate", () => {
  it("resolve→import stages the held candidate and does NOT re-flag/re-hold (no loop)", async () => {
    const { db, engine, ledgerId, ledgerAccountId } = await withFeed();
    const csv = "date,desc,amount\n04/04/2026,BUNNINGS WAREHOUSE,-89.95";
    await engine.commitCsvImport({ ledgerId, ledgerAccountId, fileContent: csv, mapping: MAP });
    const open = (await engine.listReviewItems(ledgerId, "open")).value!;
    expect(open).toHaveLength(1);

    const resolved = await engine.resolveReviewItem(open[0]!.id, "import");
    expect(resolved.ok).toBe(true);
    expect(resolved.value!.status).toBe("resolved");
    expect(resolved.value!.resolution).toBe("imported");
    // The confirmed candidate is now staged exactly once...
    const bunnings = await db.all<{ n: number }>("SELECT COUNT(*) n FROM bank_transactions WHERE description='BUNNINGS WAREHOUSE'").then((r) => Number(r[0]!.n));
    expect(bunnings).toBe(1);
    // ...and importing did NOT create a fresh review item (no re-flag loop).
    expect((await engine.listReviewItems(ledgerId, "open")).value!).toHaveLength(0);
  });

  it("resolve→dismiss closes it without staging anything", async () => {
    const { db, engine, ledgerId, ledgerAccountId } = await withFeed();
    await engine.commitCsvImport({ ledgerId, ledgerAccountId, fileContent: "date,desc,amount\n04/04/2026,BUNNINGS WAREHOUSE,-89.95", mapping: MAP });
    const open = (await engine.listReviewItems(ledgerId, "open")).value!;
    const r = await engine.resolveReviewItem(open[0]!.id, "dismiss");
    expect(r.value!.status).toBe("dismissed");
    const bunnings = await db.all<{ n: number }>("SELECT COUNT(*) n FROM bank_transactions WHERE description='BUNNINGS WAREHOUSE'").then((x) => Number(x[0]!.n));
    expect(bunnings).toBe(0);
  });

  it("re-importing the same held candidate does not pile up review items (idempotent)", async () => {
    const { engine, ledgerId, ledgerAccountId } = await withFeed();
    const csv = "date,desc,amount\n04/04/2026,BUNNINGS WAREHOUSE,-89.95";
    await engine.commitCsvImport({ ledgerId, ledgerAccountId, fileContent: csv, mapping: MAP });
    await engine.commitCsvImport({ ledgerId, ledgerAccountId, fileContent: csv, mapping: MAP });
    expect((await engine.listReviewItems(ledgerId, "open")).value!).toHaveLength(1);
  });
});

describe("item 6: removed-on-matched raises a review item (not silently dropped)", () => {
  it("removing a matched bank transaction creates an open review item", async () => {
    const { db, engine, ledgerId } = await setup();
    const txn = await engine.postTransaction({ ledgerId, date: "2026-04-04", memo: "real", lines: [
      { accountCode: "1000", amount: 5000, direction: "debit" }, { accountCode: "4000", amount: 5000, direction: "credit" },
    ] });
    const conn = await engine.createBankConnection({ ledgerId, provider: "mock", providerConnectionId: "mc", institutionId: "i", institutionName: "M" });
    const ba = await engine.upsertBankAccount({ connectionId: conn.value!.id, ledgerId, providerAccountId: "pa", name: "P", accountNumber: "1", bsb: null, type: "transaction", currency: "AUD", currentBalance: 0, availableBalance: null });
    await db.run(`INSERT INTO bank_transactions (id,bank_account_id,ledger_id,provider_transaction_id,date,amount,type,description,status,matched_transaction_id,raw_data,line_fingerprint,created_at,updated_at)
      VALUES ('btm',?,?,'prov-m','2026-04-04',5000,'credit','x','matched',?, '{}','fp',?,?)`,
      [ba.value!.id, ledgerId, txn.value!.id, "2026-04-04T00:00:00Z", "2026-04-04T00:00:00Z"]);

    await engine.removeBankTransactions(ba.value!.id, ["prov-m"]);
    expect(await openReviewItems(db, ledgerId, "removed_reconciled_txn")).toBe(1);

    // Resolvable: acknowledge closes it; the guarded txn + ledger stay intact.
    const open = (await engine.listReviewItems(ledgerId, "open")).value!;
    const ack = await engine.resolveReviewItem(open[0]!.id, "acknowledge");
    expect(ack.value!.status).toBe("resolved");
    expect((await db.get<{ status: string }>("SELECT status FROM bank_transactions WHERE id='btm'"))?.status).toBe("matched");
    expect((await db.get<{ status: string }>("SELECT status FROM transactions WHERE id=?", [txn.value!.id]))?.status).toBe("posted");
    expect(await openReviewItems(db, ledgerId)).toBe(0);
  });
});

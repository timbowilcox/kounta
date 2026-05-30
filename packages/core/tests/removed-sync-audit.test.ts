// ---------------------------------------------------------------------------
// B3 regression — the `removed` sync path must audit every change and must NOT
// silently delete or re-state a reconciled/posted row. Reproductions from
// EVALUATION.md; assert the FIXED behaviour (red against the current code,
// which flips matched->ignored with no audit and hard-deletes pending rows).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { LedgerEngine } from "../src/index.js";
import type { Database } from "../src/index.js";
import { createFullTestDb } from "./helpers/migrate.js";

const U = "00000000-0000-7000-8000-000000000001";

async function setup() {
  const db = await createFullTestDb();
  const engine = new LedgerEngine(db);
  await db.run(`INSERT INTO users (id,email,name,auth_provider,auth_provider_id) VALUES (?,?,?,?,?)`, [U, "t@e.com", "T", "test", "t1"]);
  const ledger = await engine.createLedger({ name: "Co", currency: "AUD", ownerId: U });
  const ledgerId = ledger.value!.id;
  await engine.createAccount({ ledgerId, name: "Bank", code: "1000", type: "asset", normalBalance: "debit" });
  await engine.createAccount({ ledgerId, name: "Rev", code: "4000", type: "revenue", normalBalance: "credit" });
  const conn = await engine.createBankConnection({ ledgerId, provider: "mock", providerConnectionId: "mc", institutionId: "i", institutionName: "M" });
  const ba = await engine.upsertBankAccount({ connectionId: conn.value!.id, ledgerId, providerAccountId: "pa", name: "P", accountNumber: "1", bsb: null, type: "transaction", currency: "AUD", currentBalance: 0, availableBalance: null });
  return { db, engine, ledgerId, bankAccountId: ba.value!.id };
}

const auditCount = (db: Database, ledgerId: string) =>
  db.all<{ n: number }>(`SELECT COUNT(*) n FROM audit_entries WHERE ledger_id=?`, [ledgerId]).then((r) => Number(r[0]!.n));

describe("B3: removed sync path", () => {
  it("removed on a MATCHED row is guarded (not re-stated) and audited", async () => {
    const { db, engine, ledgerId, bankAccountId } = await setup();
    const txn = await engine.postTransaction({ ledgerId, date: "2026-04-04", memo: "real", lines: [
      { accountCode: "1000", amount: 5000, direction: "debit" }, { accountCode: "4000", amount: 5000, direction: "credit" },
    ] });
    await db.run(`INSERT INTO bank_transactions (id,bank_account_id,ledger_id,provider_transaction_id,date,amount,type,description,status,matched_transaction_id,raw_data,line_fingerprint,created_at,updated_at)
      VALUES ('bt1',?,?,'prov-1','2026-04-04',5000,'credit','real','matched',?, '{}','fp',?,?)`,
      [bankAccountId, ledgerId, txn.value!.id, "2026-04-04T00:00:00Z", "2026-04-04T00:00:00Z"]);

    const before = await auditCount(db, ledgerId);
    await engine.removeBankTransactions(bankAccountId, ["prov-1"]);
    const after = await auditCount(db, ledgerId);
    const row = await db.get<{ status: string }>(`SELECT status FROM bank_transactions WHERE id='bt1'`);
    const ledgerTxn = await db.get<{ status: string }>(`SELECT status FROM transactions WHERE id=?`, [txn.value!.id]);

    expect(after).toBeGreaterThan(before);     // the change is audited
    expect(row?.status).toBe("matched");        // NOT silently re-stated to 'ignored'
    expect(ledgerTxn?.status).toBe("posted");   // ledger never touched
  });

  it("removed on a PENDING row deletes it BUT writes an audit entry", async () => {
    const { db, engine, ledgerId, bankAccountId } = await setup();
    await db.run(`INSERT INTO bank_transactions (id,bank_account_id,ledger_id,provider_transaction_id,date,amount,type,description,status,raw_data,line_fingerprint,created_at,updated_at)
      VALUES ('bt2',?,?,'prov-2','2026-04-04',5000,'debit','pend','pending','{}','fp2',?,?)`,
      [bankAccountId, ledgerId, "2026-04-04T00:00:00Z", "2026-04-04T00:00:00Z"]);

    const before = await auditCount(db, ledgerId);
    await engine.removeBankTransactions(bankAccountId, ["prov-2"]);
    const after = await auditCount(db, ledgerId);
    const gone = await db.get<{ id: string }>(`SELECT id FROM bank_transactions WHERE id='bt2'`);

    expect(gone).toBeUndefined();           // pending may be removed
    expect(after).toBeGreaterThan(before);  // but never without a trace
  });
});

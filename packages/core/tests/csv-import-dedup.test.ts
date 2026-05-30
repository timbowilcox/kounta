// ---------------------------------------------------------------------------
// Manual CSV import — engine ingest, cross-channel dedup (the highest-risk
// correctness requirement), and mapping-profile round-trip.
//
// Cross-channel dedup: a manual CSV overlapping a Plaid/Basiq range must NOT
// double-count, keyed on the shared line-fingerprint.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { LedgerEngine } from "../src/index.js";
import type { Database } from "../src/index.js";
import type { CsvMapping } from "../src/import/csv-mapping.js";
import { MockPlaidProvider, MOCK_ACCOUNT_ID } from "../src/bank-feeds/index.js";
import { createFullTestDb } from "./helpers/migrate.js";

const SIGNED_MAPPING: CsvMapping = {
  hasHeader: true,
  dateColumn: 0,
  dateFormat: "DD/MM/YYYY",
  descriptionColumn: 1,
  amountMode: "signed",
  amountColumn: 2,
  signConvention: "negative_is_outflow",
} as CsvMapping;

const USER_ID = "00000000-0000-7000-8000-000000000001";

describe("manual CSV import", () => {
  let db: Database;
  let engine: LedgerEngine;
  let ledgerId: string;
  let bankAccountCode: string;
  let bankLedgerAccountId: string;

  const countRowsForLedgerAccount = async () => {
    const rows = await db.all<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM bank_transactions bt
       JOIN bank_accounts ba ON bt.bank_account_id = ba.id
       WHERE ba.mapped_account_id = ?`,
      [bankLedgerAccountId],
    );
    return Number(rows[0]!.n);
  };

  beforeEach(async () => {
    db = await createFullTestDb();
    engine = new LedgerEngine(db);
    await db.run(
      `INSERT INTO users (id, email, name, auth_provider, auth_provider_id)
       VALUES (?, ?, ?, ?, ?)`,
      [USER_ID, "t@e.com", "T", "test", "t-1"],
    );
    const ledger = await engine.createLedger({ name: "CSV Co", currency: "AUD", ownerId: USER_ID });
    ledgerId = ledger.value!.id;

    const acct = await engine.createAccount({
      ledgerId,
      name: "Business Bank",
      code: "1000",
      type: "asset",
      normalBalance: "debit",
    });
    bankLedgerAccountId = acct.value!.id;
    bankAccountCode = "1000";
    expect(bankAccountCode).toBe("1000");
  });

  // -------------------------------------------------------------------------

  it("previews without writing, then commits rows into the pipeline", async () => {
    const csv = [
      "date,desc,amount",
      "01/04/2026,Officeworks,-89.95",
      "02/04/2026,Client Invoice,1500.00",
    ].join("\n");

    const preview = await engine.previewCsvImport({
      ledgerId,
      ledgerAccountId: bankLedgerAccountId,
      fileContent: csv,
      mapping: SIGNED_MAPPING,
    });
    expect(preview.ok).toBe(true);
    expect(preview.value!.newCount).toBe(2);
    expect(preview.value!.duplicateCount).toBe(0);
    // Preview writes nothing.
    expect(await countRowsForLedgerAccount()).toBe(0);

    const commit = await engine.commitCsvImport({
      ledgerId,
      ledgerAccountId: bankLedgerAccountId,
      fileContent: csv,
      mapping: SIGNED_MAPPING,
      filename: "april.csv",
    });
    expect(commit.ok).toBe(true);
    expect(commit.value!.imported).toBe(2);
    expect(commit.value!.duplicates).toBe(0);
    expect(await countRowsForLedgerAccount()).toBe(2);
  });

  it("re-importing the same file does not double-count (manual self-dedup)", async () => {
    const csv = "date,desc,amount\n01/04/2026,Officeworks,-89.95";
    const opts = { ledgerId, ledgerAccountId: bankLedgerAccountId, fileContent: csv, mapping: SIGNED_MAPPING };

    const first = await engine.commitCsvImport(opts);
    expect(first.value!.imported).toBe(1);
    expect(await countRowsForLedgerAccount()).toBe(1);

    const second = await engine.commitCsvImport(opts);
    expect(second.value!.imported).toBe(0);
    expect(second.value!.duplicates).toBe(1);
    expect(await countRowsForLedgerAccount()).toBe(1); // no double count
  });

  it("preserves two genuinely-distinct identical rows in one file (occurrence-aware)", async () => {
    // Two real identical transactions (e.g. two same-priced coffees that day)
    // are BOTH legitimate — they must not collapse to one. (See B2; the prior
    // behaviour silently dropped the second.)
    const csv = ["date,desc,amount", "01/04/2026,Officeworks,-89.95", "01/04/2026,Officeworks,-89.95"].join("\n");
    const commit = await engine.commitCsvImport({
      ledgerId,
      ledgerAccountId: bankLedgerAccountId,
      fileContent: csv,
      mapping: SIGNED_MAPPING,
    });
    expect(commit.value!.imported).toBe(2);
    expect(commit.value!.duplicates).toBe(0);
  });

  // -------------------------------------------------------------------------
  // CROSS-CHANNEL: manual CSV overlapping a Plaid feed must not double-count.
  // -------------------------------------------------------------------------

  it("does not double-count a manual row that overlaps a Plaid feed transaction", async () => {
    // 1) Connect the mock Plaid feed and map its account to the SAME ledger account.
    const conn = await engine.createBankConnection({
      ledgerId,
      provider: "mock",
      providerConnectionId: "mock_conn_001",
      institutionId: "ins_mock",
      institutionName: "Mock Bank",
    });
    const plaidAcct = await engine.upsertBankAccount({
      connectionId: conn.value!.id,
      ledgerId,
      providerAccountId: MOCK_ACCOUNT_ID,
      name: "Plaid Checking",
      accountNumber: "000123456",
      bsb: null,
      type: "transaction",
      currency: "AUD",
      currentBalance: 0,
      availableBalance: null,
    });
    await engine.mapBankAccountToLedgerAccount(plaidAcct.value!.id, bankLedgerAccountId);

    const mock = new MockPlaidProvider({ nodeEnv: "test" });
    await engine.syncBankAccount(mock, conn.value!.id, plaidAcct.value!.id, "2026-04-01", "2026-04-30");
    const afterFeed = await countRowsForLedgerAccount();
    expect(afterFeed).toBeGreaterThan(0); // feed rows present (incl. txnD "OFFICEWORKS 0123" @ 89.95 on 2026-04-04)

    // 2) Manual CSV: one row OVERLAPS the Plaid txnD, one row is NEW.
    const csv = [
      "date,desc,amount",
      "04/04/2026,OFFICEWORKS 0123,-89.95", // == Plaid txnD -> duplicate
      "15/04/2026,SPOTIFY,-11.99", // new
    ].join("\n");

    const preview = await engine.previewCsvImport({
      ledgerId,
      ledgerAccountId: bankLedgerAccountId,
      fileContent: csv,
      mapping: SIGNED_MAPPING,
    });
    expect(preview.value!.duplicateCount).toBe(1);
    expect(preview.value!.newCount).toBe(1);
    const overlapRow = preview.value!.rows.find((r) => r.description === "OFFICEWORKS 0123")!;
    expect(overlapRow.dedupStatus).toBe("duplicate");

    const commit = await engine.commitCsvImport({
      ledgerId,
      ledgerAccountId: bankLedgerAccountId,
      fileContent: csv,
      mapping: SIGNED_MAPPING,
    });
    expect(commit.value!.imported).toBe(1); // only SPOTIFY
    expect(commit.value!.duplicates).toBe(1); // OFFICEWORKS suppressed

    // The overlapping transaction exists exactly once across the ledger account.
    const officeworks = await db.all<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM bank_transactions bt
       JOIN bank_accounts ba ON bt.bank_account_id = ba.id
       WHERE ba.mapped_account_id = ? AND bt.line_fingerprint = ?`,
      [bankLedgerAccountId, "2026-04-04|-8995|officeworks 0123"],
    );
    expect(Number(officeworks[0]!.n)).toBe(1);
    expect(await countRowsForLedgerAccount()).toBe(afterFeed + 1); // only the new row added
  });

  it("rejects import for an account that does not belong to the ledger (fail-closed)", async () => {
    const res = await engine.commitCsvImport({
      ledgerId,
      ledgerAccountId: "nonexistent-account",
      fileContent: "date,desc,amount\n01/04/2026,X,-1.00",
      mapping: SIGNED_MAPPING,
    });
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mapping-profile round-trip
// ---------------------------------------------------------------------------

describe("mapping profiles", () => {
  let db: Database;
  let engine: LedgerEngine;
  let ledgerId: string;

  beforeEach(async () => {
    db = await createFullTestDb();
    engine = new LedgerEngine(db);
    await db.run(
      `INSERT INTO users (id, email, name, auth_provider, auth_provider_id) VALUES (?, ?, ?, ?, ?)`,
      [USER_ID, "t@e.com", "T", "test", "t-1"],
    );
    const ledger = await engine.createLedger({ name: "Profiles Co", currency: "AUD", ownerId: USER_ID });
    ledgerId = ledger.value!.id;
  });

  it("creates, fetches, updates, lists, and deletes a profile preserving the mapping", async () => {
    const created = await engine.createMappingProfile({ ledgerId, name: "CBA", mapping: SIGNED_MAPPING });
    expect(created.ok).toBe(true);
    expect(created.value!.mapping.dateFormat).toBe("DD/MM/YYYY");
    expect(created.value!.mapping.amountMode).toBe("signed");

    const fetched = await engine.getMappingProfile(created.value!.id);
    expect(fetched.value!.mapping.signConvention).toBe("negative_is_outflow");

    const updated = await engine.updateMappingProfile(created.value!.id, {
      mapping: { ...SIGNED_MAPPING, dateFormat: "YYYY-MM-DD" } as CsvMapping,
    });
    expect(updated.value!.mapping.dateFormat).toBe("YYYY-MM-DD");

    const list = await engine.listMappingProfiles(ledgerId);
    expect(list.value!.length).toBe(1);

    const del = await engine.deleteMappingProfile(created.value!.id);
    expect(del.ok).toBe(true);
    const afterDelete = await engine.listMappingProfiles(ledgerId);
    expect(afterDelete.value!.length).toBe(0);
  });

  it("rejects a duplicate profile name for the same ledger", async () => {
    await engine.createMappingProfile({ ledgerId, name: "CBA", mapping: SIGNED_MAPPING });
    const dup = await engine.createMappingProfile({ ledgerId, name: "CBA", mapping: SIGNED_MAPPING });
    expect(dup.ok).toBe(false);
  });
});

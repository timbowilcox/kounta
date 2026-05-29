// ---------------------------------------------------------------------------
// Mock Plaid feed — provider interface conformance, the single normalisation
// boundary, the /transactions/sync cursor model, and end-to-end sync
// idempotency (including modified -> posted and removed handling).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { LedgerEngine } from "../src/index.js";
import type { Database } from "../src/index.js";
import {
  MockPlaidProvider,
  createBankFeedProvider,
  normalizePlaidTransaction,
  labeledFixtures,
  getSyncPage,
  MOCK_ACCOUNT_ID,
} from "../src/bank-feeds/index.js";
import { createFullTestDb } from "./helpers/migrate.js";

// ---------------------------------------------------------------------------
// Normalisation boundary (acceptance: normalised output equals expected Kounta)
// ---------------------------------------------------------------------------

describe("normalizePlaidTransaction — the single Plaid->internal boundary", () => {
  it("maps a credit (money in) to a positive-magnitude credit in cents", () => {
    const payout = labeledFixtures.find((f) => f.plaid.transaction_id === "mock_txn_A")!;
    const n = normalizePlaidTransaction(payout.plaid);
    expect(n).toEqual({
      providerTransactionId: "mock_txn_A",
      date: "2026-04-02",
      amount: 250000, // 2500.00 AUD -> cents
      type: "credit", // Plaid negative amount = money in
      description: "STRIPE PAYOUT",
      reference: null,
      category: "INCOME_OTHER_INCOME",
      balance: null,
      rawData: { ...payout.plaid },
    });
  });

  it("maps a debit (money out) to a positive-magnitude debit in cents", () => {
    const github = labeledFixtures.find((f) => f.plaid.transaction_id === "mock_txn_C")!;
    const n = normalizePlaidTransaction(github.plaid);
    expect(n.type).toBe("debit"); // Plaid positive amount = money out
    expect(n.amount).toBe(4900); // 49.00 AUD -> cents
    expect(n.description).toBe("GITHUB.COM");
    expect(n.category).toBe("GENERAL_SERVICES_COMPUTER_SOFTWARE");
  });
});

// ---------------------------------------------------------------------------
// Fixture shape + ground-truth labels (accuracy harness seed)
// ---------------------------------------------------------------------------

describe("mock fixtures", () => {
  it("emit the real Plaid shape", () => {
    for (const { plaid } of labeledFixtures) {
      expect(typeof plaid.transaction_id).toBe("string");
      expect(typeof plaid.account_id).toBe("string");
      expect(typeof plaid.amount).toBe("number");
      expect(typeof plaid.iso_currency_code).toBe("string");
      expect(plaid.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof plaid.name).toBe("string");
      expect(["string", "object"]).toContain(typeof plaid.merchant_name); // string | null
      expect(typeof plaid.pending).toBe("boolean");
      expect(plaid.personal_finance_category).toHaveProperty("primary");
      expect(plaid.personal_finance_category).toHaveProperty("detailed");
    }
  });

  it("each carries a non-empty ground-truth category label (accuracy seed)", () => {
    expect(labeledFixtures.length).toBeGreaterThan(0);
    for (const f of labeledFixtures) {
      expect(f.groundTruthCategory.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// /transactions/sync cursor model
// ---------------------------------------------------------------------------

describe("MockPlaidProvider.syncTransactions — /transactions/sync model", () => {
  const provider = new MockPlaidProvider({ nodeEnv: "test" });

  it("returns added/modified/removed + next_cursor and paginates via has_more", () => {
    const page1 = getSyncPage(null);
    expect(page1.added.map((t) => t.transaction_id)).toEqual([
      "mock_txn_A",
      "mock_txn_B",
      "mock_txn_D",
      "mock_txn_E",
    ]);
    expect(page1.has_more).toBe(true);
    expect(page1.next_cursor).toBe("cursor-1");

    const page2 = getSyncPage("cursor-1");
    expect(page2.has_more).toBe(false);
    expect(page2.next_cursor).toBe("cursor-2");
  });

  it("exercises a pending -> posted transition and a removal", () => {
    // First emission of A is pending.
    const firstA = getSyncPage(null).added.find((t) => t.transaction_id === "mock_txn_A")!;
    expect(firstA.pending).toBe(true);

    // Later page modifies A to posted and removes B.
    const delta = getSyncPage("cursor-2");
    const postedA = delta.modified.find((t) => t.transaction_id === "mock_txn_A")!;
    expect(postedA.pending).toBe(false);
    expect(delta.removed.map((r) => r.transaction_id)).toContain("mock_txn_B");
  });

  it("returns normalised internal transactions, not raw Plaid", async () => {
    const result = await provider.syncTransactions(
      { connectionId: "c", accountId: MOCK_ACCOUNT_ID },
      null,
    );
    const a = result.added.find((t) => t.providerTransactionId === "mock_txn_A")!;
    expect(a.type).toBe("credit");
    expect(a.amount).toBe(250000);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed + factory wiring
// ---------------------------------------------------------------------------

describe("mock provider — fail-closed + factory", () => {
  it("throws when constructed in production", () => {
    expect(() => new MockPlaidProvider({ nodeEnv: "production" })).toThrow(/production/i);
  });

  it("factory builds the mock and refuses production", () => {
    const p = createBankFeedProvider("mock", {});
    expect(p.name).toBe("mock");
    expect(typeof p.syncTransactions).toBe("function");
    expect(() => createBankFeedProvider("mock", { mock: { nodeEnv: "production" } })).toThrow(
      /production/i,
    );
  });
});

// ---------------------------------------------------------------------------
// End-to-end sync through the engine: idempotency + modified/removed handling
// ---------------------------------------------------------------------------

describe("engine.syncBankAccount via mock cursor sync", () => {
  let db: Database;
  let engine: LedgerEngine;
  let connectionId: string;
  let bankAccountId: string;

  const rowsForAccount = async () =>
    db.all<{ provider_transaction_id: string; status: string; raw_data: string }>(
      "SELECT provider_transaction_id, status, raw_data FROM bank_transactions WHERE bank_account_id = ?",
      [bankAccountId],
    );

  beforeEach(async () => {
    db = await createFullTestDb();
    engine = new LedgerEngine(db);

    await db.run(
      `INSERT INTO users (id, email, name, auth_provider, auth_provider_id)
       VALUES (?, ?, ?, ?, ?)`,
      ["00000000-0000-7000-8000-000000000001", "t@e.com", "T", "test", "t-1"],
    );
    const ledger = await engine.createLedger({
      name: "Mock Co",
      currency: "AUD",
      ownerId: "00000000-0000-7000-8000-000000000001",
    });
    const ledgerId = ledger.value!.id;

    const conn = await engine.createBankConnection({
      ledgerId,
      provider: "mock",
      providerConnectionId: "mock_conn_001",
      institutionId: "ins_mock",
      institutionName: "Mock Bank",
    });
    connectionId = conn.value!.id;

    const acct = await engine.upsertBankAccount({
      connectionId,
      ledgerId,
      providerAccountId: MOCK_ACCOUNT_ID,
      name: "Checking",
      accountNumber: "000123456",
      bsb: "062-000",
      type: "transaction",
      currency: "AUD",
      currentBalance: 0,
      availableBalance: null,
    });
    bankAccountId = acct.value!.id;
  });

  it("ingests the first sync, then applies modified/removed without duplicating", async () => {
    const mock = new MockPlaidProvider({ nodeEnv: "test" });

    // First sync: paginates pages "" + "cursor-1" -> A(pending),B,D,E,F,G.
    const s1 = await engine.syncBankAccount(mock, connectionId, bankAccountId, "2026-04-01", "2026-04-30");
    expect(s1.ok).toBe(true);
    const after1 = await rowsForAccount();
    const ids1 = after1.map((r) => r.provider_transaction_id).sort();
    expect(ids1).toEqual(["mock_txn_A", "mock_txn_B", "mock_txn_D", "mock_txn_E", "mock_txn_F", "mock_txn_G"]);
    const a1 = after1.find((r) => r.provider_transaction_id === "mock_txn_A")!;
    expect(JSON.parse(a1.raw_data).pending).toBe(true);

    // Second sync: resumes from persisted cursor -> +C, A posted, B removed.
    const s2 = await engine.syncBankAccount(mock, connectionId, bankAccountId, "2026-04-01", "2026-04-30");
    expect(s2.ok).toBe(true);
    const after2 = await rowsForAccount();
    const ids2 = after2.map((r) => r.provider_transaction_id).sort();
    expect(ids2).toEqual(["mock_txn_A", "mock_txn_C", "mock_txn_D", "mock_txn_E", "mock_txn_F", "mock_txn_G"]);
    expect(ids2).not.toContain("mock_txn_B"); // removed
    const a2 = after2.find((r) => r.provider_transaction_id === "mock_txn_A")!;
    expect(JSON.parse(a2.raw_data).pending).toBe(false); // posted

    // Third sync: steady state -> no changes, no duplicates.
    const s3 = await engine.syncBankAccount(mock, connectionId, bankAccountId, "2026-04-01", "2026-04-30");
    expect(s3.ok).toBe(true);
    const after3 = await rowsForAccount();
    expect(after3.length).toBe(after2.length);
  });
});

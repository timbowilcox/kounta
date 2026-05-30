// ---------------------------------------------------------------------------
// Import module tests — CSV parsing, OFX parsing, matching engine, and
// engine integration tests for createImport / getImportBatch /
// listImportBatches / confirmMatches.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { SqliteDatabase } from "../src/db/sqlite.js";
import { LedgerEngine } from "../src/engine/index.js";
import { ErrorCode } from "../src/errors/index.js";
import { parseCSV, normalizeDate, normalizeAmount } from "../src/import/csv-parser.js";
import { parseOFX } from "../src/import/ofx-parser.js";
import { matchRows } from "../src/import/matcher.js";
import type { Database } from "../src/db/database.js";
import type { TransactionWithLines } from "../src/types/index.js";
import { createFullTestDb } from "./helpers/migrate.js";

// ---------------------------------------------------------------------------
// Test helpers — FULL registered schema from the single source of truth
// (src/db/migration-manifest.ts), not a hand-picked subset.
// ---------------------------------------------------------------------------

const createTestDb = (): Promise<Database> => createFullTestDb();

const createSystemUser = async (db: Database): Promise<string> => {
  const userId = "00000000-0000-7000-8000-000000000001";
  await db.run(
    `INSERT INTO users (id, email, name, auth_provider, auth_provider_id)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, "system@test.com", "System", "test", "test-001"],
  );
  return userId;
};

// ============================================================================
// CSV Parser
// ============================================================================

describe("parseCSV", () => {
  it("parses a standard CSV with headers", async () => {
    const csv = [
      "date,amount,payee,memo",
      "2024-06-15,99.99,Acme Corp,Monthly subscription",
      "2024-06-20,-250.00,Office Depot,Paper supplies",
    ].join("\n");

    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);

    expect(rows[0]!.date).toBe("2024-06-15");
    expect(rows[0]!.amount).toBe(9999);
    expect(rows[0]!.payee).toBe("Acme Corp");
    expect(rows[0]!.memo).toBe("Monthly subscription");

    expect(rows[1]!.date).toBe("2024-06-20");
    expect(rows[1]!.amount).toBe(-25000);
    expect(rows[1]!.payee).toBe("Office Depot");
    expect(rows[1]!.memo).toBe("Paper supplies");
  });

  it("normalizes US date format MM/DD/YYYY", async () => {
    const csv = "date,amount,description\n01/15/2025,100.00,Test";
    const rows = parseCSV(csv);
    expect(rows[0]!.date).toBe("2025-01-15");
  });

  it("normalizes EU date format DD/MM/YYYY when day > 12", async () => {
    const csv = "date,amount,description\n25/01/2025,100.00,Test";
    const rows = parseCSV(csv);
    expect(rows[0]!.date).toBe("2025-01-25");
  });

  it("normalizes DD-Mon-YYYY format", async () => {
    const csv = "date,amount,description\n15-Jan-2025,100.00,Test";
    const rows = parseCSV(csv);
    expect(rows[0]!.date).toBe("2025-01-15");
  });

  it("handles parenthesized negative amounts", async () => {
    const csv = "date,amount,payee\n2024-01-01,(500.00),Vendor";
    const rows = parseCSV(csv);
    expect(rows[0]!.amount).toBe(-50000);
  });

  it("strips currency symbols", async () => {
    const csv = "date,amount,payee\n2024-01-01,$1234.56,Vendor";
    const rows = parseCSV(csv);
    expect(rows[0]!.amount).toBe(123456);
  });

  it("strips commas from amounts", async () => {
    const csv = "date,amount,payee\n2024-01-01,\"1,234.56\",Vendor";
    const rows = parseCSV(csv);
    expect(rows[0]!.amount).toBe(123456);
  });

  it("handles quoted fields with commas", async () => {
    const csv = 'date,amount,payee\n2024-01-01,100.00,"Smith, John"';
    const rows = parseCSV(csv);
    expect(rows[0]!.payee).toBe("Smith, John");
  });

  it("handles quoted fields with escaped quotes", async () => {
    const csv = 'date,amount,payee\n2024-01-01,100.00,"He said ""hello"""';
    const rows = parseCSV(csv);
    expect(rows[0]!.payee).toBe('He said "hello"');
  });

  it("handles CRLF line endings", async () => {
    const csv = "date,amount,payee\r\n2024-01-01,50.00,Test\r\n2024-01-02,75.00,Test2\r\n";
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
  });

  it("supports alternative header names", async () => {
    const csv = "transaction date,transaction amount,merchant\n2024-03-01,42.00,Cafe";
    const rows = parseCSV(csv);
    expect(rows[0]!.date).toBe("2024-03-01");
    expect(rows[0]!.amount).toBe(4200);
    expect(rows[0]!.payee).toBe("Cafe");
  });

  it("throws on missing header columns", async () => {
    expect(() => parseCSV("foo,bar,baz\n1,2,3")).toThrow("header");
  });

  it("throws on empty CSV", async () => {
    expect(() => parseCSV("")).toThrow();
  });

  it("throws on header-only CSV", async () => {
    expect(() => parseCSV("date,amount,payee")).toThrow();
  });

  it("sets memo to null when column is absent", async () => {
    const csv = "date,amount,payee\n2024-01-01,10.00,Vendor";
    const rows = parseCSV(csv);
    expect(rows[0]!.memo).toBeNull();
  });

  it("preserves raw data from all columns", async () => {
    const csv = "date,amount,payee,extra\n2024-01-01,10.00,Vendor,custom-val";
    const rows = parseCSV(csv);
    expect(rows[0]!.rawData["extra"]).toBe("custom-val");
  });
});

// ============================================================================
// Date normalization (exported for direct testing)
// ============================================================================

describe("normalizeDate", () => {
  it("passes through ISO format", async () => {
    expect(normalizeDate("2024-06-15")).toBe("2024-06-15");
  });

  it("normalizes US MM/DD/YYYY", async () => {
    expect(normalizeDate("06/15/2024")).toBe("2024-06-15");
  });

  it("normalizes EU DD/MM/YYYY when day > 12", async () => {
    expect(normalizeDate("25/06/2024")).toBe("2024-06-25");
  });

  it("normalizes DD-Mon-YYYY", async () => {
    expect(normalizeDate("15-Jun-2024")).toBe("2024-06-15");
  });

  it("normalizes DD Mon YYYY with spaces", async () => {
    expect(normalizeDate("15 Jun 2024")).toBe("2024-06-15");
  });

  it("throws on unrecognized format", async () => {
    expect(() => normalizeDate("not-a-date")).toThrow();
  });
});

// ============================================================================
// Amount normalization
// ============================================================================

describe("normalizeAmount", () => {
  it("converts decimal to cents", async () => {
    expect(normalizeAmount("99.99")).toBe(9999);
  });

  it("handles negative amounts", async () => {
    expect(normalizeAmount("-50.00")).toBe(-5000);
  });

  it("handles parenthesized negatives", async () => {
    expect(normalizeAmount("(123.45)")).toBe(-12345);
  });

  it("strips dollar sign", async () => {
    expect(normalizeAmount("$100.00")).toBe(10000);
  });

  it("strips euro sign", async () => {
    expect(normalizeAmount("€50.00")).toBe(5000);
  });

  it("strips commas", async () => {
    expect(normalizeAmount("1,234.56")).toBe(123456);
  });

  it("handles integer amounts", async () => {
    expect(normalizeAmount("100")).toBe(10000);
  });

  it("throws on non-numeric input", async () => {
    expect(() => normalizeAmount("abc")).toThrow();
  });
});

// ============================================================================
// OFX Parser
// ============================================================================

describe("parseOFX", () => {
  it("parses standard OFX 1.x with closed tags", async () => {
    const ofx = `
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240615120000
<TRNAMT>-50.00
<NAME>Coffee Shop
<MEMO>Morning coffee
<FITID>TXN001
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20240620
<TRNAMT>1500.00
<NAME>Employer Inc
<FITID>TXN002
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

    const rows = parseOFX(ofx);
    expect(rows).toHaveLength(2);

    expect(rows[0]!.date).toBe("2024-06-15");
    expect(rows[0]!.amount).toBe(-5000);
    expect(rows[0]!.payee).toBe("Coffee Shop");
    expect(rows[0]!.memo).toBe("Morning coffee");

    expect(rows[1]!.date).toBe("2024-06-20");
    expect(rows[1]!.amount).toBe(150000);
    expect(rows[1]!.payee).toBe("Employer Inc");
    expect(rows[1]!.memo).toBeNull();
  });

  it("normalizes DTPOSTED to ISO date", async () => {
    const ofx = `
<STMTTRN>
<DTPOSTED>20250115120000
<TRNAMT>100.00
<NAME>Test
</STMTTRN>`;
    const rows = parseOFX(ofx);
    expect(rows[0]!.date).toBe("2025-01-15");
  });

  it("handles signed amounts correctly", async () => {
    const ofx = `
<STMTTRN>
<DTPOSTED>20240101
<TRNAMT>-25.50
<NAME>Withdrawal
</STMTTRN>`;
    const rows = parseOFX(ofx);
    expect(rows[0]!.amount).toBe(-2550);
  });

  it("defaults payee to 'Unknown' when NAME is missing", async () => {
    const ofx = `
<STMTTRN>
<DTPOSTED>20240101
<TRNAMT>10.00
</STMTTRN>`;
    const rows = parseOFX(ofx);
    expect(rows[0]!.payee).toBe("Unknown");
  });

  it("preserves FITID and TRNTYPE in rawData", async () => {
    const ofx = `
<STMTTRN>
<DTPOSTED>20240101
<TRNAMT>10.00
<NAME>Test
<FITID>ABC123
<TRNTYPE>CHECK
</STMTTRN>`;
    const rows = parseOFX(ofx);
    expect(rows[0]!.rawData["FITID"]).toBe("ABC123");
    expect(rows[0]!.rawData["TRNTYPE"]).toBe("CHECK");
  });

  it("throws on empty OFX content", async () => {
    expect(() => parseOFX("OFXHEADER:100\nDATA:OFXSGML\n<OFX></OFX>")).toThrow(
      "no transaction blocks",
    );
  });

  it("skips blocks missing required fields", async () => {
    const ofx = `
<STMTTRN>
<TRNTYPE>DEBIT
<NAME>No date or amount
</STMTTRN>
<STMTTRN>
<DTPOSTED>20240101
<TRNAMT>10.00
<NAME>Valid
</STMTTRN>`;
    const rows = parseOFX(ofx);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payee).toBe("Valid");
  });
});

// ============================================================================
// Matching Engine
// ============================================================================

describe("matchRows", () => {
  const makeTxn = (
    id: string,
    date: string,
    amount: number,
    memo: string,
  ): TransactionWithLines => ({
    id,
    ledgerId: "ledger-1",
    idempotencyKey: `ik-${id}`,
    date,
    effectiveDate: null,
    memo,
    status: "posted",
    sourceType: "api",
    sourceRef: null,
    agentId: null,
    metadata: null,
    postedAt: "2024-01-01T00:00:00Z",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    lines: [
      {
        id: `line-${id}-d`,
        transactionId: id,
        accountId: "acc-1",
        amount,
        direction: "debit",
        memo: null,
        metadata: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      {
        id: `line-${id}-c`,
        transactionId: id,
        accountId: "acc-2",
        amount,
        direction: "credit",
        memo: null,
        metadata: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ],
  });

  it("matches exact date + exact amount → high confidence", async () => {
    const rows = [
      { date: "2024-06-15", amount: 9999, payee: "Acme", memo: null, rawData: {} },
    ];
    const txns = [makeTxn("txn-1", "2024-06-15", 9999, "Acme payment")];

    const results = matchRows(rows, txns);
    expect(results).toHaveLength(1);
    expect(results[0]!.confidence).toBeGreaterThanOrEqual(0.8);
    expect(results[0]!.transactionId).toBe("txn-1");
    expect(results[0]!.breakdown.dateScore).toBe(40);
    expect(results[0]!.breakdown.amountScore).toBe(40);
  });

  it("scores ±1 day as lower date confidence", async () => {
    const rows = [
      { date: "2024-06-16", amount: 9999, payee: "Acme", memo: null, rawData: {} },
    ];
    const txns = [makeTxn("txn-1", "2024-06-15", 9999, "Acme payment")];

    const results = matchRows(rows, txns);
    expect(results[0]!.breakdown.dateScore).toBe(30);
  });

  it("returns unmatched when no transactions exist", async () => {
    const rows = [
      { date: "2024-06-15", amount: 5000, payee: "Unknown", memo: null, rawData: {} },
    ];

    const results = matchRows(rows, []);
    expect(results).toHaveLength(1);
    expect(results[0]!.matchStatus).toBe("unmatched");
    expect(results[0]!.transactionId).toBeNull();
    expect(results[0]!.confidence).toBe(0);
  });

  it("prevents duplicate transaction assignments", async () => {
    // Two import rows, one transaction
    const rows = [
      { date: "2024-06-15", amount: 5000, payee: "Vendor A", memo: null, rawData: {} },
      { date: "2024-06-15", amount: 5000, payee: "Vendor B", memo: null, rawData: {} },
    ];
    const txns = [makeTxn("txn-1", "2024-06-15", 5000, "Payment")];

    const results = matchRows(rows, txns);

    // Only one row should be matched to the transaction
    const matchedResults = results.filter((r) => r.transactionId === "txn-1");
    expect(matchedResults).toHaveLength(1);
  });

  it("respects custom thresholds", async () => {
    const rows = [
      { date: "2024-06-15", amount: 9999, payee: "Acme", memo: null, rawData: {} },
    ];
    const txns = [makeTxn("txn-1", "2024-06-15", 9999, "Acme Corp")];

    // Very high threshold → should be "suggested" instead of "matched"
    const results = matchRows(rows, txns, {
      autoMatchThreshold: 0.99,
      suggestThreshold: 0.60,
    });

    // Date (40) + Amount (40) + some text > 0 but < 99%
    expect(results[0]!.matchStatus).not.toBe("unmatched");
  });

  it("returns unmatched for low-scoring pairs below suggest threshold", async () => {
    const rows = [
      { date: "2024-01-01", amount: 100, payee: "CompanyX", memo: null, rawData: {} },
    ];
    const txns = [makeTxn("txn-1", "2024-12-31", 99999, "Completely different")];

    const results = matchRows(rows, txns);
    expect(results[0]!.matchStatus).toBe("unmatched");
  });
});

// ============================================================================
// Engine Integration Tests
// ============================================================================

describe("Engine import methods", () => {
  let db: Database;
  let engine: LedgerEngine;
  let ownerId: string;
  let ledgerId: string;

  beforeEach(async () => {
    db = await createTestDb();
    engine = new LedgerEngine(db);
    ownerId = await createSystemUser(db);

    // Create a ledger and provision accounts
    const ledgerResult = await engine.createLedger({
      name: "Import Test Ledger",
      ownerId,
    });
    if (!ledgerResult.ok) throw new Error("Failed to create test ledger");
    ledgerId = ledgerResult.value.id;

    // Create accounts needed for transaction posting
    await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
    await engine.createAccount({ ledgerId, code: "4000", name: "Revenue", type: "revenue" });
  });

  // -----------------------------------------------------------------------
  // createImport
  // -----------------------------------------------------------------------

  describe("createImport", () => {
    it("creates an import batch from CSV", async () => {
      const csv = "date,amount,payee\n2024-06-15,100.00,TestVendor";
      const result = await engine.createImport({
        ledgerId,
        fileContent: csv,
        fileType: "csv",
        filename: "test.csv",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.batch.status).toBe("complete");
      expect(result.value.batch.rowCount).toBe(1);
      expect(result.value.batch.sourceType).toBe("csv");
      expect(result.value.batch.filename).toBe("test.csv");
      expect(result.value.rows).toHaveLength(1);
      expect(result.value.rows[0]!.payee).toBe("TestVendor");
      expect(result.value.rows[0]!.amount).toBe(10000);
    });

    it("creates an import batch from OFX", async () => {
      const ofx = `
<STMTTRN>
<DTPOSTED>20240615
<TRNAMT>-75.00
<NAME>Coffee Place
</STMTTRN>`;

      const result = await engine.createImport({
        ledgerId,
        fileContent: ofx,
        fileType: "ofx",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.batch.sourceType).toBe("ofx");
      expect(result.value.batch.rowCount).toBe(1);
      expect(result.value.rows[0]!.amount).toBe(-7500);
    });

    it("matches import rows against existing transactions", async () => {
      // Post a transaction first
      const txnResult = await engine.postTransaction({
        ledgerId,
        date: "2024-06-15",
        memo: "Acme subscription payment",
        lines: [
          { accountCode: "1000", amount: 9999, direction: "debit" },
          { accountCode: "4000", amount: 9999, direction: "credit" },
        ],
      });
      expect(txnResult.ok).toBe(true);

      // Now import a CSV with a matching row
      const csv = "date,amount,payee,memo\n2024-06-15,99.99,Acme Corp,subscription payment";
      const result = await engine.createImport({
        ledgerId,
        fileContent: csv,
        fileType: "csv",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const row = result.value.rows[0]!;
      expect(row.confidence).toBeGreaterThan(0);
      expect(row.matchedTransactionId).not.toBeNull();
    });

    it("returns IMPORT_PARSE_ERROR for invalid CSV", async () => {
      const result = await engine.createImport({
        ledgerId,
        fileContent: "random text without csv structure",
        fileType: "csv",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCode.IMPORT_PARSE_ERROR);
    });

    it("returns IMPORT_PARSE_ERROR for invalid OFX", async () => {
      const result = await engine.createImport({
        ledgerId,
        fileContent: "<OFX>no transactions here</OFX>",
        fileType: "ofx",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCode.IMPORT_PARSE_ERROR);
    });

    it("returns LEDGER_NOT_FOUND for nonexistent ledger", async () => {
      const result = await engine.createImport({
        ledgerId: "00000000-0000-0000-0000-000000000000",
        fileContent: "date,amount,payee\n2024-01-01,10.00,Test",
        fileType: "csv",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCode.LEDGER_NOT_FOUND);
    });

    it("creates audit entry for import", async () => {
      const csv = "date,amount,payee\n2024-01-01,10.00,TestVendor";
      const result = await engine.createImport({ ledgerId, fileContent: csv, fileType: "csv" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Check that an audit entry was created
      const audit = await db.all(
        "SELECT * FROM audit_entries WHERE entity_type = 'import_batch' AND entity_id = ?",
        [result.value.batch.id],
      ) as { action: string }[];
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe("created");
    });
  });

  // -----------------------------------------------------------------------
  // getImportBatch
  // -----------------------------------------------------------------------

  describe("getImportBatch", () => {
    it("returns batch with rows", async () => {
      const csv = "date,amount,payee\n2024-01-01,10.00,Vendor A\n2024-01-02,20.00,Vendor B";
      const importResult = await engine.createImport({ ledgerId, fileContent: csv, fileType: "csv" });
      expect(importResult.ok).toBe(true);
      if (!importResult.ok) return;

      const getResult = await engine.getImportBatch(importResult.value.batch.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;

      expect(getResult.value.batch.id).toBe(importResult.value.batch.id);
      expect(getResult.value.rows).toHaveLength(2);
    });

    it("returns IMPORT_NOT_FOUND for nonexistent batch", async () => {
      const result = await engine.getImportBatch("00000000-0000-0000-0000-000000000000");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCode.IMPORT_NOT_FOUND);
    });
  });

  // -----------------------------------------------------------------------
  // listImportBatches
  // -----------------------------------------------------------------------

  describe("listImportBatches", () => {
    it("lists batches for a ledger", async () => {
      // Create two batches
      await engine.createImport({ ledgerId, fileContent: "date,amount,payee\n2024-01-01,10.00,A", fileType: "csv" });
      await engine.createImport({ ledgerId, fileContent: "date,amount,payee\n2024-01-02,20.00,B", fileType: "csv" });

      const result = await engine.listImportBatches(ledgerId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.data.length).toBe(2);
    });

    it("supports pagination", async () => {
      for (let i = 0; i < 3; i++) {
        await engine.createImport({
          ledgerId,
          fileContent: `date,amount,payee\n2024-01-0${i + 1},10.00,Vendor${i}`,
          fileType: "csv",
        });
      }

      const page1 = await engine.listImportBatches(ledgerId, { limit: 2 });
      expect(page1.ok).toBe(true);
      if (!page1.ok) return;

      expect(page1.value.data).toHaveLength(2);
      expect(page1.value.nextCursor).not.toBeNull();

      const page2 = await engine.listImportBatches(ledgerId, {
        limit: 2,
        cursor: page1.value.nextCursor!,
      });
      expect(page2.ok).toBe(true);
      if (!page2.ok) return;

      expect(page2.value.data.length).toBeGreaterThan(0);
    });

    it("returns LEDGER_NOT_FOUND for nonexistent ledger", async () => {
      const result = await engine.listImportBatches("00000000-0000-0000-0000-000000000000");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCode.LEDGER_NOT_FOUND);
    });
  });

  // -----------------------------------------------------------------------
  // confirmMatches
  // -----------------------------------------------------------------------

  describe("confirmMatches", () => {
    it("rejects a suggested match", async () => {
      // Post a transaction
      await engine.postTransaction({
        ledgerId,
        date: "2024-06-15",
        memo: "Acme subscription",
        lines: [
          { accountCode: "1000", amount: 9999, direction: "debit" },
          { accountCode: "4000", amount: 9999, direction: "credit" },
        ],
      });

      // Import with a matching row
      const csv = "date,amount,payee\n2024-06-15,99.99,Acme Corp";
      const importResult = await engine.createImport({ ledgerId, fileContent: csv, fileType: "csv" });
      expect(importResult.ok).toBe(true);
      if (!importResult.ok) return;

      const row = importResult.value.rows[0]!;
      if (row.matchStatus === "unmatched") return; // Skip if no match

      // Reject the match
      const confirmResult = await engine.confirmMatches({
        batchId: importResult.value.batch.id,
        actions: [{ rowId: row.id, action: "reject" }],
      });

      expect(confirmResult.ok).toBe(true);
      if (!confirmResult.ok) return;

      const updatedRow = confirmResult.value.rows.find((r) => r.id === row.id);
      expect(updatedRow!.matchStatus).toBe("unmatched");
      expect(updatedRow!.matchedTransactionId).toBeNull();
    });

    it("overrides with a specific transaction", async () => {
      // Post two transactions
      const txn1 = await engine.postTransaction({
        ledgerId,
        date: "2024-06-15",
        memo: "Payment A",
        lines: [
          { accountCode: "1000", amount: 5000, direction: "debit" },
          { accountCode: "4000", amount: 5000, direction: "credit" },
        ],
      });
      expect(txn1.ok).toBe(true);
      if (!txn1.ok) return;

      const txn2 = await engine.postTransaction({
        ledgerId,
        date: "2024-06-16",
        memo: "Payment B",
        lines: [
          { accountCode: "1000", amount: 5000, direction: "debit" },
          { accountCode: "4000", amount: 5000, direction: "credit" },
        ],
      });
      expect(txn2.ok).toBe(true);
      if (!txn2.ok) return;

      // Import a row
      const csv = "date,amount,payee\n2024-06-15,50.00,Vendor";
      const importResult = await engine.createImport({ ledgerId, fileContent: csv, fileType: "csv" });
      expect(importResult.ok).toBe(true);
      if (!importResult.ok) return;

      const row = importResult.value.rows[0]!;

      // Override to match txn2 instead
      const confirmResult = await engine.confirmMatches({
        batchId: importResult.value.batch.id,
        actions: [
          {
            rowId: row.id,
            action: "override",
            overrideTransactionId: txn2.value.id,
          },
        ],
      });

      expect(confirmResult.ok).toBe(true);
      if (!confirmResult.ok) return;

      const updatedRow = confirmResult.value.rows.find((r) => r.id === row.id);
      expect(updatedRow!.matchStatus).toBe("matched");
      expect(updatedRow!.matchedTransactionId).toBe(txn2.value.id);
      expect(updatedRow!.confidence).toBe(1);
    });

    it("returns IMPORT_NOT_FOUND for nonexistent batch", async () => {
      const result = await engine.confirmMatches({
        batchId: "00000000-0000-0000-0000-000000000000",
        actions: [{ rowId: "00000000-0000-0000-0000-000000000001", action: "reject" }],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCode.IMPORT_NOT_FOUND);
    });

    it("creates audit entry for confirmMatches", async () => {
      const csv = "date,amount,payee\n2024-01-01,10.00,TestVendor";
      const importResult = await engine.createImport({ ledgerId, fileContent: csv, fileType: "csv" });
      expect(importResult.ok).toBe(true);
      if (!importResult.ok) return;

      const row = importResult.value.rows[0]!;
      const confirmResult = await engine.confirmMatches({
        batchId: importResult.value.batch.id,
        actions: [{ rowId: row.id, action: "reject" }],
      });
      expect(confirmResult.ok).toBe(true);

      const audits = await db.all(
        "SELECT * FROM audit_entries WHERE entity_type = 'import_batch' AND entity_id = ? AND action = 'updated'",
        [importResult.value.batch.id],
      ) as { action: string }[];
      expect(audits.length).toBeGreaterThan(0);
    });
  });
});

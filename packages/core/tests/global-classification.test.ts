// ---------------------------------------------------------------------------
// Global crowdsourced classification intelligence tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteDatabase, LedgerEngine } from "../src/index.js";
import type { Database } from "../src/index.js";
import {
  recordClassification,
  queryGlobalClassification,
  findMatchingAccount,
} from "../src/classification/global.js";
import type { GlobalClassificationResult } from "../src/classification/global.js";

// ---------------------------------------------------------------------------
// Migration setup
// ---------------------------------------------------------------------------

const migration001 = readFileSync(
  resolve(__dirname, "../src/db/migrations/001_initial_schema.sqlite.sql"),
  "utf-8",
);
const migration004 = readFileSync(
  resolve(__dirname, "../src/db/migrations/004_bank_feeds.sqlite.sql"),
  "utf-8",
);
const migration006 = readFileSync(
  resolve(__dirname, "../src/db/migrations/006_multi_currency.sqlite.sql"),
  "utf-8",
);
const migration007 = readFileSync(
  resolve(__dirname, "../src/db/migrations/007_conversations.sqlite.sql"),
  "utf-8",
);
const migration008 = readFileSync(
  resolve(__dirname, "../src/db/migrations/008_classification.sqlite.sql"),
  "utf-8",
);
const migration014 = readFileSync(
  resolve(__dirname, "../src/db/migrations/014_global_classifications.sqlite.sql"),
  "utf-8",
);

const createTestDb = async (): Promise<Database> => {
  const db = await SqliteDatabase.create();
  const schemaWithoutPragmas = migration001
    .split("\n")
    .filter((line) => !line.trim().startsWith("PRAGMA"))
    .join("\n");
  db.exec(schemaWithoutPragmas);
  db.exec(migration004);
  db.exec(migration006);
  db.exec(migration007);
  db.exec(migration008);
  db.exec(migration014);
  return db;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let db: Database;
let engine: LedgerEngine;
let ledgerId: string;
let userId: string;
let hostingAccountId: string;
let saasAccountId: string;
let infraAccountId: string;
let expenseAccountId: string;

const setupLedger = async () => {
  db = await createTestDb();
  engine = new LedgerEngine(db);

  userId = "00000000-0000-7000-8000-000000000001";
  db.run(
    `INSERT INTO users (id, email, name, auth_provider, auth_provider_id)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, "test@example.com", "Test User", "test", "test-001"],
  );

  const ledgerResult = await engine.createLedger({
    name: "Test Ledger",
    currency: "AUD",
    ownerId: userId,
  });
  ledgerId = ledgerResult.value!.id;

  const hostingResult = await engine.createAccount({
    ledgerId,
    name: "Hosting",
    code: "6000",
    type: "expense",
    normalBalance: "debit",
  });
  hostingAccountId = hostingResult.value!.id;

  const saasResult = await engine.createAccount({
    ledgerId,
    name: "SaaS Subscriptions",
    code: "6100",
    type: "expense",
    normalBalance: "debit",
  });
  saasAccountId = saasResult.value!.id;

  const infraResult = await engine.createAccount({
    ledgerId,
    name: "Infrastructure",
    code: "6200",
    type: "expense",
    normalBalance: "debit",
  });
  infraAccountId = infraResult.value!.id;

  const expResult = await engine.createAccount({
    ledgerId,
    name: "General Expenses",
    code: "6300",
    type: "expense",
    normalBalance: "debit",
  });
  expenseAccountId = expResult.value!.id;
};

// ---------------------------------------------------------------------------
// recordClassification tests
// ---------------------------------------------------------------------------

describe("Global Classification Intelligence", () => {
  beforeEach(setupLedger);

  describe("recordClassification", () => {
    it("creates a new row on first classification", async () => {
      await recordClassification(db, "VERCEL", "expense", "Hosting", "6000", false);

      const row = await db.get<{ total_classifications: number; confidence: number }>(
        "SELECT total_classifications, confidence FROM global_classifications WHERE canonical_merchant = 'VERCEL'",
      );
      expect(row).not.toBeNull();
      expect(row!.total_classifications).toBe(1);
      expect(row!.confidence).toBe(1.0);
    });

    it("increments count on second classification to same category", async () => {
      await recordClassification(db, "VERCEL", "expense", "Hosting", "6000", false);
      await recordClassification(db, "VERCEL", "expense", "Hosting", "6000", false);

      const row = await db.get<{ total_classifications: number; is_business_count: number }>(
        "SELECT total_classifications, is_business_count FROM global_classifications WHERE canonical_merchant = 'VERCEL' AND account_name = 'Hosting'",
      );
      expect(row!.total_classifications).toBe(2);
      expect(row!.is_business_count).toBe(2);
    });

    it("tracks split between personal and business", async () => {
      // 3 business + 1 personal = confidence 0.75 (3/4)
      await recordClassification(db, "NETFLIX", "expense", "Entertainment", "7000", false);
      await recordClassification(db, "NETFLIX", "expense", "Entertainment", "7000", false);
      await recordClassification(db, "NETFLIX", "expense", "Entertainment", "7000", false);
      await recordClassification(db, "NETFLIX", "expense", "Entertainment", "7000", true);

      const row = await db.get<{
        is_personal_count: number;
        is_business_count: number;
        total_classifications: number;
        confidence: number;
      }>(
        "SELECT * FROM global_classifications WHERE canonical_merchant = 'NETFLIX' AND account_name = 'Entertainment'",
      );
      expect(row!.is_personal_count).toBe(1);
      expect(row!.is_business_count).toBe(3);
      expect(row!.total_classifications).toBe(4);
      expect(row!.confidence).toBe(0.75); // 3/4
    });

    it("creates separate rows for different categories", async () => {
      await recordClassification(db, "AMAZON", "expense", "Hosting", "6000", false);
      await recordClassification(db, "AMAZON", "expense", "Office Supplies", "6300", false);

      const rows = await db.all<{ account_name: string }>(
        "SELECT account_name FROM global_classifications WHERE canonical_merchant = 'AMAZON'",
      );
      expect(rows.length).toBe(2);
    });

    it("normalises merchant name to uppercase", async () => {
      await recordClassification(db, "vercel", "expense", "Hosting", "6000", false);

      const row = await db.get<{ canonical_merchant: string }>(
        "SELECT canonical_merchant FROM global_classifications LIMIT 1",
      );
      expect(row!.canonical_merchant).toBe("VERCEL");
    });
  });

  // -------------------------------------------------------------------------
  // queryGlobalClassification tests
  // -------------------------------------------------------------------------

  describe("queryGlobalClassification", () => {
    it("returns result when confidence >= 0.85 and total >= 3", async () => {
      // 4 business classifications for VERCEL → Hosting = confidence 1.0
      for (let i = 0; i < 4; i++) {
        await recordClassification(db, "VERCEL", "expense", "Hosting", "6000", false);
      }

      const result = await queryGlobalClassification(db, "VERCEL");
      expect(result).not.toBeNull();
      expect(result!.accountName).toBe("Hosting");
      expect(result!.accountType).toBe("expense");
      expect(result!.suggestedAccountCode).toBe("6000");
      expect(result!.isPersonal).toBe(false);
      expect(result!.confidence).toBe(1.0);
    });

    it("returns null when confidence < 0.85", async () => {
      // 2 business + 2 personal = confidence 0.5
      await recordClassification(db, "NETFLIX", "expense", "Entertainment", "7000", false);
      await recordClassification(db, "NETFLIX", "expense", "Entertainment", "7000", false);
      await recordClassification(db, "NETFLIX", "expense", "Entertainment", "7000", true);
      await recordClassification(db, "NETFLIX", "expense", "Entertainment", "7000", true);

      const result = await queryGlobalClassification(db, "NETFLIX");
      expect(result).toBeNull();
    });

    it("returns null when fewer than 3 total classifications", async () => {
      await recordClassification(db, "VERCEL", "expense", "Hosting", "6000", false);
      await recordClassification(db, "VERCEL", "expense", "Hosting", "6000", false);

      const result = await queryGlobalClassification(db, "VERCEL");
      expect(result).toBeNull(); // only 2 total, need >= 3
    });

    it("returns the highest-count category when multiple exist", async () => {
      // 4 for Hosting (confidence 1.0), 1 for Office (confidence 1.0 but total 1)
      for (let i = 0; i < 4; i++) {
        await recordClassification(db, "AWS", "expense", "Hosting", "6000", false);
      }
      await recordClassification(db, "AWS", "expense", "Office Supplies", "6300", false);

      const result = await queryGlobalClassification(db, "AWS");
      expect(result).not.toBeNull();
      expect(result!.accountName).toBe("Hosting");
      expect(result!.confidence).toBe(1.0);
    });

    it("marks as personal when personal count exceeds business count", async () => {
      for (let i = 0; i < 4; i++) {
        await recordClassification(db, "SPOTIFY", "expense", "Entertainment", "7000", true);
      }

      const result = await queryGlobalClassification(db, "SPOTIFY");
      expect(result).not.toBeNull();
      expect(result!.isPersonal).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // findMatchingAccount tests
  // -------------------------------------------------------------------------

  describe("findMatchingAccount", () => {
    const userAccounts = [
      { id: "a1", code: "6000", name: "Hosting", type: "expense" },
      { id: "a2", code: "6100", name: "SaaS Subscriptions", type: "expense" },
      { id: "a3", code: "6200", name: "Infrastructure", type: "expense" },
      { id: "a4", code: "1000", name: "Cash", type: "asset" },
    ];

    it("matches by exact account name (case-insensitive)", () => {
      const globalResult: GlobalClassificationResult = {
        accountType: "expense",
        accountName: "Hosting",
        suggestedAccountCode: "6000",
        isPersonal: false,
        confidence: 0.95,
      };

      const match = findMatchingAccount(userAccounts, globalResult);
      expect(match).not.toBeNull();
      expect(match!.id).toBe("a1");
    });

    it("matches via synonym: Infrastructure ↔ Hosting", () => {
      const globalResult: GlobalClassificationResult = {
        accountType: "expense",
        accountName: "Cloud Services", // synonym of Hosting / Infrastructure
        suggestedAccountCode: "6000",
        isPersonal: false,
        confidence: 0.90,
      };

      const match = findMatchingAccount(userAccounts, globalResult);
      expect(match).not.toBeNull();
      // Should match either Hosting or Infrastructure (both in the synonym group)
      expect(["a1", "a3"]).toContain(match!.id);
    });

    it("matches via synonym: SaaS Tools → SaaS Subscriptions", () => {
      const globalResult: GlobalClassificationResult = {
        accountType: "expense",
        accountName: "SaaS Tools", // synonym of SaaS Subscriptions / Software Tools
        suggestedAccountCode: "6100",
        isPersonal: false,
        confidence: 0.90,
      };

      const match = findMatchingAccount(userAccounts, globalResult);
      expect(match).not.toBeNull();
      expect(match!.id).toBe("a2");
    });

    it("returns null when no match and no synonyms apply", () => {
      const globalResult: GlobalClassificationResult = {
        accountType: "expense",
        accountName: "Rare Category XYZ",
        suggestedAccountCode: "9999",
        isPersonal: false,
        confidence: 0.90,
      };

      const match = findMatchingAccount(userAccounts, globalResult);
      expect(match).toBeNull();
    });

    it("respects account type — won't match expense to asset", () => {
      const globalResult: GlobalClassificationResult = {
        accountType: "asset", // only Cash is an asset
        accountName: "Hosting", // but this name only exists as expense
        suggestedAccountCode: "6000",
        isPersonal: false,
        confidence: 0.90,
      };

      const match = findMatchingAccount(userAccounts, globalResult);
      expect(match).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Pipeline integration test
  // -------------------------------------------------------------------------

  describe("Pipeline Integration", () => {
    it("classifies via global_consensus layer when no rules match", async () => {
      // Seed the global_classifications table directly — simulate 5 users
      // classifying VERCEL as Hosting with high confidence
      for (let i = 0; i < 5; i++) {
        await recordClassification(db, "VERCEL", "expense", "Hosting", "6000", false);
      }

      // Verify no user rules exist for VERCEL
      const rulesResult = await engine.listClassificationRules(ledgerId);
      expect(rulesResult.value!.length).toBe(0);

      // The user's ledger has a "Hosting" account — should match via global consensus
      const result = await engine.classifyTransaction(ledgerId, {
        description: "VERCEL",
      });

      expect(result.ok).toBe(true);
      expect(result.value).not.toBeNull();
      expect(result.value!.layer).toBe("global_consensus");
      expect(result.value!.accountId).toBe(hostingAccountId);
      expect(result.value!.accountCode).toBe("6000");
      expect(result.value!.accountName).toBe("Hosting");
      expect(result.value!.confidence).toBe(1.0);
      expect(result.value!.ruleId).toBeNull();
    });

    it("classifies via synonym when user account name differs", async () => {
      // Global consensus says "Cloud Services" but user has "Hosting" or "Infrastructure"
      for (let i = 0; i < 5; i++) {
        await recordClassification(db, "DIGITALOCEAN", "expense", "Cloud Services", "6200", false);
      }

      const result = await engine.classifyTransaction(ledgerId, {
        description: "DIGITALOCEAN",
      });

      expect(result.ok).toBe(true);
      expect(result.value).not.toBeNull();
      expect(result.value!.layer).toBe("global_consensus");
      // Should match to either Hosting or Infrastructure (both are synonyms of Cloud Services)
      expect([hostingAccountId, infraAccountId]).toContain(result.value!.accountId);
    });

    it("user rules take precedence over global consensus", async () => {
      // Global consensus says VERCEL → Hosting
      for (let i = 0; i < 5; i++) {
        await recordClassification(db, "VERCEL", "expense", "Hosting", "6000", false);
      }

      // But user has a rule saying VERCEL → SaaS Subscriptions
      await engine.createClassificationRule({
        ledgerId,
        ruleType: "exact",
        field: "description",
        pattern: "VERCEL",
        targetAccountId: saasAccountId,
      });

      const result = await engine.classifyTransaction(ledgerId, {
        description: "VERCEL",
      });

      expect(result.ok).toBe(true);
      expect(result.value).not.toBeNull();
      // User's rule should win
      expect(result.value!.layer).toBe("exact_rule");
      expect(result.value!.accountId).toBe(saasAccountId);
    });

    it("skips global consensus when no matching account in user chart", async () => {
      // Global says VERCEL → "Unique Category" which doesn't exist in user's accounts
      for (let i = 0; i < 5; i++) {
        await recordClassification(db, "RARE_MERCHANT", "expense", "Unique Category", "9999", false);
      }

      const result = await engine.classifyTransaction(ledgerId, {
        description: "RARE_MERCHANT",
      });

      expect(result.ok).toBe(true);
      expect(result.value).toBeNull(); // No match — falls through to null
    });

    it("records classification from manual bank transaction classify", async () => {
      // Setup bank connection, account, and transaction
      const connId = "conn-global-001";
      const bankAcctId = "bacct-global-001";
      const btxnId = "btxn-global-001";

      db.run(
        `INSERT INTO bank_connections (id, ledger_id, provider, provider_connection_id,
           institution_id, institution_name, status, created_at, updated_at)
         VALUES (?, ?, 'test', 'prov-conn-g1', 'inst-1', 'Test Bank', 'active', datetime('now'), datetime('now'))`,
        [connId, ledgerId],
      );
      db.run(
        `INSERT INTO bank_accounts (id, connection_id, ledger_id, provider_account_id,
           name, account_number, type, currency, current_balance, created_at, updated_at)
         VALUES (?, ?, ?, 'prov-acct-g1', 'Test Account', '1234', 'transaction', 'AUD', 0, datetime('now'), datetime('now'))`,
        [bankAcctId, connId, ledgerId],
      );
      db.run(
        `INSERT INTO bank_transactions (id, bank_account_id, ledger_id, provider_transaction_id,
           date, amount, type, description, status, is_personal, raw_data, created_at, updated_at)
         VALUES (?, ?, ?, 'ptxn-g1', '2024-01-01', 5000, 'debit', 'VERCEL INC', 'pending', 0, '{}', datetime('now'), datetime('now'))`,
        [btxnId, bankAcctId, ledgerId],
      );

      // Manually classify the bank transaction
      await engine.classifyBankTransaction(btxnId, hostingAccountId, false);

      // Wait briefly for the fire-and-forget to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify a global classification row was created
      const row = await db.get<{ canonical_merchant: string; account_name: string; total_classifications: number }>(
        "SELECT * FROM global_classifications WHERE account_name = 'Hosting'",
      );
      expect(row).not.toBeNull();
      expect(row!.total_classifications).toBe(1);
    });
  });
});

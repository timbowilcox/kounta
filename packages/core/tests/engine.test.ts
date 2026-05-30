// ---------------------------------------------------------------------------
// LedgerEngine unit tests
//
// Core invariants under test:
// 1. Balanced transactions post successfully (debits === credits)
// 2. Unbalanced transactions are rejected
// 3. Idempotency: re-posting with same key returns original without side effects
// 4. Balance calculation: debit-normal vs credit-normal accounts
// 5. Account tree management: creation, duplicate code rejection
// 6. Period close enforcement
// 7. Transaction reversal creates offsetting entries
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { SqliteDatabase } from "../src/db/sqlite.js";
import { LedgerEngine } from "../src/engine/index.js";
import { ErrorCode } from "../src/errors/index.js";
import type { Database } from "../src/db/database.js";
import { createFullTestDb } from "./helpers/migrate.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Create a fresh in-memory database with the FULL registered schema applied,
 * derived from the single source of truth in src/db/migration-manifest.ts (the
 * same set production applies) — not a hand-picked subset.
 */
const createTestDb = (): Promise<Database> => createFullTestDb();

/** Create a system user (ledgers require an owner_id foreign key) */
const createSystemUser = async (db: Database): Promise<string> => {
  const userId = "00000000-0000-7000-8000-000000000001";
  await db.run(
    `INSERT INTO users (id, email, name, auth_provider, auth_provider_id)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, "system@test.com", "System", "test", "test-001"]
  );
  return userId;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LedgerEngine", () => {
  let db: Database;
  let engine: LedgerEngine;
  let ownerId: string;

  beforeEach(async () => {
    db = await createTestDb();
    engine = new LedgerEngine(db);
    ownerId = await createSystemUser(db);
  });

  // -----------------------------------------------------------------------
  // Ledger creation
  // -----------------------------------------------------------------------

  describe("createLedger", () => {
    it("creates a ledger with defaults", async () => {
      const result = await engine.createLedger({ name: "Test Ledger", ownerId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.name).toBe("Test Ledger");
      expect(result.value.currency).toBe("USD");
      expect(result.value.accountingBasis).toBe("accrual");
      expect(result.value.fiscalYearStart).toBe(1);
      expect(result.value.status).toBe("active");
      expect(result.value.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    });

    it("creates a ledger with custom parameters", async () => {
      const result = await engine.createLedger({
        name: "EUR Ledger",
        ownerId,
        currency: "EUR",
        fiscalYearStart: 4,
        accountingBasis: "cash",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.currency).toBe("EUR");
      expect(result.value.fiscalYearStart).toBe(4);
      expect(result.value.accountingBasis).toBe("cash");
    });
  });

  // -----------------------------------------------------------------------
  // Account creation
  // -----------------------------------------------------------------------

  describe("createAccount", () => {
    it("creates an account with auto-derived normal balance", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");

      const result = await engine.createAccount({
        ledgerId: ledger.value.id,
        code: "1000",
        name: "Cash",
        type: "asset",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.code).toBe("1000");
      expect(result.value.type).toBe("asset");
      expect(result.value.normalBalance).toBe("debit"); // auto-derived
    });

    it("auto-derives credit normal balance for revenue accounts", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");

      const result = await engine.createAccount({
        ledgerId: ledger.value.id,
        code: "4000",
        name: "Sales Revenue",
        type: "revenue",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.normalBalance).toBe("credit"); // auto-derived
    });

    it("rejects duplicate account codes within a ledger", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");

      await engine.createAccount({
        ledgerId: ledger.value.id,
        code: "1000",
        name: "Cash",
        type: "asset",
      });

      const duplicate = await engine.createAccount({
        ledgerId: ledger.value.id,
        code: "1000",
        name: "Cash Duplicate",
        type: "asset",
      });

      expect(duplicate.ok).toBe(false);
      if (duplicate.ok) return;
      expect(duplicate.error.code).toBe(ErrorCode.DUPLICATE_ACCOUNT_CODE);
    });

    it("creates child accounts with parent reference", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");

      const parent = await engine.createAccount({
        ledgerId: ledger.value.id,
        code: "1000",
        name: "Cash & Bank",
        type: "asset",
      });
      expect(parent.ok).toBe(true);

      const child = await engine.createAccount({
        ledgerId: ledger.value.id,
        code: "1010",
        name: "Checking Account",
        type: "asset",
        parentCode: "1000",
      });
      expect(child.ok).toBe(true);
      if (!child.ok) return;
      expect(child.value.parentId).toBe((parent as { ok: true; value: { id: string } }).value.id);
    });
  });

  // -----------------------------------------------------------------------
  // Transaction posting — balanced
  // -----------------------------------------------------------------------

  describe("postTransaction — balanced", () => {
    it("posts a balanced transaction successfully", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
      await engine.createAccount({ ledgerId, code: "4000", name: "Revenue", type: "revenue" });

      const result = await engine.postTransaction({
        ledgerId,
        date: "2025-01-15",
        memo: "Client payment",
        lines: [
          { accountCode: "1000", amount: 50000, direction: "debit" },
          { accountCode: "4000", amount: 50000, direction: "credit" },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Verify the transaction
      expect(result.value.memo).toBe("Client payment");
      expect(result.value.status).toBe("posted");
      expect(result.value.lines).toHaveLength(2);

      // Assert debits === credits
      const debits = result.value.lines
        .filter((l) => l.direction === "debit")
        .reduce((sum, l) => sum + l.amount, 0);
      const credits = result.value.lines
        .filter((l) => l.direction === "credit")
        .reduce((sum, l) => sum + l.amount, 0);
      expect(debits).toBe(credits);
      expect(debits).toBe(50000);
    });

    it("posts a multi-line balanced transaction", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
      await engine.createAccount({ ledgerId, code: "2000", name: "Accounts Payable", type: "liability" });
      await engine.createAccount({ ledgerId, code: "5000", name: "Office Supplies", type: "expense" });

      const result = await engine.postTransaction({
        ledgerId,
        date: "2025-01-15",
        memo: "Office supplies purchased partially on credit",
        lines: [
          { accountCode: "5000", amount: 10000, direction: "debit" },
          { accountCode: "1000", amount: 3000, direction: "credit" },
          { accountCode: "2000", amount: 7000, direction: "credit" },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.lines).toHaveLength(3);

      const debits = result.value.lines
        .filter((l) => l.direction === "debit")
        .reduce((sum, l) => sum + l.amount, 0);
      const credits = result.value.lines
        .filter((l) => l.direction === "credit")
        .reduce((sum, l) => sum + l.amount, 0);
      expect(debits).toBe(credits);
      expect(debits).toBe(10000);
    });
  });

  // -----------------------------------------------------------------------
  // Transaction posting — unbalanced (MUST be rejected)
  // -----------------------------------------------------------------------

  describe("postTransaction — unbalanced", () => {
    it("rejects an unbalanced transaction where debits > credits", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
      await engine.createAccount({ ledgerId, code: "4000", name: "Revenue", type: "revenue" });

      const result = await engine.postTransaction({
        ledgerId,
        date: "2025-01-15",
        memo: "Unbalanced - should fail",
        lines: [
          { accountCode: "1000", amount: 50000, direction: "debit" },
          { accountCode: "4000", amount: 30000, direction: "credit" },
        ],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCode.UNBALANCED_TRANSACTION);
    });

    it("rejects an unbalanced transaction where credits > debits", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
      await engine.createAccount({ ledgerId, code: "4000", name: "Revenue", type: "revenue" });

      const result = await engine.postTransaction({
        ledgerId,
        date: "2025-01-15",
        memo: "Unbalanced credits - should fail",
        lines: [
          { accountCode: "1000", amount: 10000, direction: "debit" },
          { accountCode: "4000", amount: 20000, direction: "credit" },
        ],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCode.UNBALANCED_TRANSACTION);
    });

    it("rejects a single-line transaction", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });

      const result = await engine.postTransaction({
        ledgerId,
        date: "2025-01-15",
        memo: "Single line - invalid",
        lines: [{ accountCode: "1000", amount: 50000, direction: "debit" }],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });

  // -----------------------------------------------------------------------
  // Idempotency
  // -----------------------------------------------------------------------

  describe("idempotency", () => {
    it("returns the original transaction when re-posting with the same idempotency key", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
      await engine.createAccount({ ledgerId, code: "4000", name: "Revenue", type: "revenue" });

      const input = {
        ledgerId,
        date: "2025-01-15",
        memo: "Idempotent payment",
        idempotencyKey: "payment-001",
        lines: [
          { accountCode: "1000", amount: 25000, direction: "debit" as const },
          { accountCode: "4000", amount: 25000, direction: "credit" as const },
        ],
      };

      const first = await engine.postTransaction(input);
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const second = await engine.postTransaction(input);
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      // Same transaction ID — no duplicate created
      expect(second.value.id).toBe(first.value.id);
    });

    it("does not create duplicate transactions on idempotent replay", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
      await engine.createAccount({ ledgerId, code: "4000", name: "Revenue", type: "revenue" });

      const input = {
        ledgerId,
        date: "2025-01-15",
        memo: "Idempotent payment",
        idempotencyKey: "payment-002",
        lines: [
          { accountCode: "1000", amount: 10000, direction: "debit" as const },
          { accountCode: "4000", amount: 10000, direction: "credit" as const },
        ],
      };

      await engine.postTransaction(input);
      await engine.postTransaction(input);
      await engine.postTransaction(input);

      // Should still be only 1 transaction in the ledger
      const list = await engine.listTransactions(ledgerId);
      expect(list.ok).toBe(true);
      if (!list.ok) return;
      expect(list.value.data).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Balance calculation
  // -----------------------------------------------------------------------

  describe("balance calculation", () => {
    it("computes correct balance for debit-normal account (asset)", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      const cashResult = await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
      await engine.createAccount({ ledgerId, code: "4000", name: "Revenue", type: "revenue" });

      if (!cashResult.ok) throw new Error("Failed to create account");

      // Post $500 received as revenue
      await engine.postTransaction({
        ledgerId,
        date: "2025-01-15",
        memo: "Payment received",
        lines: [
          { accountCode: "1000", amount: 50000, direction: "debit" },
          { accountCode: "4000", amount: 50000, direction: "credit" },
        ],
      });

      const balance = await engine.getBalance(cashResult.value.id);
      expect(balance.ok).toBe(true);
      if (!balance.ok) return;
      expect(balance.value).toBe(50000); // $500.00 debit balance
    });

    it("computes correct balance for credit-normal account (revenue)", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
      const revResult = await engine.createAccount({ ledgerId, code: "4000", name: "Revenue", type: "revenue" });

      if (!revResult.ok) throw new Error("Failed to create account");

      await engine.postTransaction({
        ledgerId,
        date: "2025-01-15",
        memo: "Payment received",
        lines: [
          { accountCode: "1000", amount: 50000, direction: "debit" },
          { accountCode: "4000", amount: 50000, direction: "credit" },
        ],
      });

      const balance = await engine.getBalance(revResult.value.id);
      expect(balance.ok).toBe(true);
      if (!balance.ok) return;
      expect(balance.value).toBe(50000); // $500.00 credit balance (positive for credit-normal)
    });

    it("computes balance after multiple transactions", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      const cashResult = await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
      await engine.createAccount({ ledgerId, code: "4000", name: "Revenue", type: "revenue" });
      await engine.createAccount({ ledgerId, code: "5000", name: "Expenses", type: "expense" });

      if (!cashResult.ok) throw new Error("Failed to create account");

      // Receive $1000
      await engine.postTransaction({
        ledgerId,
        date: "2025-01-15",
        memo: "Payment in",
        lines: [
          { accountCode: "1000", amount: 100000, direction: "debit" },
          { accountCode: "4000", amount: 100000, direction: "credit" },
        ],
      });

      // Spend $350
      await engine.postTransaction({
        ledgerId,
        date: "2025-01-16",
        memo: "Expense payment",
        lines: [
          { accountCode: "5000", amount: 35000, direction: "debit" },
          { accountCode: "1000", amount: 35000, direction: "credit" },
        ],
      });

      const balance = await engine.getBalance(cashResult.value.id);
      expect(balance.ok).toBe(true);
      if (!balance.ok) return;
      expect(balance.value).toBe(65000); // $1000 - $350 = $650
    });

    it("computes balance with as-of date filter", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      const cashResult = await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
      await engine.createAccount({ ledgerId, code: "4000", name: "Revenue", type: "revenue" });

      if (!cashResult.ok) throw new Error("Failed to create account");

      await engine.postTransaction({
        ledgerId,
        date: "2025-01-15",
        memo: "Jan payment",
        lines: [
          { accountCode: "1000", amount: 50000, direction: "debit" },
          { accountCode: "4000", amount: 50000, direction: "credit" },
        ],
      });

      await engine.postTransaction({
        ledgerId,
        date: "2025-02-15",
        memo: "Feb payment",
        lines: [
          { accountCode: "1000", amount: 30000, direction: "debit" },
          { accountCode: "4000", amount: 30000, direction: "credit" },
        ],
      });

      // Balance as of Jan 31 — only the first transaction
      const janBalance = await engine.getBalance(cashResult.value.id, "2025-01-31");
      expect(janBalance.ok).toBe(true);
      if (!janBalance.ok) return;
      expect(janBalance.value).toBe(50000);

      // Balance as of Feb 28 — both transactions
      const febBalance = await engine.getBalance(cashResult.value.id, "2025-02-28");
      expect(febBalance.ok).toBe(true);
      if (!febBalance.ok) return;
      expect(febBalance.value).toBe(80000);
    });

    it("returns balance via listAccounts", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
      await engine.createAccount({ ledgerId, code: "4000", name: "Revenue", type: "revenue" });

      await engine.postTransaction({
        ledgerId,
        date: "2025-01-15",
        memo: "Payment",
        lines: [
          { accountCode: "1000", amount: 75000, direction: "debit" },
          { accountCode: "4000", amount: 75000, direction: "credit" },
        ],
      });

      const accounts = await engine.listAccounts(ledgerId);
      expect(accounts.ok).toBe(true);
      if (!accounts.ok) return;

      const cash = accounts.value.find((a) => a.code === "1000");
      const revenue = accounts.value.find((a) => a.code === "4000");
      expect(cash?.balance).toBe(75000);
      expect(revenue?.balance).toBe(75000);
    });
  });

  // -----------------------------------------------------------------------
  // Period close
  // -----------------------------------------------------------------------

  describe("period close", () => {
    it("rejects transactions posted on or before the close date", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      // Manually close the period through Jan 31
      await db.run("UPDATE ledgers SET closed_through = ? WHERE id = ?", [
        "2025-01-31",
        ledgerId,
      ]);

      await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
      await engine.createAccount({ ledgerId, code: "4000", name: "Revenue", type: "revenue" });

      const result = await engine.postTransaction({
        ledgerId,
        date: "2025-01-15",
        memo: "Should be rejected — period closed",
        lines: [
          { accountCode: "1000", amount: 50000, direction: "debit" },
          { accountCode: "4000", amount: 50000, direction: "credit" },
        ],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCode.PERIOD_CLOSED);
    });

    it("allows transactions posted after the close date", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      await db.run("UPDATE ledgers SET closed_through = ? WHERE id = ?", [
        "2025-01-31",
        ledgerId,
      ]);

      await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
      await engine.createAccount({ ledgerId, code: "4000", name: "Revenue", type: "revenue" });

      const result = await engine.postTransaction({
        ledgerId,
        date: "2025-02-01",
        memo: "Should succeed — after close date",
        lines: [
          { accountCode: "1000", amount: 50000, direction: "debit" },
          { accountCode: "4000", amount: 50000, direction: "credit" },
        ],
      });

      expect(result.ok).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Transaction reversal
  // -----------------------------------------------------------------------

  describe("reverseTransaction", () => {
    it("creates an offsetting reversal transaction", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      const cashResult = await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
      await engine.createAccount({ ledgerId, code: "4000", name: "Revenue", type: "revenue" });

      if (!cashResult.ok) throw new Error("Failed to create account");

      const txn = await engine.postTransaction({
        ledgerId,
        date: "2025-01-15",
        memo: "Payment to reverse",
        lines: [
          { accountCode: "1000", amount: 50000, direction: "debit" },
          { accountCode: "4000", amount: 50000, direction: "credit" },
        ],
      });

      if (!txn.ok) throw new Error("Failed to post transaction");

      const reversal = await engine.reverseTransaction(txn.value.id, "Duplicate payment");
      expect(reversal.ok).toBe(true);
      if (!reversal.ok) return;

      // Reversal should have flipped directions
      const debitLines = reversal.value.lines.filter((l) => l.direction === "debit");
      const creditLines = reversal.value.lines.filter((l) => l.direction === "credit");
      expect(debitLines).toHaveLength(1);
      expect(creditLines).toHaveLength(1);

      // Original was: Cash debit 50000, Revenue credit 50000
      // Reversal should be: Cash credit 50000, Revenue debit 50000

      // After reversal, cash balance should be zero
      const balance = await engine.getBalance(cashResult.value.id);
      expect(balance.ok).toBe(true);
      if (!balance.ok) return;
      expect(balance.value).toBe(0);
    });

    it("marks the original transaction as reversed", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
      await engine.createAccount({ ledgerId, code: "4000", name: "Revenue", type: "revenue" });

      const txn = await engine.postTransaction({
        ledgerId,
        date: "2025-01-15",
        memo: "Payment",
        lines: [
          { accountCode: "1000", amount: 50000, direction: "debit" },
          { accountCode: "4000", amount: 50000, direction: "credit" },
        ],
      });
      if (!txn.ok) throw new Error("Failed to post");

      await engine.reverseTransaction(txn.value.id, "Error correction");

      // Original should now be marked as reversed
      const original = await engine.getTransaction(txn.value.id);
      expect(original.ok).toBe(true);
      if (!original.ok) return;
      expect(original.value.status).toBe("reversed");
    });

    it("rejects double reversal", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
      await engine.createAccount({ ledgerId, code: "4000", name: "Revenue", type: "revenue" });

      const txn = await engine.postTransaction({
        ledgerId,
        date: "2025-01-15",
        memo: "Payment",
        lines: [
          { accountCode: "1000", amount: 50000, direction: "debit" },
          { accountCode: "4000", amount: 50000, direction: "credit" },
        ],
      });
      if (!txn.ok) throw new Error("Failed to post");

      const first = await engine.reverseTransaction(txn.value.id, "First reversal");
      expect(first.ok).toBe(true);

      const second = await engine.reverseTransaction(txn.value.id, "Second reversal attempt");
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe(ErrorCode.TRANSACTION_ALREADY_REVERSED);
    });
  });

  // -----------------------------------------------------------------------
  // Error cases
  // -----------------------------------------------------------------------

  describe("error handling", () => {
    it("rejects posting to a non-existent ledger", async () => {
      const result = await engine.postTransaction({
        ledgerId: "00000000-0000-7000-8000-000000000099",
        date: "2025-01-15",
        memo: "Should fail",
        lines: [
          { accountCode: "1000", amount: 50000, direction: "debit" },
          { accountCode: "4000", amount: 50000, direction: "credit" },
        ],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCode.LEDGER_NOT_FOUND);
    });

    it("rejects posting with a non-existent account code", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");

      await engine.createAccount({
        ledgerId: ledger.value.id,
        code: "1000",
        name: "Cash",
        type: "asset",
      });

      const result = await engine.postTransaction({
        ledgerId: ledger.value.id,
        date: "2025-01-15",
        memo: "Bad account code",
        lines: [
          { accountCode: "1000", amount: 50000, direction: "debit" },
          { accountCode: "9999", amount: 50000, direction: "credit" }, // doesn't exist
        ],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCode.ACCOUNT_NOT_FOUND);
    });

    it("returns correct error for non-existent transaction", async () => {
      const result = await engine.getTransaction("00000000-0000-7000-8000-nonexistent00");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCode.TRANSACTION_NOT_FOUND);
    });
  });

  // -----------------------------------------------------------------------
  // Amounts are integers
  // -----------------------------------------------------------------------

  describe("integer amounts", () => {
    it("stores and retrieves amounts as integers (cents)", async () => {
      const ledger = await engine.createLedger({ name: "Test", ownerId });
      if (!ledger.ok) throw new Error("Failed to create ledger");
      const ledgerId = ledger.value.id;

      await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
      await engine.createAccount({ ledgerId, code: "4000", name: "Revenue", type: "revenue" });

      // $12.50 = 1250 cents
      const result = await engine.postTransaction({
        ledgerId,
        date: "2025-01-15",
        memo: "$12.50 payment",
        lines: [
          { accountCode: "1000", amount: 1250, direction: "debit" },
          { accountCode: "4000", amount: 1250, direction: "credit" },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.lines[0]!.amount).toBe(1250);
      expect(result.value.lines[1]!.amount).toBe(1250);
    });
  });
});

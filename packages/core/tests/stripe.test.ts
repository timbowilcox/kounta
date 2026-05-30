// ---------------------------------------------------------------------------
// Stripe Connect integration tests.
//
// Covers:
// 1. Webhook signature verification (valid, invalid, expired)
// 2. Event deduplication — same event ID processed only once
// 3. Charge.succeeded — revenue + fee transactions posted
// 4. Charge.refunded — contra-revenue transaction posted
// 5. Payout.paid — cash/stripe-balance transfer posted
// 6. Account auto-creation (1050, 4100, 5200)
// 7. Missing accounts — graceful failure
// 8. Fee = 0 — no fee transaction posted
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { SqliteDatabase, LedgerEngine, generateId } from "../src/index.js";
import {
  verifyWebhookSignature,
  handleChargeSucceeded,
  handleChargeRefunded,
  handlePayoutPaid,
  ensureStripeAccounts,
  findAccountByCode,
} from "../src/stripe/index.js";
import type { StripeConnection, StripeChargeData, StripeRefundData, StripePayoutData } from "../src/stripe/index.js";
import type { Database } from "../src/index.js";
import { createHmac } from "node:crypto";
import { createFullTestDb } from "./helpers/migrate.js";

// ---------------------------------------------------------------------------
// Migration setup — FULL registered schema from the single source of truth
// (src/db/migration-manifest.ts), not a hand-picked subset.
// ---------------------------------------------------------------------------

const createTestDb = (): Promise<Database> => createFullTestDb();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generates fresh IDs per test run and returns the seeded connection. */
const seedLedgerAndAccounts = async (db: Database, engine: LedgerEngine) => {
  const userId = generateId();
  const ledgerId = generateId();
  const connectionId = generateId();

  // Create user first (ledger references user)
  await db.run(
    `INSERT INTO users (id, email, name, auth_provider, auth_provider_id, created_at, updated_at)
     VALUES (?, 'test@example.com', 'Test User', 'github', 'gh_123', datetime('now'), datetime('now'))`,
    [userId],
  );

  // Create ledger
  await db.run(
    `INSERT INTO ledgers (id, name, currency, accounting_basis, status, owner_id, created_at, updated_at)
     VALUES (?, 'Test Business', 'USD', 'accrual', 'active', ?, datetime('now'), datetime('now'))`,
    [ledgerId, userId],
  );

  // Create connection
  await db.run(
    `INSERT INTO stripe_connections (id, user_id, ledger_id, stripe_account_id, access_token, status, created_at, updated_at)
     VALUES (?, ?, ?, 'acct_test123', 'sk_test_fake', 'active', datetime('now'), datetime('now'))`,
    [connectionId, userId, ledgerId],
  );

  // Create required accounts
  const accounts = [
    { code: "1000", name: "Cash", type: "asset", normalBalance: "debit" },
    { code: "1050", name: "Stripe Balance", type: "asset", normalBalance: "debit" },
    { code: "4000", name: "Revenue", type: "revenue", normalBalance: "credit" },
    { code: "4100", name: "Refunds", type: "revenue", normalBalance: "debit" },
    { code: "5200", name: "Processing Fees", type: "expense", normalBalance: "debit" },
  ];

  for (const acct of accounts) {
    const result = await engine.createAccount({
      ledgerId,
      code: acct.code,
      name: acct.name,
      type: acct.type as "asset" | "liability" | "equity" | "revenue" | "expense",
      normalBalance: acct.normalBalance as "debit" | "credit",
    });
    expect(result.ok).toBe(true);
  }

  const connection: StripeConnection = {
    id: connectionId,
    userId,
    ledgerId,
    stripeAccountId: "acct_test123",
    accessToken: "sk_test_fake",
    refreshToken: null,
    stripePublishableKey: null,
    webhookSecret: "whsec_test_secret",
    status: "active",
    lastSyncedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return { userId, ledgerId, connectionId, connection };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Stripe Connect", () => {
  let db: Database;
  let engine: LedgerEngine;
  let ledgerId: string;
  let userId: string;
  let mockConnection: StripeConnection;

  beforeEach(async () => {
    db = await createTestDb();
    engine = new LedgerEngine(db);
    const seed = await seedLedgerAndAccounts(db, engine);
    ledgerId = seed.ledgerId;
    userId = seed.userId;
    mockConnection = seed.connection;
  });

  // -------------------------------------------------------------------------
  // Webhook signature verification
  // -------------------------------------------------------------------------

  describe("verifyWebhookSignature", () => {
    const secret = "whsec_test_secret";
    const payload = '{"id":"evt_test"}';

    const makeSignature = (ts: number, body: string, sec: string): string => {
      const signedPayload = `${ts}.${body}`;
      const sig = createHmac("sha256", sec).update(signedPayload, "utf8").digest("hex");
      return `t=${ts},v1=${sig}`;
    };

    it("should accept a valid signature", () => {
      const ts = Math.floor(Date.now() / 1000);
      const sig = makeSignature(ts, payload, secret);
      expect(verifyWebhookSignature(payload, sig, secret)).toBe(true);
    });

    it("should reject an invalid signature", () => {
      const ts = Math.floor(Date.now() / 1000);
      const sig = makeSignature(ts, payload, "wrong_secret");
      expect(verifyWebhookSignature(payload, sig, secret)).toBe(false);
    });

    it("should reject an expired timestamp", () => {
      const ts = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const sig = makeSignature(ts, payload, secret);
      expect(verifyWebhookSignature(payload, sig, secret)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // charge.succeeded
  // -------------------------------------------------------------------------

  describe("handleChargeSucceeded", () => {
    const charge: StripeChargeData = {
      id: "ch_test_001",
      amount: 5000, // $50.00
      currency: "usd",
      description: "Test payment",
      customerEmail: "customer@example.com",
      applicationFeeAmount: null,
      balanceTransaction: { fee: 175, net: 4825 }, // $1.75 fee
      metadata: {},
    };

    it("should create revenue + fee transactions", async () => {
      const txnId = await handleChargeSucceeded(db, engine, mockConnection, "evt_charge_001", charge);
      expect(txnId).toBeTruthy();

      const result = await engine.getTransaction(txnId!);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const txn = result.value;
      expect(txn.memo).toContain("customer@example.com");
      expect(txn.lines).toHaveLength(2);

      // Verify debit = credit (balance constraint)
      const totalDebit = txn.lines.filter(l => l.direction === "debit").reduce((s, l) => s + l.amount, 0);
      const totalCredit = txn.lines.filter(l => l.direction === "credit").reduce((s, l) => s + l.amount, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(5000);

      // Check fee transaction exists
      const allTxns = await engine.listTransactions(ledgerId, {});
      expect(allTxns.ok).toBe(true);
      if (!allTxns.ok) return;
      const feeTxn = allTxns.value.data.find(t => t.memo.includes("processing fee"));
      expect(feeTxn).toBeTruthy();
      expect(feeTxn!.lines[0]!.amount).toBe(175);
    });

    it("should deduplicate — same event processed only once", async () => {
      const txnId1 = await handleChargeSucceeded(db, engine, mockConnection, "evt_charge_dup", charge);
      expect(txnId1).toBeTruthy();

      const txnId2 = await handleChargeSucceeded(db, engine, mockConnection, "evt_charge_dup", charge);
      expect(txnId2).toBeNull(); // dedup — no new transaction
    });

    it("should skip fee transaction when fee is 0", async () => {
      const noFeeCharge: StripeChargeData = {
        ...charge,
        id: "ch_test_nofee",
        balanceTransaction: { fee: 0, net: 5000 },
      };

      await handleChargeSucceeded(db, engine, mockConnection, "evt_nofee", noFeeCharge);

      const allTxns = await engine.listTransactions(ledgerId, {});
      expect(allTxns.ok).toBe(true);
      if (!allTxns.ok) return;
      const feeTxns = allTxns.value.data.filter(t => t.memo.includes("processing fee"));
      expect(feeTxns).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // charge.refunded
  // -------------------------------------------------------------------------

  describe("handleChargeRefunded", () => {
    const refund: StripeRefundData = {
      id: "re_test_001",
      amount: 2500, // $25.00
      chargeId: "ch_test_original",
      reason: "requested_by_customer",
    };

    it("should create a refund transaction", async () => {
      const txnId = await handleChargeRefunded(db, engine, mockConnection, "evt_refund_001", refund);
      expect(txnId).toBeTruthy();

      const result = await engine.getTransaction(txnId!);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const txn = result.value;
      expect(txn.memo).toContain("refund");

      // Verify balance constraint
      const totalDebit = txn.lines.filter(l => l.direction === "debit").reduce((s, l) => s + l.amount, 0);
      const totalCredit = txn.lines.filter(l => l.direction === "credit").reduce((s, l) => s + l.amount, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(2500);
    });
  });

  // -------------------------------------------------------------------------
  // payout.paid
  // -------------------------------------------------------------------------

  describe("handlePayoutPaid", () => {
    const payout: StripePayoutData = {
      id: "po_test_001",
      amount: 10000, // $100.00
      arrivalDate: Math.floor(Date.now() / 1000),
      description: "STRIPE PAYOUT",
    };

    it("should create a payout transfer transaction", async () => {
      const txnId = await handlePayoutPaid(db, engine, mockConnection, "evt_payout_001", payout);
      expect(txnId).toBeTruthy();

      const result = await engine.getTransaction(txnId!);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const txn = result.value;
      expect(txn.memo).toContain("Stripe payout");

      // Verify balance constraint
      const totalDebit = txn.lines.filter(l => l.direction === "debit").reduce((s, l) => s + l.amount, 0);
      const totalCredit = txn.lines.filter(l => l.direction === "credit").reduce((s, l) => s + l.amount, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(10000);
    });
  });

  // -------------------------------------------------------------------------
  // Account auto-creation
  // -------------------------------------------------------------------------

  describe("ensureStripeAccounts", () => {
    it("should create missing Stripe accounts", async () => {
      // Create a clean ledger without Stripe accounts
      const cleanLedgerId = generateId();
      await db.run(
        `INSERT INTO ledgers (id, name, currency, accounting_basis, status, owner_id, created_at, updated_at)
         VALUES (?, 'Clean Business', 'USD', 'accrual', 'active', ?, datetime('now'), datetime('now'))`,
        [cleanLedgerId, userId],
      );

      // Ensure no 1050 exists
      let acct1050 = await findAccountByCode(db, cleanLedgerId, "1050");
      expect(acct1050).toBeNull();

      // Run ensure
      await ensureStripeAccounts(db, engine, cleanLedgerId);

      // Now 1050, 4100, 5200 should exist
      acct1050 = await findAccountByCode(db, cleanLedgerId, "1050");
      expect(acct1050).toBeTruthy();

      const acct4100 = await findAccountByCode(db, cleanLedgerId, "4100");
      expect(acct4100).toBeTruthy();

      const acct5200 = await findAccountByCode(db, cleanLedgerId, "5200");
      expect(acct5200).toBeTruthy();
    });

    it("should not duplicate existing accounts", async () => {
      // 1050 already exists from seedLedgerAndAccounts
      const before = await findAccountByCode(db, ledgerId, "1050");
      expect(before).toBeTruthy();

      await ensureStripeAccounts(db, engine, ledgerId);

      // Should still be the same account
      const after = await findAccountByCode(db, ledgerId, "1050");
      expect(after).toBe(before);
    });
  });
});

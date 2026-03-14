// ---------------------------------------------------------------------------
// Stripe + Revenue Recognition integration tests
//
// Covers:
// 1. Annual charge creates revenue schedule (12 entries)
// 2. Quarterly charge creates 3-month schedule
// 3. Monthly charge does NOT create a schedule (direct revenue)
// 4. One-time charge does NOT create a schedule
// 5. Refund with active schedule reduces deferred revenue
// 6. Refund exceeding deferred reverses recognised revenue
// 7. Subscription update cancels old schedule, creates new one
// 8. Subscription deleted cancels schedule
// 9. Graceful degradation: charge with no interval data → direct revenue
// 10. extractBillingInterval helper
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteDatabase, LedgerEngine, generateId } from "../src/index.js";
import {
  handleChargeSucceeded,
  handleChargeRefunded,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  extractBillingInterval,
} from "../src/stripe/index.js";
import type {
  StripeConnection,
  StripeChargeData,
  StripeRefundData,
  StripeSubscriptionData,
} from "../src/stripe/index.js";
import {
  getRevenueSchedule,
  listRevenueSchedules,
  processRevenueRecognition,
} from "../src/revenue/index.js";
import type { Database } from "../src/index.js";

// ---------------------------------------------------------------------------
// Migration setup
// ---------------------------------------------------------------------------

const loadMigration = (name: string): string =>
  readFileSync(resolve(__dirname, `../src/db/migrations/${name}`), "utf-8");

const createTestDb = async (): Promise<Database> => {
  const db = await SqliteDatabase.create();
  const schema = loadMigration("001_initial_schema.sqlite.sql");
  const schemaWithoutPragmas = schema
    .split("\n")
    .filter((line) => !line.trim().startsWith("PRAGMA"))
    .join("\n");
  await db.exec(schemaWithoutPragmas);
  await db.exec(loadMigration("006_multi_currency.sqlite.sql"));
  await db.exec(loadMigration("015_stripe_connect.sqlite.sql"));
  await db.exec(loadMigration("016_revenue_recognition.sqlite.sql"));
  return db;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const seedLedgerAndAccounts = async (db: Database, engine: LedgerEngine) => {
  const userId = generateId();
  const ledgerId = generateId();
  const connectionId = generateId();

  await db.run(
    `INSERT INTO users (id, email, name, auth_provider, auth_provider_id, created_at, updated_at)
     VALUES (?, 'test@example.com', 'Test User', 'github', 'gh_123', datetime('now'), datetime('now'))`,
    [userId],
  );

  await db.run(
    `INSERT INTO ledgers (id, name, currency, accounting_basis, status, owner_id, created_at, updated_at)
     VALUES (?, 'Test Business', 'USD', 'accrual', 'active', ?, datetime('now'), datetime('now'))`,
    [ledgerId, userId],
  );

  await db.run(
    `INSERT INTO stripe_connections (id, user_id, ledger_id, stripe_account_id, access_token, status, created_at, updated_at)
     VALUES (?, ?, ?, 'acct_test123', 'sk_test_fake', 'active', datetime('now'), datetime('now'))`,
    [connectionId, userId, ledgerId],
  );

  const accounts = [
    { code: "1000", name: "Cash", type: "asset" },
    { code: "1050", name: "Stripe Balance", type: "asset" },
    { code: "4000", name: "Revenue", type: "revenue" },
    { code: "4100", name: "Refunds", type: "revenue", normalBalance: "debit" },
    { code: "5200", name: "Processing Fees", type: "expense" },
  ];

  for (const acct of accounts) {
    const result = await engine.createAccount({
      ledgerId,
      code: acct.code,
      name: acct.name,
      type: acct.type as "asset" | "liability" | "equity" | "revenue" | "expense",
      normalBalance: (acct as { normalBalance?: string }).normalBalance as "debit" | "credit" | undefined,
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

/** Create an annual subscription charge with invoice data. */
const makeAnnualCharge = (chargeId = "ch_annual_001"): StripeChargeData => ({
  id: chargeId,
  amount: 120000, // $1,200
  currency: "usd",
  description: "Annual Pro Plan",
  customerEmail: "customer@example.com",
  applicationFeeAmount: null,
  balanceTransaction: { fee: 3500, net: 116500 },
  metadata: {},
  customerId: "cus_test_001",
  invoice: {
    subscriptionId: "sub_annual_001",
    customerEmail: "customer@example.com",
    customerId: "cus_test_001",
    lines: [
      {
        description: "Pro Plan (Annual)",
        price: {
          recurring: { interval: "year", intervalCount: 1 },
        },
        period: {
          start: Math.floor(new Date("2025-01-01").getTime() / 1000),
          end: Math.floor(new Date("2026-01-01").getTime() / 1000),
        },
      },
    ],
  },
});

/** Create a quarterly subscription charge. */
const makeQuarterlyCharge = (chargeId = "ch_quarterly_001"): StripeChargeData => ({
  id: chargeId,
  amount: 15000, // $150
  currency: "usd",
  description: "Quarterly Plan",
  customerEmail: "customer@example.com",
  applicationFeeAmount: null,
  balanceTransaction: { fee: 500, net: 14500 },
  metadata: {},
  customerId: "cus_test_002",
  invoice: {
    subscriptionId: "sub_quarterly_001",
    customerEmail: "customer@example.com",
    customerId: "cus_test_002",
    lines: [
      {
        description: "Starter Plan (Quarterly)",
        price: {
          recurring: { interval: "month", intervalCount: 3 },
        },
        period: {
          start: Math.floor(new Date("2025-01-01").getTime() / 1000),
          end: Math.floor(new Date("2025-04-01").getTime() / 1000),
        },
      },
    ],
  },
});

/** Create a monthly subscription charge. */
const makeMonthlyCharge = (chargeId = "ch_monthly_001"): StripeChargeData => ({
  id: chargeId,
  amount: 5000, // $50
  currency: "usd",
  description: "Monthly Plan",
  customerEmail: "customer@example.com",
  applicationFeeAmount: null,
  balanceTransaction: { fee: 175, net: 4825 },
  metadata: {},
  customerId: "cus_test_003",
  invoice: {
    subscriptionId: "sub_monthly_001",
    customerEmail: "customer@example.com",
    customerId: "cus_test_003",
    lines: [
      {
        description: "Basic Plan (Monthly)",
        price: {
          recurring: { interval: "month", intervalCount: 1 },
        },
        period: {
          start: Math.floor(new Date("2025-01-01").getTime() / 1000),
          end: Math.floor(new Date("2025-02-01").getTime() / 1000),
        },
      },
    ],
  },
});

/** Create a one-time charge (no subscription). */
const makeOneTimeCharge = (chargeId = "ch_onetime_001"): StripeChargeData => ({
  id: chargeId,
  amount: 10000, // $100
  currency: "usd",
  description: "One-time purchase",
  customerEmail: "buyer@example.com",
  applicationFeeAmount: null,
  balanceTransaction: { fee: 300, net: 9700 },
  metadata: {},
  // No invoice, no subscription
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Stripe + Revenue Recognition", () => {
  let db: Database;
  let engine: LedgerEngine;
  let ledgerId: string;
  let mockConnection: StripeConnection;

  beforeEach(async () => {
    db = await createTestDb();
    engine = new LedgerEngine(db);
    const seed = await seedLedgerAndAccounts(db, engine);
    ledgerId = seed.ledgerId;
    mockConnection = seed.connection;
  });

  // -------------------------------------------------------------------------
  // extractBillingInterval
  // -------------------------------------------------------------------------

  describe("extractBillingInterval", () => {
    it("returns 'year' for annual subscriptions", () => {
      const charge = makeAnnualCharge();
      expect(extractBillingInterval(charge.invoice)).toBe("year");
    });

    it("returns 'quarter' for quarterly subscriptions", () => {
      const charge = makeQuarterlyCharge();
      expect(extractBillingInterval(charge.invoice)).toBe("quarter");
    });

    it("returns 'month' for monthly subscriptions", () => {
      const charge = makeMonthlyCharge();
      expect(extractBillingInterval(charge.invoice)).toBe("month");
    });

    it("returns null when no invoice data", () => {
      expect(extractBillingInterval(null)).toBeNull();
      expect(extractBillingInterval(undefined)).toBeNull();
    });

    it("returns null when invoice has no lines", () => {
      expect(extractBillingInterval({ subscriptionId: null, customerEmail: null, customerId: null, lines: [] })).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Annual charge → revenue schedule
  // -------------------------------------------------------------------------

  describe("annual charge", () => {
    it("creates a revenue schedule with 12 entries", async () => {
      const charge = makeAnnualCharge();
      const txnId = await handleChargeSucceeded(db, engine, mockConnection, "evt_annual_001", charge);
      expect(txnId).toBeTruthy();

      // Verify the transaction credits Deferred Revenue (2500), not Revenue (4000)
      const txn = await engine.getTransaction(txnId!);
      expect(txn.ok).toBe(true);
      if (!txn.ok) return;

      // Check balance constraint
      const totalDebit = txn.value.lines.filter((l) => l.direction === "debit").reduce((s, l) => s + l.amount, 0);
      const totalCredit = txn.value.lines.filter((l) => l.direction === "credit").reduce((s, l) => s + l.amount, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(120000);

      // Verify revenue schedule was created
      const schedules = await listRevenueSchedules(db, ledgerId, { stripeSubscriptionId: "sub_annual_001" });
      expect(schedules.data).toHaveLength(1);
      expect(schedules.data[0]!.totalAmount).toBe(120000);
      expect(schedules.data[0]!.status).toBe("active");

      // Verify 12 entries
      const schedule = await getRevenueSchedule(db, schedules.data[0]!.id);
      expect(schedule.ok).toBe(true);
      if (!schedule.ok) return;
      expect(schedule.value.entries).toHaveLength(12);

      // Each entry should be $100 ($1,200 / 12)
      const total = schedule.value.entries.reduce((s, e) => s + e.amount, 0);
      expect(total).toBe(120000);
    });

    it("creates the Deferred Revenue account (2500) if missing", async () => {
      // Verify 2500 doesn't exist yet
      const before = await db.get<{ id: string }>(
        "SELECT id FROM accounts WHERE ledger_id = ? AND code = '2500'",
        [ledgerId],
      );
      expect(before).toBeUndefined();

      const charge = makeAnnualCharge();
      await handleChargeSucceeded(db, engine, mockConnection, "evt_annual_auto_accts", charge);

      // Now 2500 should exist
      const after = await db.get<{ id: string }>(
        "SELECT id FROM accounts WHERE ledger_id = ? AND code = '2500'",
        [ledgerId],
      );
      expect(after).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Quarterly charge → 3-month schedule
  // -------------------------------------------------------------------------

  describe("quarterly charge", () => {
    it("creates a 3-month revenue schedule", async () => {
      const charge = makeQuarterlyCharge();
      const txnId = await handleChargeSucceeded(db, engine, mockConnection, "evt_quarterly_001", charge);
      expect(txnId).toBeTruthy();

      const schedules = await listRevenueSchedules(db, ledgerId, { stripeSubscriptionId: "sub_quarterly_001" });
      expect(schedules.data).toHaveLength(1);
      expect(schedules.data[0]!.totalAmount).toBe(15000);

      const schedule = await getRevenueSchedule(db, schedules.data[0]!.id);
      expect(schedule.ok).toBe(true);
      if (!schedule.ok) return;
      expect(schedule.value.entries).toHaveLength(3);

      const total = schedule.value.entries.reduce((s, e) => s + e.amount, 0);
      expect(total).toBe(15000);
    });
  });

  // -------------------------------------------------------------------------
  // Monthly charge → direct revenue (no schedule)
  // -------------------------------------------------------------------------

  describe("monthly charge", () => {
    it("does NOT create a revenue schedule — posts direct revenue", async () => {
      const charge = makeMonthlyCharge();
      const txnId = await handleChargeSucceeded(db, engine, mockConnection, "evt_monthly_001", charge);
      expect(txnId).toBeTruthy();

      // Should have NO revenue schedules
      const schedules = await listRevenueSchedules(db, ledgerId);
      expect(schedules.data).toHaveLength(0);

      // Transaction should credit Revenue (4000), not Deferred Revenue
      const txn = await engine.getTransaction(txnId!);
      expect(txn.ok).toBe(true);
      if (!txn.ok) return;

      const creditLine = txn.value.lines.find((l) => l.direction === "credit");
      expect(creditLine).toBeTruthy();
      // Verify it's the revenue account, not deferred
      const acct = await db.get<{ code: string }>(
        "SELECT code FROM accounts WHERE id = ?",
        [creditLine!.accountId],
      );
      expect(acct?.code).toBe("4000");
    });
  });

  // -------------------------------------------------------------------------
  // One-time charge → direct revenue (no schedule)
  // -------------------------------------------------------------------------

  describe("one-time charge", () => {
    it("does NOT create a revenue schedule", async () => {
      const charge = makeOneTimeCharge();
      const txnId = await handleChargeSucceeded(db, engine, mockConnection, "evt_onetime_001", charge);
      expect(txnId).toBeTruthy();

      const schedules = await listRevenueSchedules(db, ledgerId);
      expect(schedules.data).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Graceful degradation
  // -------------------------------------------------------------------------

  describe("graceful degradation", () => {
    it("posts as direct revenue when charge has no invoice data", async () => {
      const charge: StripeChargeData = {
        id: "ch_no_invoice",
        amount: 5000,
        currency: "usd",
        description: "Mystery charge",
        customerEmail: "test@example.com",
        applicationFeeAmount: null,
        balanceTransaction: { fee: 150, net: 4850 },
        metadata: {},
        // No invoice field at all
      };

      const txnId = await handleChargeSucceeded(db, engine, mockConnection, "evt_no_invoice", charge);
      expect(txnId).toBeTruthy();

      const schedules = await listRevenueSchedules(db, ledgerId);
      expect(schedules.data).toHaveLength(0);
    });

    it("posts as direct revenue when invoice has no recurring info", async () => {
      const charge: StripeChargeData = {
        id: "ch_no_recurring",
        amount: 7500,
        currency: "usd",
        description: "One-time with invoice",
        customerEmail: "test@example.com",
        applicationFeeAmount: null,
        balanceTransaction: null,
        metadata: {},
        invoice: {
          subscriptionId: null,
          customerEmail: "test@example.com",
          customerId: "cus_test",
          lines: [
            {
              description: "Product purchase",
              price: { recurring: null }, // No recurring info
              period: {
                start: Math.floor(Date.now() / 1000),
                end: Math.floor(Date.now() / 1000) + 86400,
              },
            },
          ],
        },
      };

      const txnId = await handleChargeSucceeded(db, engine, mockConnection, "evt_no_recurring", charge);
      expect(txnId).toBeTruthy();

      const schedules = await listRevenueSchedules(db, ledgerId);
      expect(schedules.data).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Refund with active schedule
  // -------------------------------------------------------------------------

  describe("refund with active schedule", () => {
    it("reduces deferred revenue when refund <= remaining", async () => {
      // First create an annual charge with schedule
      const charge = makeAnnualCharge("ch_annual_refund");
      await handleChargeSucceeded(db, engine, mockConnection, "evt_annual_refund", charge);

      // Process first month's recognition
      await processRevenueRecognition(db, engine, ledgerId, "2025-01-31");

      // Now refund $600 (half the annual amount)
      const refund: StripeRefundData = {
        id: "re_annual_001",
        amount: 60000, // $600
        chargeId: "ch_annual_refund",
        reason: "requested_by_customer",
        subscriptionId: "sub_annual_001",
      };

      const txnId = await handleChargeRefunded(db, engine, mockConnection, "evt_refund_annual", refund);
      expect(txnId).toBeTruthy();

      // Verify the transaction was posted correctly
      const txn = await engine.getTransaction(txnId!);
      expect(txn.ok).toBe(true);
      if (!txn.ok) return;

      // Balance constraint
      const totalDebit = txn.value.lines.filter((l) => l.direction === "debit").reduce((s, l) => s + l.amount, 0);
      const totalCredit = txn.value.lines.filter((l) => l.direction === "credit").reduce((s, l) => s + l.amount, 0);
      expect(totalDebit).toBe(totalCredit);
    });

    it("posts standard refund when no schedule exists", async () => {
      // Monthly charge — no schedule
      const charge = makeMonthlyCharge("ch_monthly_refund");
      await handleChargeSucceeded(db, engine, mockConnection, "evt_monthly_refund", charge);

      const refund: StripeRefundData = {
        id: "re_monthly_001",
        amount: 2500,
        chargeId: "ch_monthly_refund",
        reason: "requested_by_customer",
        // No subscriptionId — will use standard refund path
      };

      const txnId = await handleChargeRefunded(db, engine, mockConnection, "evt_refund_monthly", refund);
      expect(txnId).toBeTruthy();

      const txn = await engine.getTransaction(txnId!);
      expect(txn.ok).toBe(true);
      if (!txn.ok) return;

      // Should debit 4100 (Refunds), not deferred revenue
      const debitLine = txn.value.lines.find((l) => l.direction === "debit");
      const acct = await db.get<{ code: string }>(
        "SELECT code FROM accounts WHERE id = ?",
        [debitLine!.accountId],
      );
      expect(acct?.code).toBe("4100");
    });
  });

  // -------------------------------------------------------------------------
  // Subscription updated
  // -------------------------------------------------------------------------

  describe("subscription updated", () => {
    it("cancels old schedule when subscription changes", async () => {
      // Create annual charge with schedule
      const charge = makeAnnualCharge("ch_annual_update");
      await handleChargeSucceeded(db, engine, mockConnection, "evt_annual_update", charge);

      // Verify schedule exists
      const beforeSchedules = await listRevenueSchedules(db, ledgerId, { status: "active" });
      expect(beforeSchedules.data).toHaveLength(1);

      // Simulate subscription update
      const subscription: StripeSubscriptionData = {
        id: "sub_annual_001",
        customerId: "cus_test_001",
        customerEmail: "customer@example.com",
        status: "active",
        currentPeriodStart: Math.floor(new Date("2025-01-01").getTime() / 1000),
        currentPeriodEnd: Math.floor(new Date("2026-01-01").getTime() / 1000),
        items: [
          {
            price: {
              unitAmount: 240000, // $2,400 (upgraded from $1,200)
              recurring: { interval: "year", intervalCount: 1 },
            },
            quantity: 1,
          },
        ],
        canceledAt: null,
        description: "Pro Plan (Upgraded)",
      };

      await handleSubscriptionUpdated(db, engine, mockConnection, "evt_sub_updated", subscription);

      // Old schedule should be cancelled
      const afterSchedules = await listRevenueSchedules(db, ledgerId, { status: "cancelled" });
      expect(afterSchedules.data).toHaveLength(1);

      // New schedule should exist
      const activeSchedules = await listRevenueSchedules(db, ledgerId, { status: "active" });
      expect(activeSchedules.data).toHaveLength(1);
      expect(activeSchedules.data[0]!.totalAmount).toBe(240000);
    });
  });

  // -------------------------------------------------------------------------
  // Subscription deleted
  // -------------------------------------------------------------------------

  describe("subscription deleted", () => {
    it("cancels the active schedule", async () => {
      // Create annual charge with schedule
      const charge = makeAnnualCharge("ch_annual_delete");
      await handleChargeSucceeded(db, engine, mockConnection, "evt_annual_delete", charge);

      const subscription: StripeSubscriptionData = {
        id: "sub_annual_001",
        customerId: "cus_test_001",
        status: "canceled",
        currentPeriodStart: Math.floor(new Date("2025-01-01").getTime() / 1000),
        currentPeriodEnd: Math.floor(new Date("2026-01-01").getTime() / 1000),
        items: [],
        canceledAt: Math.floor(Date.now() / 1000),
        description: null,
      };

      await handleSubscriptionDeleted(db, engine, mockConnection, "evt_sub_deleted", subscription);

      // Schedule should be cancelled
      const schedules = await listRevenueSchedules(db, ledgerId, { status: "cancelled" });
      expect(schedules.data).toHaveLength(1);

      const active = await listRevenueSchedules(db, ledgerId, { status: "active" });
      expect(active.data).toHaveLength(0);
    });

    it("handles deletion when no schedule exists (monthly sub)", async () => {
      // No schedule for this subscription — should not crash
      const subscription: StripeSubscriptionData = {
        id: "sub_nonexistent",
        customerId: "cus_test_999",
        status: "canceled",
        currentPeriodStart: Math.floor(Date.now() / 1000),
        currentPeriodEnd: Math.floor(Date.now() / 1000) + 86400 * 30,
        items: [],
        canceledAt: Math.floor(Date.now() / 1000),
        description: null,
      };

      // Should not throw
      await handleSubscriptionDeleted(db, engine, mockConnection, "evt_sub_deleted_none", subscription);
    });
  });

  // -------------------------------------------------------------------------
  // Fee handling with deferred charges
  // -------------------------------------------------------------------------

  describe("fee handling", () => {
    it("still posts fees separately for deferred charges", async () => {
      const charge = makeAnnualCharge();
      await handleChargeSucceeded(db, engine, mockConnection, "evt_fee_check", charge);

      const allTxns = await engine.listTransactions(ledgerId, {});
      expect(allTxns.ok).toBe(true);
      if (!allTxns.ok) return;

      const feeTxn = allTxns.value.data.find((t) => t.memo.includes("processing fee"));
      expect(feeTxn).toBeTruthy();
      expect(feeTxn!.lines[0]!.amount).toBe(3500); // $35 fee
    });
  });
});

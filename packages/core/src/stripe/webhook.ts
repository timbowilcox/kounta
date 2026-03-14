// ---------------------------------------------------------------------------
// Stripe webhook event handling — process charge, refund, payout, and
// subscription events into double-entry ledger transactions.
//
// Revenue recognition: non-monthly subscriptions create revenue schedules
// so revenue is spread over the service period (ASC 606).
// ---------------------------------------------------------------------------

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Database } from "../db/database.js";
import type { LedgerEngine } from "../engine/index.js";
import { generateId, nowUtc } from "../engine/id.js";
import type {
  StripeConnection,
  StripeChargeData,
  StripeRefundData,
  StripePayoutData,
  StripeSubscriptionData,
  StripeInvoiceData,
} from "./types.js";
import { findAccountByCode } from "./accounts.js";
import {
  createRevenueSchedule,
  cancelSchedule,
  ensureRevenueAccounts,
} from "../revenue/engine.js";

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify a Stripe webhook signature (v1 scheme).
 * Returns true if the signature is valid.
 */
export const verifyWebhookSignature = (
  payload: string,
  signature: string,
  secret: string,
  tolerance = 300, // 5 minutes
): boolean => {
  const elements = signature.split(",");
  const timestampStr = elements.find((e) => e.startsWith("t="))?.slice(2);
  const signatures = elements
    .filter((e) => e.startsWith("v1="))
    .map((e) => e.slice(3));

  if (!timestampStr || signatures.length === 0) return false;

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return false;

  // Check timestamp tolerance
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > tolerance) return false;

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const expected = createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  // Compare against all provided v1 signatures
  const expectedBuf = Buffer.from(expected, "hex");
  return signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, "hex");
    if (sigBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(sigBuf, expectedBuf);
  });
};

// ---------------------------------------------------------------------------
// Event deduplication
// ---------------------------------------------------------------------------

/** Check if a Stripe event has already been processed. */
const isEventProcessed = async (
  db: Database,
  connectionId: string,
  stripeEventId: string,
): Promise<boolean> => {
  const row = await db.get<{ id: string }>(
    `SELECT id FROM stripe_events WHERE connection_id = ? AND stripe_event_id = ?`,
    [connectionId, stripeEventId],
  );
  return !!row;
};

/** Record a processed event. */
const recordEvent = async (
  db: Database,
  connectionId: string,
  stripeEventId: string,
  eventType: string,
  ledgerTransactionId: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> => {
  await db.run(
    `INSERT INTO stripe_events
      (id, connection_id, stripe_event_id, event_type, processed_at, ledger_transaction_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      generateId(),
      connectionId,
      stripeEventId,
      eventType,
      nowUtc(),
      ledgerTransactionId,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );
};

// ---------------------------------------------------------------------------
// Invoice / subscription helpers
// ---------------------------------------------------------------------------

/**
 * Extract billing interval from charge invoice data.
 * Returns the interval string or null if not determinable.
 */
export const extractBillingInterval = (
  invoice: StripeInvoiceData | null | undefined,
): "month" | "year" | "quarter" | null => {
  if (!invoice?.lines?.length) return null;

  const firstLine = invoice.lines[0];
  if (!firstLine?.price?.recurring) return null;

  const { interval, intervalCount } = firstLine.price.recurring;

  if (interval === "year") return "year";
  if (interval === "month" && intervalCount === 3) return "quarter";
  if (interval === "month" && intervalCount === 1) return "month";
  // 6-month, 2-month, etc. → treat as needing a schedule
  if (interval === "month" && intervalCount > 1) return "quarter"; // approximate

  return "month"; // default fallback
};

/** Convert a Unix timestamp to YYYY-MM-DD. */
const unixToDate = (ts: number): string =>
  new Date(ts * 1000).toISOString().slice(0, 10);

/** Get the last day of the month containing a date string. */
const lastDayOfMonthStr = (dateStr: string): string => {
  const d = new Date(dateStr + "T00:00:00Z");
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return last.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// Event router
// ---------------------------------------------------------------------------

/**
 * Route a Stripe event to the appropriate handler.
 * Returns the ledger transaction ID if a transaction was created.
 */
export const handleEvent = async (
  db: Database,
  engine: LedgerEngine,
  connection: StripeConnection,
  event: { id: string; type: string; data: { object: unknown } },
): Promise<string | null> => {
  switch (event.type) {
    case "charge.succeeded":
      return handleChargeSucceeded(
        db,
        engine,
        connection,
        event.id,
        event.data.object as StripeChargeData,
      );
    case "charge.refunded":
      return handleChargeRefunded(
        db,
        engine,
        connection,
        event.id,
        event.data.object as StripeRefundData,
      );
    case "payout.paid":
      return handlePayoutPaid(
        db,
        engine,
        connection,
        event.id,
        event.data.object as StripePayoutData,
      );
    case "customer.subscription.updated":
      return handleSubscriptionUpdated(
        db,
        engine,
        connection,
        event.id,
        event.data.object as StripeSubscriptionData,
      );
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(
        db,
        engine,
        connection,
        event.id,
        event.data.object as StripeSubscriptionData,
      );
    default:
      // Unhandled event type — log and skip
      console.log(`Unhandled Stripe event type: ${event.type}`);
      return null;
  }
};

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * Handle charge.succeeded:
 *
 * For charges without a subscription, or monthly subscriptions:
 *   Debit 1050 Stripe Balance, Credit Revenue — direct recognition.
 *
 * For quarterly/annual subscriptions:
 *   Debit 1050 Stripe Balance, Credit 2500 Deferred Revenue — deferred.
 *   Creates a revenue schedule for spreading over the service period.
 *
 * Fees are always posted separately: Debit 5200, Credit 1050.
 */
export const handleChargeSucceeded = async (
  db: Database,
  engine: LedgerEngine,
  connection: StripeConnection,
  stripeEventId: string,
  charge: StripeChargeData,
): Promise<string | null> => {
  // Dedup check
  if (await isEventProcessed(db, connection.id, stripeEventId)) return null;

  const ledgerId = connection.ledgerId;

  // Verify required accounts exist by code
  const stripeBalanceExists = await findAccountByCode(db, ledgerId, "1050");
  const feeAccountExists = await findAccountByCode(db, ledgerId, "5200");

  if (!stripeBalanceExists) {
    console.error("Missing Stripe Balance (1050) account", { ledgerId });
    return null;
  }

  // Determine billing interval from invoice data
  const billingInterval = extractBillingInterval(charge.invoice);
  const hasSubscription = !!charge.invoice?.subscriptionId;
  const needsSchedule = hasSubscription && billingInterval !== null && billingInterval !== "month";

  // Find revenue account code (prefer 4000, fallback to first revenue)
  let revenueCode = "4000";
  const rev4000 = await findAccountByCode(db, ledgerId, "4000");
  if (!rev4000) {
    const revenueAcct = await db.get<{ code: string }>(
      `SELECT code FROM accounts WHERE ledger_id = ? AND type = 'revenue' AND status = 'active' ORDER BY code LIMIT 1`,
      [ledgerId],
    );
    if (revenueAcct) revenueCode = revenueAcct.code;
    else {
      console.error("No revenue account found for charge processing", { ledgerId });
      return null;
    }
  }

  const grossAmount = charge.amount;
  const fee = charge.balanceTransaction?.fee ?? 0;
  const customerEmail = charge.customerEmail ?? charge.invoice?.customerEmail ?? "unknown";
  const today = new Date().toISOString().slice(0, 10);

  let creditCode = revenueCode;
  let txnId: string;

  if (needsSchedule) {
    // Non-monthly subscription → credit Deferred Revenue, create schedule
    const revAccounts = await ensureRevenueAccounts(db, engine, ledgerId);
    creditCode = "2500"; // Deferred Revenue

    // Post: Debit Stripe Balance, Credit Deferred Revenue
    const deferredResult = await engine.postTransaction({
      ledgerId,
      date: today,
      memo: `Stripe charge from ${customerEmail} (deferred)`,
      lines: [
        { accountCode: "1050", amount: grossAmount, direction: "debit" as const },
        { accountCode: creditCode, amount: grossAmount, direction: "credit" as const },
      ],
      sourceType: "import",
      sourceRef: `stripe:charge:${charge.id}`,
      idempotencyKey: `stripe_charge_${charge.id}`,
      metadata: {
        stripeChargeId: charge.id,
        customerEmail,
        description: charge.description,
        billingInterval,
        deferred: true,
      },
    });

    if (!deferredResult.ok) {
      console.error("Failed to post deferred Stripe charge transaction:", deferredResult.error);
      return null;
    }

    txnId = deferredResult.value.id;

    // Create revenue schedule
    const invoiceLine = charge.invoice?.lines?.[0];
    const periodStart = invoiceLine
      ? unixToDate(invoiceLine.period.start)
      : today;
    const periodEnd = invoiceLine
      ? unixToDate(invoiceLine.period.end)
      : lastDayOfMonthStr(today); // fallback

    // Ensure periodEnd includes the last day of that month
    const adjustedEnd = periodEnd < periodStart ? lastDayOfMonthStr(periodStart) : periodEnd;
    // Subtract one day from periodEnd since Stripe period.end is exclusive
    // Actually, Stripe period.end is the start of the next period, so we need the day before
    const endDate = new Date(adjustedEnd + "T00:00:00Z");
    endDate.setUTCDate(endDate.getUTCDate() - 1);
    const recognitionEnd = endDate.toISOString().slice(0, 10);

    // Only create schedule if the period spans more than one month
    if (recognitionEnd > periodStart) {
      const schedResult = await createRevenueSchedule(db, {
        ledgerId,
        totalAmount: grossAmount,
        currency: charge.currency.toUpperCase(),
        recognitionStart: periodStart,
        recognitionEnd,
        sourceType: "stripe",
        sourceRef: `stripe:charge:${charge.id}`,
        stripeSubscriptionId: charge.invoice?.subscriptionId ?? undefined,
        stripeCustomerId: charge.invoice?.customerId ?? charge.customerId ?? undefined,
        customerName: customerEmail,
        deferredRevenueAccountId: revAccounts.deferredRevenueAccountId,
        revenueAccountId: revAccounts.revenueAccountId,
        description: `Stripe subscription: ${invoiceLine?.description ?? charge.description ?? "subscription"}`,
      });

      if (!schedResult.ok) {
        console.error("Failed to create revenue schedule:", schedResult.error);
        // Transaction was still posted — deferred revenue is recorded
      }
    }
  } else {
    // Monthly or one-time → direct revenue recognition
    const revenueLines = [
      { accountCode: "1050", amount: grossAmount, direction: "debit" as const },
      { accountCode: revenueCode, amount: grossAmount, direction: "credit" as const },
    ];

    const revenueResult = await engine.postTransaction({
      ledgerId,
      date: today,
      memo: `Stripe charge from ${customerEmail}`,
      lines: revenueLines,
      sourceType: "import",
      sourceRef: `stripe:charge:${charge.id}`,
      idempotencyKey: `stripe_charge_${charge.id}`,
      metadata: {
        stripeChargeId: charge.id,
        customerEmail,
        description: charge.description,
      },
    });

    if (!revenueResult.ok) {
      console.error("Failed to post Stripe charge transaction:", revenueResult.error);
      return null;
    }

    txnId = revenueResult.value.id;
  }

  // Post fee transaction if applicable
  if (fee > 0 && feeAccountExists) {
    const feeLines = [
      { accountCode: "5200", amount: fee, direction: "debit" as const },
      { accountCode: "1050", amount: fee, direction: "credit" as const },
    ];

    const feeResult = await engine.postTransaction({
      ledgerId,
      date: today,
      memo: `Stripe processing fee for charge ${charge.id}`,
      lines: feeLines,
      sourceType: "import",
      sourceRef: `stripe:fee:${charge.id}`,
      idempotencyKey: `stripe_fee_${charge.id}`,
      metadata: { stripeChargeId: charge.id, feeAmount: fee },
    });

    if (!feeResult.ok) {
      console.error("Failed to post Stripe fee transaction:", feeResult.error);
    }
  }

  // Record event
  await recordEvent(db, connection.id, stripeEventId, "charge.succeeded", txnId, {
    chargeId: charge.id,
    amount: grossAmount,
    fee,
    customerEmail,
    billingInterval,
    deferred: needsSchedule,
  });

  return txnId;
};

/**
 * Handle charge.refunded:
 *
 * If there's an active revenue schedule for the subscription:
 *   - Refund amount <= remaining deferred: Debit Deferred Revenue, Credit 1050
 *   - Refund amount > remaining deferred: split between deferred reversal and contra-revenue
 *   - Cancel or adjust the schedule
 *
 * If no schedule (monthly/one-time): Debit 4100 Refunds, Credit 1050 (existing behaviour)
 */
export const handleChargeRefunded = async (
  db: Database,
  engine: LedgerEngine,
  connection: StripeConnection,
  stripeEventId: string,
  refund: StripeRefundData,
): Promise<string | null> => {
  if (await isEventProcessed(db, connection.id, stripeEventId)) return null;

  const ledgerId = connection.ledgerId;
  const stripeBalanceExists = await findAccountByCode(db, ledgerId, "1050");
  const refundsAccountExists = await findAccountByCode(db, ledgerId, "4100");

  if (!stripeBalanceExists || !refundsAccountExists) {
    console.error("Missing required accounts for refund processing", { ledgerId });
    return null;
  }

  const today = new Date().toISOString().slice(0, 10);

  // Check for active revenue schedule linked to this subscription
  let schedule: { id: string; amount_remaining: number; deferred_revenue_account_id: string } | undefined;
  if (refund.subscriptionId) {
    schedule = await db.get<{ id: string; amount_remaining: number; deferred_revenue_account_id: string }>(
      `SELECT id, amount_remaining, deferred_revenue_account_id
       FROM revenue_schedules
       WHERE ledger_id = ? AND stripe_subscription_id = ? AND status IN ('active', 'paused')
       ORDER BY created_at DESC LIMIT 1`,
      [ledgerId, refund.subscriptionId],
    );
  }

  let txnId: string;

  if (schedule && Number(schedule.amount_remaining) > 0) {
    const remaining = Number(schedule.amount_remaining);
    const deferredCode = await db.get<{ code: string }>(
      "SELECT code FROM accounts WHERE id = ?",
      [schedule.deferred_revenue_account_id],
    );
    const deferredAccountCode = deferredCode?.code ?? "2500";

    if (refund.amount <= remaining) {
      // Entire refund comes from deferred revenue
      const result = await engine.postTransaction({
        ledgerId,
        date: today,
        memo: `Stripe refund (deferred reversal) for charge ${refund.chargeId}`,
        lines: [
          { accountCode: deferredAccountCode, amount: refund.amount, direction: "debit" as const },
          { accountCode: "1050", amount: refund.amount, direction: "credit" as const },
        ],
        sourceType: "import",
        sourceRef: `stripe:refund:${refund.id}`,
        idempotencyKey: `stripe_refund_${refund.id}`,
        metadata: {
          stripeRefundId: refund.id,
          stripeChargeId: refund.chargeId,
          reason: refund.reason,
          deferredReversal: true,
        },
      });

      if (!result.ok) {
        console.error("Failed to post deferred refund transaction:", result.error);
        return null;
      }
      txnId = result.value.id;

      // Update schedule remaining
      await db.run(
        `UPDATE revenue_schedules SET amount_remaining = amount_remaining - ?, updated_at = ? WHERE id = ?`,
        [refund.amount, nowUtc(), schedule.id],
      );
    } else {
      // Refund exceeds deferred — split: deferred portion + recognised portion
      const deferredPortion = remaining;
      const recognisedPortion = refund.amount - deferredPortion;

      // Post deferred reversal
      if (deferredPortion > 0) {
        await engine.postTransaction({
          ledgerId,
          date: today,
          memo: `Stripe refund (deferred reversal) for charge ${refund.chargeId}`,
          lines: [
            { accountCode: deferredAccountCode, amount: deferredPortion, direction: "debit" as const },
            { accountCode: "1050", amount: deferredPortion, direction: "credit" as const },
          ],
          sourceType: "import",
          sourceRef: `stripe:refund-deferred:${refund.id}`,
          idempotencyKey: `stripe_refund_deferred_${refund.id}`,
          metadata: { stripeRefundId: refund.id, deferredPortion },
        });
      }

      // Post recognised reversal via contra-revenue
      const result = await engine.postTransaction({
        ledgerId,
        date: today,
        memo: `Stripe refund for charge ${refund.chargeId}`,
        lines: [
          { accountCode: "4100", amount: recognisedPortion, direction: "debit" as const },
          { accountCode: "1050", amount: recognisedPortion, direction: "credit" as const },
        ],
        sourceType: "import",
        sourceRef: `stripe:refund:${refund.id}`,
        idempotencyKey: `stripe_refund_${refund.id}`,
        metadata: {
          stripeRefundId: refund.id,
          stripeChargeId: refund.chargeId,
          reason: refund.reason,
          recognisedPortion,
          deferredPortion,
        },
      });

      if (!result.ok) {
        console.error("Failed to post refund transaction:", result.error);
        return null;
      }
      txnId = result.value.id;

      // Zero out remaining and cancel schedule
      await db.run(
        `UPDATE revenue_schedules SET amount_remaining = 0, updated_at = ? WHERE id = ?`,
        [nowUtc(), schedule.id],
      );
    }

    // Cancel the schedule
    await cancelSchedule(db, schedule.id, `Refund ${refund.id}`);
  } else {
    // No schedule — standard refund (contra-revenue)
    const lines = [
      { accountCode: "4100", amount: refund.amount, direction: "debit" as const },
      { accountCode: "1050", amount: refund.amount, direction: "credit" as const },
    ];

    const result = await engine.postTransaction({
      ledgerId,
      date: today,
      memo: `Stripe refund for charge ${refund.chargeId}`,
      lines,
      sourceType: "import",
      sourceRef: `stripe:refund:${refund.id}`,
      idempotencyKey: `stripe_refund_${refund.id}`,
      metadata: {
        stripeRefundId: refund.id,
        stripeChargeId: refund.chargeId,
        reason: refund.reason,
      },
    });

    if (!result.ok) {
      console.error("Failed to post Stripe refund transaction:", result.error);
      return null;
    }
    txnId = result.value.id;
  }

  await recordEvent(db, connection.id, stripeEventId, "charge.refunded", txnId, {
    refundId: refund.id,
    chargeId: refund.chargeId,
    amount: refund.amount,
  });

  return txnId;
};

/**
 * Handle payout.paid:
 * Debit 1000 Cash/primary bank account (asset)
 * Credit 1050 Stripe Balance — payout amount
 */
export const handlePayoutPaid = async (
  db: Database,
  engine: LedgerEngine,
  connection: StripeConnection,
  stripeEventId: string,
  payout: StripePayoutData,
): Promise<string | null> => {
  if (await isEventProcessed(db, connection.id, stripeEventId)) return null;

  const ledgerId = connection.ledgerId;
  const stripeBalanceExists = await findAccountByCode(db, ledgerId, "1050");

  // Find primary cash account code (prefer 1000, fallback to first asset)
  let cashCode = "1000";
  const cash1000 = await findAccountByCode(db, ledgerId, "1000");
  if (!cash1000) {
    const cashAcct = await db.get<{ code: string }>(
      `SELECT code FROM accounts WHERE ledger_id = ? AND type = 'asset' AND code < '1050' AND status = 'active' ORDER BY code LIMIT 1`,
      [ledgerId],
    );
    if (cashAcct) cashCode = cashAcct.code;
    else {
      console.error("No cash account found for payout processing", { ledgerId });
      return null;
    }
  }

  if (!stripeBalanceExists) {
    console.error("Missing Stripe Balance (1050) account for payout processing", { ledgerId });
    return null;
  }

  const arrivalDate = new Date(payout.arrivalDate * 1000).toISOString().slice(0, 10);

  const lines = [
    { accountCode: cashCode, amount: payout.amount, direction: "debit" as const },
    { accountCode: "1050", amount: payout.amount, direction: "credit" as const },
  ];

  const result = await engine.postTransaction({
    ledgerId,
    date: arrivalDate,
    memo: `Stripe payout ${payout.description ?? payout.id}`,
    lines,
    sourceType: "import",
    sourceRef: `stripe:payout:${payout.id}`,
    idempotencyKey: `stripe_payout_${payout.id}`,
    metadata: {
      stripePayoutId: payout.id,
      arrivalDate,
    },
  });

  if (!result.ok) {
    console.error("Failed to post Stripe payout transaction:", result.error);
    return null;
  }

  await recordEvent(db, connection.id, stripeEventId, "payout.paid", result.value.id, {
    payoutId: payout.id,
    amount: payout.amount,
    arrivalDate,
  });

  return result.value.id;
};

// ---------------------------------------------------------------------------
// Subscription lifecycle handlers
// ---------------------------------------------------------------------------

/**
 * Handle customer.subscription.updated:
 * If the price changed (upgrade/downgrade), cancel the old revenue schedule
 * and create a new one for the remaining period at the new rate.
 */
export const handleSubscriptionUpdated = async (
  db: Database,
  engine: LedgerEngine,
  connection: StripeConnection,
  stripeEventId: string,
  subscription: StripeSubscriptionData,
): Promise<string | null> => {
  if (await isEventProcessed(db, connection.id, stripeEventId)) return null;

  const ledgerId = connection.ledgerId;

  // Find active schedule for this subscription
  const existingSchedule = await db.get<{ id: string; total_amount: number }>(
    `SELECT id, total_amount FROM revenue_schedules
     WHERE ledger_id = ? AND stripe_subscription_id = ? AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
    [ledgerId, subscription.id],
  );

  if (!existingSchedule) {
    // No existing schedule — nothing to update (might be monthly)
    await recordEvent(db, connection.id, stripeEventId, "customer.subscription.updated", null, {
      subscriptionId: subscription.id,
      action: "no_schedule_found",
    });
    return null;
  }

  // Cancel old schedule
  await cancelSchedule(db, existingSchedule.id, "Subscription updated");

  // Determine new amount from subscription items
  const firstItem = subscription.items[0];
  if (!firstItem?.price?.unitAmount || !firstItem.price.recurring) {
    await recordEvent(db, connection.id, stripeEventId, "customer.subscription.updated", null, {
      subscriptionId: subscription.id,
      action: "cancelled_old_no_new",
    });
    return null;
  }

  const newAmount = firstItem.price.unitAmount * firstItem.quantity;
  const interval = firstItem.price.recurring.interval;

  // Only create new schedule for non-monthly
  if (interval === "month" && firstItem.price.recurring.intervalCount === 1) {
    await recordEvent(db, connection.id, stripeEventId, "customer.subscription.updated", null, {
      subscriptionId: subscription.id,
      action: "switched_to_monthly",
    });
    return null;
  }

  // Create new schedule for remaining period
  const periodStart = unixToDate(subscription.currentPeriodStart);
  const periodEndRaw = unixToDate(subscription.currentPeriodEnd);
  // Stripe period end is exclusive — subtract one day
  const endDate = new Date(periodEndRaw + "T00:00:00Z");
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const periodEnd = endDate.toISOString().slice(0, 10);

  if (periodEnd <= periodStart) {
    await recordEvent(db, connection.id, stripeEventId, "customer.subscription.updated", null, {
      subscriptionId: subscription.id,
      action: "invalid_period",
    });
    return null;
  }

  const revAccounts = await ensureRevenueAccounts(db, engine, ledgerId);

  const schedResult = await createRevenueSchedule(db, {
    ledgerId,
    totalAmount: newAmount,
    recognitionStart: periodStart,
    recognitionEnd: periodEnd,
    sourceType: "stripe",
    sourceRef: `stripe:subscription:${subscription.id}`,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: subscription.customerId,
    customerName: subscription.customerEmail ?? undefined,
    deferredRevenueAccountId: revAccounts.deferredRevenueAccountId,
    revenueAccountId: revAccounts.revenueAccountId,
    description: `Stripe subscription (updated): ${subscription.description ?? subscription.id}`,
  });

  const newScheduleId = schedResult.ok ? schedResult.value.id : null;

  await recordEvent(db, connection.id, stripeEventId, "customer.subscription.updated", null, {
    subscriptionId: subscription.id,
    oldScheduleId: existingSchedule.id,
    newScheduleId,
    newAmount,
  });

  return null; // No single transaction ID to return
};

/**
 * Handle customer.subscription.deleted:
 * Cancel the active revenue schedule for this subscription.
 */
export const handleSubscriptionDeleted = async (
  db: Database,
  _engine: LedgerEngine,
  connection: StripeConnection,
  stripeEventId: string,
  subscription: StripeSubscriptionData,
): Promise<string | null> => {
  if (await isEventProcessed(db, connection.id, stripeEventId)) return null;

  const ledgerId = connection.ledgerId;

  // Find and cancel active schedule
  const existingSchedule = await db.get<{ id: string }>(
    `SELECT id FROM revenue_schedules
     WHERE ledger_id = ? AND stripe_subscription_id = ? AND status IN ('active', 'paused')
     ORDER BY created_at DESC LIMIT 1`,
    [ledgerId, subscription.id],
  );

  if (existingSchedule) {
    await cancelSchedule(db, existingSchedule.id, "Subscription deleted");
  }

  await recordEvent(db, connection.id, stripeEventId, "customer.subscription.deleted", null, {
    subscriptionId: subscription.id,
    cancelledScheduleId: existingSchedule?.id ?? null,
  });

  return null;
};

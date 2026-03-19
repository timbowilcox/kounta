// ---------------------------------------------------------------------------
// Stripe Connect types — native Stripe integration for revenue tracking.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Domain types (camelCase)
// ---------------------------------------------------------------------------

export type StripeConnectionStatus = "active" | "disconnected" | "error";

export interface StripeConnection {
  readonly id: string;
  readonly userId: string;
  readonly ledgerId: string;
  readonly stripeAccountId: string;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly stripePublishableKey: string | null;
  readonly webhookSecret: string | null;
  readonly status: StripeConnectionStatus;
  readonly lastSyncedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StripeEvent {
  readonly id: string;
  readonly connectionId: string;
  readonly stripeEventId: string;
  readonly eventType: string;
  readonly processedAt: string;
  readonly ledgerTransactionId: string | null;
  readonly metadata: Record<string, unknown> | null;
}

export interface StripeChargeData {
  readonly id: string;
  readonly amount: number; // integer cents
  readonly currency: string;
  readonly description: string | null;
  readonly customerEmail: string | null;
  readonly applicationFeeAmount: number | null;
  readonly balanceTransaction: {
    readonly fee: number;
    readonly net: number;
  } | null;
  readonly metadata: Record<string, string>;
  /** Invoice data embedded from charge.invoice (expanded) or backfill. */
  readonly invoice?: StripeInvoiceData | null;
  /** Customer ID from the charge. */
  readonly customerId?: string | null;
}

/** Minimal invoice data needed for revenue recognition. */
export interface StripeInvoiceData {
  readonly subscriptionId: string | null;
  readonly customerEmail: string | null;
  readonly customerId: string | null;
  readonly lines: readonly StripeInvoiceLineData[];
}

export interface StripeInvoiceLineData {
  readonly description: string | null;
  readonly price: {
    readonly recurring: {
      readonly interval: "day" | "week" | "month" | "year";
      readonly intervalCount: number;
    } | null;
  } | null;
  readonly period: {
    readonly start: number; // Unix timestamp
    readonly end: number;   // Unix timestamp
  };
}

/** Subscription update/delete event data. */
export interface StripeSubscriptionData {
  readonly id: string;
  readonly customerId: string;
  readonly customerEmail?: string | null;
  readonly status: string;
  readonly currentPeriodStart: number;
  readonly currentPeriodEnd: number;
  readonly items: readonly {
    readonly price: {
      readonly unitAmount: number | null;
      readonly recurring: {
        readonly interval: "day" | "week" | "month" | "year";
        readonly intervalCount: number;
      } | null;
    };
    readonly quantity: number;
  }[];
  readonly canceledAt: number | null;
  readonly description: string | null;
}

export interface StripeRefundData {
  readonly id: string;
  readonly amount: number; // integer cents
  readonly chargeId: string;
  readonly reason: string | null;
  /** Subscription ID associated with the refunded charge (for schedule lookup). */
  readonly subscriptionId?: string | null;
}

export interface StripePayoutData {
  readonly id: string;
  readonly amount: number; // integer cents
  readonly arrivalDate: number; // unix timestamp
  readonly description: string | null;
}

// ---------------------------------------------------------------------------
// Database row types (snake_case)
// ---------------------------------------------------------------------------

export interface StripeConnectionRow {
  id: string;
  user_id: string;
  ledger_id: string;
  stripe_account_id: string;
  access_token: string;
  refresh_token: string | null;
  stripe_publishable_key: string | null;
  webhook_secret: string | null;
  status: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StripeEventRow {
  id: string;
  connection_id: string;
  stripe_event_id: string;
  event_type: string;
  processed_at: string;
  ledger_transaction_id: string | null;
  metadata: string | null;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

import { decryptToken } from "../crypto/tokens.js";

export const toStripeConnection = (row: StripeConnectionRow): StripeConnection => ({
  id: row.id,
  userId: row.user_id,
  ledgerId: row.ledger_id,
  stripeAccountId: row.stripe_account_id,
  accessToken: decryptToken(row.access_token),
  refreshToken: row.refresh_token ? decryptToken(row.refresh_token) : null,
  stripePublishableKey: row.stripe_publishable_key,
  webhookSecret: row.webhook_secret ? decryptToken(row.webhook_secret) : null,
  status: row.status as StripeConnectionStatus,
  lastSyncedAt: row.last_synced_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const toStripeEvent = (row: StripeEventRow): StripeEvent => ({
  id: row.id,
  connectionId: row.connection_id,
  stripeEventId: row.stripe_event_id,
  eventType: row.event_type,
  processedAt: row.processed_at,
  ledgerTransactionId: row.ledger_transaction_id,
  metadata: row.metadata ? JSON.parse(row.metadata) : null,
});

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateStripeConnectionInput {
  readonly userId: string;
  readonly ledgerId: string;
  readonly stripeAccountId: string;
  readonly accessToken: string;
  readonly refreshToken?: string | null;
  readonly stripePublishableKey?: string | null;
  readonly webhookSecret?: string | null;
}

/** Public-safe view of a connection (tokens hidden). */
export interface StripeConnectionStatus_Public {
  readonly id: string;
  readonly stripeAccountId: string;
  readonly status: StripeConnectionStatus;
  readonly lastSyncedAt: string | null;
  readonly createdAt: string;
}

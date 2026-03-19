// ---------------------------------------------------------------------------
// Stripe Connect OAuth and connection management.
// ---------------------------------------------------------------------------

import type { Database } from "../db/database.js";
import { generateId, nowUtc } from "../engine/id.js";
import { encryptToken } from "../crypto/tokens.js";
import type {
  StripeConnection,
  CreateStripeConnectionInput,
  StripeConnectionRow,
} from "./types.js";
import { toStripeConnection } from "./types.js";

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

/** Generate the Stripe OAuth authorization URL. */
export const getOAuthUrl = (clientId: string, redirectUri: string, state?: string): string => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: "read_write",
    redirect_uri: redirectUri,
  });
  if (state) params.set("state", state);
  return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
};

/** Exchange an OAuth authorization code for tokens. */
export const exchangeCode = async (
  clientId: string,
  secret: string,
  code: string,
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  stripeUserId: string;
  stripePublishableKey: string | null;
}> => {
  const res = await fetch("https://connect.stripe.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: secret,
      code,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe OAuth token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    stripe_user_id: string;
    stripe_publishable_key?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    stripeUserId: data.stripe_user_id,
    stripePublishableKey: data.stripe_publishable_key ?? null,
  };
};

// ---------------------------------------------------------------------------
// Connection CRUD
// ---------------------------------------------------------------------------

/** Create a new Stripe connection record. */
export const createConnection = async (
  db: Database,
  input: CreateStripeConnectionInput,
): Promise<StripeConnection> => {
  const id = generateId();
  const now = nowUtc();

  // Encrypt sensitive tokens before storage
  const encryptedAccessToken = encryptToken(input.accessToken);
  const encryptedRefreshToken = input.refreshToken ? encryptToken(input.refreshToken) : null;
  const encryptedWebhookSecret = input.webhookSecret ? encryptToken(input.webhookSecret) : null;

  await db.run(
    `INSERT INTO stripe_connections
      (id, user_id, ledger_id, stripe_account_id, access_token, refresh_token,
       stripe_publishable_key, webhook_secret, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [
      id,
      input.userId,
      input.ledgerId,
      input.stripeAccountId,
      encryptedAccessToken,
      encryptedRefreshToken,
      input.stripePublishableKey ?? null,
      encryptedWebhookSecret,
      now,
      now,
    ],
  );

  const row = await db.get<StripeConnectionRow>(
    `SELECT * FROM stripe_connections WHERE id = ?`,
    [id],
  );

  return toStripeConnection(row!);
};

/** Get the active Stripe connection for a user. */
export const getConnection = async (
  db: Database,
  userId: string,
): Promise<StripeConnection | null> => {
  const row = await db.get<StripeConnectionRow>(
    `SELECT * FROM stripe_connections WHERE user_id = ? AND status = 'active' LIMIT 1`,
    [userId],
  );
  return row ? toStripeConnection(row) : null;
};

/** Get the active Stripe connection for a ledger. */
export const getConnectionByLedger = async (
  db: Database,
  ledgerId: string,
): Promise<StripeConnection | null> => {
  const row = await db.get<StripeConnectionRow>(
    `SELECT * FROM stripe_connections WHERE ledger_id = ? AND status = 'active' LIMIT 1`,
    [ledgerId],
  );
  return row ? toStripeConnection(row) : null;
};

/** Disconnect a Stripe connection. */
export const disconnectConnection = async (
  db: Database,
  connectionId: string,
): Promise<void> => {
  await db.run(
    `UPDATE stripe_connections SET status = 'disconnected', updated_at = ? WHERE id = ?`,
    [nowUtc(), connectionId],
  );
};

/** Update the last_synced_at timestamp. */
export const updateLastSynced = async (
  db: Database,
  connectionId: string,
): Promise<void> => {
  const now = nowUtc();
  await db.run(
    `UPDATE stripe_connections SET last_synced_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, connectionId],
  );
};

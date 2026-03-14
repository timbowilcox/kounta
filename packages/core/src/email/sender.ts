// ---------------------------------------------------------------------------
// Email sender — Resend integration with logging and action tokens.
//
// All emails are sent via Resend and logged to the email_log table.
// Action tokens are single-use, time-limited tokens that allow users to
// take actions directly from email links without logging in.
// ---------------------------------------------------------------------------

import { Resend } from "resend";
import { generateId, nowUtc } from "../engine/id.js";
import type { Database } from "../db/database.js";
import type { EmailActionToken, EmailLog, EmailPreferences } from "./types.js";

const SENDER = "Kounta <notifications@kounta.ai>";

let resendClient: Resend | null = null;

/** Initialise the Resend client. Call once at startup. */
export const initResend = (apiKey: string): Resend => {
  resendClient = new Resend(apiKey);
  return resendClient;
};

/** Get the Resend client, throwing if not initialised. */
export const getResendClient = (): Resend | null => resendClient;

/** Send an email via Resend and log it. */
export const sendEmail = async (
  db: Database,
  userId: string,
  to: string,
  subject: string,
  html: string,
  emailType: string,
  metadata?: Record<string, unknown>,
): Promise<EmailLog> => {
  const id = generateId();
  let resendId: string | null = null;

  if (resendClient) {
    const result = await resendClient.emails.send({
      from: SENDER,
      to: [to],
      subject,
      html,
    });
    if (result.data?.id) {
      resendId = result.data.id;
    }
  }

  await db.run(
    `INSERT INTO email_log (id, user_id, email_type, subject, sent_at, resend_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, emailType, subject, nowUtc(), resendId, metadata ? JSON.stringify(metadata) : null],
  );

  return {
    id,
    userId,
    emailType,
    subject,
    sentAt: nowUtc(),
    resendId,
    metadata: metadata ?? null,
  };
};

/** Generate a single-use action token for email links. */
export const generateActionToken = async (
  db: Database,
  userId: string,
  action: string,
  payload: Record<string, unknown>,
  expiresInDays: number = 7,
): Promise<string> => {
  const id = generateId();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  await db.run(
    `INSERT INTO email_action_tokens (id, user_id, action, payload, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, action, JSON.stringify(payload), expiresAt, nowUtc()],
  );

  return id;
};

/** Verify an action token. Returns the token if valid, null otherwise. */
export const verifyActionToken = async (
  db: Database,
  tokenId: string,
): Promise<EmailActionToken | null> => {
  const row = await db.get<{
    id: string;
    user_id: string;
    action: string;
    payload: string;
    expires_at: string;
    used_at: string | null;
    created_at: string;
  }>(
    "SELECT id, user_id, action, payload, expires_at, used_at, created_at FROM email_action_tokens WHERE id = ?",
    [tokenId],
  );

  if (!row) return null;

  // Check if expired
  if (new Date(row.expires_at) < new Date()) return null;

  // Check if already used
  if (row.used_at) return null;

  return {
    id: row.id,
    userId: row.user_id,
    action: row.action,
    payload: JSON.parse(row.payload),
    expiresAt: row.expires_at,
    usedAt: null,
    createdAt: row.created_at,
  };
};

/** Mark a token as used. */
export const markTokenUsed = async (db: Database, tokenId: string): Promise<void> => {
  await db.run(
    "UPDATE email_action_tokens SET used_at = ? WHERE id = ?",
    [nowUtc(), tokenId],
  );
};

/** Get email preferences for a user. */
export const getEmailPreferences = async (
  db: Database,
  userId: string,
): Promise<EmailPreferences | null> => {
  const row = await db.get<{
    id: string;
    user_id: string;
    weekly_digest: number | boolean;
    monthly_close: number | boolean;
    urgent_alerts: number | boolean;
    quarterly_tax: number | boolean;
    timezone: string;
    digest_day: string;
    created_at: string;
    updated_at: string;
  }>(
    "SELECT * FROM email_preferences WHERE user_id = ?",
    [userId],
  );

  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    weeklyDigest: !!row.weekly_digest,
    monthlyClose: !!row.monthly_close,
    urgentAlerts: !!row.urgent_alerts,
    quarterlyTax: !!row.quarterly_tax,
    timezone: row.timezone,
    digestDay: row.digest_day,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

/** Create default email preferences for a new user. */
export const createDefaultEmailPreferences = async (
  db: Database,
  userId: string,
  timezone: string = "UTC",
): Promise<EmailPreferences> => {
  const id = generateId();
  const now = nowUtc();

  await db.run(
    `INSERT INTO email_preferences (id, user_id, weekly_digest, monthly_close, urgent_alerts, quarterly_tax, timezone, digest_day, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO NOTHING`,
    [id, userId, true, true, true, true, timezone, "monday", now, now],
  );

  const prefs = await getEmailPreferences(db, userId);
  return prefs!;
};

/** Update email preferences. */
export const updateEmailPreferences = async (
  db: Database,
  userId: string,
  updates: Partial<Pick<EmailPreferences, "weeklyDigest" | "monthlyClose" | "urgentAlerts" | "quarterlyTax" | "timezone" | "digestDay">>,
): Promise<EmailPreferences | null> => {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.weeklyDigest !== undefined) { sets.push("weekly_digest = ?"); values.push(updates.weeklyDigest); }
  if (updates.monthlyClose !== undefined) { sets.push("monthly_close = ?"); values.push(updates.monthlyClose); }
  if (updates.urgentAlerts !== undefined) { sets.push("urgent_alerts = ?"); values.push(updates.urgentAlerts); }
  if (updates.quarterlyTax !== undefined) { sets.push("quarterly_tax = ?"); values.push(updates.quarterlyTax); }
  if (updates.timezone !== undefined) { sets.push("timezone = ?"); values.push(updates.timezone); }
  if (updates.digestDay !== undefined) { sets.push("digest_day = ?"); values.push(updates.digestDay); }

  if (sets.length === 0) return getEmailPreferences(db, userId);

  sets.push("updated_at = ?");
  values.push(nowUtc());
  values.push(userId);

  await db.run(
    `UPDATE email_preferences SET ${sets.join(", ")} WHERE user_id = ?`,
    values,
  );

  return getEmailPreferences(db, userId);
};

/** Check if a specific email type was sent to a user recently. */
export const wasEmailSentRecently = async (
  db: Database,
  userId: string,
  emailType: string,
  sinceDate: string,
): Promise<boolean> => {
  const row = await db.get<{ count: number }>(
    "SELECT COUNT(*) as count FROM email_log WHERE user_id = ? AND email_type = ? AND sent_at >= ?",
    [userId, emailType, sinceDate],
  );
  return (row?.count ?? 0) > 0;
};

/** Count urgent alerts sent to a user this week. */
export const countUrgentAlertsThisWeek = async (
  db: Database,
  userId: string,
): Promise<number> => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const row = await db.get<{ count: number }>(
    "SELECT COUNT(*) as count FROM email_log WHERE user_id = ? AND email_type = 'urgent_alert' AND sent_at >= ?",
    [userId, weekAgo],
  );
  return row?.count ?? 0;
};

// ---------------------------------------------------------------------------
// Email scheduler — checks and sends emails based on user preferences.
//
// Runs on the same hourly schedule as the intelligence layer.
// Timezone-aware: sends at 9am in each user's configured timezone.
// ---------------------------------------------------------------------------

import type { Database } from "../db/database.js";
import type { LedgerEngine } from "../engine/index.js";
import {
  sendEmail,
  getEmailPreferences,
  wasEmailSentRecently,
  countUrgentAlertsThisWeek,
  generateActionToken,
} from "./sender.js";
import { generateWeeklyDigest } from "./templates/weekly-digest.js";
import { generateMonthlyClose } from "./templates/monthly-close.js";
import { generateUrgentAlert } from "./templates/urgent-alert.js";
import { generateWelcomeEmail, generateClassifyPrompt, generateFirstSnapshot } from "./templates/onboarding.js";
import { formatAmountShort } from "./templates/layout.js";
import type { UrgentAlertType, UrgentAlertData, WeeklyDigestData, MonthlyCloseData, OnboardingSummary, PendingClassification, RevenueRecognitionDigest } from "./types.js";

const BASE_URL = process.env["KOUNTA_BASE_URL"] ?? "https://kounta.ai";
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Get the current hour (0-23) in a given timezone. */
const getHourInTimezone = (timezone: string): number => {
  try {
    const now = new Date();
    const formatted = now.toLocaleString("en-US", { timeZone: timezone, hour: "numeric", hour12: false });
    return parseInt(formatted, 10);
  } catch {
    return new Date().getUTCHours();
  }
};

/** Get the current day name in a given timezone. */
const getDayInTimezone = (timezone: string): string => {
  try {
    const now = new Date();
    const dayName = now.toLocaleDateString("en-US", { timeZone: timezone, weekday: "long" }).toLowerCase();
    return dayName;
  } catch {
    return DAYS[new Date().getUTCDay()]!;
  }
};

/** Get start of the current week (Monday) in ISO format. */
const getWeekStart = (): string => {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // Adjust to Monday
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString();
};

/** Get start of the current month in ISO format. */
const getMonthStart = (): string => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
};

/** Check and send weekly digests for users whose digest is due. */
export const checkAndSendDigests = async (engine: LedgerEngine): Promise<number> => {
  const db = engine.getDb();
  let sentCount = 0;

  // Find users with weekly digest enabled
  const users = await db.all<{ user_id: string; timezone: string; digest_day: string }>(
    "SELECT user_id, timezone, digest_day FROM email_preferences WHERE weekly_digest = ?",
    [true],
  );

  for (const userPref of users) {
    const hour = getHourInTimezone(userPref.timezone);
    const day = getDayInTimezone(userPref.timezone);

    // Only send at 9am on the user's digest day
    if (hour !== 9 || day !== userPref.digest_day) continue;

    // Check if already sent this week
    const weekStart = getWeekStart();
    const alreadySent = await wasEmailSentRecently(db, userPref.user_id, "weekly_digest", weekStart);
    if (alreadySent) continue;

    // Get user info
    const user = await db.get<{ email: string; name: string }>(
      "SELECT email, name FROM users WHERE id = ?",
      [userPref.user_id],
    );
    if (!user) continue;

    // Get user's ledger
    const ledger = await db.get<{ id: string; currency: string }>(
      "SELECT id, currency FROM ledgers WHERE owner_id = ?",
      [userPref.user_id],
    );
    if (!ledger) continue;

    // Generate digest data (simplified — real implementation would query reports)
    try {
      const digestData = await buildDigestData(db, engine, userPref.user_id, ledger.id, ledger.currency, user.name);
      if (!digestData) continue;

      // Generate tokens for each pending classification
      const tokens: Record<string, string> = {};
      for (const item of digestData.pendingClassifications) {
        tokens[item.id] = await generateActionToken(db, userPref.user_id, "classify", {
          transactionId: item.id,
          ledgerId: ledger.id,
        });
      }

      const subject = `Your week in numbers \u2014 ${formatAmountShort(digestData.revenue, ledger.currency)} revenue, ${formatAmountShort(digestData.expenses, ledger.currency)} expenses`;
      const html = generateWeeklyDigest({ ...digestData, tokens });

      await sendEmail(db, userPref.user_id, user.email, subject, html, "weekly_digest", {
        ledgerId: ledger.id,
        revenue: digestData.revenue,
        expenses: digestData.expenses,
        pendingCount: digestData.pendingClassifications.length,
      });
      sentCount++;
    } catch (err) {
      console.error(`Failed to send digest to ${user.email}:`, err);
    }
  }

  return sentCount;
};

/** Check and send monthly close prompts on the 1st of each month. */
export const checkAndSendMonthlyClose = async (engine: LedgerEngine): Promise<number> => {
  const db = engine.getDb();
  const now = new Date();
  if (now.getUTCDate() !== 1) return 0;

  let sentCount = 0;

  const users = await db.all<{ user_id: string; timezone: string }>(
    "SELECT user_id, timezone FROM email_preferences WHERE monthly_close = ?",
    [true],
  );

  for (const userPref of users) {
    const hour = getHourInTimezone(userPref.timezone);
    if (hour !== 9) continue;

    const monthStart = getMonthStart();
    const alreadySent = await wasEmailSentRecently(db, userPref.user_id, "monthly_close", monthStart);
    if (alreadySent) continue;

    const user = await db.get<{ email: string; name: string }>(
      "SELECT email, name FROM users WHERE id = ?",
      [userPref.user_id],
    );
    if (!user) continue;

    const ledger = await db.get<{ id: string; currency: string }>(
      "SELECT id, currency FROM ledgers WHERE owner_id = ?",
      [userPref.user_id],
    );
    if (!ledger) continue;

    try {
      const prevMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
      const monthName = prevMonth.toLocaleString("en-US", { month: "long" });
      const year = prevMonth.getFullYear();

      const closeToken = await generateActionToken(db, userPref.user_id, "close", {
        ledgerId: ledger.id,
        month: monthName,
        year,
      });

      const closeData: MonthlyCloseData & { closeToken: string } = {
        userName: user.name,
        month: monthName,
        year,
        revenue: 0,
        expenses: 0,
        netIncome: 0,
        cashBalance: 0,
        pendingClassificationsCount: 0,
        currency: ledger.currency,
        baseUrl: BASE_URL,
        closeToken,
      };

      const subject = `${monthName} is done \u2014 close your books in one click`;
      const html = generateMonthlyClose(closeData);

      await sendEmail(db, userPref.user_id, user.email, subject, html, "monthly_close", {
        ledgerId: ledger.id,
        month: monthName,
        year,
      });
      sentCount++;
    } catch (err) {
      console.error(`Failed to send monthly close to ${user.email}:`, err);
    }
  }

  return sentCount;
};

/** Check if a transaction triggers an urgent alert. */
export const checkUrgentAlerts = async (
  engine: LedgerEngine,
  userId: string,
  alertType: UrgentAlertType,
  alertData: UrgentAlertData,
): Promise<boolean> => {
  const db = engine.getDb();

  // Rate limit: max 2 urgent alerts per user per week
  const alertCount = await countUrgentAlertsThisWeek(db, userId);
  if (alertCount >= 2) return false;

  const prefs = await getEmailPreferences(db, userId);
  if (!prefs?.urgentAlerts) return false;

  const user = await db.get<{ email: string; name: string }>(
    "SELECT email, name FROM users WHERE id = ?",
    [userId],
  );
  if (!user) return false;

  const data: UrgentAlertData = { ...alertData, userName: user.name, baseUrl: BASE_URL };
  const html = generateUrgentAlert(alertType, data);

  const subjects: Record<UrgentAlertType, string> = {
    large_transaction: `Unusual transaction: ${formatAmountShort(alertData.transactionAmount ?? 0, alertData.currency)} to ${alertData.transactionDescription ?? "Unknown"}`,
    failed_connection: `Your ${alertData.bankName ?? "bank"} connection stopped syncing`,
    low_cash: `Low cash alert: ${formatAmountShort(alertData.cashBalance ?? 0, alertData.currency)} remaining`,
    plan_limit: `Approaching plan limit: ${alertData.usedCount} of ${alertData.limitCount} transactions used`,
  };

  await sendEmail(db, userId, user.email, subjects[alertType], html, "urgent_alert", {
    alertType,
  });

  return true;
};

/** Check and send onboarding sequence emails. */
export const checkOnboardingSequence = async (engine: LedgerEngine): Promise<number> => {
  const db = engine.getDb();
  let sentCount = 0;

  // Find users created in the last 8 days who might need onboarding emails
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const users = await db.all<{ id: string; email: string; name: string; created_at: string }>(
    "SELECT id, email, name, created_at FROM users WHERE created_at >= ?",
    [eightDaysAgo],
  );

  for (const user of users) {
    const daysSinceSignup = Math.floor((Date.now() - new Date(user.created_at).getTime()) / (24 * 60 * 60 * 1000));

    // Day 1: Welcome (sent immediately on signup, so check if we've sent it)
    if (daysSinceSignup >= 0 && daysSinceSignup < 1) {
      const sent = await wasEmailSentRecently(db, user.id, "onboarding_welcome", user.created_at);
      if (!sent) {
        const html = generateWelcomeEmail(user.name, BASE_URL);
        await sendEmail(db, user.id, user.email, "Welcome to Kounta \u2014 connect your bank to get started", html, "onboarding_welcome");
        sentCount++;
      }
    }

    // Day 3: Classify prompt
    if (daysSinceSignup >= 3 && daysSinceSignup < 4) {
      const sent = await wasEmailSentRecently(db, user.id, "onboarding_classify", user.created_at);
      if (!sent) {
        // Count unclassified transactions
        const result = await db.get<{ count: number }>(
          `SELECT COUNT(*) as count FROM bank_transactions bt
           JOIN bank_accounts ba ON bt.bank_account_id = ba.id
           JOIN bank_connections bc ON ba.connection_id = bc.id
           JOIN ledgers l ON bc.ledger_id = l.id
           WHERE l.owner_id = ? AND bt.matched_transaction_id IS NULL AND bt.is_personal = ?`,
          [user.id, false],
        );
        const count = result?.count ?? 0;
        if (count > 0) {
          const html = generateClassifyPrompt(user.name, count, BASE_URL);
          await sendEmail(db, user.id, user.email, `Your first transactions are ready to classify`, html, "onboarding_classify");
          sentCount++;
        }
      }
    }

    // Day 7: First snapshot
    if (daysSinceSignup >= 7 && daysSinceSignup < 8) {
      const sent = await wasEmailSentRecently(db, user.id, "onboarding_snapshot", user.created_at);
      if (!sent) {
        const ledger = await db.get<{ id: string; currency: string }>(
          "SELECT id, currency FROM ledgers WHERE owner_id = ?",
          [user.id],
        );
        if (ledger) {
          const summary: OnboardingSummary = {
            revenue: 0,
            expenses: 0,
            netIncome: 0,
            cashBalance: 0,
            currency: ledger.currency,
          };
          const html = generateFirstSnapshot(user.name, summary, BASE_URL);
          await sendEmail(db, user.id, user.email, "Here's your first weekly financial snapshot", html, "onboarding_snapshot");
          sentCount++;
        }
      }
    }
  }

  return sentCount;
};

/** Build digest data from ledger queries. */
const buildDigestData = async (
  db: Database,
  _engine: LedgerEngine,
  userId: string,
  ledgerId: string,
  currency: string,
  userName: string,
): Promise<(WeeklyDigestData & { tokens: Record<string, string> }) | null> => {
  // Get pending classifications (unmatched bank transactions)
  const pendingRows = await db.all<{
    id: string;
    description: string;
    amount: number;
    date: string;
  }>(
    `SELECT bt.id, bt.description, bt.amount, bt.date
     FROM bank_transactions bt
     JOIN bank_accounts ba ON bt.bank_account_id = ba.id
     JOIN bank_connections bc ON ba.connection_id = bc.id
     JOIN ledgers l ON bc.ledger_id = l.id
     WHERE l.owner_id = ? AND bt.matched_transaction_id IS NULL AND bt.is_personal = ?
     ORDER BY bt.date DESC
     LIMIT 10`,
    [userId, false],
  );

  const pendingClassifications: PendingClassification[] = pendingRows.map((row) => ({
    id: row.id,
    description: row.description ?? "Unknown",
    amount: row.amount,
    date: row.date,
    suggestedCategories: [], // Would be populated by classification engine suggestions
  }));

  // Revenue recognition data (if active schedules exist)
  let revenueRecognition: RevenueRecognitionDigest | undefined;
  try {
    const activeCount = await db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM revenue_schedules WHERE ledger_id = ? AND status = 'active'",
      [ledgerId],
    );
    if (activeCount && Number(activeCount.count) > 0) {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const recognisedRow = await db.get<{ total: number | null }>(
        `SELECT SUM(e.amount) AS total FROM revenue_schedule_entries e
         WHERE e.ledger_id = ? AND e.status = 'posted' AND e.posted_at >= ?`,
        [ledgerId, weekAgo],
      );
      const deferredRow = await db.get<{ total: number | null }>(
        "SELECT SUM(amount_remaining) AS total FROM revenue_schedules WHERE ledger_id = ? AND status IN ('active', 'paused')",
        [ledgerId],
      );

      revenueRecognition = {
        recognisedThisWeek: Number(recognisedRow?.total ?? 0),
        deferredBalance: Number(deferredRow?.total ?? 0),
        activeScheduleCount: Number(activeCount.count),
      };
    }
  } catch {
    // revenue_schedules table may not exist yet — skip silently
  }

  return {
    userName,
    revenue: 0,
    expenses: 0,
    net: 0,
    cashBalance: 0,
    pendingClassifications,
    currency,
    baseUrl: BASE_URL,
    tokens: {},
    revenueRecognition,
  };
};

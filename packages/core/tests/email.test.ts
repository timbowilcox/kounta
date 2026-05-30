// ---------------------------------------------------------------------------
// Email module tests — token generation/verification, token expiry,
// token single-use, email preferences CRUD, digest data generation.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { SqliteDatabase, LedgerEngine } from "../src/index.js";
import type { Database } from "../src/index.js";
import {
  generateActionToken,
  verifyActionToken,
  markTokenUsed,
  createDefaultEmailPreferences,
  getEmailPreferences,
  updateEmailPreferences,
  wasEmailSentRecently,
  countUrgentAlertsThisWeek,
} from "../src/email/sender.js";
import { createFullTestDb } from "./helpers/migrate.js";

// ---------------------------------------------------------------------------
// Migration setup — FULL registered schema from the single source of truth
// (src/db/migration-manifest.ts), not a hand-picked subset.
// ---------------------------------------------------------------------------

const createTestDb = (): Promise<Database> => createFullTestDb();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let db: Database;
const userId = "00000000-0000-7000-8000-000000000001";

const setupDb = async () => {
  db = await createTestDb();

  // Create test user
  db.run(
    `INSERT INTO users (id, email, name, auth_provider, auth_provider_id)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, "test@example.com", "Test User", "test", "test-001"],
  );
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Email Action Tokens", () => {
  beforeEach(setupDb);

  it("generates a token and verifies it", async () => {
    const token = await generateActionToken(db, userId, "classify", {
      transactionId: "txn-001",
      ledgerId: "led-001",
    });

    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");

    const data = await verifyActionToken(db, token);
    expect(data).not.toBeNull();
    expect(data!.userId).toBe(userId);
    expect(data!.action).toBe("classify");
    expect(data!.payload).toEqual({
      transactionId: "txn-001",
      ledgerId: "led-001",
    });
  });

  it("returns null for non-existent token", async () => {
    const data = await verifyActionToken(db, "non-existent-token-id");
    expect(data).toBeNull();
  });

  it("returns null for expired token", async () => {
    const token = await generateActionToken(db, userId, "close", { month: "January" }, 0);

    // Manually set expires_at to the past
    db.run(
      "UPDATE email_action_tokens SET expires_at = datetime('now', '-1 day') WHERE id = ?",
      [token],
    );

    const data = await verifyActionToken(db, token);
    expect(data).toBeNull();
  });

  it("marks token as used and prevents reuse", async () => {
    const token = await generateActionToken(db, userId, "unsubscribe", { type: "weekly_digest" });

    // First verification should succeed
    const data1 = await verifyActionToken(db, token);
    expect(data1).not.toBeNull();

    // Mark as used
    await markTokenUsed(db, token);

    // Second verification should fail
    const data2 = await verifyActionToken(db, token);
    expect(data2).toBeNull();
  });

  it("stores payload as JSON", async () => {
    const payload = {
      transactionId: "txn-123",
      ledgerId: "led-456",
      nested: { key: "value" },
    };

    const token = await generateActionToken(db, userId, "classify", payload);
    const data = await verifyActionToken(db, token);
    expect(data).not.toBeNull();
    expect(data!.payload).toEqual(payload);
  });
});

describe("Email Preferences", () => {
  beforeEach(setupDb);

  it("creates default preferences", async () => {
    await createDefaultEmailPreferences(db, userId);

    const prefs = await getEmailPreferences(db, userId);
    expect(prefs).not.toBeNull();
    expect(prefs!.weeklyDigest).toBe(true);
    expect(prefs!.monthlyClose).toBe(true);
    expect(prefs!.urgentAlerts).toBe(true);
    expect(prefs!.quarterlyTax).toBe(true);
    expect(prefs!.timezone).toBe("UTC");
    expect(prefs!.digestDay).toBe("monday");
  });

  it("creates default preferences with custom timezone", async () => {
    await createDefaultEmailPreferences(db, userId, "America/New_York");

    const prefs = await getEmailPreferences(db, userId);
    expect(prefs).not.toBeNull();
    expect(prefs!.timezone).toBe("America/New_York");
  });

  it("does not duplicate on repeated creation (ON CONFLICT DO NOTHING)", async () => {
    await createDefaultEmailPreferences(db, userId);
    await createDefaultEmailPreferences(db, userId); // Should not throw

    const prefs = await getEmailPreferences(db, userId);
    expect(prefs).not.toBeNull();
  });

  it("updates preferences", async () => {
    await createDefaultEmailPreferences(db, userId);

    const updated = await updateEmailPreferences(db, userId, {
      weeklyDigest: false,
      timezone: "Europe/London",
      digestDay: "friday",
    });

    expect(updated).not.toBeNull();
    expect(updated!.weeklyDigest).toBe(false);
    expect(updated!.timezone).toBe("Europe/London");
    expect(updated!.digestDay).toBe("friday");
    // Unchanged fields remain
    expect(updated!.monthlyClose).toBe(true);
    expect(updated!.urgentAlerts).toBe(true);
  });

  it("returns null when updating non-existent user", async () => {
    const updated = await updateEmailPreferences(db, "non-existent-user", {
      weeklyDigest: false,
    });
    expect(updated).toBeNull();
  });

  it("returns null when getting non-existent preferences", async () => {
    const prefs = await getEmailPreferences(db, userId);
    expect(prefs).toBeNull();
  });
});

describe("Email Log Helpers", () => {
  beforeEach(setupDb);

  it("wasEmailSentRecently returns false when no emails sent", async () => {
    const result = await wasEmailSentRecently(db, userId, "weekly_digest", new Date(0).toISOString());
    expect(result).toBe(false);
  });

  it("wasEmailSentRecently returns true after sending", async () => {
    // Insert a log entry manually
    const sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    db.run(
      `INSERT INTO email_log (id, user_id, email_type, subject, sent_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      ["log-001", userId, "weekly_digest", "Test Subject"],
    );

    const result = await wasEmailSentRecently(db, userId, "weekly_digest", sinceDate);
    expect(result).toBe(true);
  });

  it("countUrgentAlertsThisWeek returns 0 when none sent", async () => {
    const count = await countUrgentAlertsThisWeek(db, userId);
    expect(count).toBe(0);
  });

  it("countUrgentAlertsThisWeek counts recent alerts", async () => {
    // Insert alert log entries
    db.run(
      `INSERT INTO email_log (id, user_id, email_type, subject, sent_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      ["alert-001", userId, "urgent_alert", "Alert 1"],
    );
    db.run(
      `INSERT INTO email_log (id, user_id, email_type, subject, sent_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      ["alert-002", userId, "urgent_alert", "Alert 2"],
    );

    const count = await countUrgentAlertsThisWeek(db, userId);
    expect(count).toBe(2);
  });
});

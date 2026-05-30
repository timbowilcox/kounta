// ---------------------------------------------------------------------------
// Deleted-ledger ISOLATION proof (Session D).
//
// The inverse of EVALUATION-7's leak demo: after a ledger is soft-deleted it
// must leak NOWHERE. We create a ledger + API key + OAuth token + child account,
// soft-delete it, then assert ALL access paths are closed:
//   - the OAuth access token no longer validates (revoked on delete + the
//     validateOAuthToken ledger-status belt),
//   - the API key is rejected (revoked on delete),
//   - getLedger, listAccounts, and a sample of other ledger-scoped reads all
//     return not-found.
// A second ledger owned by the same user is the control: it must stay fully
// readable (the data-layer gate filters `status != 'deleted'`, NOT to
// `status = 'active'`, so non-deleted ledgers are unaffected).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteDatabase, LedgerEngine, registeredSqliteMigrationFiles } from "@kounta/core";
import type { Database } from "@kounta/core";
import { validateOAuthToken } from "../src/lib/oauth-scopes.js";

const MIGRATIONS_DIR = resolve(__dirname, "../../core/src/db/migrations");

// Apply the full registered (production) migration set, derived from the single
// source of truth in @kounta/core.
const createTestDb = async (): Promise<Database> => {
  const db = await SqliteDatabase.create();
  for (const file of registeredSqliteMigrationFiles()) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf-8")
      .split("\n")
      .filter((line) => !line.trim().toUpperCase().startsWith("PRAGMA"))
      .join("\n");
    db.exec(sql);
  }
  return db;
};

const createUser = async (db: Database, id: string): Promise<void> => {
  await db.run(
    `INSERT INTO users (id, email, name, auth_provider, auth_provider_id)
     VALUES (?, ?, ?, ?, ?)`,
    [id, `iso-${id.slice(-4)}@test.com`, "Iso User", "test", `iso-${id.slice(-4)}`],
  );
};

// Insert a VALID (unexpired, unrevoked) OAuth access token, aligned to all 12
// oauth_tokens columns. Scopes are stored space-separated (parseScopesFromDb
// handles JSON, PG-array, and space-separated forms).
const insertOAuthToken = async (
  db: Database,
  t: { token: string; userId: string; ledgerId: string },
): Promise<void> => {
  const now = new Date();
  await db.run(
    `INSERT INTO oauth_tokens
       (id, access_token, token_type, refresh_token, client_id, user_id, ledger_id,
        scopes, expires_at, refresh_expires_at, revoked_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `tok-${t.token.slice(-8)}`,
      t.token,
      "Bearer",
      null,
      "claude-ai",
      t.userId,
      t.ledgerId,
      "ledger:read ledger:write",
      new Date(now.getTime() + 3_600_000).toISOString(),
      null,
      null,
      now.toISOString(),
    ],
  );
};

describe("deleted-ledger isolation — a soft-deleted ledger leaks nowhere", () => {
  let db: Database;
  let engine: LedgerEngine;
  const userId = "00000000-0000-7000-8000-0000000000aa";
  let ledgerId: string; // soft-deleted
  let otherLedgerId: string; // control (same owner, so the delete is allowed)
  let rawApiKey: string;
  const oauthToken = "kounta_oauth_iso_test_token_abc123def456";
  const readPath = (): string => `/v1/ledgers/${ledgerId}/accounts`;

  beforeEach(async () => {
    db = await createTestDb();
    engine = new LedgerEngine(db);
    await createUser(db, userId);

    const l1 = await engine.createLedger({ name: "Primary", ownerId: userId });
    const l2 = await engine.createLedger({ name: "Secondary", ownerId: userId });
    expect(l1.ok && l2.ok).toBe(true);
    if (!l1.ok || !l2.ok) throw new Error("ledger setup failed");
    ledgerId = l1.value.id;
    otherLedgerId = l2.value.id;

    const acct = await engine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
    expect(acct.ok).toBe(true);

    const key = await engine.createApiKey({ ledgerId, userId, name: "iso-key" });
    expect(key.ok).toBe(true);
    if (!key.ok) throw new Error("api key setup failed");
    rawApiKey = key.value.rawKey;

    await insertOAuthToken(db, { token: oauthToken, userId, ledgerId });
  });

  it("BEFORE delete: the token, the key, and the reads all work (non-vacuity)", async () => {
    const snapshot = {
      oauth: (await validateOAuthToken(db, oauthToken, "GET", readPath())).ok,
      apiKey: (await engine.validateApiKey(rawApiKey)).ok,
      getLedger: (await engine.getLedger(ledgerId)).ok,
      listAccounts: (await engine.listAccounts(ledgerId)).ok,
    };
    expect(snapshot).toEqual({ oauth: true, apiKey: true, getLedger: true, listAccounts: true });
  });

  it("AFTER delete: OAuth token, API key, and every ledger-scoped read are rejected", async () => {
    const del = await engine.softDeleteLedger(ledgerId, userId);
    expect(del.ok).toBe(true);

    // OAuth token rejected (revoked on delete AND the ledger-status belt).
    expect((await validateOAuthToken(db, oauthToken, "GET", readPath())).ok).toBe(false);

    // API key rejected (revoked on delete).
    expect((await engine.validateApiKey(rawApiKey)).ok).toBe(false);

    // by-id read + listAccounts + a sample of other ledger-scoped reads: all not-found.
    expect((await engine.getLedger(ledgerId)).ok).toBe(false);
    expect((await engine.listAccounts(ledgerId)).ok).toBe(false);
    expect((await engine.listTransactions(ledgerId)).ok).toBe(false);
    expect((await engine.getLedgerJurisdiction(ledgerId)).ok).toBe(false);
    expect((await engine.getLedgerBusinessInfo(ledgerId)).ok).toBe(false);
    expect((await engine.listApiKeys(ledgerId)).ok).toBe(false);
  });

  it("AFTER delete: the OAuth tokens are revoked at the DB level", async () => {
    await engine.softDeleteLedger(ledgerId, userId);
    const live = await db.all<{ access_token: string }>(
      "SELECT access_token FROM oauth_tokens WHERE ledger_id = ? AND revoked_at IS NULL",
      [ledgerId],
    );
    expect(live.length).toBe(0);
  });

  it("the validateOAuthToken belt rejects even a NON-revoked token once the ledger is deleted", async () => {
    await engine.softDeleteLedger(ledgerId, userId);
    // Simulate a token issued/raced around the delete: un-revoke it in the DB.
    await db.run("UPDATE oauth_tokens SET revoked_at = NULL WHERE access_token = ?", [oauthToken]);
    // It is now unrevoked + unexpired + correctly scoped, yet must STILL be
    // rejected purely because its ledger is soft-deleted.
    expect((await validateOAuthToken(db, oauthToken, "GET", readPath())).ok).toBe(false);
  });

  it("the control ledger (same owner, not deleted) stays fully readable", async () => {
    await engine.softDeleteLedger(ledgerId, userId);
    expect((await engine.getLedger(otherLedgerId)).ok).toBe(true);
    expect((await engine.listAccounts(otherLedgerId)).ok).toBe(true);
    const owned = await engine.findLedgersByOwner(userId);
    expect(owned.ok).toBe(true);
    if (owned.ok) {
      expect(owned.value.find((l) => l.id === otherLedgerId)).toBeDefined();
      expect(owned.value.find((l) => l.id === ledgerId)).toBeUndefined();
    }
  });
});

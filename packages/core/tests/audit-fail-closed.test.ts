// ---------------------------------------------------------------------------
// Audit-write FAIL-CLOSED proof.
//
// An audited mutation must be atomic with its audit entry: if the audit write
// fails, the mutation must roll back — the ledger must never change without a
// corresponding append-only audit row.
//
// Injection: wrap the real Database so every `INSERT INTO audit_entries` throws,
// then run audited operations and assert the underlying mutation did NOT persist.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { LedgerEngine } from "../src/index.js";
import type { Database, RunResult } from "../src/db/database.js";
import { createFullTestDb } from "./helpers/migrate.js";

const AUDIT_INSERT = /INSERT INTO audit_entries/i;

const createSystemUser = async (db: Database): Promise<string> => {
  const userId = "00000000-0000-7000-8000-000000000001";
  await db.run(
    `INSERT INTO users (id, email, name, auth_provider, auth_provider_id)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, "system@test.com", "System", "test", "test-001"],
  );
  return userId;
};

/**
 * Forwards every Database call to a real db, EXCEPT it makes audit-entry inserts
 * throw. transaction() delegates to the real db, so BEGIN/COMMIT/ROLLBACK run on
 * the real connection while the engine's audit insert (routed back through this
 * wrapper) throws and triggers the rollback.
 */
class AuditFailingDb implements Database {
  public auditAttempts = 0;
  constructor(private readonly real: Database) {}

  run(sql: string, params?: unknown[]): Promise<RunResult> {
    if (AUDIT_INSERT.test(sql)) {
      this.auditAttempts++;
      throw new Error("INJECTED: audit write failed");
    }
    return this.real.run(sql, params);
  }
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined> {
    return this.real.get<T>(sql, params);
  }
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.real.all<T>(sql, params);
  }
  exec(sql: string): Promise<void> {
    return this.real.exec(sql);
  }
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.real.transaction(fn);
  }
  close(): Promise<void> {
    return this.real.close();
  }
}

describe("audit writes fail closed (op rolls back if its audit entry can't be written)", () => {
  let real: Database;
  let failing: AuditFailingDb;
  let engine: LedgerEngine; // engine wired to the audit-failing db
  let plainEngine: LedgerEngine; // engine wired to the real db (for setup)
  let ownerId: string;
  let ledgerId: string;

  beforeEach(async () => {
    real = await createFullTestDb();
    plainEngine = new LedgerEngine(real);
    ownerId = await createSystemUser(real);

    // Seed a ledger + a second ledger (softDeleteLedger refuses the only ledger)
    // using the real engine, so setup audit writes succeed.
    const led = await plainEngine.createLedger({ name: "Primary", ownerId });
    expect(led.ok).toBe(true);
    if (!led.ok) return;
    ledgerId = led.value.id;
    await plainEngine.createLedger({ name: "Secondary", ownerId });

    failing = new AuditFailingDb(real);
    engine = new LedgerEngine(failing);
  });

  it("createAccount: account is NOT persisted when its audit write fails", async () => {
    const before = await plainEngine.listAccounts(ledgerId);
    const beforeCount = before.ok ? before.value.length : -1;

    await expect(
      engine.createAccount({ ledgerId, code: "9999", name: "Doomed", type: "asset" }),
    ).rejects.toThrow(/audit write failed/);

    expect(failing.auditAttempts).toBeGreaterThan(0);

    // The account must not exist — the insert rolled back with the audit failure.
    const after = await plainEngine.listAccounts(ledgerId);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value.length).toBe(beforeCount);
      expect(after.value.find((a) => a.code === "9999")).toBeUndefined();
    }
  });

  it("revokeApiKey: key stays ACTIVE when its audit write fails", async () => {
    const created = await plainEngine.createApiKey({ ledgerId, userId: ownerId, name: "k1" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const keyId = created.value.apiKey.id;

    await expect(engine.revokeApiKey(keyId)).rejects.toThrow(/audit write failed/);

    // Key must still be active — the UPDATE rolled back with the audit failure.
    const keys = await plainEngine.listApiKeys(ledgerId);
    expect(keys.ok).toBe(true);
    if (keys.ok) {
      const k = keys.value.find((x) => x.id === keyId);
      expect(k?.status).toBe("active");
    }
  });

  it("postTransaction: nothing is posted when the audit write fails", async () => {
    await plainEngine.createAccount({ ledgerId, code: "1000", name: "Cash", type: "asset" });
    await plainEngine.createAccount({ ledgerId, code: "3000", name: "Equity", type: "equity" });

    const before = await plainEngine.listTransactions(ledgerId);
    const beforeCount = before.ok ? before.value.data.length : -1;

    await expect(
      engine.postTransaction({
        ledgerId,
        date: "2025-06-15",
        memo: "Doomed entry",
        lines: [
          { accountCode: "1000", amount: 1000, direction: "debit" },
          { accountCode: "3000", amount: 1000, direction: "credit" },
        ],
      }),
    ).rejects.toThrow(/audit write failed/);

    const after = await plainEngine.listTransactions(ledgerId);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value.data.length).toBe(beforeCount);
    }
  });

  it("softDeleteLedger (nested): audit failure rolls back BOTH the ledger delete AND the key revocations", async () => {
    // Seed two active keys via the real engine, so there is a nested revoke loop.
    const k1 = await plainEngine.createApiKey({ ledgerId, userId: ownerId, name: "k1" });
    const k2 = await plainEngine.createApiKey({ ledgerId, userId: ownerId, name: "k2" });
    expect(k1.ok && k2.ok).toBe(true);
    if (!k1.ok || !k2.ok) return;

    await expect(engine.softDeleteLedger(ledgerId, ownerId)).rejects.toThrow(/audit write failed/);

    // The audit write was actually REACHED — 033 added 'deleted' to ledger_status,
    // so the UPDATE no longer throws on the constraint before the audit insert.
    // (Before 033 this was 0: the op died on the CHECK and the test was vacuous.)
    expect(failing.auditAttempts).toBeGreaterThan(0);

    // Ledger NOT deleted — the outer transaction rolled back.
    const ledRow = await real.get<{ status: string }>("SELECT status FROM ledgers WHERE id = ?", [ledgerId]);
    expect(ledRow?.status).toBe("active");

    // BOTH keys still active — the nested revokeApiKey savepoints rolled back too.
    const keys = await plainEngine.listApiKeys(ledgerId);
    expect(keys.ok).toBe(true);
    if (keys.ok) {
      const statuses = keys.value
        .filter((k) => k.id === k1.value.apiKey.id || k.id === k2.value.apiKey.id)
        .map((k) => k.status)
        .sort();
      expect(statuses).toEqual(["active", "active"]);
    }

    // No 'deleted'/'revoked' audit rows were persisted.
    const rows = await real.all<{ action: string }>(
      "SELECT action FROM audit_entries WHERE ledger_id = ? AND action IN ('deleted', 'revoked')",
      [ledgerId],
    );
    expect(rows.length).toBe(0);
  });

  it("softDeleteLedger (happy path): succeeds, hides the ledger, revokes its keys, writes the audit row", async () => {
    const key = await plainEngine.createApiKey({ ledgerId, userId: ownerId, name: "k1" });
    expect(key.ok).toBe(true);
    if (!key.ok) return;

    const res = await plainEngine.softDeleteLedger(ledgerId, ownerId);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.status).toBe("deleted");

    // Hidden from the by-id read and the owner's list.
    const got = await plainEngine.getLedger(ledgerId);
    expect(got.ok).toBe(false);
    const list = await plainEngine.findLedgersByOwner(ownerId);
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value.find((l) => l.id === ledgerId)).toBeUndefined();

    // Underlying row really is 'deleted', the key is revoked, the audit row exists.
    const ledRow = await real.get<{ status: string }>("SELECT status FROM ledgers WHERE id = ?", [ledgerId]);
    expect(ledRow?.status).toBe("deleted");
    const keys = await plainEngine.listApiKeys(ledgerId);
    if (keys.ok) expect(keys.value.find((k) => k.id === key.value.apiKey.id)?.status).toBe("revoked");
    const audit = await real.all<{ action: string }>(
      "SELECT action FROM audit_entries WHERE ledger_id = ? AND entity_type = 'ledger' AND action = 'deleted'",
      [ledgerId],
    );
    expect(audit.length).toBe(1);
  });
});

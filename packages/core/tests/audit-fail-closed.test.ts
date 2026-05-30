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

  it("softDeleteLedger: ledger stays ACTIVE when its audit write fails", async () => {
    await expect(engine.softDeleteLedger(ledgerId, ownerId)).rejects.toThrow();

    const led = await plainEngine.getLedger(ledgerId);
    expect(led.ok).toBe(true);
    if (led.ok) {
      expect(led.value.status).not.toBe("deleted");
    }
  });
});

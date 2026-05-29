// ---------------------------------------------------------------------------
// Smoke test for the shared full-migration fixture.
//
// Guards the regression that motivated it: tier checks failed open because the
// per-test fixtures omitted 027_tier_usage_tracking, so `usage_tracking` was a
// silent "no such table". The full fixture must include it — and every other
// table the schema declares.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { createFullTestDb } from "./helpers/migrate.js";

describe("full-migration test fixture", () => {
  it("applies every SQLite migration without error", async () => {
    const db = await createFullTestDb();
    const tables = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    // A healthy schema has many tables; assert a sane floor.
    expect(tables.length).toBeGreaterThan(20);
  });

  it("includes tables the hand-picked fixtures used to omit", async () => {
    const db = await createFullTestDb();
    const names = (
      await db.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      )
    ).map((r) => r.name);

    // The exact table whose absence let tier checks fail open.
    expect(names).toContain("usage_tracking");
    // Core ledger + bank-feed tables the ingestion pipeline depends on.
    expect(names).toContain("transactions");
    expect(names).toContain("line_items");
    expect(names).toContain("bank_transactions");
    expect(names).toContain("bank_accounts");
    expect(names).toContain("bank_connections");
  });
});

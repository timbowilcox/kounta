// ---------------------------------------------------------------------------
// ANTI-DRIFT GUARD (B1 regression).
//
// This test makes the B1 class of bug impossible to reintroduce: a migration
// file that exists on disk but is not wired into the production runner (or a
// runner entry with no file). It compares the migration files on disk against
// the SINGLE source of truth — REGISTERED ∪ PENDING in
// src/db/migration-manifest.ts — and FAILS on any drift.
//
// 028/029/030 are EXPLICIT, documented PENDING exceptions: files that exist but
// are deliberately not applied in production yet (gated on live-DB
// verification). They are allowed on disk but NOT in the prod runner. Any OTHER
// unregistered file — e.g. a freshly-added 033 someone forgot to register — is
// drift and fails this test.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import { readdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  REGISTERED_MIGRATIONS,
  PENDING_MIGRATIONS,
  findMigrationDrift,
  isClean,
} from "../src/db/migration-manifest.js";

const MIGRATIONS_DIR = resolve(__dirname, "../src/db/migrations");

const listMigrationFiles = (): string[] =>
  readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));

describe("migration anti-drift guard", () => {
  it("every migration file on disk is REGISTERED or an explicit PENDING exception (and vice versa)", () => {
    const files = listMigrationFiles();
    const drift = findMigrationDrift({
      sqliteFilesOnDisk: files,
      pgFilesOnDisk: files,
    });

    // Surface the specifics in the failure message so a future drift is
    // actionable: register the file in REGISTERED_MIGRATIONS (or document it in
    // PENDING_MIGRATIONS), or delete the orphaned list entry.
    expect(
      isClean(drift),
      `Migration drift detected:\n${JSON.stringify(drift, null, 2)}\n` +
        `Fix: add the stem to REGISTERED_MIGRATIONS (ships to prod) or ` +
        `PENDING_MIGRATIONS (documented, not yet shipped) in ` +
        `src/db/migration-manifest.ts — or remove the orphaned list entry.`,
    ).toBe(true);
  });

  it("PENDING is empty — every migration on disk is REGISTERED for launch", () => {
    // 028/029/030 graduated into REGISTERED for the launch fresh-DB provision, so
    // PENDING is now empty. This does NOT blind the guard: the synthetic + real
    // file tests below prove a freshly-added unregistered migration is still
    // caught even with PENDING empty. If you intentionally add a not-yet-shipped
    // migration, add its stem to PENDING and update this expectation.
    expect([...PENDING_MIGRATIONS].sort()).toEqual([]);
  });

  it("catches a (synthetic) unregistered migration file", () => {
    const files = [...listMigrationFiles(), "099_bogus_unregistered.sqlite.sql"];
    const drift = findMigrationDrift({
      sqliteFilesOnDisk: files,
      pgFilesOnDisk: files,
    });
    expect(isClean(drift)).toBe(false);
    expect(drift.unregisteredSqlite).toContain("099_bogus_unregistered.sqlite.sql");
  });

  it("catches a (synthetic) registered migration whose file is missing", () => {
    // Drop 001's SQLite file from the on-disk list — a runner entry with no file.
    const files = listMigrationFiles().filter(
      (f) => f !== "001_initial_schema.sqlite.sql",
    );
    const drift = findMigrationDrift({
      sqliteFilesOnDisk: files,
      pgFilesOnDisk: files,
    });
    expect(isClean(drift)).toBe(false);
    expect(drift.missingSqlite).toContain("001_initial_schema.sqlite.sql");
  });
});

// ---------------------------------------------------------------------------
// End-to-end proof: a migration file ACTUALLY added to the migrations
// directory (not just a synthetic list) is caught by the guard.
// ---------------------------------------------------------------------------

describe("migration anti-drift guard — real deliberately-added file", () => {
  const probeStem = "099_deliberate_drift_probe";
  const probeSqlite = resolve(MIGRATIONS_DIR, `${probeStem}.sqlite.sql`);

  afterEach(() => {
    // Always clean up, even if an assertion threw.
    if (existsSync(probeSqlite)) rmSync(probeSqlite);
  });

  it("FAILS when an unregistered migration is dropped into the directory", () => {
    writeFileSync(probeSqlite, "-- deliberate drift probe (test only)\n", "utf-8");

    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    const drift = findMigrationDrift({
      sqliteFilesOnDisk: files,
      pgFilesOnDisk: files,
    });

    // The guard the real test uses (isClean) would have failed here — prove it.
    expect(files).toContain(`${probeStem}.sqlite.sql`);
    expect(isClean(drift)).toBe(false);
    expect(drift.unregisteredSqlite).toContain(`${probeStem}.sqlite.sql`);

    // Sanity: with the probe removed, the manifest is clean again.
    rmSync(probeSqlite);
    const cleanFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    expect(
      isClean(findMigrationDrift({ sqliteFilesOnDisk: cleanFiles, pgFilesOnDisk: cleanFiles })),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SINGLE SOURCE OF TRUTH for the migration set.
//
// This module is side-effect-free (no fs, no server boot) so BOTH the
// production runner (packages/api/src/migrations.ts → index.ts) AND every test
// fixture can derive their migration list from exactly one ordered list. There
// is no per-test hand-picked subset and no runtime `readdirSync` — that
// divergence is precisely how 027 (`usage_tracking`) went missing from the API
// tests and tier checks silently failed open, and how 028/029/030 drifted out
// of the production runner unnoticed (B1).
//
// Two sets:
//   REGISTERED — what PRODUCTION applies, in order. The full set 001–033.
//   PENDING    — files that exist on disk but are NOT applied in production yet.
//                Currently EMPTY. 028/029/030 were the last holdouts (gated on a
//                live-DB safety check that protected the old prod volume); that
//                gate is VOID for launch — prod has been offline ~3 months with
//                only disposable pre-launch data and a FRESH empty Postgres volume
//                is provisioned at launch, so 028/029/030 now apply cleanly, in
//                order, to an empty DB on first boot. They are REGISTERED.
//
// The anti-drift guard (packages/core/tests/migration-drift.test.ts) asserts
// that the files on disk are exactly REGISTERED ∪ PENDING — so a new migration
// file can never silently drift out of the production runner again. PENDING is
// the explicit, documented exception list; add to it only for files deliberately
// not yet shipped, and shrink it as they are registered.
// ---------------------------------------------------------------------------

/**
 * Ordered list of migration stems PRODUCTION applies. A "stem" is the filename
 * without dialect extension, e.g. `001_initial_schema` →
 * `001_initial_schema.sql` (Postgres) / `001_initial_schema.sqlite.sql`
 * (SQLite). Order is the apply order.
 */
export const REGISTERED_MIGRATIONS: readonly string[] = [
  "001_initial_schema",
  "002_audit_action_updated", // PG-virtual: enum-only, applied inline by the runner (no .sql file)
  "003_billing",
  "004_bank_feeds",
  "005_intelligence",
  "006_multi_currency",
  "007_conversations",
  "008_classification",
  "009_email",
  "010_onboarding",
  "011_attachments",
  "012_recurring_entries",
  "013_closed_periods",
  "014_global_classifications",
  "015_stripe_connect",
  "016_revenue_recognition",
  "017_revenue_notifications",
  "018_oauth",
  "019_fixed_assets",
  "020_capitalisation_notification",
  "021_invoicing",
  "022_invoice_payment_match_notification",
  "023_invoice_sent_at",
  "024_customers",
  "025_invoice_approved_status",
  "026_fix_invoice_approved_constraint",
  "027_tier_usage_tracking",
  "028_sql_review_fixes",
  "029_bills",
  "030_audit_action_revoked_deleted", // PG: ALTER TYPE ADD VALUE — runner special-cases this (cf. 017/020/022)
  "031_csv_import",
  "032_review_items",
  "033_ledger_status_deleted", // PG: ALTER TYPE ledger_status ADD VALUE — runner special-cases this (cf. 030)
];

/**
 * Migration files that exist on disk but are NOT yet applied in production.
 * Each must stay here (NOT in REGISTERED) until it is safe to ship. The anti-drift
 * guard still enforces that any *new* file on disk is in REGISTERED or PENDING, so
 * an empty PENDING does not blind the guard — a freshly-added unregistered file is
 * still caught (see migration-drift.test.ts).
 *
 * Currently EMPTY: 028/029/030 graduated to REGISTERED for launch. The live-DB
 * safety gate that held them back protected the old prod volume; it is void now
 * that launch provisions a FRESH empty Postgres (no live data to reconcile).
 *   - 028 perf indexes + audit-immutability trigger (its CREATE TRIGGER is not
 *     idempotent, which is fine on a fresh DB applied once via the tracked runner).
 *   - 029 bills/vendors AP tables + usage_tracking columns (feature already mounted).
 *   - 030 adds 'updated'/'revoked'/'deleted' to audit_action; the PG ALTER TYPE
 *     ADD VALUE is runner-special-cased like 017/020/022.
 */
export const PENDING_MIGRATIONS: readonly string[] = [];

/**
 * Stems with NO Postgres `.sql` file on disk — applied inline by the runner
 * (an `ALTER TYPE ... ADD VALUE`). They still appear in the PG runner list by
 * name (the runner switches on the name), but the drift guard must not expect a
 * `.sql` file for them.
 */
export const PG_VIRTUAL_STEMS: ReadonlySet<string> = new Set(["002_audit_action_updated"]);

/** Every stem known to the manifest (applied + pending). */
export const KNOWN_MIGRATIONS: readonly string[] = [
  ...REGISTERED_MIGRATIONS,
  ...PENDING_MIGRATIONS,
];

const toPgFile = (stem: string): string => `${stem}.sql`;
const toSqliteFile = (stem: string): string => `${stem}.sqlite.sql`;

/**
 * Ordered Postgres migration names the production runner applies. Includes
 * PG-virtual stems by name (e.g. `002_audit_action_updated.sql`) to match the
 * runner's existing switch logic.
 */
export const registeredPgMigrationFiles = (): string[] =>
  REGISTERED_MIGRATIONS.map(toPgFile);

/** Ordered SQLite migration files the production runner applies. */
export const registeredSqliteMigrationFiles = (): string[] =>
  REGISTERED_MIGRATIONS.map(toSqliteFile);

// ---------------------------------------------------------------------------
// Anti-drift detection (pure — caller supplies the on-disk file lists)
// ---------------------------------------------------------------------------

export interface MigrationDrift {
  /** SQLite files on disk that are in neither REGISTERED nor PENDING. */
  unregisteredSqlite: string[];
  /** Postgres files on disk that are in neither REGISTERED nor PENDING. */
  unregisteredPg: string[];
  /** Known stems whose SQLite file is missing from disk. */
  missingSqlite: string[];
  /** Known (non-virtual) stems whose Postgres file is missing from disk. */
  missingPg: string[];
}

/** True when no drift of any kind was found. */
export const isClean = (drift: MigrationDrift): boolean =>
  drift.unregisteredSqlite.length === 0 &&
  drift.unregisteredPg.length === 0 &&
  drift.missingSqlite.length === 0 &&
  drift.missingPg.length === 0;

/**
 * Compare the migration files on disk against the manifest (REGISTERED ∪
 * PENDING). Pure: takes the file lists, touches no filesystem, so it is
 * trivially unit-testable with synthetic inputs.
 *
 * Drift is reported when:
 *   - a `.sql`/`.sqlite.sql` file on disk maps to a stem in neither set, OR
 *   - a known stem has no corresponding file on disk
 *     (Postgres files are not expected for PG-virtual stems).
 */
export const findMigrationDrift = (input: {
  sqliteFilesOnDisk: readonly string[];
  pgFilesOnDisk: readonly string[];
}): MigrationDrift => {
  const known = new Set(KNOWN_MIGRATIONS);

  const sqliteStemsOnDisk = input.sqliteFilesOnDisk
    .filter((f) => f.endsWith(".sqlite.sql"))
    .map((f) => f.slice(0, -".sqlite.sql".length));

  // Postgres files are the bare `.sql` files — exclude the `.sqlite.sql` ones.
  const pgStemsOnDisk = input.pgFilesOnDisk
    .filter((f) => f.endsWith(".sql") && !f.endsWith(".sqlite.sql"))
    .map((f) => f.slice(0, -".sql".length));

  const sqliteStemSet = new Set(sqliteStemsOnDisk);
  const pgStemSet = new Set(pgStemsOnDisk);

  return {
    unregisteredSqlite: sqliteStemsOnDisk
      .filter((stem) => !known.has(stem))
      .map(toSqliteFile)
      .sort(),
    unregisteredPg: pgStemsOnDisk
      .filter((stem) => !known.has(stem))
      .map(toPgFile)
      .sort(),
    missingSqlite: KNOWN_MIGRATIONS.filter((stem) => !sqliteStemSet.has(stem))
      .map(toSqliteFile)
      .sort(),
    missingPg: KNOWN_MIGRATIONS.filter(
      (stem) => !PG_VIRTUAL_STEMS.has(stem) && !pgStemSet.has(stem),
    )
      .map(toPgFile)
      .sort(),
  };
};

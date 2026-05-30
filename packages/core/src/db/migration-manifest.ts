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
//   REGISTERED — what PRODUCTION actually applies, in order. Reflects current
//                prod reality: 001–027 + 031 + 032.
//   PENDING    — files that exist on disk but are NOT applied in production yet.
//                Currently 028/029/030. They are gated on live-DB verification
//                (idempotency + safety against the real Railway schema) and must
//                NOT be added to REGISTERED until that verification is done.
//                Registering them = prod runs them on the next deploy.
//
// The anti-drift guard (packages/core/tests/migration-drift.test.ts) asserts
// that the files on disk are exactly REGISTERED ∪ PENDING — so a new migration
// file can never silently drift out of the production runner again. PENDING is
// the explicit, documented exception list; shrink it (move entries into
// REGISTERED) only once the live-DB checks pass.
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
  // 028/029/030 are PENDING (see below). 031/032 depend only on 001/004, so
  // they apply cleanly after 027 even with 028–030 absent.
  "031_csv_import",
  "032_review_items",
];

/**
 * Migration files that exist on disk but are NOT yet applied in production.
 * Each must stay here (NOT in REGISTERED) until verified safe + idempotent
 * against the live Railway schema. See migrations.ts / HANDOFF.md for the
 * exact live-DB checks owed before any of these can move to REGISTERED.
 *
 *   028_sql_review_fixes               — perf indexes + audit-immutability
 *                                        triggers (CREATE TRIGGER is NOT
 *                                        idempotent; verify triggers absent).
 *   029_bills                          — bills/vendors AP tables + usage_tracking
 *                                        columns; feature is mounted in prod but
 *                                        the tables do not exist there.
 *   030_audit_action_revoked_deleted   — adds 'revoked'/'deleted' to audit_action;
 *                                        engine writes these today and prod
 *                                        rejects them. ALTER TYPE ADD VALUE needs
 *                                        runner special-casing (cf. 017/020/022)
 *                                        before registration.
 */
export const PENDING_MIGRATIONS: readonly string[] = [
  "028_sql_review_fixes",
  "029_bills",
  "030_audit_action_revoked_deleted",
];

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

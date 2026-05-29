// ---------------------------------------------------------------------------
// The ordered migration lists the PRODUCTION runner applies.
//
// These live in their OWN module (no side effects) so tests can import the
// real production list WITHOUT pulling in index.ts, whose module body calls
// main() and starts the server (that caused an EADDRINUSE unhandled error when
// two test files imported it). The migrations directory is NOT scanned at
// runtime — when you add a migration file you MUST add it to BOTH lists here.
// See packages/api/tests/migration-parity.test.ts.
// ---------------------------------------------------------------------------

/** Ordered list of PostgreSQL migrations applied in production. */
export const PG_MIGRATIONS: readonly string[] = [
  "001_initial_schema.sql",
  "002_audit_action_updated.sql", // virtual — enum-only, handled inline in the runner
  "003_billing.sql",
  "004_bank_feeds.sql",
  "005_intelligence.sql",
  "006_multi_currency.sql",
  "007_conversations.sql",
  "008_classification.sql",
  "009_email.sql",
  "010_onboarding.sql",
  "011_attachments.sql",
  "012_recurring_entries.sql",
  "013_closed_periods.sql",
  "014_global_classifications.sql",
  "015_stripe_connect.sql",
  "016_revenue_recognition.sql",
  "017_revenue_notifications.sql",
  "018_oauth.sql",
  "019_fixed_assets.sql",
  "020_capitalisation_notification.sql",
  "021_invoicing.sql",
  "022_invoice_payment_match_notification.sql",
  "023_invoice_sent_at.sql",
  "024_customers.sql",
  "025_invoice_approved_status.sql",
  "026_fix_invoice_approved_constraint.sql",
  "027_tier_usage_tracking.sql",
  // NOTE: 028–030 are intentionally NOT registered yet (security/integrity
  // blocker sprint). 031/032 depend only on 001/004, so they apply after 027.
  "031_csv_import.sql",
  "032_review_items.sql",
];

/** Ordered list of SQLite migrations applied in production. */
export const SQLITE_MIGRATION_FILES: readonly string[] = [
  "001_initial_schema.sqlite.sql",
  "002_audit_action_updated.sqlite.sql",
  "003_billing.sqlite.sql",
  "004_bank_feeds.sqlite.sql",
  "005_intelligence.sqlite.sql",
  "006_multi_currency.sqlite.sql",
  "007_conversations.sqlite.sql",
  "008_classification.sqlite.sql",
  "009_email.sqlite.sql",
  "010_onboarding.sqlite.sql",
  "011_attachments.sqlite.sql",
  "012_recurring_entries.sqlite.sql",
  "013_closed_periods.sqlite.sql",
  "014_global_classifications.sqlite.sql",
  "015_stripe_connect.sqlite.sql",
  "016_revenue_recognition.sqlite.sql",
  "017_revenue_notifications.sqlite.sql",
  "018_oauth.sqlite.sql",
  "019_fixed_assets.sqlite.sql",
  "020_capitalisation_notification.sqlite.sql",
  "021_invoicing.sqlite.sql",
  "022_invoice_payment_match_notification.sqlite.sql",
  "023_invoice_sent_at.sqlite.sql",
  "024_customers.sqlite.sql",
  "025_invoice_approved_status.sqlite.sql",
  "026_fix_invoice_approved_constraint.sqlite.sql",
  "027_tier_usage_tracking.sqlite.sql",
  // 028–030 intentionally not registered yet (blocker sprint).
  "031_csv_import.sqlite.sql",
  "032_review_items.sqlite.sql",
];

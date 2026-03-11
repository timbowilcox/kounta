// Fix JSONB field types in row interfaces to handle both SQLite (string) and PostgreSQL (object)
const fs = require("fs");
const path = require("path");

const fp = path.join(__dirname, "..", "packages", "core", "src", "engine", "index.ts");
let c = fs.readFileSync(fp, "utf-8");

// Update the row types to allow string | Record<string, unknown> for JSONB fields
// LedgerRow
c = c.replace(
  "business_context: string | null;",
  "business_context: string | Record<string, unknown> | null;"
);

// AccountRow, TransactionRow, LineItemRow — metadata fields
// All are "metadata: string | null" — replace all occurrences in the interface context
// We need to be careful to only replace in the interface definitions, not elsewhere
// Use a targeted approach: replace "  metadata: string | null;" (with leading spaces)
c = c.replace(
  /^(  metadata:\s+)string \| null;/gm,
  "$1string | Record<string, unknown> | null;"
);

// AuditEntryRow — snapshot field
c = c.replace(
  "snapshot: string;",
  "snapshot: string | Record<string, unknown>;"
);

// ImportRowRow — raw_data field
c = c.replace(
  "raw_data: string;",
  "raw_data: string | Record<string, unknown>;"
);

try { fs.unlinkSync(fp); } catch {}
fs.writeFileSync(fp, c);
console.log("done - updated JSONB field types in row interfaces");

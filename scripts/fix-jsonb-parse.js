// Fix JSON.parse calls on JSONB columns to handle both SQLite (string) and PostgreSQL (object)
const fs = require("fs");
const path = require("path");

const fp = path.join(__dirname, "..", "packages", "core", "src", "engine", "index.ts");
let c = fs.readFileSync(fp, "utf-8");

// Add a helper function after the imports section
// Find the first "const" after imports to insert before it
const helperFn = `
/**
 * Safely parse a JSONB value from the database.
 * SQLite returns JSON as TEXT (string), PostgreSQL returns JSONB as a parsed JS object.
 * This helper handles both cases.
 */
const parseJsonb = <T = Record<string, unknown>>(value: string | T): T => {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
};

`;

// Insert after the "import" block — find the first line that starts with "// --" after imports
const insertMarker = "// ---------------------------------------------------------------------------\n// Row";
const insertMarkerCRLF = "// ---------------------------------------------------------------------------\r\n// Row";

if (c.includes(insertMarkerCRLF)) {
  c = c.replace(insertMarkerCRLF, helperFn.replace(/\n/g, "\r\n") + insertMarkerCRLF);
} else if (c.includes(insertMarker)) {
  c = c.replace(insertMarker, helperFn + insertMarker);
} else {
  console.error("Could not find insert marker");
  process.exit(1);
}

// Replace all JSON.parse(row.xxx) patterns with parseJsonb(row.xxx)
// Pattern: JSON.parse(row.field_name)
c = c.replace(/JSON\.parse\(row\.(\w+)\)/g, "parseJsonb(row.$1)");

// Also fix the inline ones in the report functions: JSON.parse(row.metadata)
// These are already covered by the regex above

try { fs.unlinkSync(fp); } catch {}
fs.writeFileSync(fp, c);
console.log("done - replaced all JSON.parse(row.xxx) with parseJsonb(row.xxx)");

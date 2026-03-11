// Fix boolean reading to be compatible with both SQLite (integer) and PostgreSQL (boolean)
const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "packages", "core", "src", "engine", "index.ts");
let content = fs.readFileSync(filePath, "utf-8");

// Fix: is_system === 1 -> Boolean(is_system) or !!is_system
// This works for both SQLite (1/0) and PostgreSQL (true/false)
content = content.replace(
  /row\.is_system === 1/g,
  "!!row.is_system"
);

// Also fix the AccountRow type — is_system should be number | boolean
content = content.replace(
  /is_system: number;/g,
  "is_system: number | boolean;"
);

// Fix createAccount hardcoded 0 to false for PostgreSQL
content = content.replace(
  /is_system, metadata, status, created_at, updated_at\)\n       VALUES \(\?, \?, \?, \?, \?, \?, \?, 0, \?, 'active', \?, \?\)/,
  "is_system, metadata, status, created_at, updated_at)\n       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)"
);

// Need to also add the false parameter to the createAccount params array
content = content.replace(
  /\[id, params\.ledgerId, parentId, params\.code, params\.name, params\.type, normalBalance, metadata, now, now\]/,
  "[id, params.ledgerId, parentId, params.code, params.name, params.type, normalBalance, false, metadata, now, now]"
);

try { fs.unlinkSync(filePath); } catch {}
fs.writeFileSync(filePath, content);
console.log("✓ Fixed boolean reads in", filePath);

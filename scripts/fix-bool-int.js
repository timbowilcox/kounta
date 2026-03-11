// Fix boolean/integer mismatches for PostgreSQL compatibility
const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "packages", "core", "src", "engine", "index.ts");
let content = fs.readFileSync(filePath, "utf-8");

// Fix all instances of "? 1 : 0" for boolean columns (PostgreSQL needs true/false)
// Replace: ta.isSystem ? 1 : 0
content = content.replace(
  /ta\.isSystem \? 1 : 0/g,
  "ta.isSystem ? true : false"
);

// Also fix is_system in createAccount if present
content = content.replace(
  /params\.isSystem \? 1 : 0/g,
  "params.isSystem ? true : false"
);

// Fix any other boolean column patterns (is_system)
content = content.replace(
  /isSystem \? 1 : 0/g,
  "isSystem ? true : false"
);

try { fs.unlinkSync(filePath); } catch {}
fs.writeFileSync(filePath, content);
console.log("✓ Fixed boolean/integer mismatches in", filePath);

const fs = require("fs");
const path = require("path");

const fp = path.join(__dirname, "..", "packages", "core", "src", "engine", "index.ts");
let c = fs.readFileSync(fp, "utf-8");

// The createAccount INSERT has hardcoded `0` for is_system and 'active' for status
// We need ?, ?, for both is_system and status to be parameterized for PG compatibility
// But status='active' as literal is fine for both. The issue is `0` hardcoded.
// Change: VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?)
// To:     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)

c = c.replace(
  "VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?)\",\n      [id, params.ledgerId, parentId, params.code, params.name, params.type, normalBalance, false, metadata, now, now]",
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)\",\n      [id, params.ledgerId, parentId, params.code, params.name, params.type, normalBalance, false, metadata, now, now]"
);

// Handle CRLF variant
c = c.replace(
  "VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?)\",\r\n      [id, params.ledgerId, parentId, params.code, params.name, params.type, normalBalance, false, metadata, now, now]",
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)\",\r\n      [id, params.ledgerId, parentId, params.code, params.name, params.type, normalBalance, false, metadata, now, now]"
);

try { fs.unlinkSync(fp); } catch {}
fs.writeFileSync(fp, c);
console.log("done");

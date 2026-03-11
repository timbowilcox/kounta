// Script to update the createApiKey method to auto-create users
const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "packages", "core", "src", "engine", "index.ts");
let content = fs.readFileSync(filePath, "utf-8");

// Find the createApiKey method and add user auto-creation before the INSERT
const marker = "    await this.db.run(\n      `INSERT INTO api_keys (id, user_id, ledger_id, key_hash, prefix, name, status, created_at, updated_at)";
const markerCRLF = marker.replace(/\n/g, "\r\n");

const userAutoCreate = `    // Ensure the user exists (auto-create for admin/system callers)
    const existingUser = await this.db.get("SELECT id FROM users WHERE id = ?", [params.userId]);
    if (!existingUser) {
      await this.db.run(
        "INSERT INTO users (id, email, name, auth_provider, auth_provider_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [params.userId, \`user-\${params.userId.substring(0, 8)}@ledge.internal\`, "Auto-created User", "system", params.userId, now, now]
      );
    }

`;

if (content.includes(markerCRLF)) {
  content = content.replace(markerCRLF, userAutoCreate.replace(/\n/g, "\r\n") + markerCRLF);
} else if (content.includes(marker)) {
  content = content.replace(marker, userAutoCreate + marker);
} else {
  console.error("Could not find createApiKey INSERT marker");
  process.exit(1);
}

try { fs.unlinkSync(filePath); } catch {}
fs.writeFileSync(filePath, content);
console.log("✓ Updated createApiKey in", filePath);

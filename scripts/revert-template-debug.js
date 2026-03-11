const fs = require("fs");
const path = require("path");

const fp = path.join(__dirname, "..", "packages", "api", "src", "routes", "templates.ts");
let c = fs.readFileSync(fp, "utf-8");

// Replace the debug try-catch block back to simple call
// Find "let result;" and replace to the end of the catch block
const debugPattern = /let result;\s*\n\s*try \{\s*\n\s*result = await engine\.applyTemplate\(body\.ledgerId, body\.templateSlug\);\s*\n\s*\} catch \(e: unknown\) \{[^}]*\}\s*\}/;

const replacement = `const result = await engine.applyTemplate(body.ledgerId, body.templateSlug);`;

if (debugPattern.test(c)) {
  c = c.replace(debugPattern, replacement);
  console.log("replaced debug block");
} else {
  console.log("debug block not found, checking if already reverted");
  if (c.includes(replacement)) {
    console.log("already reverted");
  } else {
    console.error("Could not find debug block to revert");
    process.exit(1);
  }
}

try { fs.unlinkSync(fp); } catch {}
fs.writeFileSync(fp, c);
console.log("done");

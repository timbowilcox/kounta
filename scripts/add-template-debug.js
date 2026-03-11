const fs = require("fs");
const path = require("path");

const fp = path.join(__dirname, "..", "packages", "api", "src", "routes", "templates.ts");
let c = fs.readFileSync(fp, "utf-8");

const oldCode = `const result = await engine.applyTemplate(body.ledgerId, body.templateSlug);`;
const newCode = `let result;
  try {
    result = await engine.applyTemplate(body.ledgerId, body.templateSlug);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? (e.stack || "").split("\\n").slice(0, 5).join(" | ") : "";
    return c.json({ error: { code: "TEMPLATE_APPLY_ERROR", message: msg, stack, requestId: c.get("requestId") } }, 500);
  }`;

c = c.replace(oldCode, newCode);
try { fs.unlinkSync(fp); } catch {}
fs.writeFileSync(fp, c);
console.log("done");

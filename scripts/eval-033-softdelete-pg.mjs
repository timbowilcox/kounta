// softDeleteLedger happy-path against REAL Postgres (DATABASE_URL set by the
// proof harness). Proves: delete succeeds, the row is 'deleted', getLedger
// hides it, the OTHER ledger is untouched, and a 'deleted' audit row exists.
import { PostgresDatabase, LedgerEngine } from "../packages/core/dist/index.js";

const url = process.env.DATABASE_URL;
if (!url) { console.error("no DATABASE_URL"); process.exit(1); }

const db = new PostgresDatabase(url);
const engine = new LedgerEngine(db);

const ownerId = "00000000-0000-7000-8000-0000000000aa";
await db.run(
  "INSERT INTO users (id, email, name, auth_provider, auth_provider_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
  [ownerId, "owner033@test.com", "Owner", "test", "owner-033"],
);

const a = await engine.createLedger({ name: "Primary", currency: "USD", ownerId });
const b = await engine.createLedger({ name: "Secondary", currency: "USD", ownerId });
if (!a.ok || !b.ok) { console.error("createLedger failed", JSON.stringify({ a, b })); process.exit(1); }
const led = a.value.id;

const key = await engine.createApiKey({ ledgerId: led, userId: ownerId, name: "k1" });
if (!key.ok) { console.error("createApiKey failed"); process.exit(1); }

const res = await engine.softDeleteLedger(led, ownerId);
let ok = true;
const check = (label, cond) => { console.log((cond ? "  PASS " : "  FAIL ") + label); if (!cond) ok = false; };

check("softDeleteLedger returns ok + status 'deleted'", res.ok && res.value.status === "deleted");

const row = await db.get("SELECT status FROM ledgers WHERE id = ?", [led]);
check("underlying ledgers.status = 'deleted' (033 enum accepted it)", row?.status === "deleted");

const got = await engine.getLedger(led);
check("getLedger hides the deleted ledger (returns err)", !got.ok);

const list = await engine.findLedgersByOwner(ownerId);
check("owner list excludes the deleted ledger", list.ok && !list.value.find((l) => l.id === led));
check("owner list still includes the OTHER (Secondary) ledger", list.ok && !!list.value.find((l) => l.id === b.value.id));

const keys = await engine.listApiKeys(led);
check("the deleted ledger's key was revoked", keys.ok && keys.value.find((k) => k.id === key.value.apiKey.id)?.status === "revoked");

const audit = await db.all(
  "SELECT action FROM audit_entries WHERE ledger_id = ? AND entity_type = 'ledger' AND action = 'deleted'",
  [led],
);
check("a 'deleted' audit row was written (enum accepted it)", audit.length === 1);

await db.close();
if (!ok) process.exit(1);
console.log("D PASS (softDeleteLedger happy-path on real PG)");

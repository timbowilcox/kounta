import { Ledge } from "@ledge/sdk";

async function seed() {
  const baseUrl = process.env.LEDGE_BASE_URL ?? "http://localhost:3100";
  const adminSecret = process.env.LEDGE_ADMIN_SECRET ?? "dev-admin-secret";

  const admin = new Ledge({ apiKey: "admin-bootstrap", adminSecret, baseUrl });

  // 1. Create ledger
  const ledger = await admin.ledgers.create({
    name: "Freelance Consulting",
    currency: "USD",
    ownerId: "freelancer-demo",
    fiscalYearStart: 1,
    accountingBasis: "accrual",
  });
  console.log("Ledger:", ledger.id);

  // 2. Apply consulting template
  const tpl = await admin.templates.apply(ledger.id, "consulting");
  console.log("Template applied:", tpl.count, "accounts");

  // 3. Create API key
  const key = await admin.apiKeys.create({
    userId: "freelancer-demo",
    ledgerId: ledger.id,
    name: "invoice-manager-dev",
  });
  console.log("API Key:", key.rawKey);

  // 4. Post sample transactions
  const sdk = new Ledge({ baseUrl, apiKey: key.rawKey });

  // Invoice #1 — Website redesign
  await sdk.transactions.post(ledger.id, {
    date: "2026-02-01",
    memo: "Invoice #1001 — Website Redesign for Acme Corp",
    lines: [
      { accountCode: "1100", amount: 500000, direction: "debit" },
      { accountCode: "4000", amount: 500000, direction: "credit" },
    ],
  });

  // Invoice #2 — Strategy workshop
  await sdk.transactions.post(ledger.id, {
    date: "2026-02-05",
    memo: "Invoice #1002 — Strategy Workshop for Beta Inc",
    lines: [
      { accountCode: "1100", amount: 250000, direction: "debit" },
      { accountCode: "4200", amount: 250000, direction: "credit" },
    ],
  });

  // Payment received for Invoice #1
  await sdk.transactions.post(ledger.id, {
    date: "2026-02-15",
    memo: "Payment received — Invoice #1001 (Acme Corp)",
    lines: [
      { accountCode: "1000", amount: 500000, direction: "debit" },
      { accountCode: "1100", amount: 500000, direction: "credit" },
    ],
  });

  // Invoice #3 — Advisory retainer
  await sdk.transactions.post(ledger.id, {
    date: "2026-02-18",
    memo: "Invoice #1003 — Monthly Advisory Retainer for Gamma LLC",
    lines: [
      { accountCode: "1100", amount: 350000, direction: "debit" },
      { accountCode: "4100", amount: 350000, direction: "credit" },
    ],
  });

  // Expense — Subcontractor
  await sdk.transactions.post(ledger.id, {
    date: "2026-02-10",
    memo: "Subcontractor — UI design work (Jane Doe)",
    lines: [
      { accountCode: "5000", amount: 120000, direction: "debit" },
      { accountCode: "1000", amount: 120000, direction: "credit" },
    ],
  });

  // Expense — Travel
  await sdk.transactions.post(ledger.id, {
    date: "2026-02-12",
    memo: "Flight to NYC for client meeting",
    lines: [
      { accountCode: "6100", amount: 45000, direction: "debit" },
      { accountCode: "1000", amount: 45000, direction: "credit" },
    ],
  });

  // Expense — Software subscription
  await sdk.transactions.post(ledger.id, {
    date: "2026-02-20",
    memo: "Figma annual subscription",
    lines: [
      { accountCode: "6400", amount: 14400, direction: "debit" },
      { accountCode: "1000", amount: 14400, direction: "credit" },
    ],
  });

  // Expense — Professional development
  await sdk.transactions.post(ledger.id, {
    date: "2026-02-25",
    memo: "Online course — Advanced TypeScript",
    lines: [
      { accountCode: "6200", amount: 19900, direction: "debit" },
      { accountCode: "1000", amount: 19900, direction: "credit" },
    ],
  });

  console.log("\nSample transactions posted!");
  console.log("\nAdd these to your .env:");
  console.log("LEDGE_LEDGER_ID=" + ledger.id);
  console.log("LEDGE_API_KEY=" + key.rawKey);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

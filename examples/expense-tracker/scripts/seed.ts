import { Kounta } from "@kounta/sdk";

async function seed() {
  const baseUrl = process.env.KOUNTA_BASE_URL ?? "http://localhost:3100";
  const adminSecret = process.env.KOUNTA_ADMIN_SECRET ?? "dev-admin-secret";

  const admin = new Kounta({ apiKey: "admin-bootstrap", adminSecret, baseUrl });

  // 1. Create ledger
  const ledger = await admin.ledgers.create({
    name: "Expense Tracker",
    currency: "USD",
    ownerId: "expense-demo",
    fiscalYearStart: 1,
    accountingBasis: "accrual",
  });
  console.log("Ledger:", ledger.id);

  // 2. Apply ecommerce template (has Cash + good expense categories)
  const tpl = await admin.templates.apply(ledger.id, "ecommerce");
  console.log("Template applied:", tpl.count, "accounts");

  // 3. Create API key
  const key = await admin.apiKeys.create({
    userId: "expense-demo",
    ledgerId: ledger.id,
    name: "expense-tracker-dev",
  });
  console.log("API Key:", key.rawKey);

  // 4. Post sample expenses (these will be matched against the sample CSV)
  const sdk = new Kounta({ baseUrl, apiKey: key.rawKey });

  // These expenses intentionally overlap with sample-bank-statement.csv rows
  await sdk.transactions.post(ledger.id, {
    date: "2026-02-03",
    memo: "AWS hosting — February",
    lines: [
      { accountCode: "6300", amount: 18500, direction: "debit" },
      { accountCode: "1000", amount: 18500, direction: "credit" },
    ],
  });

  await sdk.transactions.post(ledger.id, {
    date: "2026-02-05",
    memo: "Google Ads campaign",
    lines: [
      { accountCode: "6100", amount: 45000, direction: "debit" },
      { accountCode: "1000", amount: 45000, direction: "credit" },
    ],
  });

  await sdk.transactions.post(ledger.id, {
    date: "2026-02-07",
    memo: "Office supplies — Staples",
    lines: [
      { accountCode: "6300", amount: 8750, direction: "debit" },
      { accountCode: "1000", amount: 8750, direction: "credit" },
    ],
  });

  await sdk.transactions.post(ledger.id, {
    date: "2026-02-10",
    memo: "Shopify monthly subscription",
    lines: [
      { accountCode: "6200", amount: 7900, direction: "debit" },
      { accountCode: "1000", amount: 7900, direction: "credit" },
    ],
  });

  await sdk.transactions.post(ledger.id, {
    date: "2026-02-12",
    memo: "Team lunch — client meeting",
    lines: [
      { accountCode: "6300", amount: 12400, direction: "debit" },
      { accountCode: "1000", amount: 12400, direction: "credit" },
    ],
  });

  await sdk.transactions.post(ledger.id, {
    date: "2026-02-15",
    memo: "Facebook Ads — retargeting",
    lines: [
      { accountCode: "6100", amount: 25000, direction: "debit" },
      { accountCode: "1000", amount: 25000, direction: "credit" },
    ],
  });

  await sdk.transactions.post(ledger.id, {
    date: "2026-02-18",
    memo: "Shipping supplies",
    lines: [
      { accountCode: "5200", amount: 3200, direction: "debit" },
      { accountCode: "1000", amount: 3200, direction: "credit" },
    ],
  });

  await sdk.transactions.post(ledger.id, {
    date: "2026-02-20",
    memo: "Zoom annual subscription",
    lines: [
      { accountCode: "6300", amount: 14990, direction: "debit" },
      { accountCode: "1000", amount: 14990, direction: "credit" },
    ],
  });

  // Also post a revenue entry so P&L is interesting
  await sdk.transactions.post(ledger.id, {
    date: "2026-02-01",
    memo: "Product sales — January batch payout",
    lines: [
      { accountCode: "1000", amount: 850000, direction: "debit" },
      { accountCode: "4000", amount: 850000, direction: "credit" },
    ],
  });

  await sdk.transactions.post(ledger.id, {
    date: "2026-02-14",
    memo: "Product sales — early February batch",
    lines: [
      { accountCode: "1000", amount: 420000, direction: "debit" },
      { accountCode: "4000", amount: 420000, direction: "credit" },
    ],
  });

  console.log("\nSample transactions posted!");
  console.log("\nAdd these to your .env:");
  console.log("KOUNTA_LEDGER_ID=" + ledger.id);
  console.log("KOUNTA_API_KEY=" + key.rawKey);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

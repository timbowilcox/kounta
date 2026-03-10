// ---------------------------------------------------------------------------
// Seed script — bootstraps a Ledge instance with the SaaS template and
// sample transactions so the dashboard has data to display.
//
// Usage: pnpm seed   (requires LEDGE_ADMIN_SECRET and LEDGE_BASE_URL)
// ---------------------------------------------------------------------------

import { Ledge } from "@ledge/sdk";

const adminSecret = process.env.LEDGE_ADMIN_SECRET;
const baseUrl = process.env.LEDGE_BASE_URL ?? "http://localhost:3001";

if (!adminSecret) {
  console.error("LEDGE_ADMIN_SECRET is required. Set it in .env.local");
  process.exit(1);
}

const admin = new Ledge({
  apiKey: "placeholder",
  adminSecret,
  baseUrl,
});

async function seed() {
  console.log("Creating ledger...");
  const ledger = await admin.ledgers.create({
    name: "Acme SaaS",
    currency: "USD",
    ownerId: "seed-user",
    fiscalYearStart: 1,
    accountingBasis: "accrual",
  });
  console.log(`  Ledger: ${ledger.id}`);

  console.log("Applying SaaS template...");
  const { count } = await admin.templates.apply(ledger.id, "saas");
  console.log(`  Created ${count} accounts`);

  console.log("Creating API key...");
  const key = await admin.apiKeys.create({
    userId: "seed-user",
    ledgerId: ledger.id,
    name: "saas-tracker",
  });
  console.log(`  API key: ${key.rawKey}`);

  const client = new Ledge({ apiKey: key.rawKey, baseUrl });

  console.log("Posting sample transactions...");

  const today = new Date();
  const sampleTransactions = [
    {
      daysAgo: 30,
      memo: "Stripe payout — January subscriptions",
      lines: [
        { accountCode: "1000", amount: 4200000, direction: "debit" as const },
        { accountCode: "4000", amount: 4200000, direction: "credit" as const },
      ],
    },
    {
      daysAgo: 28,
      memo: "AWS hosting — January",
      lines: [
        { accountCode: "5000", amount: 320000, direction: "debit" as const },
        { accountCode: "1000", amount: 320000, direction: "credit" as const },
      ],
    },
    {
      daysAgo: 25,
      memo: "Payroll — January second half",
      lines: [
        { accountCode: "6000", amount: 2400000, direction: "debit" as const },
        { accountCode: "1000", amount: 2400000, direction: "credit" as const },
      ],
    },
    {
      daysAgo: 20,
      memo: "Annual customer prepayment — Enterprise plan",
      lines: [
        { accountCode: "1000", amount: 1200000, direction: "debit" as const },
        { accountCode: "2100", amount: 1200000, direction: "credit" as const },
      ],
    },
    {
      daysAgo: 15,
      memo: "Stripe payout — February subscriptions",
      lines: [
        { accountCode: "1000", amount: 4800000, direction: "debit" as const },
        { accountCode: "4000", amount: 4800000, direction: "credit" as const },
      ],
    },
    {
      daysAgo: 12,
      memo: "Google Ads — February campaign",
      lines: [
        { accountCode: "6100", amount: 180000, direction: "debit" as const },
        { accountCode: "1000", amount: 180000, direction: "credit" as const },
      ],
    },
    {
      daysAgo: 10,
      memo: "AWS hosting — February",
      lines: [
        { accountCode: "5000", amount: 350000, direction: "debit" as const },
        { accountCode: "1000", amount: 350000, direction: "credit" as const },
      ],
    },
    {
      daysAgo: 7,
      memo: "Consulting engagement — Globex onboarding",
      lines: [
        { accountCode: "1100", amount: 750000, direction: "debit" as const },
        { accountCode: "4100", amount: 750000, direction: "credit" as const },
      ],
    },
    {
      daysAgo: 5,
      memo: "Payroll — February second half",
      lines: [
        { accountCode: "6000", amount: 2400000, direction: "debit" as const },
        { accountCode: "1000", amount: 2400000, direction: "credit" as const },
      ],
    },
    {
      daysAgo: 3,
      memo: "Stripe payout — March subscriptions (partial)",
      lines: [
        { accountCode: "1000", amount: 5200000, direction: "debit" as const },
        { accountCode: "4000", amount: 5200000, direction: "credit" as const },
      ],
    },
    {
      daysAgo: 2,
      memo: "Third-party API costs — Twilio, SendGrid",
      lines: [
        { accountCode: "5100", amount: 85000, direction: "debit" as const },
        { accountCode: "1000", amount: 85000, direction: "credit" as const },
      ],
    },
    {
      daysAgo: 1,
      memo: "Usage-based billing — February overages",
      lines: [
        { accountCode: "1100", amount: 185000, direction: "debit" as const },
        { accountCode: "4200", amount: 185000, direction: "credit" as const },
      ],
    },
  ];

  for (const tx of sampleTransactions) {
    const date = new Date(today);
    date.setDate(date.getDate() - tx.daysAgo);

    await client.transactions.post(ledger.id, {
      date: date.toISOString(),
      memo: tx.memo,
      lines: tx.lines,
    });
    console.log(`  Posted: ${tx.memo}`);
  }

  console.log("\n--- Setup Complete ---");
  console.log("Add the following to your .env.local:\n");
  console.log(`LEDGE_BASE_URL=${baseUrl}`);
  console.log(`LEDGE_ADMIN_SECRET=${adminSecret}`);
  console.log(`LEDGE_API_KEY=${key.rawKey}`);
  console.log(`LEDGE_LEDGER_ID=${ledger.id}`);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

// Seed sample transactions on the live Railway API
const LEDGER_ID = "019cdb37-32cf-7c7f-8391-3ca9c0172e2d";
const API_KEY = "ledge_live_ac30de8e5f170a7e87b508bb6e54df6278b62997e539694a";
const BASE_URL = "https://ledge-production-ed8a.up.railway.app";

async function main() {
  const transactions = [
    {
      memo: "Monthly SaaS subscription revenue - March",
      date: "2026-03-01",
      idempotencyKey: "seed-tx-001",
      lines: [
        { accountCode: "1000", amount: 1500000, direction: "debit" },
        { accountCode: "4000", amount: 1500000, direction: "credit" },
      ],
    },
    {
      memo: "AWS hosting costs - March",
      date: "2026-03-02",
      idempotencyKey: "seed-tx-002",
      lines: [
        { accountCode: "5000", amount: 320000, direction: "debit" },
        { accountCode: "1000", amount: 320000, direction: "credit" },
      ],
    },
    {
      memo: "Professional services engagement - Acme Corp",
      date: "2026-03-03",
      idempotencyKey: "seed-tx-003",
      lines: [
        { accountCode: "1100", amount: 750000, direction: "debit" },
        { accountCode: "4100", amount: 750000, direction: "credit" },
      ],
    },
    {
      memo: "Marketing campaign - Google Ads",
      date: "2026-03-04",
      idempotencyKey: "seed-tx-004",
      lines: [
        { accountCode: "6100", amount: 250000, direction: "debit" },
        { accountCode: "1000", amount: 250000, direction: "credit" },
      ],
    },
    {
      memo: "Staff salaries - March payroll",
      date: "2026-03-05",
      idempotencyKey: "seed-tx-005",
      lines: [
        { accountCode: "6000", amount: 2400000, direction: "debit" },
        { accountCode: "1000", amount: 2400000, direction: "credit" },
      ],
    },
    {
      memo: "Usage-based revenue - API calls billing",
      date: "2026-03-06",
      idempotencyKey: "seed-tx-006",
      lines: [
        { accountCode: "1100", amount: 425000, direction: "debit" },
        { accountCode: "4200", amount: 425000, direction: "credit" },
      ],
    },
    {
      memo: "Client payment received - Invoice #1042",
      date: "2026-03-07",
      idempotencyKey: "seed-tx-007",
      lines: [
        { accountCode: "1000", amount: 750000, direction: "debit" },
        { accountCode: "1100", amount: 750000, direction: "credit" },
      ],
    },
    {
      memo: "Office supplies and software subscriptions",
      date: "2026-03-08",
      idempotencyKey: "seed-tx-008",
      lines: [
        { accountCode: "6300", amount: 85000, direction: "debit" },
        { accountCode: "1000", amount: 85000, direction: "credit" },
      ],
    },
    {
      memo: "Deferred revenue recognition - February",
      date: "2026-03-10",
      idempotencyKey: "seed-tx-009",
      lines: [
        { accountCode: "2100", amount: 500000, direction: "debit" },
        { accountCode: "4000", amount: 500000, direction: "credit" },
      ],
    },
    {
      memo: "Third-party API costs - Stripe + Twilio",
      date: "2026-03-10",
      idempotencyKey: "seed-tx-010",
      lines: [
        { accountCode: "5100", amount: 180000, direction: "debit" },
        { accountCode: "1000", amount: 180000, direction: "credit" },
      ],
    },
  ];

  for (const tx of transactions) {
    const res = await fetch(`${BASE_URL}/v1/ledgers/${LEDGER_ID}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(tx),
    });
    const result = await res.json();
    if (result.data) {
      console.log(`+ ${tx.memo}`);
    } else {
      console.log(`x ${tx.memo}: ${result.error?.message || JSON.stringify(result)}`);
    }
  }

  console.log("\nDone!");
}

main().catch(console.error);

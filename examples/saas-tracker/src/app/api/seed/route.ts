// ---------------------------------------------------------------------------
// POST /api/seed — Convenience endpoint to simulate a Stripe payment
// without needing a real Stripe account. Posts a debit Cash / credit
// Subscription Revenue entry directly to Kounta.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { kounta, LEDGER_ID } from "@/lib/kounta";

export async function POST(req: NextRequest) {
  if (!LEDGER_ID) {
    return NextResponse.json(
      { error: "KOUNTA_LEDGER_ID not configured" },
      { status: 500 },
    );
  }

  const body = (await req.json()) as {
    amount?: number;
    customer?: string;
    plan?: string;
  };

  const amount = body.amount ?? 9900; // default $99.00
  const customer = body.customer ?? "demo@example.com";
  const plan = body.plan ?? "Pro Monthly";

  const txn = await kounta.transactions.post(LEDGER_ID, {
    date: new Date().toISOString(),
    memo: `${plan} subscription — ${customer}`,
    sourceType: "api",
    metadata: { customer, plan },
    lines: [
      { accountCode: "1000", amount, direction: "debit" },
      { accountCode: "4000", amount, direction: "credit" },
    ],
  });

  return NextResponse.json({ transactionId: txn.id, amount });
}

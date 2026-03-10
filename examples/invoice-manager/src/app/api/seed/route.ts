// POST /api/seed — Convenience endpoint to create a sample invoice entry
import { NextRequest, NextResponse } from "next/server";
import { ledge, ledgerId } from "@/lib/ledge";

export async function POST(req: NextRequest) {
  if (!ledgerId) {
    return NextResponse.json(
      { error: "LEDGE_LEDGER_ID not configured" },
      { status: 500 },
    );
  }

  const body = (await req.json()) as {
    amount?: number;
    client?: string;
    description?: string;
  };

  const amount = body.amount ?? 250000; // default $2,500.00
  const client = body.client ?? "Acme Corp";
  const description = body.description ?? "Consulting services";

  try {
    const txn = await ledge.transactions.post(ledgerId, {
      date: new Date().toISOString().slice(0, 10),
      memo: `Invoice — ${description} (${client})`,
      sourceType: "api",
      lines: [
        { accountCode: "1100", amount, direction: "debit" },
        { accountCode: "4000", amount, direction: "credit" },
      ],
    });

    return NextResponse.json({ transactionId: txn.id, amount });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to post transaction";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

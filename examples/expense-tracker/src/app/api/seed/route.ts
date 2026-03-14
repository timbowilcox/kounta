// POST /api/seed — Convenience endpoint to create a sample expense entry
import { NextRequest, NextResponse } from "next/server";
import { kounta, ledgerId } from "@/lib/kounta";

export async function POST(req: NextRequest) {
  if (!ledgerId) {
    return NextResponse.json(
      { error: "KOUNTA_LEDGER_ID not configured" },
      { status: 500 },
    );
  }

  const body = (await req.json()) as {
    amount?: number;
    category?: string;
    memo?: string;
  };

  const amount = body.amount ?? 5000; // default $50.00
  const category = body.category ?? "6300"; // General & Admin
  const memo = body.memo ?? "Sample expense";

  try {
    const txn = await kounta.transactions.post(ledgerId, {
      date: new Date().toISOString().slice(0, 10),
      memo,
      sourceType: "api",
      lines: [
        { accountCode: category, amount, direction: "debit" },
        { accountCode: "1000", amount, direction: "credit" },
      ],
    });

    return NextResponse.json({ transactionId: txn.id, amount });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to post transaction";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { kounta, ledgerId } from "@/lib/kounta";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { client, amount } = await req.json();

    if (!client || !amount) {
      return NextResponse.json(
        { error: "client and amount are required" },
        { status: 400 },
      );
    }

    const txn = await kounta.transactions.post(ledgerId, {
      date: new Date().toISOString().slice(0, 10),
      memo: `Payment received — ${client}`,
      lines: [
        { accountCode: "1000", amount, direction: "debit" },
        { accountCode: "1100", amount, direction: "credit" },
      ],
    });

    return NextResponse.json(txn);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

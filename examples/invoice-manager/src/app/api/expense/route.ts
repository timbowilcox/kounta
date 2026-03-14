import { kounta, ledgerId } from "@/lib/kounta";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { accountCode, description, amount } = await req.json();

    if (!accountCode || !description || !amount) {
      return NextResponse.json(
        { error: "accountCode, description, and amount are required" },
        { status: 400 },
      );
    }

    const txn = await kounta.transactions.post(ledgerId, {
      date: new Date().toISOString().slice(0, 10),
      memo: description,
      lines: [
        { accountCode, amount, direction: "debit" },
        { accountCode: "1000", amount, direction: "credit" },
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

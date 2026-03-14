import { kounta } from "@/lib/kounta";
import { NextResponse } from "next/server";
import type { ConfirmAction } from "@kounta/sdk";

export async function POST(req: Request) {
  try {
    const { batchId, actions } = (await req.json()) as {
      batchId: string;
      actions: ConfirmAction[];
    };

    if (!batchId || !actions?.length) {
      return NextResponse.json(
        { error: "batchId and actions are required" },
        { status: 400 },
      );
    }

    const result = await kounta.imports.confirmMatches(batchId, actions);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

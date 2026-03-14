import { kounta, ledgerId } from "@/lib/kounta";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { fileContent } = await req.json();

    if (!fileContent) {
      return NextResponse.json(
        { error: "fileContent is required" },
        { status: 400 },
      );
    }

    const result = await kounta.imports.upload(ledgerId, {
      fileContent,
      fileType: "csv",
      filename: "bank-statement.csv",
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

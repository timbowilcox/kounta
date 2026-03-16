import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const KOUNTA_API_URL = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.apiKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const res = await fetch(`${KOUNTA_API_URL}/v1/invoices/${id}/pdf`, {
    headers: { Authorization: `Bearer ${session.apiKey}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "PDF generation failed");
    return NextResponse.json(
      { error: text },
      { status: res.status },
    );
  }

  const pdfBuffer = await res.arrayBuffer();

  const disposition = res.headers.get("Content-Disposition")
    ?? `inline; filename="invoice-${id}.pdf"`;

  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": disposition,
    },
  });
}

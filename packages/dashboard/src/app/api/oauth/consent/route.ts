// ---------------------------------------------------------------------------
// POST /api/oauth/consent — proxies consent approval to the Kounta API.
//
// The consent page calls this after the user clicks Allow/Deny.
// We forward the request to the API's POST /oauth/consent endpoint
// with the admin secret and the user's session info.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json(
      { error: { message: "Not authenticated" } },
      { status: 401 }
    );
  }

  const body = await request.json();
  const apiUrl = process.env.KOUNTA_API_URL;
  const adminSecret = process.env.KOUNTA_ADMIN_SECRET;

  if (!apiUrl || !adminSecret) {
    return NextResponse.json(
      { error: { message: "Server configuration error" } },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(`${apiUrl}/oauth/consent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSecret}`,
      },
      body: JSON.stringify({
        ...body,
        user_id: (session as unknown as { userId: string }).userId,
        ledger_id: (session as unknown as { ledgerId: string }).ledgerId,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: { message: "Failed to communicate with API" } },
      { status: 502 }
    );
  }
}

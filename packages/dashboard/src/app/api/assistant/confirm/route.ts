// ---------------------------------------------------------------------------
// POST /api/assistant/confirm — Execute a confirmed write operation.
//
// Called when the user confirms a write tool call (post_transaction,
// reverse_transaction) from the chat panel.
// ---------------------------------------------------------------------------

import { auth } from "@/lib/auth";
import { getSessionClient } from "@/lib/kounta";
import { executeConfirmedWrite } from "@/lib/assistant";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.apiKey || !session.ledgerId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json() as {
    toolName: string;
    input: Record<string, unknown>;
    confirmed: boolean;
  };

  if (!body.confirmed) {
    return new Response(
      JSON.stringify({ data: { cancelled: true } }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const { client, ledgerId } = await getSessionClient();
    const result = await executeConfirmedWrite(body.toolName, body.input, client, ledgerId);

    return new Response(
      JSON.stringify({ data: result }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Write operation failed";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

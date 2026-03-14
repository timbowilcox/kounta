// ---------------------------------------------------------------------------
// POST /api/assistant/chat — AI Financial Assistant SSE endpoint.
//
// Accepts conversation messages, streams response via Server-Sent Events.
// Creates/updates conversations automatically.
// ---------------------------------------------------------------------------

import { auth } from "@/lib/auth";
import { getSessionClient } from "@/lib/kounta";
import { chatWithAssistant, isAssistantAvailable, type SSEEvent } from "@/lib/assistant";
import { fetchBillingStatus } from "@/lib/actions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // Auth check
  const session = await auth();
  if (!session?.apiKey || !session.ledgerId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check if assistant is configured
  if (!isAssistantAvailable()) {
    return new Response(
      JSON.stringify({ error: "AI assistant is not configured. Set ANTHROPIC_API_KEY." }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  const body = await request.json() as {
    messages: Array<{ role: "user" | "assistant"; content: string; timestamp?: string }>;
    conversationId?: string;
  };

  if (!body.messages || !Array.isArray(body.messages)) {
    return new Response(
      JSON.stringify({ error: "'messages' array is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Get the user's plan for model selection
  const billing = await fetchBillingStatus();

  // Get SDK client + ledgerId
  const { client, ledgerId } = await getSessionClient();

  // Create or use existing conversation
  let conversationId = body.conversationId;
  if (!conversationId) {
    // Auto-generate a conversation ID from the first user message
    const firstMsg = body.messages.find((m) => m.role === "user");
    const title = firstMsg
      ? firstMsg.content.slice(0, 60) + (firstMsg.content.length > 60 ? "..." : "")
      : "New conversation";

    try {
      const conv = await client.conversations.create(ledgerId, title);
      conversationId = conv.id;
    } catch {
      // If conversation creation fails (e.g., migration not applied), use a temp ID
      conversationId = `temp-${Date.now()}`;
    }
  }

  // Normalize messages to include timestamps
  const normalizedMessages = body.messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
    timestamp: m.timestamp ?? new Date().toISOString(),
  }));

  // Create SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: SSEEvent) => {
        const data = JSON.stringify(event);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      try {
        const updatedMessages = await chatWithAssistant({
          messages: normalizedMessages,
          apiKey: session.apiKey,
          ledgerId,
          conversationId: conversationId!,
          plan: billing.plan,
          onEvent: sendEvent,
        });

        // Save conversation messages
        try {
          await client.conversations.update(ledgerId, conversationId!, updatedMessages);
        } catch {
          // Non-critical — conversation persistence is best-effort
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Assistant error";
        sendEvent({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

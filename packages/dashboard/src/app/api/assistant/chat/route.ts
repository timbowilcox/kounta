// ---------------------------------------------------------------------------
// POST /api/assistant/chat — AI Financial Assistant SSE endpoint.
//
// Accepts conversation messages, streams response via Server-Sent Events.
// Creates/updates conversations automatically.
// ---------------------------------------------------------------------------

import { auth } from "@/lib/auth";
import { getSessionClient } from "@/lib/kounta";
import { chatWithAssistant, isAssistantAvailable, type SSEEvent, type JurisdictionContext } from "@/lib/assistant";
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
        // Fetch ledger info for system prompt context
        let ledgerContext: { currency?: string; name?: string; jurisdiction?: JurisdictionContext } | undefined;
        let fyStartMonth = 1;
        try {
          const ledger = await client.ledgers.get(ledgerId);
          ledgerContext = { currency: ledger.currency, name: ledger.name };
          fyStartMonth = (ledger as unknown as Record<string, unknown>).fiscalYearStart as number ?? 1;
        } catch {
          // Non-critical — assistant works without ledger context
        }

        // Fetch jurisdiction context (non-critical)
        try {
          const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";
          const [jSettingsRes, jListRes] = await Promise.all([
            fetch(`${apiUrl}/v1/ledgers/${ledgerId}/jurisdiction`, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${session.apiKey}`,
              },
            }),
            fetch(`${apiUrl}/v1/jurisdictions`, { cache: "no-store" }),
          ]);

          if (jSettingsRes.ok && jListRes.ok) {
            const settings = (await jSettingsRes.json()).data as { jurisdiction: string; taxId: string | null; taxBasis: string };
            const allJurisdictions = (await jListRes.json()).data as Array<{
              code: string; name: string; taxAuthority: string; vatName: string;
              vatRate: number; defaultDepreciationMethod: string; capitalisationThreshold: number;
            }>;
            const jConfig = allJurisdictions.find((j) => j.code === settings.jurisdiction);
            if (jConfig) {
              const now = new Date();
              const currentMonth = now.getMonth() + 1;
              const fyYear = currentMonth >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1;
              const fyLabel = fyStartMonth === 1
                ? `${fyYear}`
                : `${fyYear}/${fyYear + 1}`;

              if (!ledgerContext) ledgerContext = {};
              ledgerContext.jurisdiction = {
                code: jConfig.code,
                name: jConfig.name,
                taxAuthority: jConfig.taxAuthority,
                vatName: jConfig.vatName,
                vatRate: jConfig.vatRate,
                taxBasis: settings.taxBasis,
                financialYearLabel: fyLabel,
                defaultDepreciationMethod: jConfig.defaultDepreciationMethod,
                capitalisationThreshold: jConfig.capitalisationThreshold,
              };
            }
          }
        } catch {
          // Non-critical — assistant works without jurisdiction context
        }

        const updatedMessages = await chatWithAssistant({
          messages: normalizedMessages,
          apiKey: session.apiKey,
          ledgerId,
          conversationId: conversationId!,
          plan: billing.plan,
          ledgerContext,
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

"use client";

import { useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// SSE event types (mirrors server-side assistant.ts)
// ---------------------------------------------------------------------------

interface SSETextEvent { type: "text"; text: string }
interface SSEToolCallEvent { type: "tool_call"; toolName: string; input: unknown }
interface SSEToolResultEvent { type: "tool_result"; toolName: string; output: unknown }
interface SSEConfirmationEvent { type: "confirmation_required"; toolName: string; input: unknown; confirmationId: string }
interface SSEDoneEvent { type: "done"; conversationId: string; messages: unknown[] }
interface SSEErrorEvent { type: "error"; message: string }
type SSEEvent = SSETextEvent | SSEToolCallEvent | SSEToolResultEvent | SSEConfirmationEvent | SSEDoneEvent | SSEErrorEvent;

// ---------------------------------------------------------------------------
// Chat message types (client-side)
// ---------------------------------------------------------------------------

export interface ToolCallDisplay {
  toolName: string;
  input: unknown;
  output?: unknown;
  status: "running" | "done" | "error";
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallDisplay[];
  timestamp: string;
}

export interface PendingConfirmation {
  toolName: string;
  input: unknown;
  confirmationId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SUGGESTED_PROMPTS = [
  "What's my cash position?",
  "Show me this month's P&L",
  "What were my biggest expenses?",
];

export const TOOL_LABELS: Record<string, string> = {
  get_account_balances: "Looking up account balances",
  get_income_statement: "Generating income statement",
  get_balance_sheet: "Generating balance sheet",
  get_cash_flow: "Generating cash flow statement",
  search_transactions: "Searching transactions",
  get_transaction: "Fetching transaction details",
  post_transaction: "Preparing transaction",
  reverse_transaction: "Preparing reversal",
  list_templates: "Listing templates",
  get_usage: "Checking usage",
};

// ---------------------------------------------------------------------------
// SSE stream parser — reads an SSE response body and calls handler per event
// ---------------------------------------------------------------------------

async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  handler: (event: SSEEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6);
      if (!jsonStr.trim()) continue;

      try {
        const event: SSEEvent = JSON.parse(jsonStr);
        handler(event);
      } catch {
        // Skip malformed events
      }
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    const remaining = buffer.split("\n");
    for (const line of remaining) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event: SSEEvent = JSON.parse(line.slice(6));
        handler(event);
      } catch {
        // Skip
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAssistantStream() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  // ---------------------------------------------------
  // SSE event handler
  // ---------------------------------------------------

  const handleSSEEvent = useCallback((event: SSEEvent) => {
    switch (event.type) {
      case "text":
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = { ...last, content: last.content + event.text };
          return updated;
        });
        break;

      case "tool_call":
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          const toolCalls = [...(last.toolCalls || []), {
            toolName: event.toolName,
            input: event.input,
            status: "running" as const,
          }];
          updated[updated.length - 1] = { ...last, toolCalls };
          return updated;
        });
        break;

      case "tool_result":
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          const toolCalls = (last.toolCalls || []).map((tc) =>
            tc.toolName === event.toolName && tc.status === "running"
              ? { ...tc, output: event.output, status: "done" as const }
              : tc
          );
          updated[updated.length - 1] = { ...last, toolCalls };
          return updated;
        });
        break;

      case "confirmation_required":
        setPendingConfirmation({
          toolName: event.toolName,
          input: event.input,
          confirmationId: event.confirmationId,
        });
        break;

      case "done":
        setConversationId(event.conversationId);
        break;

      case "error":
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...last,
            content: last.content || ("Error: " + event.message),
          };
          return updated;
        });
        break;
    }
  }, []);

  // ---------------------------------------------------
  // Send message via SSE
  // ---------------------------------------------------

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMsg: ChatMessage = {
      role: "user",
      content: text.trim(),
      timestamp: new Date().toISOString(),
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsStreaming(true);

    // Add empty assistant message that we'll stream into
    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: "",
      toolCalls: [],
      timestamp: new Date().toISOString(),
    };
    setMessages([...newMessages, assistantMsg]);

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
          })),
          conversationId,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: err.error || "Something went wrong. Please try again.",
          };
          return updated;
        });
        setIsStreaming(false);
        return;
      }

      const body = res.body;
      if (!body) {
        setIsStreaming(false);
        return;
      }

      await parseSSEStream(body, handleSSEEvent);
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: "Connection error. Please try again.",
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  }, [messages, conversationId, isStreaming, handleSSEEvent]);

  // ---------------------------------------------------
  // Confirm / cancel write operations
  // ---------------------------------------------------

  const handleConfirm = useCallback(async (confirmed: boolean) => {
    if (!pendingConfirmation) return;

    const { toolName, input: toolInput } = pendingConfirmation;
    setPendingConfirmation(null);

    if (!confirmed) {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        updated[updated.length - 1] = {
          ...last,
          content: last.content + "\n\n_Operation cancelled._",
        };
        return updated;
      });
      return;
    }

    setIsStreaming(true);
    try {
      const res = await fetch("/api/assistant/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolName, input: toolInput, confirmed: true }),
      });

      const result = await res.json();
      if (result.error) {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...last,
            content: last.content + "\n\nError: " + result.error,
          };
          return updated;
        });
      } else {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...last,
            content: last.content + "\n\nDone! The operation was completed successfully.",
          };
          return updated;
        });
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        updated[updated.length - 1] = {
          ...last,
          content: last.content + "\n\nFailed to execute operation.",
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  }, [pendingConfirmation]);

  // ---------------------------------------------------
  // Start new conversation
  // ---------------------------------------------------

  const startNewConversation = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setPendingConfirmation(null);
  }, []);

  // ---------------------------------------------------
  // Load existing conversation
  // ---------------------------------------------------

  const loadConversation = useCallback((id: string, msgs: ChatMessage[]) => {
    setConversationId(id);
    setMessages(msgs);
    setPendingConfirmation(null);
    setExpandedTools(new Set());
  }, []);

  // ---------------------------------------------------
  // Toggle tool call expansion
  // ---------------------------------------------------

  const toggleToolExpanded = useCallback((key: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return {
    messages,
    isStreaming,
    conversationId,
    pendingConfirmation,
    expandedTools,
    sendMessage,
    handleConfirm,
    startNewConversation,
    loadConversation,
    toggleToolExpanded,
  };
}

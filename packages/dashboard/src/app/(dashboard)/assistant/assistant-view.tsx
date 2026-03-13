"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  useAssistantStream,
  SUGGESTED_PROMPTS,
  TOOL_LABELS,
  type ChatMessage,
} from "@/hooks/use-assistant-stream";
import type { Conversation } from "@ledge/sdk";

// ---------------------------------------------------------------------------
// AssistantView
// ---------------------------------------------------------------------------

interface Props {
  initialConversations: Conversation[];
}

export function AssistantView({ initialConversations }: Props) {
  const searchParams = useSearchParams();
  const initialConvId = searchParams.get("c");

  const [conversations, setConversations] = useState(initialConversations);
  const [activeConvId, setActiveConvId] = useState<string | null>(initialConvId);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");

  const {
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
  } = useAssistantStream();

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    if (!isStreaming) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isStreaming, activeConvId]);

  // Sync conversationId from hook back to local state
  useEffect(() => {
    if (conversationId && conversationId !== activeConvId) {
      setActiveConvId(conversationId);
    }
  }, [conversationId, activeConvId]);

  // ---------------------------------------------------
  // Handlers
  // ---------------------------------------------------

  const handleSend = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    sendMessage(input);
    setInput("");
  }, [input, isStreaming, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleNewConversation = useCallback(() => {
    startNewConversation();
    setActiveConvId(null);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [startNewConversation]);

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      setActiveConvId(conv.id);
      const msgs: ChatMessage[] = conv.messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      }));
      loadConversation(conv.id, msgs);
    },
    [loadConversation],
  );

  // ---------------------------------------------------
  // Render
  // ---------------------------------------------------

  return (
    <div style={{ display: "flex", height: "calc(100vh - 80px)", margin: "-40px -48px", marginTop: -40 }}>
      {/* Left column — conversation list */}
      <div
        style={{
          width: 320,
          minWidth: 280,
          borderRight: "1px solid rgba(0,0,0,0.10)",
          backgroundColor: "#F7F7F6",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        {/* Header */}
        <div style={{ padding: "24px 20px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1
            className="font-bold"
            style={{ fontSize: 20, color: "#0A0A0A", fontFamily: "var(--font-family-display)" }}
          >
            Assistant
          </h1>
          <button onClick={handleNewConversation} className="btn-primary" style={{ padding: "6px 14px", fontSize: 13 }}>
            New
          </button>
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 12px" }}>
          {conversations.length === 0 && !activeConvId && (
            <div style={{ padding: "20px 8px", color: "rgba(0,0,0,0.36)", fontSize: 13, textAlign: "center" }}>
              No conversations yet
            </div>
          )}
          {conversations.map((conv) => {
            const isActive = conv.id === activeConvId;
            const lastMsg = conv.messages[conv.messages.length - 1];
            return (
              <button
                key={conv.id}
                onClick={() => handleSelectConversation(conv)}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "none",
                  backgroundColor: isActive ? "rgba(59,130,246,0.08)" : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  marginBottom: 2,
                  transition: "background-color 150ms",
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? "#3B82F6" : "#0A0A0A",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontFamily: "var(--font-family-body)",
                  }}
                >
                  {conv.title || "Untitled"}
                </div>
                {lastMsg && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "rgba(0,0,0,0.36)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      marginTop: 2,
                      fontFamily: "var(--font-family-body)",
                    }}
                  >
                    {lastMsg.content.slice(0, 80)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right column — active conversation */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#FFFFFF",
          minWidth: 0,
        }}
      >
        {/* Messages area */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* Empty state with suggestions */}
          {messages.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, paddingTop: 80 }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
              <p style={{ color: "#94A3B8", fontSize: 14, fontFamily: "var(--font-family-body)", textAlign: "center", maxWidth: 320 }}>
                Ask me about your accounts, transactions, or financial reports.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 340, marginTop: 8 }}>
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="chat-prompt-btn"
                    style={{
                      padding: "10px 14px",
                      backgroundColor: "#F7F7F6",
                      border: "1px solid rgba(0,0,0,0.06)",
                      borderRadius: 8,
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 13,
                      color: "#334155",
                      fontFamily: "var(--font-family-body)",
                      transition: "all 200ms cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {/* Tool call cards */}
              {msg.toolCalls && msg.toolCalls.length > 0 && msg.role === "assistant" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 }}>
                  {msg.toolCalls.map((tc, j) => {
                    const key = i + "-" + j;
                    const isExpanded = expandedTools.has(key);
                    return (
                      <div
                        key={key}
                        className={tc.status === "running" ? "chat-tool-shimmer" : ""}
                        style={{
                          backgroundColor: "#F7F7F6",
                          border: "1px solid rgba(0,0,0,0.06)",
                          borderRadius: 8,
                          overflow: "hidden",
                          maxWidth: 400,
                        }}
                      >
                        <button
                          onClick={() => toggleToolExpanded(key)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            width: "100%",
                            padding: "8px 12px",
                            backgroundColor: "transparent",
                            border: "none",
                            cursor: "pointer",
                            textAlign: "left",
                            fontSize: 12,
                            color: "#64748B",
                            fontFamily: "var(--font-family-body)",
                          }}
                        >
                          {tc.status === "running" ? (
                            <span className="chat-spinner" />
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                          <span>{TOOL_LABELS[tc.toolName] || tc.toolName}</span>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: "auto", transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 150ms" }}>
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                        {isExpanded && (
                          <div style={{ padding: "0 12px 10px", fontSize: 11, fontFamily: "var(--font-family-mono)", color: "#475569", overflowX: "auto" }}>
                            <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                              {JSON.stringify(tc.output ?? tc.input, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Message bubble */}
              {msg.content && (
                <div
                  style={{
                    alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "75%",
                    padding: "10px 16px",
                    borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                    backgroundColor: msg.role === "user" ? "#3B82F6" : "#F7F7F6",
                    color: msg.role === "user" ? "#FFFFFF" : "#0A0A0A",
                    fontSize: 14,
                    lineHeight: 1.6,
                    fontFamily: "var(--font-family-body)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {msg.content}
                </div>
              )}
            </div>
          ))}

          {/* Confirmation card */}
          {pendingConfirmation && (
            <div
              style={{
                backgroundColor: "#F7F7F6",
                border: "1px solid #D97706",
                borderRadius: 10,
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                maxWidth: 480,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#92400E" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                Confirm {pendingConfirmation.toolName === "post_transaction" ? "Transaction" : "Reversal"}
              </div>
              <pre style={{ margin: 0, fontSize: 11, fontFamily: "var(--font-family-mono)", color: "#475569", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {JSON.stringify(pendingConfirmation.input, null, 2)}
              </pre>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => handleConfirm(false)} className="btn-ghost" style={{ padding: "6px 14px", fontSize: 13 }}>
                  Cancel
                </button>
                <button onClick={() => handleConfirm(true)} className="btn-primary" style={{ padding: "6px 14px", fontSize: 13 }}>
                  Confirm
                </button>
              </div>
            </div>
          )}

          {/* Streaming indicator */}
          {isStreaming && messages.length > 0 && !messages[messages.length - 1]?.content && !(messages[messages.length - 1]?.toolCalls?.length) && (
            <div style={{ display: "flex", gap: 4, padding: "8px 0" }}>
              <span className="chat-dot chat-dot-1" />
              <span className="chat-dot chat-dot-2" />
              <span className="chat-dot chat-dot-3" />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div
          style={{
            padding: "12px 24px 16px",
            borderTop: "1px solid rgba(0,0,0,0.06)",
            backgroundColor: "#FFFFFF",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 8,
              backgroundColor: "#F7F7F6",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.10)",
              padding: "10px 14px",
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your finances..."
              disabled={isStreaming}
              rows={1}
              style={{
                flex: 1,
                border: "none",
                backgroundColor: "transparent",
                resize: "none",
                outline: "none",
                fontSize: 14,
                lineHeight: 1.5,
                color: "#0A0A0A",
                fontFamily: "var(--font-family-body)",
                maxHeight: 120,
                overflowY: "auto",
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 120) + "px";
              }}
            />
            <button
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                backgroundColor: input.trim() && !isStreaming ? "#3B82F6" : "#E2E8F0",
                border: "none",
                cursor: input.trim() && !isStreaming ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "background-color 200ms",
              }}
              aria-label="Send message"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={input.trim() && !isStreaming ? "#FFFFFF" : "#94A3B8"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <div style={{ textAlign: "center", marginTop: 6 }}>
            <span style={{ fontSize: 10, color: "rgba(0,0,0,0.24)", fontFamily: "var(--font-family-body)" }}>
              Powered by Claude
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

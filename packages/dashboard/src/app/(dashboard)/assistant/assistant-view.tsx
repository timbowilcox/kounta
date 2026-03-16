"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  useAssistantStream,
  SUGGESTED_PROMPTS,
  TOOL_LABELS,
  type ChatMessage,
} from "@/hooks/use-assistant-stream";
import type { Conversation } from "@kounta/sdk";

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isStreaming) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isStreaming, activeConvId]);

  useEffect(() => {
    if (conversationId && conversationId !== activeConvId) {
      setActiveConvId(conversationId);
    }
  }, [conversationId, activeConvId]);

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

  return (
    <div style={{ display: "flex", height: "calc(100vh - 64px)", margin: "-32px -32px", marginTop: -32 }}>
      {/* Left column — conversation list */}
      <div
        style={{
          width: 280,
          minWidth: 280,
          borderRight: "1px solid var(--border)",
          backgroundColor: "var(--surface-1)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        <div style={{ padding: "20px 16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>
            Assistant
          </h1>
          <button onClick={handleNewConversation} className="btn-secondary" style={{ height: 28, padding: "0 12px", fontSize: 12 }}>
            New
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
          {conversations.length === 0 && !activeConvId && (
            <div style={{ padding: "20px 8px", color: "var(--text-tertiary)", fontSize: 13, textAlign: "center" }}>
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
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "none",
                  backgroundColor: isActive ? "var(--surface-2)" : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  marginBottom: 2,
                  transition: "background-color 150ms ease",
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {conv.title || "Untitled"}
                </div>
                {lastMsg && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-tertiary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      marginTop: 2,
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
          backgroundColor: "var(--background)",
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
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
              <p style={{ color: "var(--text-tertiary)", fontSize: 13, textAlign: "center", maxWidth: 320 }}>
                Ask me about your accounts, transactions, or financial reports.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 340, marginTop: 8 }}>
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="chat-prompt-btn"
                    style={{
                      padding: "8px 12px",
                      backgroundColor: "var(--surface-1)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 13,
                      color: "var(--text-secondary)",
                      transition: "all 150ms ease",
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
                          backgroundColor: "var(--surface-1)",
                          border: "1px solid var(--border)",
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
                            color: "var(--text-secondary)",
                          }}
                        >
                          {tc.status === "running" ? (
                            <span className="chat-spinner" />
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--positive)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                          <span>{TOOL_LABELS[tc.toolName] || tc.toolName}</span>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: "auto", transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 150ms ease" }}>
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                        {isExpanded && (
                          <div style={{ padding: "0 12px 10px", fontSize: 11, color: "var(--text-secondary)", overflowX: "auto" }}>
                            <pre className="font-mono" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
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
                    maxWidth: "70%",
                    padding: "10px 16px",
                    borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                    backgroundColor: msg.role === "user" ? "var(--surface-2)" : "transparent",
                    color: "var(--text-primary)",
                    border: msg.role === "user" ? "1px solid var(--border)" : "none",
                    fontSize: 13,
                    lineHeight: 1.6,
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
                backgroundColor: "var(--surface-1)",
                border: "1px solid #D97706",
                borderRadius: 8,
                padding: "12px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                maxWidth: 480,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#D97706" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                Confirm {pendingConfirmation.toolName === "post_transaction" ? "Transaction" : pendingConfirmation.toolName === "reverse_transaction" ? "Reversal" : pendingConfirmation.toolName === "run_depreciation" ? "Depreciation" : "Action"}
              </div>
              <pre className="font-mono" style={{ margin: 0, fontSize: 11, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {JSON.stringify(pendingConfirmation.input, null, 2)}
              </pre>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => handleConfirm(false)} className="btn-ghost" style={{ fontSize: 12 }}>
                  Cancel
                </button>
                <button onClick={() => handleConfirm(true)} className="btn-primary" style={{ fontSize: 12 }}>
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
            borderTop: "1px solid var(--border)",
            backgroundColor: "var(--surface-1)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 8,
              backgroundColor: "var(--background)",
              borderRadius: 8,
              border: "1px solid var(--border)",
              padding: "8px 12px",
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
                fontSize: 13,
                lineHeight: 1.5,
                color: "var(--text-primary)",
                height: 40,
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
                width: 32,
                height: 32,
                borderRadius: 6,
                backgroundColor: input.trim() && !isStreaming ? "var(--text-primary)" : "var(--surface-2)",
                border: "none",
                cursor: input.trim() && !isStreaming ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "background-color 150ms ease",
              }}
              aria-label="Send message"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={input.trim() && !isStreaming ? "var(--background)" : "var(--text-tertiary)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <div style={{ textAlign: "center", marginTop: 4 }}>
            <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
              Powered by Claude
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

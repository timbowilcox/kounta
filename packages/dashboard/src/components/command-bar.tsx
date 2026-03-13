"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useCommandBar } from "./command-bar-provider";
import {
  useAssistantStream,
  TOOL_LABELS,
  type ChatMessage,
} from "@/hooks/use-assistant-stream";

// ---------------------------------------------------------------------------
// Suggested actions for the command bar
// ---------------------------------------------------------------------------

const COMMAND_BAR_SUGGESTIONS = [
  { label: "What's my cash position?", icon: "cash" },
  { label: "Show me this month's P&L", icon: "report" },
  { label: "What were my biggest expenses?", icon: "expense" },
  { label: "Post a transaction", icon: "post" },
  { label: "Generate a balance sheet", icon: "balance" },
];

function SuggestionIcon({ type }: { type: string }) {
  const color = "rgba(0,0,0,0.36)";
  switch (type) {
    case "cash":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 3v14" /><path d="M7 3h6a3.5 3.5 0 0 1 0 7H7" /><path d="M7 10h7a3.5 3.5 0 0 1 0 7H7" />
        </svg>
      );
    case "report":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
          <path d="M3 17V6" /><path d="M7.5 17V9" /><path d="M12 17V3" /><path d="M16.5 17V11" />
        </svg>
      );
    case "expense":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
          <path d="M3 5.5h14" /><path d="M3 10h14" /><path d="M3 14.5h9" />
        </svg>
      );
    case "post":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
          <path d="M10 3v14M3 10h14" />
        </svg>
      );
    case "balance":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
          <rect x="2" y="2" width="6" height="6" rx="1.5" /><rect x="12" y="2" width="6" height="6" rx="1.5" />
          <rect x="2" y="12" width="6" height="6" rx="1.5" /><rect x="12" y="12" width="6" height="6" rx="1.5" />
        </svg>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// CommandBar
// ---------------------------------------------------------------------------

export function CommandBar() {
  const { isOpen, close, prefill } = useCommandBar();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const {
    messages,
    isStreaming,
    conversationId,
    pendingConfirmation,
    expandedTools,
    sendMessage,
    handleConfirm,
    startNewConversation,
    toggleToolExpanded,
  } = useAssistantStream();

  // Focus input and apply prefill when opened
  useEffect(() => {
    if (isOpen) {
      setInput(prefill);
      setHasSubmitted(false);
      startNewConversation();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, prefill, startNewConversation]);

  // Escape key closes
  useEffect(() => {
    if (!isOpen) return;
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, close]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    setHasSubmitted(true);
    sendMessage(input);
    setInput("");
  }, [input, isStreaming, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleSuggestionClick = useCallback(
    (text: string) => {
      setHasSubmitted(true);
      sendMessage(text);
      setInput("");
    },
    [sendMessage],
  );

  const handleContinueInAssistant = useCallback(() => {
    close();
    const url = conversationId ? "/assistant?c=" + conversationId : "/assistant";
    router.push(url);
  }, [close, conversationId, router]);

  if (!isOpen) return null;

  // Get the last assistant message for display
  const lastAssistantMsg = messages.filter((m: ChatMessage) => m.role === "assistant").pop();

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        className="command-bar-backdrop"
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.4)",
          zIndex: 100,
        }}
      />

      {/* Modal */}
      <div
        className="command-bar-modal"
        style={{
          position: "fixed",
          top: "35%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "90vw",
          maxWidth: 640,
          backgroundColor: "#FFFFFF",
          borderRadius: 16,
          boxShadow: "0 24px 80px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.08)",
          zIndex: 101,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: "70vh",
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 20px",
            borderBottom: "1px solid rgba(0,0,0,0.06)",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            disabled={isStreaming}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 15,
              color: "#0A0A0A",
              backgroundColor: "transparent",
              fontFamily: "var(--font-family-body)",
            }}
          />
          <kbd
            style={{
              fontSize: 11,
              color: "rgba(0,0,0,0.28)",
              backgroundColor: "#F7F7F6",
              border: "1px solid rgba(0,0,0,0.10)",
              borderRadius: 4,
              padding: "2px 6px",
              fontFamily: "var(--font-family-mono)",
            }}
          >
            {"\u2318K"}
          </kbd>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {/* Suggestions (shown when no submission yet) */}
          {!hasSubmitted && (
            <div style={{ padding: "8px 0" }}>
              {COMMAND_BAR_SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => handleSuggestionClick(s.label)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    padding: "10px 20px",
                    backgroundColor: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 14,
                    color: "#0A0A0A",
                    fontFamily: "var(--font-family-body)",
                    textAlign: "left",
                    transition: "background-color 100ms",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.03)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  <SuggestionIcon type={s.icon} />
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Streaming response area */}
          {hasSubmitted && (
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              {/* User's question */}
              {messages.filter((m: ChatMessage) => m.role === "user").slice(-1).map((msg: ChatMessage, i: number) => (
                <div key={i} style={{ fontSize: 14, color: "rgba(0,0,0,0.55)", fontStyle: "italic" }}>
                  {msg.content}
                </div>
              ))}

              {/* Tool call cards */}
              {lastAssistantMsg?.toolCalls && lastAssistantMsg.toolCalls.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {lastAssistantMsg.toolCalls.map((tc, j) => {
                    const key = "cmd-" + j;
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

              {/* Assistant response text */}
              {lastAssistantMsg?.content && (
                <div
                  style={{
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: "#0A0A0A",
                    fontFamily: "var(--font-family-body)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {lastAssistantMsg.content}
                </div>
              )}

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

              {/* Streaming dots */}
              {isStreaming && !lastAssistantMsg?.content && !(lastAssistantMsg?.toolCalls?.length) && (
                <div style={{ display: "flex", gap: 4, padding: "8px 0" }}>
                  <span className="chat-dot chat-dot-1" />
                  <span className="chat-dot chat-dot-2" />
                  <span className="chat-dot chat-dot-3" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {hasSubmitted && !isStreaming && lastAssistantMsg?.content && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 20px",
              borderTop: "1px solid rgba(0,0,0,0.06)",
              backgroundColor: "#F7F7F6",
            }}
          >
            <span style={{ fontSize: 10, color: "rgba(0,0,0,0.24)", fontFamily: "var(--font-family-body)" }}>
              Powered by Claude
            </span>
            <button
              onClick={handleContinueInAssistant}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                color: "#3B82F6",
                fontWeight: 500,
                fontFamily: "var(--font-family-body)",
              }}
            >
              Continue in Assistant &rarr;
            </button>
          </div>
        )}
      </div>
    </>
  );
}

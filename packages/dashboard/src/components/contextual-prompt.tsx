"use client";

import { useCommandBar } from "./command-bar-provider";

export function ContextualPrompt({ placeholder }: { placeholder: string }) {
  const { open } = useCommandBar();

  return (
    <button
      onClick={() => open(placeholder)}
      className="contextual-prompt"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 14px",
        borderRadius: 8,
        border: "1px solid rgba(0,0,0,0.10)",
        backgroundColor: "transparent",
        cursor: "pointer",
        fontSize: 13,
        color: "rgba(0,0,0,0.36)",
        fontFamily: "var(--font-family-body)",
        fontWeight: 400,
        transition: "all 200ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      {placeholder}
    </button>
  );
}

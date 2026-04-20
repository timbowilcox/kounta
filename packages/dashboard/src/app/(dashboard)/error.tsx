"use client";

// ---------------------------------------------------------------------------
// Dashboard route-group error boundary.
//
// Catches uncaught errors thrown during server-component rendering or
// client-component lifecycle inside any /(dashboard)/* page. Without this
// file, uncaught throws produce Next.js's default "Application error" page
// with no recovery option.
// ---------------------------------------------------------------------------

import { useEffect } from "react";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardError({ error, reset }: Props) {
  useEffect(() => {
    // Surface to browser console; in production this is the only place a
    // developer can inspect what went wrong without server log access.
    console.error("[dashboard] route error:", error);
  }, [error]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        padding: "32px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          backgroundColor: "rgba(239,68,68,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>

      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "var(--text-primary)",
          margin: "0 0 8px",
        }}
      >
        Something went wrong
      </h2>

      <p
        style={{
          fontSize: 14,
          color: "var(--text-secondary)",
          margin: "0 0 20px",
          maxWidth: 420,
          lineHeight: 1.5,
        }}
      >
        This page hit an unexpected error. You can retry, or head back to the
        overview to keep working.
      </p>

      {error.digest && (
        <p
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            margin: "0 0 20px",
            fontFamily: "monospace",
          }}
        >
          Error ID: {error.digest}
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={reset}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            backgroundColor: "var(--accent)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 500,
            border: "none",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        <a
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "8px 16px",
            borderRadius: 8,
            backgroundColor: "transparent",
            color: "var(--text-tertiary)",
            fontSize: 13,
            fontWeight: 500,
            border: "1px solid var(--border)",
            textDecoration: "none",
          }}
        >
          Back to overview
        </a>
      </div>
    </div>
  );
}

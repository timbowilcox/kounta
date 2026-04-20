"use client";

// ---------------------------------------------------------------------------
// Global error boundary — catches errors in the root layout itself.
//
// This file MUST render its own <html> and <body> because it replaces the
// root layout when an error occurs there. Per Next.js conventions, this is
// the last-resort fallback before Next.js renders its built-in error page.
// ---------------------------------------------------------------------------

import { useEffect } from "react";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    console.error("[dashboard] global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          backgroundColor: "#0a0a0a",
          color: "#e5e5e5",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 420, padding: 32 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 12px" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, color: "#a0a0a0", margin: "0 0 24px", lineHeight: 1.5 }}>
            An unexpected error occurred while loading the dashboard. Please try again or refresh the page.
          </p>
          {error.digest && (
            <p style={{ fontSize: 11, color: "#666", margin: "0 0 20px", fontFamily: "monospace" }}>
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              backgroundColor: "#3b82f6",
              color: "#fff",
              fontSize: 13,
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

"use client";

import { signIn } from "next-auth/react";

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ backgroundColor: "var(--background)" }}>
      {/* Subtle radial gradient glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(700px circle at 50% 35%, rgba(235,228,220,0.04), transparent 70%)",
        }}
      />

      <div
        className="relative z-10"
        style={{
          width: 420,
          padding: "48px 40px",
          borderRadius: 24,
          border: "1px solid var(--border)",
          backgroundColor: "var(--surface-1)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center justify-center" style={{ marginBottom: 36 }}>
          <img src="/logo.svg" alt="Kounta" style={{ height: 32 }} />
        </div>

        <p className="text-center text-sm" style={{ color: "var(--text-tertiary)", marginBottom: 36 }}>
          Accounting infrastructure for builders
        </p>

        {/* OAuth Buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            onClick={() => handleOAuth("github")}
            className="w-full flex items-center justify-center text-sm font-medium"
            style={{
              gap: 12,
              padding: "14px 16px",
              borderRadius: 14,
              backgroundColor: "var(--surface-2)",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
              cursor: "pointer",
              transition: "all 250ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--surface-3)";
              e.currentTarget.style.borderColor = "var(--border-strong)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--surface-2)";
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <GitHubIcon />
            Continue with GitHub
          </button>

          <button
            onClick={() => handleOAuth("google")}
            className="w-full flex items-center justify-center text-sm font-medium"
            style={{
              gap: 12,
              padding: "14px 16px",
              borderRadius: 14,
              backgroundColor: "var(--surface-2)",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
              cursor: "pointer",
              transition: "all 250ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--surface-3)";
              e.currentTarget.style.borderColor = "var(--border-strong)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--surface-2)";
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <GoogleIcon />
            Continue with Google
          </button>
        </div>

        <p className="text-center text-xs" style={{ color: "var(--text-disabled)", marginTop: 28 }}>
          No credit card required. No email verification.
        </p>
      </div>
    </div>
  );
}

function handleOAuth(provider: string) {
  signIn(provider, { callbackUrl: "/" });
}

function GitHubIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="var(--text-primary)">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 0C4.477 0 0 4.477 0 10c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 10 4.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.579.688.481C17.138 18.163 20 14.418 20 10c0-5.523-4.477-10-10-10z"
      />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20">
      <path d="M19.6 10.23c0-.68-.06-1.36-.17-2.01H10v3.8h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.89-1.74 2.98-4.3 2.98-7.31z" fill="#4285F4" />
      <path d="M10 20c2.7 0 4.96-.9 6.62-2.42l-3.24-2.5c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.58-4.12H1.08v2.58A9.99 9.99 0 0 0 10 20z" fill="#34A853" />
      <path d="M4.42 11.88A6.01 6.01 0 0 1 4.1 10c0-.66.11-1.3.32-1.88V5.54H1.08A9.99 9.99 0 0 0 0 10c0 1.61.39 3.14 1.08 4.5l3.34-2.62z" fill="#FBBC05" />
      <path d="M10 3.96c1.47 0 2.78.5 3.82 1.5l2.86-2.86A9.96 9.96 0 0 0 10 0 9.99 9.99 0 0 0 1.08 5.5l3.34 2.62C5.2 5.76 7.4 3.96 10 3.96z" fill="#EA4335" />
    </svg>
  );
}

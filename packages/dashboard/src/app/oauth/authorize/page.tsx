"use client";

import { Suspense, useEffect, useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";

/**
 * OAuth consent screen — shown when an MCP client (e.g. Claude.ai)
 * redirects a user here for authorization.
 *
 * URL params:
 *   client_id, redirect_uri, response_type, scope,
 *   state, code_challenge, code_challenge_method
 */
export default function OAuthAuthorizePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--background)" }}>
        <div style={{ color: "var(--text-tertiary)", fontSize: "0.8125rem" }}>Loading...</div>
      </div>
    }>
      <OAuthAuthorizeContent />
    </Suspense>
  );
}

function OAuthAuthorizeContent() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [clientInfo, setClientInfo] = useState<{
    valid: boolean;
    client_name?: string;
    client_id?: string;
    scopes?: string[];
    error?: string;
  } | null>(null);
  const [validating, setValidating] = useState(true);

  const clientId = searchParams.get("client_id") ?? "";
  const redirectUri = searchParams.get("redirect_uri") ?? "";
  const responseType = searchParams.get("response_type") ?? "";
  const scope = searchParams.get("scope") ?? "";
  const state = searchParams.get("state") ?? "";
  const codeChallenge = searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = searchParams.get("code_challenge_method") ?? "";

  // If not logged in, redirect to sign in with callback back here
  useEffect(() => {
    if (status === "unauthenticated") {
      const currentUrl = window.location.href;
      router.push(`/signin?callbackUrl=${encodeURIComponent(currentUrl)}`);
    }
  }, [status, router]);

  // Validate client params on mount
  useEffect(() => {
    if (status !== "authenticated") return;

    const validateClient = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_KOUNTA_API_URL ?? "";
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: responseType,
          scope,
          code_challenge: codeChallenge,
        });

        const res = await fetch(`${apiUrl}/oauth/validate-client?${params}`);
        const data = await res.json();
        setClientInfo(data);
      } catch {
        setClientInfo({ valid: false, error: "Failed to validate client" });
      } finally {
        setValidating(false);
      }
    };

    validateClient();
  }, [status, clientId, redirectUri, responseType, scope, codeChallenge]);

  const handleApprove = () => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/oauth/consent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            redirect_uri: redirectUri,
            scopes: scope ? scope.split(/\s+/) : [],
            state,
            code_challenge: codeChallenge,
            code_challenge_method: codeChallengeMethod,
            approved: true,
          }),
        });

        const data = await res.json();

        if (!res.ok || data.error) {
          setError(data.error?.message ?? "Failed to authorize");
          return;
        }

        // Redirect to the callback URI with the auth code
        window.location.href = data.redirect_uri;
      } catch {
        setError("An unexpected error occurred");
      }
    });
  };

  const handleDeny = () => {
    const separator = redirectUri.includes("?") ? "&" : "?";
    const denyUrl = `${redirectUri}${separator}error=access_denied${state ? `&state=${encodeURIComponent(state)}` : ""}`;
    window.location.href = denyUrl;
  };

  // Loading state
  if (status === "loading" || validating) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--background)" }}>
        <div style={{ color: "var(--text-tertiary)", fontSize: "0.8125rem" }}>Loading...</div>
      </div>
    );
  }

  // Error state — show error page, do NOT redirect (prevents open redirect)
  if (clientInfo && !clientInfo.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--background)" }}>
        <div
          style={{
            width: "27.5rem",
            padding: "2rem",
            borderRadius: "0.75rem",
            border: "1px solid var(--border)",
            backgroundColor: "var(--surface-1)",
            textAlign: "center",
          }}
        >
          <div style={{ marginBottom: "1rem" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--negative)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>
            Authorization Error
          </h2>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginBottom: "1.5rem", lineHeight: 1.6 }}>
            {clientInfo.error ?? "Invalid authorization request"}
          </p>
          <button
            onClick={() => window.close()}
            className="btn-secondary"
            style={{ cursor: "pointer" }}
          >
            Close this window
          </button>
        </div>
      </div>
    );
  }

  if (!session?.user) return null;

  const scopeDescriptions: Record<string, string> = {
    "ledger:read": "Read your transactions and financial statements",
    "ledger:write": "Post new transactions and create accounts",
    "bank-feeds:read": "Read your bank feed connections",
    "bank-feeds:write": "Create and disconnect bank connections",
    "settings:read": "Read your ledger configuration",
  };

  const requestedScopes = clientInfo?.scopes ?? [];

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--background)" }}>
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
          width: "27.5rem",
          padding: "2rem",
          borderRadius: "0.75rem",
          border: "1px solid var(--border)",
          backgroundColor: "var(--surface-1)",
        }}
      >
        {/* Header: Kounta logo + client name */}
        <div className="flex items-center justify-between" style={{ marginBottom: "1.5rem" }}>
          <img src="/logo.svg" alt="Kounta" style={{ height: "1.5rem" }} />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-primary)" }}>
              {clientInfo?.client_name ?? clientId}
            </div>
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--border)", marginBottom: "1.5rem" }} />

        {/* Description */}
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.25rem" }}>
          {clientInfo?.client_name ?? clientId} wants access to your Kounta account
        </h2>
        <p style={{ fontSize: "0.8125rem", color: "var(--text-tertiary)", marginBottom: "1.25rem" }}>
          This will allow {clientInfo?.client_name ?? clientId} to:
        </p>

        {/* Permissions list */}
        <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
          {requestedScopes.map((s: string) => (
            <li key={s} className="flex items-start" style={{ gap: "0.625rem" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--positive)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                {scopeDescriptions[s] ?? s}
              </span>
            </li>
          ))}
        </ul>

        {/* Signed in as */}
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "0.8125rem", color: "var(--text-tertiary)" }}>
            Signed in as {session.user.email}
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--border)", marginBottom: "1.5rem" }} />

        {/* Error message */}
        {error && (
          <div style={{ fontSize: "0.8125rem", color: "var(--negative)", marginBottom: "1rem" }}>
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex justify-end" style={{ gap: "0.5rem" }}>
          <button
            onClick={handleDeny}
            className="btn-secondary"
            style={{ cursor: "pointer" }}
            disabled={isPending}
          >
            Deny
          </button>
          <button
            onClick={handleApprove}
            className="btn-primary"
            style={{
              cursor: isPending ? "not-allowed" : "pointer",
              opacity: isPending ? 0.5 : 1,
            }}
            disabled={isPending}
          >
            {isPending ? "Authorizing..." : "Allow access"}
          </button>
        </div>

        {/* Footer note */}
        <p style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginTop: "1.25rem", textAlign: "center" }}>
          You can revoke access at any time in Settings → Connections
        </p>
      </div>
    </div>
  );
}

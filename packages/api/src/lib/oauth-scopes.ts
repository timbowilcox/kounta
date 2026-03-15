// ---------------------------------------------------------------------------
// OAuth 2.0 scope definitions and helpers.
// ---------------------------------------------------------------------------

/** All supported OAuth scopes */
export const OAUTH_SCOPES = [
  "ledger:read",
  "ledger:write",
  "bank-feeds:read",
  "bank-feeds:write",
  "settings:read",
] as const;

export type OAuthScope = (typeof OAUTH_SCOPES)[number];

/** Human-readable descriptions for consent screen */
export const SCOPE_DESCRIPTIONS: Record<OAuthScope, string> = {
  "ledger:read": "Read your transactions and financial statements",
  "ledger:write": "Post new transactions and create accounts",
  "bank-feeds:read": "Read your bank feed connections",
  "bank-feeds:write": "Create and disconnect bank connections",
  "settings:read": "Read your ledger configuration",
};

/** Validate that all scopes in the array are known */
export const validateScopes = (scopes: string[]): scopes is OAuthScope[] => {
  return scopes.every((s) => (OAUTH_SCOPES as readonly string[]).includes(s));
};

/** Parse space-separated scope string into array */
export const parseScopes = (scopeString: string): string[] => {
  return scopeString.split(/\s+/).filter(Boolean);
};

/**
 * Check if a given HTTP method + path is allowed by the token's scopes.
 *
 * Scope mapping:
 *   ledger:read    → GET on /v1/ledgers/*, /v1/templates
 *   ledger:write   → POST/PUT/PATCH/DELETE on /v1/ledgers/*
 *   bank-feeds:read  → GET on /v1/ledgers/:id/bank-feeds
 *   bank-feeds:write → POST/DELETE on /v1/ledgers/:id/bank-feeds
 *   settings:read  → GET on /v1/ledgers (list/get)
 */
export const isScopeAllowed = (
  method: string,
  path: string,
  scopes: string[],
): boolean => {
  const upperMethod = method.toUpperCase();
  const isRead = upperMethod === "GET" || upperMethod === "HEAD";
  const isWrite = !isRead;

  // Bank feeds paths
  if (path.includes("/bank-feeds")) {
    if (isRead && scopes.includes("bank-feeds:read")) return true;
    if (isWrite && scopes.includes("bank-feeds:write")) return true;
    return false;
  }

  // Ledger and sub-resource paths
  if (path.includes("/v1/ledgers") || path.includes("/v1/templates")) {
    if (isRead && scopes.includes("ledger:read")) return true;
    if (isWrite && scopes.includes("ledger:write")) return true;
    // settings:read allows GET on ledger config
    if (isRead && scopes.includes("settings:read")) return true;
    return false;
  }

  // Health and other public endpoints
  if (path.includes("/v1/health") || path.includes("/.well-known")) {
    return true;
  }

  // OAuth endpoints are always accessible
  if (path.includes("/oauth/")) {
    return true;
  }

  // Default: deny
  return false;
};

/** Parse scopes from DB (stored as JSON array or PG TEXT[]) */
export const parseScopesFromDb = (raw: string): string[] => {
  if (raw.startsWith("[")) return JSON.parse(raw);
  if (raw.startsWith("{")) return raw.slice(1, -1).split(",").map((s) => s.replace(/"/g, ""));
  return raw.split(/\s+/).filter(Boolean);
};

/**
 * Validate an OAuth access token against the database.
 * Used by the auth middleware to authenticate OAuth Bearer tokens.
 */
export const validateOAuthToken = async (
  db: { get: <T>(sql: string, params?: unknown[]) => Promise<T | undefined>; run: (sql: string, params?: unknown[]) => Promise<unknown> },
  token: string,
  method: string,
  path: string,
): Promise<{ ok: true; userId: string; ledgerId: string } | { ok: false; error: string }> => {
  const tokenRow = await db.get<{
    user_id: string;
    ledger_id: string;
    scopes: string;
    expires_at: string;
    revoked_at: string | null;
  }>(
    "SELECT user_id, ledger_id, scopes, expires_at, revoked_at FROM oauth_tokens WHERE access_token = ?",
    [token]
  );

  if (!tokenRow) {
    return { ok: false, error: "Token not found" };
  }

  if (tokenRow.revoked_at) {
    return { ok: false, error: "Token has been revoked" };
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    return { ok: false, error: "Token has expired" };
  }

  // Check scope enforcement
  const scopes = parseScopesFromDb(tokenRow.scopes);
  if (!isScopeAllowed(method, path, scopes)) {
    return { ok: false, error: "Insufficient scope" };
  }

  return { ok: true, userId: tokenRow.user_id, ledgerId: tokenRow.ledger_id };
};

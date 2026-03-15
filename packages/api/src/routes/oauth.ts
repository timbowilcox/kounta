// ---------------------------------------------------------------------------
// OAuth 2.0 routes — /oauth/*
//
// Endpoints:
//   GET  /.well-known/oauth-authorization-server — discovery document
//   POST /oauth/consent    — dashboard calls this after user approval
//   POST /oauth/token      — exchange auth code for tokens / refresh
//   POST /oauth/revoke     — revoke a token
//   GET  /oauth/userinfo   — user info for token holder
//   GET  /oauth/connections — list active OAuth grants (admin auth)
//   POST /oauth/connections/revoke — revoke all tokens for a client (admin)
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { randomBytes, createHash } from "node:crypto";
import { generateId } from "@kounta/core";
import type { Env } from "../lib/context.js";
import { adminAuth } from "../middleware/auth.js";
import { OAUTH_SCOPES, validateScopes, parseScopes, parseScopesFromDb } from "../lib/oauth-scopes.js";

export const oauthRoutes = new Hono<Env>();
export const wellKnownRoutes = new Hono<Env>();

// ---------------------------------------------------------------------------
// Discovery document
// ---------------------------------------------------------------------------

const getDiscoveryDocument = () => {
  const apiBase = process.env["OAUTH_API_BASE"] ?? "https://api.kounta.ai";
  const dashboardBase = process.env["OAUTH_DASHBOARD_BASE"] ?? "https://kounta.ai";

  return {
    issuer: apiBase,
    authorization_endpoint: `${dashboardBase}/oauth/authorize`,
    token_endpoint: `${apiBase}/oauth/token`,
    revocation_endpoint: `${apiBase}/oauth/revoke`,
    userinfo_endpoint: `${apiBase}/oauth/userinfo`,
    scopes_supported: [...OAUTH_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
  };
};

wellKnownRoutes.get("/oauth-authorization-server", (c) => {
  return c.json(getDiscoveryDocument());
});

// ---------------------------------------------------------------------------
// POST /oauth/consent — called by dashboard after user approves
// ---------------------------------------------------------------------------

oauthRoutes.post("/consent", adminAuth, async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();
  const body = await c.req.json();

  const {
    client_id,
    redirect_uri,
    scopes,
    state,
    code_challenge,
    code_challenge_method,
    user_id,
    ledger_id,
    approved,
  } = body;

  if (!client_id || !redirect_uri) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "client_id and redirect_uri are required" } }, 400);
  }

  // Validate client exists
  const client = await db.get<{ client_id: string; redirect_uris: string | string[]; is_public: boolean | number }>(
    "SELECT client_id, redirect_uris, is_public FROM oauth_clients WHERE client_id = ?",
    [client_id]
  );

  if (!client) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "Unknown client_id" } }, 400);
  }

  // Validate redirect URI (exact match required)
  const registeredUris = parseRedirectUris(client.redirect_uris);
  const uriAllowed = registeredUris.some((uri) => {
    if (uri === "http://localhost") {
      return redirect_uri.startsWith("http://localhost");
    }
    return uri === redirect_uri;
  });

  if (!uriAllowed) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "redirect_uri does not match registered URIs" } }, 400);
  }

  // If user denied
  if (!approved) {
    const separator = redirect_uri.includes("?") ? "&" : "?";
    const denyUrl = `${redirect_uri}${separator}error=access_denied${state ? `&state=${encodeURIComponent(state)}` : ""}`;
    return c.json({ redirect_uri: denyUrl });
  }

  // PKCE required for public clients (BOOLEAN in PG, INTEGER in SQLite)
  const isPublicClient = client.is_public === true || client.is_public === 1;
  if (isPublicClient && !code_challenge) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "PKCE code_challenge is required for public clients" } }, 400);
  }

  // Validate scopes
  const scopeArray = Array.isArray(scopes) ? scopes : parseScopes(scopes || "");
  if (scopeArray.length > 0 && !validateScopes(scopeArray)) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "One or more scopes are not supported" } }, 400);
  }

  // Generate authorization code
  const code = randomBytes(32).toString("hex");
  const id = generateId();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

  await db.run(
    `INSERT INTO oauth_authorization_codes
     (id, code, client_id, user_id, ledger_id, redirect_uri, scopes, code_challenge, code_challenge_method, state, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      code,
      client_id,
      user_id,
      ledger_id,
      redirect_uri,
      JSON.stringify(scopeArray),
      code_challenge || null,
      code_challenge_method || null,
      state || null,
      expiresAt,
    ]
  );

  const separator = redirect_uri.includes("?") ? "&" : "?";
  const successUrl = `${redirect_uri}${separator}code=${code}${state ? `&state=${encodeURIComponent(state)}` : ""}`;

  return c.json({ redirect_uri: successUrl });
});

// ---------------------------------------------------------------------------
// POST /oauth/token — exchange code for tokens or refresh
// ---------------------------------------------------------------------------

oauthRoutes.post("/token", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();

  // Accept both JSON and form-urlencoded
  let params: Record<string, string>;
  const contentType = c.req.header("Content-Type") ?? "";

  if (contentType.includes("application/json")) {
    params = await c.req.json();
  } else {
    const formData = await c.req.text();
    params = Object.fromEntries(new URLSearchParams(formData));
  }

  const { grant_type } = params;

  if (grant_type === "authorization_code") {
    return handleAuthCodeGrant(c, db, params);
  } else if (grant_type === "refresh_token") {
    return handleRefreshGrant(c, db, params);
  } else {
    return c.json({ error: "unsupported_grant_type", error_description: "Supported: authorization_code, refresh_token" }, 400);
  }
});

// ---------------------------------------------------------------------------
// POST /oauth/revoke — revoke a token
// ---------------------------------------------------------------------------

oauthRoutes.post("/revoke", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();

  let params: Record<string, string>;
  const contentType = c.req.header("Content-Type") ?? "";

  if (contentType.includes("application/json")) {
    params = await c.req.json();
  } else {
    const formData = await c.req.text();
    params = Object.fromEntries(new URLSearchParams(formData));
  }

  const { token } = params;
  if (!token) {
    return c.json({}, 200); // Per OAuth spec, always return 200
  }

  const now = new Date().toISOString();

  // Try revoking as access token
  await db.run(
    "UPDATE oauth_tokens SET revoked_at = ? WHERE access_token = ? AND revoked_at IS NULL",
    [now, token]
  );

  // Also try as refresh token
  await db.run(
    "UPDATE oauth_tokens SET revoked_at = ? WHERE refresh_token = ? AND revoked_at IS NULL",
    [now, token]
  );

  return c.json({}, 200);
});

// ---------------------------------------------------------------------------
// GET /oauth/userinfo — user info for Bearer token holder
// ---------------------------------------------------------------------------

oauthRoutes.get("/userinfo", async (c) => {
  const engine = c.get("engine");
  const db = engine.getDb();

  const token = extractBearerToken(c);
  if (!token) {
    return c.json({ error: "invalid_token", error_description: "Bearer token required" }, 401);
  }

  const tokenRow = await db.get<{
    user_id: string;
    ledger_id: string;
    scopes: string;
    expires_at: string;
  }>(
    "SELECT user_id, ledger_id, scopes, expires_at FROM oauth_tokens WHERE access_token = ? AND revoked_at IS NULL",
    [token]
  );

  if (!tokenRow || new Date(tokenRow.expires_at) < new Date()) {
    return c.json({ error: "invalid_token", error_description: "Token is invalid or expired" }, 401);
  }

  const user = await db.get<{ id: string; email: string; name: string }>(
    "SELECT id, email, name FROM users WHERE id = ?",
    [tokenRow.user_id]
  );

  if (!user) {
    return c.json({ error: "invalid_token", error_description: "User not found" }, 401);
  }

  return c.json({
    sub: user.id,
    email: user.email,
    name: user.name,
    ledger_id: tokenRow.ledger_id,
  });
});

// ---------------------------------------------------------------------------
// GET /oauth/connections — list active OAuth grants (admin auth)
// ---------------------------------------------------------------------------

oauthRoutes.get("/connections", adminAuth, async (c) => {
  const db = c.get("engine").getDb();
  const userId = c.req.query("userId");

  if (!userId) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "userId query parameter is required" } }, 400);
  }

  const tokens = await db.all<{
    id: string;
    client_id: string;
    ledger_id: string;
    scopes: string;
    created_at: string;
    expires_at: string;
  }>(
    `SELECT t.id, t.client_id, t.ledger_id, t.scopes, t.created_at, t.expires_at
     FROM oauth_tokens t
     WHERE t.user_id = ? AND t.revoked_at IS NULL AND t.refresh_expires_at > ?
     ORDER BY t.created_at DESC`,
    [userId, new Date().toISOString()]
  );

  // Group by client_id and enrich with client name
  const clientIds = [...new Set(tokens.map((t) => t.client_id))];
  const connections = [];

  for (const clientId of clientIds) {
    const client = await db.get<{ name: string }>(
      "SELECT name FROM oauth_clients WHERE client_id = ?",
      [clientId]
    );

    const clientTokens = tokens.filter((t) => t.client_id === clientId);
    if (clientTokens.length === 0) continue;

    const latestToken = clientTokens[0]!;

    connections.push({
      client_id: clientId,
      client_name: client?.name ?? clientId,
      scopes: JSON.parse(latestToken.scopes),
      connected_at: clientTokens[clientTokens.length - 1]!.created_at,
      token_count: clientTokens.length,
    });
  }

  return c.json({ data: connections });
});

// ---------------------------------------------------------------------------
// POST /oauth/connections/revoke — revoke all tokens for a client (admin)
// ---------------------------------------------------------------------------

oauthRoutes.post("/connections/revoke", adminAuth, async (c) => {
  const db = c.get("engine").getDb();
  const body = await c.req.json();

  const { userId, clientId } = body;
  if (!userId || !clientId) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "userId and clientId are required" } }, 400);
  }

  const now = new Date().toISOString();
  await db.run(
    "UPDATE oauth_tokens SET revoked_at = ? WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL",
    [now, userId, clientId]
  );

  return c.json({ data: { revoked: true } });
});

// ---------------------------------------------------------------------------
// Validate OAuth client params (for dashboard to call before showing consent)
// ---------------------------------------------------------------------------

oauthRoutes.get("/validate-client", async (c) => {
  try {
    const db = c.get("engine").getDb();

    const clientId = c.req.query("client_id");
    const redirectUri = c.req.query("redirect_uri");
    const responseType = c.req.query("response_type");
    const scope = c.req.query("scope");
    const codeChallenge = c.req.query("code_challenge");

    console.log("[oauth] validate-client params:", { clientId, redirectUri, responseType, scope, codeChallenge });

    if (!clientId) {
      return c.json({ valid: false, error: "Missing client_id" });
    }

    const client = await db.get<{
      client_id: string;
      name: string;
      redirect_uris: string | string[];
      scopes: string | string[];
      is_public: boolean | number;
    }>(
      "SELECT client_id, name, redirect_uris, scopes, is_public FROM oauth_clients WHERE client_id = ?",
      [clientId]
    );

    console.log("[oauth] validate-client db result:", client);

    if (!client) {
      return c.json({ valid: false, error: "Unknown client_id" });
    }

    if (responseType && responseType !== "code") {
      return c.json({ valid: false, error: "Only response_type=code is supported" });
    }

    // Validate redirect URI
    if (redirectUri) {
      const registeredUris = parseRedirectUris(client.redirect_uris);
      const allowed = registeredUris.some((uri) => {
        if (uri === "http://localhost") return redirectUri.startsWith("http://localhost");
        return uri === redirectUri;
      });
      if (!allowed) {
        return c.json({ valid: false, error: "redirect_uri does not match registered URIs" });
      }
    }

    // Validate scopes
    if (scope) {
      const requestedScopes = parseScopes(scope);
      if (!validateScopes(requestedScopes)) {
        return c.json({ valid: false, error: "One or more scopes are not supported" });
      }
    }

    // PKCE required for public clients (BOOLEAN in PG, INTEGER in SQLite)
    const isPublic = client.is_public === true || client.is_public === 1;
    if (isPublic && !codeChallenge) {
      return c.json({ valid: false, error: "PKCE code_challenge is required for public clients" });
    }

    const clientScopes = parseArrayColumn(client.scopes);

    return c.json({
      valid: true,
      client_name: client.name,
      client_id: client.client_id,
      scopes: scope ? parseScopes(scope) : clientScopes,
    });
  } catch (err) {
    console.error("validate-client error:", err);
    return c.json({ error: "internal_error", message: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a TEXT[] / JSON array column from DB — handles native PG arrays, JSON strings, PG text format */
const parseArrayColumn = (raw: string | string[]): string[] => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    if (raw.startsWith("[")) return JSON.parse(raw);
    // PostgreSQL TEXT[] format: {uri1,uri2}
    if (raw.startsWith("{")) return raw.slice(1, -1).split(",").map((s) => s.replace(/"/g, ""));
    return [raw];
  }
  return [];
};

/** Parse redirect_uris from DB (native PG array, JSON string, or PG TEXT[] string) */
const parseRedirectUris = (raw: string | string[]): string[] => parseArrayColumn(raw);

// parseScopesFromDb imported from ../lib/oauth-scopes.js

/** Extract Bearer token from Authorization header */
const extractBearerToken = (c: { req: { header: (name: string) => string | undefined } }): string | undefined => {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return undefined;
};

/** PKCE S256: BASE64URL(SHA256(code_verifier)) */
const computeS256Challenge = (codeVerifier: string): string => {
  const hash = createHash("sha256").update(codeVerifier).digest("base64url");
  return hash;
};

/** Handle authorization_code grant */
const handleAuthCodeGrant = async (
  c: { json: (data: unknown, status?: number) => Response; get: (key: string) => unknown },
  db: { get: <T>(sql: string, params?: unknown[]) => Promise<T | undefined>; run: (sql: string, params?: unknown[]) => Promise<unknown> },
  params: Record<string, string>,
) => {
  const { code, redirect_uri, client_id, code_verifier } = params;

  if (!code || !client_id) {
    return c.json({ error: "invalid_request", error_description: "code and client_id are required" }, 400);
  }

  // Look up authorization code
  const authCode = await db.get<{
    id: string;
    code: string;
    client_id: string;
    user_id: string;
    ledger_id: string;
    redirect_uri: string;
    scopes: string;
    code_challenge: string | null;
    code_challenge_method: string | null;
    expires_at: string;
    used_at: string | null;
  }>(
    "SELECT * FROM oauth_authorization_codes WHERE code = ?",
    [code]
  );

  if (!authCode) {
    return c.json({ error: "invalid_grant", error_description: "Authorization code not found" }, 400);
  }

  // Check if already used (replay attack)
  if (authCode.used_at) {
    return c.json({ error: "invalid_grant", error_description: "Authorization code has already been used" }, 400);
  }

  // Check expiry
  if (new Date(authCode.expires_at) < new Date()) {
    return c.json({ error: "invalid_grant", error_description: "Authorization code has expired" }, 400);
  }

  // Validate client_id matches
  if (authCode.client_id !== client_id) {
    return c.json({ error: "invalid_grant", error_description: "client_id mismatch" }, 400);
  }

  // Validate redirect_uri matches (if provided)
  if (redirect_uri && redirect_uri !== authCode.redirect_uri) {
    return c.json({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, 400);
  }

  // PKCE validation
  if (authCode.code_challenge) {
    if (!code_verifier) {
      return c.json({ error: "invalid_grant", error_description: "code_verifier is required for PKCE" }, 400);
    }

    const expectedChallenge = computeS256Challenge(code_verifier);
    if (expectedChallenge !== authCode.code_challenge) {
      return c.json({ error: "invalid_grant", error_description: "PKCE code_verifier validation failed" }, 400);
    }
  }

  // Mark code as used
  await db.run(
    "UPDATE oauth_authorization_codes SET used_at = ? WHERE id = ?",
    [new Date().toISOString(), authCode.id]
  );

  // Generate tokens
  const accessToken = randomBytes(32).toString("hex");
  const refreshToken = randomBytes(32).toString("hex");
  const tokenId = generateId();
  const accessExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  const scopeArray = parseScopesFromDb(authCode.scopes);

  await db.run(
    `INSERT INTO oauth_tokens
     (id, access_token, token_type, refresh_token, client_id, user_id, ledger_id, scopes, expires_at, refresh_expires_at)
     VALUES (?, ?, 'Bearer', ?, ?, ?, ?, ?, ?, ?)`,
    [tokenId, accessToken, refreshToken, authCode.client_id, authCode.user_id, authCode.ledger_id, JSON.stringify(scopeArray), accessExpiresAt, refreshExpiresAt]
  );

  return c.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: refreshToken,
    scope: scopeArray.join(" "),
  });
};

/** Handle refresh_token grant */
const handleRefreshGrant = async (
  c: { json: (data: unknown, status?: number) => Response; get: (key: string) => unknown },
  db: { get: <T>(sql: string, params?: unknown[]) => Promise<T | undefined>; run: (sql: string, params?: unknown[]) => Promise<unknown> },
  params: Record<string, string>,
) => {
  const { refresh_token, client_id } = params;

  if (!refresh_token || !client_id) {
    return c.json({ error: "invalid_request", error_description: "refresh_token and client_id are required" }, 400);
  }

  const tokenRow = await db.get<{
    id: string;
    client_id: string;
    user_id: string;
    ledger_id: string;
    scopes: string;
    refresh_expires_at: string;
    revoked_at: string | null;
  }>(
    "SELECT * FROM oauth_tokens WHERE refresh_token = ?",
    [refresh_token]
  );

  if (!tokenRow) {
    return c.json({ error: "invalid_grant", error_description: "Refresh token not found" }, 400);
  }

  if (tokenRow.revoked_at) {
    return c.json({ error: "invalid_grant", error_description: "Refresh token has been revoked" }, 400);
  }

  if (tokenRow.refresh_expires_at && new Date(tokenRow.refresh_expires_at) < new Date()) {
    return c.json({ error: "invalid_grant", error_description: "Refresh token has expired" }, 400);
  }

  if (tokenRow.client_id !== client_id) {
    return c.json({ error: "invalid_grant", error_description: "client_id mismatch" }, 400);
  }

  // Revoke old token
  const now = new Date().toISOString();
  await db.run(
    "UPDATE oauth_tokens SET revoked_at = ? WHERE id = ?",
    [now, tokenRow.id]
  );

  // Issue new tokens
  const newAccessToken = randomBytes(32).toString("hex");
  const newRefreshToken = randomBytes(32).toString("hex");
  const newTokenId = generateId();
  const accessExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const scopeArray = parseScopesFromDb(tokenRow.scopes);

  await db.run(
    `INSERT INTO oauth_tokens
     (id, access_token, token_type, refresh_token, client_id, user_id, ledger_id, scopes, expires_at, refresh_expires_at)
     VALUES (?, ?, 'Bearer', ?, ?, ?, ?, ?, ?, ?)`,
    [newTokenId, newAccessToken, newRefreshToken, tokenRow.client_id, tokenRow.user_id, tokenRow.ledger_id, JSON.stringify(scopeArray), accessExpiresAt, refreshExpiresAt]
  );

  return c.json({
    access_token: newAccessToken,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: newRefreshToken,
    scope: scopeArray.join(" "),
  });
};

// validateOAuthToken is now in ../lib/oauth-scopes.js (re-export for backwards compat)
export { validateOAuthToken } from "../lib/oauth-scopes.js";

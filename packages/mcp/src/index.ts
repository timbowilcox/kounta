#!/usr/bin/env node
// ---------------------------------------------------------------------------
// @kounta/mcp — Entry point
//
// Supports two transport modes:
//   1. stdio  — local dev, Claude Code, Cursor (default when --stdio flag)
//   2. http   — deployed SSE endpoint (default when KOUNTA_MCP_TRANSPORT=http)
//
// Transport selection:
//   --stdio flag or KOUNTA_MCP_TRANSPORT=stdio → stdio
//   KOUNTA_MCP_TRANSPORT=http                  → HTTP/SSE
//   No flag and no env var                    → stdio (backwards-compatible)
// ---------------------------------------------------------------------------

import { initDatabase } from "./lib/db.js";
import { createMcpServer } from "./server.js";

function resolveTransport(): "stdio" | "http" {
  if (process.argv.includes("--stdio")) return "stdio";
  const env = process.env["KOUNTA_MCP_TRANSPORT"]?.toLowerCase();
  if (env === "http") return "http";
  return "stdio";
}

async function main(): Promise<void> {
  const transport = resolveTransport();
  const { engine, db, systemUserId } = await initDatabase();

  if (transport === "stdio") {
    await startStdio(engine, systemUserId, db);
  } else {
    await startHttp(engine, systemUserId, db);
  }
}

// ---------------------------------------------------------------------------
// stdio mode — current behaviour
// ---------------------------------------------------------------------------

async function startStdio(
  engine: import("@kounta/core").LedgerEngine,
  systemUserId: string,
  db: import("@kounta/core").Database,
): Promise<void> {
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const server = createMcpServer(engine, systemUserId, db);
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  console.error("[mcp] Running in stdio mode");
}

// ---------------------------------------------------------------------------
// HTTP/SSE mode — deployed endpoint with authentication
// ---------------------------------------------------------------------------

async function startHttp(
  engine: import("@kounta/core").LedgerEngine,
  _systemUserId: string,
  db: import("@kounta/core").Database,
): Promise<void> {
  const http = await import("node:http");
  const { SSEServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/sse.js"
  );

  const port = parseInt(process.env["PORT"] ?? "3005", 10);

  // Track active SSE sessions: sessionId → transport
  const sessions = new Map<string, InstanceType<typeof SSEServerTransport>>();

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // CORS headers for browser-based MCP clients
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", transport: "sse", sessions: sessions.size }));
      return;
    }

    // ------------------------------------------------------------------
    // GET /sse — establish SSE connection (requires API key)
    // ------------------------------------------------------------------
    if (url.pathname === "/sse" && req.method === "GET") {
      // Authenticate
      const apiKey = extractApiKey(req, url);
      if (!apiKey) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: {
            code: "UNAUTHORIZED",
            message: "Missing API key. Pass via Authorization header, X-Api-Key header, or ?key= query parameter.",
          },
        }));
        return;
      }

      const authResult = await engine.validateApiKey(apiKey);
      if (!authResult.ok) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid or revoked API key.",
          },
        }));
        return;
      }

      const keyInfo = authResult.value;

      // Create a per-session MCP server scoped to this user's ledger
      // The server is transport-agnostic; each SSE connection gets its own.
      const server = createMcpServer(engine, keyInfo.userId, db);
      const sseTransport = new SSEServerTransport("/message", res);

      sessions.set(sseTransport.sessionId, sseTransport);

      sseTransport.onclose = () => {
        sessions.delete(sseTransport.sessionId);
      };

      await server.connect(sseTransport);
      // Note: server.connect() calls sseTransport.start() internally
      return;
    }

    // ------------------------------------------------------------------
    // POST /message?sessionId=xxx — client sends JSON-RPC messages
    // ------------------------------------------------------------------
    if (url.pathname === "/message" && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "BAD_REQUEST", message: "Missing sessionId query parameter." } }));
        return;
      }

      const sseTransport = sessions.get(sessionId);
      if (!sseTransport) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Session not found. Reconnect via GET /sse." } }));
        return;
      }

      await sseTransport.handlePostMessage(req, res);
      return;
    }

    // Fallback — 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${url.pathname}` } }));
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`[mcp] HTTP/SSE server listening on http://0.0.0.0:${port}`);
    console.log(`[mcp]   GET  /sse      — SSE endpoint (requires API key)`);
    console.log(`[mcp]   POST /message   — JSON-RPC message endpoint`);
    console.log(`[mcp]   GET  /health    — Health check`);
  });
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/** Extract API key from Authorization header, X-Api-Key header, or ?key= query param. */
function extractApiKey(
  req: import("node:http").IncomingMessage,
  url: URL,
): string | undefined {
  // Authorization: Bearer <key>
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // X-Api-Key header
  const xApiKey = req.headers["x-api-key"];
  if (typeof xApiKey === "string" && xApiKey.length > 0) {
    return xApiKey;
  }

  // Query parameter ?key=<key> (for SSE connections that can't set headers)
  const queryKey = url.searchParams.get("key");
  if (queryKey) {
    return queryKey;
  }

  return undefined;
}

main().catch((err) => {
  console.error("Fatal error starting kounta-mcp:", err);
  process.exit(1);
});

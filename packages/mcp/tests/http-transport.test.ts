// ---------------------------------------------------------------------------
// @kounta/mcp HTTP/SSE transport integration tests
//
// Starts the MCP HTTP server, authenticates with an API key, connects via
// SSE, and verifies that tool calls work end-to-end over the network.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { SqliteDatabase, LedgerEngine } from "@kounta/core";
import type { Database } from "@kounta/core";
import { createMcpServer } from "../src/server.js";
import { initDatabase } from "../src/lib/db.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let db: Database;
let engine: LedgerEngine;
let systemUserId: string;
let httpServer: HttpServer;
let serverPort: number;
let testApiKey: string;

// Track active SSE sessions
const sessions = new Map<string, InstanceType<typeof SSEServerTransport>>();

beforeAll(async () => {
  // Boot in-memory SQLite for testing
  const init = await initDatabase();
  db = init.db;
  engine = init.engine;
  systemUserId = init.systemUserId;

  // Create a user and ledger so we can issue an API key
  const userId = "00000000-0000-7000-8000-000000000001";
  await db.run(
    "INSERT INTO users (id, email, name, auth_provider, auth_provider_id) VALUES (?, ?, ?, ?, ?)",
    [userId, "test@example.com", "Test User", "test", "test-1"],
  );

  // Create a ledger
  const ledgerId = "00000000-0000-7000-8000-000000000002";
  await db.run(
    "INSERT INTO ledgers (id, owner_id, name, currency, fiscal_year_start, accounting_basis) VALUES (?, ?, ?, ?, ?, ?)",
    [ledgerId, userId, "Test Ledger", "USD", 1, "accrual"],
  );

  // Create an API key
  const crypto = await import("node:crypto");
  testApiKey = "kounta_live_httptest1234567890abcdef";
  const keyHash = crypto.createHash("sha256").update(testApiKey).digest("hex");
  const keyId = "00000000-0000-7000-8000-000000000003";
  await db.run(
    "INSERT INTO api_keys (id, user_id, ledger_id, key_hash, prefix, name, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [keyId, userId, ledgerId, keyHash, "ledge_li", "Test Key", "active"],
  );

  // Start HTTP server (same logic as index.ts HTTP mode, simplified for testing)
  httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", transport: "sse", sessions: sessions.size }));
      return;
    }

    if (url.pathname === "/sse" && req.method === "GET") {
      // Extract API key
      const authHeader = req.headers["authorization"];
      const apiKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

      if (!apiKey) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Missing API key" } }));
        return;
      }

      const authResult = await engine.validateApiKey(apiKey);
      if (!authResult.ok) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Invalid API key" } }));
        return;
      }

      const keyInfo = authResult.value;
      const server = createMcpServer(engine, keyInfo.userId, db);
      const sseTransport = new SSEServerTransport("/message", res);

      sessions.set(sseTransport.sessionId, sseTransport);
      sseTransport.onclose = () => sessions.delete(sseTransport.sessionId);

      await server.connect(sseTransport);
      // Note: server.connect() calls sseTransport.start() internally
      return;
    }

    if (url.pathname === "/message" && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "BAD_REQUEST", message: "Missing sessionId" } }));
        return;
      }

      const sseTransport = sessions.get(sessionId);
      if (!sseTransport) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Session not found" } }));
        return;
      }

      await sseTransport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
  });

  // Listen on a random port
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const addr = httpServer.address();
      serverPort = typeof addr === "object" && addr ? addr.port : 0;
      resolve();
    });
  });
});

afterAll(async () => {
  // Close all sessions
  for (const transport of sessions.values()) {
    await transport.close();
  }
  sessions.clear();

  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });

  await db.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HTTP/SSE transport", () => {
  it("returns 200 on health check", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.transport).toBe("sse");
  });

  it("rejects SSE connection without API key", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/sse`);
    expect(res.status).toBe(401);
  });

  it("rejects SSE connection with invalid API key", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/sse`, {
      headers: { Authorization: "Bearer kounta_live_invalidkey000000000000" },
    });
    expect(res.status).toBe(401);
  });

  it("connects via SSE and lists tools", async () => {
    const sseUrl = new URL(`http://127.0.0.1:${serverPort}/sse`);
    const transport = new SSEClientTransport(sseUrl, {
      requestInit: {
        headers: { Authorization: `Bearer ${testApiKey}` },
      },
    });

    const client = new Client({ name: "http-test-client", version: "1.0.0" });
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools.length).toBe(63);

    const toolNames = tools.map((t) => t.name).sort();
    expect(toolNames).toContain("setup_ledger");
    expect(toolNames).toContain("post_transaction");
    expect(toolNames).toContain("get_statement");

    await client.close();
  });

  it("calls a tool over SSE and gets a response", async () => {
    const sseUrl = new URL(`http://127.0.0.1:${serverPort}/sse`);
    const transport = new SSEClientTransport(sseUrl, {
      requestInit: {
        headers: { Authorization: `Bearer ${testApiKey}` },
      },
    });

    const client = new Client({ name: "http-test-client-2", version: "1.0.0" });
    await client.connect(transport);

    // Call setup_ledger which doesn't require a pre-existing ledger
    const result = await client.callTool({
      name: "setup_ledger",
      arguments: {
        description: "SaaS subscription business with recurring monthly billing",
      },
    });

    expect(result.isError).toBeFalsy();
    const first = result.content[0] as { type: string; text: string };
    const data = JSON.parse(first.text);
    expect(data.status).toBe("complete");
    expect(data.ledger.id).toBeDefined();
    expect(data.template.slug).toBe("saas");

    await client.close();
  });

  it("returns 404 for POST /message with missing sessionId", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for POST /message with unknown sessionId", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/message?sessionId=nonexistent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/nonexistent`);
    expect(res.status).toBe(404);
  });
});

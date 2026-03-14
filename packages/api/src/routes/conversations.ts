// ---------------------------------------------------------------------------
// Conversation routes — /v1/ledgers/:ledgerId/conversations
//
// CRUD for AI assistant conversations. All routes require API key auth.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { errorResponse, success, created, paginated } from "../lib/responses.js";
import type { ConversationMessage } from "@kounta/core";

export const conversationRoutes = new Hono<Env>();

conversationRoutes.use("/*", apiKeyAuth);

// ---------------------------------------------------------------------------
// GET / — list conversations for the authenticated user + ledger
// ---------------------------------------------------------------------------

conversationRoutes.get("/", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId")!;
  const userId = c.get("apiKeyInfo")!.userId;
  const cursor = c.req.query("cursor") ?? undefined;
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined;

  const result = await engine.listConversations(userId, ledgerId, { cursor, limit });
  if (!result.ok) return errorResponse(c, result.error);
  return paginated(c, result.value.data, result.value.nextCursor);
});

// ---------------------------------------------------------------------------
// POST / — create a new conversation
// ---------------------------------------------------------------------------

conversationRoutes.post("/", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId")!;
  const userId = c.get("apiKeyInfo")!.userId;
  const body = await c.req.json<{ title?: string }>();

  const result = await engine.createConversation(userId, ledgerId, body.title);
  if (!result.ok) return errorResponse(c, result.error);
  return created(c, result.value);
});

// ---------------------------------------------------------------------------
// GET /:id — get a conversation with messages
// ---------------------------------------------------------------------------

conversationRoutes.get("/:id", async (c) => {
  const engine = c.get("engine");
  const conversationId = c.req.param("id")!;

  const result = await engine.getConversation(conversationId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// PUT /:id — update conversation messages
// ---------------------------------------------------------------------------

conversationRoutes.put("/:id", async (c) => {
  const engine = c.get("engine");
  const conversationId = c.req.param("id")!;
  const body = await c.req.json<{ messages: ConversationMessage[]; title?: string }>();

  if (!body.messages || !Array.isArray(body.messages)) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "'messages' array is required",
          requestId: c.get("requestId"),
        },
      },
      400,
    );
  }

  const result = await engine.updateConversationMessages(conversationId, body.messages, body.title);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// DELETE /:id — delete a conversation
// ---------------------------------------------------------------------------

conversationRoutes.delete("/:id", async (c) => {
  const engine = c.get("engine");
  const conversationId = c.req.param("id")!;

  const result = await engine.deleteConversation(conversationId);
  if (!result.ok) return errorResponse(c, result.error);
  return c.json({ ok: true }, 200);
});

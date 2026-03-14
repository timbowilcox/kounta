// ---------------------------------------------------------------------------
// Template routes — /v1/templates
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { adminAuth } from "../middleware/auth.js";
import { errorResponse, success } from "../lib/responses.js";
import { getTemplates, getTemplate, recommendTemplate } from "@kounta/core";

export const templateRoutes = new Hono<Env>();

/** GET /v1/templates — List all available templates (no auth required) */
templateRoutes.get("/", (c) => {
  return success(c, getTemplates());
});

/** GET /v1/templates/:idOrSlug — Get a single template by ID or slug */
templateRoutes.get("/:idOrSlug", (c) => {
  const idOrSlug = c.req.param("idOrSlug")!;
  const template = getTemplate(idOrSlug);
  if (!template) {
    return c.json(
      {
        error: {
          code: "TEMPLATE_NOT_FOUND",
          message: `Template not found: ${idOrSlug}`,
          details: [
            {
              field: "idOrSlug",
              actual: idOrSlug,
              suggestion:
                "Use GET /v1/templates to list all available templates. Valid slugs: saas, ecommerce, marketplace, agency, freelancer, nonprofit, manufacturing, retail.",
            },
          ],
          requestId: c.get("requestId"),
        },
      },
      404,
    );
  }
  return success(c, template);
});

/** POST /v1/templates/recommend — Recommend templates from business context */
templateRoutes.post("/recommend", async (c) => {
  const body = await c.req.json();
  const recommendations = recommendTemplate({
    industry: body.industry,
    description: body.description,
    businessModel: body.businessModel,
  });
  return success(c, recommendations);
});

/** POST /v1/templates/apply — Apply a template to a ledger (admin auth) */
templateRoutes.post("/apply", adminAuth, async (c) => {
  const engine = c.get("engine");
  const body = await c.req.json();

  if (!body.ledgerId || !body.templateSlug) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "ledgerId and templateSlug are required",
          details: [
            {
              field: "body",
              suggestion:
                'Provide { "ledgerId": "<uuid>", "templateSlug": "<slug>" }. Use GET /v1/templates to see valid slugs.',
            },
          ],
          requestId: c.get("requestId"),
        },
      },
      400,
    );
  }

  const result = await engine.applyTemplate(body.ledgerId, body.templateSlug);
  if (!result.ok) {
    return errorResponse(c, result.error);
  }

  return success(c, { accounts: result.value, count: result.value.length });
});

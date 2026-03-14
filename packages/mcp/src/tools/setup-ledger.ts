// ---------------------------------------------------------------------------
// setup_ledger + complete_setup tools
//
// setup_ledger accepts a natural language business description, scores it
// against built-in templates, and either auto-provisions a ledger (high
// confidence) or returns gap-filling questions (low confidence).
//
// complete_setup lets the user finalize when manual selection was needed.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type LedgerEngine,
  getTemplates,
  getTemplate,
  recommendTemplate,
} from "@kounta/core";
import { toolOk, toolErr, handleResult } from "../lib/helpers.js";

const HIGH_CONFIDENCE_THRESHOLD = 6;

export function registerSetupTools(
  server: McpServer,
  engine: LedgerEngine,
  systemUserId: string,
): void {
  // -----------------------------------------------------------------------
  // setup_ledger
  // -----------------------------------------------------------------------
  server.tool(
    "setup_ledger",
    "Accept a natural language business description and return a fully configured ledger, or return gap-filling questions if context is insufficient.",
    { description: z.string().describe("Describe the business in plain English") },
    async ({ description }) => {
      const recommendations = recommendTemplate({
        description,
        industry: description,
        businessModel: description,
      });

      const top = recommendations[0];

      // High confidence — auto-provision
      if (top && top.score >= HIGH_CONFIDENCE_THRESHOLD) {
        const template = top.template;

        // Create ledger
        const ledgerResult = await engine.createLedger({
          name: `${template.name} Ledger`,
          currency: template.defaultCurrency,
          accountingBasis: template.defaultBasis,
          ownerId: systemUserId,
          businessContext: { description, autoSetup: true },
        });

        if (!ledgerResult.ok) return handleResult(ledgerResult);

        // Apply template
        const accountsResult = await engine.applyTemplate(
          ledgerResult.value.id,
          template.slug,
        );
        if (!accountsResult.ok) return handleResult(accountsResult);

        return toolOk({
          status: "complete",
          ledger: ledgerResult.value,
          template: {
            slug: template.slug,
            name: template.name,
            description: template.description,
          },
          accounts: accountsResult.value,
          confidence: top.score,
        });
      }

      // Partial match — return recommendations + questions
      if (top && top.score > 0) {
        return toolOk({
          status: "needs_input",
          recommendations: recommendations.slice(0, 3).map((r) => ({
            templateSlug: r.template.slug,
            name: r.template.name,
            description: r.template.description,
            score: r.score,
            reason: r.reason,
          })),
          questions: [
            "Which template best fits your business?",
            "What is your primary currency?",
            "Do you use accrual or cash-basis accounting?",
          ],
          hint: "Call complete_setup with your chosen templateSlug to finish.",
        });
      }

      // No match — return all templates
      const allTemplates = getTemplates().map((t) => ({
        slug: t.slug,
        name: t.name,
        description: t.description,
        businessType: t.businessType,
      }));

      return toolOk({
        status: "needs_input",
        recommendations: [],
        availableTemplates: allTemplates,
        questions: [
          "None of the templates matched well. Which template is closest to your business?",
          "Or, describe your business in more detail so I can re-evaluate.",
        ],
        hint: "Call complete_setup with your chosen templateSlug to finish.",
      });
    },
  );

  // -----------------------------------------------------------------------
  // complete_setup
  // -----------------------------------------------------------------------
  server.tool(
    "complete_setup",
    "Finalize ledger setup with a specific template after reviewing recommendations.",
    {
      templateSlug: z.string().describe("Template slug to apply"),
      name: z.string().optional().describe("Ledger display name"),
      currency: z.string().optional().describe("ISO currency code (default USD)"),
      description: z.string().optional().describe("Business description"),
    },
    async ({ templateSlug, name, currency, description }) => {
      const template = getTemplate(templateSlug);
      if (!template) {
        return toolErr({
          code: "TEMPLATE_NOT_FOUND",
          message: `Template "${templateSlug}" not found`,
        });
      }

      const ledgerResult = await engine.createLedger({
        name: name ?? `${template.name} Ledger`,
        currency: currency ?? template.defaultCurrency,
        accountingBasis: template.defaultBasis,
        ownerId: systemUserId,
        businessContext: description ? { description } : undefined,
      });

      if (!ledgerResult.ok) return handleResult(ledgerResult);

      const accountsResult = await engine.applyTemplate(
        ledgerResult.value.id,
        template.slug,
      );
      if (!accountsResult.ok) return handleResult(accountsResult);

      return toolOk({
        status: "complete",
        ledger: ledgerResult.value,
        template: {
          slug: template.slug,
          name: template.name,
          description: template.description,
        },
        accounts: accountsResult.value,
      });
    },
  );
}

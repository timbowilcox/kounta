// ---------------------------------------------------------------------------
// Jurisdiction routes — /v1/jurisdictions
//
// Public reference endpoints for supported jurisdictions and their configs.
// No auth required — these are read-only reference data.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { JURISDICTION_CONFIGS, getJurisdictionConfig } from "@kounta/core";
import type { Env } from "../lib/context.js";

export const jurisdictionRoutes = new Hono<Env>();

// ---------------------------------------------------------------------------
// GET / — list all supported jurisdictions
// ---------------------------------------------------------------------------

jurisdictionRoutes.get("/", (c) => {
  const jurisdictions = Object.entries(JURISDICTION_CONFIGS).map(([code, config]) => ({
    code,
    name: config.name,
    currency: config.currency,
    currencySymbol: config.currencySymbol,
    taxAuthority: config.taxAuthority,
    vatName: config.vatName,
    vatRate: config.vatRate,
    taxIdLabel: config.taxIdLabel,
    defaultDepreciationMethod: config.defaultDepreciationMethod,
    capitalisationThreshold: config.capitalisationThreshold,
  }));
  return c.json({ data: jurisdictions });
});

// ---------------------------------------------------------------------------
// GET /:code — get a specific jurisdiction config
// ---------------------------------------------------------------------------

jurisdictionRoutes.get("/:code", (c) => {
  const code = c.req.param("code").toUpperCase();
  const config = getJurisdictionConfig(code);
  return c.json({ data: { code, ...config } });
});

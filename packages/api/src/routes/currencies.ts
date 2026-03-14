// ---------------------------------------------------------------------------
// Currency routes — /v1/ledgers/:ledgerId/currencies
//
// All routes require API key auth. Multi-currency management: enable
// currencies, set exchange rates, convert amounts, and revalue accounts.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { Env } from "../lib/context.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { errorResponse, success, created, paginated } from "../lib/responses.js";
import type { ExchangeRateSource } from "@kounta/core";

export const currencyRoutes = new Hono<Env>();

currencyRoutes.use("/*", apiKeyAuth);

// ---------------------------------------------------------------------------
// GET /currencies — list enabled currencies
// ---------------------------------------------------------------------------

currencyRoutes.get("/", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId")!;

  const result = await engine.listEnabledCurrencies(ledgerId);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /currencies — enable a currency
// ---------------------------------------------------------------------------

currencyRoutes.post("/", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId")!;
  const body = await c.req.json<{ currencyCode: string; decimalPlaces?: number; symbol?: string }>();

  if (!body.currencyCode) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "'currencyCode' is required",
          requestId: c.get("requestId"),
        },
      },
      400
    );
  }

  const result = await engine.enableCurrency(
    ledgerId,
    body.currencyCode,
    body.decimalPlaces,
    body.symbol,
  );
  if (!result.ok) return errorResponse(c, result.error);
  return created(c, result.value);
});

// ---------------------------------------------------------------------------
// GET /exchange-rates — list exchange rates
// ---------------------------------------------------------------------------

currencyRoutes.get("/exchange-rates", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId")!;

  const fromCurrency = c.req.query("fromCurrency");
  const toCurrency = c.req.query("toCurrency");
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined;
  const cursor = c.req.query("cursor");

  const result = await engine.listExchangeRates(ledgerId, {
    fromCurrency: fromCurrency ?? undefined,
    toCurrency: toCurrency ?? undefined,
    limit,
    cursor: cursor ?? undefined,
  });

  if (!result.ok) return errorResponse(c, result.error);
  return paginated(c, result.value.rates, result.value.nextCursor);
});

// ---------------------------------------------------------------------------
// POST /exchange-rates — set an exchange rate
// ---------------------------------------------------------------------------

currencyRoutes.post("/exchange-rates", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId")!;
  const body = await c.req.json<{
    fromCurrency: string;
    toCurrency: string;
    rate: number;
    effectiveDate: string;
    source?: ExchangeRateSource;
  }>();

  if (!body.fromCurrency || !body.toCurrency || !body.rate || !body.effectiveDate) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "'fromCurrency', 'toCurrency', 'rate', and 'effectiveDate' are required",
          requestId: c.get("requestId"),
        },
      },
      400
    );
  }

  const result = await engine.setExchangeRate(
    ledgerId,
    body.fromCurrency,
    body.toCurrency,
    body.rate,
    body.effectiveDate,
    body.source ?? "manual",
  );
  if (!result.ok) return errorResponse(c, result.error);
  return created(c, result.value);
});

// ---------------------------------------------------------------------------
// GET /exchange-rates/convert — convert an amount
// ---------------------------------------------------------------------------

currencyRoutes.get("/exchange-rates/convert", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId")!;

  const fromCurrency = c.req.query("fromCurrency");
  const toCurrency = c.req.query("toCurrency");
  const amount = c.req.query("amount") ? parseInt(c.req.query("amount")!, 10) : undefined;
  const date = c.req.query("date");

  if (!fromCurrency || !toCurrency || !amount) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "'fromCurrency', 'toCurrency', and 'amount' query parameters are required",
          requestId: c.get("requestId"),
        },
      },
      400
    );
  }

  const result = await engine.convertAmount(ledgerId, fromCurrency, toCurrency, amount, date ?? undefined);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, result.value);
});

// ---------------------------------------------------------------------------
// POST /revalue — trigger FX revaluation
// ---------------------------------------------------------------------------

currencyRoutes.post("/revalue", async (c) => {
  const engine = c.get("engine");
  const ledgerId = c.req.param("ledgerId")!;
  const body = await c.req.json<{ date: string }>();

  if (!body.date) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "'date' is required",
          requestId: c.get("requestId"),
        },
      },
      400
    );
  }

  const result = await engine.revalueAccounts(ledgerId, body.date);
  if (!result.ok) return errorResponse(c, result.error);
  return success(c, { revaluations: result.value });
});

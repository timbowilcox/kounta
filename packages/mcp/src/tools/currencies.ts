// ---------------------------------------------------------------------------
// Currency MCP tools — enable currencies, manage exchange rates, convert.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerEngine } from "@kounta/core";
import { handleResult } from "../lib/helpers.js";

export function registerCurrencyTools(
  server: McpServer,
  engine: LedgerEngine,
  _systemUserId: string,
): void {
  // -----------------------------------------------------------------------
  // enable_currency
  // -----------------------------------------------------------------------
  server.tool(
    "enable_currency",
    "Enable a currency on a ledger for multi-currency transactions. The ledger's base currency is enabled automatically.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      currencyCode: z.string().length(3).describe("ISO 4217 currency code (e.g. EUR, GBP, JPY)"),
      decimalPlaces: z.number().int().min(0).max(4).optional().describe("Decimal places (auto-detected if omitted)"),
      symbol: z.string().optional().describe("Currency symbol (defaults to currency code)"),
    },
    async ({ ledgerId, currencyCode, decimalPlaces, symbol }) => {
      const result = await engine.enableCurrency(ledgerId, currencyCode, decimalPlaces, symbol);
      return handleResult(result);
    },
  );

  // -----------------------------------------------------------------------
  // set_exchange_rate
  // -----------------------------------------------------------------------
  server.tool(
    "set_exchange_rate",
    "Set an exchange rate between two currencies for a specific date. Rates are stored as integers with 1,000,000 precision (e.g. 1.085 = 1085000).",
    {
      ledgerId: z.string().describe("Ledger ID"),
      fromCurrency: z.string().length(3).describe("Source currency code"),
      toCurrency: z.string().length(3).describe("Target currency code"),
      rate: z.number().int().positive().describe("Exchange rate × 1,000,000 (e.g. 1.085 = 1085000)"),
      effectiveDate: z.string().describe("Date the rate is effective (YYYY-MM-DD)"),
      source: z.enum(["manual", "api", "import"]).optional().describe("Rate source (default: manual)"),
    },
    async ({ ledgerId, fromCurrency, toCurrency, rate, effectiveDate, source }) => {
      const result = await engine.setExchangeRate(ledgerId, fromCurrency, toCurrency, rate, effectiveDate, source ?? "manual");
      return handleResult(result);
    },
  );

  // -----------------------------------------------------------------------
  // list_exchange_rates
  // -----------------------------------------------------------------------
  server.tool(
    "list_exchange_rates",
    "List exchange rates for a ledger, optionally filtered by currency pair.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      fromCurrency: z.string().length(3).optional().describe("Filter by source currency"),
      toCurrency: z.string().length(3).optional().describe("Filter by target currency"),
      limit: z.number().int().min(1).max(200).optional().describe("Max results (default 50)"),
    },
    async ({ ledgerId, fromCurrency, toCurrency, limit }) => {
      const result = await engine.listExchangeRates(ledgerId, { fromCurrency, toCurrency, limit });
      return handleResult(result);
    },
  );

  // -----------------------------------------------------------------------
  // convert_amount
  // -----------------------------------------------------------------------
  server.tool(
    "convert_amount",
    "Convert an amount from one currency to another using stored exchange rates.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      fromCurrency: z.string().length(3).describe("Source currency code"),
      toCurrency: z.string().length(3).describe("Target currency code"),
      amount: z.number().int().positive().describe("Amount in smallest unit of source currency"),
      date: z.string().optional().describe("Rate date (YYYY-MM-DD, defaults to today)"),
    },
    async ({ ledgerId, fromCurrency, toCurrency, amount, date }) => {
      const result = await engine.convertAmount(ledgerId, fromCurrency, toCurrency, amount, date);
      return handleResult(result);
    },
  );

  // -----------------------------------------------------------------------
  // revalue_accounts
  // -----------------------------------------------------------------------
  server.tool(
    "revalue_accounts",
    "Revalue foreign-currency accounts at current exchange rates and post FX gain/loss adjustments.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      date: z.string().describe("Revaluation date (YYYY-MM-DD)"),
    },
    async ({ ledgerId, date }) => {
      const result = await engine.revalueAccounts(ledgerId, date);
      return handleResult(result);
    },
  );
}

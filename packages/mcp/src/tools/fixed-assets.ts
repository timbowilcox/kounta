// ---------------------------------------------------------------------------
// Fixed Asset MCP tools — capitalisation check, asset CRUD, depreciation
// scheduling, processing, disposal, and summary.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LedgerEngine, Database } from "@kounta/core";
import {
  adviseOnCapitalisation,
  createFixedAsset,
  listFixedAssets,
  getAssetSchedule,
  getPendingDepreciation,
  runDepreciation,
  getAssetSummary,
  disposeFixedAsset,
} from "@kounta/core";
import type { DepreciationMethod } from "@kounta/core";
import { toolOk, toolErr } from "../lib/helpers.js";

export function registerFixedAssetTools(
  server: McpServer,
  engine: LedgerEngine,
  db: Database,
): void {
  // -----------------------------------------------------------------------
  // check_capitalisation
  // -----------------------------------------------------------------------
  server.tool(
    "check_capitalisation",
    "Check whether a transaction amount should be capitalised as a fixed asset or expensed immediately. Takes into account jurisdiction-specific rules including the Australian instant asset write-off scheme, US Section 179, UK Annual Investment Allowance, and capitalisation thresholds. Always call this before recording an asset purchase to determine the correct accounting treatment.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      amountCents: z.number().int().positive().describe("Purchase amount in cents"),
      assetType: z.string().describe("Type of asset (laptop, motor_vehicle_car, office_furniture, etc.)"),
      purchaseDate: z.string().describe("ISO date of purchase (YYYY-MM-DD)"),
      annualTurnoverCents: z.number().int().optional().describe("Business annual turnover in cents (needed for AU instant write-off eligibility)"),
    },
    async ({ ledgerId, amountCents, assetType, purchaseDate, annualTurnoverCents }) => {
      try {
        const ledger = await db.get<{ jurisdiction: string }>(
          "SELECT jurisdiction FROM ledgers WHERE id = ?",
          [ledgerId],
        );
        const jurisdiction = ledger?.jurisdiction ?? "AU";
        const purchaseYear = new Date(purchaseDate).getUTCFullYear();

        const advice = adviseOnCapitalisation(
          amountCents, jurisdiction, annualTurnoverCents ?? null, purchaseYear, assetType,
        );

        return toolOk({ ...advice, jurisdiction });
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // create_fixed_asset
  // -----------------------------------------------------------------------
  server.tool(
    "create_fixed_asset",
    "Register a new fixed asset and automatically generate its full depreciation schedule. Use after check_capitalisation confirms the asset should be capitalised. The system will look up the correct depreciation rate and useful life from jurisdiction rules (e.g. ATO effective life table for Australian assets) if asset_type is provided. Common asset types: laptop, desktop_computer, mobile_phone, tablet, server, office_furniture, motor_vehicle_car, commercial_vehicle, manufacturing_equipment, office_equipment, software.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      name: z.string().describe("Descriptive name (e.g. 'MacBook Pro 14\"')"),
      assetType: z.string().describe("Category for effective life lookup"),
      costCents: z.number().int().positive().describe("Purchase cost in cents"),
      purchaseDate: z.string().describe("ISO date of purchase (YYYY-MM-DD)"),
      depreciationMethod: z.string().optional().describe("Method (defaults to jurisdiction standard). Options: straight_line, diminishing_value, prime_cost, macrs, instant_writeoff, etc."),
      usefulLifeMonths: z.number().int().positive().optional().describe("Override jurisdiction default if provided"),
      salvageValueCents: z.number().int().optional().describe("Residual value in cents (default 0)"),
      assetAccountId: z.string().describe("Account ID for the asset (e.g. Computer Equipment)"),
      accumulatedDepreciationAccountId: z.string().optional().describe("Contra-asset account for accumulated depreciation"),
      depreciationExpenseAccountId: z.string().optional().describe("Expense account for depreciation"),
      description: z.string().optional().describe("Additional description"),
    },
    async (params) => {
      try {
        const result = await createFixedAsset(db, {
          ledgerId: params.ledgerId,
          name: params.name,
          assetType: params.assetType,
          costAmount: params.costCents,
          purchaseDate: params.purchaseDate,
          depreciationMethod: params.depreciationMethod as DepreciationMethod | undefined,
          usefulLifeMonths: params.usefulLifeMonths,
          salvageValue: params.salvageValueCents,
          assetAccountId: params.assetAccountId,
          accumulatedDepreciationAccountId: params.accumulatedDepreciationAccountId,
          depreciationExpenseAccountId: params.depreciationExpenseAccountId,
          description: params.description,
        });

        if (!result.ok) return toolErr({ code: result.error.code, message: result.error.message, details: result.error.details ?? [] });

        // Return asset with first 12 schedule periods
        const asset = result.value;
        const preview = asset.schedule.slice(0, 12);
        return toolOk({
          ...asset,
          schedule: preview,
          scheduleTotal: asset.schedule.length,
          scheduleSummary: `${asset.schedule.length} periods, last period: ${asset.schedule[asset.schedule.length - 1]?.periodDate ?? "N/A"}`,
        });
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // list_fixed_assets
  // -----------------------------------------------------------------------
  server.tool(
    "list_fixed_assets",
    "List all fixed assets in the ledger with their current net book value, depreciation status, and next scheduled depreciation date. Use this to get an overview of the asset register or to find a specific asset's ID for other operations.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      status: z.enum(["active", "disposed", "fully_depreciated", "all"]).optional().describe("Filter by status (default: active)"),
    },
    async ({ ledgerId, status }) => {
      try {
        const result = await listFixedAssets(db, ledgerId, { status: status ?? "active" });
        return toolOk(result);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // get_depreciation_schedule
  // -----------------------------------------------------------------------
  server.tool(
    "get_depreciation_schedule",
    "Get the full depreciation schedule for a specific fixed asset showing all periods with amounts, accumulated depreciation, and net book value. Shows which periods have been posted as journal entries and which are upcoming.",
    {
      assetId: z.string().describe("Fixed asset ID"),
    },
    async ({ assetId }) => {
      try {
        const result = await getAssetSchedule(db, assetId);
        if (!result.ok) return toolErr({ code: result.error.code, message: result.error.message, details: [] });
        return toolOk(result.value);
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // get_depreciation_due
  // -----------------------------------------------------------------------
  server.tool(
    "get_depreciation_due",
    "Get all depreciation journal entries that are due to be posted but haven't been yet (period date is today or in the past). Use this at month end or when asked about pending depreciation to see what needs to be posted to keep the books current.",
    {
      ledgerId: z.string().describe("Ledger ID"),
    },
    async ({ ledgerId }) => {
      try {
        const result = await getPendingDepreciation(db, ledgerId);

        const ledger = await db.get<{ currency: string; jurisdiction: string }>(
          "SELECT currency, jurisdiction FROM ledgers WHERE id = ?",
          [ledgerId],
        );

        return toolOk({
          ...result,
          currency: ledger?.currency ?? "AUD",
          summary: result.pendingCount > 0
            ? `${result.pendingCount} entries totalling $${(result.totalAmount / 100).toFixed(2)} pending`
            : "No pending depreciation entries",
        });
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // run_depreciation
  // -----------------------------------------------------------------------
  server.tool(
    "run_depreciation",
    "Post all pending depreciation journal entries up to today for all active assets in this ledger. Each entry debits Depreciation Expense and credits Accumulated Depreciation. Run this at month end to ensure the P&L and balance sheet reflect current asset values. Safe to run multiple times — will not duplicate entries.",
    {
      ledgerId: z.string().describe("Ledger ID"),
    },
    async ({ ledgerId }) => {
      try {
        const result = await runDepreciation(db, engine, ledgerId);
        return toolOk({
          ...result,
          message: result.posted > 0
            ? `Posted ${result.posted} depreciation entries totalling $${(result.totalAmount / 100).toFixed(2)} across ${result.assetsAffected} assets.`
            : "No pending depreciation entries to post.",
        });
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // get_asset_register_summary
  // -----------------------------------------------------------------------
  server.tool(
    "get_asset_register_summary",
    "Get a concise summary of the fixed asset register suitable for financial reporting or a morning brief. Shows total asset cost, net book value, accumulated depreciation, depreciation posted this financial year, and any pending entries requiring attention.",
    {
      ledgerId: z.string().describe("Ledger ID"),
    },
    async ({ ledgerId }) => {
      try {
        const summary = await getAssetSummary(db, ledgerId);

        const ledger = await db.get<{ currency: string; jurisdiction: string }>(
          "SELECT currency, jurisdiction FROM ledgers WHERE id = ?",
          [ledgerId],
        );

        const narrative = summary.totalAssets === 0
          ? "No fixed assets registered."
          : `You have ${summary.assetsByStatus.active} active asset${summary.assetsByStatus.active !== 1 ? "s" : ""} ` +
            `with total NBV of $${(summary.totalNbv / 100).toFixed(2)}. ` +
            (summary.pendingEntries > 0
              ? `${summary.pendingEntries} depreciation entries totalling $${(summary.pendingAmount / 100).toFixed(2)} are pending.`
              : "All depreciation entries are up to date.");

        return toolOk({
          ...summary,
          jurisdiction: ledger?.jurisdiction ?? "AU",
          currency: ledger?.currency ?? "AUD",
          narrative,
        });
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // dispose_fixed_asset
  // -----------------------------------------------------------------------
  server.tool(
    "dispose_fixed_asset",
    "Record the disposal of a fixed asset — either a sale, write-off, or other disposal. Automatically calculates gain or loss on disposal, posts the required journal entries, and cancels all future depreciation entries. For Australian assets, flags if a CGT event has occurred and whether the 50% CGT discount may apply.",
    {
      assetId: z.string().describe("Fixed asset ID to dispose"),
      disposalDate: z.string().describe("ISO date of disposal (YYYY-MM-DD)"),
      disposalProceedsCents: z.number().int().describe("Sale proceeds in cents (0 if written off)"),
      proceedsAccountId: z.string().optional().describe("Bank/cash account ID for proceeds (required if proceeds > 0)"),
      gainAccountId: z.string().optional().describe("Account ID for recording gain on disposal"),
      lossAccountId: z.string().optional().describe("Account ID for recording loss on disposal"),
      notes: z.string().optional().describe("Additional notes about the disposal"),
    },
    async (params) => {
      try {
        const result = await disposeFixedAsset(db, engine, params.assetId, {
          disposalDate: params.disposalDate,
          disposalProceeds: params.disposalProceedsCents,
          proceedsAccountId: params.proceedsAccountId,
          gainAccountId: params.gainAccountId,
          lossAccountId: params.lossAccountId,
          notes: params.notes,
        });

        if (!result.ok) return toolErr({ code: result.error.code, message: result.error.message, details: [] });

        return toolOk({
          ...result.value,
          message: `Disposed ${result.value.assetName}. ${result.value.gainOrLoss === "gain"
            ? `Gain of $${(result.value.gainLoss / 100).toFixed(2)}`
            : result.value.gainOrLoss === "loss"
              ? `Loss of $${(Math.abs(result.value.gainLoss) / 100).toFixed(2)}`
              : "No gain or loss"}.${result.value.cgtNote ? ` ${result.value.cgtNote}` : ""}`,
        });
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );
}

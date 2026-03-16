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
  updateFixedAsset,
  getJurisdictionConfig,
  getFinancialYearLabel,
} from "@kounta/core";
import type { DepreciationMethod } from "@kounta/core";
import { toolOk, toolErr } from "../lib/helpers.js";
import { mcpCheckLimit, getLedgerOwner } from "../lib/tier-check.js";

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
        // Tier limit check
        const ownerId = await getLedgerOwner(db, params.ledgerId);
        if (ownerId) {
          const limitErr = await mcpCheckLimit(db, ownerId, params.ledgerId, "fixed_assets");
          if (limitErr) return limitErr;
        }

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

  // -----------------------------------------------------------------------
  // update_fixed_asset
  // -----------------------------------------------------------------------
  server.tool(
    "update_fixed_asset",
    "Update an existing fixed asset's details. Use this to correct the asset name, change the useful life, update the salvage value, adjust the depreciation method, or modify the description. If useful life or depreciation method changes, the depreciation schedule will be regenerated from the current period onwards — already-posted entries are preserved.",
    {
      assetId: z.string().describe("Fixed asset ID"),
      name: z.string().optional().describe("New asset name"),
      description: z.string().optional().describe("New description"),
      usefulLifeMonths: z.number().int().positive().optional().describe("New useful life in months"),
      salvageValueCents: z.number().int().optional().describe("New salvage value in cents"),
      depreciationMethod: z.string().optional().describe("New depreciation method (straight_line, diminishing_value, etc.)"),
      assetType: z.string().optional().describe("New asset type category"),
    },
    async (params) => {
      try {
        const result = await updateFixedAsset(db, params.assetId, {
          name: params.name,
          description: params.description,
          assetType: params.assetType,
          usefulLifeMonths: params.usefulLifeMonths,
          salvageValueCents: params.salvageValueCents,
          depreciationMethod: params.depreciationMethod as DepreciationMethod | undefined,
        });

        if (!result.ok) return toolErr({ code: result.error.code, message: result.error.message, details: result.error.details ?? [] });

        return toolOk({
          ...result.value,
          schedule: result.value.schedule.slice(0, 12),
          scheduleTotal: result.value.schedule.length,
          message: `Updated asset "${result.value.name}" successfully.`,
        });
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // update_jurisdiction
  // -----------------------------------------------------------------------
  server.tool(
    "update_jurisdiction",
    "Update the jurisdiction and tax settings for this ledger. Changes the tax jurisdiction (which affects depreciation methods, capitalisation thresholds, financial year dates, and tax rules), tax ID, and accounting basis. Use when a user asks to change their country, switch between cash and accrual accounting, or set their ABN/EIN/tax number. Available jurisdictions: AU (Australia), US (United States), UK (United Kingdom), NZ (New Zealand), CA (Canada), SG (Singapore), OTHER.",
    {
      ledgerId: z.string().describe("Ledger ID"),
      jurisdiction: z.string().optional().describe("Country code (AU, US, UK, NZ, CA, SG, OTHER)"),
      taxId: z.string().optional().describe("Tax identification number (ABN, EIN, UTR, etc.)"),
      taxBasis: z.enum(["cash", "accrual"]).optional().describe("Accounting basis"),
    },
    async ({ ledgerId, jurisdiction, taxId, taxBasis }) => {
      try {
        const sets: string[] = [];
        const params: unknown[] = [];

        if (jurisdiction !== undefined) { sets.push("jurisdiction = ?"); params.push(jurisdiction); }
        if (taxId !== undefined) { sets.push("tax_id = ?"); params.push(taxId); }
        if (taxBasis !== undefined) { sets.push("tax_basis = ?"); params.push(taxBasis); }

        if (sets.length === 0) {
          return toolErr({ code: "VALIDATION_ERROR", message: "No fields to update. Provide at least one of: jurisdiction, taxId, taxBasis.", details: [] });
        }

        sets.push("updated_at = ?");
        params.push(new Date().toISOString());
        params.push(ledgerId);

        await db.run(`UPDATE ledgers SET ${sets.join(", ")} WHERE id = ?`, params);

        // Read back updated state
        const row = await db.get<{ jurisdiction: string; tax_id: string | null; tax_basis: string; fiscal_year_start: number }>(
          "SELECT jurisdiction, tax_id, tax_basis, fiscal_year_start FROM ledgers WHERE id = ?",
          [ledgerId],
        );

        const jur = row?.jurisdiction ?? "AU";
        const config = getJurisdictionConfig(jur);
        const fyLabel = getFinancialYearLabel(new Date(), jur);

        return toolOk({
          jurisdiction: jur,
          jurisdictionName: config.name,
          taxId: row?.tax_id ?? null,
          taxBasis: row?.tax_basis ?? "accrual",
          financialYear: fyLabel,
          taxAuthority: config.taxAuthority,
          message: `Ledger updated to ${config.name} jurisdiction (${config.taxAuthority}, ${fyLabel}).`,
        });
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );

  // -----------------------------------------------------------------------
  // get_setup_guide
  // -----------------------------------------------------------------------
  server.tool(
    "get_setup_guide",
    "Get a jurisdiction-aware setup guide for fixed assets and depreciation. Returns step-by-step instructions tailored to the ledger's jurisdiction, including relevant tax rules, depreciation methods, and capitalisation thresholds.",
    {
      ledgerId: z.string().describe("Ledger ID"),
    },
    async ({ ledgerId }) => {
      try {
        const ledger = await db.get<{ jurisdiction: string }>(
          "SELECT jurisdiction FROM ledgers WHERE id = ?",
          [ledgerId],
        );
        const jur = ledger?.jurisdiction ?? "AU";
        const config = getJurisdictionConfig(jur);
        const fyLabel = getFinancialYearLabel(new Date(), jur);

        // Jurisdiction-specific guidance
        const jurisdictionGuidance: Record<string, string> = {
          AU: `Australian businesses use diminishing value depreciation by default (per ATO effective life rulings). The instant asset write-off scheme allows immediate deduction for assets under $20,000 for small businesses with turnover under $10M. Financial year runs 1 July to 30 June.`,
          US: `US businesses typically use MACRS depreciation. Section 179 allows immediate expensing up to $1.16M. Bonus depreciation at 60% is available for 2024. Financial year is calendar year.`,
          UK: `UK businesses use capital allowances (Writing Down Allowance at 18% main pool, 6% special pool). Annual Investment Allowance of £1M is available. Financial year runs 6 April to 5 April.`,
          NZ: `New Zealand uses diminishing value as the default method, with rates set by the IRD. Low-value assets under $1,000 can be expensed immediately. Financial year runs 1 April to 31 March.`,
          CA: `Canadian businesses use Capital Cost Allowance (CCA) classes with declining balance method. The Accelerated Investment Incentive allows higher first-year deductions. Financial year is calendar year.`,
          SG: `Singapore uses straight-line depreciation by default. Section 19A allows immediate write-off for assets under S$5,000. Financial year is calendar year.`,
        };

        const guidance = jurisdictionGuidance[jur] ?? `Straight-line depreciation is the default. Configure your specific depreciation method when registering assets.`;

        const steps = [
          `**Step 1: Set Your Jurisdiction**`,
          `Your ledger is currently set to ${config.name} (${config.taxAuthority}, ${fyLabel}). If this is incorrect, use update_jurisdiction to change it — this determines your financial year dates, depreciation methods, tax rules, and capitalisation thresholds.`,
          ``,
          `**Jurisdiction Notes (${config.name}):**`,
          guidance,
          ``,
          `**Step 2: Register Fixed Assets**`,
          `If your business has purchased equipment, computers, vehicles, or other capital items, register them as fixed assets:`,
          ``,
          `1. Use check_capitalisation to determine if a purchase should be capitalised or expensed immediately`,
          `2. Use create_fixed_asset to register capital purchases — the system will generate depreciation schedules automatically using your jurisdiction rules`,
          `3. Use run_depreciation monthly to post pending depreciation entries and keep your books current`,
          `4. Use get_asset_register_summary at any time to see your total asset position`,
          ``,
          `**Current Settings:**`,
          `- Jurisdiction: ${config.name}`,
          `- Tax Authority: ${config.taxAuthority}`,
          `- Financial Year: ${fyLabel}`,
          `- Default Depreciation: ${config.defaultDepreciationMethod}`,
          `- Capitalisation Threshold: $${(config.capitalisationThreshold / 100).toFixed(2)}`,
          `- Available Methods: ${config.depreciationMethods.join(", ")}`,
          ``,
          `**Step 3: Invoicing**`,
          `If you bill clients for services, products, or consulting, use Kounta's invoicing to track what's owed and what's been paid.`,
          ``,
          `1. Use create_invoice to draft an invoice with line items and pricing`,
          `2. Use send_invoice to approve it — this posts the accounting entry and optionally emails the PDF to your customer`,
          `3. When payment arrives (via bank feed or manually), use record_invoice_payment to close it out`,
          `4. Use get_ar_aging to see who owes you money and how overdue they are`,
        ];

        return toolOk({
          jurisdiction: jur,
          jurisdictionName: config.name,
          guide: steps.join("\n"),
        });
      } catch (e) {
        return toolErr({ code: "INTERNAL_ERROR", message: String(e), details: [] });
      }
    },
  );
}

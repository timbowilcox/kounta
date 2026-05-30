// ---------------------------------------------------------------------------
// Template system & financial statement tests
//
// Tests cover:
// 1. Template listing, lookup, and recommendation
// 2. Template application (creates accounts from template)
// 3. Income Statement (P&L) against known fixtures
// 4. Balance Sheet against known fixtures (Assets = Liabilities + Equity)
// 5. Cash Flow (indirect method) against known fixtures
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { SqliteDatabase } from "../src/db/sqlite.js";
import { LedgerEngine } from "../src/engine/index.js";
import { ErrorCode } from "../src/errors/index.js";
import {
  getTemplates,
  getTemplate,
  recommendTemplate,
  TEMPLATES,
} from "../src/templates/index.js";
import type { Database } from "../src/db/database.js";
import type { Ledger, StatementResponse } from "../src/types/index.js";
import { createFullTestDb } from "./helpers/migrate.js";

// ---------------------------------------------------------------------------
// Test helpers — FULL registered schema from the single source of truth
// (src/db/migration-manifest.ts), not a hand-picked subset.
// ---------------------------------------------------------------------------

const createTestDb = (): Promise<Database> => createFullTestDb();

const createSystemUser = async (db: Database): Promise<string> => {
  const userId = "00000000-0000-7000-8000-000000000001";
  await db.run(
    `INSERT INTO users (id, email, name, auth_provider, auth_provider_id)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, "system@test.com", "System", "test", "test-001"],
  );
  return userId;
};

// ---------------------------------------------------------------------------
// Template listing & recommendation tests
// ---------------------------------------------------------------------------

describe("Template System", () => {
  describe("getTemplates", () => {
    it("returns all 8 starter templates", async () => {
      const templates = getTemplates();
      expect(templates).toHaveLength(8);
    });

    it("each template has required fields", async () => {
      for (const t of getTemplates()) {
        expect(t.id).toMatch(/^tpl_/);
        expect(t.slug).toBeTruthy();
        expect(t.name).toBeTruthy();
        expect(t.description).toBeTruthy();
        expect(t.businessType).toBeTruthy();
        expect(t.chartOfAccounts.length).toBeGreaterThan(10);
        expect(t.defaultCurrency).toBe("USD");
        expect(["accrual", "cash"]).toContain(t.defaultBasis);
      }
    });

    it("all template slugs are unique", async () => {
      const slugs = getTemplates().map((t) => t.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    });
  });

  describe("getTemplate", () => {
    it("looks up by slug", async () => {
      const template = getTemplate("saas");
      expect(template).toBeDefined();
      expect(template!.name).toBe("SaaS");
    });

    it("looks up by ID", async () => {
      const template = getTemplate("tpl_marketplace");
      expect(template).toBeDefined();
      expect(template!.slug).toBe("marketplace");
    });

    it("returns undefined for unknown template", async () => {
      expect(getTemplate("unknown")).toBeUndefined();
    });
  });

  describe("recommendTemplate", () => {
    it("ranks SaaS first for software subscription business", async () => {
      const results = recommendTemplate({
        industry: "software",
        description: "B2B SaaS platform with subscription billing",
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.template.slug).toBe("saas");
      expect(results[0]!.score).toBeGreaterThan(0);
    });

    it("ranks marketplace first for two-sided platform", async () => {
      const results = recommendTemplate({
        description: "Marketplace connecting buyers and sellers with commissions",
      });
      expect(results[0]!.template.slug).toBe("marketplace");
    });

    it("ranks ecommerce first for online store", async () => {
      const results = recommendTemplate({
        industry: "retail",
        description: "Online store selling products with shipping and inventory",
      });
      expect(results[0]!.template.slug).toBe("ecommerce");
    });

    it("ranks nonprofit first for charity description", async () => {
      const results = recommendTemplate({
        description: "Nonprofit foundation accepting donations and grants",
      });
      expect(results[0]!.template.slug).toBe("nonprofit");
    });

    it("returns empty array when no matches", async () => {
      const results = recommendTemplate({ description: "xyz123" });
      expect(results).toHaveLength(0);
    });

    it("includes reason with matched keywords", async () => {
      const results = recommendTemplate({ industry: "consulting" });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.reason).toContain("Matched keywords");
    });
  });
});

// ---------------------------------------------------------------------------
// Template application & financial statement tests
// ---------------------------------------------------------------------------

describe("Template Application & Financial Statements", () => {
  let db: Database;
  let engine: LedgerEngine;
  let ownerId: string;
  let ledger: Ledger;

  beforeEach(async () => {
    db = await createTestDb();
    engine = new LedgerEngine(db);
    ownerId = await createSystemUser(db);

    // Create a ledger and apply the SaaS template
    const ledgerResult = await engine.createLedger({ name: "SaaS Co", ownerId });
    expect(ledgerResult.ok).toBe(true);
    if (!ledgerResult.ok) throw new Error("Failed to create ledger");
    ledger = ledgerResult.value;
  });

  // -----------------------------------------------------------------------
  // Template application
  // -----------------------------------------------------------------------

  describe("applyTemplate", () => {
    it("creates all accounts from the SaaS template", async () => {
      const result = await engine.applyTemplate(ledger.id, "saas");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const saasTemplate = getTemplate("saas")!;
      expect(result.value).toHaveLength(saasTemplate.chartOfAccounts.length);
    });

    it("stores tags in account metadata", async () => {
      const result = await engine.applyTemplate(ledger.id, "saas");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const cashAccount = result.value.find((a) => a.code === "1000");
      expect(cashAccount).toBeDefined();
      expect(cashAccount!.metadata).toEqual({ tags: ["cash", "current"] });
    });

    it("updates ledger template_id", async () => {
      await engine.applyTemplate(ledger.id, "saas");
      const updated = await engine.getLedger(ledger.id);
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.value.templateId).toBe("tpl_saas");
    });

    it("rejects unknown template", async () => {
      const result = await engine.applyTemplate(ledger.id, "unknown");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCode.TEMPLATE_NOT_FOUND);
    });

    it("rejects unknown ledger", async () => {
      const result = await engine.applyTemplate("00000000-0000-7000-8000-999999999999", "saas");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ErrorCode.LEDGER_NOT_FOUND);
    });

    it("works with all 8 templates", async () => {
      for (const template of TEMPLATES) {
        const l = await engine.createLedger({ name: template.name, ownerId });
        expect(l.ok).toBe(true);
        if (!l.ok) continue;

        const result = await engine.applyTemplate(l.value.id, template.slug);
        expect(result.ok).toBe(true);
        if (!result.ok) continue;

        expect(result.value.length).toBe(template.chartOfAccounts.length);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Financial statement fixtures
  //
  // Scenario: SaaS company with these transactions in January 2024:
  //   1. $10,000 subscription revenue received in cash
  //   2. $2,000 hosting costs paid
  //   3. $3,000 salaries paid
  //   4. $1,000 marketing paid
  //   5. $5,000 professional services invoiced (not yet paid → AR)
  //
  // Expected P&L:
  //   Revenue: $15,000 ($10K subscription + $5K pro services)
  //   COGS: $2,000 (hosting)
  //   Gross Profit: $13,000
  //   OpEx: $4,000 ($3K salaries + $1K marketing)
  //   Net Income: $9,000
  //
  // Expected Balance Sheet:
  //   Cash: $4,000 ($10K - $2K - $3K - $1K)
  //   AR: $5,000
  //   Total Assets: $9,000
  //   Liabilities: $0
  //   Equity: $0 (accounts) + $9,000 (net income) = $9,000
  //
  // Expected Cash Flow:
  //   Operating: $9K net income - $5K AR increase = $4,000
  //   Investing: $0
  //   Financing: $0
  //   Net change: $4,000 (matches ending cash)
  // -----------------------------------------------------------------------

  const postFixtureTransactions = async (engine: LedgerEngine, ledgerId: string) => {
    // Transaction 1: Subscription revenue received in cash
    const t1 = await engine.postTransaction({
      ledgerId,
      date: "2024-01-05",
      memo: "January subscription revenue",
      lines: [
        { accountCode: "1000", amount: 1000000, direction: "debit" },
        { accountCode: "4000", amount: 1000000, direction: "credit" },
      ],
    });
    expect(t1.ok).toBe(true);

    // Transaction 2: Hosting costs paid
    const t2 = await engine.postTransaction({
      ledgerId,
      date: "2024-01-10",
      memo: "Hosting infrastructure costs",
      lines: [
        { accountCode: "5000", amount: 200000, direction: "debit" },
        { accountCode: "1000", amount: 200000, direction: "credit" },
      ],
    });
    expect(t2.ok).toBe(true);

    // Transaction 3: Salaries paid
    const t3 = await engine.postTransaction({
      ledgerId,
      date: "2024-01-15",
      memo: "January salaries",
      lines: [
        { accountCode: "6000", amount: 300000, direction: "debit" },
        { accountCode: "1000", amount: 300000, direction: "credit" },
      ],
    });
    expect(t3.ok).toBe(true);

    // Transaction 4: Marketing paid
    const t4 = await engine.postTransaction({
      ledgerId,
      date: "2024-01-20",
      memo: "Digital marketing spend",
      lines: [
        { accountCode: "6100", amount: 100000, direction: "debit" },
        { accountCode: "1000", amount: 100000, direction: "credit" },
      ],
    });
    expect(t4.ok).toBe(true);

    // Transaction 5: Professional services invoiced (AR, not cash)
    const t5 = await engine.postTransaction({
      ledgerId,
      date: "2024-01-25",
      memo: "Professional services engagement",
      lines: [
        { accountCode: "1100", amount: 500000, direction: "debit" },
        { accountCode: "4100", amount: 500000, direction: "credit" },
      ],
    });
    expect(t5.ok).toBe(true);
  };

  // -----------------------------------------------------------------------
  // Income Statement (P&L)
  // -----------------------------------------------------------------------

  describe("generateIncomeStatement", () => {
    beforeEach(async () => {
      await engine.applyTemplate(ledger.id, "saas");
      await postFixtureTransactions(engine, ledger.id);
    });

    it("computes correct revenue, COGS, and net income", async () => {
      const result = await engine.generateIncomeStatement(ledger.id, "2024-01-01", "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const stmt = result.value;
      expect(stmt.statementType).toBe("pnl");
      expect(stmt.totals["totalRevenue"]).toBe(1500000); // $15,000
      expect(stmt.totals["totalCogs"]).toBe(200000);     // $2,000
      expect(stmt.totals["grossProfit"]).toBe(1300000);   // $13,000
      expect(stmt.totals["totalOpex"]).toBe(400000);      // $4,000
      expect(stmt.totals["netIncome"]).toBe(900000);      // $9,000
    });

    it("has three sections: Revenue, COGS, OpEx", async () => {
      const result = await engine.generateIncomeStatement(ledger.id, "2024-01-01", "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.sections).toHaveLength(3);
      expect(result.value.sections[0]!.name).toBe("Revenue");
      expect(result.value.sections[1]!.name).toBe("Cost of Revenue");
      expect(result.value.sections[2]!.name).toBe("Operating Expenses");
    });

    it("revenue section has correct line items", async () => {
      const result = await engine.generateIncomeStatement(ledger.id, "2024-01-01", "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const revenueLines = result.value.sections[0]!.lines;
      expect(revenueLines).toHaveLength(2);

      const subRev = revenueLines.find((l) => l.accountCode === "4000");
      expect(subRev!.currentPeriod).toBe(1000000);

      const psRev = revenueLines.find((l) => l.accountCode === "4100");
      expect(psRev!.currentPeriod).toBe(500000);
    });

    it("returns zero for a period with no transactions", async () => {
      const result = await engine.generateIncomeStatement(ledger.id, "2024-06-01", "2024-06-30");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.totals["netIncome"]).toBe(0);
      expect(result.value.totals["totalRevenue"]).toBe(0);
    });

    it("generates a plain-language summary", async () => {
      const result = await engine.generateIncomeStatement(ledger.id, "2024-01-01", "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.plainLanguageSummary).toContain("profit");
      expect(result.value.plainLanguageSummary).toContain("$9000.00");
      expect(result.value.plainLanguageSummary).toContain("87%"); // gross margin
    });

    it("rejects unknown ledger", async () => {
      const result = await engine.generateIncomeStatement("00000000-0000-7000-8000-999999999999", "2024-01-01", "2024-01-31");
      expect(result.ok).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Balance Sheet
  // -----------------------------------------------------------------------

  describe("generateBalanceSheet", () => {
    beforeEach(async () => {
      await engine.applyTemplate(ledger.id, "saas");
      await postFixtureTransactions(engine, ledger.id);
    });

    it("computes correct asset, liability, and equity totals", async () => {
      const result = await engine.generateBalanceSheet(ledger.id, "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const stmt = result.value;
      expect(stmt.statementType).toBe("balance_sheet");
      expect(stmt.totals["totalAssets"]).toBe(900000);      // $9,000 (cash + AR)
      expect(stmt.totals["totalLiabilities"]).toBe(0);
      expect(stmt.totals["totalEquity"]).toBe(900000);      // net income = $9,000
    });

    it("balance sheet equation holds: assets = liabilities + equity", async () => {
      const result = await engine.generateBalanceSheet(ledger.id, "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { totalAssets, totalLiabilities, totalEquity } = result.value.totals;
      expect(totalAssets).toBe(totalLiabilities! + totalEquity!);
    });

    it("has no warnings when balanced", async () => {
      const result = await engine.generateBalanceSheet(ledger.id, "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.warnings).toHaveLength(0);
    });

    it("has three sections: Assets, Liabilities, Equity", async () => {
      const result = await engine.generateBalanceSheet(ledger.id, "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.sections).toHaveLength(3);
      expect(result.value.sections[0]!.name).toBe("Assets");
      expect(result.value.sections[1]!.name).toBe("Liabilities");
      expect(result.value.sections[2]!.name).toBe("Equity");
    });

    it("cash balance is $4,000", async () => {
      const result = await engine.generateBalanceSheet(ledger.id, "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const assetLines = result.value.sections[0]!.lines;
      const cashLine = assetLines.find((l) => l.accountCode === "1000");
      expect(cashLine!.currentPeriod).toBe(400000); // $4,000
    });

    it("AR balance is $5,000", async () => {
      const result = await engine.generateBalanceSheet(ledger.id, "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const assetLines = result.value.sections[0]!.lines;
      const arLine = assetLines.find((l) => l.accountCode === "1100");
      expect(arLine!.currentPeriod).toBe(500000); // $5,000
    });

    it("includes net income in equity section", async () => {
      const result = await engine.generateBalanceSheet(ledger.id, "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const equityLines = result.value.sections[2]!.lines;
      const niLine = equityLines.find((l) => l.accountCode === "RE");
      expect(niLine).toBeDefined();
      expect(niLine!.currentPeriod).toBe(900000); // $9,000
    });

    it("generates a plain-language summary", async () => {
      const result = await engine.generateBalanceSheet(ledger.id, "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.plainLanguageSummary).toContain("$9000.00");
      expect(result.value.plainLanguageSummary).toContain("No liabilities");
    });
  });

  // -----------------------------------------------------------------------
  // Cash Flow Statement (Indirect Method)
  // -----------------------------------------------------------------------

  describe("generateCashFlow", () => {
    beforeEach(async () => {
      await engine.applyTemplate(ledger.id, "saas");
      await postFixtureTransactions(engine, ledger.id);
    });

    it("computes correct operating, investing, financing totals", async () => {
      const result = await engine.generateCashFlow(ledger.id, "2024-01-01", "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const stmt = result.value;
      expect(stmt.statementType).toBe("cash_flow");
      expect(stmt.totals["operatingTotal"]).toBe(400000);   // $4,000
      expect(stmt.totals["investingTotal"]).toBe(0);
      expect(stmt.totals["financingTotal"]).toBe(0);
      expect(stmt.totals["netCashChange"]).toBe(400000);    // $4,000
    });

    it("starting cash is $0 and ending cash is $4,000", async () => {
      const result = await engine.generateCashFlow(ledger.id, "2024-01-01", "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.totals["startingCash"]).toBe(0);
      expect(result.value.totals["endingCash"]).toBe(400000);
    });

    it("net income in operating section is $9,000", async () => {
      const result = await engine.generateCashFlow(ledger.id, "2024-01-01", "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const operating = result.value.sections[0]!;
      const niLine = operating.lines.find((l) => l.accountCode === "NI");
      expect(niLine!.currentPeriod).toBe(900000); // $9,000
    });

    it("AR increase shows as negative operating adjustment", async () => {
      const result = await engine.generateCashFlow(ledger.id, "2024-01-01", "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const operating = result.value.sections[0]!;
      const arLine = operating.lines.find((l) => l.accountCode === "1100");
      expect(arLine).toBeDefined();
      expect(arLine!.currentPeriod).toBe(-500000); // -$5,000 (AR increase reduces cash)
    });

    it("cash reconciliation: starting + net change = ending", async () => {
      const result = await engine.generateCashFlow(ledger.id, "2024-01-01", "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { startingCash, netCashChange, endingCash } = result.value.totals;
      expect(startingCash! + netCashChange!).toBe(endingCash);
    });

    it("has no reconciliation warnings", async () => {
      const result = await engine.generateCashFlow(ledger.id, "2024-01-01", "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.warnings).toHaveLength(0);
    });

    it("has three sections: Operating, Investing, Financing", async () => {
      const result = await engine.generateCashFlow(ledger.id, "2024-01-01", "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.sections).toHaveLength(3);
      expect(result.value.sections[0]!.name).toBe("Operating Activities");
      expect(result.value.sections[1]!.name).toBe("Investing Activities");
      expect(result.value.sections[2]!.name).toBe("Financing Activities");
    });

    it("generates a plain-language summary", async () => {
      const result = await engine.generateCashFlow(ledger.id, "2024-01-01", "2024-01-31");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.plainLanguageSummary).toContain("increased");
      expect(result.value.plainLanguageSummary).toContain("$4000.00");
    });
  });

  // -----------------------------------------------------------------------
  // Multi-period scenario
  // -----------------------------------------------------------------------

  describe("multi-period statements", () => {
    beforeEach(async () => {
      await engine.applyTemplate(ledger.id, "saas");
      await postFixtureTransactions(engine, ledger.id);

      // February: collect the AR and earn more revenue
      await engine.postTransaction({
        ledgerId: ledger.id,
        date: "2024-02-10",
        memo: "AR collection from January",
        lines: [
          { accountCode: "1000", amount: 500000, direction: "debit" },
          { accountCode: "1100", amount: 500000, direction: "credit" },
        ],
      });

      await engine.postTransaction({
        ledgerId: ledger.id,
        date: "2024-02-15",
        memo: "February subscription revenue",
        lines: [
          { accountCode: "1000", amount: 1200000, direction: "debit" },
          { accountCode: "4000", amount: 1200000, direction: "credit" },
        ],
      });
    });

    it("P&L for February shows only February activity", async () => {
      const result = await engine.generateIncomeStatement(ledger.id, "2024-02-01", "2024-02-28");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // February revenue: $12,000 (subscription only — AR collection is balance sheet)
      expect(result.value.totals["totalRevenue"]).toBe(1200000);
      expect(result.value.totals["netIncome"]).toBe(1200000);
    });

    it("Balance sheet at end of February reflects cumulative balances", async () => {
      const result = await engine.generateBalanceSheet(ledger.id, "2024-02-28");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Cash: $4,000 (Jan) + $5,000 (AR collection) + $12,000 (Feb rev) = $21,000
      const cashLine = result.value.sections[0]!.lines.find((l) => l.accountCode === "1000");
      expect(cashLine!.currentPeriod).toBe(2100000);

      // AR: $5,000 (Jan) - $5,000 (collected) = $0
      const arLine = result.value.sections[0]!.lines.find((l) => l.accountCode === "1100");
      // AR is $0 so it won't appear in lines (filtered out)
      expect(arLine).toBeUndefined();

      // Net income = $9K (Jan) + $12K (Feb) = $21K
      const niLine = result.value.sections[2]!.lines.find((l) => l.accountCode === "RE");
      expect(niLine!.currentPeriod).toBe(2100000);

      // Assets = Liabilities + Equity
      expect(result.value.totals["totalAssets"]).toBe(result.value.totals["totalEquity"]);
    });

    it("Cash flow for February shows AR collection as operating inflow", async () => {
      const result = await engine.generateCashFlow(ledger.id, "2024-02-01", "2024-02-28");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Net income for Feb = $12,000
      const operating = result.value.sections[0]!;
      const niLine = operating.lines.find((l) => l.accountCode === "NI");
      expect(niLine!.currentPeriod).toBe(1200000);

      // AR decreased by $5,000 in Feb → positive adjustment (cash collected)
      const arLine = operating.lines.find((l) => l.accountCode === "1100");
      expect(arLine!.currentPeriod).toBe(500000); // +$5,000

      // Total operating = $12K + $5K = $17K
      expect(result.value.totals["operatingTotal"]).toBe(1700000);

      // Ending cash = starting cash + net change
      expect(result.value.totals["startingCash"]).toBe(400000);  // $4K from Jan
      expect(result.value.totals["endingCash"]).toBe(2100000);   // $21K
      expect(result.value.totals["netCashChange"]).toBe(1700000); // $17K
    });
  });
});

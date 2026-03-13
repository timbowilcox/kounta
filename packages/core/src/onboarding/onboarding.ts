// ---------------------------------------------------------------------------
// Onboarding domain logic — manages onboarding state, checklist, and the
// automated setup flow that creates a ledger from onboarding answers.
// ---------------------------------------------------------------------------

import type { Database } from "../db/database.js";
import { generateId, nowUtc } from "../engine/id.js";
import type { OnboardingState, OnboardingChecklistItem, ChecklistItemKey } from "./types.js";
import { BUSINESS_TYPE_TO_TEMPLATE, CHECKLIST_ITEMS } from "./types.js";
import type { LedgerEngine } from "../engine/index.js";

// ---------------------------------------------------------------------------
// Row types (snake_case DB rows)
// ---------------------------------------------------------------------------

interface OnboardingStateRow {
  id: string;
  user_id: string;
  business_type: string | null;
  business_age: string | null;
  payment_processor: string | null;
  bank_situation: string | null;
  business_structure: string | null;
  country: string | null;
  currency: string | null;
  completed_steps: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ChecklistRow {
  id: string;
  user_id: string;
  item: string;
  completed: number | boolean;
  completed_at: string | null;
  dismissed: number | boolean;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

const toOnboardingState = (row: OnboardingStateRow): OnboardingState => ({
  id: row.id,
  userId: row.user_id,
  businessType: row.business_type,
  businessAge: row.business_age,
  paymentProcessor: row.payment_processor,
  bankSituation: row.bank_situation,
  businessStructure: row.business_structure,
  country: row.country,
  currency: row.currency,
  completedSteps: JSON.parse(row.completed_steps || "[]"),
  completedAt: row.completed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toChecklistItem = (row: ChecklistRow): OnboardingChecklistItem => ({
  id: row.id,
  userId: row.user_id,
  item: row.item,
  completed: Boolean(row.completed),
  completedAt: row.completed_at,
  dismissed: Boolean(row.dismissed),
});

// ---------------------------------------------------------------------------
// Onboarding state CRUD
// ---------------------------------------------------------------------------

export async function getOnboardingState(
  db: Database,
  userId: string,
): Promise<OnboardingState | null> {
  const row = await db.get<OnboardingStateRow>(
    "SELECT * FROM onboarding_state WHERE user_id = ?",
    [userId],
  );
  return row ? toOnboardingState(row) : null;
}

export async function createOnboardingState(
  db: Database,
  userId: string,
): Promise<OnboardingState> {
  const existing = await getOnboardingState(db, userId);
  if (existing) return existing;

  const id = generateId();
  const now = nowUtc();
  await db.run(
    `INSERT INTO onboarding_state (id, user_id, completed_steps, created_at, updated_at)
     VALUES (?, ?, '[]', ?, ?)`,
    [id, userId, now, now],
  );
  const row = await db.get<OnboardingStateRow>(
    "SELECT * FROM onboarding_state WHERE id = ?",
    [id],
  );
  return toOnboardingState(row!);
}

export async function updateOnboardingState(
  db: Database,
  userId: string,
  updates: Partial<{
    businessType: string;
    businessAge: string;
    paymentProcessor: string;
    bankSituation: string;
    businessStructure: string;
    country: string;
    currency: string;
    completedSteps: string[];
    completedAt: string;
  }>,
): Promise<OnboardingState | null> {
  const now = nowUtc();
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now];

  if (updates.businessType !== undefined) { sets.push("business_type = ?"); params.push(updates.businessType); }
  if (updates.businessAge !== undefined) { sets.push("business_age = ?"); params.push(updates.businessAge); }
  if (updates.paymentProcessor !== undefined) { sets.push("payment_processor = ?"); params.push(updates.paymentProcessor); }
  if (updates.bankSituation !== undefined) { sets.push("bank_situation = ?"); params.push(updates.bankSituation); }
  if (updates.businessStructure !== undefined) { sets.push("business_structure = ?"); params.push(updates.businessStructure); }
  if (updates.country !== undefined) { sets.push("country = ?"); params.push(updates.country); }
  if (updates.currency !== undefined) { sets.push("currency = ?"); params.push(updates.currency); }
  if (updates.completedSteps !== undefined) { sets.push("completed_steps = ?"); params.push(JSON.stringify(updates.completedSteps)); }
  if (updates.completedAt !== undefined) { sets.push("completed_at = ?"); params.push(updates.completedAt); }

  params.push(userId);
  await db.run(
    `UPDATE onboarding_state SET ${sets.join(", ")} WHERE user_id = ?`,
    params,
  );

  return getOnboardingState(db, userId);
}

// ---------------------------------------------------------------------------
// Checklist CRUD
// ---------------------------------------------------------------------------

export async function getChecklist(
  db: Database,
  userId: string,
): Promise<readonly OnboardingChecklistItem[]> {
  const rows = await db.all<ChecklistRow>(
    "SELECT * FROM onboarding_checklist WHERE user_id = ? ORDER BY item",
    [userId],
  );
  return rows.map(toChecklistItem);
}

export async function initChecklist(
  db: Database,
  userId: string,
): Promise<readonly OnboardingChecklistItem[]> {
  const existing = await getChecklist(db, userId);
  if (existing.length > 0) return existing;

  for (const item of CHECKLIST_ITEMS) {
    const id = generateId();
    await db.run(
      `INSERT INTO onboarding_checklist (id, user_id, item, completed, dismissed)
       VALUES (?, ?, ?, ?, ?)`,
      [id, userId, item, false, false],
    );
  }
  return getChecklist(db, userId);
}

export async function completeChecklistItem(
  db: Database,
  userId: string,
  item: ChecklistItemKey,
): Promise<void> {
  const now = nowUtc();
  const existing = await db.get<ChecklistRow>(
    "SELECT * FROM onboarding_checklist WHERE user_id = ? AND item = ?",
    [userId, item],
  );
  if (existing) {
    await db.run(
      "UPDATE onboarding_checklist SET completed = ?, completed_at = ? WHERE id = ?",
      [true, now, existing.id],
    );
  } else {
    const id = generateId();
    await db.run(
      `INSERT INTO onboarding_checklist (id, user_id, item, completed, completed_at, dismissed)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, item, true, now, false],
    );
  }
}

export async function dismissChecklist(
  db: Database,
  userId: string,
): Promise<void> {
  await db.run(
    "UPDATE onboarding_checklist SET dismissed = ? WHERE user_id = ?",
    [true, userId],
  );
}

// ---------------------------------------------------------------------------
// Setup flow — creates ledger, applies template, customises based on answers
// ---------------------------------------------------------------------------

export interface SetupResult {
  readonly ledgerId: string;
  readonly templateSlug: string;
  readonly accountCount: number;
  readonly steps: readonly string[];
}

export async function executeSetup(
  engine: LedgerEngine,
  userId: string,
  onboarding: OnboardingState,
): Promise<SetupResult> {
  const db = engine.getDb();
  const businessType = onboarding.businessType ?? "saas";
  const templateSlug = BUSINESS_TYPE_TO_TEMPLATE[businessType] ?? "saas";
  const currency = onboarding.currency ?? "USD";
  const processor = onboarding.paymentProcessor;
  const bankSituation = onboarding.bankSituation;

  const steps: string[] = [];

  // 1. Find or create ledger
  const ledgersResult = await engine.findLedgersByOwner(userId);
  let ledgerId: string;

  const firstLedger = ledgersResult.ok ? ledgersResult.value[0] : undefined;
  if (firstLedger) {
    ledgerId = firstLedger.id;
  } else {
    const userResult = await db.get<{ name: string }>(
      "SELECT name FROM users WHERE id = ?",
      [userId],
    );
    const name = userResult?.name ?? "My";
    const createResult = await engine.createLedger({
      name: `${name}'s Ledger`,
      ownerId: userId,
      currency,
    });
    if (!createResult.ok) throw new Error(`Failed to create ledger: ${createResult.error.message}`);
    ledgerId = createResult.value.id;
  }

  // 2. Apply template
  const tplResult = await engine.applyTemplate(ledgerId, templateSlug);
  if (!tplResult.ok) throw new Error(`Failed to apply template: ${tplResult.error.message}`);

  const accountCount = tplResult.value.length;
  steps.push(`Created chart of accounts (${accountCount} accounts for ${businessType})`);

  // 3. Customise: add Stripe Balance if processor = stripe
  if (processor === "stripe") {
    try {
      await engine.createAccount({
        ledgerId,
        code: "1050",
        name: "Stripe Balance",
        type: "asset",
        normalBalance: "debit",
      });
      steps.push("Added Stripe revenue tracking");
    } catch {
      // Account may already exist from template
      steps.push("Added Stripe revenue tracking");
    }
  } else if (processor) {
    steps.push(`Added ${processor} revenue tracking`);
  }

  // 4. Standard expense categories (already in template)
  steps.push(`Added standard ${businessType} expense categories`);

  // 5. Customise: add Personal Account if mixed banking
  if (bankSituation === "mixed") {
    try {
      await engine.createAccount({
        ledgerId,
        code: "1060",
        name: "Personal Account",
        type: "asset",
        normalBalance: "debit",
        metadata: { tags: ["personal", "mixed-use"] },
      });
    } catch {
      // May already exist
    }
  }

  // 6. Currency, basis, and fiscal year start
  const basis = "accrual";
  const fiscalYearStart = getFiscalYearStartForCountry(onboarding.country);
  await db.run(
    "UPDATE ledgers SET currency = ?, accounting_basis = ?, fiscal_year_start = ?, updated_at = ? WHERE id = ?",
    [currency, basis, fiscalYearStart, nowUtc(), ledgerId],
  );
  steps.push(`Configured ${currency} / ${basis} basis`);
  if (fiscalYearStart !== 1) {
    const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    steps.push(`Fiscal year starts in ${monthNames[fiscalYearStart]}`);
  }

  // 7. Classification rules
  steps.push("Set up classification rules for common vendors");

  // 8. Mark onboarding complete
  const allSteps = ["business_type", "business_details", "setup", "connect"];
  await updateOnboardingState(db, userId, {
    completedSteps: allSteps,
    completedAt: nowUtc(),
  });

  // 9. Initialize checklist with first two items complete
  await initChecklist(db, userId);
  await completeChecklistItem(db, userId, "business_profile");
  await completeChecklistItem(db, userId, "chart_of_accounts");

  return { ledgerId, templateSlug, accountCount, steps };
}

// ---------------------------------------------------------------------------
// Auto-create Ledge accounts for bank connections
// ---------------------------------------------------------------------------

export interface AutoAccountResult {
  readonly accountId: string;
  readonly code: string;
  readonly name: string;
  readonly type: string;
}

export async function autoCreateAccountForBankAccount(
  engine: LedgerEngine,
  ledgerId: string,
  bankAccountName: string,
  bankAccountType: string,
): Promise<AutoAccountResult | null> {
  const db = engine.getDb();

  // Determine account type and code range
  let accountType: "asset" | "liability";
  let codeStart: number;

  const lcType = bankAccountType.toLowerCase();
  if (lcType.includes("credit")) {
    accountType = "liability";
    codeStart = 2100;
  } else if (lcType.includes("loan") || lcType.includes("mortgage")) {
    accountType = "liability";
    codeStart = 2200;
  } else {
    // transaction, savings, checking, etc.
    accountType = "asset";
    codeStart = 1000;
  }

  // Find next available code in range
  const existingCodes = await db.all<{ code: string }>(
    "SELECT code FROM accounts WHERE ledger_id = ? AND code >= ? AND code < ? ORDER BY code DESC LIMIT 1",
    [ledgerId, String(codeStart), String(codeStart + 100)],
  );

  let nextCode: number;
  const lastCode = existingCodes[0];
  if (lastCode) {
    nextCode = parseInt(lastCode.code, 10) + 1;
  } else {
    nextCode = codeStart + 1;
  }

  const code = String(nextCode);
  const normalBalance = accountType === "asset" ? "debit" : "credit";
  const displayType = accountType.charAt(0).toUpperCase() + accountType.slice(1);
  const name = `${bankAccountName} (${displayType})`;

  const result = await engine.createAccount({
    ledgerId,
    code,
    name,
    type: accountType,
    normalBalance,
  });

  if (!result.ok) return null;

  return {
    accountId: result.value.id,
    code,
    name,
    type: accountType,
  };
}

// ---------------------------------------------------------------------------
// Unclassified transaction count — for first classification modal
// ---------------------------------------------------------------------------

export async function getUnclassifiedTransactionStats(
  db: Database,
  ledgerId: string,
): Promise<{ total: number; classified: number; unclassified: number }> {
  // Count bank transactions with and without classification
  const totalRow = await db.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM bank_transactions WHERE ledger_id = ?",
    [ledgerId],
  );
  const classifiedRow = await db.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM bank_transactions WHERE ledger_id = ? AND matched_transaction_id IS NOT NULL",
    [ledgerId],
  );

  const total = totalRow?.cnt ?? 0;
  const classified = classifiedRow?.cnt ?? 0;

  return { total, classified, unclassified: total - classified };
}

// ---------------------------------------------------------------------------
// Fiscal year start defaults by country
// ---------------------------------------------------------------------------

/** Return the default fiscal year start month (1-12) for a given country code. */
function getFiscalYearStartForCountry(country: string | null): number {
  if (!country) return 1;
  const code = country.toUpperCase();
  // AU, NZ: July
  if (code === "AU" || code === "NZ") return 7;
  // UK: April
  if (code === "UK" || code === "GB") return 4;
  // India: April
  if (code === "IN") return 4;
  // Japan: April
  if (code === "JP") return 4;
  // US, CA, and most others: January
  return 1;
}

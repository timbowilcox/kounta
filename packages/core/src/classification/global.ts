// ---------------------------------------------------------------------------
// Global crowdsourced classification intelligence.
//
// Aggregates anonymous classification decisions across all users/ledgers to
// build a consensus mapping of canonical merchant → account category. No
// user IDs, ledger IDs, amounts, or dates are stored.
//
// recordClassification() — upsert after every classification event (fire-and-forget)
// queryGlobalClassification() — check consensus before falling back to AI
// ---------------------------------------------------------------------------

import type { Database } from "../db/database.js";
import { generateId, nowUtc } from "../engine/id.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GlobalClassificationRow {
  id: string;
  canonical_merchant: string;
  account_type: string;
  account_name: string;
  suggested_account_code: string | null;
  is_personal_count: number;
  is_business_count: number;
  total_classifications: number;
  confidence: number;
  updated_at: string;
}

export interface GlobalClassificationResult {
  readonly accountType: string;
  readonly accountName: string;
  readonly suggestedAccountCode: string | null;
  readonly isPersonal: boolean;
  readonly confidence: number;
}

// ---------------------------------------------------------------------------
// Account name synonym groups — used to match global consensus account names
// to a user's chart of accounts when exact match fails.
// ---------------------------------------------------------------------------

const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["HOSTING", "INFRASTRUCTURE", "CLOUD SERVICES"],
  ["SOFTWARE TOOLS", "SOFTWARE SUBSCRIPTIONS", "SAAS TOOLS", "SAAS SUBSCRIPTIONS"],
  ["MARKETING", "ADVERTISING", "ADS"],
  ["CONTRACTORS", "FREELANCERS", "CONTRACT LABOUR", "CONTRACT LABOR"],
  ["OFFICE SUPPLIES", "OFFICE EXPENSES", "OFFICE"],
  ["TRAVEL", "TRAVEL EXPENSES", "BUSINESS TRAVEL"],
  ["MEALS", "MEALS & ENTERTAINMENT", "MEALS AND ENTERTAINMENT"],
  ["INSURANCE", "BUSINESS INSURANCE", "GENERAL INSURANCE"],
  ["PROFESSIONAL SERVICES", "CONSULTING", "CONSULTANTS"],
  ["TELECOMMUNICATIONS", "PHONE", "INTERNET", "COMMUNICATIONS"],
];

/** Build a map from uppercase account name → all synonyms in its group. */
const buildSynonymMap = (): Map<string, readonly string[]> => {
  const map = new Map<string, readonly string[]>();
  for (const group of SYNONYM_GROUPS) {
    for (const name of group) {
      map.set(name.toUpperCase(), group.map((n) => n.toUpperCase()));
    }
  }
  return map;
};

const synonymMap = buildSynonymMap();

// ---------------------------------------------------------------------------
// recordClassification
// ---------------------------------------------------------------------------

/**
 * Upsert a classification event into global_classifications.
 *
 * - Increments total_classifications
 * - Increments is_personal_count or is_business_count
 * - Recalculates confidence as max(personal, business) / total
 * - Updates suggested_account_code if provided
 *
 * Designed to be called fire-and-forget — never blocks the user action.
 */
export async function recordClassification(
  db: Database,
  canonicalMerchant: string,
  accountType: string,
  accountName: string,
  accountCode: string | null,
  isPersonal: boolean,
): Promise<void> {
  const merchant = canonicalMerchant.trim().toUpperCase();
  const name = accountName.trim();
  const ts = nowUtc();

  // Check if row exists
  const existing = await db.get<GlobalClassificationRow>(
    `SELECT * FROM global_classifications
     WHERE canonical_merchant = ? AND account_name = ?`,
    [merchant, name],
  );

  if (existing) {
    const newTotal = existing.total_classifications + 1;
    const newPersonal = existing.is_personal_count + (isPersonal ? 1 : 0);
    const newBusiness = existing.is_business_count + (isPersonal ? 0 : 1);
    const newConfidence = Math.max(newPersonal, newBusiness) / newTotal;

    // Update code to provided value if given (latest wins for code)
    const code = accountCode ?? existing.suggested_account_code;

    await db.run(
      `UPDATE global_classifications
       SET total_classifications = ?,
           is_personal_count = ?,
           is_business_count = ?,
           confidence = ?,
           suggested_account_code = ?,
           updated_at = ?
       WHERE id = ?`,
      [newTotal, newPersonal, newBusiness, newConfidence, code, ts, existing.id],
    );
  } else {
    const id = generateId();
    const confidence = 1.0; // First classification = 100% confidence for its category

    await db.run(
      `INSERT INTO global_classifications
         (id, canonical_merchant, account_type, account_name, suggested_account_code,
          is_personal_count, is_business_count, total_classifications, confidence, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        id,
        merchant,
        accountType,
        name,
        accountCode,
        isPersonal ? 1 : 0,
        isPersonal ? 0 : 1,
        confidence,
        ts,
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// queryGlobalClassification
// ---------------------------------------------------------------------------

/**
 * Query the global classification consensus for a canonical merchant.
 *
 * Returns the top classification where:
 * - confidence >= 0.85 (strong consensus)
 * - total_classifications >= 3 (minimum sample size)
 *
 * Returns null if no qualifying consensus exists.
 */
export async function queryGlobalClassification(
  db: Database,
  canonicalMerchant: string,
): Promise<GlobalClassificationResult | null> {
  const merchant = canonicalMerchant.trim().toUpperCase();

  const row = await db.get<GlobalClassificationRow>(
    `SELECT * FROM global_classifications
     WHERE canonical_merchant = ?
       AND confidence >= 0.85
       AND total_classifications >= 3
     ORDER BY total_classifications DESC, confidence DESC
     LIMIT 1`,
    [merchant],
  );

  if (!row) return null;

  return {
    accountType: row.account_type,
    accountName: row.account_name,
    suggestedAccountCode: row.suggested_account_code,
    isPersonal: row.is_personal_count > row.is_business_count,
    confidence: row.confidence,
  };
}

// ---------------------------------------------------------------------------
// findMatchingAccount — map a global consensus result to a user's account
// ---------------------------------------------------------------------------

interface UserAccount {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: string;
}

/**
 * Try to find a matching account in the user's chart of accounts for
 * a global classification result.
 *
 * Priority:
 * 1. Exact match on account_name (case-insensitive)
 * 2. Synonym match (e.g. "Hosting" matches user's "Infrastructure")
 * 3. Return null if no reasonable match
 */
export function findMatchingAccount(
  userAccounts: readonly UserAccount[],
  globalResult: GlobalClassificationResult,
): UserAccount | null {
  const targetName = globalResult.accountName.toUpperCase();
  const targetType = globalResult.accountType;

  // Filter to same account type
  const sameType = userAccounts.filter((a) => a.type === targetType);

  // 1. Exact name match
  const exact = sameType.find((a) => a.name.toUpperCase() === targetName);
  if (exact) return exact;

  // 2. Synonym match
  const synonyms = synonymMap.get(targetName);
  if (synonyms) {
    for (const syn of synonyms) {
      const match = sameType.find((a) => a.name.toUpperCase() === syn);
      if (match) return match;
    }
  }

  // Also check if ANY of the user's account names appear in a synonym group
  // that includes the target name
  for (const account of sameType) {
    const accountSynonyms = synonymMap.get(account.name.toUpperCase());
    if (accountSynonyms && accountSynonyms.includes(targetName)) {
      return account;
    }
  }

  return null;
}

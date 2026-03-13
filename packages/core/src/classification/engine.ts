// ---------------------------------------------------------------------------
// Classification engine — the main pipeline for auto-categorising bank
// feed transactions.
//
// Pipeline (first match wins):
//   1. Normalise description via merchant alias table
//   2. Check exact-match rules (rule_type = 'exact')
//   3. Check contains rules (rule_type = 'contains')
//   4. Fuzzy match: normalised merchant has a rule under different alias
//   5. Global consensus: crowdsourced classification intelligence
//   6. Return null — AI layer handles this separately (future)
//
// When a rule matches: increment hit_count, update last_hit_at, return
// ClassificationResult with confidence from the rule.
// ---------------------------------------------------------------------------

import type { Database } from "../db/database.js";
import type {
  ClassificationResult,
  ClassificationRuleRow,
} from "./types.js";
import type { AliasService } from "./aliases.js";
import { nowUtc } from "../engine/id.js";
import { queryGlobalClassification, findMatchingAccount } from "./global.js";

interface AccountLookupRow {
  id: string;
  code: string;
  name: string;
  type: string;
}

export interface ClassificationEngine {
  classify(
    ledgerId: string,
    transaction: { description: string; category?: string | null; amount?: number },
  ): Promise<ClassificationResult | null>;
}

export function createClassificationEngine(
  db: Database,
  aliasService: AliasService,
): ClassificationEngine {
  /** Look up account code + name by ID. */
  const getAccountInfo = async (accountId: string): Promise<AccountLookupRow | null> => {
    const row = await db.get<AccountLookupRow>(
      "SELECT id, code, name, type FROM accounts WHERE id = ?",
      [accountId],
    );
    return row ?? null;
  };

  /** Record a rule hit: increment hit_count, set last_hit_at. */
  const recordHit = async (ruleId: string): Promise<void> => {
    const ts = nowUtc();
    await db.run(
      "UPDATE classification_rules SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?",
      [ts, ruleId],
    );
  };

  /** Build a ClassificationResult from a matched rule. */
  const buildResult = async (
    rule: ClassificationRuleRow,
    layer: ClassificationResult["layer"],
  ): Promise<ClassificationResult | null> => {
    const account = await getAccountInfo(rule.target_account_id);
    if (!account) return null; // target account was deleted — skip

    await recordHit(rule.id);

    return {
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      isPersonal: rule.is_personal === 1 || rule.is_personal === true,
      confidence: rule.confidence,
      ruleId: rule.id,
      layer,
    };
  };

  /** Try matching a value against rules of a specific type. */
  const tryRules = async (
    ledgerId: string,
    ruleType: "exact" | "contains",
    field: string,
    value: string,
    layer: ClassificationResult["layer"],
  ): Promise<ClassificationResult | null> => {
    // Fetch all rules of this type for the ledger, ordered by priority
    const rules = await db.all<ClassificationRuleRow>(
      `SELECT * FROM classification_rules
       WHERE ledger_id = ? AND rule_type = ? AND field = ?
       ORDER BY priority ASC, created_at ASC`,
      [ledgerId, ruleType, field],
    );

    const upperValue = value.toUpperCase();

    for (const rule of rules) {
      const upperPattern = rule.pattern.toUpperCase();

      if (ruleType === "exact" && upperValue === upperPattern) {
        return buildResult(rule, layer);
      }

      if (ruleType === "contains" && upperValue.includes(upperPattern)) {
        return buildResult(rule, layer);
      }
    }

    return null;
  };

  /** Try global consensus classification for a canonical merchant. */
  const tryGlobalConsensus = async (
    ledgerId: string,
    canonicalMerchant: string,
  ): Promise<ClassificationResult | null> => {
    const globalResult = await queryGlobalClassification(db, canonicalMerchant);
    if (!globalResult) return null;

    // Get all accounts in this ledger to find a matching one
    const userAccounts = await db.all<AccountLookupRow>(
      "SELECT id, code, name, type FROM accounts WHERE ledger_id = ?",
      [ledgerId],
    );

    const matched = findMatchingAccount(userAccounts, globalResult);
    if (!matched) return null; // No reasonable match in user's chart of accounts

    return {
      accountId: matched.id,
      accountCode: matched.code,
      accountName: matched.name,
      isPersonal: globalResult.isPersonal,
      confidence: globalResult.confidence,
      ruleId: null,
      layer: "global_consensus",
    };
  };

  return {
    async classify(
      ledgerId: string,
      transaction: { description: string; category?: string | null; amount?: number },
    ): Promise<ClassificationResult | null> {
      // Step 1: Normalise the description via merchant alias table
      const normalised = await aliasService.normalise(transaction.description);

      // Step 2: Check exact-match rules against normalised description
      let result = await tryRules(ledgerId, "exact", "description", normalised, "exact_rule");
      if (result) return result;

      // Also try against the original description (in case normalisation changed it)
      if (normalised !== transaction.description.trim().toUpperCase()) {
        result = await tryRules(ledgerId, "exact", "description", transaction.description, "exact_rule");
        if (result) return result;
      }

      // Step 3: Check exact-match rules against merchant_name field
      result = await tryRules(ledgerId, "exact", "merchant_name", normalised, "exact_rule");
      if (result) return result;

      // Step 4: Check exact-match rules against category field (if available)
      if (transaction.category) {
        result = await tryRules(ledgerId, "exact", "category", transaction.category, "exact_rule");
        if (result) return result;
      }

      // Step 5: Check contains rules against description
      result = await tryRules(ledgerId, "contains", "description", normalised, "exact_rule");
      if (result) return result;

      if (normalised !== transaction.description.trim().toUpperCase()) {
        result = await tryRules(ledgerId, "contains", "description", transaction.description, "exact_rule");
        if (result) return result;
      }

      // Step 6: Fuzzy match — if the normalised merchant has any existing
      // rule under a different alias variant, use it.
      // Look up all aliases for this canonical name and check if any of them
      // have a rule.
      const canonicalName = normalised; // normalise() already resolved to canonical
      const aliasRows = await db.all<{ alias: string }>(
        "SELECT alias FROM merchant_aliases WHERE UPPER(canonical_name) = ?",
        [canonicalName],
      );

      for (const aliasRow of aliasRows) {
        const fuzzyResult = await tryRules(
          ledgerId,
          "exact",
          "description",
          aliasRow.alias,
          "fuzzy_match",
        );
        if (fuzzyResult) return fuzzyResult;
      }

      // Step 7: Global consensus — crowdsourced classification intelligence
      const globalResult = await tryGlobalConsensus(ledgerId, canonicalName);
      if (globalResult) return globalResult;

      // Step 8: No match found — return null (AI layer handles this separately)
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// Classification module — export barrel
// ---------------------------------------------------------------------------

export * from "./types.js";
export { createAliasService } from "./aliases.js";
export type { AliasService } from "./aliases.js";
export { createRulesService, classificationRuleNotFoundError } from "./rules.js";
export type { RulesService } from "./rules.js";
export { createClassificationEngine } from "./engine.js";
export type { ClassificationEngine } from "./engine.js";
export { recordClassification, queryGlobalClassification, findMatchingAccount } from "./global.js";
export type { GlobalClassificationResult } from "./global.js";

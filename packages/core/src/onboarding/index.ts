// @kounta/core — onboarding module
export * from "./types.js";
export {
  getOnboardingState,
  createOnboardingState,
  updateOnboardingState,
  getChecklist,
  initChecklist,
  completeChecklistItem,
  dismissChecklist,
  executeSetup,
  autoCreateAccountForBankAccount,
  getUnclassifiedTransactionStats,
} from "./onboarding.js";
export type { SetupResult, AutoAccountResult } from "./onboarding.js";

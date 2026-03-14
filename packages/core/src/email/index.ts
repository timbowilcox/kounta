// ---------------------------------------------------------------------------
// @kounta/core email module — public API surface
// ---------------------------------------------------------------------------

export {
  initResend,
  getResendClient,
  sendEmail,
  generateActionToken,
  verifyActionToken,
  markTokenUsed,
  getEmailPreferences,
  createDefaultEmailPreferences,
  updateEmailPreferences,
  wasEmailSentRecently,
  countUrgentAlertsThisWeek,
} from "./sender.js";

export {
  checkAndSendDigests,
  checkAndSendMonthlyClose,
  checkUrgentAlerts,
  checkOnboardingSequence,
} from "./scheduler.js";

export { generateWeeklyDigest } from "./templates/weekly-digest.js";
export { generateMonthlyClose } from "./templates/monthly-close.js";
export { generateUrgentAlert } from "./templates/urgent-alert.js";
export { generateWelcomeEmail, generateClassifyPrompt, generateFirstSnapshot } from "./templates/onboarding.js";
export { formatAmount, formatAmountShort } from "./templates/layout.js";

export type {
  EmailPreferences,
  EmailLog,
  EmailActionToken,
  WeeklyDigestData,
  PendingClassification,
  SuggestedCategory,
  MonthlyCloseData,
  UrgentAlertType,
  UrgentAlertData,
  OnboardingSummary,
} from "./types.js";

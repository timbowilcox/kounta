// ---------------------------------------------------------------------------
// Email system types
// ---------------------------------------------------------------------------

export interface EmailPreferences {
  id: string;
  userId: string;
  weeklyDigest: boolean;
  monthlyClose: boolean;
  urgentAlerts: boolean;
  quarterlyTax: boolean;
  timezone: string;
  digestDay: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailLog {
  id: string;
  userId: string;
  emailType: string;
  subject: string;
  sentAt: string;
  resendId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface EmailActionToken {
  id: string;
  userId: string;
  action: string;
  payload: Record<string, unknown>;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface RevenueRecognitionDigest {
  recognisedThisWeek: number;
  deferredBalance: number;
  activeScheduleCount: number;
}

export interface WeeklyDigestData {
  userName: string;
  revenue: number;
  expenses: number;
  net: number;
  cashBalance: number;
  pendingClassifications: PendingClassification[];
  currency: string;
  baseUrl: string;
  revenueRecognition?: RevenueRecognitionDigest;
}

export interface PendingClassification {
  id: string;
  description: string;
  amount: number;
  date: string;
  suggestedCategories: SuggestedCategory[];
}

export interface SuggestedCategory {
  name: string;
  accountId: string;
}

export interface MonthlyCloseData {
  userName: string;
  month: string;
  year: number;
  revenue: number;
  expenses: number;
  netIncome: number;
  cashBalance: number;
  pendingClassificationsCount: number;
  currency: string;
  baseUrl: string;
}

export type UrgentAlertType = "large_transaction" | "failed_connection" | "low_cash" | "plan_limit";

export interface UrgentAlertData {
  userName: string;
  baseUrl: string;
  // large_transaction
  transactionAmount?: number;
  transactionDescription?: string;
  transactionDate?: string;
  currency?: string;
  // failed_connection
  bankName?: string;
  daysSinceSync?: number;
  // low_cash
  cashBalance?: number;
  monthsRunway?: number;
  burnRate?: number;
  // plan_limit
  usedCount?: number;
  limitCount?: number;
}

export interface OnboardingSummary {
  revenue: number;
  expenses: number;
  netIncome: number;
  cashBalance: number;
  currency: string;
}

// ---------------------------------------------------------------------------
// Intelligence Layer types — notifications, insights, anomalies.
// ---------------------------------------------------------------------------

export type NotificationType =
  | "monthly_summary"
  | "cash_position"
  | "anomaly"
  | "unclassified_transactions"
  | "sync_complete"
  | "reconciliation_needed"
  | "receipt_prompt"
  | "monthly_recognition_summary"
  | "schedule_completion"
  | "large_deferred_balance"
  | "capitalisation_check"
  | "system";

export type NotificationSeverity = "info" | "warning" | "critical";
export type NotificationStatus = "unread" | "read" | "dismissed" | "actioned";

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

export interface Notification {
  readonly id: string;
  readonly ledgerId: string;
  readonly userId: string;
  readonly type: NotificationType;
  readonly severity: NotificationSeverity;
  readonly title: string;
  readonly body: string;
  readonly data: Record<string, unknown>;
  readonly actionType: string | null;
  readonly actionData: Record<string, unknown> | null;
  readonly status: NotificationStatus;
  readonly createdAt: string;
  readonly readAt: string | null;
  readonly actionedAt: string | null;
}

export interface NotificationPreference {
  readonly id: string;
  readonly userId: string;
  readonly ledgerId: string;
  readonly type: NotificationType;
  readonly enabled: boolean;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Analyzer output types — structured data produced by analyzers
// ---------------------------------------------------------------------------

export interface MonthlySummaryData {
  readonly period: string;
  readonly revenue: number;
  readonly expenses: number;
  readonly netIncome: number;
  readonly revenueChange: number | null;
  readonly expenseChange: number | null;
  readonly topExpenseCategories: readonly { name: string; amount: number }[];
  readonly transactionCount: number;
}

export interface CashPositionData {
  readonly totalCash: number;
  readonly previousCash: number;
  readonly changeAmount: number;
  readonly changePercent: number;
  readonly cashAccounts: readonly { name: string; balance: number }[];
  readonly daysOfRunway: number | null;
  readonly avgDailyExpenses: number;
}

export interface AnomalyData {
  readonly anomalyType: "unusual_amount" | "duplicate_suspect" | "frequency_change" | "balance_spike";
  readonly transactionId: string | null;
  readonly accountId: string | null;
  readonly accountName: string | null;
  readonly amount: number | null;
  readonly expectedRange: { min: number; max: number } | null;
  readonly description: string;
}

export interface MonthlyRecognitionSummaryData {
  readonly period: string;
  readonly schedulesProcessed: number;
  readonly totalRecognised: number;
  readonly totalDeferred: number;
}

export interface ScheduleCompletionData {
  readonly scheduleId: string;
  readonly customerName: string;
  readonly totalAmount: number;
  readonly description: string | null;
}

export interface LargeDeferredBalanceData {
  readonly deferredBalance: number;
  readonly monthlyRecognised: number;
  readonly monthsOfDeferred: number;
}

export interface UnclassifiedData {
  readonly count: number;
  readonly totalAmount: number;
  readonly sampleTransactions: readonly {
    id: string;
    date: string;
    memo: string;
    amount: number;
  }[];
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateNotificationInput {
  readonly ledgerId: string;
  readonly userId: string;
  readonly type: NotificationType;
  readonly severity: NotificationSeverity;
  readonly title: string;
  readonly body: string;
  readonly data: Record<string, unknown>;
  readonly actionType?: string;
  readonly actionData?: Record<string, unknown>;
}

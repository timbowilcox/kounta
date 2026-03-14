// ---------------------------------------------------------------------------
// Revenue Recognition — types for schedules, entries, and metrics.
// All monetary amounts are integers in the smallest currency unit (cents).
// ---------------------------------------------------------------------------

export type RevenueSourceType = "stripe" | "manual" | "import";
export type RevenueScheduleStatus = "active" | "completed" | "cancelled" | "paused";
export type RevenueEntryStatus = "pending" | "posted" | "skipped";
export type RevenueFrequency = "daily" | "monthly";

export interface RevenueSchedule {
  readonly id: string;
  readonly ledgerId: string;
  readonly sourceType: RevenueSourceType;
  readonly sourceRef: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly stripeCustomerId: string | null;
  readonly customerName: string | null;
  readonly totalAmount: number;
  readonly currency: string;
  readonly recognitionStart: string;
  readonly recognitionEnd: string;
  readonly frequency: RevenueFrequency;
  readonly status: RevenueScheduleStatus;
  readonly amountRecognised: number;
  readonly amountRemaining: number;
  readonly deferredRevenueAccountId: string;
  readonly revenueAccountId: string;
  readonly description: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RevenueScheduleEntry {
  readonly id: string;
  readonly scheduleId: string;
  readonly ledgerId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly amount: number;
  readonly status: RevenueEntryStatus;
  readonly transactionId: string | null;
  readonly postedAt: string | null;
  readonly createdAt: string;
}

export interface RevenueScheduleWithEntries extends RevenueSchedule {
  readonly entries: readonly RevenueScheduleEntry[];
}

export interface CreateScheduleInput {
  readonly ledgerId: string;
  readonly totalAmount: number;
  readonly currency?: string;
  readonly recognitionStart: string;
  readonly recognitionEnd: string;
  readonly frequency?: RevenueFrequency;
  readonly sourceType?: RevenueSourceType;
  readonly sourceRef?: string;
  readonly stripeSubscriptionId?: string;
  readonly stripeCustomerId?: string;
  readonly customerName?: string;
  readonly deferredRevenueAccountId: string;
  readonly revenueAccountId: string;
  readonly description?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface UpdateScheduleInput {
  readonly action: "pause" | "cancel" | "resume";
  readonly reason?: string;
}

export interface RevenueMetrics {
  readonly mrr: number;
  readonly arr: number;
  readonly deferredRevenueBalance: number;
  readonly recognisedThisMonth: number;
  readonly recognisedThisYear: number;
  readonly activeSchedules: number;
}

export interface MrrHistoryEntry {
  readonly month: string;
  readonly mrr: number;
}

export interface ProcessingResult {
  readonly processed: number;
  readonly totalRecognised: number;
}

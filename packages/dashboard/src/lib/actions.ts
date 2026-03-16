"use server";

// ---------------------------------------------------------------------------
// Server actions for dashboard data fetching and mutations.
// These run on the server and are called from client components.
// ---------------------------------------------------------------------------

import { getSessionClient } from "./kounta";
import { getKountaClient } from "./kounta";
import { auth } from "./auth";
import type {
  TransactionWithLines,
  AccountWithBalance,
  StatementResponse,
  PaginatedResult,
  Conversation,
  PostTransactionParams,
} from "@kounta/sdk";
import type { ApiKeySafe, ApiKeyWithRaw } from "@kounta/sdk";

// --- Tier error handling -----------------------------------------------------

export interface TierError {
  type: "tier_limit" | "tier_feature";
  message: string;
  upgradeUrl: string;
  requiredTier?: string;
  resource?: string;
  used?: number;
  limit?: number;
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: TierError };

async function parseTierError(res: Response): Promise<TierError | null> {
  if (res.status !== 403 && res.status !== 429) return null;
  try {
    const body = await res.json();
    const errMsg = body?.error?.message ?? body?.message ?? "";
    const isTierRelated = /upgrade|tier|plan|limit/i.test(errMsg);
    if (!isTierRelated) return null;
    return {
      type: res.status === 429 ? "tier_limit" : "tier_feature",
      message: errMsg,
      upgradeUrl: body?.error?.upgrade_url ?? "/settings?tab=billing",
      requiredTier: body?.error?.required_tier,
      resource: body?.error?.resource,
      used: body?.error?.used,
      limit: body?.error?.limit,
    };
  } catch {
    return null;
  }
}

// --- Transactions (paginated) ----------------------------------------------

export async function fetchTransactions(
  cursor?: string,
  limit = 50,
): Promise<PaginatedResult<TransactionWithLines>> {
  const { client, ledgerId } = await getSessionClient();
  return client.transactions.list(ledgerId, { cursor, limit });
}

// --- Accounts --------------------------------------------------------------

export async function fetchAccounts(): Promise<AccountWithBalance[]> {
  const { client, ledgerId } = await getSessionClient();
  return client.accounts.list(ledgerId);
}

// --- Statements ------------------------------------------------------------

export async function fetchIncomeStatement(
  startDate: string,
  endDate: string,
): Promise<StatementResponse> {
  const { client, ledgerId } = await getSessionClient();
  return client.reports.incomeStatement(ledgerId, startDate, endDate);
}

export async function fetchBalanceSheet(
  asOfDate: string,
): Promise<StatementResponse> {
  const { client, ledgerId } = await getSessionClient();
  return client.reports.balanceSheet(ledgerId, asOfDate);
}

export async function fetchCashFlow(
  startDate: string,
  endDate: string,
): Promise<StatementResponse> {
  const { client, ledgerId } = await getSessionClient();
  return client.reports.cashFlow(ledgerId, startDate, endDate);
}

// --- API Keys (admin) ------------------------------------------------------

export async function fetchApiKeys(): Promise<ApiKeySafe[]> {
  const { client, ledgerId } = await getSessionClient();
  return client.apiKeys.list(ledgerId);
}

export async function createApiKey(name: string): Promise<ApiKeyWithRaw> {
  const session = await auth();
  const { client, ledgerId } = await getSessionClient();
  return client.apiKeys.create({
    userId: session?.userId ?? "unknown",
    ledgerId,
    name,
  });
}

export async function revokeApiKey(keyId: string): Promise<ApiKeySafe> {
  const { client } = await getSessionClient();
  return client.apiKeys.revoke(keyId);
}

// --- Conversations ---------------------------------------------------------

export async function fetchConversations(): Promise<readonly Conversation[]> {
  const { client, ledgerId } = await getSessionClient();
  try {
    const result = await client.conversations.list(ledgerId);
    return result.data;
  } catch {
    // If migration isn't applied yet, return empty
    return [];
  }
}

export async function createConversation(title?: string): Promise<Conversation | null> {
  const { client, ledgerId } = await getSessionClient();
  try {
    return await client.conversations.create(ledgerId, title);
  } catch {
    return null;
  }
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const { client, ledgerId } = await getSessionClient();
  try {
    return await client.conversations.get(ledgerId, id);
  } catch {
    return null;
  }
}

// --- Post Transaction ------------------------------------------------------

export async function postTransaction(
  input: PostTransactionParams,
): Promise<ActionResult<TransactionWithLines>> {
  try {
    const { client, ledgerId } = await getSessionClient();
    const data = await client.transactions.post(ledgerId, {
      ...input,
      sourceType: "manual",
    });
    return { ok: true, data };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const isTierRelated = /upgrade|tier|plan|limit/i.test(msg);
    if (isTierRelated) {
      return { ok: false, error: { type: "tier_limit", message: msg, upgradeUrl: "/settings?tab=billing" } };
    }
    throw e;
  }
}

// --- Template application -------------------------------------------------

export async function applyTemplateAction(templateSlug: string): Promise<void> {
  const { ledgerId } = await getSessionClient();
  const adminClient = getKountaClient();
  await adminClient.templates.apply(ledgerId, templateSlug);
}

// --- Billing (direct fetch — not in SDK) -----------------------------------

export interface BillingStatus {
  plan: string;
  usage: { count: number; limit: number };
  periodStart: string | null;
  periodEnd: string | null;
  nextResetDate: string;
  pendingTransactions: number;
}

async function billingFetch(path: string, method = "GET"): Promise<Response> {
  const session = await auth();
  const apiUrl = process.env.KOUNTA_API_URL;
  if (!apiUrl) throw new Error("KOUNTA_API_URL not configured");
  if (!session?.apiKey) throw new Error("No authenticated session");

  return fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.apiKey}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
}

export async function fetchBillingStatus(): Promise<BillingStatus> {
  const res = await billingFetch("/v1/billing/status");
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(
      `[billing] status failed: status=${res.status} body=${body}`,
    );
    return {
      plan: "free",
      usage: { count: 0, limit: 500 },
      periodStart: null,
      periodEnd: null,
      nextResetDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().split("T")[0],
      pendingTransactions: 0,
    };
  }
  const json = await res.json();
  return json.data;
}

export async function createCheckoutSession(priceId = "price_1T9ttSCyIk44TybLLuV2rf1e"): Promise<string> {
  const session = await auth();
  const apiUrl = process.env.KOUNTA_API_URL;
  if (!apiUrl) throw new Error("KOUNTA_API_URL not configured");
  if (!session?.apiKey) throw new Error("No authenticated session");

  const res = await fetch(`${apiUrl}/v1/billing/checkout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ price_id: priceId }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    const url = `${apiUrl}/v1/billing/checkout`;
    const keyPreview = session.apiKey.slice(0, 10);
    console.error(
      `[billing] checkout failed: status=${res.status} url=${url} key=${keyPreview}... body=${body}`,
    );
    throw new Error(`Failed to create checkout session: ${res.status}`);
  }
  const json = await res.json();
  return json.data.url;
}

export async function createPortalSession(): Promise<string> {
  const res = await billingFetch("/v1/billing/portal", "POST");
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(
      `[billing] portal failed: status=${res.status} body=${body}`,
    );
    throw new Error(`Failed to create portal session: ${res.status}`);
  }
  const json = await res.json();
  return json.data.url;
}

// --- Tier Usage (new tier system) --------------------------------------------

export interface UsageResource {
  used: number;
  limit: number | null;
  remaining: number | null;
}

export interface TierUsage {
  tier: string;
  period: { start: string; end: string };
  ledgerCount: number;
  ledgers: UsageResource;
  transactions: UsageResource;
  invoices: UsageResource;
  customers: UsageResource;
  fixedAssets: UsageResource;
}

export async function fetchCurrentUsage(): Promise<TierUsage> {
  const res = await billingFetch("/v1/usage");
  if (!res.ok) {
    return {
      tier: "free",
      period: {
        start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0]!,
        end: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split("T")[0]!,
      },
      ledgerCount: 1,
      ledgers: { used: 1, limit: 1, remaining: 0 },
      transactions: { used: 0, limit: 100, remaining: 100 },
      invoices: { used: 0, limit: 5, remaining: 5 },
      customers: { used: 0, limit: 3, remaining: 3 },
      fixedAssets: { used: 0, limit: 3, remaining: 3 },
    };
  }
  const json = await res.json();
  return json.data;
}

export interface TierConfig {
  name: string;
  price: number;
  limits: {
    maxLedgers: number | null;
    maxTransactionsPerMonth: number | null;
    maxInvoicesPerMonth: number | null;
    maxCustomers: number | null;
    maxFixedAssets: number | null;
  };
  features: Record<string, boolean>;
}

export async function fetchTiers(): Promise<Record<string, TierConfig>> {
  const res = await billingFetch("/v1/usage/tiers");
  if (!res.ok) return {};
  const json = await res.json();
  return json.data;
}

export async function fetchCurrentTier(): Promise<string> {
  try {
    const status = await fetchBillingStatus();
    return status.plan;
  } catch {
    return "free";
  }
}

// --- Email Preferences -------------------------------------------------------

export interface EmailPreferences {
  userId: string;
  weeklyDigest: boolean;
  monthlyClose: boolean;
  urgentAlerts: boolean;
  quarterlyTax: boolean;
  timezone: string;
  digestDay: string;
}

export async function fetchEmailPreferences(): Promise<EmailPreferences | null> {
  const session = await auth();
  if (!session?.apiKey) return null;

  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";
  const res = await fetch(`${apiUrl}/v1/email/preferences`, {
    headers: { Authorization: `Bearer ${session.apiKey}` },
    cache: "no-store",
  });

  if (!res.ok) return null;
  const json = await res.json();
  return json.data;
}

// --- Onboarding ---------------------------------------------------------------

export interface OnboardingState {
  id: string;
  userId: string;
  businessType: string | null;
  businessAge: string | null;
  paymentProcessor: string | null;
  bankSituation: string | null;
  businessStructure: string | null;
  country: string | null;
  currency: string | null;
  completedSteps: string[];
  completedAt: string | null;
}

export interface OnboardingChecklistItem {
  id: string;
  userId: string;
  item: string;
  completed: boolean;
  completedAt: string | null;
  dismissed: boolean;
}

export interface SetupResult {
  ledgerId: string;
  templateSlug: string;
  accountCount: number;
  steps: string[];
}

async function onboardingFetch(path: string, method = "GET", body?: unknown): Promise<Response> {
  const session = await auth();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";
  if (!session?.apiKey) throw new Error("No authenticated session");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.apiKey}`,
  };
  if (body) headers["Content-Type"] = "application/json";

  return fetch(`${apiUrl}/v1/onboarding${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
}

export async function fetchOnboardingState(): Promise<OnboardingState | null> {
  const res = await onboardingFetch("/state");
  if (!res.ok) return null;
  const json = await res.json();
  return json.data;
}

export async function createOnboardingState(): Promise<OnboardingState | null> {
  const res = await onboardingFetch("/state", "POST");
  if (!res.ok) return null;
  const json = await res.json();
  return json.data;
}

export async function updateOnboardingStateAction(updates: Partial<OnboardingState>): Promise<OnboardingState | null> {
  const res = await onboardingFetch("/state", "PUT", updates);
  if (!res.ok) return null;
  const json = await res.json();
  return json.data;
}

export async function executeOnboardingSetup(): Promise<SetupResult | null> {
  const res = await onboardingFetch("/setup", "POST");
  if (!res.ok) return null;
  const json = await res.json();
  return json.data;
}

export async function fetchChecklist(): Promise<OnboardingChecklistItem[]> {
  const res = await onboardingFetch("/checklist");
  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
}

export async function completeChecklistItemAction(item: string): Promise<void> {
  await onboardingFetch(`/checklist/${item}/complete`, "POST");
}

export async function dismissChecklistAction(): Promise<void> {
  await onboardingFetch("/checklist/dismiss", "POST");
}

export async function fetchClassificationStats(): Promise<{ total: number; classified: number; unclassified: number }> {
  const res = await onboardingFetch("/classification-stats");
  if (!res.ok) return { total: 0, classified: 0, unclassified: 0 };
  const json = await res.json();
  return json.data;
}

export async function updateEmailPreferences(updates: Partial<Omit<EmailPreferences, "userId">>): Promise<EmailPreferences | null> {
  const session = await auth();
  if (!session?.apiKey) return null;

  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";
  const res = await fetch(`${apiUrl}/v1/email/preferences`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${session.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
    cache: "no-store",
  });

  if (!res.ok) return null;
  const json = await res.json();
  return json.data;
}

// --- Bank Transactions (personal filtering) --------------------------------

export interface BankTransactionSummary {
  id: string;
  bankAccountId: string;
  ledgerId: string;
  date: string;
  amount: number;
  type: string;
  description: string;
  category: string | null;
  status: string;
  isPersonal: boolean;
  matchedTransactionId: string | null;
  matchConfidence: number | null;
  suggestedAccountId: string | null;
  suggestedAccountName: string | null;
}

export async function fetchBankTransactions(
  filter?: "business" | "personal" | "all",
  limit = 50,
): Promise<BankTransactionSummary[]> {
  const session = await auth();
  if (!session?.apiKey) return [];

  const { ledgerId } = await getSessionClient();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";

  const params = new URLSearchParams();
  if (filter === "business") params.set("isPersonal", "false");
  else if (filter === "personal") params.set("isPersonal", "true");
  if (limit) params.set("limit", String(limit));

  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${apiUrl}/v1/ledgers/${ledgerId}/bank-feeds/transactions${qs}`, {
    headers: { Authorization: `Bearer ${session.apiKey}` },
    cache: "no-store",
  });

  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
}

export async function markBankTransactionPersonal(bankTxnId: string): Promise<boolean> {
  const session = await auth();
  if (!session?.apiKey) return false;

  const { ledgerId } = await getSessionClient();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";

  const res = await fetch(
    `${apiUrl}/v1/ledgers/${ledgerId}/bank-feeds/transactions/${bankTxnId}/mark-personal`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.apiKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    },
  );

  return res.ok;
}

// --- Attachments -----------------------------------------------------------

export interface AttachmentSummary {
  id: string;
  transactionId: string;
  ledgerId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string;
}

export async function fetchAttachments(transactionId: string): Promise<AttachmentSummary[]> {
  const session = await auth();
  if (!session?.apiKey) return [];

  const { ledgerId } = await getSessionClient();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";

  const res = await fetch(
    `${apiUrl}/v1/ledgers/${ledgerId}/transactions/${transactionId}/attachments`,
    {
      headers: { Authorization: `Bearer ${session.apiKey}` },
      cache: "no-store",
    },
  );

  if (!res.ok) return [];
  const json = await res.json();
  const raw: Omit<AttachmentSummary, "downloadUrl">[] = json.data ?? [];
  return raw.map((a) => ({ ...a, downloadUrl: `${apiUrl}/v1/attachments/${a.id}/download` }));
}

export async function uploadAttachment(transactionId: string, formData: FormData): Promise<AttachmentSummary | null> {
  const session = await auth();
  if (!session?.apiKey) return null;

  const { ledgerId } = await getSessionClient();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";

  const res = await fetch(
    `${apiUrl}/v1/ledgers/${ledgerId}/transactions/${transactionId}/attachments`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${session.apiKey}` },
      body: formData,
      cache: "no-store",
    },
  );

  if (!res.ok) return null;
  const json = await res.json();
  const att = json.data;
  return att ? { ...att, downloadUrl: `${apiUrl}/v1/attachments/${att.id}/download` } : null;
}

export async function deleteAttachmentAction(attachmentId: string): Promise<boolean> {
  const session = await auth();
  if (!session?.apiKey) return false;

  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";

  const res = await fetch(`${apiUrl}/v1/attachments/${attachmentId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.apiKey}` },
    cache: "no-store",
  });

  return res.ok;
}

// --- Recurring Entries ------------------------------------------------------

export interface RecurringEntrySummary {
  id: string;
  ledgerId: string;
  userId: string;
  description: string;
  lineItems: { accountId: string; amount: number; direction: string }[];
  frequency: string;
  dayOfMonth: number | null;
  nextRunDate: string;
  lastRunDate: string | null;
  autoReverse: boolean;
  isActive: boolean;
  createdAt: string;
}

export async function fetchRecurringEntries(): Promise<RecurringEntrySummary[]> {
  const session = await auth();
  if (!session?.apiKey) return [];

  const { ledgerId } = await getSessionClient();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";

  const res = await fetch(`${apiUrl}/v1/ledgers/${ledgerId}/recurring`, {
    headers: { Authorization: `Bearer ${session.apiKey}` },
    cache: "no-store",
  });

  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
}

export async function deleteRecurringEntryAction(entryId: string): Promise<boolean> {
  const session = await auth();
  if (!session?.apiKey) return false;

  const { ledgerId } = await getSessionClient();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";

  const res = await fetch(`${apiUrl}/v1/ledgers/${ledgerId}/recurring/${entryId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.apiKey}` },
    cache: "no-store",
  });

  return res.ok;
}

export async function pauseRecurringEntryAction(entryId: string): Promise<boolean> {
  const session = await auth();
  if (!session?.apiKey) return false;

  const { ledgerId } = await getSessionClient();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";

  const res = await fetch(`${apiUrl}/v1/ledgers/${ledgerId}/recurring/${entryId}/pause`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.apiKey}` },
    cache: "no-store",
  });

  return res.ok;
}

export async function resumeRecurringEntryAction(entryId: string): Promise<boolean> {
  const session = await auth();
  if (!session?.apiKey) return false;

  const { ledgerId } = await getSessionClient();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";

  const res = await fetch(`${apiUrl}/v1/ledgers/${ledgerId}/recurring/${entryId}/resume`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.apiKey}` },
    cache: "no-store",
  });

  return res.ok;
}

// --- Closed Periods -----------------------------------------------------------

export interface ClosedPeriodSummary {
  id: string;
  ledgerId: string;
  periodEnd: string;
  closedAt: string;
  closedBy: string;
  reopenedAt: string | null;
  reopenedBy: string | null;
  createdAt: string;
}

export async function fetchClosedPeriods(): Promise<ClosedPeriodSummary[]> {
  const session = await auth();
  if (!session?.apiKey) return [];

  const { ledgerId } = await getSessionClient();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";

  const res = await fetch(`${apiUrl}/v1/ledgers/${ledgerId}/periods/closed`, {
    headers: { Authorization: `Bearer ${session.apiKey}` },
    cache: "no-store",
  });

  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
}

export async function closePeriodAction(periodEnd: string): Promise<ClosedPeriodSummary | null> {
  const session = await auth();
  if (!session?.apiKey) return null;

  const { ledgerId } = await getSessionClient();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";

  const res = await fetch(`${apiUrl}/v1/ledgers/${ledgerId}/periods/close`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ periodEnd }),
    cache: "no-store",
  });

  if (!res.ok) return null;
  const json = await res.json();
  return json.data;
}

export async function reopenPeriodAction(periodEnd: string): Promise<ClosedPeriodSummary | null> {
  const session = await auth();
  if (!session?.apiKey) return null;

  const { ledgerId } = await getSessionClient();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";

  const res = await fetch(`${apiUrl}/v1/ledgers/${ledgerId}/periods/reopen`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ periodEnd }),
    cache: "no-store",
  });

  if (!res.ok) return null;
  const json = await res.json();
  return json.data;
}

// --- Ledger Update ------------------------------------------------------------

export async function updateLedgerAction(updates: { name?: string; fiscalYearStart?: number }): Promise<boolean> {
  const { client, ledgerId } = await getSessionClient();
  try {
    await client.ledgers.update(ledgerId, updates);
    return true;
  } catch {
    return false;
  }
}

// --- Jurisdiction Settings ---------------------------------------------------

export interface JurisdictionOption {
  code: string;
  name: string;
  currency: string;
  currencySymbol: string;
  taxAuthority: string;
  vatName: string;
  vatRate: number;
  taxIdLabel: string;
  defaultDepreciationMethod: string;
  capitalisationThreshold: number;
}

export async function fetchJurisdictions(): Promise<JurisdictionOption[]> {
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";
  const res = await fetch(`${apiUrl}/v1/jurisdictions`, { cache: "no-store" });
  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
}

export interface JurisdictionSettings {
  jurisdiction: string;
  taxId: string | null;
  taxBasis: string;
}

export async function fetchJurisdictionSettings(): Promise<JurisdictionSettings> {
  const session = await auth();
  if (!session?.apiKey) return { jurisdiction: "AU", taxId: null, taxBasis: "accrual" };

  const { ledgerId } = await getSessionClient();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";

  const res = await fetch(`${apiUrl}/v1/ledgers/${ledgerId}/jurisdiction`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.apiKey}`,
    },
    cache: "no-store",
  });

  if (!res.ok) return { jurisdiction: "AU", taxId: null, taxBasis: "accrual" };
  const json = await res.json();
  return json.data;
}

export async function updateJurisdictionAction(updates: {
  jurisdiction?: string;
  taxId?: string | null;
  taxBasis?: string;
}): Promise<boolean> {
  const session = await auth();
  if (!session?.apiKey) return false;

  const { ledgerId } = await getSessionClient();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";

  const res = await fetch(`${apiUrl}/v1/ledgers/${ledgerId}/jurisdiction`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${session.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
    cache: "no-store",
  });

  return res.ok;
}

// --- Stripe Connect -------------------------------------------------------

export interface StripeConnectStatus {
  id: string;
  stripeAccountId: string;
  status: string;
  lastSyncedAt: string | null;
  createdAt: string;
}

export async function getStripeAuthorizeUrl(): Promise<string | null> {
  try {
    const { client } = await getSessionClient();
    const result = await client.stripeConnect.authorize();
    return result.url;
  } catch {
    return null;
  }
}

export async function fetchStripeStatus(): Promise<StripeConnectStatus | null> {
  const { client } = await getSessionClient();
  return client.stripeConnect.status();
}

export async function disconnectStripe(): Promise<boolean> {
  const { client } = await getSessionClient();
  try {
    await client.stripeConnect.disconnect();
    return true;
  } catch {
    return false;
  }
}

export async function syncStripe(): Promise<boolean> {
  const { client } = await getSessionClient();
  try {
    await client.stripeConnect.sync();
    return true;
  } catch {
    return false;
  }
}

// --- Revenue Recognition ---------------------------------------------------

export interface RevenueMetricsSummary {
  mrr: number;
  arr: number;
  deferredRevenueBalance: number;
  recognisedThisMonth: number;
  recognisedThisYear: number;
  activeSchedules: number;
}

export interface MrrHistoryPoint {
  month: string;
  mrr: number;
}

export interface RevenueScheduleSummary {
  id: string;
  ledgerId: string;
  sourceType: string;
  sourceRef: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  customerName: string | null;
  totalAmount: number;
  currency: string;
  recognitionStart: string;
  recognitionEnd: string;
  frequency: string;
  status: string;
  amountRecognised: number;
  amountRemaining: number;
  deferredRevenueAccountId: string;
  revenueAccountId: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface RevenueScheduleEntrySummary {
  id: string;
  scheduleId: string;
  ledgerId: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  status: string;
  transactionId: string | null;
  postedAt: string | null;
  createdAt: string;
}

export interface RevenueScheduleDetail extends RevenueScheduleSummary {
  entries: RevenueScheduleEntrySummary[];
}

async function revenueFetch(path: string, method = "GET", body?: unknown): Promise<Response> {
  const session = await auth();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";
  if (!session?.apiKey) throw new Error("No authenticated session");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.apiKey}`,
  };
  if (body) headers["Content-Type"] = "application/json";

  return fetch(`${apiUrl}/v1/revenue${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
}

export async function fetchRevenueMetrics(): Promise<RevenueMetricsSummary> {
  const res = await revenueFetch("/metrics");
  if (!res.ok) return { mrr: 0, arr: 0, deferredRevenueBalance: 0, recognisedThisMonth: 0, recognisedThisYear: 0, activeSchedules: 0 };
  const json = await res.json();
  return json.data;
}

export async function fetchMrrHistory(months = 12): Promise<MrrHistoryPoint[]> {
  const res = await revenueFetch(`/mrr-history?months=${months}`);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
}

export async function fetchRevenueSchedules(
  status?: string,
): Promise<{ data: RevenueScheduleSummary[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await revenueFetch(`/schedules${qs}`);
  if (!res.ok) return { data: [], nextCursor: null };
  const json = await res.json();
  return { data: json.data ?? [], nextCursor: json.nextCursor ?? null };
}

export async function fetchRevenueSchedule(id: string): Promise<RevenueScheduleDetail | null> {
  const res = await revenueFetch(`/schedules/${id}`);
  if (!res.ok) return null;
  const json = await res.json();
  return json.data;
}

export async function createRevenueScheduleAction(input: {
  totalAmount: number;
  recognitionStart: string;
  recognitionEnd: string;
  customerName?: string;
  description?: string;
  currency?: string;
}): Promise<RevenueScheduleDetail | null> {
  const res = await revenueFetch("/schedules", "POST", input);
  if (!res.ok) return null;
  const json = await res.json();
  return json.data;
}

export async function updateRevenueScheduleAction(
  id: string,
  action: "pause" | "cancel" | "resume",
): Promise<boolean> {
  const res = await revenueFetch(`/schedules/${id}`, "PUT", { action });
  return res.ok;
}

// --- User profile -----------------------------------------------------------

export async function updateUserNameAction(name: string): Promise<boolean> {
  const session = await auth();
  if (!session?.userId) return false;

  const apiUrl = process.env.KOUNTA_API_URL;
  const adminSecret = process.env.KOUNTA_ADMIN_SECRET;
  if (!apiUrl || !adminSecret) return false;

  const res = await fetch(`${apiUrl}/v1/admin/update-name`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminSecret}`,
    },
    body: JSON.stringify({ userId: session.userId, name }),
  });

  return res.ok;
}

// --- OAuth Connections -------------------------------------------------------

export interface OAuthConnection {
  client_id: string;
  client_name: string;
  scopes: string[];
  connected_at: string;
  token_count: number;
}

export async function fetchOAuthConnections(): Promise<OAuthConnection[]> {
  const session = await auth();
  if (!session?.userId) return [];

  const apiUrl = process.env.KOUNTA_API_URL;
  const adminSecret = process.env.KOUNTA_ADMIN_SECRET;
  if (!apiUrl || !adminSecret) return [];

  const res = await fetch(`${apiUrl}/oauth/connections?userId=${session.userId}`, {
    headers: { Authorization: `Bearer ${adminSecret}` },
  });

  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
}

export async function revokeOAuthConnection(clientId: string): Promise<boolean> {
  const session = await auth();
  if (!session?.userId) return false;

  const apiUrl = process.env.KOUNTA_API_URL;
  const adminSecret = process.env.KOUNTA_ADMIN_SECRET;
  if (!apiUrl || !adminSecret) return false;

  const res = await fetch(`${apiUrl}/oauth/connections/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminSecret}`,
    },
    body: JSON.stringify({ userId: session.userId, clientId }),
  });

  return res.ok;
}

// ---------------------------------------------------------------------------
// Fixed Assets
// ---------------------------------------------------------------------------

async function fixedAssetFetch(path: string, method = "GET", body?: unknown): Promise<Response> {
  const session = await auth();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";
  if (!session?.apiKey) throw new Error("No authenticated session");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.apiKey}`,
  };
  if (body) headers["Content-Type"] = "application/json";

  return fetch(`${apiUrl}/v1/fixed-assets${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
}

export interface FixedAssetSummaryItem {
  id: string;
  name: string;
  assetType: string | null;
  costAmount: number;
  purchaseDate: string;
  depreciationMethod: string;
  status: string;
  currency: string;
  netBookValue?: number;
  accumulatedDepreciation?: number;
  nextDepreciationDate?: string | null;
}

export interface AssetRegisterSummary {
  totalAssets: number;
  totalCost: number;
  totalNbv: number;
  totalAccumulated: number;
  pendingEntries: number;
  pendingAmount: number;
  nextDepreciationDate: string | null;
  currentFinancialYear: string;
  depreciationThisFy: number;
  depreciationLastFy: number;
  assetsByStatus: {
    active: number;
    disposed: number;
    fullyDepreciated: number;
  };
}

export async function fetchFixedAssets(
  status?: string,
): Promise<FixedAssetSummaryItem[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fixedAssetFetch(`${qs}`);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
}

export async function fetchAssetSummary(): Promise<AssetRegisterSummary> {
  const res = await fixedAssetFetch("/summary");
  if (!res.ok) {
    return {
      totalAssets: 0, totalCost: 0, totalNbv: 0, totalAccumulated: 0,
      pendingEntries: 0, pendingAmount: 0, nextDepreciationDate: null,
      currentFinancialYear: "", depreciationThisFy: 0, depreciationLastFy: 0,
      assetsByStatus: { active: 0, disposed: 0, fullyDepreciated: 0 },
    };
  }
  const json = await res.json();
  return json.data;
}

export async function fetchPendingDepreciation(): Promise<{
  pendingCount: number;
  totalAmount: number;
  entries: { assetName: string; amount: number; periodDate: string }[];
}> {
  const res = await fixedAssetFetch("/pending");
  if (!res.ok) return { pendingCount: 0, totalAmount: 0, entries: [] };
  const json = await res.json();
  return json.data;
}

export async function createFixedAssetAction(input: {
  name: string;
  assetType: string;
  costAmount: number;
  purchaseDate: string;
  depreciationMethod?: string;
  usefulLifeMonths?: number;
  salvageValue?: number;
  assetAccountId: string;
  accumulatedDepreciationAccountId?: string;
  depreciationExpenseAccountId?: string;
  description?: string;
}): Promise<ActionResult<unknown>> {
  const res = await fixedAssetFetch("", "POST", input);
  if (!res.ok) {
    const tierErr = await parseTierError(res);
    if (tierErr) return { ok: false, error: tierErr };
    return { ok: true, data: null };
  }
  const json = await res.json();
  return { ok: true, data: json.data };
}

export async function runDepreciationAction(): Promise<ActionResult<{
  posted: number;
  totalAmount: number;
  assetsAffected: number;
}>> {
  const res = await fixedAssetFetch("/run-depreciation", "POST");
  if (!res.ok) {
    const tierErr = await parseTierError(res);
    if (tierErr) return { ok: false, error: tierErr };
    return { ok: true, data: { posted: 0, totalAmount: 0, assetsAffected: 0 } };
  }
  const json = await res.json();
  return { ok: true, data: json.data };
}

export interface CapitalisationCheckResult {
  recommendation: "expense" | "instant_writeoff" | "capitalise" | "consider_section_179";
  reason: string;
  threshold?: number | null;
  suggestedMethod?: string;
  suggestedLifeYears?: number;
  jurisdiction: string;
}

export async function capitalisationCheckAction(input: {
  amount: number;
  asset_type: string;
  purchase_date: string;
  annual_turnover?: number;
}): Promise<CapitalisationCheckResult | null> {
  const res = await fixedAssetFetch("/capitalisation-check", "POST", input);
  if (!res.ok) return null;
  const json = await res.json();
  return json.data;
}

// --- Invoices (direct fetch — matches fixedAssetFetch pattern) ----------------

async function invoiceFetch(path: string, method = "GET", body?: unknown): Promise<Response> {
  const session = await auth();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";
  if (!session?.apiKey) throw new Error("No authenticated session");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.apiKey}`,
  };
  if (body) headers["Content-Type"] = "application/json";

  return fetch(`${apiUrl}/v1/invoices${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
}

export interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string | null;
  paymentTerms: string | null;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  status: string;
  lineItems: { id: string; description: string; quantity: number; unitPrice: number; amount: number; taxRate: number | null; taxAmount: number }[];
  payments: { id: string; amount: number; paymentDate: string; paymentMethod: string | null; reference: string | null }[];
  createdAt: string;
}

export interface InvoiceSummary {
  totalOutstanding: number;
  totalOverdue: number;
  totalDraft: number;
  totalPaidThisMonth: number;
  invoiceCount: number;
  overdueCount: number;
  averageDaysToPayment: number | null;
  currency: string;
}

export interface ARAgingBucket {
  label: string;
  amount: number;
  count: number;
}

export async function fetchInvoices(status?: string): Promise<InvoiceListItem[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await invoiceFetch(qs);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
}

export async function fetchInvoiceSummary(): Promise<InvoiceSummary> {
  const res = await invoiceFetch("/summary");
  if (!res.ok) {
    return {
      totalOutstanding: 0, totalOverdue: 0, totalDraft: 0,
      totalPaidThisMonth: 0, invoiceCount: 0, overdueCount: 0,
      averageDaysToPayment: null, currency: "USD",
    };
  }
  const json = await res.json();
  return json.data;
}

export async function fetchARAging(): Promise<ARAgingBucket[]> {
  const res = await invoiceFetch("/aging");
  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
}

export async function fetchInvoice(id: string): Promise<InvoiceListItem | null> {
  const res = await invoiceFetch(`/${id}`);
  if (!res.ok) return null;
  const json = await res.json();
  return json.data;
}

export async function createInvoiceAction(input: {
  customerId?: string;
  customerName: string;
  customerEmail?: string;
  customerAddress?: string;
  issueDate: string;
  dueDate?: string;
  paymentTerms?: string;
  lineItems: { description: string; quantity: number; unitPrice: number; taxRate?: number; accountId?: string }[];
  notes?: string;
  footer?: string;
  taxInclusive?: boolean;
  invoiceNumber?: string;
}): Promise<ActionResult<InvoiceListItem>> {
  const res = await invoiceFetch("", "POST", input);
  if (!res.ok) {
    const tierErr = await parseTierError(res);
    if (tierErr) return { ok: false, error: tierErr };
    return { ok: false, error: { type: "tier_limit", message: "Failed to create invoice", upgradeUrl: "/settings?tab=billing" } };
  }
  const json = await res.json();
  return { ok: true, data: json.data };
}

export async function updateInvoiceAction(id: string, input: {
  customerId?: string | null;
  customerName?: string;
  customerEmail?: string;
  customerAddress?: string;
  paymentTerms?: string;
  issueDate?: string;
  dueDate?: string;
  lineItems?: { description: string; quantity: number; unitPrice: number; taxRate?: number; accountId?: string }[];
  notes?: string;
  footer?: string;
  taxInclusive?: boolean;
}): Promise<InvoiceListItem | null> {
  const res = await invoiceFetch(`/${id}`, "PATCH", input);
  if (!res.ok) return null;
  const json = await res.json();
  return json.data;
}

export async function sendInvoiceAction(id: string, sendEmail: boolean = false): Promise<ActionResult<InvoiceListItem>> {
  const res = await invoiceFetch(`/${id}/send`, "POST", { sendEmail });
  if (!res.ok) {
    const tierErr = await parseTierError(res);
    if (tierErr) return { ok: false, error: tierErr };
    return { ok: true, data: null as unknown as InvoiceListItem };
  }
  const json = await res.json();
  return { ok: true, data: json.data };
}

/** Send email for an already-approved invoice. Upgrades status from 'approved' to 'sent'. */
export async function emailInvoiceAction(id: string): Promise<ActionResult<InvoiceListItem>> {
  const res = await invoiceFetch(`/${id}/email`, "POST");
  if (!res.ok) {
    const tierErr = await parseTierError(res);
    if (tierErr) return { ok: false, error: tierErr };
    return { ok: true, data: null as unknown as InvoiceListItem };
  }
  // Re-fetch the full invoice to get updated status
  const detailRes = await invoiceFetch(`/${id}`);
  if (!detailRes.ok) return { ok: true, data: null as unknown as InvoiceListItem };
  const json = await detailRes.json();
  return { ok: true, data: json.data };
}

export async function recordPaymentAction(id: string, input: {
  amount: number;
  paymentDate: string;
  paymentMethod?: string;
  reference?: string;
  bankAccountId?: string;
}): Promise<ActionResult<InvoiceListItem>> {
  const res = await invoiceFetch(`/${id}/payment`, "POST", input);
  if (!res.ok) {
    const tierErr = await parseTierError(res);
    if (tierErr) return { ok: false, error: tierErr };
    return { ok: true, data: null as unknown as InvoiceListItem };
  }
  const json = await res.json();
  return { ok: true, data: json.data };
}

export async function voidInvoiceAction(id: string): Promise<InvoiceListItem | null> {
  const res = await invoiceFetch(`/${id}/void`, "POST");
  if (!res.ok) return null;
  const json = await res.json();
  return json.data;
}

export async function deleteInvoiceAction(id: string): Promise<boolean> {
  const res = await invoiceFetch(`/${id}`, "DELETE");
  return res.ok;
}

// --- Customers ---------------------------------------------------------------

async function customerFetch(path: string, method = "GET", body?: unknown): Promise<Response> {
  const session = await auth();
  const apiUrl = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";
  if (!session?.apiKey) throw new Error("No authenticated session");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.apiKey}`,
  };
  if (body) headers["Content-Type"] = "application/json";

  return fetch(`${apiUrl}/v1/customers${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
}

export interface CustomerListItem {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxId: string | null;
  paymentTerms: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function fetchCustomers(search?: string): Promise<CustomerListItem[]> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  params.set("active", "true");
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await customerFetch(qs);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
}

export async function createCustomerAction(input: {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  taxId?: string;
  paymentTerms?: string;
  notes?: string;
}): Promise<ActionResult<CustomerListItem>> {
  const res = await customerFetch("", "POST", input);
  if (!res.ok) {
    const tierErr = await parseTierError(res);
    if (tierErr) return { ok: false, error: tierErr };
    return { ok: true, data: null as unknown as CustomerListItem };
  }
  const json = await res.json();
  return { ok: true, data: json.data };
}


"use server";

// ---------------------------------------------------------------------------
// Server actions for dashboard data fetching and mutations.
// These run on the server and are called from client components.
// ---------------------------------------------------------------------------

import { getSessionClient } from "./ledge";
import { getLedgeClient } from "./ledge";
import { auth } from "./auth";
import type {
  TransactionWithLines,
  AccountWithBalance,
  StatementResponse,
  PaginatedResult,
} from "@ledge/sdk";
import type { ApiKeySafe, ApiKeyWithRaw } from "@ledge/sdk";

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

// --- Template application -------------------------------------------------

export async function applyTemplateAction(templateSlug: string): Promise<void> {
  const { ledgerId } = await getSessionClient();
  const adminClient = getLedgeClient();
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
  const apiUrl = process.env.LEDGE_API_URL;
  if (!apiUrl) throw new Error("LEDGE_API_URL not configured");
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
  const apiUrl = process.env.LEDGE_API_URL;
  if (!apiUrl) throw new Error("LEDGE_API_URL not configured");
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

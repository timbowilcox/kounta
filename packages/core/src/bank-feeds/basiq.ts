// ---------------------------------------------------------------------------
// Basiq bank feed provider — Australian open banking via CDR framework.
// Server-to-server API key auth. Supports AU/NZ institutions.
//
// Basiq API docs: https://api.basiq.io/reference
// ---------------------------------------------------------------------------

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  BankFeedProvider,
  CreateConnectionSessionParams,
  CreateConnectionSessionResult,
  FetchTransactionsParams,
  ProviderBankAccount,
  ProviderBankTransaction,
  ProviderConnection,
  WebhookResult,
  WebhookVerificationInput,
  BankConnectionStatus,
  BankTransactionType,
} from "./types.js";
import { toSmallestUnit } from "../currency-utils.js";

/**
 * Verify a Basiq webhook signature (Svix scheme — Basiq's webhook provider).
 *
 * Signed content is `${webhook-id}.${webhook-timestamp}.${rawBody}`. The secret
 * is `whsec_<base64>`; the part after the prefix is base64-decoded to the HMAC
 * key. The signature is HMAC-SHA256 of the signed content, base64-encoded. The
 * `webhook-signature` header is a space-delimited list of `v1,<sig>` entries;
 * the computed signature must match ONE of them (timing-safe). Webhooks more
 * than `toleranceSeconds` (default 5 min) from now are rejected (replay guard).
 *
 * Returns true only when the signature is present, fresh, and valid. Any missing
 * header, malformed secret, stale timestamp, or mismatch returns false — never
 * throws, so the caller fails closed by treating false as "reject".
 */
export const verifyBasiqWebhookSignature = (
  rawBody: string,
  headers: Record<string, string | undefined>,
  secret: string,
  toleranceSeconds = 300,
): boolean => {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatureHeader = headers["webhook-signature"];
  if (!id || !timestamp || !signatureHeader || !secret) return false;

  // Replay guard: reject timestamps too far from now (past or future).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSeconds) return false;

  // Secret: "whsec_<base64>" — base64-decode the part after the prefix.
  const secretBody = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const keyBytes = Buffer.from(secretBody, "base64");
  if (keyBytes.length === 0) return false;

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", keyBytes).update(signedContent, "utf8").digest("base64");
  const expectedBuf = Buffer.from(expected, "utf8");

  // webhook-signature is space-delimited "v1,<base64sig>" entries — match any.
  return signatureHeader.split(" ").some((entry) => {
    const comma = entry.indexOf(",");
    const sig = comma === -1 ? entry : entry.slice(comma + 1);
    const sigBuf = Buffer.from(sig, "utf8");
    if (sigBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(sigBuf, expectedBuf);
  });
};

interface BasiqConfig {
  readonly apiKey: string;
  readonly environment?: "sandbox" | "production";
}

const BASIQ_API_URL = "https://au-api.basiq.io";

export class BasiqProvider implements BankFeedProvider {
  readonly name = "basiq" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(config: BasiqConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = BASIQ_API_URL;
  }

  // -------------------------------------------------------------------------
  // Auth — server-to-server token exchange
  // -------------------------------------------------------------------------

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const response = await fetch(`${this.baseUrl}/token`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${this.apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "basiq-version": "3.0",
      },
      body: "scope=SERVER_ACCESS",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Basiq auth failed (${response.status}): ${body}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "basiq-version": "3.0",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Basiq API error (${response.status} ${method} ${path}): ${text}`);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  // -------------------------------------------------------------------------
  // Provider interface
  // -------------------------------------------------------------------------

  async createConnectionSession(
    params: CreateConnectionSessionParams,
  ): Promise<CreateConnectionSessionResult> {
    // Step 1: Create or find user in Basiq
    const user = await this.request<{ id: string }>("POST", "/users", {
      email: `${params.userId}@kounta.internal`,
      mobile: "+61400000000",
    });

    // Step 2: Create consent URL
    const consent = await this.request<{ links: { public: string } }>(
      "POST",
      `/users/${user.id}/auth_link`,
      {
        ...(params.institutionId ? { institutionId: params.institutionId } : {}),
        redirectUrl: params.redirectUrl,
      },
    );

    return {
      sessionUrl: consent.links.public,
      connectionId: user.id, // Basiq uses user ID as connection scope
    };
  }

  async listConnections(userId: string): Promise<readonly ProviderConnection[]> {
    interface BasiqConnection {
      id: string;
      status: string;
      institution: { id: string; name: string };
      accounts?: { data: BasiqAccount[] };
    }

    interface BasiqAccount {
      id: string;
      name: string;
      accountNo: string;
      bsb?: string;
      class: { type: string };
      currency: string;
      balance: string;
      availableFunds?: string;
    }

    const data = await this.request<{ data: BasiqConnection[] }>(
      "GET",
      `/users/${userId}/connections`,
    );

    return data.data.map((conn): ProviderConnection => ({
      providerConnectionId: conn.id,
      institutionId: conn.institution.id,
      institutionName: conn.institution.name,
      status: mapBasiqStatus(conn.status),
      consentExpiresAt: null,
      accounts: (conn.accounts?.data ?? []).map((acct): ProviderBankAccount => ({
        providerAccountId: acct.id,
        name: acct.name,
        accountNumber: acct.accountNo,
        bsb: acct.bsb ?? null,
        type: acct.class?.type ?? "transaction",
        currency: acct.currency ?? "AUD",
        currentBalance: parseBasiqAmount(acct.balance, acct.currency ?? "AUD"),
        availableBalance: acct.availableFunds ? parseBasiqAmount(acct.availableFunds, acct.currency ?? "AUD") : null,
      })),
    }));
  }

  async listAccounts(connectionId: string): Promise<readonly ProviderBankAccount[]> {
    interface BasiqAccount {
      id: string;
      name: string;
      accountNo: string;
      bsb?: string;
      class: { type: string };
      currency: string;
      balance: string;
      availableFunds?: string;
    }

    const data = await this.request<{ data: BasiqAccount[] }>(
      "GET",
      `/users/${connectionId}/accounts`,
    );

    return data.data.map((acct): ProviderBankAccount => ({
      providerAccountId: acct.id,
      name: acct.name,
      accountNumber: acct.accountNo,
      bsb: acct.bsb ?? null,
      type: acct.class?.type ?? "transaction",
      currency: acct.currency ?? "AUD",
      currentBalance: parseBasiqAmount(acct.balance, acct.currency ?? "AUD"),
      availableBalance: acct.availableFunds ? parseBasiqAmount(acct.availableFunds, acct.currency ?? "AUD") : null,
    }));
  }

  async fetchTransactions(
    params: FetchTransactionsParams,
  ): Promise<readonly ProviderBankTransaction[]> {
    interface BasiqTransaction {
      id: string;
      transactionDate: string;
      amount: string;
      direction: string;
      description: string;
      subClass?: { code: string };
      balance?: string;
    }

    const filter = `account.id.eq('${params.accountId}'),transaction.transactionDate.bt('${params.fromDate}','${params.toDate}')`;
    const data = await this.request<{ data: BasiqTransaction[] }>(
      "GET",
      `/users/${params.connectionId}/transactions?filter=${encodeURIComponent(filter)}&limit=500`,
    );

    return data.data.map((txn): ProviderBankTransaction => ({
      providerTransactionId: txn.id,
      date: txn.transactionDate.slice(0, 10),
      amount: parseBasiqAmount(txn.amount),
      type: (txn.direction === "credit" ? "credit" : "debit") as BankTransactionType,
      description: txn.description,
      reference: null,
      category: txn.subClass?.code ?? null,
      balance: txn.balance ? parseBasiqAmount(txn.balance) : null,
      rawData: txn as unknown as Record<string, unknown>,
    }));
  }

  async disconnect(connectionId: string): Promise<void> {
    await this.request("DELETE", `/users/${connectionId}/connections/${connectionId}`);
  }

  /**
   * Authenticate and interpret an inbound Basiq webhook. FAIL-CLOSED: the
   * signature is verified against BASIQ_WEBHOOK_SECRET BEFORE the payload is
   * interpreted. A missing secret, a missing/invalid signature, or an
   * unparseable body all return shouldSync:false + connectionId:null (zero side
   * effects) so the caller rejects the request with 401/403.
   */
  async handleWebhook(input: WebhookVerificationInput): Promise<WebhookResult> {
    const secret = process.env["BASIQ_WEBHOOK_SECRET"];
    if (!secret) {
      // No signing secret configured — cannot authenticate, so refuse.
      return { event: "webhook_secret_not_configured", connectionId: null, shouldSync: false };
    }

    if (!verifyBasiqWebhookSignature(input.rawBody, input.headers, secret)) {
      return { event: "invalid_signature", connectionId: null, shouldSync: false };
    }

    let data: { type?: string; links?: { user?: string } };
    try {
      data = JSON.parse(input.rawBody) as typeof data;
    } catch {
      return { event: "invalid_payload", connectionId: null, shouldSync: false };
    }

    const event = data.type ?? "unknown";

    // Extract connection ID from user link if available
    const userLink = data.links?.user;
    const connectionId = userLink ? userLink.split("/").pop() ?? null : null;

    return {
      event,
      connectionId,
      shouldSync: event === "connection.completed" || event === "transactions.updated",
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert Basiq decimal string (e.g. "1234.56") to smallest currency unit */
function parseBasiqAmount(value: string, currencyCode = "AUD"): number {
  const num = parseFloat(value);
  return toSmallestUnit(num, currencyCode);
}

/** Map Basiq connection status to our status enum */
function mapBasiqStatus(status: string): BankConnectionStatus {
  switch (status) {
    case "active":
      return "active";
    case "pending":
    case "in_progress":
      return "active";
    case "stale":
    case "degraded":
      return "stale";
    case "invalid":
    case "revoked":
      return "disconnected";
    default:
      return "error";
  }
}

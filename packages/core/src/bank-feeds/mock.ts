// ---------------------------------------------------------------------------
// Mock Plaid provider.
//
// Implements the same BankFeedProvider interface as the (throwing) Plaid stub
// and the live client that will replace it. Emits Plaid-shaped fixtures and
// runs them through normalizePlaidTransaction — the SAME normalisation boundary
// the live client will use — so the entire ingest -> categorise -> reconcile
// loop can be developed before live Plaid credentials exist.
//
// FAIL-CLOSED: constructing this in production throws. The mock is only ever a
// development/test convenience and must never serve real bank data.
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
  ProviderSyncResult,
  SyncTransactionsParams,
  WebhookResult,
  WebhookVerificationInput,
} from "./types.js";
import { normalizePlaidTransaction } from "./normalize.js";
import { getSyncPage, labeledFixtures, MOCK_ACCOUNT_ID } from "./fixtures.js";

export interface MockProviderConfig {
  /** Override of NODE_ENV, for exercising the production guard in tests. */
  readonly nodeEnv?: string;
  /** Optional webhook secret; when set, handleWebhook verifies signatures. */
  readonly webhookSecret?: string;
}

const MOCK_CONNECTION_ID = "mock_conn_001";

export class MockPlaidProvider implements BankFeedProvider {
  readonly name = "mock" as const;
  private readonly webhookSecret: string | null;

  constructor(config: MockProviderConfig = {}) {
    const env = config.nodeEnv ?? process.env["NODE_ENV"];
    if (env === "production") {
      throw new Error(
        "Mock bank feed provider must not be used in production. " +
          "Configure a real provider via BANK_FEED_PROVIDER.",
      );
    }
    this.webhookSecret = config.webhookSecret ?? null;
  }

  async createConnectionSession(
    params: CreateConnectionSessionParams,
  ): Promise<CreateConnectionSessionResult> {
    return {
      sessionUrl: `https://mock.plaid.local/link?redirect=${encodeURIComponent(params.redirectUrl)}`,
      connectionId: MOCK_CONNECTION_ID,
    };
  }

  async listConnections(_userId: string): Promise<readonly ProviderConnection[]> {
    return [
      {
        providerConnectionId: MOCK_CONNECTION_ID,
        institutionId: "ins_mock",
        institutionName: "Mock Bank (Plaid Sandbox)",
        status: "active",
        consentExpiresAt: null,
        accounts: await this.listAccounts(MOCK_CONNECTION_ID),
      },
    ];
  }

  async listAccounts(_connectionId: string): Promise<readonly ProviderBankAccount[]> {
    return [
      {
        providerAccountId: MOCK_ACCOUNT_ID,
        name: "Mock Business Checking",
        accountNumber: "000123456",
        bsb: "062-000",
        type: "transaction",
        currency: "AUD",
        currentBalance: 1_250_00,
        availableBalance: 1_180_00,
      },
    ];
  }

  /**
   * Date-range pull (Basiq-style). Provided for interface completeness; the
   * engine prefers syncTransactions when available. Returns the current posted
   * fixture set filtered to the requested window.
   */
  async fetchTransactions(
    params: FetchTransactionsParams,
  ): Promise<readonly ProviderBankTransaction[]> {
    return labeledFixtures
      .map((f) => normalizePlaidTransaction(f.plaid))
      .filter((t) => t.date >= params.fromDate && t.date <= params.toDate);
  }

  /**
   * Cursor-based incremental sync (Plaid /transactions/sync model). Returns one
   * scripted page per cursor, normalised to the internal representation.
   */
  async syncTransactions(
    _params: SyncTransactionsParams,
    cursor: string | null,
  ): Promise<ProviderSyncResult> {
    const page = getSyncPage(cursor);
    return {
      added: page.added.map(normalizePlaidTransaction),
      modified: page.modified.map(normalizePlaidTransaction),
      removed: page.removed.map((r) => r.transaction_id),
      nextCursor: page.next_cursor,
      hasMore: page.has_more,
    };
  }

  async disconnect(_connectionId: string): Promise<void> {
    // No-op: nothing to tear down for the mock.
  }

  /**
   * Plaid-style webhook. Emulates the production signature-verification pattern
   * (HMAC-SHA256 over the raw body + timing-safe compare) when a secret is
   * configured; otherwise accepts the payload (dev only — the constructor
   * already refuses production). Signals a sync for transaction update events.
   */
  async handleWebhook(input: WebhookVerificationInput): Promise<WebhookResult> {
    if (this.webhookSecret) {
      const signature = input.headers["x-webhook-signature"] ?? "";
      const expected = createHmac("sha256", this.webhookSecret)
        .update(input.rawBody, "utf8")
        .digest("hex");
      const sigBuf = Buffer.from(signature, "utf8");
      const expBuf = Buffer.from(expected, "utf8");
      const ok = sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
      if (!ok) {
        return { event: "invalid_signature", connectionId: null, shouldSync: false };
      }
    }

    let body: { webhook_type?: string; webhook_code?: string; item_id?: string };
    try {
      body = JSON.parse(input.rawBody) as typeof body;
    } catch {
      return { event: "invalid_payload", connectionId: null, shouldSync: false };
    }

    const code = body.webhook_code ?? "";
    const shouldSync =
      body.webhook_type === "TRANSACTIONS" &&
      (code === "SYNC_UPDATES_AVAILABLE" ||
        code === "DEFAULT_UPDATE" ||
        code === "INITIAL_UPDATE");

    return {
      event: `${body.webhook_type ?? "UNKNOWN"}.${code || "UNKNOWN"}`,
      connectionId: body.item_id ?? null,
      shouldSync,
    };
  }
}

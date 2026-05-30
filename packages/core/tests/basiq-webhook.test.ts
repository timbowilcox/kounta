// ---------------------------------------------------------------------------
// Basiq webhook signature verification — FAIL-CLOSED proof.
//
// Basiq signs webhooks with the Svix scheme: signed content is
// `${webhook-id}.${webhook-timestamp}.${rawBody}`, HMAC-SHA256 with the
// base64-decoded secret body, base64-encoded, presented as space-delimited
// `v1,<sig>` entries in the `webhook-signature` header.
//
// DoD: valid signature -> processed; missing/invalid signature, missing secret,
// or stale timestamp -> rejected with ZERO side effects (shouldSync:false,
// connectionId:null).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { BasiqProvider, verifyBasiqWebhookSignature } from "../src/bank-feeds/basiq.js";

// A deterministic 32-byte signing key, presented to the provider as whsec_<b64>.
const KEY_BYTES = Buffer.from("kounta-test-basiq-signing-key!!!", "utf8"); // 32 bytes
const SECRET_BODY = KEY_BYTES.toString("base64");
const SECRET = `whsec_${SECRET_BODY}`;
const ENV = "BASIQ_WEBHOOK_SECRET";

const WEBHOOK_ID = "msg_2abc";

/** Build a correctly-signed Svix header set for a given body + timestamp. */
const sign = (rawBody: string, timestampSec: number): Record<string, string> => {
  const signedContent = `${WEBHOOK_ID}.${timestampSec}.${rawBody}`;
  const sig = createHmac("sha256", KEY_BYTES).update(signedContent, "utf8").digest("base64");
  return {
    "webhook-id": WEBHOOK_ID,
    "webhook-timestamp": String(timestampSec),
    "webhook-signature": `v1,${sig}`,
  };
};

const now = () => Math.floor(Date.now() / 1000);

describe("verifyBasiqWebhookSignature", () => {
  const rawBody = JSON.stringify({ type: "transactions.updated", links: { user: "/users/u_1" } });

  it("accepts a correctly-signed, fresh webhook", () => {
    const headers = sign(rawBody, now());
    expect(verifyBasiqWebhookSignature(rawBody, headers, SECRET)).toBe(true);
  });

  it("accepts when one of several space-delimited signatures matches", () => {
    const ts = now();
    const good = sign(rawBody, ts)["webhook-signature"];
    const headers = {
      "webhook-id": WEBHOOK_ID,
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,AAAprefixBogus ${good}`,
    };
    expect(verifyBasiqWebhookSignature(rawBody, headers, SECRET)).toBe(true);
  });

  it("rejects a tampered body (signature no longer matches)", () => {
    const headers = sign(rawBody, now());
    expect(verifyBasiqWebhookSignature(rawBody + "x", headers, SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const headers = sign(rawBody, now());
    expect(verifyBasiqWebhookSignature(rawBody, headers, "whsec_" + Buffer.from("other-key").toString("base64"))).toBe(false);
  });

  it("rejects a stale timestamp (replay guard)", () => {
    const headers = sign(rawBody, now() - 600); // 10 min ago
    expect(verifyBasiqWebhookSignature(rawBody, headers, SECRET)).toBe(false);
  });

  it("rejects when any required header is missing", () => {
    const headers = sign(rawBody, now());
    expect(verifyBasiqWebhookSignature(rawBody, { ...headers, "webhook-signature": undefined }, SECRET)).toBe(false);
    expect(verifyBasiqWebhookSignature(rawBody, { ...headers, "webhook-id": undefined }, SECRET)).toBe(false);
    expect(verifyBasiqWebhookSignature(rawBody, { ...headers, "webhook-timestamp": undefined }, SECRET)).toBe(false);
  });

  it("rejects an empty secret", () => {
    const headers = sign(rawBody, now());
    expect(verifyBasiqWebhookSignature(rawBody, headers, "")).toBe(false);
  });
});

describe("BasiqProvider.handleWebhook — fail closed", () => {
  let original: string | undefined;
  const provider = new BasiqProvider({ apiKey: "test_api_key" });

  beforeEach(() => {
    original = process.env[ENV];
  });
  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  it("processes a valid signed sync event", async () => {
    process.env[ENV] = SECRET;
    const rawBody = JSON.stringify({ type: "transactions.updated", links: { user: "/users/u_42" } });
    const result = await provider.handleWebhook({ rawBody, headers: sign(rawBody, now()) });
    expect(result.shouldSync).toBe(true);
    expect(result.event).toBe("transactions.updated");
    expect(result.connectionId).toBe("u_42");
  });

  it("processes a valid signed non-sync event without triggering a sync", async () => {
    process.env[ENV] = SECRET;
    const rawBody = JSON.stringify({ type: "connection.deleted", links: { user: "/users/u_7" } });
    const result = await provider.handleWebhook({ rawBody, headers: sign(rawBody, now()) });
    expect(result.event).toBe("connection.deleted");
    expect(result.shouldSync).toBe(false);
  });

  it("rejects with zero side effects when the signature is invalid", async () => {
    process.env[ENV] = SECRET;
    const rawBody = JSON.stringify({ type: "transactions.updated", links: { user: "/users/u_42" } });
    const headers = sign(rawBody, now());
    // Tamper the body after signing.
    const result = await provider.handleWebhook({ rawBody: rawBody + "tampered", headers });
    expect(result.event).toBe("invalid_signature");
    expect(result.shouldSync).toBe(false);
    expect(result.connectionId).toBeNull();
  });

  it("rejects with zero side effects when no secret is configured", async () => {
    delete process.env[ENV];
    const rawBody = JSON.stringify({ type: "transactions.updated", links: { user: "/users/u_42" } });
    const result = await provider.handleWebhook({ rawBody, headers: sign(rawBody, now()) });
    expect(result.event).toBe("webhook_secret_not_configured");
    expect(result.shouldSync).toBe(false);
    expect(result.connectionId).toBeNull();
  });

  it("rejects with zero side effects when signature headers are absent", async () => {
    process.env[ENV] = SECRET;
    const rawBody = JSON.stringify({ type: "transactions.updated", links: { user: "/users/u_42" } });
    const result = await provider.handleWebhook({ rawBody, headers: {} });
    expect(result.shouldSync).toBe(false);
    expect(result.connectionId).toBeNull();
  });
});

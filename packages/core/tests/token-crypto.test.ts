// ---------------------------------------------------------------------------
// Token encryption — FAIL-CLOSED proof.
//
// The crypto/tokens module must NEVER fall back to plaintext. These tests
// inject each failure mode and assert it fails closed:
//   - no key configured        -> encrypt/decrypt THROW (never return plaintext)
//   - malformed key            -> THROW
//   - corrupt/tampered ciphertext -> decrypt THROWS (GCM auth-tag check)
//   - wrong key                -> decrypt THROWS
//   - non-encrypted stored value -> decrypt THROWS (never returns plaintext)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptToken, decryptToken, isEncrypted, TokenEncryptionError } from "../src/crypto/tokens.js";

const KEY_A = "a".repeat(64); // 32 bytes, valid hex
const KEY_B = "b".repeat(64); // a different valid key
const ENV = "KOUNTA_TOKEN_ENCRYPTION_KEY";

describe("token encryption — fail-closed", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[ENV];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  describe("with a valid key configured", () => {
    beforeEach(() => {
      process.env[ENV] = KEY_A;
    });

    it("round-trips a token and produces an enc:-prefixed envelope", () => {
      const plaintext = "sk_live_super_secret_token";
      const enc = encryptToken(plaintext);
      expect(isEncrypted(enc)).toBe(true);
      expect(enc).not.toContain(plaintext); // ciphertext, not the secret
      expect(decryptToken(enc)).toBe(plaintext);
    });

    it("produces a fresh IV each call (no deterministic ciphertext)", () => {
      const a = encryptToken("same-input");
      const b = encryptToken("same-input");
      expect(a).not.toBe(b);
      expect(decryptToken(a)).toBe("same-input");
      expect(decryptToken(b)).toBe("same-input");
    });

    it("THROWS on a tampered/corrupt ciphertext rather than returning plaintext", () => {
      const enc = encryptToken("secret");
      // Flip the last hex char of the ciphertext segment.
      const flipped = enc.slice(0, -1) + (enc.endsWith("0") ? "1" : "0");
      expect(() => decryptToken(flipped)).toThrow();
    });

    it("THROWS on a non-encrypted stored value (never returns it as plaintext)", () => {
      expect(() => decryptToken("sk_test_plaintext_leak")).toThrow(TokenEncryptionError);
    });

    it("THROWS on a malformed envelope", () => {
      expect(() => decryptToken("enc:not-enough-parts")).toThrow(TokenEncryptionError);
    });
  });

  describe("wrong key", () => {
    it("THROWS when decrypting with a different key (no plaintext leak)", () => {
      process.env[ENV] = KEY_A;
      const enc = encryptToken("secret");
      process.env[ENV] = KEY_B;
      expect(() => decryptToken(enc)).toThrow();
    });
  });

  describe("no key configured", () => {
    beforeEach(() => {
      delete process.env[ENV];
    });

    it("encryptToken THROWS instead of returning plaintext", () => {
      expect(() => encryptToken("secret")).toThrow(TokenEncryptionError);
    });

    it("decryptToken THROWS instead of returning plaintext", () => {
      // Even a value that looks like a plaintext token must not be returned.
      expect(() => decryptToken("sk_test_plaintext")).toThrow(TokenEncryptionError);
    });
  });

  describe("malformed key", () => {
    it("THROWS on a too-short key", () => {
      process.env[ENV] = "deadbeef"; // 8 chars
      expect(() => encryptToken("secret")).toThrow(TokenEncryptionError);
    });

    it("THROWS on a 64-char non-hex key", () => {
      process.env[ENV] = "z".repeat(64);
      expect(() => encryptToken("secret")).toThrow(TokenEncryptionError);
    });
  });
});

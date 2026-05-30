// ---------------------------------------------------------------------------
// Token encryption — AES-256-GCM encryption for sensitive tokens at rest.
//
// Used to encrypt Stripe OAuth tokens before storing in the database.
// Requires the KOUNTA_TOKEN_ENCRYPTION_KEY environment variable (64 hex chars
// = 32 bytes).
//
// FAIL-CLOSED: there is NO plaintext fallback. If the key is missing or
// invalid, encrypt/decrypt THROW rather than silently storing or returning a
// secret in cleartext (storing API keys/tokens in cleartext is forbidden — see
// CLAUDE.md). Decryption of a tampered/corrupt or non-encrypted value also
// throws; a token is never returned in plaintext.
// ---------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag
const ENCRYPTED_PREFIX = "enc:";

/** Thrown when token encryption/decryption cannot be performed safely. */
export class TokenEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenEncryptionError";
  }
}

/**
 * Get the encryption key from the environment, or THROW.
 *
 * Fail-closed: a missing or malformed key is a configuration error, not a
 * reason to fall back to plaintext.
 */
const getEncryptionKey = (): Buffer => {
  const keyHex = process.env.KOUNTA_TOKEN_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new TokenEncryptionError(
      "KOUNTA_TOKEN_ENCRYPTION_KEY is not set. Set it to 64 hex characters (32 bytes) to enable token encryption.",
    );
  }

  if (keyHex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new TokenEncryptionError(
      "KOUNTA_TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).",
    );
  }

  return Buffer.from(keyHex, "hex");
};

/**
 * Encrypt a plaintext token for storage.
 *
 * Output format: "enc:<iv_hex>:<authTag_hex>:<ciphertext_hex>".
 * Throws (TokenEncryptionError) if no valid encryption key is configured —
 * never returns the plaintext.
 */
export const encryptToken = (plaintext: string): string => {
  const key = getEncryptionKey();

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
};

/**
 * Decrypt a stored token.
 *
 * Fail-closed: the value MUST be an "enc:"-prefixed ciphertext produced by
 * encryptToken, and the key must be configured. A missing key, a non-encrypted
 * value, a malformed envelope, or a failed GCM auth-tag check all THROW — a
 * token is never returned in plaintext.
 */
export const decryptToken = (stored: string): string => {
  const key = getEncryptionKey();

  if (!stored.startsWith(ENCRYPTED_PREFIX)) {
    throw new TokenEncryptionError(
      "Stored token is not encrypted (missing 'enc:' prefix). Refusing to return it as plaintext.",
    );
  }

  const parts = stored.slice(ENCRYPTED_PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new TokenEncryptionError("Malformed encrypted token");
  }

  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  // .final() throws if the auth tag does not match (tampered/corrupt ciphertext).
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString("utf8");
};

/**
 * Check if a stored value is encrypted.
 */
export const isEncrypted = (value: string): boolean => value.startsWith(ENCRYPTED_PREFIX);

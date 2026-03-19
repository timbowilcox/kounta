// ---------------------------------------------------------------------------
// Token encryption — AES-256-GCM encryption for sensitive tokens at rest.
//
// Used to encrypt Stripe OAuth tokens before storing in the database.
// Requires KOUNTA_TOKEN_ENCRYPTION_KEY environment variable (64 hex chars = 32 bytes).
// If the key is not set, falls back to plaintext (with a warning).
// ---------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag
const ENCRYPTED_PREFIX = "enc:";

/**
 * Get the encryption key from environment.
 * Returns null if not configured (plaintext fallback).
 */
const getEncryptionKey = (): Buffer | null => {
  const keyHex = process.env.KOUNTA_TOKEN_ENCRYPTION_KEY;
  if (!keyHex) return null;

  if (keyHex.length !== 64) {
    console.warn(
      "[kounta/crypto] KOUNTA_TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes). Token encryption disabled.",
    );
    return null;
  }

  return Buffer.from(keyHex, "hex");
};

/**
 * Encrypt a plaintext token for storage.
 *
 * Output format: "enc:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 * If no encryption key is configured, returns the plaintext unchanged.
 */
export const encryptToken = (plaintext: string): string => {
  const key = getEncryptionKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
};

/**
 * Decrypt a stored token.
 *
 * If the value doesn't have the "enc:" prefix, it's treated as plaintext
 * (backward compatibility with pre-encryption data).
 */
export const decryptToken = (stored: string): string => {
  if (!stored.startsWith(ENCRYPTED_PREFIX)) {
    // Plaintext value (legacy or encryption not enabled)
    return stored;
  }

  const key = getEncryptionKey();
  if (!key) {
    console.warn(
      "[kounta/crypto] Found encrypted token but KOUNTA_TOKEN_ENCRYPTION_KEY is not set. Cannot decrypt.",
    );
    throw new Error("Encrypted token found but no encryption key configured");
  }

  const parts = stored.slice(ENCRYPTED_PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted token");
  }

  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString("utf8");
};

/**
 * Check if a stored value is encrypted.
 */
export const isEncrypted = (value: string): boolean => value.startsWith(ENCRYPTED_PREFIX);

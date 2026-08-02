import crypto from "node:crypto";

/**
 * Return the AES-256 key material without ever persisting the source secret.
 * Keeping normalization here ensures encryption and the continuity fingerprint
 * are derived from exactly the same key bytes.
 */
export function getEmailEncryptionKey(): Buffer {
  const value = process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;
  if (!value) {
    throw new Error("INGENIUM_EMAIL_ENCRYPTION_KEY environment variable not set (32-byte hex)");
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }
  if (/^[A-Za-z0-9_-]{64}$/.test(value)) {
    return crypto.createHash("sha256").update(value, "utf8").digest();
  }
  throw new Error("INGENIUM_EMAIL_ENCRYPTION_KEY must be 32 bytes (64 hex chars) or a 64-character base64url secret");
}

/** A non-reversible marker used only to detect encryption-key continuity. */
export function getEmailEncryptionKeyFingerprint(): string {
  return crypto.createHash("sha256")
    .update(getEmailEncryptionKey())
    .digest("hex");
}

/**
 * Encrypt string data with AES-256-GCM using a fresh IV for every value.
 * Stored values are base64([16-byte IV | 16-byte auth tag | ciphertext]) so
 * decryption can recover the per-value GCM inputs without separate columns.
 */
export function encryptCredentialValue(data: string): string {
  const key = getEmailEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(data, "utf-8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

/**
 * Decrypt a base64([16-byte IV | 16-byte auth tag | ciphertext]) credential
 * value. Authentication failures throw.
 */
export function decryptCredentialValue(encrypted: string): string {
  const key = getEmailEncryptionKey();
  const combined = Buffer.from(encrypted, "base64");
  if (combined.length < 32) {
    throw new Error("Encrypted credential payload is malformed");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, combined.subarray(0, 16));
  decipher.setAuthTag(combined.subarray(16, 32));
  return Buffer.concat([
    decipher.update(combined.subarray(32)),
    decipher.final(),
  ]).toString("utf-8");
}

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

type VaultCryptoBufferObserver = (kind: "decrypt_update" | "decrypt_final", buffer: Buffer) => void;
let vaultCryptoBufferObserver: VaultCryptoBufferObserver | undefined;

/** Test-only seam proving AES-GCM temporary plaintext chunks are wiped. */
export function configureVaultCryptoBufferObserverForTesting(
  observer?: VaultCryptoBufferObserver,
): () => void {
  const previous = vaultCryptoBufferObserver;
  vaultCryptoBufferObserver = observer;
  return () => {
    vaultCryptoBufferObserver = previous;
  };
}

function zeroDecryptTemporary(kind: "decrypt_update" | "decrypt_final", buffer: Buffer): void {
  buffer.fill(0);
  vaultCryptoBufferObserver?.(kind, buffer);
}

/** Derive a 256-bit vault key from a passphrase using scrypt. */
export function deriveKey(
  passphrase: string,
  salt: Buffer,
  params: { N?: number; r?: number; p?: number } = {},
): Buffer {
  const N = params.N ?? 16_384;
  const r = params.r ?? 8;
  const p = params.p ?? 1;
  return scryptSync(passphrase, salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem: 128 * N * r + 1024 * 1024,
  });
}

/** Encrypt buffer plaintext with AES-256-GCM as IV || ciphertext || authentication tag. */
export function encryptSecretBuffer(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
}

/** Encrypt UTF-8 string plaintext with AES-256-GCM. */
export function encryptSecret(plaintext: string, key: Buffer): Buffer {
  const plaintextBuffer = Buffer.from(plaintext, "utf8");
  try {
    return encryptSecretBuffer(plaintextBuffer, key);
  } finally {
    plaintextBuffer.fill(0);
  }
}

/** Decrypt an AES-256-GCM payload into a Buffer without string conversion. */
export function decryptSecretBuffer(ciphertext: Buffer, key: Buffer): Buffer {
  if (ciphertext.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted vault payload");
  }

  const iv = ciphertext.subarray(0, IV_LENGTH);
  const tag = ciphertext.subarray(ciphertext.length - AUTH_TAG_LENGTH);
  const encrypted = ciphertext.subarray(IV_LENGTH, ciphertext.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  let update: Buffer | undefined;
  let final: Buffer | undefined;
  try {
    decipher.setAuthTag(tag);
    update = decipher.update(encrypted);
    final = decipher.final();
    const plaintext = Buffer.allocUnsafe(update.length + final.length);
    update.copy(plaintext);
    final.copy(plaintext, update.length);
    return plaintext;
  } finally {
    if (update) zeroDecryptTemporary("decrypt_update", update);
    if (final) zeroDecryptTemporary("decrypt_final", final);
  }
}

/** Backward-compatible buffer decryptor. */
export function decryptSecret(ciphertext: Buffer, key: Buffer): Buffer {
  return decryptSecretBuffer(ciphertext, key);
}

/** Generate a random 256-bit data encryption key. */
export function generateDEK(): Buffer {
  return randomBytes(KEY_LENGTH);
}

/** Wrap a data encryption key using AES-256-GCM. */
export function wrapKey(key: Buffer, wrappingKey: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", wrappingKey, iv);
  const encrypted = Buffer.concat([cipher.update(key), cipher.final()]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]);
}

/** Unwrap a data encryption key encrypted by wrapKey. */
export function unwrapKey(wrapped: Buffer, wrappingKey: Buffer): Buffer {
  return decryptSecretBuffer(wrapped, wrappingKey);
}

/** Generate a random 256-bit vault salt. */
export function generateSalt(): Buffer {
  return randomBytes(KEY_LENGTH);
}

/** Verify a SHA-256 HMAC in constant time. */
export function verifyHMAC(key: Buffer, data: Buffer, tag: Buffer): boolean {
  const expected = createHmac("sha256", key).update(data).digest();
  return expected.length === tag.length && timingSafeEqual(expected, tag);
}

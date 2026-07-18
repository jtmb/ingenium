import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  deriveKey,
  decryptSecret,
  encryptSecret,
  generateSalt,
  unwrapKey,
  wrapKey,
} from "../lib/tools/vault-crypto.js";

const knownSalt = Buffer.from(
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  "hex",
);
const expectedDerivedKey = "b39df7474993e518bd25ea78259d612092a21fafea89d1b5718a5830f5f36320";

describe("vault crypto", () => {
  it("derives the scrypt known-answer key", () => {
    expect(deriveKey("test-passphrase", knownSalt).toString("hex")).toBe(expectedDerivedKey);
  });

  it("round-trips AES-256-GCM ciphertext", () => {
    const key = randomBytes(32);
    expect(decryptSecret(encryptSecret("secret", key), key).toString("utf8")).toBe("secret");
  });

  it("uses a unique IV for each encryption", () => {
    const key = randomBytes(32);
    expect(encryptSecret("same plaintext", key)).not.toEqual(encryptSecret("same plaintext", key));
  });

  it("rejects tampered ciphertext", () => {
    const key = randomBytes(32);
    const encrypted = encryptSecret("secret", key);
    encrypted[12] ^= 1;
    expect(() => decryptSecret(encrypted, key)).toThrow();
  });

  it("round-trips an empty plaintext", () => {
    const key = randomBytes(32);
    expect(decryptSecret(encryptSecret("", key), key).toString("utf8")).toBe("");
  });

  it("round-trips Unicode plaintext", () => {
    const key = randomBytes(32);
    expect(decryptSecret(encryptSecret("🔑 secret with emoji", key), key).toString("utf8")).toBe("🔑 secret with emoji");
  });

  it("round-trips a 10KB plaintext", () => {
    const key = randomBytes(32);
    const plaintext = "a".repeat(10 * 1024);
    expect(decryptSecret(encryptSecret(plaintext, key), key).toString("utf8")).toBe(plaintext);
  });

  it("wraps and unwraps a DEK", () => {
    const wrappingKey = randomBytes(32);
    const dek = randomBytes(32);
    expect(unwrapKey(wrapKey(dek, wrappingKey), wrappingKey)).toEqual(dek);
  });

  it("rejects an incorrect unwrapping key", () => {
    const wrapped = wrapKey(randomBytes(32), randomBytes(32));
    expect(() => unwrapKey(wrapped, randomBytes(32))).toThrow();
  });

  it("generates 32-byte salts", () => {
    expect(generateSalt()).toHaveLength(32);
  });
});

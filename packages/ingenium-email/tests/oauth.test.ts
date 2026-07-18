import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock ingenium-core so settings.setSetting/getSetting don't hit real SQLite
vi.mock("ingenium-core", () => {
  const store = new Map<string, string>();
  return {
    settings: {
      getSetting: vi.fn((_projectId: string, key: string) => store.get(key) ?? null),
      setSetting: vi.fn((_projectId: string, key: string, value: string) => {
        store.set(key, value);
      }),
    },
    getDb: vi.fn(() => ({
      prepare: vi.fn((sql: string) => ({
        all: vi.fn(() => {
          const entries: Array<{ key: string; value: string }> = [];
          for (const [k, v] of store.entries()) {
            entries.push({ key: k, value: v });
          }
          return entries;
        }),
        get: vi.fn(() => ({ id: "global-project-id" })),
        run: vi.fn((...bindParams: string[]) => {
          // Sync DELETE statements back to the store Map
          if (sql.startsWith("DELETE FROM settings")) {
            const key = bindParams[1];
            if (key) store.delete(key);
          }
        }),
      })),
    })),
  };
});

// ── Encryption round-trip tests ──────────────────────────────────────────

const TEST_KEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"; // 64 hex chars = 32 bytes

describe("encryptCredentials / decryptCredentials", () => {
  beforeAll(() => {
    process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    delete process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;
  });

  it("should round-trip a simple string", async () => {
    // Dynamic import so env is set before module loads
    const { encryptCredentials, decryptCredentials } = await import("../lib/oauth.js");
    const original = "my-secret-app-password-123";
    const encrypted = encryptCredentials(original);
    expect(encrypted).toBeDefined();
    expect(encrypted).not.toBe(original);
    // Base64 encoded
    expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+$/);

    const decrypted = decryptCredentials(encrypted);
    expect(decrypted).toBe(original);
  });

  it("should produce different ciphertexts for the same input (unique IV)", async () => {
    const { encryptCredentials } = await import("../lib/oauth.js");
    const original = "same-value";
    const a = encryptCredentials(original);
    const b = encryptCredentials(original);
    expect(a).not.toBe(b);
  });

  it("should round-trip an empty string", async () => {
    const { encryptCredentials, decryptCredentials } = await import("../lib/oauth.js");
    const encrypted = encryptCredentials("");
    const decrypted = decryptCredentials(encrypted);
    expect(decrypted).toBe("");
  });

  it("should round-trip long Unicode strings", async () => {
    const { encryptCredentials, decryptCredentials } = await import("../lib/oauth.js");
    const original = "héllo wörld 🔐 你好 🎉".repeat(100);
    const encrypted = encryptCredentials(original);
    const decrypted = decryptCredentials(encrypted);
    expect(decrypted).toBe(original);
  });

  it("should support a 64-character base64url secret", async () => {
    process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = "A".repeat(63) + "-";
    const { encryptCredentials, decryptCredentials } = await import("../lib/oauth.js");
    const encrypted = encryptCredentials("base64url-secret");
    expect(decryptCredentials(encrypted)).toBe("base64url-secret");
    process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = TEST_KEY;
  });

  it("should throw on missing key", async () => {
    delete process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;
    const { encryptCredentials } = await import("../lib/oauth.js");
    expect(() => encryptCredentials("test")).toThrow("INGENIUM_EMAIL_ENCRYPTION_KEY");
  });

  it("should throw on wrong-length key", async () => {
    process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = "tooshort";
    const { encryptCredentials } = await import("../lib/oauth.js");
    expect(() => encryptCredentials("test")).toThrow("must be 32 bytes");
  });

  it("should throw on tampered ciphertext (auth tag mismatch)", async () => {
    process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = TEST_KEY;
    const { encryptCredentials, decryptCredentials } = await import("../lib/oauth.js");
    const encrypted = encryptCredentials("secret-data");
    // Tamper with the ciphertext portion
    const buf = Buffer.from(encrypted, "base64");
    buf[30] ^= 0xff; // flip bits in auth tag
    const tampered = buf.toString("base64");
    expect(() => decryptCredentials(tampered)).toThrow();
  });

  it("should not leak the original data in the encrypted output", async () => {
    const { encryptCredentials } = await import("../lib/oauth.js");
    const original = "super-secret-password";
    const encrypted = encryptCredentials(original);
    const b64 = Buffer.from(encrypted, "base64").toString("base64");
    expect(b64).not.toContain("secret");
    expect(b64).not.toContain("password");
  });
});

describe("getOAuthUrl / exchangeCode", () => {
  it("should generate a non-empty URL and state", async () => {
    const { getOAuthUrl } = await import("../lib/oauth.js");
    const result = await getOAuthUrl("gmail");
    expect(result.url).toContain("accounts.google.com");
    expect(result.state).toBeDefined();
    expect(result.state.length).toBeGreaterThan(0);
  });

  it("should generate a random state for each call", async () => {
    const { getOAuthUrl } = await import("../lib/oauth.js");
    const a = await getOAuthUrl("gmail");
    const b = await getOAuthUrl("gmail");
    expect(a.state).not.toBe(b.state);
  });

  it("should throw for unsupported exchange provider", async () => {
    // Seed an OAuth state so state validation passes and we reach the "not supported" check
    const { settings } = await import("ingenium-core");
    settings.setSetting("gh-llm-bootstrap", "oauth_state_yahoo", "test-state-123");
    const { exchangeCode } = await import("../lib/oauth.js");
    await expect(exchangeCode("yahoo" as any, "code123", "test-state-123")).rejects.toThrow("not supported");
  });
});

describe("storeTokens / getValidTokens", () => {
  beforeAll(() => {
    process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    delete process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;
  });

  it("should return null for non-existent account", async () => {
    const { getValidTokens } = await import("../lib/oauth.js");
    const result = await getValidTokens("test-project", "nonexistent-id", "gmail");
    expect(result).toBeNull();
  });
});

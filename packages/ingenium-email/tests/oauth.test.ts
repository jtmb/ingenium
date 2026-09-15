import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { configureEmailRuntime, resetEmailRuntimeForTest } from "../lib/runtime.js";
import { createMemoryEmailRuntime } from "./runtime-fixture.js";

const coreMockState = vi.hoisted(() => ({
  settings: new Map<string, string>(),
}));

const msalMockState = vi.hoisted(() => ({
  configurations: [] as Array<{ clientId: string; clientSecret: string }>,
  refreshes: [] as Array<{ refreshToken: string }>,
}));

const googleMockState = vi.hoisted(() => ({
  configurations: [] as Array<{ clientId: string; clientSecret: string; redirectUri: string }>,
  credentials: [] as Array<{ refresh_token?: string }>,
}));

const mockSettingKey = (projectId: string, key: string): string => `${projectId}\u0000${key}`;

// Mock ingenium-core so settings.setSetting/getSetting don't hit real SQLite
vi.mock("ingenium-core", () => {
  return {
    settings: {
      getSetting: vi.fn((projectId: string, key: string) => coreMockState.settings.get(mockSettingKey(projectId, key)) ?? null),
      setSetting: vi.fn((projectId: string, key: string, value: string) => {
        coreMockState.settings.set(mockSettingKey(projectId, key), value);
      }),
    },
    getDb: vi.fn(() => ({
      prepare: vi.fn((sql: string) => ({
        all: vi.fn(() => {
          const entries: Array<{ project_id: string; key: string; value: string }> = [];
          for (const [compoundKey, value] of coreMockState.settings.entries()) {
            const separator = compoundKey.indexOf("\u0000");
            entries.push({
              project_id: compoundKey.slice(0, separator),
              key: compoundKey.slice(separator + 1),
              value,
            });
          }
          return entries;
        }),
        get: vi.fn((projectId?: string, key?: string) => {
          if (sql.startsWith("SELECT id FROM projects")) return { id: "global-project-id" };
          const value = projectId && key ? coreMockState.settings.get(mockSettingKey(projectId, key)) : undefined;
          return value === undefined ? undefined : { value };
        }),
        run: vi.fn((...bindParams: unknown[]) => {
          if (sql.startsWith("DELETE FROM settings")) {
            const projectId = bindParams[0];
            const key = bindParams[1];
            if (typeof projectId === "string" && typeof key === "string") {
              coreMockState.settings.delete(mockSettingKey(projectId, key));
            }
          }
        }),
      })),
    })),
    execTransaction: <T>(operation: () => T): T => operation(),
    checkpointAfterWrite: vi.fn(),
  };
});

vi.mock("google-auth-library", () => {
  class OAuth2Client {
    constructor(
      clientId: string,
      clientSecret: string,
      redirectUri: string,
    ) {
      googleMockState.configurations.push({ clientId, clientSecret, redirectUri });
    }

    generateAuthUrl(options: { state: string }): string {
      const config = googleMockState.configurations[googleMockState.configurations.length - 1];
      return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(config?.clientId ?? "")}&state=${encodeURIComponent(options.state)}`;
    }

    setCredentials(credentials: { refresh_token?: string }): void {
      googleMockState.credentials.push({ ...credentials });
    }

    async refreshAccessToken(): Promise<{ credentials: Record<string, string | number> }> {
      return {
        credentials: {
          access_token: "global-gmail-access-token",
          refresh_token: "global-gmail-refresh-token",
          expiry_date: 4_000_000_000_000,
          scope: "global-gmail-scope",
        },
      };
    }
  }

  return { OAuth2Client };
});

vi.mock("@azure/msal-node", () => {
  class ConfidentialClientApplication {
    private readonly clientId: string;

    constructor(options: { auth: { clientId: string; clientSecret: string } }) {
      this.clientId = options.auth.clientId;
      msalMockState.configurations.push({
        clientId: options.auth.clientId,
        clientSecret: options.auth.clientSecret,
      });
    }

    async getAuthCodeUrl(options: { state: string }): Promise<string> {
      return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${encodeURIComponent(this.clientId)}&state=${encodeURIComponent(options.state)}`;
    }

    async acquireTokenByCode(_options: unknown): Promise<{
      accessToken: string;
      expiresOn: Date;
      account: { username: string };
    }> {
      return {
        accessToken: "outlook-access-token",
        expiresOn: new Date(4_000_000_000_000),
        account: { username: "outlook@example.test" },
      };
    }

    async acquireTokenByRefreshToken(options: { refreshToken: string }): Promise<{
      accessToken: string;
      expiresOn: Date;
    }> {
      msalMockState.refreshes.push({ refreshToken: options.refreshToken });
      return {
        accessToken: "global-outlook-access-token",
        expiresOn: new Date(4_000_000_000_000),
      };
    }
  }

  return { ConfidentialClientApplication };
});

const GLOBAL_PROJECT_ID = "global-project-id";
const NON_GLOBAL_PROJECT_ID = "non-global-project-id";
const originalGoogleOAuthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const originalGoogleOAuthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const originalMsOAuthClientId = process.env.MS_OAUTH_CLIENT_ID;
const originalMsOAuthClientSecret = process.env.MS_OAUTH_CLIENT_SECRET;

function resetOAuthMocks(): void {
  coreMockState.settings.clear();
  msalMockState.configurations.length = 0;
  msalMockState.refreshes.length = 0;
  googleMockState.configurations.length = 0;
  googleMockState.credentials.length = 0;
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  delete process.env.MS_OAUTH_CLIENT_ID;
  delete process.env.MS_OAUTH_CLIENT_SECRET;
}

function restoreOAuthEnvironment(): void {
  if (originalGoogleOAuthClientId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  else process.env.GOOGLE_OAUTH_CLIENT_ID = originalGoogleOAuthClientId;
  if (originalGoogleOAuthClientSecret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  else process.env.GOOGLE_OAUTH_CLIENT_SECRET = originalGoogleOAuthClientSecret;
  if (originalMsOAuthClientId === undefined) delete process.env.MS_OAUTH_CLIENT_ID;
  else process.env.MS_OAUTH_CLIENT_ID = originalMsOAuthClientId;
  if (originalMsOAuthClientSecret === undefined) delete process.env.MS_OAUTH_CLIENT_SECRET;
  else process.env.MS_OAUTH_CLIENT_SECRET = originalMsOAuthClientSecret;
}

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
  beforeEach(() => {
    resetOAuthMocks();
    resetEmailRuntimeForTest();
    configureEmailRuntime(createMemoryEmailRuntime(coreMockState.settings, GLOBAL_PROJECT_ID));
  });

  afterEach(() => {
    resetEmailRuntimeForTest();
    restoreOAuthEnvironment();
  });

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
    settings.setSetting(GLOBAL_PROJECT_ID, "oauth_state_yahoo", "test-state-123");
    const { exchangeCode } = await import("../lib/oauth.js");
    await expect(exchangeCode("yahoo" as any, "code123", "test-state-123")).rejects.toThrow("not supported");
  });

  it("uses only global Outlook settings when authorizing", async () => {
    const { settings } = await import("ingenium-core");
    settings.setSetting(GLOBAL_PROJECT_ID, "oauth_outlook_client_id", "global-outlook-client-id");
    settings.setSetting(GLOBAL_PROJECT_ID, "oauth_outlook_client_secret", "global-outlook-client-secret");
    settings.setSetting(NON_GLOBAL_PROJECT_ID, "oauth_outlook_client_id", "non-global-outlook-client-id");
    settings.setSetting(NON_GLOBAL_PROJECT_ID, "oauth_outlook_client_secret", "non-global-outlook-client-secret");

    const { getOAuthUrl } = await import("../lib/oauth.js");
    const result = await getOAuthUrl("outlook");
    const config = msalMockState.configurations[msalMockState.configurations.length - 1];

    expect(config).toEqual({
      clientId: "global-outlook-client-id",
      clientSecret: "global-outlook-client-secret",
    });
    expect(result.url).toContain("global-outlook-client-id");
    expect(result.url).not.toContain("non-global-outlook-client-id");
    expect(settings.getSetting(GLOBAL_PROJECT_ID, "oauth_state_outlook")).toBe(result.state);
    expect(settings.getSetting(NON_GLOBAL_PROJECT_ID, "oauth_state_outlook")).toBeNull();
  });

  it("uses only global Outlook settings when exchanging", async () => {
    const { settings } = await import("ingenium-core");
    settings.setSetting(GLOBAL_PROJECT_ID, "oauth_outlook_client_id", "global-outlook-client-id");
    settings.setSetting(GLOBAL_PROJECT_ID, "oauth_outlook_client_secret", "global-outlook-client-secret");
    settings.setSetting(NON_GLOBAL_PROJECT_ID, "oauth_outlook_client_id", "non-global-outlook-client-id");
    settings.setSetting(NON_GLOBAL_PROJECT_ID, "oauth_outlook_client_secret", "non-global-outlook-client-secret");
    settings.setSetting(GLOBAL_PROJECT_ID, "oauth_state_outlook", "global-outlook-state");
    settings.setSetting(NON_GLOBAL_PROJECT_ID, "oauth_state_outlook", "non-global-outlook-state");

    const { exchangeCode } = await import("../lib/oauth.js");
    const result = await exchangeCode(
      "outlook",
      "outlook-auth-code",
      "global-outlook-state",
      "http://localhost:3000/mail/oauth/callback",
    );
    const config = msalMockState.configurations[msalMockState.configurations.length - 1];

    expect(config).toEqual({
      clientId: "global-outlook-client-id",
      clientSecret: "global-outlook-client-secret",
    });
    expect(result).toMatchObject({
      accessToken: "outlook-access-token",
      email: "outlook@example.test",
    });
    expect(settings.getSetting(GLOBAL_PROJECT_ID, "oauth_state_outlook")).toBeNull();
    expect(settings.getSetting(NON_GLOBAL_PROJECT_ID, "oauth_state_outlook")).toBe("non-global-outlook-state");
  });
});

describe("refreshAccessToken global configuration", () => {
  beforeEach(() => {
    resetOAuthMocks();
    resetEmailRuntimeForTest();
    configureEmailRuntime(createMemoryEmailRuntime(coreMockState.settings, GLOBAL_PROJECT_ID));
  });

  afterEach(() => {
    resetEmailRuntimeForTest();
    restoreOAuthEnvironment();
  });

  it("uses global Gmail OAuth settings", async () => {
    const { settings } = await import("ingenium-core");
    settings.setSetting(GLOBAL_PROJECT_ID, "oauth_gmail_client_id", "global-gmail-client-id");
    settings.setSetting(GLOBAL_PROJECT_ID, "oauth_gmail_client_secret", "global-gmail-client-secret");
    settings.setSetting(NON_GLOBAL_PROJECT_ID, "oauth_gmail_client_id", "non-global-gmail-client-id");
    settings.setSetting(NON_GLOBAL_PROJECT_ID, "oauth_gmail_client_secret", "non-global-gmail-client-secret");

    const { refreshAccessToken } = await import("../lib/oauth.js");
    const result = await refreshAccessToken("gmail", "caller-refresh-token");

    expect(googleMockState.configurations.at(-1)).toMatchObject({
      clientId: "global-gmail-client-id",
      clientSecret: "global-gmail-client-secret",
    });
    expect(googleMockState.configurations.at(-1)?.clientId).not.toBe("non-global-gmail-client-id");
    expect(googleMockState.credentials).toEqual([{ refresh_token: "caller-refresh-token" }]);
    expect(result).toEqual({
      accessToken: "global-gmail-access-token",
      refreshToken: "global-gmail-refresh-token",
      expiryDate: 4_000_000_000_000,
      scope: "global-gmail-scope",
    });
  });

  it("uses global Outlook OAuth settings", async () => {
    const { settings } = await import("ingenium-core");
    settings.setSetting(GLOBAL_PROJECT_ID, "oauth_outlook_client_id", "global-outlook-client-id");
    settings.setSetting(GLOBAL_PROJECT_ID, "oauth_outlook_client_secret", "global-outlook-client-secret");
    settings.setSetting(NON_GLOBAL_PROJECT_ID, "oauth_outlook_client_id", "non-global-outlook-client-id");
    settings.setSetting(NON_GLOBAL_PROJECT_ID, "oauth_outlook_client_secret", "non-global-outlook-client-secret");

    const { refreshAccessToken } = await import("../lib/oauth.js");
    const result = await refreshAccessToken("outlook", "caller-refresh-token");

    expect(msalMockState.configurations.at(-1)).toEqual({
      clientId: "global-outlook-client-id",
      clientSecret: "global-outlook-client-secret",
    });
    expect(msalMockState.refreshes).toEqual([{ refreshToken: "caller-refresh-token" }]);
    expect(result).toMatchObject({
      accessToken: "global-outlook-access-token",
      refreshToken: "caller-refresh-token",
      expiryDate: 4_000_000_000_000,
    });
  });
});

describe("compiled email release OAuth contract", () => {
  beforeEach(() => {
    resetOAuthMocks();
    resetEmailRuntimeForTest();
    configureEmailRuntime(createMemoryEmailRuntime(coreMockState.settings, GLOBAL_PROJECT_ID));
  });

  afterEach(() => {
    resetEmailRuntimeForTest();
    restoreOAuthEnvironment();
  });

  it("keeps the global refresh configuration contract in the published entrypoint", async () => {
    const { settings } = await import("ingenium-core");
    settings.setSetting(GLOBAL_PROJECT_ID, "oauth_gmail_client_id", "release-global-gmail-client-id");
    settings.setSetting(GLOBAL_PROJECT_ID, "oauth_gmail_client_secret", "release-global-gmail-client-secret");
    settings.setSetting(NON_GLOBAL_PROJECT_ID, "oauth_gmail_client_id", "release-non-global-gmail-client-id");
    settings.setSetting(NON_GLOBAL_PROJECT_ID, "oauth_gmail_client_secret", "release-non-global-gmail-client-secret");

    const builtRuntime = await import("../dist/lib/runtime.js");
    builtRuntime.resetEmailRuntimeForTest();
    builtRuntime.configureEmailRuntime(createMemoryEmailRuntime(coreMockState.settings, GLOBAL_PROJECT_ID));
    const built = await import("../dist/index.js");
    expect(built.refreshAccessToken).toBeTypeOf("function");
    const result = await built.refreshAccessToken("gmail", "release-refresh-token");

    expect(googleMockState.configurations.at(-1)).toMatchObject({
      clientId: "release-global-gmail-client-id",
      clientSecret: "release-global-gmail-client-secret",
    });
    expect(googleMockState.configurations.at(-1)?.clientId).not.toBe("release-non-global-gmail-client-id");
    expect(googleMockState.credentials).toEqual([{ refresh_token: "release-refresh-token" }]);
    expect(result.accessToken).toBe("global-gmail-access-token");
  });
});

describe("storeTokens / getValidTokens", () => {
  beforeAll(() => {
    process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    resetEmailRuntimeForTest();
    delete process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;
  });

  beforeEach(() => {
    resetEmailRuntimeForTest();
    configureEmailRuntime(createMemoryEmailRuntime(coreMockState.settings, GLOBAL_PROJECT_ID));
  });

  it("should return null for non-existent account", async () => {
    const { getValidTokens } = await import("../lib/oauth.js");
    const result = await getValidTokens("nonexistent-id", "gmail");
    expect(result).toBeNull();
  });
});

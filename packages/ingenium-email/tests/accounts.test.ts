import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Mock the ingenium-core settings/getDb module
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
            if (k.startsWith("email_account_")) {
              entries.push({ key: k, value: v });
            }
          }
          return entries;
        }),
        get: vi.fn(() => ({ id: "global-project-id" })),
        run: vi.fn((...bindParams: string[]) => {
          // Sync DELETE statements back to the store Map so setSetting/getSetting see the change
          if (sql.startsWith("DELETE FROM settings")) {
            const key = bindParams[1];
            if (key) store.delete(key);
          }
        }),
      })),
    })),
  };
});

describe("accounts", () => {
  beforeAll(() => {
    process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  });

  afterAll(() => {
    delete process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;
  });

  it("should add and retrieve an account", async () => {
    const { addAccount, getAccount } = await import("../lib/accounts.js");
    const account = addAccount("test-project", {
      email: "alice@example.com",
      name: "Alice",
      provider: "gmail",
      authType: "oauth2",
    });
    expect(account.id).toBeDefined();
    expect(account.email).toBe("alice@example.com");
    expect(account.name).toBe("Alice");
    expect(account.connected).toBe(false);

    const retrieved = getAccount("test-project", account.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.email).toBe("alice@example.com");
  });

  it("should return undefined for non-existent account", async () => {
    const { getAccount } = await import("../lib/accounts.js");
    const result = getAccount("test-project", "nonexistent");
    expect(result).toBeUndefined();
  });

  it("should list multiple accounts", async () => {
    const { addAccount, listAccounts } = await import("../lib/accounts.js");
    addAccount("test-project", { email: "a@b.com", name: "A", provider: "gmail", authType: "oauth2" });
    addAccount("test-project", { email: "c@d.com", name: "C", provider: "outlook", authType: "app_password" });
    const accounts = listAccounts("test-project");
    expect(accounts.length).toBeGreaterThanOrEqual(2);
  });

  it("should remove an account", async () => {
    const { addAccount, removeAccount, getAccount } = await import("../lib/accounts.js");
    const account = addAccount("test-project", {
      email: "delete-me@test.com", name: "Delete Me", provider: "gmail", authType: "oauth2",
    });
    removeAccount("test-project", account.id);
    const retrieved = getAccount("test-project", account.id);
    expect(retrieved).toBeUndefined();
  });

  it("should store and retrieve encrypted credentials", async () => {
    const { addAccount, storeCredentials, getCredentials } = await import("../lib/accounts.js");
    const account = addAccount("test-project", {
      email: "enc-test@test.com", name: "Enc Test", provider: "gmail", authType: "app_password",
    });
    storeCredentials("test-project", account.id, { imapPass: "my-app-password" });
    const creds = getCredentials("test-project", account.id);
    expect(creds).toBeDefined();
    expect(creds!.password).toBe("my-app-password");
  });

  it("should throw on storeCredentials for nonexistent account", async () => {
    const { storeCredentials } = await import("../lib/accounts.js");
    expect(() => storeCredentials("test-project", "no-such-account", { imapPass: "x" })).toThrow();
  });

  it("should update connected flag and lastSync", async () => {
    const { addAccount, setAccountConnected, getAccount } = await import("../lib/accounts.js");
    const account = addAccount("test-project", {
      email: "conn-test@test.com", name: "Conn Test", provider: "gmail", authType: "oauth2",
    });
    expect(account.connected).toBe(false);
    setAccountConnected("test-project", account.id, true);
    const updated = getAccount("test-project", account.id);
    expect(updated!.connected).toBe(true);
    expect(updated!.lastSync).toBeDefined();
  });
});

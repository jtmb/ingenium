import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Mock the ingenium-core settings/getDb module
vi.mock("ingenium-core", () => {
  const store = new Map<string, string>();
  const settingKey = (projectId: string, key: string) => `${projectId}\u0000${key}`;
  return {
    settings: {
      getSetting: vi.fn((projectId: string, key: string) => store.get(settingKey(projectId, key)) ?? null),
      setSetting: vi.fn((projectId: string, key: string, value: string) => {
        store.set(settingKey(projectId, key), value);
      }),
    },
    getDb: vi.fn(() => ({
      prepare: vi.fn((sql: string) => ({
        all: vi.fn(() => {
          const entries: Array<{ project_id: string; key: string; value: string }> = [];
          for (const [compoundKey, value] of store.entries()) {
            const separator = compoundKey.indexOf("\u0000");
            const key = compoundKey.slice(separator + 1);
            if (key.startsWith("email_account_")) {
              entries.push({ project_id: compoundKey.slice(0, separator), key, value });
            }
          }
          return entries;
        }),
        get: vi.fn((projectId?: string, key?: string) => {
          if (sql.startsWith("SELECT id FROM projects")) return { id: "global-project-id" };
          const value = projectId && key ? store.get(settingKey(projectId, key)) : undefined;
          return value === undefined ? undefined : { value };
        }),
        run: vi.fn((projectId: string, key: string, value?: string) => {
          if (sql.startsWith("INSERT INTO settings") && value !== undefined) {
            store.set(settingKey(projectId, key), value);
          }
          if (sql.startsWith("DELETE FROM settings")) {
            store.delete(settingKey(projectId, key));
          }
        }),
      })),
    })),
    execTransaction: <T>(operation: () => T): T => operation(),
    checkpointAfterWrite: vi.fn(),
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
    const account = addAccount({
      email: "alice@example.com",
      name: "Alice",
      provider: "gmail",
      authType: "oauth2",
    });
    expect(account.id).toBeDefined();
    expect(account.email).toBe("alice@example.com");
    expect(account.name).toBe("Alice");
    expect(account.connected).toBe(false);

    const retrieved = getAccount(account.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.email).toBe("alice@example.com");
  });

  it("should return undefined for non-existent account", async () => {
    const { getAccount } = await import("../lib/accounts.js");
    const result = getAccount("nonexistent");
    expect(result).toBeUndefined();
  });

  it("should list multiple accounts", async () => {
    const { addAccount, listAccounts } = await import("../lib/accounts.js");
    addAccount({ email: "a@b.com", name: "A", provider: "gmail", authType: "oauth2" });
    addAccount({ email: "c@d.com", name: "C", provider: "outlook", authType: "app_password" });
    const accounts = listAccounts();
    expect(accounts.length).toBeGreaterThanOrEqual(2);
  });

  it("should remove an account", async () => {
    const { addAccount, removeAccount, getAccount } = await import("../lib/accounts.js");
    const account = addAccount({
      email: "delete-me@test.com", name: "Delete Me", provider: "gmail", authType: "oauth2",
    });
    removeAccount(account.id);
    const retrieved = getAccount(account.id);
    expect(retrieved).toBeUndefined();
  });

  it("should store and retrieve encrypted credentials", async () => {
    const { addAccount, storeCredentials, getCredentials } = await import("../lib/accounts.js");
    const account = addAccount({
      email: "enc-test@test.com", name: "Enc Test", provider: "gmail", authType: "app_password",
    });
    storeCredentials(account.id, { imapPass: "my-app-password" });
    const creds = getCredentials(account.id);
    expect(creds).toBeDefined();
    expect(creds!.password).toBe("my-app-password");
  });

  it("replaces credentials in place and resets the account auth circuit", async () => {
    const { addAccount, storeCredentials, getCredentials, listAccounts } = await import("../lib/accounts.js");
    const { authErrorCount } = await import("../lib/circuit-breaker.js");
    const account = addAccount({
      email: "recover@test.com", name: "Recover", provider: "custom", authType: "app_password",
    });
    authErrorCount.set(`${account.email}:INBOX`, 3);

    storeCredentials(account.id, { imapPass: "updated-app-password", smtpPass: "updated-app-password" });

    expect(getCredentials(account.id)?.password).toBe("updated-app-password");
    expect(listAccounts().filter(a => a.id === account.id)).toHaveLength(1);
    expect(authErrorCount.has(`${account.email}:INBOX`)).toBe(false);
  });

  it("should throw on storeCredentials for nonexistent account", async () => {
    const { storeCredentials } = await import("../lib/accounts.js");
    expect(() => storeCredentials("no-such-account", { imapPass: "x" })).toThrow();
  });

  it("should update connected flag and lastSync", async () => {
    const { addAccount, setAccountConnected, getAccount } = await import("../lib/accounts.js");
    const account = addAccount({
      email: "conn-test@test.com", name: "Conn Test", provider: "gmail", authType: "oauth2",
    });
    expect(account.connected).toBe(false);
    setAccountConnected(account.id, true);
    const updated = getAccount(account.id);
    expect(updated!.connected).toBe(true);
    expect(updated!.lastSync).toBeDefined();
  });
});

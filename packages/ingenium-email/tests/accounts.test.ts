import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configureEmailRuntime, resetEmailRuntimeForTest } from "../lib/runtime.js";
import { createMemoryEmailRuntime } from "./runtime-fixture.js";

describe("accounts", () => {
  let values: Map<string, string>;

  beforeAll(() => {
    process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  });

  beforeEach(() => {
    values = new Map();
    resetEmailRuntimeForTest();
    configureEmailRuntime(createMemoryEmailRuntime(values));
  });

  afterAll(() => {
    resetEmailRuntimeForTest();
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

  it("updates editable connection metadata without replacing credentials", async () => {
    const { addAccount, getAccount, getCredentials, storeAccount, storeCredentials } = await import("../lib/accounts.js");
    const account = addAccount({
      email: "edit-account@test.com",
      name: "Before edit",
      provider: "custom",
      authType: "app_password",
      imapHost: "imap.before.test",
    });
    storeCredentials(account.id, { imapPass: "saved-password" });

    storeAccount({
      ...account,
      email: "edit-account@example.test",
      name: "After edit",
      imapHost: "imap.after.test",
      imapPort: 993,
      smtpHost: "smtp.after.test",
      smtpPort: 465,
    });

    expect(getAccount(account.id)).toMatchObject({
      email: "edit-account@example.test",
      name: "After edit",
      imapHost: "imap.after.test",
      smtpHost: "smtp.after.test",
    });
    expect(getCredentials(account.id)?.password).toBe("saved-password");
  });

  it("rejects fixed-provider endpoint overrides before creating an account", async () => {
    const { addAccount, listAccounts } = await import("../lib/accounts.js");
    const { resolveProviderEndpoints } = await import("../lib/providers.js");

    expect(() => addAccount({
      email: "fixed-override@example.test",
      name: "Fixed override",
      provider: "gmail",
      authType: "app_password",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
    })).toThrow("Endpoint overrides are only supported for custom providers");

    expect(listAccounts()).toEqual([]);
    expect(resolveProviderEndpoints({
      provider: "gmail",
      imapHost: "imap.attacker.example",
      imapPort: 993,
      smtpHost: "smtp.attacker.example",
      smtpPort: 587,
    })).toMatchObject({
      imap: { host: "imap.gmail.com", port: 993 },
      smtp: { host: "smtp.gmail.com", port: 587 },
    });
  });

  it("rejects a fixed-provider redirect without changing encrypted account data", async () => {
    const { createAccountWithCredentials, getCredentials, storeAccount } = await import("../lib/accounts.js");
    const account = createAccountWithCredentials({
      email: "fixed-credential@example.test",
      name: "Fixed credential",
      provider: "gmail",
      authType: "app_password",
    }, {
      imapPass: "fixed-app-password",
      smtpPass: "fixed-app-password",
    });
    const storageKey = `global-project-id\u0000email_account_${account.id}`;
    const before = values.get(storageKey);

    expect(() => storeAccount({
      ...account,
      imapHost: "imap.attacker.example",
      imapPort: 993,
      smtpHost: "smtp.attacker.example",
      smtpPort: 587,
    })).toThrow("Endpoint overrides are only supported for custom providers");

    expect(values.get(storageKey)).toBe(before);
    expect(getCredentials(account.id)?.password).toBe("fixed-app-password");
  });

  it("normalizes fixed-provider targets and requires explicit custom endpoints on provider changes", async () => {
    const { createAccountWithCredentials, getAccount, getCredentials, storeAccount } = await import("../lib/accounts.js");
    const account = createAccountWithCredentials({
      email: "switch-provider@example.test",
      name: "Switch provider",
      provider: "custom",
      authType: "app_password",
      imapHost: "imap.custom.example",
      imapPort: 993,
      smtpHost: "smtp.custom.example",
      smtpPort: 587,
    }, {
      imapPass: "switch-password",
      smtpPass: "switch-password",
    });

    storeAccount({
      ...account,
      provider: "gmail",
      imapHost: "imap.attacker.example",
      imapPort: 993,
      smtpHost: "smtp.attacker.example",
      smtpPort: 587,
    });

    const fixed = getAccount(account.id)!;
    expect(fixed.provider).toBe("gmail");
    expect(fixed.imapHost).toBeUndefined();
    expect(fixed.smtpHost).toBeUndefined();
    expect(getCredentials(account.id)?.password).toBe("switch-password");
    expect(JSON.parse(values.get(`global-project-id\u0000email_account_${account.id}`)!).imapHost).toBeUndefined();

    expect(() => storeAccount({ ...fixed, provider: "custom" })).toThrow(
      "Custom provider changes require IMAP and SMTP hosts and ports",
    );

    storeAccount({
      ...fixed,
      provider: "custom",
      imapHost: "imap.replacement.example",
      imapPort: 993,
      smtpHost: "smtp.replacement.example",
      smtpPort: 587,
    });

    expect(getAccount(account.id)).toMatchObject({
      provider: "custom",
      imapHost: "imap.replacement.example",
      smtpHost: "smtp.replacement.example",
    });
    expect(getCredentials(account.id)?.password).toBe("switch-password");
  });
});

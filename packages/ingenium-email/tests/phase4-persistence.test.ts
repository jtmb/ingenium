import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OAuthToken } from "../lib/types.js";

const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const WRONG_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;
const originalEncryptionKey = process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;

type Fixture = {
  tempDir: string;
  databasePath: string;
  core: typeof import("ingenium-core");
  accounts: typeof import("../lib/accounts.js");
  oauth: typeof import("../lib/oauth.js");
  globalId: string;
};

let fixture: Fixture | undefined;

async function createFixture(): Promise<Fixture> {
  vi.resetModules();
  const tempDir = mkdtempSync(join(tmpdir(), "ingenium-phase4-email-"));
  const databasePath = join(tempDir, "canonical", "data.db");
  process.env.INGENIUM_CORE_DB_PATH = databasePath;
  process.env.INGENIUM_HOME = join(tempDir, "home");
  process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = TEST_KEY;

  const core = await import("ingenium-core");
  core.resetDbForTest();
  const accounts = await import("../lib/accounts.js");
  const oauth = await import("../lib/oauth.js");
  const global = core.projects.createProject("global-default", true);

  return { tempDir, databasePath, core, accounts, oauth, globalId: global.id };
}

afterEach(() => {
  fixture?.core.resetDbForTest();
  if (fixture?.tempDir) rmSync(fixture.tempDir, { recursive: true, force: true });
  fixture = undefined;

  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalHome === undefined) delete process.env.INGENIUM_HOME;
  else process.env.INGENIUM_HOME = originalHome;
  if (originalEncryptionKey === undefined) delete process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;
  else process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = originalEncryptionKey;
});

function accountInput() {
  return {
    email: "phase4@example.test",
    name: "Phase 4",
    provider: "custom" as const,
    authType: "app_password" as const,
  };
}

function oauthToken(): OAuthToken {
  return {
    accessToken: "phase4-access-token",
    refreshToken: "phase4-refresh-token",
    expiryDate: Date.now() + 60 * 60 * 1000,
    scope: "mail.test",
    email: "phase4@example.test",
  };
}

async function seedAccount() {
  fixture = await createFixture();
  const account = fixture.accounts.createAccountWithCredentials(fixture.globalId, accountInput(), {
    imapPass: "phase4-imap-password",
    smtpPass: "phase4-smtp-password",
  });
  fixture.oauth.storeTokens(fixture.globalId, account.id, oauthToken());
  return account;
}

describe("Phase 4 email persistence and credential boundaries", () => {
  it("keeps account, encrypted credentials, and OAuth tokens across a same-DB reopen", async () => {
    const account = await seedAccount();
    const before = fixture!.core.settings.getSetting(fixture!.globalId, `email_account_${account.id}`)!;
    expect(before).not.toContain("phase4-imap-password");
    expect(fixture!.core.settings.getSetting(fixture!.globalId, `email_oauth_${account.id}`)).not.toContain("phase4-access-token");

    fixture!.core.resetDbForTest();
    const reopened = await import("ingenium-core");

    expect(fixture!.accounts.getAccount(fixture!.globalId, account.id)?.email).toBe("phase4@example.test");
    expect(fixture!.accounts.getCredentials(fixture!.globalId, account.id)).toMatchObject({
      password: "phase4-imap-password",
    });
    await expect(fixture!.oauth.getValidTokens(fixture!.globalId, account.id, "custom")).resolves.toMatchObject({
      accessToken: "phase4-access-token",
      refreshToken: "phase4-refresh-token",
    });
    expect(reopened.getDb(fixture!.databasePath).name).toBe(fixture!.databasePath);

    const databaseFiles = readdirSync(fixture!.tempDir, { recursive: true })
      .map(String)
      .filter((entry) => entry.endsWith(".db"));
    expect(databaseFiles).toEqual(["canonical/data.db"]);
    expect(existsSync(join(fixture!.tempDir, "data.db"))).toBe(false);
  });

  it("degrades safely with a wrong key without exposing stored ciphertext as plaintext", async () => {
    const account = await seedAccount();
    process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = WRONG_KEY;

    expect(fixture!.accounts.getAccount(fixture!.globalId, account.id)).toMatchObject({
      email: "phase4@example.test",
    });
    expect(fixture!.accounts.getCredentials(fixture!.globalId, account.id)).toBeUndefined();
    await expect(fixture!.oauth.getValidTokens(fixture!.globalId, account.id, "custom")).resolves.toBeNull();
  });

  it("does not partially replace credentials or OAuth tokens when the key is malformed", async () => {
    const account = await seedAccount();
    const accountKey = `email_account_${account.id}`;
    const oauthKey = `email_oauth_${account.id}`;
    const accountBefore = fixture!.core.settings.getSetting(fixture!.globalId, accountKey);
    const oauthBefore = fixture!.core.settings.getSetting(fixture!.globalId, oauthKey);

    process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = "malformed-key";
    expect(() => fixture!.accounts.storeCredentials(fixture!.globalId, account.id, { imapPass: "replacement" }))
      .toThrow(/encryption|credentials were not changed/i);
    expect(() => fixture!.oauth.storeTokens(fixture!.globalId, account.id, oauthToken()))
      .toThrow(/encryption|credentials were not changed/i);

    expect(fixture!.core.settings.getSetting(fixture!.globalId, accountKey)).toBe(accountBefore);
    expect(fixture!.core.settings.getSetting(fixture!.globalId, oauthKey)).toBe(oauthBefore);
    process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = TEST_KEY;
    expect(fixture!.accounts.getCredentials(fixture!.globalId, account.id)?.password).toBe("phase4-imap-password");
    await expect(fixture!.oauth.getValidTokens(fixture!.globalId, account.id, "custom")).resolves.toMatchObject({
      accessToken: "phase4-access-token",
    });
  });

  it("rolls back account metadata when atomic credential or OAuth creation cannot encrypt", async () => {
    fixture = await createFixture();
    process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = "malformed-key";

    expect(() => fixture!.accounts.createAccountWithCredentials(fixture!.globalId, accountInput(), {
      imapPass: "account-secret",
    })).toThrow(/encryption|credentials were not changed/i);
    expect(() => fixture!.accounts.createOAuthAccountWithTokens(fixture!.globalId, accountInput(), oauthToken()))
      .toThrow(/encryption|credentials were not changed/i);
    expect(fixture!.accounts.listAccounts(fixture!.globalId)).toEqual([]);
    expect(fixture!.core.settings.getSetting(fixture!.globalId, "email_encryption_key_fingerprint")).toBeUndefined();
  });

  it("keeps account discovery available when the encryption key is missing", async () => {
    const account = await seedAccount();
    delete process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;

    expect(fixture!.accounts.listAccounts(fixture!.globalId)).toMatchObject([
      { id: account.id, email: "phase4@example.test" },
    ]);
    expect(fixture!.accounts.getCredentials(fixture!.globalId, account.id)).toBeUndefined();
  });

  it("resolves accounts against a recreated global project instead of a deleted project", async () => {
    fixture = await createFixture();
    const oldGlobalId = fixture.globalId;
    const oldAccount = fixture.accounts.addAccount(oldGlobalId, accountInput());
    fixture.accounts.removeAccount(oldGlobalId, oldAccount.id);
    expect(fixture.core.projects.deleteProject("global-default")).toEqual({ status: "deleted" });

    const replacement = fixture.core.projects.createProject("replacement-global", true);
    const replacementAccount = fixture.accounts.addAccount(replacement.id, {
      ...accountInput(),
      email: "replacement@example.test",
    });

    expect(fixture.accounts.getGlobalProjectId()).toBe(replacement.id);
    expect(fixture.accounts.getAccount(oldGlobalId, replacementAccount.id)?.email).toBe("replacement@example.test");
    expect(fixture.core.settings.getSetting(oldGlobalId, `email_account_${replacementAccount.id}`)).toBeUndefined();
    expect(fixture.core.settings.getSetting(replacement.id, `email_account_${replacementAccount.id}`)).toContain("replacement@example.test");
  });

  it("keeps writes in the canonical global namespace when given a non-global project", async () => {
    fixture = await createFixture();
    const external = fixture.core.projects.createProject("phase4-external");

    const account = fixture.accounts.addAccount(external.id, {
      ...accountInput(),
      email: "canonical-write@example.test",
    });
    fixture.accounts.storeCredentials(external.id, account.id, { imapPass: "canonical-password" });

    expect(fixture.core.settings.getSetting(
      fixture.globalId,
      `email_account_${account.id}`,
    )).toContain("canonical-write@example.test");
    expect(fixture.core.settings.getSetting(
      external.id,
      `email_account_${account.id}`,
    )).toBeUndefined();
    expect(fixture.accounts.getCredentials(external.id, account.id)).toMatchObject({
      password: "canonical-password",
    });
  });

  it("consumes failed OAuth state without creating an account or token row", async () => {
    fixture = await createFixture();
    const result = await fixture.oauth.getOAuthUrl("yahoo");

    await expect(fixture.oauth.exchangeCode("yahoo", "invalid-code", result.state)).rejects.toThrow("not supported");
    expect(fixture.core.settings.getSetting(fixture.globalId, "oauth_state_yahoo")).toBeUndefined();
    expect(fixture.core.settings.getSetting(fixture.globalId, "email_oauth_unknown")).toBeUndefined();
    expect(fixture.accounts.listAccounts(fixture.globalId)).toEqual([]);
  });
});

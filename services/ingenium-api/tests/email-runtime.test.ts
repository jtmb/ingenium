import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, projects, protectedSettings, resetDbForTest, settings, vault } from "ingenium-core";
import {
  addAccount,
  getEmailRuntime,
  getAccount,
  getOAuthUrl,
  isEmailRuntimeConfigured,
  resetEmailRuntimeForTest,
} from "ingenium-email";
import { configureEmailRuntimeForApi } from "../lib/email-runtime.js";

const googleOAuthMock = vi.hoisted(() => ({
  configurations: [] as Array<{ clientId: string; clientSecret: string; redirectUri: string }>,
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    constructor(clientId: string, clientSecret: string, redirectUri: string) {
      googleOAuthMock.configurations.push({ clientId, clientSecret, redirectUri });
    }

    generateAuthUrl(options: { state: string }): string {
      const configuration = googleOAuthMock.configurations.at(-1);
      return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(configuration?.clientId ?? "")}&state=${encodeURIComponent(options.state)}`;
    }
  },
}));

const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;
let tempDir = "";

afterEach(() => {
  resetEmailRuntimeForTest();
  if (!vault.isSealed()) vault.sealVault();
  resetDbForTest();
  googleOAuthMock.configurations.length = 0;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalHome === undefined) delete process.env.INGENIUM_HOME;
  else process.env.INGENIUM_HOME = originalHome;
});

describe("email runtime boundary", () => {
  it("configures the API-owned email dependency once and leaves repeated setup safe", () => {
    resetEmailRuntimeForTest();

    configureEmailRuntimeForApi();
    configureEmailRuntimeForApi();

    expect(isEmailRuntimeConfigured()).toBe(true);
  });

  it("persists global account metadata through the API-owned adapter", () => {
    resetDbForTest();
    tempDir = mkdtempSync(join(tmpdir(), "ingenium-api-email-runtime-"));
    process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "canonical", "data.db");
    process.env.INGENIUM_HOME = join(tempDir, "home");
    const global = projects.createProject("global-default", true);
    configureEmailRuntimeForApi();

    const account = addAccount({
      email: "adapter@example.test",
      name: "Adapter",
      provider: "custom",
      authType: "app_password",
    });

    expect(getAccount(account.id)).toMatchObject({ email: "adapter@example.test" });
    expect(settings.getSetting(global.id, `email_account_${account.id}`)).toContain("adapter@example.test");
  });

  it("exposes atomic email cache deltas only through the API-owned adapter", () => {
    resetDbForTest();
    tempDir = mkdtempSync(join(tmpdir(), "ingenium-api-email-runtime-"));
    process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "canonical", "data.db");
    process.env.INGENIUM_HOME = join(tempDir, "home");
    projects.createProject("global-default", true);
    configureEmailRuntimeForApi();

    getEmailRuntime().cache.applyEmailCacheDelta("adapter-cache", {
      upserts: [{ folder: "INBOX", entry: { uid: "delta-message", flags: "[]" } }],
      deletes: [],
      historyId: "adapter-cursor",
      provider: "gmail",
    });

    expect(getEmailRuntime().cache.getCachedEmail("adapter-cache", "INBOX", "delta-message")).toBeDefined();
    expect(getEmailRuntime().cache.getAccountCursor("adapter-cache")).toEqual({
      historyId: "adapter-cursor",
      provider: "gmail",
    });
  });

  it("uses a migrated protected OAuth client secret without restoring its plaintext setting", async () => {
    resetDbForTest();
    tempDir = mkdtempSync(join(tmpdir(), "ingenium-api-email-runtime-"));
    process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "canonical", "data.db");
    process.env.INGENIUM_HOME = join(tempDir, "home");
    const global = projects.createProject("global-default", true);
    const secret = "runtime-migrated-oauth-client-secret";

    vault.initVault(global.id, "runtime-vault-passphrase");
    getDb().prepare(
      "INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?)",
    ).run(global.id, "oauth_gmail_client_secret", secret);
    expect(vault.unsealVault(global.id, "runtime-vault-passphrase").ok).toBe(true);
    expect(getDb().prepare(
      "SELECT value FROM settings WHERE project_id = ? AND key = ?",
    ).get(global.id, "oauth_gmail_client_secret")).toBeUndefined();
    expect(protectedSettings.getOAuthClientSecret(global.id, "oauth_gmail_client_secret")).toBe(secret);

    settings.setSetting(global.id, "oauth_gmail_client_id", "runtime-protected-client-id");
    configureEmailRuntimeForApi();

    await getOAuthUrl("gmail");

    expect(googleOAuthMock.configurations.at(-1)).toMatchObject({
      clientId: "runtime-protected-client-id",
      clientSecret: secret,
    });
  });
});

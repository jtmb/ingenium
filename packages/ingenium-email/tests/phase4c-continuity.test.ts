import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  encryptCredentialValue,
  getEmailEncryptionKeyFingerprint,
} from "../lib/credential-crypto.js";
import { createCoreEmailRuntime } from "./runtime-fixture.js";

const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const WRONG_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;
const originalEncryptionKey = process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;

type Fixture = {
  tempDir: string;
  core: typeof import("ingenium-core");
  accounts: typeof import("../lib/accounts.js");
  globalId: string;
};

let fixture: Fixture | undefined;

async function createFixture(): Promise<Fixture> {
  vi.resetModules();
  const tempDir = mkdtempSync(join(tmpdir(), "ingenium-phase4c-email-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "canonical", "data.db");
  process.env.INGENIUM_HOME = join(tempDir, "home");
  process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = TEST_KEY;

  const core = await import("ingenium-core");
  core.resetDbForTest();
  const runtime = await import("../lib/runtime.js");
  runtime.configureEmailRuntime(createCoreEmailRuntime(core));
  const accounts = await import("../lib/accounts.js");
  const global = core.projects.createProject("global-default", true);

  return { tempDir, core, accounts, globalId: global.id };
}

beforeEach(async () => {
  fixture = await createFixture();
});

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

function accountValue(imapPass: string) {
  return JSON.stringify({
    id: "phase4c-account",
    email: "phase4c@example.test",
    name: "Phase 4C",
    provider: "custom",
    authType: "app_password",
    connected: false,
    imapPass,
  });
}

function oauthValue() {
  return JSON.stringify({
    accessToken: encryptCredentialValue("phase4c-access-token"),
    refreshToken: encryptCredentialValue("phase4c-refresh-token"),
    expiryDate: Date.now() + 60 * 60 * 1000,
    scope: "mail.test",
    email: "phase4c@example.test",
  });
}

function markKeyReady() {
  fixture!.core.settings.setSetting(
    fixture!.globalId,
    "email_encryption_key_fingerprint",
    getEmailEncryptionKeyFingerprint(),
  );
}

function writeAccount(imapPass: string) {
  fixture!.core.settings.setSetting(
    fixture!.globalId,
    "email_account_phase4c-account",
    accountValue(imapPass),
  );
}

describe("Phase 4C email encryption continuity", () => {
  it("decrypts real encrypted app-password and OAuth values only after continuity is ready", async () => {
    markKeyReady();
    writeAccount(encryptCredentialValue("phase4c-imap-password"));
    fixture!.core.settings.setSetting(fixture!.globalId, "email_oauth_phase4c-account", oauthValue());

    expect(fixture!.accounts.getEmailEncryptionDiagnostics()).toEqual({
      status: "ready",
      globalProjectId: fixture!.globalId,
    });
    expect(fixture!.accounts.getCredentials("phase4c-account")).toMatchObject({
      password: "phase4c-imap-password",
      tokens: {
        accessToken: "phase4c-access-token",
        refreshToken: "phase4c-refresh-token",
      },
    });
  });

  it("fails closed for corrupt ciphertext without returning the corrupt value", async () => {
    markKeyReady();
    const corrupt = "not-a-valid-encrypted-credential";
    writeAccount(corrupt);

    expect(fixture!.accounts.getCredentials("phase4c-account")).toBeUndefined();
    expect(JSON.stringify(fixture!.accounts.getCredentials("phase4c-account") ?? {}))
      .not.toContain(corrupt);
  });

  it("fails closed for a legacy plaintext credential instead of treating it as decrypted", async () => {
    markKeyReady();
    writeAccount("legacy-plaintext-password");

    expect(fixture!.accounts.getCredentials("phase4c-account")).toBeUndefined();
    expect(JSON.stringify(fixture!.accounts.getCredentials("phase4c-account") ?? {}))
      .not.toContain("legacy-plaintext-password");
  });

  it("fails closed after an encryption-key mismatch and never exposes ciphertext", async () => {
    markKeyReady();
    const ciphertext = encryptCredentialValue("phase4c-password");
    writeAccount(ciphertext);
    process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = WRONG_KEY;

    expect(fixture!.accounts.getEmailEncryptionDiagnostics()).toMatchObject({ status: "mismatch" });
    expect(fixture!.accounts.getCredentials("phase4c-account")).toBeUndefined();
    expect(JSON.stringify(fixture!.accounts.getCredentials("phase4c-account") ?? {}))
      .not.toContain(ciphertext);
  });

  it("bootstraps continuity only when every existing encrypted value is decryptable", async () => {
    writeAccount(encryptCredentialValue("phase4c-password"));
    fixture!.core.settings.setSetting(fixture!.globalId, "email_oauth_phase4c-account", oauthValue());

    expect(fixture!.accounts.getEmailEncryptionDiagnostics()).toMatchObject({ status: "uninitialized" });
    expect(fixture!.accounts.establishEmailEncryptionKeyContinuity()).toEqual({
      status: "ready",
      globalProjectId: fixture!.globalId,
    });
    expect(fixture!.core.settings.getSetting(
      fixture!.globalId,
      "email_encryption_key_fingerprint",
    )).toBe(getEmailEncryptionKeyFingerprint());
  });

  it.each([
    ["corrupt ciphertext", "corrupt-ciphertext"],
    ["legacy plaintext", "legacy-plaintext-password"],
  ])("does not initialize continuity for %s", async (_label, value) => {
    writeAccount(value);

    expect(fixture!.accounts.establishEmailEncryptionKeyContinuity()).toEqual({
      status: "unverified",
      globalProjectId: fixture!.globalId,
    });
    expect(fixture!.core.settings.getSetting(
      fixture!.globalId,
      "email_encryption_key_fingerprint",
    )).toBeUndefined();
  });
});

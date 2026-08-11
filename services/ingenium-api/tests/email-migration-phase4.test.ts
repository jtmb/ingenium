import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, projects, resetDbForTest, settings } from "ingenium-core";
import {
  encryptCredentialValue,
  getEmailEncryptionKeyFingerprint,
} from "../../../packages/ingenium-email/lib/credential-crypto.js";
import { validateEmailAccountMigrationCredentials } from "../../../packages/ingenium-email/lib/accounts.js";

type EncryptionStatus = "ready" | "mismatch" | "unavailable" | "unverified";

const emailMocks = vi.hoisted(() => {
  const noop = vi.fn();
  return {
    getGlobalProjectId: vi.fn(),
    listAccounts: noop,
    getAccount: noop,
    addAccount: noop,
    createAccountWithCredentials: noop,
    createOAuthAccountWithTokens: noop,
    removeAccount: noop,
    storeAccount: noop,
    getCredentials: noop,
    storeCredentials: noop,
    storeTokens: noop,
    getEmailEncryptionDiagnostics: vi.fn(() => ({ status: "ready" as EncryptionStatus, globalProjectId: "global-project" })),
    validateEmailAccountMigrationCredentials: vi.fn(),
    sanitizeProviderError: vi.fn(() => ({
      code: "PROVIDER_ERROR",
      message: "The email operation could not be completed. Try again later.",
      retryable: true,
    })),
    connectAccount: noop,
    disconnectAccount: noop,
    moveEmail: noop,
    setFlags: noop,
    deleteEmail: noop,
    listFolders: noop,
    sendEmail: noop,
    saveDraft: noop,
    getOAuthUrl: noop,
    exchangeCode: noop,
    getValidTokens: noop,
    getFreshGmailToken: noop,
    suggestResponse: noop,
    getVoiceSamples: noop,
    generateSmartReplies: noop,
    generateEmailSummary: noop,
    reviewDraft: noop,
    startWatcher: noop,
    getWatcherStatus: noop,
    stopWatcher: noop,
    startEngine: noop,
    boostFolder: noop,
    boostBody: noop,
    getEngineStatus: noop,
    stopAccountWorker: noop,
    setAccountConnected: noop,
    GmailProvider: {},
    EMAIL_ENCRYPTION_KEY_FINGERPRINT_SETTING: "email_encryption_key_fingerprint",
  };
});

vi.mock("ingenium-email", () => emailMocks);

import { migrateEmailAccountsToGlobal } from "../lib/routes/emails.js";

const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;
const originalEncryptionKey = process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;
let tempDir = "";

beforeEach(() => {
  resetDbForTest();
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-phase4-email-migration-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "canonical", "data.db");
  process.env.INGENIUM_HOME = join(tempDir, "home");
  process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const global = projects.createProject("global-default", true);
  emailMocks.getGlobalProjectId.mockReset();
  emailMocks.getGlobalProjectId.mockReturnValue(global.id);
  emailMocks.getEmailEncryptionDiagnostics.mockReset();
  emailMocks.getEmailEncryptionDiagnostics.mockReturnValue({ status: "ready", globalProjectId: global.id });
  emailMocks.validateEmailAccountMigrationCredentials.mockImplementation(validateEmailAccountMigrationCredentials);
});

afterEach(() => {
  resetDbForTest();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalHome === undefined) delete process.env.INGENIUM_HOME;
  else process.env.INGENIUM_HOME = originalHome;
  if (originalEncryptionKey === undefined) delete process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;
  else process.env.INGENIUM_EMAIL_ENCRYPTION_KEY = originalEncryptionKey;
});

function seedLegacyProject() {
  const legacy = projects.createProject("legacy-mail-project");
  const global = projects.getProject("global-default")!;
  expect(projects.setProjectGlobal(legacy.name, true)).toBe(true);
  expect(projects.setProjectGlobal(global.name, true)).toBe(true);
  settings.setSetting(global.id, "email_encryption_key_fingerprint", getEmailEncryptionKeyFingerprint());
  return { legacyId: legacy.id, globalId: global.id, db: getDb(process.env.INGENIUM_CORE_DB_PATH!) };
}

function markProjectAsFormerGlobal(name: string): void {
  expect(projects.setProjectGlobal(name, true)).toBe(true);
  expect(projects.setProjectGlobal("global-default", true)).toBe(true);
}

function insertSetting(db: ReturnType<typeof getDb>, projectId: string, key: string, value: unknown): void {
  settings.setSetting(projectId, key, typeof value === "string" ? value : JSON.stringify(value));
}

describe("Phase 4 email account migration", () => {
  it("moves a source group containing real encrypted credentials without changing its bytes", async () => {
    const { legacyId, globalId } = seedLegacyProject();
    const accountValue = JSON.stringify({
      id: "encrypted-source",
      email: "encrypted-source@example.test",
      name: "Encrypted source",
      provider: "custom",
      authType: "app_password",
      connected: false,
      imapPass: encryptCredentialValue("source-imap-password"),
    });
    const oauthValue = JSON.stringify({
      accessToken: encryptCredentialValue("source-access-token"),
      refreshToken: encryptCredentialValue("source-refresh-token"),
      expiryDate: 4_000_000_000_000,
      scope: "mail.test",
      email: "encrypted-source@example.test",
    });
    insertSetting(dbFrom(legacyId), legacyId, "email_account_encrypted-source", accountValue);
    insertSetting(dbFrom(legacyId), legacyId, "email_oauth_encrypted-source", oauthValue);
    settings.setSetting(globalId, "email_encryption_key_fingerprint", getEmailEncryptionKeyFingerprint());

    await expect(migrateEmailAccountsToGlobal()).resolves.toEqual({
      migratedSettings: 2,
      migratedAccounts: 1,
      collisions: 0,
      skippedForEncryption: false,
    });
    expect(settings.getSetting(globalId, "email_account_encrypted-source")).toBe(accountValue);
    expect(settings.getSetting(globalId, "email_oauth_encrypted-source")).toBe(oauthValue);
    expect(settings.getSetting(legacyId, "email_account_encrypted-source")).toBeUndefined();
    expect(settings.getSetting(legacyId, "email_oauth_encrypted-source")).toBeUndefined();
  });

  it.each([
    ["corrupt ciphertext", "not-valid-ciphertext"],
    ["legacy plaintext", "legacy-plaintext-password"],
  ])("retains a source account when its %s cannot be decrypted", async (_label, credential) => {
    const { legacyId, globalId } = seedLegacyProject();
    const accountValue = JSON.stringify({
      id: "unreadable-source",
      email: "unreadable-source@example.test",
      name: "Unreadable source",
      provider: "custom",
      authType: "app_password",
      connected: false,
      imapPass: credential,
    });
    insertSetting(dbFrom(legacyId), legacyId, "email_account_unreadable-source", accountValue);
    settings.setSetting(globalId, "email_encryption_key_fingerprint", getEmailEncryptionKeyFingerprint());

    await expect(migrateEmailAccountsToGlobal()).resolves.toEqual({
      migratedSettings: 0,
      migratedAccounts: 0,
      collisions: 0,
      skippedForEncryption: true,
    });
    expect(settings.getSetting(legacyId, "email_account_unreadable-source")).toBe(accountValue);
    expect(settings.getSetting(globalId, "email_account_unreadable-source")).toBeUndefined();
  });

  it("retains encrypted source settings while key continuity is uninitialized", async () => {
    const { legacyId, globalId } = seedLegacyProject();
    const accountValue = JSON.stringify({
      id: "uninitialized-source",
      email: "uninitialized-source@example.test",
      name: "Uninitialized source",
      provider: "custom",
      authType: "app_password",
      connected: false,
      imapPass: encryptCredentialValue("source-password"),
    });
    insertSetting(dbFrom(legacyId), legacyId, "email_account_uninitialized-source", accountValue);

    emailMocks.getEmailEncryptionDiagnostics.mockReturnValueOnce({
      status: "uninitialized",
      globalProjectId: globalId,
    });
    await expect(migrateEmailAccountsToGlobal()).resolves.toEqual({
      migratedSettings: 0,
      migratedAccounts: 0,
      collisions: 0,
      skippedForEncryption: true,
    });
    expect(settings.getSetting(legacyId, "email_account_uninitialized-source")).toBe(accountValue);
    expect(settings.getSetting(globalId, "email_account_uninitialized-source")).toBeUndefined();
  });

  it("moves hidden account metadata and encrypted OAuth values exactly once", async () => {
    const { legacyId, globalId, db } = seedLegacyProject();
    const accountValue = {
      id: "phase4-account",
      email: "hidden@example.test",
      name: "Hidden account",
      provider: "gmail",
      authType: "oauth2",
      connected: false,
      hidden: true,
       imapPass: encryptCredentialValue("hidden-imap-password"),
    };
    const oauthValue = {
      accessToken: encryptCredentialValue("hidden-access-token"),
      refreshToken: encryptCredentialValue("hidden-refresh-token"),
      expiryDate: 4_000_000_000_000,
      scope: "https://mail.google.com/",
      email: "hidden@example.test",
    };
    insertSetting(db, legacyId, "email_account_phase4-account", accountValue);
    insertSetting(db, legacyId, "email_oauth_phase4-account", oauthValue);
    insertSetting(db, legacyId, "oauth_state_gmail", "state-from-legacy");

    await expect(migrateEmailAccountsToGlobal()).resolves.toEqual({
      migratedSettings: 2,
      migratedAccounts: 1,
      collisions: 0,
      skippedForEncryption: false,
    });
    expect(settings.getSetting(globalId, "email_account_phase4-account")).toBe(JSON.stringify(accountValue));
    expect(settings.getSetting(globalId, "email_oauth_phase4-account")).toBe(JSON.stringify(oauthValue));
    expect(settings.getSetting(globalId, "oauth_state_gmail")).toBeUndefined();
    expect(settings.getSetting(legacyId, "email_account_phase4-account")).toBeUndefined();
    expect(settings.getSetting(legacyId, "email_oauth_phase4-account")).toBeUndefined();
    expect(settings.getSetting(legacyId, "oauth_state_gmail")).toBe("state-from-legacy");

    await expect(migrateEmailAccountsToGlobal()).resolves.toEqual({
      migratedSettings: 0,
      migratedAccounts: 0,
      collisions: 0,
      skippedForEncryption: false,
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM settings WHERE project_id = ?").get(globalId)).toEqual({ count: 3 });
  });

  it("moves an unambiguous account from an archived former-global source project", async () => {
    const { legacyId, globalId, db } = seedLegacyProject();
    const accountValue = JSON.stringify({
      id: "archived-source",
      email: "archived-source@example.test",
      name: "Archived source",
      provider: "custom",
      authType: "app_password",
      connected: false,
      imapPass: encryptCredentialValue("archived-password"),
    });
    insertSetting(db, legacyId, "email_account_archived-source", accountValue);
    expect(projects.archiveProject("legacy-mail-project")).toBe(true);

    await expect(migrateEmailAccountsToGlobal()).resolves.toEqual({
      migratedSettings: 1,
      migratedAccounts: 1,
      collisions: 0,
      skippedForEncryption: false,
    });
    expect(settings.getSetting(globalId, "email_account_archived-source")).toBe(accountValue);
    expect(settings.getSetting(legacyId, "email_account_archived-source")).toBeUndefined();
  });

  it("leaves active and archived non-global accounts untouched across repeated automatic migrations", async () => {
    const globalId = projects.getProject("global-default")!.id;
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH!);
    const active = projects.createProject("active-mail-project");
    const archived = projects.createProject("archived-mail-project");
    const activeValue = JSON.stringify({
      id: "active-account",
      email: "active@example.test",
      provider: "custom",
      authType: "app_password",
      connected: false,
      imapPass: encryptCredentialValue("active-password"),
    });
    const archivedValue = JSON.stringify({
      id: "archived-account",
      email: "archived@example.test",
      provider: "custom",
      authType: "app_password",
      connected: false,
      imapPass: encryptCredentialValue("archived-password"),
    });
    settings.setSetting(globalId, "email_encryption_key_fingerprint", getEmailEncryptionKeyFingerprint());
    insertSetting(db, active.id, "email_account_active-account", activeValue);
    insertSetting(db, archived.id, "email_account_archived-account", archivedValue);
    expect(projects.archiveProject(archived.name)).toBe(true);

    await expect(migrateEmailAccountsToGlobal()).resolves.toEqual({
      migratedSettings: 0,
      migratedAccounts: 0,
      collisions: 0,
      skippedForEncryption: false,
    });
    await expect(migrateEmailAccountsToGlobal()).resolves.toEqual({
      migratedSettings: 0,
      migratedAccounts: 0,
      collisions: 0,
      skippedForEncryption: false,
    });
    expect(settings.getSetting(active.id, "email_account_active-account")).toBe(activeValue);
    expect(settings.getSetting(archived.id, "email_account_archived-account")).toBe(archivedValue);
    expect(settings.getSetting(globalId, "email_account_active-account")).toBeUndefined();
    expect(settings.getSetting(globalId, "email_account_archived-account")).toBeUndefined();
  });

  it("leaves all ambiguous source candidates untouched and reports only a conflict count", async () => {
    const { legacyId, globalId, db } = seedLegacyProject();
    const second = projects.createProject("second-legacy-mail-project");
    markProjectAsFormerGlobal(second.name);
    const firstValue = JSON.stringify({
      id: "shared-account",
      email: "first@example.test",
      name: "First source",
      provider: "custom",
      authType: "app_password",
      connected: false,
      imapPass: encryptCredentialValue("first-password"),
    });
    const secondValue = JSON.stringify({
      id: "shared-account",
      email: "second@example.test",
      name: "Second source",
      provider: "custom",
      authType: "app_password",
      connected: false,
      imapPass: encryptCredentialValue("second-password"),
    });
    insertSetting(db, legacyId, "email_account_shared-account", firstValue);
    insertSetting(db, second.id, "email_account_shared-account", secondValue);

    const result = await migrateEmailAccountsToGlobal();
    expect(result).toEqual({
      migratedSettings: 0,
      migratedAccounts: 0,
      collisions: 1,
      skippedForEncryption: false,
    });
    expect(JSON.stringify(result)).not.toContain("first-password");
    expect(JSON.stringify(result)).not.toContain("second-password");
    expect(settings.getSetting(globalId, "email_account_shared-account")).toBeUndefined();
    expect(settings.getSetting(legacyId, "email_account_shared-account")).toBe(firstValue);
    expect(settings.getSetting(second.id, "email_account_shared-account")).toBe(secondValue);
  });

  it("retains a source when its encryption fingerprint does not match the canonical global", async () => {
    const { legacyId, globalId, db } = seedLegacyProject();
    const accountValue = JSON.stringify({
      id: "fingerprint-source",
      email: "fingerprint-source@example.test",
      name: "Fingerprint source",
      provider: "custom",
      authType: "app_password",
      connected: false,
      imapPass: encryptCredentialValue("fingerprint-password"),
    });
    insertSetting(db, legacyId, "email_account_fingerprint-source", accountValue);
    settings.setSetting(legacyId, "email_encryption_key_fingerprint", "different-key-fingerprint");

    await expect(migrateEmailAccountsToGlobal()).resolves.toEqual({
      migratedSettings: 0,
      migratedAccounts: 0,
      collisions: 0,
      skippedForEncryption: true,
    });
    expect(settings.getSetting(globalId, "email_account_fingerprint-source")).toBeUndefined();
    expect(settings.getSetting(legacyId, "email_account_fingerprint-source")).toBe(accountValue);
  });

  it("keeps the source account on a key collision while migrating non-colliding OAuth data", async () => {
    const { legacyId, globalId, db } = seedLegacyProject();
    const legacyAccount = JSON.stringify({
      id: "same-account",
      email: "legacy@example.test",
      hidden: true,
      provider: "custom",
      authType: "app_password",
      connected: false,
      imapPass: encryptCredentialValue("legacy-password"),
    });
    const globalAccount = JSON.stringify({
      id: "same-account",
      email: "global@example.test",
      hidden: false,
      provider: "custom",
      authType: "app_password",
      connected: false,
      imapPass: encryptCredentialValue("global-password"),
    });
    insertSetting(db, legacyId, "email_account_same-account", legacyAccount);
    insertSetting(db, globalId, "email_account_same-account", globalAccount);
    const legacyOAuth = JSON.stringify({
      accessToken: encryptCredentialValue("legacy-access"),
      refreshToken: encryptCredentialValue("legacy-refresh"),
      expiryDate: 4_000_000_000_000,
      scope: "mail.test",
      email: "legacy@example.test",
    });
    insertSetting(db, legacyId, "email_oauth_same-account", legacyOAuth);

    await expect(migrateEmailAccountsToGlobal()).resolves.toEqual({
      migratedSettings: 0,
      migratedAccounts: 0,
      collisions: 1,
      skippedForEncryption: false,
    });
    expect(settings.getSetting(globalId, "email_account_same-account")).toBe(globalAccount);
    expect(settings.getSetting(legacyId, "email_account_same-account")).toBe(legacyAccount);
    expect(settings.getSetting(globalId, "email_oauth_same-account")).toBeUndefined();
    expect(settings.getSetting(legacyId, "email_oauth_same-account")).toBe(legacyOAuth);
  });

  it("rolls back every migrated group when a later destination write fails", async () => {
    const { legacyId, globalId, db } = seedLegacyProject();
    const migrationAccount = (id: string) => JSON.stringify({
      id,
      email: `${id}@example.test`,
      provider: "custom",
      authType: "app_password",
      connected: false,
    });
    insertSetting(db, legacyId, "email_account_good", migrationAccount("good"));
    insertSetting(db, legacyId, "email_account_bad", migrationAccount("bad"));
    db.exec(
      `CREATE TRIGGER phase4_abort_mail_migration
       BEFORE INSERT ON settings
       WHEN NEW.key = 'email_account_bad'
       BEGIN SELECT RAISE(ABORT, 'phase4 migration failure'); END`,
    );

    await expect(migrateEmailAccountsToGlobal()).resolves.toEqual({
      migratedSettings: 0,
      migratedAccounts: 0,
      collisions: 0,
      skippedForEncryption: false,
    });
    expect(settings.getSetting(legacyId, "email_account_good")).toBeTruthy();
    expect(settings.getSetting(legacyId, "email_account_bad")).toBeTruthy();
    expect(settings.getSetting(globalId, "email_account_good")).toBeUndefined();
    expect(settings.getSetting(globalId, "email_account_bad")).toBeUndefined();
  });

  it("never deletes any source row when a complete account group fails atomically", async () => {
    const { legacyId, globalId, db } = seedLegacyProject();
    const account = JSON.stringify({
      id: "atomic",
      email: "atomic@example.test",
      provider: "custom",
      authType: "oauth2",
      connected: false,
    });
    const tokens = JSON.stringify({
      accessToken: encryptCredentialValue("atomic-access"),
      refreshToken: encryptCredentialValue("atomic-refresh"),
      expiryDate: 4_000_000_000_000,
      scope: "mail.test",
      email: "atomic@example.test",
    });
    insertSetting(db, legacyId, "email_account_atomic", account);
    insertSetting(db, legacyId, "email_oauth_atomic", tokens);
    db.exec(
      `CREATE TRIGGER phase4_abort_complete_mail_group
       BEFORE INSERT ON settings
       WHEN NEW.key = 'email_oauth_atomic'
       BEGIN SELECT RAISE(ABORT, 'phase4 complete group failure'); END`,
    );

    await expect(migrateEmailAccountsToGlobal()).resolves.toEqual({
      migratedSettings: 0,
      migratedAccounts: 0,
      collisions: 0,
      skippedForEncryption: false,
    });
    expect(settings.getSetting(legacyId, "email_account_atomic")).toBe(account);
    expect(settings.getSetting(legacyId, "email_oauth_atomic")).toBe(tokens);
    expect(settings.getSetting(globalId, "email_account_atomic")).toBeUndefined();
    expect(settings.getSetting(globalId, "email_oauth_atomic")).toBeUndefined();
  });

  it("leaves source rows untouched when encryption continuity is unavailable", async () => {
    const { legacyId, globalId, db } = seedLegacyProject();
    insertSetting(db, legacyId, "email_account_locked", JSON.stringify({ id: "locked", email: "locked@example.test" }));
    emailMocks.getEmailEncryptionDiagnostics.mockReturnValueOnce({
      status: "mismatch",
      globalProjectId: globalId,
    });

    await expect(migrateEmailAccountsToGlobal()).resolves.toEqual({
      migratedSettings: 0,
      migratedAccounts: 0,
      collisions: 0,
      skippedForEncryption: true,
    });
    expect(settings.getSetting(legacyId, "email_account_locked")).toBeTruthy();
    expect(settings.getSetting(globalId, "email_account_locked")).toBeUndefined();
  });
});

function dbFrom(_projectId: string): ReturnType<typeof getDb> {
  return getDb(process.env.INGENIUM_CORE_DB_PATH!);
}

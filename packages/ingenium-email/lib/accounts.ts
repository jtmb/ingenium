/**
 * Global email-account persistence.
 *
 * Account metadata and credentials live in settings because mail accounts are
 * shared infrastructure. Every operation resolves the currently assigned
 * global project inside its database transaction; no process-lifetime project
 * identifier is cached.
 */

import { randomUUID } from "node:crypto";
import * as core from "ingenium-core";
import type { EmailAccount, OAuthToken, EmailFolder } from "./types.js";
import { connectAccount, listFolders } from "./imap.js";
import {
  decryptCredentialValue,
  encryptCredentialValue,
  getEmailEncryptionKeyFingerprint,
} from "./credential-crypto.js";
import { resetAuthCircuit } from "./circuit-breaker.js";
import { providerErrorResponse } from "./provider-errors.js";

const SETTINGS_PREFIX = "email_account_";
const OAUTH_SETTINGS_PREFIX = "email_oauth_";
export const EMAIL_ENCRYPTION_KEY_FINGERPRINT_SETTING = "email_encryption_key_fingerprint";

interface StoredAccount {
  id: string;
  email: string;
  name: string;
  provider: string;
  authType: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  connected: boolean;
  lastSync?: string;
  hidden?: boolean;
  imapPass?: string;
  smtpPass?: string;
  tokens?: OAuthToken;
}

export interface EmailCredentialMigrationValidation {
  valid: boolean;
  hasCredentials: boolean;
  reason?: "ACCOUNT_MALFORMED" | "ACCOUNT_ID_MISMATCH" | "CREDENTIAL_MISSING" | "CREDENTIAL_MALFORMED" | "CREDENTIAL_DECRYPT_FAILED" | "TOKEN_MISMATCH";
}

export type EmailEncryptionStatus =
  | "ready"
  | "uninitialized"
  | "unavailable"
  | "mismatch"
  | "unverified"
  | "global-unavailable";

export interface EmailEncryptionDiagnostics {
  status: EmailEncryptionStatus;
  globalProjectId?: string;
}

export class EmailEncryptionContinuityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailEncryptionContinuityError";
  }
}

type Db = ReturnType<typeof core.getDb>;

function isTransactionalDb(db: Db): db is Db & { transaction: <T>(fn: () => T) => () => T } {
  return typeof (db as unknown as { transaction?: unknown }).transaction === "function";
}

function optionalCoreExport<T>(name: string): T | undefined {
  // Vitest's strict module mocks throw when an absent named export is read.
  // Check ownership first so legacy focused tests can exercise the fallback.
  if (!Object.prototype.hasOwnProperty.call(core, name)) return undefined;
  return Reflect.get(core, name) as T | undefined;
}

/** Compatibility fallback keeps isolated legacy mocks functional; production uses execTransaction. */
function runTransaction<T>(fn: () => T): T {
  const execute = optionalCoreExport<<R>(operation: () => R) => R>("execTransaction");
  if (execute) return execute(fn);
  const db = core.getDb();
  return isTransactionalDb(db) ? db.transaction(fn)() : fn();
}

function checkpointAfterCommit(): void {
  optionalCoreExport<() => void>("checkpointAfterWrite")?.();
}

function settingsKey(accountId: string): string {
  return `${SETTINGS_PREFIX}${accountId}`;
}

function oauthKey(accountId: string): string {
  return `${OAUTH_SETTINGS_PREFIX}${accountId}`;
}

function readSetting(db: Db, projectId: string, key: string): string | undefined {
  if (!isTransactionalDb(db)) {
    return core.settings.getSetting(projectId, key) ?? undefined;
  }
  return (db.prepare("SELECT value FROM settings WHERE project_id = ? AND key = ?")
    .get(projectId, key) as { value: string } | undefined)?.value;
}

function writeSetting(db: Db, projectId: string, key: string, value: string): void {
  if (!isTransactionalDb(db)) {
    core.settings.setSetting(projectId, key, value);
    return;
  }
  db.prepare(
    `INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`,
  ).run(projectId, key, value);
}

function deleteSetting(db: Db, projectId: string, key: string): void {
  db.prepare("DELETE FROM settings WHERE project_id = ? AND key = ?").run(projectId, key);
}

function resolveGlobalProjectId(db: Db): string {
  const row = db.prepare(
    "SELECT id FROM projects WHERE is_global = 1 AND archived_at IS NULL ORDER BY updated_at DESC, id ASC LIMIT 1",
  ).get() as { id: string } | undefined;
  if (!row) throw new Error("No global project found. Create one via /init-project or the Settings page.");
  return row.id;
}

/** Resolve the active global project on every operation. */
export function getGlobalProjectId(): string {
  return resolveGlobalProjectId(core.getDb());
}

function parseStoredAccount(raw: string): StoredAccount {
  const parsed = JSON.parse(raw) as StoredAccount;
  if (!parsed.id || !parsed.email) throw new Error("Stored email account metadata is malformed");
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function invalidMigrationCredential(
  reason: NonNullable<EmailCredentialMigrationValidation["reason"]>,
): EmailCredentialMigrationValidation {
  return { valid: false, hasCredentials: false, reason };
}

function decryptMigrationCiphertext(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    return decryptCredentialValue(value);
  } catch {
    return undefined;
  }
}

function validateMigrationTokens(
  value: unknown,
  expectedEmail: string,
): { token?: OAuthToken; reason?: EmailCredentialMigrationValidation["reason"] } {
  if (!isRecord(value)
    || typeof value.accessToken !== "string"
    || typeof value.refreshToken !== "string") {
    return { reason: "CREDENTIAL_MALFORMED" };
  }

  const accessToken = decryptMigrationCiphertext(value.accessToken);
  const refreshToken = decryptMigrationCiphertext(value.refreshToken);
  if (accessToken === undefined || refreshToken === undefined || !accessToken) {
    return { reason: "CREDENTIAL_DECRYPT_FAILED" };
  }
  if (typeof value.email === "string" && value.email
    && value.email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) {
    return { reason: "TOKEN_MISMATCH" };
  }

  return {
    token: {
      accessToken,
      refreshToken,
      expiryDate: typeof value.expiryDate === "number" ? value.expiryDate : 0,
      scope: typeof value.scope === "string" ? value.scope : "",
      email: typeof value.email === "string" ? value.email : undefined,
    },
  };
}

/**
 * Validate a legacy account setting before it can be moved into the global
 * namespace. This is intentionally read-only: callers retain every source row
 * unless this function confirms all durable encrypted material decrypts with
 * the active key and belongs to the account named by its setting key.
 */
export function validateEmailAccountMigrationCredentials(
  accountId: string,
  accountRaw: string,
  oauthRaw?: string,
): EmailCredentialMigrationValidation {
  let account: StoredAccount;
  try {
    account = parseStoredAccount(accountRaw);
  } catch {
    return invalidMigrationCredential("ACCOUNT_MALFORMED");
  }
  if (account.id !== accountId) return invalidMigrationCredential("ACCOUNT_ID_MISMATCH");
  if (!account.email
    || (account.authType !== undefined && typeof account.authType !== "string")
    || (account.provider !== undefined && typeof account.provider !== "string")) {
    return invalidMigrationCredential("ACCOUNT_MALFORMED");
  }

  let hasCredentials = false;
  for (const credential of [account.imapPass, account.smtpPass]) {
    if (credential === undefined) continue;
    hasCredentials = true;
    const decrypted = decryptMigrationCiphertext(credential);
    if (!decrypted) return invalidMigrationCredential("CREDENTIAL_DECRYPT_FAILED");
  }

  const durableTokens: OAuthToken[] = [];
  if (account.tokens !== undefined) {
    hasCredentials = true;
    const validated = validateMigrationTokens(account.tokens, account.email);
    if (!validated.token) return invalidMigrationCredential(validated.reason ?? "CREDENTIAL_MALFORMED");
    durableTokens.push(validated.token);
  }
  if (oauthRaw !== undefined) {
    hasCredentials = true;
    let oauthValue: unknown;
    try {
      oauthValue = JSON.parse(oauthRaw);
    } catch {
      return invalidMigrationCredential("CREDENTIAL_MALFORMED");
    }
    const validated = validateMigrationTokens(oauthValue, account.email);
    if (!validated.token) return invalidMigrationCredential(validated.reason ?? "CREDENTIAL_MALFORMED");
    durableTokens.push(validated.token);
  }

  if (durableTokens.length === 2
    && (durableTokens[0]!.accessToken !== durableTokens[1]!.accessToken
      || durableTokens[0]!.refreshToken !== durableTokens[1]!.refreshToken)) {
    return invalidMigrationCredential("TOKEN_MISMATCH");
  }
  if (account.authType === "oauth2" && durableTokens.length === 0) {
    return invalidMigrationCredential("CREDENTIAL_MISSING");
  }

  return { valid: true, hasCredentials };
}

function hasStoredSecret(account: StoredAccount | undefined, oauthRaw?: string): boolean {
  return Boolean(account?.imapPass || account?.smtpPass || account?.tokens || oauthRaw);
}

function currentEncryptionStatus(db: Db, projectId: string): EmailEncryptionDiagnostics {
  let fingerprint: string;
  try {
    fingerprint = getEmailEncryptionKeyFingerprint();
  } catch {
    return { status: "unavailable", globalProjectId: projectId };
  }

  const storedFingerprint = readSetting(db, projectId, EMAIL_ENCRYPTION_KEY_FINGERPRINT_SETTING);
  if (!storedFingerprint) return { status: "uninitialized", globalProjectId: projectId };
  return {
    status: storedFingerprint === fingerprint ? "ready" : "mismatch",
    globalProjectId: projectId,
  };
}

/** Non-secret runtime diagnostic for mail startup and health reporting. */
export function getEmailEncryptionDiagnostics(): EmailEncryptionDiagnostics {
  try {
    const db = core.getDb();
    return currentEncryptionStatus(db, resolveGlobalProjectId(db));
  } catch {
    return { status: "global-unavailable" };
  }
}

/**
 * Require a known-continuous key before modifying encrypted material.
 * A missing fingerprint plus existing secret material is intentionally blocked:
 * accepting a replacement key in that state could overwrite recoverable data.
 */
function assertWritableEncryption(
  db: Db,
  projectId: string,
  existingSecret: boolean,
): { fingerprint: string; initializeFingerprint: boolean } {
  let fingerprint: string;
  try {
    fingerprint = getEmailEncryptionKeyFingerprint();
  } catch {
    throw new EmailEncryptionContinuityError("Email encryption is unavailable; credentials were not changed");
  }

  const storedFingerprint = readSetting(db, projectId, EMAIL_ENCRYPTION_KEY_FINGERPRINT_SETTING);
  if (storedFingerprint && storedFingerprint !== fingerprint) {
    throw new EmailEncryptionContinuityError("Email encryption key changed; credentials were not changed");
  }
  if (!storedFingerprint && existingSecret) {
    throw new EmailEncryptionContinuityError("Email encryption continuity is unverified; credentials were not changed");
  }
  return { fingerprint, initializeFingerprint: !storedFingerprint };
}

function assertSafeMetadataMutation(db: Db, projectId: string, stored: StoredAccount, oauthRaw?: string): void {
  if (!hasStoredSecret(stored, oauthRaw)) return;
  const status = currentEncryptionStatus(db, projectId).status;
  if (status !== "ready") {
    throw new EmailEncryptionContinuityError("Email encryption is not ready; account data was not changed");
  }
}

function encryptedTokens(tokens: OAuthToken): OAuthToken {
  return {
    accessToken: encryptCredentialValue(tokens.accessToken),
    refreshToken: encryptCredentialValue(tokens.refreshToken),
    expiryDate: tokens.expiryDate,
    scope: tokens.scope,
    email: tokens.email,
  };
}

function decryptedTokens(tokens: OAuthToken): OAuthToken {
  return {
    accessToken: decryptCredentialValue(tokens.accessToken),
    refreshToken: decryptCredentialValue(tokens.refreshToken),
    expiryDate: tokens.expiryDate,
    scope: tokens.scope,
    email: tokens.email,
  };
}

function storedToAccount(stored: StoredAccount): EmailAccount {
  return {
    id: stored.id,
    email: stored.email,
    name: stored.name,
    provider: stored.provider as EmailAccount["provider"],
    authType: stored.authType as EmailAccount["authType"],
    imapHost: stored.imapHost,
    imapPort: stored.imapPort,
    smtpHost: stored.smtpHost,
    smtpPort: stored.smtpPort,
    connected: stored.connected,
    lastSync: stored.lastSync,
    hidden: stored.hidden,
  };
}

function buildStoredAccount(account: Omit<EmailAccount, "id" | "connected">, id = randomUUID()): StoredAccount {
  return {
    id,
    email: account.email,
    name: account.name,
    provider: account.provider,
    authType: account.authType,
    imapHost: account.imapHost,
    imapPort: account.imapPort,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    connected: false,
    hidden: account.hidden,
  };
}

/** List all global email accounts, ignoring malformed rows rather than crashing mail startup. */
export function listAccounts(_projectId: string): EmailAccount[] {
  const db = core.getDb();
  const projectId = resolveGlobalProjectId(db);
  const rows = db.prepare(
    "SELECT value FROM settings WHERE project_id = ? AND key LIKE ?",
  ).all(projectId, `${SETTINGS_PREFIX}%`) as Array<{ value: string }>;
  return rows.flatMap(({ value }) => {
    try {
      return [storedToAccount(parseStoredAccount(value))];
    } catch {
      return [];
    }
  });
}

export function getAccount(_projectId: string, accountId: string): EmailAccount | undefined {
  const db = core.getDb();
  const projectId = resolveGlobalProjectId(db);
  const raw = readSetting(db, projectId, settingsKey(accountId));
  if (!raw) return undefined;
  try {
    return storedToAccount(parseStoredAccount(raw));
  } catch {
    return undefined;
  }
}

/** Persist non-secret account metadata atomically. */
export function addAccount(
  _projectId: string,
  account: Omit<EmailAccount, "id" | "connected">,
): EmailAccount {
  const stored = buildStoredAccount(account);
  const result = runTransaction(() => {
    const db = core.getDb();
    const projectId = resolveGlobalProjectId(db);
    writeSetting(db, projectId, settingsKey(stored.id), JSON.stringify(stored));
    return storedToAccount(stored);
  });
  checkpointAfterCommit();
  return result;
}

/** Create manual account metadata and encrypted credentials in one transaction. */
export function createAccountWithCredentials(
  _projectId: string,
  account: Omit<EmailAccount, "id" | "connected">,
  credentials: { imapPass?: string; smtpPass?: string },
): EmailAccount {
  const stored = buildStoredAccount(account);
  const result = runTransaction(() => {
    const db = core.getDb();
    const projectId = resolveGlobalProjectId(db);
    const guard = assertWritableEncryption(db, projectId, false);
    if (credentials.imapPass !== undefined) stored.imapPass = encryptCredentialValue(credentials.imapPass);
    if (credentials.smtpPass !== undefined) stored.smtpPass = encryptCredentialValue(credentials.smtpPass);
    writeSetting(db, projectId, settingsKey(stored.id), JSON.stringify(stored));
    if (guard.initializeFingerprint) {
      writeSetting(db, projectId, EMAIL_ENCRYPTION_KEY_FINGERPRINT_SETTING, guard.fingerprint);
    }
    return storedToAccount(stored);
  });
  checkpointAfterCommit();
  resetAuthCircuit(stored.email);
  return result;
}

/** Create an OAuth account and encrypted token record in one transaction. */
export function createOAuthAccountWithTokens(
  _projectId: string,
  account: Omit<EmailAccount, "id" | "connected">,
  tokens: OAuthToken,
): EmailAccount {
  const stored = buildStoredAccount(account);
  const result = runTransaction(() => {
    const db = core.getDb();
    const projectId = resolveGlobalProjectId(db);
    const guard = assertWritableEncryption(db, projectId, false);
    writeSetting(db, projectId, settingsKey(stored.id), JSON.stringify(stored));
    writeSetting(db, projectId, oauthKey(stored.id), JSON.stringify(encryptedTokens(tokens)));
    if (guard.initializeFingerprint) {
      writeSetting(db, projectId, EMAIL_ENCRYPTION_KEY_FINGERPRINT_SETTING, guard.fingerprint);
    }
    return storedToAccount(stored);
  });
  checkpointAfterCommit();
  resetAuthCircuit(stored.email);
  return result;
}

export function removeAccount(_projectId: string, accountId: string): void {
  const removedEmail = runTransaction(() => {
    const db = core.getDb();
    const projectId = resolveGlobalProjectId(db);
    const raw = readSetting(db, projectId, settingsKey(accountId));
    if (!raw) return undefined;
    const stored = parseStoredAccount(raw);
    assertSafeMetadataMutation(db, projectId, stored, readSetting(db, projectId, oauthKey(accountId)));
    deleteSetting(db, projectId, settingsKey(accountId));
    deleteSetting(db, projectId, oauthKey(accountId));
    return stored.email;
  });
  if (removedEmail) {
    checkpointAfterCommit();
    resetAuthCircuit(removedEmail);
  }
}

/** Replace encrypted manual credentials atomically without touching account metadata. */
export function storeCredentials(
  _projectId: string,
  accountId: string,
  credentials: { imapPass?: string; smtpPass?: string; tokens?: OAuthToken },
): void {
  const accountEmail = runTransaction(() => {
    const db = core.getDb();
    const projectId = resolveGlobalProjectId(db);
    const raw = readSetting(db, projectId, settingsKey(accountId));
    if (!raw) throw new Error(`Account ${accountId} not found`);
    const stored = parseStoredAccount(raw);
    const guard = assertWritableEncryption(
      db,
      projectId,
      hasStoredSecret(stored, readSetting(db, projectId, oauthKey(accountId))),
    );
    if (credentials.imapPass !== undefined) stored.imapPass = encryptCredentialValue(credentials.imapPass);
    if (credentials.smtpPass !== undefined) stored.smtpPass = encryptCredentialValue(credentials.smtpPass);
    if (credentials.tokens) stored.tokens = encryptedTokens(credentials.tokens);
    writeSetting(db, projectId, settingsKey(accountId), JSON.stringify(stored));
    if (guard.initializeFingerprint) {
      writeSetting(db, projectId, EMAIL_ENCRYPTION_KEY_FINGERPRINT_SETTING, guard.fingerprint);
    }
    return stored.email;
  });
  checkpointAfterCommit();
  resetAuthCircuit(accountEmail);
}

/** Store encrypted OAuth tokens atomically after checking the account still exists. */
export function storeOAuthTokens(_projectId: string, accountId: string, tokens: OAuthToken): void {
  const accountEmail = runTransaction(() => {
    const db = core.getDb();
    const projectId = resolveGlobalProjectId(db);
    const raw = readSetting(db, projectId, settingsKey(accountId));
    if (!raw) throw new Error(`Account ${accountId} not found`);
    const stored = parseStoredAccount(raw);
    const guard = assertWritableEncryption(
      db,
      projectId,
      hasStoredSecret(stored, readSetting(db, projectId, oauthKey(accountId))),
    );
    writeSetting(db, projectId, oauthKey(accountId), JSON.stringify(encryptedTokens(tokens)));
    if (guard.initializeFingerprint) {
      writeSetting(db, projectId, EMAIL_ENCRYPTION_KEY_FINGERPRINT_SETTING, guard.fingerprint);
    }
    return stored.email;
  });
  checkpointAfterCommit();
  resetAuthCircuit(accountEmail);
}

/** Retrieve credentials only when the persisted key-continuity guard is ready. */
export function getCredentials(
  _projectId: string,
  accountId: string,
): { password?: string; tokens?: OAuthToken } | undefined {
  const db = core.getDb();
  const projectId = resolveGlobalProjectId(db);
  const raw = readSetting(db, projectId, settingsKey(accountId));
  if (!raw) return undefined;

  let stored: StoredAccount;
  try {
    stored = parseStoredAccount(raw);
  } catch {
    return undefined;
  }
  const oauthRaw = readSetting(db, projectId, oauthKey(accountId));
  if (!hasStoredSecret(stored, oauthRaw) || currentEncryptionStatus(db, projectId).status !== "ready") {
    return undefined;
  }

  try {
    const password = stored.imapPass ? decryptCredentialValue(stored.imapPass) : undefined;
    const tokens = stored.tokens
      ? decryptedTokens(stored.tokens)
      : oauthRaw
        ? decryptedTokens(JSON.parse(oauthRaw) as OAuthToken)
        : undefined;
    return { password, tokens };
  } catch {
    return undefined;
  }
}

export async function testConnection(
  account: EmailAccount,
  auth: { password?: string; tokens?: OAuthToken },
): Promise<{ success: boolean; folders?: EmailFolder[]; error?: string }> {
  try {
    await connectAccount(account, auth);
    return { success: true, folders: await listFolders(account.id) };
  } catch (error: unknown) {
    return { success: false, error: providerErrorResponse(error, "imap").message };
  }
}

export function setAccountConnected(_projectId: string, accountId: string, connected: boolean): void {
  const accountEmail = runTransaction(() => {
    const db = core.getDb();
    const projectId = resolveGlobalProjectId(db);
    const raw = readSetting(db, projectId, settingsKey(accountId));
    if (!raw) throw new Error(`Account ${accountId} not found`);
    const stored = parseStoredAccount(raw);
    assertSafeMetadataMutation(db, projectId, stored, readSetting(db, projectId, oauthKey(accountId)));
    stored.connected = connected;
    stored.lastSync = connected ? new Date().toISOString() : stored.lastSync;
    writeSetting(db, projectId, settingsKey(accountId), JSON.stringify(stored));
    return stored.email;
  });
  checkpointAfterCommit();
  if (connected) resetAuthCircuit(accountEmail);
}

/** Update non-secret metadata while preserving encrypted fields byte-for-byte. */
export function storeAccount(_projectId: string, account: EmailAccount): void {
  runTransaction(() => {
    const db = core.getDb();
    const projectId = resolveGlobalProjectId(db);
    const raw = readSetting(db, projectId, settingsKey(account.id));
    if (!raw) throw new Error(`Account ${account.id} not found`);
    const stored = parseStoredAccount(raw);
    assertSafeMetadataMutation(db, projectId, stored, readSetting(db, projectId, oauthKey(account.id)));
    stored.hidden = account.hidden;
    stored.connected = account.connected;
    stored.lastSync = account.lastSync;
    stored.name = account.name;
    writeSetting(db, projectId, settingsKey(account.id), JSON.stringify(stored));
  });
  checkpointAfterCommit();
}

/**
 * Bootstrap the fingerprint for pre-guard encrypted records only after every
 * encrypted field decrypts with the currently configured key. Failed or legacy
 * plaintext records remain untouched and mail degrades safely.
 */
export function establishEmailEncryptionKeyContinuity(): EmailEncryptionDiagnostics {
  let didPersist = false;
  const diagnostics = runTransaction(() => {
    const db = core.getDb();
    const projectId = resolveGlobalProjectId(db);
    const status = currentEncryptionStatus(db, projectId);
    if (status.status !== "uninitialized") return status;

    const rows = db.prepare(
      `SELECT s.project_id, s.key, s.value
       FROM settings s
       JOIN projects p ON p.id = s.project_id
       WHERE p.archived_at IS NULL
         AND (s.key LIKE ? OR s.key LIKE ?)`,
    ).all(`${SETTINGS_PREFIX}%`, `${OAUTH_SETTINGS_PREFIX}%`) as Array<MailSettingRow>;
    const accounts = new Map<string, MailSettingRow>();
    const oauth = new Map<string, MailSettingRow>();
    try {
      for (const row of rows) {
        if (row.key.startsWith(SETTINGS_PREFIX)) {
          accounts.set(`${row.project_id}\u0000${row.key.slice(SETTINGS_PREFIX.length)}`, row);
        } else {
          oauth.set(`${row.project_id}\u0000${row.key.slice(OAUTH_SETTINGS_PREFIX.length)}`, row);
        }
      }
      for (const [key, account] of accounts) {
        const accountId = account.key.slice(SETTINGS_PREFIX.length);
        const validation = validateEmailAccountMigrationCredentials(accountId, account.value, oauth.get(key)?.value);
        if (!validation.valid) return { status: "unverified" as const, globalProjectId: projectId };
        oauth.delete(key);
      }
      // OAuth tokens without an account record cannot be safely attributed.
      if (oauth.size > 0) return { status: "unverified" as const, globalProjectId: projectId };
    } catch {
      return { status: "unverified" as const, globalProjectId: projectId };
    }

    writeSetting(db, projectId, EMAIL_ENCRYPTION_KEY_FINGERPRINT_SETTING, getEmailEncryptionKeyFingerprint());
    didPersist = true;
    return { status: "ready" as const, globalProjectId: projectId };
  });
  if (didPersist) checkpointAfterCommit();
  return diagnostics;
}

interface MailSettingRow {
  project_id: string;
  key: string;
  value: string;
}

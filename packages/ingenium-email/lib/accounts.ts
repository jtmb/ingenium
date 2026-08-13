/**
 * Global email-account persistence.
 *
 * Account metadata and credentials live in settings because mail accounts are
 * shared infrastructure. Every operation resolves the currently assigned
 * global project inside its database transaction; no process-lifetime project
 * identifier is cached.
 */

import { randomUUID } from "node:crypto";
import type { EmailAccount, EmailOwner, OAuthToken, EmailFolder } from "./types.js";
import { connectAccount, listFolders } from "./imap.js";
import {
  decryptCredentialValue,
  encryptCredentialValue,
  getEmailEncryptionKeyFingerprint,
} from "./credential-crypto.js";
import { resetAuthCircuit } from "./circuit-breaker.js";
import { providerErrorResponse } from "./provider-errors.js";
import { getEmailRuntime, type EmailSettingsTransaction } from "./runtime.js";
import { isEmailProvider, isFixedProvider } from "./providers.js";

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

export class EmailAccountEndpointValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailAccountEndpointValidationError";
  }
}

type EndpointInput = {
  imapHost?: unknown;
  imapPort?: unknown;
  smtpHost?: unknown;
  smtpPort?: unknown;
};

type AccountEndpoints = Pick<EmailAccount, "imapHost" | "imapPort" | "smtpHost" | "smtpPort">;

function hasEndpointOverride(endpoints: EndpointInput): boolean {
  return endpoints.imapHost !== undefined
    || endpoints.imapPort !== undefined
    || endpoints.smtpHost !== undefined
    || endpoints.smtpPort !== undefined;
}

function normalizeCustomHost(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new EmailAccountEndpointValidationError(`${field} must be a string`);
  }
  const host = value.trim();
  if (!host) return undefined;
  if (/\s/.test(host)) {
    throw new EmailAccountEndpointValidationError(`${field} must not contain whitespace`);
  }
  return host;
}

function normalizeCustomPort(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new EmailAccountEndpointValidationError(`${field} must be an integer between 1 and 65535`);
  }
  return value;
}

/** Validate caller-supplied endpoints before any credential or settings access. */
export function normalizeEmailAccountEndpoints(
  provider: unknown,
  endpoints: EndpointInput,
  requireCompleteCustomEndpoints = false,
): AccountEndpoints {
  if (!isEmailProvider(provider)) {
    throw new EmailAccountEndpointValidationError("provider is not supported");
  }
  if (isFixedProvider(provider)) {
    if (hasEndpointOverride(endpoints)) {
      throw new EmailAccountEndpointValidationError("Endpoint overrides are only supported for custom providers");
    }
    return {};
  }

  const normalized = {
    imapHost: normalizeCustomHost(endpoints.imapHost, "imapHost"),
    imapPort: normalizeCustomPort(endpoints.imapPort, "imapPort"),
    smtpHost: normalizeCustomHost(endpoints.smtpHost, "smtpHost"),
    smtpPort: normalizeCustomPort(endpoints.smtpPort, "smtpPort"),
  };
  if (requireCompleteCustomEndpoints
    && (normalized.imapHost === undefined
      || normalized.imapPort === undefined
      || normalized.smtpHost === undefined
      || normalized.smtpPort === undefined)) {
    throw new EmailAccountEndpointValidationError("Custom provider changes require IMAP and SMTP hosts and ports");
  }
  return normalized;
}

function settingsKey(accountId: string): string {
  return `${SETTINGS_PREFIX}${accountId}`;
}

function oauthKey(accountId: string): string {
  return `${OAUTH_SETTINGS_PREFIX}${accountId}`;
}

/** Resolve the active global project on every operation. */
export function getGlobalProjectId(): string {
  return getEmailRuntime().accounts.getGlobalProjectId();
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

function currentEncryptionStatus(settings: Pick<EmailSettingsTransaction, "get">, projectId: string): EmailEncryptionDiagnostics {
  let fingerprint: string;
  try {
    fingerprint = getEmailEncryptionKeyFingerprint();
  } catch {
    return { status: "unavailable", globalProjectId: projectId };
  }

  const storedFingerprint = settings.get(EMAIL_ENCRYPTION_KEY_FINGERPRINT_SETTING);
  if (!storedFingerprint) return { status: "uninitialized", globalProjectId: projectId };
  return {
    status: storedFingerprint === fingerprint ? "ready" : "mismatch",
    globalProjectId: projectId,
  };
}

/** Non-secret runtime diagnostic for mail startup and health reporting. */
export function getEmailEncryptionDiagnostics(): EmailEncryptionDiagnostics {
  try {
    const runtime = getEmailRuntime();
    const projectId = runtime.accounts.getGlobalProjectId();
    return currentEncryptionStatus({ get: runtime.accounts.getGlobalSetting }, projectId);
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
  settings: Pick<EmailSettingsTransaction, "get">,
  existingSecret: boolean,
): { fingerprint: string; initializeFingerprint: boolean } {
  let fingerprint: string;
  try {
    fingerprint = getEmailEncryptionKeyFingerprint();
  } catch {
    throw new EmailEncryptionContinuityError("Email encryption is unavailable; credentials were not changed");
  }

  const storedFingerprint = settings.get(EMAIL_ENCRYPTION_KEY_FINGERPRINT_SETTING);
  if (storedFingerprint && storedFingerprint !== fingerprint) {
    throw new EmailEncryptionContinuityError("Email encryption key changed; credentials were not changed");
  }
  if (!storedFingerprint && existingSecret) {
    throw new EmailEncryptionContinuityError("Email encryption continuity is unverified; credentials were not changed");
  }
  return { fingerprint, initializeFingerprint: !storedFingerprint };
}

function assertSafeMetadataMutation(settings: Pick<EmailSettingsTransaction, "get">, projectId: string, stored: StoredAccount, oauthRaw?: string): void {
  if (!hasStoredSecret(stored, oauthRaw)) return;
  const status = currentEncryptionStatus(settings, projectId).status;
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
  if (!isEmailProvider(stored.provider)) {
    throw new Error("Stored email account provider is unsupported");
  }
  const endpoints = isFixedProvider(stored.provider)
    ? {}
    : normalizeEmailAccountEndpoints(stored.provider, stored);
  return {
    id: stored.id,
    email: stored.email,
    name: stored.name,
    provider: stored.provider,
    authType: stored.authType as EmailAccount["authType"],
    ...endpoints,
    connected: stored.connected,
    lastSync: stored.lastSync,
    hidden: stored.hidden,
  };
}

function buildStoredAccount(account: Omit<EmailAccount, "id" | "connected">, id: string = randomUUID()): StoredAccount {
  const endpoints = normalizeEmailAccountEndpoints(account.provider, account);
  return {
    id,
    email: account.email,
    name: account.name,
    provider: account.provider,
    authType: account.authType,
    ...endpoints,
    connected: false,
    hidden: account.hidden,
  };
}

/** List all global email accounts, ignoring malformed rows rather than crashing mail startup. */
export function listAccounts(): EmailAccount[] {
  const normalized = getEmailRuntime().accounts.listAccounts?.() ?? [];
  if (normalized.length > 0) return normalized;
  const rows = getEmailRuntime().accounts.listGlobalSettings(SETTINGS_PREFIX);
  return rows.flatMap((value) => {
    try {
      return [storedToAccount(parseStoredAccount(value))];
    } catch {
      return [];
    }
  });
}

export function getAccount(accountId: string, organizationId?: string): EmailAccount | undefined {
  const normalized = organizationId
    ? getEmailRuntime().accounts.getAccount?.(organizationId, accountId)
    : getEmailRuntime().accounts.listAccounts?.().find((account) => account.id === accountId);
  if (normalized) return normalized;
  const raw = getEmailRuntime().accounts.getGlobalSetting(settingsKey(accountId));
  if (!raw) return undefined;
  try {
    return storedToAccount(parseStoredAccount(raw));
  } catch {
    return undefined;
  }
}

/** Persist non-secret account metadata atomically. */
export function addAccount(account: Omit<EmailAccount, "id" | "connected">, owner?: EmailOwner): EmailAccount {
  const stored = buildStoredAccount(account);
  if (owner) {
    const normalized = { ...storedToAccount(stored), ...owner };
    const createAccount = getEmailRuntime().accounts.createAccount;
    if (!createAccount) throw new Error("Normalized mail account persistence is unavailable");
    getEmailRuntime().accounts.mutateGlobalSettings(() => createAccount(normalized));
    return normalized;
  }
  return getEmailRuntime().accounts.mutateGlobalSettings((settings) => {
    settings.set(settingsKey(stored.id), JSON.stringify(stored));
    return storedToAccount(stored);
  });
}

/** Create manual account metadata and encrypted credentials in one transaction. */
export function createAccountWithCredentials(
  account: Omit<EmailAccount, "id" | "connected">,
  credentials: { imapPass?: string; smtpPass?: string },
  owner?: EmailOwner,
): EmailAccount {
  const stored = buildStoredAccount(account);
  if (owner) {
    const normalized = { ...storedToAccount(stored), ...owner };
    const { createAccount, setCredential } = getEmailRuntime().accounts;
    if (!createAccount || !setCredential) throw new Error("Normalized mail credential persistence is unavailable");
    getEmailRuntime().accounts.mutateGlobalSettings(() => {
      createAccount(normalized);
      if (credentials.imapPass !== undefined) setCredential(owner.organizationId, stored.id, "imap_password", encryptCredentialValue(credentials.imapPass));
      if (credentials.smtpPass !== undefined) setCredential(owner.organizationId, stored.id, "smtp_password", encryptCredentialValue(credentials.smtpPass));
    });
    resetAuthCircuit(stored.email);
    return normalized;
  }
  const result = getEmailRuntime().accounts.mutateGlobalSettings((settings) => {
    const guard = assertWritableEncryption(settings, false);
    if (credentials.imapPass !== undefined) stored.imapPass = encryptCredentialValue(credentials.imapPass);
    if (credentials.smtpPass !== undefined) stored.smtpPass = encryptCredentialValue(credentials.smtpPass);
    settings.set(settingsKey(stored.id), JSON.stringify(stored));
    if (guard.initializeFingerprint) {
      settings.set(EMAIL_ENCRYPTION_KEY_FINGERPRINT_SETTING, guard.fingerprint);
    }
    return storedToAccount(stored);
  });
  resetAuthCircuit(stored.email);
  return result;
}

/** Create an OAuth account and encrypted token record in one transaction. */
export function createOAuthAccountWithTokens(
  account: Omit<EmailAccount, "connected"> | Omit<EmailAccount, "id" | "connected">,
  tokens: OAuthToken,
  owner?: EmailOwner,
): EmailAccount {
  const stored = buildStoredAccount(account, "id" in account ? account.id : undefined);
  if (owner) {
    const normalized = { ...storedToAccount(stored), ...owner };
    const { createAccount, setCredential } = getEmailRuntime().accounts;
    if (!createAccount || !setCredential) throw new Error("Normalized mail credential persistence is unavailable");
    getEmailRuntime().accounts.mutateGlobalSettings(() => {
      createAccount(normalized);
      setCredential(owner.organizationId, stored.id, "oauth_access_token", encryptCredentialValue(tokens.accessToken), JSON.stringify({ expiryDate: tokens.expiryDate, scope: tokens.scope }));
      setCredential(owner.organizationId, stored.id, "oauth_refresh_token", encryptCredentialValue(tokens.refreshToken), JSON.stringify({ expiryDate: tokens.expiryDate, scope: tokens.scope }));
    });
    resetAuthCircuit(stored.email);
    return normalized;
  }
  const result = getEmailRuntime().accounts.mutateGlobalSettings((settings) => {
    const guard = assertWritableEncryption(settings, false);
    settings.set(settingsKey(stored.id), JSON.stringify(stored));
    settings.set(oauthKey(stored.id), JSON.stringify(encryptedTokens(tokens)));
    if (guard.initializeFingerprint) {
      settings.set(EMAIL_ENCRYPTION_KEY_FINGERPRINT_SETTING, guard.fingerprint);
    }
    return storedToAccount(stored);
  });
  resetAuthCircuit(stored.email);
  return result;
}

export function removeAccount(accountId: string, organizationId?: string): void {
  const runtime = getEmailRuntime();
  const normalized = organizationId
    ? runtime.accounts.getAccount?.(organizationId, accountId)
    : runtime.accounts.listAccounts?.().find((account) => account.id === accountId);
  if (normalized?.organizationId) {
    const { deleteAccount, deleteCredentials } = runtime.accounts;
    if (!deleteAccount || !deleteCredentials) throw new Error("Normalized mail account deletion is unavailable");
    runtime.accounts.mutateGlobalSettings(() => {
      deleteCredentials(normalized.organizationId!, accountId);
      deleteAccount(normalized.organizationId!, accountId);
    });
    resetAuthCircuit(normalized.email);
    return;
  }
  const removedEmail = getEmailRuntime().accounts.mutateGlobalSettings((settings, projectId) => {
    const raw = settings.get(settingsKey(accountId));
    if (!raw) return undefined;
    const stored = parseStoredAccount(raw);
    assertSafeMetadataMutation(settings, projectId, stored, settings.get(oauthKey(accountId)));
    settings.delete(settingsKey(accountId));
    settings.delete(oauthKey(accountId));
    return stored.email;
  });
  if (removedEmail) {
    resetAuthCircuit(removedEmail);
  }
}

/** Replace encrypted manual credentials atomically without touching account metadata. */
export function storeCredentials(
  accountId: string,
  credentials: { imapPass?: string; smtpPass?: string; tokens?: OAuthToken },
  organizationId?: string,
): void {
  const runtime = getEmailRuntime();
  const normalized = organizationId
    ? runtime.accounts.getAccount?.(organizationId, accountId)
    : runtime.accounts.listAccounts?.().find((account) => account.id === accountId);
  if (normalized?.organizationId) {
    const setCredential = runtime.accounts.setCredential;
    if (!setCredential) throw new Error("Normalized mail credential persistence is unavailable");
    runtime.accounts.mutateGlobalSettings(() => {
      if (credentials.imapPass !== undefined) setCredential(normalized.organizationId!, accountId, "imap_password", encryptCredentialValue(credentials.imapPass));
      if (credentials.smtpPass !== undefined) setCredential(normalized.organizationId!, accountId, "smtp_password", encryptCredentialValue(credentials.smtpPass));
      if (credentials.tokens) {
        const metadata = JSON.stringify({ expiryDate: credentials.tokens.expiryDate, scope: credentials.tokens.scope });
        setCredential(normalized.organizationId!, accountId, "oauth_access_token", encryptCredentialValue(credentials.tokens.accessToken), metadata);
        setCredential(normalized.organizationId!, accountId, "oauth_refresh_token", encryptCredentialValue(credentials.tokens.refreshToken), metadata);
      }
    });
    resetAuthCircuit(normalized.email);
    return;
  }
  const accountEmail = getEmailRuntime().accounts.mutateGlobalSettings((settings) => {
    const raw = settings.get(settingsKey(accountId));
    if (!raw) throw new Error(`Account ${accountId} not found`);
    const stored = parseStoredAccount(raw);
    const guard = assertWritableEncryption(
      settings,
      hasStoredSecret(stored, settings.get(oauthKey(accountId))),
    );
    if (credentials.imapPass !== undefined) stored.imapPass = encryptCredentialValue(credentials.imapPass);
    if (credentials.smtpPass !== undefined) stored.smtpPass = encryptCredentialValue(credentials.smtpPass);
    if (credentials.tokens) stored.tokens = encryptedTokens(credentials.tokens);
    settings.set(settingsKey(accountId), JSON.stringify(stored));
    if (guard.initializeFingerprint) {
      settings.set(EMAIL_ENCRYPTION_KEY_FINGERPRINT_SETTING, guard.fingerprint);
    }
    return stored.email;
  });
  resetAuthCircuit(accountEmail);
}

/** Store encrypted OAuth tokens atomically after checking the account still exists. */
export function storeOAuthTokens(accountId: string, tokens: OAuthToken, organizationId?: string): void {
  const runtime = getEmailRuntime();
  const normalized = organizationId
    ? runtime.accounts.getAccount?.(organizationId, accountId)
    : runtime.accounts.listAccounts?.().find((account) => account.id === accountId);
  if (normalized?.organizationId) {
    const setCredential = runtime.accounts.setCredential;
    if (!setCredential) throw new Error("Normalized mail credential persistence is unavailable");
    const metadata = JSON.stringify({ expiryDate: tokens.expiryDate, scope: tokens.scope });
    runtime.accounts.mutateGlobalSettings(() => {
      setCredential(normalized.organizationId!, accountId, "oauth_access_token", encryptCredentialValue(tokens.accessToken), metadata);
      setCredential(normalized.organizationId!, accountId, "oauth_refresh_token", encryptCredentialValue(tokens.refreshToken), metadata);
    });
    resetAuthCircuit(normalized.email);
    return;
  }
  const accountEmail = getEmailRuntime().accounts.mutateGlobalSettings((settings) => {
    const raw = settings.get(settingsKey(accountId));
    if (!raw) throw new Error(`Account ${accountId} not found`);
    const stored = parseStoredAccount(raw);
    const guard = assertWritableEncryption(
      settings,
      hasStoredSecret(stored, settings.get(oauthKey(accountId))),
    );
    settings.set(oauthKey(accountId), JSON.stringify(encryptedTokens(tokens)));
    if (guard.initializeFingerprint) {
      settings.set(EMAIL_ENCRYPTION_KEY_FINGERPRINT_SETTING, guard.fingerprint);
    }
    return stored.email;
  });
  resetAuthCircuit(accountEmail);
}

/** Retrieve credentials only when the persisted key-continuity guard is ready. */
export function getCredentials(
  accountId: string,
  organizationId?: string,
): { password?: string; tokens?: OAuthToken } | undefined {
  const runtime = getEmailRuntime();
  const normalizedAccount = organizationId
    ? runtime.accounts.getAccount?.(organizationId, accountId)
    : runtime.accounts.listAccounts?.().find((account) => account.id === accountId);
  if (normalizedAccount?.organizationId) {
    const getCredential = runtime.accounts.getCredential;
    if (!getCredential) return undefined;
    const password = getCredential(normalizedAccount.organizationId, accountId, "imap_password");
    const access = getCredential(normalizedAccount.organizationId, accountId, "oauth_access_token");
    const refresh = getCredential(normalizedAccount.organizationId, accountId, "oauth_refresh_token");
    try {
      const metadata = access ? JSON.parse(access.tokenMetadata) as { expiryDate?: number; scope?: string } : {};
      return {
        password: password ? decryptCredentialValue(password.encryptedValue) : undefined,
        tokens: access && refresh ? {
          accessToken: decryptCredentialValue(access.encryptedValue),
          refreshToken: decryptCredentialValue(refresh.encryptedValue),
          expiryDate: metadata.expiryDate ?? 0,
          scope: metadata.scope ?? "",
        } : undefined,
      };
    } catch {
      return undefined;
    }
  }
  const projectId = runtime.accounts.getGlobalProjectId();
  const raw = runtime.accounts.getGlobalSetting(settingsKey(accountId));
  if (!raw) return undefined;

  let stored: StoredAccount;
  try {
    stored = parseStoredAccount(raw);
  } catch {
    return undefined;
  }
  const oauthRaw = runtime.accounts.getGlobalSetting(oauthKey(accountId));
  if (!hasStoredSecret(stored, oauthRaw) || currentEncryptionStatus({ get: runtime.accounts.getGlobalSetting }, projectId).status !== "ready") {
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

export function setAccountConnected(accountId: string, connected: boolean, organizationId?: string): void {
  const runtime = getEmailRuntime();
  const normalized = organizationId
    ? runtime.accounts.getAccount?.(organizationId, accountId)
    : runtime.accounts.listAccounts?.().find((account) => account.id === accountId);
  if (normalized?.organizationId) {
    const updateAccount = runtime.accounts.updateAccount;
    if (!updateAccount) throw new Error("Normalized mail account persistence is unavailable");
    runtime.accounts.mutateGlobalSettings(() => updateAccount({
      ...normalized,
      connected,
      lastSync: connected ? new Date().toISOString() : normalized.lastSync,
    }));
    if (connected) resetAuthCircuit(normalized.email);
    return;
  }
  const accountEmail = getEmailRuntime().accounts.mutateGlobalSettings((settings, projectId) => {
    const raw = settings.get(settingsKey(accountId));
    if (!raw) throw new Error(`Account ${accountId} not found`);
    const stored = parseStoredAccount(raw);
    assertSafeMetadataMutation(settings, projectId, stored, settings.get(oauthKey(accountId)));
    stored.connected = connected;
    stored.lastSync = connected ? new Date().toISOString() : stored.lastSync;
    settings.set(settingsKey(accountId), JSON.stringify(stored));
    return stored.email;
  });
  if (connected) resetAuthCircuit(accountEmail);
}

/** Update non-secret metadata while preserving encrypted fields byte-for-byte. */
export function storeAccount(account: EmailAccount): void {
  if (account.organizationId) {
    const updateAccount = getEmailRuntime().accounts.updateAccount;
    if (!updateAccount) throw new Error("Normalized mail account persistence is unavailable");
    normalizeEmailAccountEndpoints(account.provider, account);
    getEmailRuntime().accounts.mutateGlobalSettings(() => updateAccount(account));
    return;
  }
  getEmailRuntime().accounts.mutateGlobalSettings((settings, projectId) => {
    const raw = settings.get(settingsKey(account.id));
    if (!raw) throw new Error(`Account ${account.id} not found`);
    const stored = parseStoredAccount(raw);
    if (!isEmailProvider(stored.provider)) {
      throw new Error("Stored email account provider is unsupported");
    }
    const providerChanged = stored.provider !== account.provider;
    const endpoints = providerChanged && isEmailProvider(account.provider) && isFixedProvider(account.provider)
      ? normalizeEmailAccountEndpoints(account.provider, {})
      : normalizeEmailAccountEndpoints(
        account.provider,
        account,
        providerChanged && account.provider === "custom",
      );
    assertSafeMetadataMutation(settings, projectId, stored, settings.get(oauthKey(account.id)));
    stored.email = account.email;
    stored.name = account.name;
    stored.provider = account.provider;
    stored.authType = account.authType;
    stored.imapHost = endpoints.imapHost;
    stored.imapPort = endpoints.imapPort;
    stored.smtpHost = endpoints.smtpHost;
    stored.smtpPort = endpoints.smtpPort;
    stored.hidden = account.hidden;
    stored.connected = account.connected;
    stored.lastSync = account.lastSync;
    settings.set(settingsKey(account.id), JSON.stringify(stored));
  });
}

/**
 * Bootstrap the fingerprint for pre-guard encrypted records only after every
 * encrypted field decrypts with the currently configured key. Failed or legacy
 * plaintext records remain untouched and mail degrades safely.
 */
export function establishEmailEncryptionKeyContinuity(): EmailEncryptionDiagnostics {
  const runtime = getEmailRuntime();
  const diagnostics = runtime.accounts.mutateGlobalSettings((settings, projectId) => {
    const status = currentEncryptionStatus(settings, projectId);
    if (status.status !== "uninitialized") return status;

    const rows = runtime.accounts.listActiveSettings([SETTINGS_PREFIX, OAUTH_SETTINGS_PREFIX]);
    const accounts = new Map<string, MailSettingRow>();
    const oauth = new Map<string, MailSettingRow>();
    try {
      for (const row of rows) {
        if (row.key.startsWith(SETTINGS_PREFIX)) {
          accounts.set(`${row.projectId}\u0000${row.key.slice(SETTINGS_PREFIX.length)}`, row);
        } else {
          oauth.set(`${row.projectId}\u0000${row.key.slice(OAUTH_SETTINGS_PREFIX.length)}`, row);
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

    settings.set(EMAIL_ENCRYPTION_KEY_FINGERPRINT_SETTING, getEmailEncryptionKeyFingerprint());
    return { status: "ready" as const, globalProjectId: projectId };
  });
  return diagnostics;
}

interface MailSettingRow {
  projectId: string;
  key: string;
  value: string;
}

/** Account CRUD using ingenium-core settings for encrypted credential storage.
 *  🔴 All accounts are always global — the `projectId` parameter is accepted
 *     for backward compatibility but ignored. Accounts live in the global project. */

import { randomUUID } from "node:crypto";
import { settings, getDb } from "ingenium-core";
import type { EmailAccount, OAuthToken, EmailFolder } from "./types.js";
import { connectAccount, listFolders } from "./imap.js";
import { encryptCredentials, decryptCredentials } from "./oauth.js";

const SETTINGS_PREFIX = "email_account_";

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
  // Encrypted fields stored alongside
  imapPass?: string;
  smtpPass?: string;
  tokens?: OAuthToken;
}

// ── Global project resolution ─────────────────────────────────────────────

let _cachedGlobalProjectId: string | null = null;

/** Resolve the global project ID. Cached after first call for performance. */
export function getGlobalProjectId(): string {
  if (_cachedGlobalProjectId) return _cachedGlobalProjectId;
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const row = db.prepare(
    "SELECT id FROM projects WHERE is_global = 1 AND archived_at IS NULL LIMIT 1",
  ).get() as { id: string } | undefined;
  if (!row) throw new Error("No global project found. Create one via /init-project or the Settings page.");
  _cachedGlobalProjectId = row.id;
  return row.id;
}

function settingsKey(accountId: string): string {
  return `${SETTINGS_PREFIX}${accountId}`;
}

// ── Account CRUD ───────────────────────────────────────────────────────────

/** List all email accounts. Always uses the global project regardless of the passed projectId. */
export function listAccounts(_projectId: string): EmailAccount[] {
  const projectId = getGlobalProjectId();
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE project_id = ? AND key LIKE ?",
  ).all(projectId, `${SETTINGS_PREFIX}%`) as Array<{ key: string; value: string }>;

  return rows.map((row) => {
    const stored = JSON.parse(row.value) as StoredAccount;
    return storedToAccount(stored);
  });
}

/** Get a single email account by ID. Always uses the global project. */
export function getAccount(_projectId: string, accountId: string): EmailAccount | undefined {
  const projectId = getGlobalProjectId();
  const raw = settings.getSetting(projectId, settingsKey(accountId));
  if (!raw) return undefined;
  const stored = JSON.parse(raw) as StoredAccount;
  return storedToAccount(stored);
}

/** Add a new email account with encrypted credentials. Always uses the global project. */
export function addAccount(
  _projectId: string,
  account: Omit<EmailAccount, "id" | "connected">,
): EmailAccount {
  const projectId = getGlobalProjectId();
  const id = randomUUID();
  const stored: StoredAccount = {
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
  };
  settings.setSetting(projectId, settingsKey(id), JSON.stringify(stored));
  return storedToAccount(stored);
}

/** Remove an email account by ID. Always uses the global project. */
export function removeAccount(_projectId: string, accountId: string): void {
  const projectId = getGlobalProjectId();
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  db.prepare("DELETE FROM settings WHERE project_id = ? AND key = ?")
    .run(projectId, settingsKey(accountId));
}

/** Store encrypted credentials for an account. Always uses the global project. */
export function storeCredentials(
  _projectId: string,
  accountId: string,
  creds: { imapPass?: string; smtpPass?: string; tokens?: OAuthToken },
): void {
  const projectId = getGlobalProjectId();
  const raw = settings.getSetting(projectId, settingsKey(accountId));
  if (!raw) throw new Error(`Account ${accountId} not found`);

  const stored = JSON.parse(raw) as StoredAccount;
  const encKey = process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;

  if (!encKey) {
    throw new Error("INGENIUM_EMAIL_ENCRYPTION_KEY is required to store credentials securely");
  }
  if (creds.imapPass) stored.imapPass = encryptCredentials(creds.imapPass);
  if (creds.smtpPass) stored.smtpPass = encryptCredentials(creds.smtpPass);
  if (creds.tokens) {
    stored.tokens = creds.tokens; // tokens are encrypted when stored via oauth module
  }

  settings.setSetting(projectId, settingsKey(accountId), JSON.stringify(stored));
}

/** Get decrypted credentials for an account. Always uses the global project. */
export function getCredentials(
  _projectId: string,
  accountId: string,
): { password?: string; tokens?: OAuthToken } | undefined {
  const projectId = getGlobalProjectId();
  const raw = settings.getSetting(projectId, settingsKey(accountId));

  let password: string | undefined;
  let tokens: OAuthToken | undefined;
  const encKey = process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;

  // Read from the account settings key
  if (raw) {
    const stored = JSON.parse(raw) as StoredAccount;
    if (stored.imapPass) {
      password = encKey ? decryptCredentials(stored.imapPass) : stored.imapPass;
    }
    if (stored.tokens) {
      tokens = decodeTokens(stored.tokens, encKey);
    }
  }

  // Fallback: also check the OAuth token key (email_oauth_<id>)
  if (!tokens) {
    const oauthRaw = settings.getSetting(projectId, `email_oauth_${accountId}`);
    if (oauthRaw) {
      try {
        const oauthStored = JSON.parse(oauthRaw) as OAuthToken;
        tokens = decodeTokens(oauthStored, encKey);
      } catch { /* ignore parse errors */ }
    }
  }

  return { password, tokens };
}

function decodeTokens(stored: OAuthToken, encKey?: string): OAuthToken {
  if (encKey) {
    try {
      return {
        accessToken: decryptCredentials(stored.accessToken),
        refreshToken: decryptCredentials(stored.refreshToken),
        expiryDate: stored.expiryDate,
        scope: stored.scope,
      };
    } catch {
      // Decryption failed — tokens were stored unencrypted (old/different key)
    }
  }
  return stored;
}

/** Test the IMAP connection for an account and return folder listing. */
export async function testConnection(
  account: EmailAccount,
  auth: { password?: string; tokens?: OAuthToken },
): Promise<{ success: boolean; folders?: EmailFolder[]; error?: string }> {
  try {
    await connectAccount(account, auth);
    const folders = await listFolders(account.id);
    return { success: true, folders };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/** Update the connected flag on an account. Always uses the global project. */
export function setAccountConnected(
  _projectId: string,
  accountId: string,
  connected: boolean,
): void {
  const projectId = getGlobalProjectId();
  const raw = settings.getSetting(projectId, settingsKey(accountId));
  if (!raw) throw new Error(`Account ${accountId} not found`);

  const stored = JSON.parse(raw) as StoredAccount;
  stored.connected = connected;
  stored.lastSync = connected ? new Date().toISOString() : stored.lastSync;
  settings.setSetting(projectId, settingsKey(accountId), JSON.stringify(stored));
}

/** Convert a stored account to the public EmailAccount type. */
function storedToAccount(s: StoredAccount): EmailAccount {
  return {
    id: s.id,
    email: s.email,
    name: s.name,
    provider: s.provider as EmailAccount["provider"],
    authType: s.authType as EmailAccount["authType"],
    imapHost: s.imapHost,
    imapPort: s.imapPort,
    smtpHost: s.smtpHost,
    smtpPort: s.smtpPort,
    connected: s.connected,
    lastSync: s.lastSync,
  };
}

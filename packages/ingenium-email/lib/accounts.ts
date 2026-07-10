/** Account CRUD using ingenium-core settings for encrypted credential storage. */

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

function settingsKey(accountId: string): string {
  return `${SETTINGS_PREFIX}${accountId}`;
}

/** List all email accounts for a project. */
export function listAccounts(projectId: string): EmailAccount[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE project_id = ? AND key LIKE ?"
  ).all(projectId, `${SETTINGS_PREFIX}%`) as Array<{ key: string; value: string }>;

  return rows.map((row) => {
    const stored = JSON.parse(row.value) as StoredAccount;
    return storedToAccount(stored);
  });
}

/** Get a single email account by ID. */
export function getAccount(projectId: string, accountId: string): EmailAccount | undefined {
  const raw = settings.getSetting(projectId, settingsKey(accountId));
  if (!raw) return undefined;
  const stored = JSON.parse(raw) as StoredAccount;
  return storedToAccount(stored);
}

/** Add a new email account with encrypted credentials. */
export function addAccount(projectId: string, account: Omit<EmailAccount, "id" | "connected">): EmailAccount {
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

/** Remove an email account by ID. */
export function removeAccount(projectId: string, accountId: string): void {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  db.prepare("DELETE FROM settings WHERE project_id = ? AND key = ?")
    .run(projectId, settingsKey(accountId));
}

/** Store encrypted credentials for an account. */
export function storeCredentials(
  projectId: string,
  accountId: string,
  creds: { imapPass?: string; smtpPass?: string; tokens?: OAuthToken },
): void {
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

/** Get decrypted credentials for an account. */
export function getCredentials(
  projectId: string,
  accountId: string,
): { password?: string; tokens?: OAuthToken } | undefined {
  const raw = settings.getSetting(projectId, settingsKey(accountId));
  if (!raw) return undefined;

  const stored = JSON.parse(raw) as StoredAccount;
  const encKey = process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;

  let password: string | undefined;
  let tokens: OAuthToken | undefined;

  if (stored.imapPass) {
    password = encKey ? decryptCredentials(stored.imapPass) : stored.imapPass;
  }
  if (stored.tokens) {
    if (encKey) {
      tokens = {
        accessToken: decryptCredentials(stored.tokens.accessToken),
        refreshToken: decryptCredentials(stored.tokens.refreshToken),
        expiryDate: stored.tokens.expiryDate,
        scope: stored.tokens.scope,
      };
    } else {
      tokens = stored.tokens;
    }
  }

  return { password, tokens };
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

/** Update the connected flag on an account. */
export function setAccountConnected(
  projectId: string,
  accountId: string,
  connected: boolean,
): void {
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

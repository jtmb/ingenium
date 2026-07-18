/**
 * Account CRUD using ingenium-core settings for encrypted credential storage.
 *
 * 🔴 All accounts are always global — the `projectId` parameter is accepted
 *    for backward compatibility but ignored. Accounts live in the global project
 *    because email accounts are shared infrastructure, not per-project data.
 *
 * SECURITY: Credentials (IMAP password, OAuth tokens) are encrypted at rest
 * via AES-256-GCM when `INGENIUM_EMAIL_ENCRYPTION_KEY` is set.
 */

import { randomUUID } from "node:crypto";
import { settings, getDb } from "ingenium-core";
import type { EmailAccount, OAuthToken, EmailFolder } from "./types.js";
import { connectAccount, listFolders } from "./imap.js";
import { encryptCredentials, decryptCredentials } from "./oauth.js";
import { resetAuthCircuit } from "./circuit-breaker.js";

const SETTINGS_PREFIX = "email_account_";

/**
 * Internal stored shape in the settings table.
 * This is JSON-serialized and written to `settings` rows — NOT a DB table itself.
 * Credential fields (imapPass, smtpPass, tokens) are encrypted when stored.
 */
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
  /** If true, account is hidden from the sidebar dropdown but sync still runs. */
  hidden?: boolean;
  // Encrypted fields stored alongside
  imapPass?: string;
  smtpPass?: string;
  tokens?: OAuthToken;
}

// ── Global project resolution ─────────────────────────────────────────────

/** Cached reference to avoid re-querying the DB on every call. Cleared on process restart. */
let _cachedGlobalProjectId: string | null = null;

/**
 * Resolve the global project ID.
 *
 * Cached after first call — valid for the process lifetime.  If the global project
 * is deleted and re-created during the same process, a restart is needed.
 * This is acceptable because project lifecycle changes are rare (admin operations).
 */
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

/**
 * List all email accounts.
 * Always uses the global project regardless of the passed projectId.
 */
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

/**
 * Get a single email account by ID.
 * Always uses the global project regardless of the passed projectId.
 */
export function getAccount(_projectId: string, accountId: string): EmailAccount | undefined {
  const projectId = getGlobalProjectId();
  const raw = settings.getSetting(projectId, settingsKey(accountId));
  if (!raw) return undefined;
  const stored = JSON.parse(raw) as StoredAccount;
  return storedToAccount(stored);
}

/**
 * Add a new email account with encrypted credentials.
 * Always uses the global project regardless of the passed projectId.
 */
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

/**
 * Remove an email account by ID.
 * Always uses the global project regardless of the passed projectId.
 */
export function removeAccount(_projectId: string, accountId: string): void {
  const projectId = getGlobalProjectId();
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  db.prepare("DELETE FROM settings WHERE project_id = ? AND key = ?")
    .run(projectId, settingsKey(accountId));
}

/**
 * Store encrypted credentials for an account.
 * Always uses the global project regardless of the passed projectId.
 *
 * SECURITY: IMAP/SMTP passwords are encrypted with AES-256-GCM before storage.
 * OAuth tokens are passed through as-is — encryption happens inside oauth.storeTokens().
 * Throws if INGENIUM_EMAIL_ENCRYPTION_KEY is not set.
 */
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
  resetAuthCircuit(stored.email);
}

/**
 * Get decrypted credentials for an account.
 * Always uses the global project regardless of the passed projectId.
 *
 * Two storage paths are checked:
 *   1. The account settings key (email_account_<id>) — holds IMAP password + OAuth tokens
 *   2. Fallback to the legacy OAuth token key (email_oauth_<id>) — for accounts created
 *      before the unified storage format.
 *
 * Returns undefined if neither the account nor any OAuth tokens exist.
 */
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
      try {
        password = encKey ? decryptCredentials(stored.imapPass) : stored.imapPass;
      } catch {
        // A rotated key or corrupted ciphertext is recoverable through the
        // credential-update flow. Do not let ciphertext reach an IMAP client.
        password = undefined;
      }
    }
    if (stored.tokens) {
      try {
        tokens = decodeTokens(stored.tokens, encKey);
      } catch {
        // Credential decryption failed — account needs re-authentication.
        // tokens remains undefined, which signals "no valid credentials."
      }
    }
  }

  // Fallback: also check the legacy OAuth token key (email_oauth_<id>)
  // Handles accounts created before tokens were folded into the account settings row.
  if (!tokens) {
    const oauthRaw = settings.getSetting(projectId, `email_oauth_${accountId}`);
    if (oauthRaw) {
      try {
        const oauthStored = JSON.parse(oauthRaw) as OAuthToken;
        tokens = decodeTokens(oauthStored, encKey);
      } catch {
        // Credential decryption failed for legacy tokens too — tokens stays undefined.
      }
    }
  }

  return { password, tokens };
}

/**
 * Decrypt stored OAuth tokens.
 *
 * When an encryption key is configured, decrypts both access and refresh tokens.
 * If decryption fails (key rotation, ciphertext corruption), throws immediately
 * instead of returning ciphertext as plaintext — preventing garbage tokens
 * from reaching the Gmail API and triggering infinite retry loops.
 */
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
      // Decryption failed — encryption key was rotated or ciphertext corrupted.
      // Do NOT return ciphertext as plaintext (would reach Gmail as garbage token).
      throw new Error("Credential decryption failed — re-authentication required");
    }
  }
  // No encryption key configured — tokens stored in plaintext (legacy).
  return stored;
}

/**
 * Test the IMAP connection for an account and return folder listing.
 * Used by the UI's "Test Connection" flow during account setup.
 * Returns a structured result instead of throwing, so the UI can display
 * specific error messages (wrong password, network timeout, etc.).
 */
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

/**
 * Update the connected flag on an account. Always uses the global project.
 * Also updates `lastSync` timestamp when marking as connected.
 * Used by the sync engine and IMAP watcher to track connection state.
 */
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

/** Convert a stored account (with encrypted fields) to the public EmailAccount type. */
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
    hidden: s.hidden,
  };
}

/**
 * Update a stored account's metadata (non-credential fields).
 * Always uses the global project regardless of the passed projectId.
 * Does NOT touch encrypted credential fields.
 */
export function storeAccount(
  _projectId: string,
  account: EmailAccount,
): void {
  const projectId = getGlobalProjectId();
  const raw = settings.getSetting(projectId, settingsKey(account.id));
  if (!raw) throw new Error(`Account ${account.id} not found`);

  const stored = JSON.parse(raw) as StoredAccount;
  stored.hidden = account.hidden;
  stored.connected = account.connected;
  stored.lastSync = account.lastSync;
  stored.name = account.name;
  // Preserve encrypted credential fields — never rewrite them
  settings.setSetting(projectId, settingsKey(account.id), JSON.stringify(stored));
}

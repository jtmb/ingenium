/** OAuth2 authentication for Gmail (google-auth-library) and Outlook (@azure/msal-node). */

import crypto from "node:crypto";
import type { OAuthToken } from "./types.js";
import type { EmailProvider } from "./types.js";
import { settings, getDb } from "ingenium-core";
import { getGlobalProjectId } from "./accounts.js";

// ── OAuth credential resolution ──────────────────────────────────────────

/** Resolve OAuth client ID/secret: check settings table first, fall back to env vars. */
function getOAuthCreds(
  provider: Extract<EmailProvider, "gmail" | "outlook">,
  projectId?: string,
): { clientId: string; clientSecret: string } {
  if (provider === "gmail") {
    const clientId = projectId
      ? (settings.getSetting(projectId, "oauth_gmail_client_id") || process.env.GOOGLE_OAUTH_CLIENT_ID || "")
      : (process.env.GOOGLE_OAUTH_CLIENT_ID ?? "");
    const clientSecret = projectId
      ? (settings.getSetting(projectId, "oauth_gmail_client_secret") || process.env.GOOGLE_OAUTH_CLIENT_SECRET || "")
      : (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "");
    return { clientId, clientSecret };
  }
  // outlook
  const clientId = projectId
    ? (settings.getSetting(projectId, "oauth_outlook_client_id") || process.env.MS_OAUTH_CLIENT_ID || "")
    : (process.env.MS_OAUTH_CLIENT_ID ?? "");
  const clientSecret = projectId
    ? (settings.getSetting(projectId, "oauth_outlook_client_secret") || process.env.MS_OAUTH_CLIENT_SECRET || "")
    : (process.env.MS_OAUTH_CLIENT_SECRET ?? "");
  return { clientId, clientSecret };
}

// ── Encryption helpers ────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const hex = process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error("INGENIUM_EMAIL_ENCRYPTION_KEY environment variable not set (32-byte hex)");
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error(`INGENIUM_EMAIL_ENCRYPTION_KEY must be 32 bytes (64 hex chars), got ${key.length} bytes`);
  }
  return key;
}

/** Encrypt string data using AES-256-GCM. Returns base64(iv + authTag + ciphertext). */
export function encryptCredentials(data: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(data, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString("base64");
}

/** Decrypt AES-256-GCM encrypted data (base64-encoded). */
export function decryptCredentials(encrypted: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(encrypted, "base64");

  const iv = combined.subarray(0, 16);
  const authTag = combined.subarray(16, 32);
  const ciphertext = combined.subarray(32);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf-8");
}

// ── OAuth token storage ───────────────────────────────────────────────────

const OAUTH_SETTINGS_PREFIX = "email_oauth_";

function oauthKey(accountId: string): string {
  return `${OAUTH_SETTINGS_PREFIX}${accountId}`;
}

/** Store encrypted OAuth tokens in settings. Always uses the global project. */
export function storeTokens(
  _projectId: string,
  accountId: string,
  tokens: OAuthToken,
): void {
  const projectId = getGlobalProjectId();
  const encKey = process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;
  let payload: OAuthToken;
  if (encKey) {
    payload = {
      accessToken: encryptCredentials(tokens.accessToken),
      refreshToken: encryptCredentials(tokens.refreshToken),
      expiryDate: tokens.expiryDate,
      scope: tokens.scope,
    };
  } else {
    payload = tokens;
  }
  settings.setSetting(projectId, oauthKey(accountId), JSON.stringify(payload));
}

/** Retrieve and optionally refresh stored OAuth tokens. Always uses the global project. */
export async function getValidTokens(
  _projectId: string,
  accountId: string,
  provider: EmailProvider,
): Promise<OAuthToken | null> {
  const projectId = getGlobalProjectId();
  const raw = settings.getSetting(projectId, oauthKey(accountId));
  if (!raw) return null;

  const stored = JSON.parse(raw) as OAuthToken;
  const encKey = process.env.INGENIUM_EMAIL_ENCRYPTION_KEY;

  let tokens: OAuthToken;
  if (encKey) {
    tokens = {
      accessToken: decryptCredentials(stored.accessToken),
      refreshToken: decryptCredentials(stored.refreshToken),
      expiryDate: stored.expiryDate,
      scope: stored.scope,
    };
  } else {
    tokens = stored;
  }

  // Check if expired (with 60-second buffer)
  const now = Date.now();
  if (tokens.expiryDate && tokens.expiryDate < now + 60_000) {
    // Auto-refresh
    const refreshed = await refreshAccessToken(provider, tokens.refreshToken, projectId);
    storeTokens(projectId, accountId, refreshed);
    return refreshed;
  }

  return tokens;
}

// ── Google OAuth2 ─────────────────────────────────────────────────────────

function getRedirectUri(): string {
  return process.env.OAUTH_REDIRECT_URI ?? "http://localhost:3000/mail/oauth/callback";
}

let _googleOAuthClient: Awaited<ReturnType<typeof cachedGoogleClient>>["client"] | undefined;

async function cachedGoogleClient(projectId?: string): Promise<{ client: import("google-auth-library").OAuth2Client }> {
  const { clientId, clientSecret } = getOAuthCreds("gmail", projectId);

  // Use cache only for the env-based default path (no projectId override)
  if (!projectId && _googleOAuthClient) {
    return { client: _googleOAuthClient };
  }

  const mod = await import("google-auth-library");
  const client = new mod.OAuth2Client(clientId, clientSecret, getRedirectUri());

  // Cache only the env-default client; project-specific clients are ephemeral
  if (!projectId) {
    _googleOAuthClient = client;
  }

  return { client };
}

// ── Microsoft OAuth2 ──────────────────────────────────────────────────────

let _msalApp: import("@azure/msal-node").ConfidentialClientApplication | undefined;

async function getMsalApp(projectId?: string): Promise<import("@azure/msal-node").ConfidentialClientApplication> {
  const { clientId, clientSecret } = getOAuthCreds("outlook", projectId);

  // Use cache only for the env-based default path (no projectId override)
  if (!projectId && _msalApp) {
    return _msalApp;
  }

  const msal = await import("@azure/msal-node");
  const app = new msal.ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret,
      authority: "https://login.microsoftonline.com/common",
    },
  });

  // Cache only the env-default client; project-specific clients are ephemeral
  if (!projectId) {
    _msalApp = app;
  }

  return app;
}

// ── Public API ────────────────────────────────────────────────────────────

/** Generate an OAuth authorization URL for the given provider. Always uses the global project. */
export async function getOAuthUrl(
  provider: EmailProvider,
  _projectId?: string,
): Promise<{ url: string; state: string }> {
  const state = crypto.randomBytes(16).toString("hex");
  const pid = getGlobalProjectId();

  // Store state for CSRF validation on callback
  settings.setSetting(pid, `oauth_state_${provider}`, state);

  if (provider === "gmail") {
    const { client: gClient } = await cachedGoogleClient(pid);
    const url = gClient.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: "https://mail.google.com/ openid email profile",
      state,
      redirect_uri: getRedirectUri(),
    });
    return { url, state };
  }

  if (provider === "outlook") {
    const msalApp = await getMsalApp(_projectId);
    const url = await msalApp.getAuthCodeUrl({
      scopes: [
        "https://outlook.office.com/IMAP.AccessAsUser.All",
        "https://outlook.office.com/SMTP.Send",
        "offline_access",
      ],
      redirectUri: getRedirectUri(),
      state,
    });
    return { url, state };
  }

  // yahoo / custom — placeholder URL
  return { url: "", state };
}

/** Exchange an authorization code for OAuth tokens. Always uses the global project. */
export async function exchangeCode(
  provider: EmailProvider,
  code: string,
  state: string,
  _redirectUri?: string,
  _projectId?: string,
): Promise<OAuthToken> {
  const pid = getGlobalProjectId();
  const storedState = settings.getSetting(pid, `oauth_state_${provider}`);
  if (!storedState || storedState !== state) {
    throw new Error(`OAuth state mismatch for provider ${provider}. Possible CSRF attack.`);
  }
  // Delete stored state after validation
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  db.prepare("DELETE FROM settings WHERE project_id = ? AND key = ?")
    .run(pid, `oauth_state_${provider}`);

  const redirectUri = _redirectUri ?? getRedirectUri();

  if (provider === "gmail") {
    const { client: gClient } = await cachedGoogleClient(pid);
    const { tokens } = await gClient.getToken({ code, redirect_uri: redirectUri });
    // Extract email from id_token JWT
    let email: string | undefined;
    if (tokens.id_token) {
      try {
        const parts = tokens.id_token.split(".");
        if (parts.length >= 2 && parts[1]) {
          const payload = JSON.parse(Buffer.from(parts[1]!, "base64").toString("utf8"));
          email = payload.email;
        }
      } catch { /* non-fatal */ }
    }
    return {
      accessToken: tokens.access_token ?? "",
      refreshToken: tokens.refresh_token ?? "",
      expiryDate: tokens.expiry_date ?? Date.now() + 3600_000,
      scope: tokens.scope ?? "https://mail.google.com/",
      email,
    };
  }

  if (provider === "outlook") {
    const msalApp = await getMsalApp(_projectId);
    const result = await msalApp.acquireTokenByCode({
      code,
      scopes: [
        "https://outlook.office.com/IMAP.AccessAsUser.All",
        "https://outlook.office.com/SMTP.Send",
        "offline_access",
      ],
      redirectUri,
    });
    return {
      accessToken: result?.accessToken ?? "",
      refreshToken: "", // MSAL handles refresh internally
      expiryDate: result?.expiresOn?.getTime() ?? Date.now() + 3600_000,
      scope: "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access",
      email: result?.account?.username ?? undefined,
    };
  }

  throw new Error(`OAuth exchange not supported for provider: ${provider}`);
}

/** Refresh an expired access token using the refresh token. */
export async function refreshAccessToken(
  provider: EmailProvider,
  refreshToken: string,
  projectId?: string,
): Promise<OAuthToken> {
  if (provider === "gmail") {
    const { client: gClient } = await cachedGoogleClient(projectId);
    gClient.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await gClient.refreshAccessToken();
    return {
      accessToken: credentials.access_token ?? "",
      refreshToken: credentials.refresh_token ?? refreshToken,
      expiryDate: credentials.expiry_date ?? Date.now() + 3600_000,
      scope: credentials.scope ?? "https://mail.google.com/",
    };
  }

  if (provider === "outlook") {
    const msalApp = await getMsalApp(projectId);
    const result = await msalApp.acquireTokenByRefreshToken({
      refreshToken,
      scopes: [
        "https://outlook.office.com/IMAP.AccessAsUser.All",
        "https://outlook.office.com/SMTP.Send",
        "offline_access",
      ],
    });
    return {
      accessToken: result?.accessToken ?? "",
      refreshToken: refreshToken,
      expiryDate: result?.expiresOn?.getTime() ?? Date.now() + 3600_000,
      scope: "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access",
    };
  }

  throw new Error(`Token refresh not supported for provider: ${provider}`);
}

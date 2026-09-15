/** OAuth2 authentication for Gmail (google-auth-library) and Outlook (@azure/msal-node). */

import crypto from "node:crypto";
import type { OAuthToken } from "./types.js";
import type { EmailOwner, EmailProvider } from "./types.js";
import { getCredentials, getGlobalProjectId, storeOAuthTokens } from "./accounts.js";
import { decryptCredentialValue, encryptCredentialValue } from "./credential-crypto.js";
import { ProviderOperationError, sanitizeProviderError } from "./provider-errors.js";
import { getEmailRuntime } from "./runtime.js";

// ── OAuth credential resolution ──────────────────────────────────────────

/**
 * Resolve OAuth client IDs from settings and secrets from protected runtime storage,
 * then fall back to environment variables.
 *
 * Dashboard-managed values take precedence while production deployments can
 * still supply container-level environment fallbacks.
 */
function getOAuthCreds(
  provider: Extract<EmailProvider, "gmail" | "outlook">,
  projectId: string,
): { clientId: string; clientSecret: string } {
  const runtime = getEmailRuntime();
  const settings = runtime.settings;
  if (provider === "gmail") {
    const clientId = settings.getSetting(projectId, "oauth_gmail_client_id") || process.env.GOOGLE_OAUTH_CLIENT_ID || "";
    const clientSecret = runtime.oauthClientSecrets.getClientSecret(projectId, "oauth_gmail_client_secret") || process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
    return { clientId, clientSecret };
  }
  // outlook
  const clientId = settings.getSetting(projectId, "oauth_outlook_client_id") || process.env.MS_OAUTH_CLIENT_ID || "";
  const clientSecret = runtime.oauthClientSecrets.getClientSecret(projectId, "oauth_outlook_client_secret") || process.env.MS_OAUTH_CLIENT_SECRET || "";
  return { clientId, clientSecret };
}

// ── Encryption helpers ────────────────────────────────────────────────────

/** Backward-compatible public encryption helpers. */
export const encryptCredentials = encryptCredentialValue;
export const decryptCredentials = decryptCredentialValue;

// ── OAuth token storage ───────────────────────────────────────────────────

/**
 * Store encrypted OAuth tokens in settings. Always uses the global project.
 *
 * SECURITY: Tokens are encrypted at rest with AES-256-GCM when
 * INGENIUM_EMAIL_ENCRYPTION_KEY is set.  Without it, tokens are stored in
 * plaintext (warns at startup).  Never logs token values.
 */
export function storeTokens(
  accountId: string,
  tokens: OAuthToken,
  organizationId?: string,
): void {
  storeOAuthTokens(accountId, tokens, organizationId);
}

/**
 * Retrieve and optionally refresh stored OAuth tokens. Always uses the global project.
 *
 * Auto-refresh is triggered when the token is within 60 seconds of expiry.
 * This buffer prevents TOCTOU races where a token passes validation but expires
 * before reaching the Gmail API.
 *
 * Returns null if no stored tokens exist (account needs re-authentication).
 */
export async function getValidTokens(
  accountId: string,
  provider: EmailProvider,
  organizationId?: string,
): Promise<OAuthToken | null> {
  const tokens = getCredentials(accountId, organizationId)?.tokens;
  if (!tokens) return null;

  // Check if expired (with 60-second buffer to avoid TOCTOU expiry races)
  const now = Date.now();
  if (tokens.expiryDate && tokens.expiryDate < now + 60_000) {
    // Auto-refresh
    const refreshed = await refreshAccessToken(provider, tokens.refreshToken);
    storeTokens(accountId, refreshed, organizationId);
    return refreshed;
  }

  return tokens;
}

// ── Google OAuth2 ─────────────────────────────────────────────────────────

function getRedirectUri(): string {
  return process.env.OAUTH_REDIRECT_URI ?? "http://localhost:3000/mail/oauth/callback";
}

async function getGoogleClient(projectId: string): Promise<import("google-auth-library").OAuth2Client> {
  const { clientId, clientSecret } = getOAuthCreds("gmail", projectId);
  const mod = await import("google-auth-library");
  return new mod.OAuth2Client(clientId, clientSecret, getRedirectUri());
}

// ── Microsoft OAuth2 ──────────────────────────────────────────────────────

async function getMsalApp(projectId: string): Promise<import("@azure/msal-node").ConfidentialClientApplication> {
  const { clientId, clientSecret } = getOAuthCreds("outlook", projectId);
  const msal = await import("@azure/msal-node");
  return new msal.ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret,
      authority: "https://login.microsoftonline.com/common",
    },
  });
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Generate an OAuth authorization URL for the given provider. Always uses the global project.
 *
 * Generates a CSRF state token, stores it in the DB, and builds the provider-specific
 * authorization URL.  Google uses `prompt: "consent"` and `access_type: "offline"` to
 * guarantee a refresh token on every auth (not just the first).
 *
 * For Yahoo/custom, returns an empty URL — these providers use app-password auth instead.
 */
export async function getOAuthUrl(
  provider: EmailProvider,
  owner?: Required<Pick<EmailOwner, "organizationId" | "ownerKind">> & Pick<EmailOwner, "ownerUserId"> & {
    accountId: string;
    actorType: "compatibility" | "user" | "service" | "system";
    actorId?: string;
  },
): Promise<{ url: string; state: string }> {
  try {
    const state = crypto.randomBytes(16).toString("hex");
    const pid = getGlobalProjectId();

    if (owner && (provider === "gmail" || provider === "outlook")) {
      const createAttempt = getEmailRuntime().accounts.createOAuthAttempt;
      if (!createAttempt) throw new ProviderOperationError("OAUTH_STATE_INVALID", "oauth", false);
      const stateHash = crypto.createHash("sha256").update(state).digest("hex");
      getEmailRuntime().accounts.mutateGlobalSettings(() => createAttempt(stateHash, {
        ...owner,
        provider,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }));
    } else {
      getEmailRuntime().accounts.mutateGlobalSettings((settings) => {
        settings.set(`oauth_state_${provider}`, state);
      });
    }

    if (provider === "gmail") {
      const gClient = await getGoogleClient(pid);
      const url = gClient.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        // Full Gmail scope for IMAP/SMTP API access; openid+email+profile for user info
        scope: "https://mail.google.com/ openid email profile",
        state,
        redirect_uri: getRedirectUri(),
      });
      return { url, state };
    }

    if (provider === "outlook") {
      const msalApp = await getMsalApp(pid);
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

    // yahoo / custom — placeholder URL (these providers use app-password auth)
    return { url: "", state };
  } catch (error: unknown) {
    throw sanitizeProviderError(error, "oauth");
  }
}

/**
 * Exchange an authorization code for OAuth tokens. Always uses the global project.
 *
 * SECURITY: Validates the CSRF state token before exchanging the code, then
 * immediately deletes the stored state to prevent replay attacks.
 *
 * For Google, extracts the user's email from the id_token JWT (unverified
 * header+payload decode — standard practice for getting the email claim).
 * For Outlook, MSAL returns the email from the account object.
 */
export async function exchangeCode(
  provider: EmailProvider,
  code: string,
  state: string,
  redirectUri?: string,
  organizationId?: string,
  actor?: { type: "compatibility" | "user" | "service" | "system"; id?: string },
): Promise<OAuthToken> {
  try {
    const pid = getGlobalProjectId();
    if (organizationId && (provider === "gmail" || provider === "outlook")) {
      const consumeAttempt = getEmailRuntime().accounts.consumeOAuthAttempt;
      const stateHash = crypto.createHash("sha256").update(state).digest("hex");
      const attempt = consumeAttempt && getEmailRuntime().accounts.mutateGlobalSettings(() =>
        consumeAttempt(stateHash, organizationId, provider, actor?.type ?? "system", actor?.id, new Date().toISOString()));
      if (!attempt) throw new ProviderOperationError("OAUTH_STATE_INVALID", "oauth", false);
    } else {
      getEmailRuntime().accounts.mutateGlobalSettings((settings) => {
        const storedState = settings.get(`oauth_state_${provider}`);
        if (!storedState || storedState !== state) {
          throw new ProviderOperationError("OAUTH_STATE_INVALID", "oauth", false);
        }
        settings.delete(`oauth_state_${provider}`);
      });
    }

    const resolvedRedirectUri = redirectUri ?? getRedirectUri();

    if (provider === "gmail") {
      const gClient = await getGoogleClient(pid);
      const { tokens } = await gClient.getToken({ code, redirect_uri: resolvedRedirectUri });
      // Extract email from id_token JWT (unverified decode — standard for getting email claim)
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
        // Fallback expiry: 1 hour from now (typical Google expiry)
        expiryDate: tokens.expiry_date ?? Date.now() + 3600_000,
        scope: tokens.scope ?? "https://mail.google.com/",
        email,
      };
    }

    if (provider === "outlook") {
      const msalApp = await getMsalApp(pid);
      const result = await msalApp.acquireTokenByCode({
        code,
        scopes: [
          "https://outlook.office.com/IMAP.AccessAsUser.All",
          "https://outlook.office.com/SMTP.Send",
          "offline_access",
        ],
        redirectUri: resolvedRedirectUri,
      });
      return {
        accessToken: result?.accessToken ?? "",
        refreshToken: "", // MSAL handles refresh internally — no refresh token to store
        expiryDate: result?.expiresOn?.getTime() ?? Date.now() + 3600_000,
        scope: "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access",
        email: result?.account?.username ?? undefined,
      };
    }

    throw new ProviderOperationError("OAUTH_UNSUPPORTED", "oauth", false);
  } catch (error: unknown) {
    throw sanitizeProviderError(error, "oauth");
  }
}

/**
 * Convenience helper: get a guaranteed-fresh Gmail access token for the given
 * account ID. Uses getValidTokens which auto-refreshes if within 60s of expiry.
 *
 * Throws if no stored tokens exist (account needs re-authentication).
 */
export async function getFreshGmailToken(accountId: string, organizationId?: string): Promise<string> {
  const tokens = await getValidTokens(accountId, "gmail", organizationId);
  if (!tokens) {
    throw new ProviderOperationError("AUTH_REQUIRED", "oauth", false);
  }
  return tokens.accessToken;
}

/** Refresh an expired access token using the refresh token. */
export async function refreshAccessToken(
  provider: EmailProvider,
  refreshToken: string,
): Promise<OAuthToken> {
  try {
    const projectId = getGlobalProjectId();

    if (provider === "gmail") {
      const gClient = await getGoogleClient(projectId);
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

    throw new ProviderOperationError("OAUTH_UNSUPPORTED", "oauth", false);
  } catch (error: unknown) {
    throw sanitizeProviderError(error, "oauth");
  }
}

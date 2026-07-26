/** OAuth2 authentication for Gmail (google-auth-library) and Outlook (@azure/msal-node). */
import type { OAuthToken } from "./types.js";
import type { EmailProvider } from "./types.js";
import { decryptCredentialValue, encryptCredentialValue } from "./credential-crypto.js";
/** Backward-compatible public encryption helpers. */
export declare const encryptCredentials: typeof encryptCredentialValue;
export declare const decryptCredentials: typeof decryptCredentialValue;
/**
 * Store encrypted OAuth tokens in settings. Always uses the global project.
 *
 * SECURITY: Tokens are encrypted at rest with AES-256-GCM when
 * INGENIUM_EMAIL_ENCRYPTION_KEY is set.  Without it, tokens are stored in
 * plaintext (warns at startup).  Never logs token values.
 */
export declare function storeTokens(_projectId: string, accountId: string, tokens: OAuthToken): void;
/**
 * Retrieve and optionally refresh stored OAuth tokens. Always uses the global project.
 *
 * Auto-refresh is triggered when the token is within 60 seconds of expiry.
 * This buffer prevents TOCTOU races where a token passes validation but expires
 * before reaching the Gmail API.
 *
 * Returns null if no stored tokens exist (account needs re-authentication).
 */
export declare function getValidTokens(_projectId: string, accountId: string, provider: EmailProvider): Promise<OAuthToken | null>;
/**
 * Generate an OAuth authorization URL for the given provider. Always uses the global project.
 *
 * Generates a CSRF state token, stores it in the DB, and builds the provider-specific
 * authorization URL.  Google uses `prompt: "consent"` and `access_type: "offline"` to
 * guarantee a refresh token on every auth (not just the first).
 *
 * For Yahoo/custom, returns an empty URL — these providers use app-password auth instead.
 */
export declare function getOAuthUrl(provider: EmailProvider, _projectId?: string): Promise<{
    url: string;
    state: string;
}>;
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
export declare function exchangeCode(provider: EmailProvider, code: string, state: string, _redirectUri?: string, _projectId?: string): Promise<OAuthToken>;
/**
 * Convenience helper: get a guaranteed-fresh Gmail access token for the given
 * account ID. Uses getValidTokens which auto-refreshes if within 60s of expiry.
 *
 * Throws if no stored tokens exist (account needs re-authentication).
 */
export declare function getFreshGmailToken(accountId: string): Promise<string>;
/** Refresh an expired access token using the refresh token. */
export declare function refreshAccessToken(provider: EmailProvider, refreshToken: string, _projectId?: string): Promise<OAuthToken>;
//# sourceMappingURL=oauth.d.ts.map
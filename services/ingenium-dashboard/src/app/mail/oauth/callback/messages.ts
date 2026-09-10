/**
 * Safe, stable messages for OAuth callback failures.
 *
 * Provider-supplied descriptions are intentionally not displayed. They can
 * contain secrets, URLs, HTML, or diagnostic canaries that do not belong in a
 * browser-facing error surface.
 */
export const OAUTH_CALLBACK_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  access_denied: "Authorization was declined. No email account was connected.",
  consent_required: "Authorization requires consent. Start the connection again.",
  invalid_grant: "The authorization expired or was already used. Start the connection again.",
  invalid_request: "The provider rejected the authorization request. Try again.",
  invalid_scope: "The requested email permissions were not accepted. Try again.",
  login_required: "The provider requires you to sign in before connecting your email.",
  redirect_uri_mismatch: "The OAuth redirect is not configured correctly. Contact an administrator.",
  server_error: "The provider could not complete authorization. Try again later.",
  temporarily_unavailable: "The provider is temporarily unavailable. Try again later.",
  unauthorized_client: "This OAuth client is not authorized. Contact an administrator.",
  unsupported_response_type: "The provider does not support this authorization flow.",
  OAUTH_CONFIG_MISSING: "OAuth is not configured for this provider. Contact an administrator.",
  OAUTH_STATE_INVALID: "The authorization session expired or was invalid. Start the connection again.",
  OAUTH_UNSUPPORTED: "This OAuth provider is not supported.",
});

export const DEFAULT_OAUTH_CALLBACK_ERROR_MESSAGE =
  "OAuth setup could not be completed. Try again.";

/** Resolve only known application/provider codes to constant safe copy. */
export function getOAuthCallbackErrorMessage(code: unknown): string {
  if (typeof code !== "string") return DEFAULT_OAUTH_CALLBACK_ERROR_MESSAGE;
  return OAUTH_CALLBACK_ERROR_MESSAGES[code] ?? DEFAULT_OAUTH_CALLBACK_ERROR_MESSAGE;
}

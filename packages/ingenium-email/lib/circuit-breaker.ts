/**
 * Auth error circuit breaker — shared state for sync-engine and oauth modules.
 *
 * Tracks consecutive auth errors per folder to implement circuit breaking.
 * When a folder hits MAX_AUTH_ERRORS consecutive auth failures, the worker
 * parks that folder to avoid hammering the server with bad credentials.
 *
 * The circuit is reset when new tokens are successfully stored (oauth.storeTokens),
 * allowing the worker to resume after re-authentication.
 */

/** Track consecutive auth errors per folder (key: `${email}:${folder}`). */
export const authErrorCount = new Map<string, number>();
export const MAX_AUTH_ERRORS = 3;

/**
 * Reset the auth error circuit breaker for a given account.
 *
 * Clears all auth error counts whose key starts with the account's email.
 * Called by oauth.storeTokens() after successfully storing new credentials,
 * so the sync engine can resume syncing without a restart.
 *
 * SECURITY: email is only used as a Map key prefix — never logged or returned.
 */
export function resetAuthCircuit(email: string): void {
  const prefix = `${email}:`;
  for (const key of authErrorCount.keys()) {
    if (key.startsWith(prefix)) {
      authErrorCount.delete(key);
    }
  }
}

/**
 * Start the standalone dashboard with only the protected token-file path in its
 * environment. The dashboard proxy opens and validates that file when an API
 * request arrives; this launcher must never convert its contents into an
 * inline environment variable.
 */
await import("/app/services/ingenium-dashboard/server.js");

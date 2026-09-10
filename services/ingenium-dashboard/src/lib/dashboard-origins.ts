/**
 * Exact browser origins allowed to mutate the dashboard API proxy.
 *
 * This list is deliberately server-only: it is used to validate the external
 * origin reconstructed from Nginx's overwritten forwarding metadata. It is
 * not a browser-facing configuration value and never contains credentials.
 */
export const DEFAULT_DASHBOARD_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
] as const;

export const DASHBOARD_ALLOWED_ORIGINS_ENV = "DASHBOARD_ALLOWED_ORIGINS";

type OriginEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Return an exact, credential-free HTTP(S) origin or null. Configuration is
 * intentionally stricter than URL normalization: a trailing slash, path, or
 * credentials are not accepted as an allowlist entry.
 */
export function parseExactDashboardOrigin(value: string): string | null {
  if (!value || value !== value.trim() || value.includes(",")) return null;

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:")
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
      || url.origin !== value
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Resolve the shared dashboard origin allowlist. An invalid explicit value
 * fails closed instead of partially accepting a typo. CORS_ORIGIN remains a
 * single-origin compatibility fallback for non-container development.
 */
export function getDashboardAllowedOrigins(
  environment: OriginEnvironment = process.env,
): readonly string[] {
  const raw = environment[DASHBOARD_ALLOWED_ORIGINS_ENV] ?? environment.CORS_ORIGIN;
  if (raw === undefined) return DEFAULT_DASHBOARD_ALLOWED_ORIGINS;

  const origins = raw.split(",").map(parseExactDashboardOrigin);
  if (origins.length === 0 || origins.some((origin) => origin === null)) return [];
  return [...new Set(origins as string[])];
}

export function isTrustedDashboardOrigin(
  origin: string,
  allowedOrigins: readonly string[],
): boolean {
  return allowedOrigins.includes(origin);
}

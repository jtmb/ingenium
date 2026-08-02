export const DEFAULT_DASHBOARD_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
] as const;

function parseExactDashboardOrigin(value: string): string | null {
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
 * Resolve exact origins shared by CORS and the browser mutation contract.
 * An invalid explicit list is empty so the API fails closed for browser calls.
 * CORS_ORIGIN remains a one-origin compatibility fallback outside Docker.
 */
export function getDashboardAllowedOrigins(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  const raw = environment.DASHBOARD_ALLOWED_ORIGINS ?? environment.CORS_ORIGIN;
  if (raw === undefined) return DEFAULT_DASHBOARD_ALLOWED_ORIGINS;

  const origins = raw.split(",").map(parseExactDashboardOrigin);
  if (origins.length === 0 || origins.some((origin) => origin === null)) return [];
  return [...new Set(origins as string[])];
}

/**
 * Application configuration — populated from environment variables with sensible defaults.
 *
 * - port:       4097 — non-privileged, avoids requiring root in container
 * - rateLimit:  100 req/min per IP — conservative, tuned for agentic workloads not human browsing
 * - dashboardOrigins: exact browser origins accepted by CORS and CSRF. Configure
 *                     DASHBOARD_ALLOWED_ORIGINS as a comma-separated allowlist.
 */
const dashboardOrigins = getDashboardAllowedOrigins();

export const config = {
  port: parseInt(process.env.INGENIUM_API_PORT ?? "4097", 10),
  rateLimit: parseInt(process.env.INGENIUM_API_RATE_LIMIT ?? "100", 10),
  dashboardOrigins,
  opencodeUrl: process.env.OPENCODE_SERVER_URL ?? "http://localhost:4098",
};

/**
 * Trusted-LAN proxy and Content-Security-Policy configuration for the
 * Ingenium Dashboard.
 *
 * Exports the CSP builder and rewrite rules used by next.config.js so
 * the security model is documented, type-safe, and independently testable.
 *
 * This module is referenced by next.config.js but may also be imported
 * by test suites to verify CSP and rewrite constraints.
 */

// ── Internal API proxy ────────────────────────────────────────────────────

/** Internal loopback address of the Ingenium API container. */
export const API_PROXY_TARGET = "http://127.0.0.1:4097";

/** Path prefix that the rewrite proxies to the internal API. */
export const API_V1_SOURCE = "/api/v1/:path*";

/** Destination path with preserved wildcard segment. */
export const API_V1_DESTINATION = `${API_PROXY_TARGET}/api/v1/:path*`;

// ── OpenCode service ports ────────────────────────────────────────────────

/** Ports on which OpenCode Web (:4098) and CLI/ttyd (:4099) listen. */
export const OPENCODE_SERVICE_PORTS = [4098, 4099] as const;
export const OPENCODE_WEB_SOURCE = "/opencode-web/:path*";
export const OPENCODE_WEB_DESTINATION = "http://127.0.0.1:4098/:path*";
export const OPENCODE_CLI_SOURCE = "/opencode-cli/:path*";
export const OPENCODE_CLI_DESTINATION = "http://127.0.0.1:4099/:path*";

// ── CSP directives ────────────────────────────────────────────────────────

/**
 * Build the Content-Security-Policy header value.
 *
 * Loopback deployment design:
 * - `connect-src 'self'` covers same-origin API calls routed through the
 *   Next.js rewrite proxy.  `http://localhost:4097` is retained for local
 *   development where the browser connects directly to the API.
 * - `frame-src` permits same-origin OpenCode proxy paths. Local development
 *   also permits loopback-published ports 4098/4099.
 */
export function buildCsp(): string {
  const frameEntries = [
    "'self'",
    ...OPENCODE_SERVICE_PORTS.flatMap((p) => [
      `http://localhost:${p}`,
    ]),
  ];

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' http://localhost:4097",
    `frame-src ${frameEntries.join(" ")}`,
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Rewrite rules to inject into the Next.js `async rewrites()` config.
 *
 * Proxies `/api/v1/*` requests to the internal API container at
 * 127.0.0.1:4097, enabling same-origin API access from the dashboard.
 */
export function getRewrites(): Array<{ source: string; destination: string }> {
  return [
    { source: API_V1_SOURCE, destination: API_V1_DESTINATION },
    { source: OPENCODE_WEB_SOURCE, destination: OPENCODE_WEB_DESTINATION },
    { source: OPENCODE_CLI_SOURCE, destination: OPENCODE_CLI_DESTINATION },
  ];
}

/**
 * Trusted-LAN proxy and Content-Security-Policy configuration for the
 * Ingenium Dashboard.
 *
 * Exports the CSP builder and rewrite rules that mirror the inline
 * configuration in next.config.js, so the security model is documented,
 * type-safe, and independently testable.
 *
 * This module may be imported by test suites to assert CSP and rewrite
 * constraints.
 */

// ── Internal API proxy ────────────────────────────────────────────────────

/** Internal loopback address of the Ingenium API container. */
export const API_PROXY_TARGET = "http://127.0.0.1:4097";

/** Path prefix that the rewrite proxies to the internal API. */
export const API_V1_SOURCE = "/api/v1/:path*";

/** Destination path with preserved wildcard segment. */
export const API_V1_DESTINATION = `${API_PROXY_TARGET}/api/v1/:path*`;

// ── CSP directives ────────────────────────────────────────────────────────

/**
 * Build the Content-Security-Policy header value.
 *
 * Loopback deployment design:
 * - `connect-src 'self'` covers same-origin API calls routed through the
 *   Next.js rewrite proxy.  `http://localhost:4097` is retained for local
 *   development where the browser connects directly to the API.
 * - `frame-src` permits loopback-published ports 4098/4099 for local
 *   development. Remote HTTPS deployments rely on dedicated origins
 *   configured via NEXT_PUBLIC_OPENCODE_WEB_URL.
 */
export function buildCsp(): string {
  const frameEntries = [
    "'self'",
    "http://localhost:4098",
    "http://localhost:4099",
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
 * OpenCode proxy rewrites have been removed — OpenCode v1.18.3+ serves
 * root-relative assets and cannot be proxied under a sub-path.
 */
export function getRewrites(): Array<{ source: string; destination: string }> {
  return [
    { source: API_V1_SOURCE, destination: API_V1_DESTINATION },
  ];
}

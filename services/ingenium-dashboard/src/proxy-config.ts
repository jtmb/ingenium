/**
 * API proxy and Content-Security-Policy configuration for the Ingenium
 * Dashboard.
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

const OPENCODE_WEB_GATEWAY_ORIGIN = "http://opencode.localhost:3000";
const OPENCODE_CLI_GATEWAY_ORIGIN = "http://cli.localhost:3000";

function configuredHttpsFrameOrigins(): string[] {
  const values = [
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL,
    process.env.NEXT_PUBLIC_OPENCODE_CLI_URL,
  ];

  return values.flatMap((value) => {
    if (!value?.trim()) return [];
    try {
      const url = new URL(value.trim());
      if (
        url.protocol !== "https:"
        || (url.pathname !== "" && url.pathname !== "/")
        || url.search
        || url.hash
        || url.username
        || url.password
      ) {
        return [];
      }
      return [url.origin];
    } catch {
      return [];
    }
  });
}

function isProductionGatewayBuild(): boolean {
  return process.env.NODE_ENV === "production";
}

/** A non-empty public origin also opts a development build into gateway mode. */
function hasConfiguredOpenCodeOrigins(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL?.trim()
      || process.env.NEXT_PUBLIC_OPENCODE_CLI_URL?.trim(),
  );
}

function isGatewayMode(): boolean {
  return isProductionGatewayBuild() || hasConfiguredOpenCodeOrigins();
}

// ── CSP directives ────────────────────────────────────────────────────────

/**
 * Build the Content-Security-Policy header value.
 *
 * Loopback deployment design:
 * - `connect-src 'self'` covers same-origin API calls routed through the
 *   Next.js rewrite proxy.  `http://localhost:4097` is retained for local
 *   development where the browser connects directly to the API.
 * - `frame-src` permits the two exact authenticated `.localhost` host gateway
 *   roots. Direct local ports are included only by an explicitly non-gateway
 *   build; production and public-origin gateway CSP omit them. No wildcard or
 *   shared dashboard subpath is allowed.
 */
export function buildCsp(): string {
  const frameEntries = [
    "'self'",
    // Direct ports are a development-only target. Once a build opts into
    // gateway/dedicated-origin mode, omitting them keeps the CSP aligned with
    // runtime-urls.ts and prevents a dead compose target from being allowed.
    ...(!isGatewayMode() ? ["http://localhost:4098", "http://localhost:4099"] : []),
    OPENCODE_WEB_GATEWAY_ORIGIN,
    OPENCODE_CLI_GATEWAY_ORIGIN,
    ...configuredHttpsFrameOrigins(),
  ];

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' http://localhost:4097",
    `frame-src ${[...new Set(frameEntries)].join(" ")}`,
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Fallback rewrite rules to inject into the Next.js `async rewrites()` config.
 *
 * The API proxy must be a fallback rather than an after-files rewrite. The
 * session-events route is a dashboard-owned streaming endpoint; an after-files
 * rewrite captures it before its route handler and buffers OpenCode's persistent
 * SSE response. All other `/api/v1/*` requests remain same-origin proxies to
 * the private API container.
 */
export function getRewrites(): {
  fallback: Array<{ source: string; destination: string }>;
} {
  return {
    fallback: [
      { source: API_V1_SOURCE, destination: API_V1_DESTINATION },
    ],
  };
}

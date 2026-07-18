/**
 * Browser-safe utility for deriving OpenCode Web/CLI iframe URLs from the
 * public dashboard origin.
 *
 * Local HTTP deployments use the loopback-published OpenCode ports directly.
 * Remote HTTP and HTTPS deployments use same-origin reverse-proxy paths by
 * default; OpenCode ports are not published beyond host loopback. Deployments
 * may override either path with a relative same-origin path. Direct service
 * origins are deliberately not supported by the LAN dashboard.
 */

/** Port that the OpenCode Web server listens on (published to host loopback). */
const OPENCODE_WEB_PORT = 4098;

/** Port that the ttyd OpenCode CLI server listens on (published to host loopback). */
const OPENCODE_CLI_PORT = 4099;
const OPENCODE_WEB_PROXY_PATH = "/opencode-web/";
const OPENCODE_CLI_PROXY_PATH = "/opencode-cli/";

/**
 * Build an origin string for an OpenCode service port.
 *
 * In the browser, reads `window.location` to preserve the current protocol
 * (http vs https) and hostname, then substitutes the given port. Uses the
 * `URL` API for correct origin construction.
 *
 * During SSR or non-browser environments, falls back to `http://localhost:{port}`.
 */
function configuredPath(value: string | undefined, fallback: string): string {
  const configured = value?.trim();
  if (!configured || !configured.startsWith("/") || configured.startsWith("//")) return fallback;
  if (typeof window === "undefined") return configured;
  return new URL(configured, window.location.origin).href;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function openCodeUrl(port: number, proxyPath: string, configured: string | undefined): string {
  if (typeof window === "undefined") return configuredPath(configured, proxyPath);

  const proxyUrl = new URL(proxyPath, window.location.origin).href;
  if (window.location.protocol === "https:" || !isLoopbackHost(window.location.hostname)) {
    return configuredPath(configured, proxyUrl);
  }

  const directUrl = new URL(window.location.href);
  directUrl.port = String(port);
  directUrl.pathname = "/";
  directUrl.search = "";
  directUrl.hash = "";
  return configuredPath(configured, directUrl.href);
}

/**
 * Full URL for the OpenCode Web iframe (port 4098).
 * Appends a trailing slash so the browser doesn't issue a redirect.
 *
 * @example "http://localhost:4098/"
 * @example "https://my-host.example.com/opencode-web/"
 */
export function getOpenCodeWebUrl(): string {
  return openCodeUrl(OPENCODE_WEB_PORT, OPENCODE_WEB_PROXY_PATH, process.env.NEXT_PUBLIC_OPENCODE_WEB_URL);
}

/**
 * Full URL for the OpenCode CLI / ttyd iframe (port 4099).
 * Appends a trailing slash so the browser doesn't issue a redirect.
 *
 * @example "http://localhost:4099/"
 * @example "https://my-host.example.com/opencode-cli/"
 */
export function getOpenCodeCliUrl(): string {
  return openCodeUrl(OPENCODE_CLI_PORT, OPENCODE_CLI_PROXY_PATH, process.env.NEXT_PUBLIC_OPENCODE_CLI_URL);
}

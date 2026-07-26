/**
 * Browser-safe utility for deriving OpenCode Web/CLI iframe URLs.
 *
 * There are four supported deployment modes:
 *
 * 1. Local development uses the published ports directly.
 * 2. Production gateway builds use the two trusted local roots by
 *    default, or may configure equivalent public origins at build time.
 * 3. A local host gateway may be configured with the two trusted
 *    `.localhost` roots (`opencode.localhost` and `cli.localhost`).
 * 4. Remote deployments may explicitly provide dedicated root HTTPS origins.
 *
 * OpenCode is intentionally never routed through a shared dashboard subpath.
 * Its application serves root-relative assets, so a subpath proxy produces a
 * page that can appear to load while its scripts and websocket cannot connect.
 *
 * `NEXT_PUBLIC_*` values are build-time public configuration. This module still
 * validates them at the browser boundary so an accidental URL, path, or
 * credential cannot become an iframe target.
 */

export type OpenCodeMode = "web" | "cli";

export type OpenCodeAvailability =
  | "ok-loopback"
  | "ok-host-gateway"
  | "ok-https-origin"
  | "unavailable";

/** Trusted local gateway roots. Keep these exact; do not allow a
 * wildcard `.localhost` target to turn configuration into an open redirect. */
export const OPENCODE_WEB_GATEWAY_URL = "http://opencode.localhost:3000/";
export const OPENCODE_CLI_GATEWAY_URL = "http://cli.localhost:3000/";

const OPENCODE_WEB_PORT = 4098;
const OPENCODE_CLI_PORT = 4099;

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function configuredValue(mode: OpenCodeMode): string {
  // These direct property reads are deliberately build-time public env reads.
  // Do not replace them with a runtime fetch or include server credentials.
  return (mode === "web"
    ? process.env.NEXT_PUBLIC_OPENCODE_WEB_URL
    : process.env.NEXT_PUBLIC_OPENCODE_CLI_URL
  )?.trim() ?? "";
}

/**
 * A non-empty public setting opts the dashboard into explicit-origin mode.
 *
 * This distinction is important for the container gateway deployment. If a
 * build contains one malformed or one-sided origin setting, silently falling
 * back to the loopback ports would create an iframe target that is not
 * published by the gateway. Treat the whole build as explicitly configured
 * instead, and surface the missing/invalid mode as unavailable.
 */
function hasConfiguredOrigins(): boolean {
  return Boolean(
    configuredValue("web") || configuredValue("cli"),
  );
}

/** Production images run behind the local root-origin gateway. */
function isProductionGatewayBuild(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Resolve the deployment boundary once for all URL decisions. A production
 * build is gateway-backed by default; public origins also explicitly select
 * gateway/dedicated-origin mode in development and test builds. This keeps
 * direct loopback listeners available only to an unconfigured local build.
 */
function isGatewayMode(): boolean {
  return isProductionGatewayBuild() || hasConfiguredOrigins();
}

function defaultGatewayUrl(mode: OpenCodeMode): string | null {
  if (typeof window === "undefined"
    || !isProductionGatewayBuild()
    || window.location.protocol !== "http:"
    || !isLoopbackHost(window.location.hostname)) {
    return null;
  }

  return mode === "web" ? OPENCODE_WEB_GATEWAY_URL : OPENCODE_CLI_GATEWAY_URL;
}

/** Parse and validate one public URL setting as a root origin. */
function parseConfiguredUrl(mode: OpenCodeMode): URL | null {
  const configured = configuredValue(mode);
  if (!configured) return null;

  try {
    const url = new URL(configured);
    const isRoot = (url.pathname === "" || url.pathname === "/")
      && url.search === ""
      && url.hash === ""
      && url.username === ""
      && url.password === "";
    if (!isRoot) return null;

    if (url.protocol === "https:") return url;

    const expectedHost = mode === "web" ? "opencode.localhost" : "cli.localhost";
    // Host gateway mode is deliberately narrow: HTTP is accepted only for the
    // local dashboard gateway roots on the dashboard's public port.
    if (
      url.protocol === "http:"
      && url.hostname === expectedHost
      && url.port === "3000"
    ) {
      return url;
    }
  } catch {
    // Invalid build-time configuration is treated as unavailable, never used
    // as an iframe src.
  }

  return null;
}

function isCompatibleWithDashboard(url: URL): boolean {
  // HTTP gateway/direct-port URLs must not be embedded by an HTTPS dashboard.
  return url.protocol === "https:" || window.location.protocol === "http:";
}

function getUrl(mode: OpenCodeMode): string | null {
  if (typeof window === "undefined") return null;

  const rawConfigured = configuredValue(mode);
  const configured = parseConfiguredUrl(mode);
  if (rawConfigured) {
    // Never fall through from a present-but-invalid setting to a dead direct
    // port. Invalid build-time public configuration is an unavailable state.
    if (!configured) return null;
    return isCompatibleWithDashboard(configured) ? `${configured.origin}/` : null;
  }

  // Gateway/dedicated-origin mode must never reintroduce 4098/4099 for a
  // missing companion setting or an invalid public setting.
  if (isGatewayMode()) {
    const gatewayUrl = defaultGatewayUrl(mode);
    return gatewayUrl;
  }

  if (isLoopbackHost(window.location.hostname) && window.location.protocol === "http:") {
    const port = mode === "web" ? OPENCODE_WEB_PORT : OPENCODE_CLI_PORT;
    return `http://localhost:${port}/`;
  }

  return null;
}

/**
 * Check whether the requested OpenCode iframe can be embedded at the current
 * dashboard origin. Resolution is browser-only and should be deferred until
 * after hydration by callers.
 */
export function getOpenCodeAvailability(mode: OpenCodeMode = "web"): OpenCodeAvailability {
  if (typeof window === "undefined") return "unavailable";

  const rawConfigured = configuredValue(mode);
  const configured = parseConfiguredUrl(mode);
  if (rawConfigured) {
    if (!configured) return "unavailable";
    if (!isCompatibleWithDashboard(configured)) return "unavailable";
    return configured.protocol === "https:" ? "ok-https-origin" : "ok-host-gateway";
  }

  if (isGatewayMode()) {
    return defaultGatewayUrl(mode) ? "ok-host-gateway" : "unavailable";
  }

  if (isLoopbackHost(window.location.hostname) && window.location.protocol === "http:") {
    return "ok-loopback";
  }

  return "unavailable";
}

/** Full URL for the OpenCode Web iframe, or `null` when it must not mount. */
export function getOpenCodeWebUrl(): string | null {
  return getUrl("web");
}

/** Full URL for the OpenCode CLI / ttyd iframe, or `null` when it must not mount. */
export function getOpenCodeCliUrl(): string | null {
  return getUrl("cli");
}

/**
 * Return a credential-free root URL that a user can open to complete gateway
 * navigation. This is deliberately separate from iframe URL resolution:
 * a direct link remains useful when the current dashboard origin cannot
 * embed the OpenCode origin (for example, an HTTPS/mixed-content boundary).
 */
export function getOpenCodeAuthUrl(mode: OpenCodeMode): string {
  const configured = parseConfiguredUrl(mode);
  if (configured) return `${configured.origin}/`;

  if (hasConfiguredOrigins()) {
    // Explicit-origin mode must never expose the unpublished loopback ports,
    // even when one of the build-time settings is malformed or missing.
    return mode === "web" ? OPENCODE_WEB_GATEWAY_URL : OPENCODE_CLI_GATEWAY_URL;
  }

  const gatewayUrl = defaultGatewayUrl(mode);
  if (gatewayUrl) return gatewayUrl;

  if (isGatewayMode()) {
    // A production build has no valid direct-port escape hatch. Keep the
    // action pointed at the credential-free gateway root instead.
    return mode === "web" ? OPENCODE_WEB_GATEWAY_URL : OPENCODE_CLI_GATEWAY_URL;
  }

  if (typeof window !== "undefined"
    && isLoopbackHost(window.location.hostname)
    && window.location.protocol === "http:") {
    const port = mode === "web" ? OPENCODE_WEB_PORT : OPENCODE_CLI_PORT;
    return `http://localhost:${port}/`;
  }

  // With no explicit build-time origin this is the local-development escape
  // hatch. Production gateway builds take the validated gateway branch above
  // even when the default roots are used without public overrides.
  if (typeof window !== "undefined") {
    const port = mode === "web" ? OPENCODE_WEB_PORT : OPENCODE_CLI_PORT;
    return `http://localhost:${port}/`;
  }

  return mode === "web" ? OPENCODE_WEB_GATEWAY_URL : OPENCODE_CLI_GATEWAY_URL;
}

/**
 * Browser-safe utility for deriving OpenCode Web/CLI iframe URLs from the
 * public dashboard origin.
 *
 * Loopback HTTP deployments use the loopback-published OpenCode ports directly.
 * Remote HTTPS deployments require an explicit NEXT_PUBLIC_OPENCODE_WEB_URL /
 * NEXT_PUBLIC_OPENCODE_CLI_URL override pointing to a dedicated root HTTPS origin.
 * Unsupported LAN HTTP without a configured HTTPS override returns null
 * (the caller should display explicit guidance instead of embedding a broken proxy).
 *
 * The old /opencode-web/ and /opencode-cli/ same-origin proxy rewrites are
 * REMOVED — OpenCode v1.18.3+ serves root-relative assets and cannot be
 * proxied under a sub-path.
 */

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

/**
 * Check whether the OpenCode iframe can be embedded at the current dashboard origin.
 */
export function getOpenCodeAvailability(): "ok-loopback" | "ok-https-origin" | "unavailable" {
  if (typeof window === "undefined") return "unavailable"; // SSR — resolve after hydration
  const { hostname, protocol } = window.location;
  if (isLoopbackHost(hostname)) return "ok-loopback";
  if (protocol === "https:") return "ok-https-origin";
  const configured = process.env.NEXT_PUBLIC_OPENCODE_WEB_URL?.trim();
  if (configured?.startsWith("https://")) return "ok-https-origin";
  return "unavailable";
}

/**
 * Full URL for the OpenCode Web iframe.
 *
 * Loopback → http://localhost:4098/
 * Configured origin → https://opencode.example.com/
 * Otherwise → returns null (do not embed)
 */
export function getOpenCodeWebUrl(): string | null {
  if (typeof window === "undefined") return null;
  const configured = process.env.NEXT_PUBLIC_OPENCODE_WEB_URL?.trim();
  if (configured) {
    // Accept only root HTTPS origins (no sub-paths, no query, no hash)
    if (/^https:\/\/[^/?#]+\/?$/.test(configured)) {
      return configured.replace(/\/$/, "") + "/";
    }
    // Invalid — fall through to availability check
  }
  if (isLoopbackHost(window.location.hostname)) {
    return "http://localhost:4098/";
  }
  if (window.location.protocol === "https:") {
    return null; // HTTPS without explicit override → unavailable
  }
  return null; // LAN HTTP → unavailable (no broken proxy)
}

/**
 * Full URL for the OpenCode CLI / ttyd iframe.
 *
 * Loopback → http://localhost:4099/
 * Configured origin → https://opencode.example.com/
 * Otherwise → returns null (do not embed)
 */
export function getOpenCodeCliUrl(): string | null {
  if (typeof window === "undefined") return null;
  const configured = process.env.NEXT_PUBLIC_OPENCODE_CLI_URL?.trim();
  if (configured) {
    if (/^https:\/\/[^/?#]+\/?$/.test(configured)) {
      return configured.replace(/\/$/, "") + "/";
    }
  }
  if (isLoopbackHost(window.location.hostname)) {
    return "http://localhost:4099/";
  }
  return null;
}

/** @type {import('next').NextConfig} */
function publicOpenCodeOrigin(name) {
  const value = (process.env[name] || "").trim();
  if (!value) return "";

  // Only public, credential-free origin settings are copied into the browser
  // bundle. The runtime URL module performs the stricter mode-specific
  // allowlist validation before using the value as an iframe target.
  try {
    const url = new URL(value);
    if (url.username || url.password) return "";
    return value;
  } catch {
    return "";
  }
}

function configuredHttpsFrameOrigins() {
  return ["NEXT_PUBLIC_OPENCODE_WEB_URL", "NEXT_PUBLIC_OPENCODE_CLI_URL"].flatMap((name) => {
    const value = publicOpenCodeOrigin(name);
    if (!value) return [];
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:"
        || (url.pathname !== "" && url.pathname !== "/")
        || url.search
        || url.hash
        || url.username
        || url.password
      ) return [];
      return [url.origin];
    } catch {
      return [];
    }
  });
}

function hasConfiguredOpenCodeOrigins() {
  return ["NEXT_PUBLIC_OPENCODE_WEB_URL", "NEXT_PUBLIC_OPENCODE_CLI_URL"].some(
    (name) => (process.env[name] || "").trim().length > 0,
  );
}

function runtimeWildcardOrigin() {
  const domain = (process.env.NEXT_PUBLIC_RUNTIME_ROOT_DOMAIN || "").trim().toLowerCase().replace(/^\./, "");
  if (!domain || domain.length > 200 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(domain) || domain.includes("..") || !domain.includes(".")) return "";
  return `https://*.${domain}`;
}

const VSCODE_GATEWAY_ORIGIN = "http://vscode.localhost:3000";

// Production bundles and builds with explicit public origins are gateway
// builds. Only an unconfigured non-production build may advertise the private
// direct listeners in its frame policy. Resolve this when headers are requested
// so test/config consumers that reload environment values cannot retain a
// stale mode from an earlier config load.
function isGatewayMode() {
  return process.env.NODE_ENV === "production" || hasConfiguredOpenCodeOrigins();
}

const nextConfig = {
  output: "standalone",

  // Next.js inlines these values at build time. Do not add server credentials
  // or OPENCODE_SERVER_PASSWORD here; only the two public origin settings are
  // intentionally available to browser code.
  env: {
    NEXT_PUBLIC_OPENCODE_WEB_URL: publicOpenCodeOrigin("NEXT_PUBLIC_OPENCODE_WEB_URL"),
    NEXT_PUBLIC_OPENCODE_CLI_URL: publicOpenCodeOrigin("NEXT_PUBLIC_OPENCODE_CLI_URL"),
    NEXT_PUBLIC_RUNTIME_ROOT_DOMAIN: (process.env.NEXT_PUBLIC_RUNTIME_ROOT_DOMAIN || "").trim(),
  },

  /**
   * Proxy /api/v1/* requests to the private API listener in production and
   * the configured API port in development/fixtures, enabling same-origin API
   * access from the dashboard regardless of the client hostname. OpenCode Web
   * and CLI are intentionally not rewritten here: they must use direct local ports, the
   * authenticated `.localhost` host gateways, or explicit HTTPS origins.
   */
  async rewrites() {
    const apiPort = process.env.INGENIUM_API_PORT || (process.env.NODE_ENV === "production" ? "4096" : "4097");
    return {
      // A fallback rewrite lets dashboard-owned API route handlers win. In
      // particular, the persistent OpenCode SSE route must not pass through
      // Next's after-files proxy, which buffers it until the connection ends.
      fallback: [
        {
          source: "/api/v1/:path*",
          destination: `http://127.0.0.1:${apiPort}/api/v1/:path*`,
        },
      ],
    };
  },

  async headers() {
    const apiPort = process.env.INGENIUM_API_PORT || "4097";
    const gatewayMode = isGatewayMode();
    const configuredFrameOrigins = configuredHttpsFrameOrigins();
    const runtimeOrigin = runtimeWildcardOrigin();
    return [
      {
        source: "/(.*)",
        headers: [
          // Next's static headers cannot attach a request nonce to
          // framework bootstrap scripts; removing 'unsafe-inline' here
          // would break App Router hydration.
          //
          // Loopback deployment CSP notes:
          // - connect-src retains localhost:4097 for local dev (direct
          //   API access).  Same-origin API calls are covered by 'self'
          //   and proxied via the rewrite above.
          // - frame-src allows direct local ports only for an explicitly
          //   non-gateway development build, plus the two exact authenticated
          //   `.localhost` roots and validated dedicated HTTPS origins.
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; " +
              "script-src 'self' 'unsafe-inline'; " +
              "style-src 'self' 'unsafe-inline'; " +
              "object-src 'none'; " +
              "img-src 'self' data: blob:; " +
              "font-src 'self' data:; " +
              "connect-src 'self' http://localhost:" + apiPort + (runtimeOrigin ? ` ${runtimeOrigin}` : "") + "; " +
              "frame-src 'self'" +
              (gatewayMode ? "" : " http://localhost:4098 http://localhost:4099") +
               " http://opencode.localhost:3000 http://cli.localhost:3000 " + VSCODE_GATEWAY_ORIGIN +
              (configuredFrameOrigins.length > 0 ? ` ${[...new Set(configuredFrameOrigins)].join(" ")}` : "") +
              (runtimeOrigin ? ` ${runtimeOrigin}` : "") +
              "; " +
              "frame-ancestors 'self'; " +
              "base-uri 'self'; " +
              "form-action 'self'",
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;

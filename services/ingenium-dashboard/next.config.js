/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",

  /**
   * Proxy /api/v1/* requests to the internal API container at
   * 127.0.0.1:4097, enabling same-origin API access from the
   * dashboard regardless of the client hostname. OpenCode Web and CLI are
   * also proxied for remote and HTTPS dashboard deployments because their
   * host ports are loopback-only.
   */
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: "http://127.0.0.1:4097/api/v1/:path*",
      },
      {
        source: "/opencode-web/:path*",
        destination: "http://127.0.0.1:4098/:path*",
      },
      {
        source: "/opencode-cli/:path*",
        destination: "http://127.0.0.1:4099/:path*",
      },
    ];
  },

  async headers() {
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
          // - frame-src allows same-origin OpenCode proxy paths and local
          //   loopback ports for local HTTP development.
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; " +
              "script-src 'self' 'unsafe-inline'; " +
              "style-src 'self' 'unsafe-inline'; " +
              "object-src 'none'; " +
              "img-src 'self' data: blob:; " +
              "font-src 'self' data:; " +
              "connect-src 'self' http://localhost:4097; " +
              "frame-src 'self' http://localhost:4098 http://localhost:4099; " +
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

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        // Next's static headers cannot attach a request nonce to framework bootstrap
        // scripts; removing unsafe-inline here would break App Router hydration.
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http://localhost:4097; frame-src 'self' http://localhost:4098 http://localhost:4099; frame-ancestors 'self'; base-uri 'self'; form-action 'self'" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ],
    }];
  },
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/opencode-proxy/:path*",
        destination: "http://localhost:4098/:path*",
      },
    ];
  },
};

export default nextConfig;

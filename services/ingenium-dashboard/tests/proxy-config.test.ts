import { describe, expect, it } from "vitest";
import {
  API_PROXY_TARGET,
  buildCsp,
  getRewrites,
  OPENCODE_CLI_DESTINATION,
  OPENCODE_WEB_DESTINATION,
} from "@/proxy-config";

describe("Dashboard same-origin proxy configuration", () => {
  it("routes API and OpenCode services only to container loopback", () => {
    expect(API_PROXY_TARGET).toBe("http://127.0.0.1:4097");
    expect(getRewrites()).toEqual([
      { source: "/api/v1/:path*", destination: "http://127.0.0.1:4097/api/v1/:path*" },
      { source: "/opencode-web/:path*", destination: OPENCODE_WEB_DESTINATION },
      { source: "/opencode-cli/:path*", destination: OPENCODE_CLI_DESTINATION },
    ]);
  });

  it("keeps CSP same-origin for LAN and HTTPS proxy paths", () => {
    const csp = buildCsp();
    expect(csp).toContain("connect-src 'self' http://localhost:4097");
    expect(csp).toContain("frame-src 'self' http://localhost:4098 http://localhost:4099");
    expect(csp).not.toMatch(/192\.168|10\.0|\*:/);
  });
});

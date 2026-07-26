import { afterEach, describe, expect, it } from "vitest";
import {
  API_PROXY_TARGET,
  buildCsp,
  getRewrites,
} from "@/proxy-config";

const initialNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  delete process.env.NEXT_PUBLIC_OPENCODE_WEB_URL;
  delete process.env.NEXT_PUBLIC_OPENCODE_CLI_URL;
  if (initialNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = initialNodeEnv;
});

describe("Dashboard gateway and proxy configuration", () => {
  it("routes only API service to container loopback, never OpenCode", () => {
    expect(API_PROXY_TARGET).toBe("http://127.0.0.1:4097");
    expect(getRewrites()).toEqual([
      { source: "/api/v1/:path*", destination: "http://127.0.0.1:4097/api/v1/:path*" },
    ]);
    expect(getRewrites().some(({ source, destination }) =>
      /opencode-web|opencode-cli|4098|4099/.test(`${source} ${destination}`),
    )).toBe(false);
  });

  it("keeps API connectivity same-origin and allows direct ports in development", () => {
    process.env.NODE_ENV = "development";
    const csp = buildCsp();
    expect(csp).toContain("connect-src 'self' http://localhost:4097");
    expect(csp).toContain(
      "frame-src 'self' http://localhost:4098 http://localhost:4099 http://opencode.localhost:3000 http://cli.localhost:3000",
    );
    expect(csp).not.toMatch(/192\.168|10\.0|\*:|\/opencode-web|\/opencode-cli/);
  });

  it("omits unpublished direct ports from a production gateway build", () => {
    process.env.NODE_ENV = "production";

    const csp = buildCsp();
    const frameSrc = csp.split("; ").find((directive) => directive.startsWith("frame-src "));

    expect(frameSrc).toBe(
      "frame-src 'self' http://opencode.localhost:3000 http://cli.localhost:3000",
    );
    expect(frameSrc).not.toContain(":4098");
    expect(frameSrc).not.toContain(":4099");
    expect(frameSrc).not.toContain("*");
  });

  it("has explicit CSP boundaries with no wildcard frames or remote host assumptions", () => {
    const directives = Object.fromEntries(
      buildCsp().split("; ").map((directive) => {
        const [name, ...values] = directive.split(" ");
        return [name, values.join(" ")];
      }),
    );

    expect(directives["default-src"]).toBe("'self'");
    expect(directives["frame-src"]).toBe(
      "'self' http://localhost:4098 http://localhost:4099 http://opencode.localhost:3000 http://cli.localhost:3000",
    );
    expect(directives["frame-src"]).not.toContain("*");
    expect(directives["frame-ancestors"]).toBe("'self'");
  });

  it("adds only validated explicit HTTPS roots to frame-src", () => {
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = "https://opencode.example.com/";
    process.env.NEXT_PUBLIC_OPENCODE_CLI_URL = "https://cli.example.com/terminal/";

    expect(buildCsp()).toContain("https://opencode.example.com");
    expect(buildCsp()).not.toContain("https://cli.example.com");
  });
});

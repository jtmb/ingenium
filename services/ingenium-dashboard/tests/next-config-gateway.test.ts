import { afterEach, describe, expect, it, vi } from "vitest";

type NextConfigForTest = {
  rewrites: () => Promise<{
    fallback: Array<{ source: string; destination: string }>;
  }>;
  headers: () => Promise<Array<{ headers: Array<{ key: string; value: string }> }>>;
};

const initialNodeEnv = process.env.NODE_ENV;

async function loadNextConfig(): Promise<NextConfigForTest> {
  vi.resetModules();
  const configModule = await import("../next.config.js");
  return configModule.default as NextConfigForTest;
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_OPENCODE_WEB_URL;
  delete process.env.NEXT_PUBLIC_OPENCODE_CLI_URL;
  delete process.env.INGENIUM_API_PORT;
  delete process.env.NEXT_PUBLIC_RUNTIME_ROOT_DOMAIN;
  if (initialNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = initialNodeEnv;
});

async function contentSecurityPolicy(config: NextConfigForTest): Promise<string> {
  const headers = await config.headers();
  const csp = headers[0]?.headers.find((header) => header.key === "Content-Security-Policy");
  if (!csp) throw new Error("Content-Security-Policy header was not configured");
  return csp.value;
}

describe("Next.js gateway configuration", () => {
  it("keeps the rewrite surface API-only", async () => {
    const config = await loadNextConfig();
    expect(await config.rewrites()).toEqual({
      fallback: [
        {
          source: "/api/v1/:path*",
          destination: "http://127.0.0.1:4097/api/v1/:path*",
        },
      ],
    });
  });

  it("uses the private API listener in production without advertising it to browsers", async () => {
    process.env.NODE_ENV = "production";
    const config = await loadNextConfig();

    expect(await config.rewrites()).toEqual({
      fallback: [
        {
          source: "/api/v1/:path*",
          destination: "http://127.0.0.1:4096/api/v1/:path*",
        },
      ],
    });
    expect(await contentSecurityPolicy(config)).toContain("connect-src 'self' http://localhost:4097");
  });

  it("preserves an explicit isolated fixture API port in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.INGENIUM_API_PORT = "50664";
    const config = await loadNextConfig();

    expect((await config.rewrites()).fallback[0]?.destination).toBe("http://127.0.0.1:50664/api/v1/:path*");
  });

  it("allows direct local ports only in an unconfigured development build", async () => {
    process.env.NODE_ENV = "development";
    const csp = await contentSecurityPolicy(await loadNextConfig());
    const frameSrc = csp.split("; ").find((directive) => directive.startsWith("frame-src "));

    expect(frameSrc).toBe(
      "frame-src 'self' http://localhost:4098 http://localhost:4099 " +
        "http://opencode.localhost:3000 http://cli.localhost:3000 http://vscode.localhost:3000",
    );
    expect(frameSrc).not.toContain("*");
    expect(frameSrc).not.toContain("/opencode-web");
    expect(frameSrc).not.toContain("/opencode-cli");
  });

  it("omits unpublished direct ports from a production gateway build", async () => {
    process.env.NODE_ENV = "production";
    const csp = await contentSecurityPolicy(await loadNextConfig());
    const frameSrc = csp.split("; ").find((directive) => directive.startsWith("frame-src "));

    expect(frameSrc).toBe(
      "frame-src 'self' http://opencode.localhost:3000 http://cli.localhost:3000 http://vscode.localhost:3000",
    );
    expect(frameSrc).not.toContain(":4098");
    expect(frameSrc).not.toContain(":4099");
  });

  it("adds only validated dedicated HTTPS roots to frame-src", async () => {
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = "https://opencode.example.com/";
    process.env.NEXT_PUBLIC_OPENCODE_CLI_URL = "https://cli.example.com";
    const csp = await contentSecurityPolicy(await loadNextConfig());

    expect(csp).toContain("frame-src 'self' http://opencode.localhost:3000 http://cli.localhost:3000 http://vscode.localhost:3000");
    expect(csp).not.toContain("http://localhost:4098");
    expect(csp).not.toContain("http://localhost:4099");
    expect(csp).toContain("https://opencode.example.com https://cli.example.com");
    expect(csp).not.toContain("opencode-web");
    expect(csp).not.toContain("cli.example.com/");
  });

  it("does not add a configured subpath or credential-bearing origin to frame-src", async () => {
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = "https://opencode.example.com/opencode-web/";
    process.env.NEXT_PUBLIC_OPENCODE_CLI_URL = "https://user:secret@cli.example.com/";
    const csp = await contentSecurityPolicy(await loadNextConfig());

    expect(csp).not.toContain("opencode.example.com");
    expect(csp).not.toContain("cli.example.com");
    expect(csp).not.toContain("secret");
  });

  it("adds only a validated runtime wildcard to frame and exchange policies", async () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_RUNTIME_ROOT_DOMAIN = "runtime.example.test";
    const csp = await contentSecurityPolicy(await loadNextConfig());
    expect(csp).toContain("connect-src 'self' http://localhost:4097 https://*.runtime.example.test");
    expect(csp).toContain("frame-src 'self' http://opencode.localhost:3000 http://cli.localhost:3000 http://vscode.localhost:3000 https://*.runtime.example.test");

    process.env.NEXT_PUBLIC_RUNTIME_ROOT_DOMAIN = "runtime.example.test/path";
    expect(await contentSecurityPolicy(await loadNextConfig())).not.toContain("https://*.runtime.example.test/path");
  });
});

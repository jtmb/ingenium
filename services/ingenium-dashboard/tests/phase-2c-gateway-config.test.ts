import { afterEach, describe, expect, it, vi } from "vitest";

type NextConfigForTest = {
  env: Record<string, string>;
  rewrites: () => Promise<Array<{ source: string; destination: string }>>;
  headers: () => Promise<Array<{ headers: Array<{ key: string; value: string }> }>>;
};

const initialNodeEnv = process.env.NODE_ENV;

async function loadNextConfig(): Promise<NextConfigForTest> {
  vi.resetModules();
  const module = await import("../next.config.js");
  return module.default as NextConfigForTest;
}

function getHeaderValue(
  headers: Array<{ headers: Array<{ key: string; value: string }> }>,
  key: string,
): string {
  const header = headers[0]?.headers.find((candidate) => candidate.key === key);
  if (!header) throw new Error(`Missing ${key} header`);
  return header.value;
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_OPENCODE_WEB_URL;
  delete process.env.NEXT_PUBLIC_OPENCODE_CLI_URL;
  delete process.env.OPENCODE_SERVER_PASSWORD;
  delete process.env.INGENIUM_API_PORT;
  if (initialNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = initialNodeEnv;
});

describe("Phase 2C — build-time gateway configuration", () => {
  it("exposes only public runtime origin settings to the browser bundle", async () => {
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = "http://opencode.localhost:3000/";
    process.env.NEXT_PUBLIC_OPENCODE_CLI_URL = "http://cli.localhost:3000/";
    process.env.OPENCODE_SERVER_PASSWORD = "server-secret-must-not-be-public";

    const config = await loadNextConfig();

    expect(config.env).toEqual({
      NEXT_PUBLIC_OPENCODE_WEB_URL: "http://opencode.localhost:3000/",
      NEXT_PUBLIC_OPENCODE_CLI_URL: "http://cli.localhost:3000/",
      NEXT_PUBLIC_RUNTIME_ROOT_DOMAIN: "",
    });
    expect(Object.keys(config.env)).not.toContain("OPENCODE_SERVER_PASSWORD");
    expect(JSON.stringify(config.env)).not.toContain("server-secret-must-not-be-public");
  });

  it("captures public values at config-load time rather than reading them at request time", async () => {
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = "https://web.example.test/";
    process.env.NEXT_PUBLIC_OPENCODE_CLI_URL = "https://cli.example.test/";

    const config = await loadNextConfig();
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = "https://changed.example.test/";
    process.env.NEXT_PUBLIC_OPENCODE_CLI_URL = "https://changed-cli.example.test/";

    expect(config.env).toEqual({
      NEXT_PUBLIC_OPENCODE_WEB_URL: "https://web.example.test/",
      NEXT_PUBLIC_OPENCODE_CLI_URL: "https://cli.example.test/",
      NEXT_PUBLIC_RUNTIME_ROOT_DOMAIN: "",
    });
  });

  it("rejects credential-bearing public origins before they enter env or CSP", async () => {
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = "https://user:secret@web.example.test/";
    process.env.NEXT_PUBLIC_OPENCODE_CLI_URL = "https://cli.example.test/";

    const config = await loadNextConfig();
    const csp = getHeaderValue(await config.headers(), "Content-Security-Policy");

    expect(config.env.NEXT_PUBLIC_OPENCODE_WEB_URL).toBe("");
    expect(config.env.NEXT_PUBLIC_OPENCODE_CLI_URL).toBe("https://cli.example.test/");
    expect(csp).not.toContain("user");
    expect(csp).not.toContain("secret");
    expect(csp).not.toContain("web.example.test");
    expect(csp).toContain("https://cli.example.test");
  });

  it("keeps the dashboard rewrite and CSP API origin aligned to the configured port", async () => {
    process.env.INGENIUM_API_PORT = "4317";

    const config = await loadNextConfig();
    const rewrites = await config.rewrites();
    const csp = getHeaderValue(await config.headers(), "Content-Security-Policy");

    expect(rewrites).toEqual({
      fallback: [
        {
          source: "/api/v1/:path*",
          destination: "http://127.0.0.1:4317/api/v1/:path*",
        },
      ],
    });
    expect(csp).toContain("connect-src 'self' http://localhost:4317");
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it("allows only dedicated root origins in frame-src and never a dashboard subpath", async () => {
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = "https://web.example.test/";
    process.env.NEXT_PUBLIC_OPENCODE_CLI_URL = "https://cli.example.test/terminal/";

    const csp = getHeaderValue(await (await loadNextConfig()).headers(), "Content-Security-Policy");
    const frameSrc = csp.split("; ").find((directive) => directive.startsWith("frame-src "));

    expect(frameSrc).toBe(
      "frame-src 'self' http://opencode.localhost:3000 http://cli.localhost:3000 http://vscode.localhost:3000 " +
      "https://web.example.test",
    );
    expect(frameSrc).not.toContain(":4098");
    expect(frameSrc).not.toContain(":4099");
    expect(frameSrc).not.toContain("/terminal/");
    expect(frameSrc).not.toContain("/opencode-web");
    expect(frameSrc).not.toContain("/opencode-cli");
    expect(csp).toContain("frame-ancestors 'self'");
  });
});

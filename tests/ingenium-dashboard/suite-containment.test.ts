import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadSuiteContainment() {
  vi.resetModules();
  return import("./suite-containment");
}

describe("Docker external-suite containment", () => {
  it("preflights the public OpenCode, CLI, and VS Code gateway roots by default", async () => {
    delete process.env.INGENIUM_E2E_OPENCODE_WEB_URL;
    delete process.env.INGENIUM_E2E_CLI_URL;
    delete process.env.OPENCODE_SERVER_URL;
    process.env.RUN_DASHBOARD_DOCKER = "1";
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      void init;
      const url = new URL(String(input));
      const body = url.pathname === "/api/v1/projects"
        ? JSON.stringify({ data: [{ name: "global-default", is_global: true }] })
        : null;
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { dockerPreflight, suiteContainmentUrls } = await loadSuiteContainment();
    await dockerPreflight();

    expect(suiteContainmentUrls).toMatchObject({
      opencode: "http://opencode.localhost:3000",
      cli: "http://cli.localhost:3000",
      vscode: "http://vscode.localhost:3000",
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://localhost:4097/api/v1/health",
      "http://localhost:3000/",
      "http://127.0.0.1:3000/",
      "http://127.0.0.1:3000/",
      "http://127.0.0.1:3000/",
      "http://localhost:3000/api/v1/projects",
    ]);
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ headers: { host: "opencode.localhost:3000" } });
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({ headers: { host: "cli.localhost:3000" } });
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({ headers: { host: "vscode.localhost:3000" } });
  });

  it("preserves explicit public endpoint overrides", async () => {
    process.env.INGENIUM_E2E_OPENCODE_WEB_URL = "https://opencode.example.test/";
    process.env.INGENIUM_E2E_CLI_URL = "https://cli.example.test/";
    process.env.OPENCODE_SERVER_URL = "https://legacy.example.test/";

    const { suiteContainmentUrls } = await loadSuiteContainment();

    expect(suiteContainmentUrls).toMatchObject({
      opencode: "https://opencode.example.test",
      cli: "https://cli.example.test",
    });
  });

  it("keeps OPENCODE_SERVER_URL as the web fallback override", async () => {
    delete process.env.INGENIUM_E2E_OPENCODE_WEB_URL;
    process.env.OPENCODE_SERVER_URL = "https://opencode.example.test/";

    const { suiteContainmentUrls } = await loadSuiteContainment();

    expect(suiteContainmentUrls.opencode).toBe("https://opencode.example.test");
  });

  it("retries only the startup API health probe after a valid Retry-After", async () => {
    process.env.RUN_DASHBOARD_DOCKER = "1";
    let healthRequests = 0;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/health") {
        healthRequests += 1;
        return healthRequests === 1
          ? new Response(null, { status: 429, headers: { "Retry-After": "0" } })
          : new Response(null, { status: 200 });
      }
      const body = url.pathname === "/api/v1/projects"
        ? JSON.stringify({ data: [{ name: "global-default", is_global: true }] })
        : null;
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { dockerPreflight } = await loadSuiteContainment();
    await expect(dockerPreflight()).resolves.toBeUndefined();

    expect(healthRequests).toBe(2);
  });

  it("fails on the first Docker project rate limit without retrying", async () => {
    process.env.RUN_DASHBOARD_DOCKER = "1";
    let projectRequests = 0;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname !== "/api/v1/projects") return new Response(null, { status: 200 });
      projectRequests += 1;
      return new Response(null, { status: 429, headers: { "Retry-After": "3" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { dockerPreflight } = await loadSuiteContainment();
    await expect(dockerPreflight()).rejects.toThrow("GET /api/v1/projects returned HTTP 429 (Retry-After: 3)");

    expect(projectRequests).toBe(1);
  });
});

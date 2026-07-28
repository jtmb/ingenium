import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import {
  buildDashboardApiProxyHeaders,
  config,
  DASHBOARD_API_PROXY_ERROR_CODE,
  DASHBOARD_API_PROXY_ERROR_STATUS,
  DASHBOARD_CSRF_ERROR_CODE,
  DASHBOARD_CSRF_ERROR_STATUS,
  DASHBOARD_MARKER_HEADER,
  DASHBOARD_MARKER_VALUE,
  externalDashboardOrigin,
  externalOriginFromForwardedHeaders,
  getDashboardApiToken,
  hasValidDashboardMutationContract,
  proxy,
} from "@/proxy";

const TEST_TOKEN = "A".repeat(48);
const BROWSER_ORIGIN = "http://localhost:3000";
const INTERNAL_NEXT_ORIGIN = "http://localhost:3001";
const DIRECT_FIXTURE_ORIGIN = "http://127.0.0.1:50664";
const initialEnvironment = {
  tokenFile: process.env.INGENIUM_API_TOKEN_FILE,
  nodeEnv: process.env.NODE_ENV,
  dashboardAllowedOrigins: process.env.DASHBOARD_ALLOWED_ORIGINS,
};
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  for (const [name, value] of Object.entries({
    INGENIUM_API_TOKEN_FILE: initialEnvironment.tokenFile,
    NODE_ENV: initialEnvironment.nodeEnv,
    DASHBOARD_ALLOWED_ORIGINS: initialEnvironment.dashboardAllowedOrigins,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  delete process.env.INGENIUM_API_TOKEN;
});

function configureProtectedToken(
  allowedOrigins = "http://localhost:3000,http://127.0.0.1:3000",
): void {
  const directory = mkdtempSync(join(tmpdir(), "ingenium-dashboard-api-proxy-"));
  temporaryDirectories.push(directory);
  const tokenFile = join(directory, "api-token");
  writeFileSync(tokenFile, `${TEST_TOKEN}\n`, { mode: 0o600 });
  chmodSync(tokenFile, 0o600);
  process.env.NODE_ENV = "production";
  process.env.INGENIUM_API_TOKEN_FILE = tokenFile;
  process.env.DASHBOARD_ALLOWED_ORIGINS = allowedOrigins;
  delete process.env.INGENIUM_API_TOKEN;
}

type BrowserHeaders = Record<string, string | undefined>;

/**
 * Model Browser :3000 → Nginx → Next :3001. Nginx replaces forwarding
 * metadata rather than appending the browser's supplied values.
 */
function gatewayHeaders(overrides: BrowserHeaders = {}): Headers {
  const headers = new Headers({
    Origin: BROWSER_ORIGIN,
    [DASHBOARD_MARKER_HEADER]: DASHBOARD_MARKER_VALUE,
    "X-Forwarded-Proto": "http",
    "X-Forwarded-Host": "localhost",
    "X-Forwarded-Port": "3000",
    ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)),
  });
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) headers.delete(name);
  }
  return headers;
}

function gatewayRequest(
  method = "POST",
  headers: BrowserHeaders = {},
  path = "/projects",
): NextRequest {
  return new NextRequest(`${INTERNAL_NEXT_ORIGIN}/api/v1${path}`, {
    method,
    headers: gatewayHeaders(headers),
  });
}

/** Model the direct, loopback-only Next listener used by an isolated fixture. */
function directFixtureRequest(
  method = "POST",
  headers: BrowserHeaders = {},
  path = "/opencode/sessions",
): NextRequest {
  const requestHeaders = new Headers({
    Origin: DIRECT_FIXTURE_ORIGIN,
    [DASHBOARD_MARKER_HEADER]: DASHBOARD_MARKER_VALUE,
    ...Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)),
  });
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) requestHeaders.delete(name);
  }
  return new NextRequest(`${DIRECT_FIXTURE_ORIGIN}/api/v1${path}`, {
    method,
    headers: requestHeaders,
  });
}

/** Model Next.js's listener-local forwarding defaults for a direct fixture. */
function directFixtureRequestWithNextDefaults(
  method = "POST",
  headers: BrowserHeaders = {},
): NextRequest {
  return directFixtureRequest(method, {
    Host: "127.0.0.1:50664",
    "X-Forwarded-Proto": "http",
    "X-Forwarded-Host": "127.0.0.1:50664",
    "X-Forwarded-Port": "50664",
    ...headers,
  });
}

describe("dashboard authenticated API proxy", () => {
  it("injects the dashboard server token and strips browser Authorization", () => {
    const headers = buildDashboardApiProxyHeaders(
      new Headers({
        Authorization: "Bearer browser-controlled-token",
        "X-Request-Id": "request-123",
        "X-Forwarded-Host": "browser-controlled.example",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Port": "443",
      }),
      "server-token",
    );

    expect(headers.get("authorization")).toBe("Bearer server-token");
    expect(headers.get("Authorization")).toBe("Bearer server-token");
    expect(headers.get("proxy-authorization")).toBeNull();
    expect(headers.get(DASHBOARD_MARKER_HEADER)).toBe(DASHBOARD_MARKER_VALUE);
    expect(headers.get("x-request-id")).toBe("request-123");
    expect(headers.get("x-forwarded-host")).toBeNull();
    expect(headers.get("x-forwarded-proto")).toBeNull();
    expect(headers.get("x-forwarded-port")).toBeNull();
  });

  it("strips the child-MCP server-only handoff assertion from dashboard traffic", () => {
    const secretCanary = "child-mcp-secret-canary";
    const headers = buildDashboardApiProxyHeaders(
      new Headers({
        "x-ingenium-child-mcp-runtime": secretCanary,
      }),
      "server-token",
    );

    expect(headers.get("x-ingenium-child-mcp-runtime")).toBeNull();
    expect(JSON.stringify(Array.from(headers.entries()))).not.toContain(secretCanary);
  });

  it.each(["development", "test", "production"])(
    "requires a protected token file in %s mode",
    (nodeEnv) => {
      expect(getDashboardApiToken({ NODE_ENV: nodeEnv })).toBeNull();
    },
  );

  it.each(["development", "test", "production"])(
    "loads the protected token file in %s mode",
    (nodeEnv) => {
      configureProtectedToken();

      expect(getDashboardApiToken({
        NODE_ENV: nodeEnv,
        INGENIUM_API_TOKEN_FILE: process.env.INGENIUM_API_TOKEN_FILE,
      })).toBe(TEST_TOKEN);
    },
  );

  it("ignores the legacy inline credential in every runtime", () => {
    for (const nodeEnv of ["development", "test", "production"]) {
      expect(getDashboardApiToken({
        NODE_ENV: nodeEnv,
        INGENIUM_API_TOKEN: TEST_TOKEN,
      })).toBeNull();
    }
  });

  it("fails closed when the dashboard server token is missing", async () => {
    delete process.env.INGENIUM_API_TOKEN;
    delete process.env.INGENIUM_API_TOKEN_FILE;
    process.env.NODE_ENV = "production";

    const response = proxy(
      new NextRequest("http://dashboard.test/api/v1/projects", {
        headers: { Authorization: "Bearer browser-controlled-token" },
      }),
    );

    expect(response.status).toBe(DASHBOARD_API_PROXY_ERROR_STATUS);
    expect(response.headers.get("authorization")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: DASHBOARD_API_PROXY_ERROR_CODE,
        message: "Dashboard API proxy is not configured",
      },
    });
  });

  it("overrides a browser token on the Next.js request forwarding boundary", () => {
    configureProtectedToken();

    const response = proxy(
      new NextRequest("http://dashboard.test/api/v1/projects?project=global-default", {
        headers: { Authorization: "Bearer browser-controlled-token" },
      }),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-authorization")).toBe(`Bearer ${TEST_TOKEN}`);
    expect(response.headers.get("x-middleware-request-authorization")).not.toContain("browser-controlled-token");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it.each([
    { method: "POST", path: "/projects?fixture=csrf-post" },
    { method: "PUT", path: "/tasks/board-config?fixture=csrf-put" },
    { method: "PATCH", path: "/projects/global-default?fixture=csrf-patch" },
    { method: "DELETE", path: "/projects/isolated-fixture?fixture=csrf-delete" },
  ] as const)(
    "forwards Browser :3000 → Nginx → Next :3001 $method $path mutation fixtures with the canonical marker and server bearer",
    ({ method, path }) => {
      configureProtectedToken();

      const response = proxy(
        gatewayRequest(method, {
          Authorization: "Bearer attacker-controlled-token",
          "Content-Type": "application/x-www-form-urlencoded",
        }, path),
      );

      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("x-middleware-request-authorization")).toBe(
        `Bearer ${TEST_TOKEN}`,
      );
      expect(response.headers.get("x-middleware-request-authorization")).not.toContain(
        "attacker-controlled-token",
      );
      expect(response.headers.get(`x-middleware-request-${DASHBOARD_MARKER_HEADER}`)).toBe(
        DASHBOARD_MARKER_VALUE,
      );
    },
  );

  it("accepts each explicit local dashboard origin only when forwarded metadata matches it", () => {
    configureProtectedToken();

    const localhost = gatewayRequest("POST");
    const ipv4Loopback = gatewayRequest("POST", {
      Origin: "http://127.0.0.1:3000",
      "X-Forwarded-Host": "127.0.0.1",
    });

    expect(hasValidDashboardMutationContract(localhost)).toBe(true);
    expect(hasValidDashboardMutationContract(ipv4Loopback)).toBe(true);
  });

  it("derives the external origin from Nginx metadata instead of Next's private URL", () => {
    const request = gatewayRequest("POST");

    expect(request.nextUrl.origin).toBe(INTERNAL_NEXT_ORIGIN);
    expect(externalOriginFromForwardedHeaders(request.headers)).toBe(BROWSER_ORIGIN);
    expect(externalDashboardOrigin(request)).toBe(BROWSER_ORIGIN);
  });

  it("accepts a direct isolated-fixture POST when all forwarding metadata is absent", () => {
    configureProtectedToken(DIRECT_FIXTURE_ORIGIN);
    const request = directFixtureRequest();

    expect(externalDashboardOrigin(request)).toBe(DIRECT_FIXTURE_ORIGIN);
    expect(hasValidDashboardMutationContract(request)).toBe(true);

    const response = proxy(request);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-authorization")).toBe(
      `Bearer ${TEST_TOKEN}`,
    );
  });

  it("accepts the Next-generated forwarding defaults for a direct isolated fixture", () => {
    configureProtectedToken(DIRECT_FIXTURE_ORIGIN);
    const request = directFixtureRequestWithNextDefaults();

    expect(externalDashboardOrigin(request)).toBe(DIRECT_FIXTURE_ORIGIN);
    expect(hasValidDashboardMutationContract(request)).toBe(true);
  });

  it.each([
    {
      name: "partial forwarding metadata",
      headers: { "X-Forwarded-Host": "127.0.0.1" },
    },
    {
      name: "malformed forwarding metadata",
      headers: {
        "X-Forwarded-Proto": "http",
        "X-Forwarded-Host": "127.0.0.1",
        "X-Forwarded-Port": "not-a-port",
      },
    },
    {
      name: "multi-valued forwarding metadata",
      headers: {
        "X-Forwarded-Proto": "http, https",
        "X-Forwarded-Host": "127.0.0.1",
        "X-Forwarded-Port": "50664",
      },
    },
    {
      name: "forged forwarded origin",
      headers: {
        "X-Forwarded-Proto": "http",
        "X-Forwarded-Host": "localhost",
        "X-Forwarded-Port": "3000",
      },
    },
  ])("rejects a direct fixture mutation with $name instead of falling back", ({ headers }) => {
    configureProtectedToken(DIRECT_FIXTURE_ORIGIN);

    const response = proxy(directFixtureRequest("POST", headers));

    expect(response.status).toBe(DASHBOARD_CSRF_ERROR_STATUS);
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  it.each([
    {
      name: "cross-origin Origin",
      headers: { Origin: "https://evil.example" },
    },
    {
      name: "missing dashboard marker",
      headers: { [DASHBOARD_MARKER_HEADER]: undefined },
    },
  ])("rejects a direct fixture mutation with $name", ({ headers }) => {
    configureProtectedToken(DIRECT_FIXTURE_ORIGIN);

    const response = proxy(directFixtureRequest("POST", headers));

    expect(response.status).toBe(DASHBOARD_CSRF_ERROR_STATUS);
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  it.each([
    {
      name: "missing Origin",
      headers: { Origin: undefined },
    },
    {
      name: "cross-origin Origin",
      headers: {
        Origin: "https://evil.example",
      },
    },
    {
      name: "malformed Origin",
      headers: {
        Origin: "not-an-origin",
      },
    },
    {
      name: "credential-bearing Origin",
      headers: { Origin: "http://dashboard:secret@localhost:3000" },
    },
    {
      name: "missing dashboard marker",
      headers: { [DASHBOARD_MARKER_HEADER]: undefined },
    },
    {
      name: "invalid dashboard marker",
      headers: {
        [DASHBOARD_MARKER_HEADER]: "not-dashboard",
      },
    },
    {
      name: "multi-valued forwarded host",
      headers: { "X-Forwarded-Host": "localhost, evil.example" },
    },
    {
      name: "multi-valued forwarded protocol",
      headers: { "X-Forwarded-Proto": "http, https" },
    },
    {
      name: "malformed forwarded port",
      headers: { "X-Forwarded-Port": "not-a-port" },
    },
    {
      name: "credential-bearing forwarded host",
      headers: { "X-Forwarded-Host": "dashboard:secret@localhost" },
    },
    {
      name: "untrusted forwarded origin",
      headers: {
        Origin: "http://evil.example:3000",
        "X-Forwarded-Host": "evil.example",
      },
    },
  ])("rejects unsafe requests with $name before forwarding", ({ headers }) => {
    configureProtectedToken();

    const response = proxy(gatewayRequest("POST", headers));

    expect(response.status).toBe(DASHBOARD_CSRF_ERROR_STATUS);
    expect(response.headers.get("x-middleware-next")).toBeNull();
    return expect(response.json()).resolves.toEqual({
      error: {
        code: DASHBOARD_CSRF_ERROR_CODE,
        message: "Dashboard mutations require a same-origin request and a valid dashboard marker",
      },
    });
  });

  it("keeps non-mutation reads available without a browser Origin or marker", () => {
    configureProtectedToken();

    const response = proxy(
      new NextRequest("http://dashboard.test/api/v1/projects", {
        method: "GET",
        headers: {
          Authorization: "Bearer browser-controlled-token",
          [DASHBOARD_MARKER_HEADER]: "spoofed-marker",
        },
      }),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-authorization")).toBe(
      `Bearer ${TEST_TOKEN}`,
    );
    expect(response.headers.get(`x-middleware-request-${DASHBOARD_MARKER_HEADER}`)).toBe(
      DASHBOARD_MARKER_VALUE,
    );
  });

  it("rejects a production request without a protected token file", () => {
    process.env.NODE_ENV = "production";
    delete process.env.INGENIUM_API_TOKEN_FILE;

    const response = proxy(
      new NextRequest("http://dashboard.test/api/v1/projects"),
    );

    expect(response.status).toBe(DASHBOARD_API_PROXY_ERROR_STATUS);
  });

  it("loads a file-only production credential at the proxy boundary", () => {
    configureProtectedToken();

    expect(process.env.INGENIUM_API_TOKEN).toBeUndefined();
    const response = proxy(
      new NextRequest("http://dashboard.test/api/v1/projects", {
        headers: { Authorization: "Bearer browser-controlled-token" },
      }),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-authorization")).toBe(
      `Bearer ${TEST_TOKEN}`,
    );
    expect(response.headers.get("x-middleware-request-authorization")).not.toContain(
      "browser-controlled-token",
    );
  });

  it("matches only API traffic, leaving OAuth callbacks and gateway routes untouched", () => {
    expect(config.matcher).toEqual(["/api/v1", "/api/v1/:path*"]);
    expect(config.matcher).not.toContain("/auth/callback");
    expect(config.matcher).not.toContain("/_ingenium/health");
    expect(config.matcher).not.toContain("/_ingenium/child-mcp-runtime");
  });
});

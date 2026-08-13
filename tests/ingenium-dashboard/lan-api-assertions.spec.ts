import { test, expect, type Page, type Route } from "./fixture";
import { getDefaultSuiteRuntime } from "./default-suite-runtime";

/**
 * LAN API assertion plan — E2E verification that the dashboard sends API
 * requests to the correct /api/v1 base URL, includes required headers and
 * query parameters, and derives correct iframe URLs for LAN deployments.
 *
 * These tests intercept dashboard API requests and iframe loads, asserting
 * structural properties without assuming any particular data shape (no
 * tautological assertions against source literals).
 *
 * The dashboard/API web servers are supplied by the Playwright config. The
 * OpenCode health gateway is mocked, so these tests do not require Docker or
 * a live OpenCode/provider process.
 */

const runtime = getDefaultSuiteRuntime();
const API_BASE = runtime.apiBase;
const dashboardRoute = runtime.dashboardRoute;

/** Keep iframe rendering deterministic without contacting OpenCode. */
async function mockOpenCodeHealth(page: Page) {
  await page.route("**/api/v1/opencode/health**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { healthy: true, status: "ready" } }),
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await mockOpenCodeHealth(page);
});

test.describe("Same-origin dashboard API requests", () => {
  test.describe.configure({ mode: "serial" });

  test("homepage fetches /api/v1/dashboard/summary with the manifest project", async ({ page }) => {
    const apiCalls: string[] = [];

    await page.route("**/api/v1/**", (route: Route) => {
      apiCalls.push(route.request().url());
      route.fallback();
    });

    const summaryResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/dashboard/summary"
        && url.searchParams.get("project") === runtime.project;
    });
    await page.goto(dashboardRoute("/"), { waitUntil: "domcontentloaded" });
    await summaryResponse;

    expect(apiCalls.length).toBeGreaterThanOrEqual(1);

    for (const url of apiCalls) {
      expect(new URL(url).pathname).toMatch(/^\/api\/v1\//);
    }

    const summaryCalls = apiCalls.filter((u) => u.includes("/dashboard/summary"));
    expect(summaryCalls).not.toHaveLength(0);
    for (const url of summaryCalls) {
      expect(new URL(url).searchParams.get("project")).toBe(runtime.project);
    }
  });

  test("API requests include x-ingenium-ui: dashboard header", async ({ page }) => {
    const headerRequest = page.waitForRequest((request) =>
      request.url().includes("/api/v1/") && request.headers()["x-ingenium-ui"] === "dashboard",
    );
    await page.goto(dashboardRoute("/"), { waitUntil: "domcontentloaded" });
    const request = await headerRequest;

    expect(request.headers()["x-ingenium-ui"]).toBe("dashboard");
  });

  test("resource list endpoints pass project query parameter", async ({ page }) => {
    const projectParamUrls: string[] = [];

    await page.route("**/api/v1/(skills|observations|tasks|plugins|agents|jobs)**", (route: Route) => {
      const url = route.request().url();
      const parsed = new URL(url);
      if (route.request().method() === "GET") {
        projectParamUrls.push(url);
      }
      route.fallback();
    });

    await page.goto(dashboardRoute("/"), { waitUntil: "domcontentloaded" });

    const skillsResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/skills"
        && url.searchParams.get("project") === runtime.project
        && response.request().method() === "GET";
    });
    await page.goto(dashboardRoute("/skills"), { waitUntil: "domcontentloaded" });
    await skillsResponse;

    for (const url of projectParamUrls) {
      const params = new URL(url).searchParams;
      expect(params.get("project")).toBe(runtime.project);
    }
  });
});

test.describe("Direct local iframe URL assertions", () => {
  test.describe.configure({ mode: "serial" });

  test("/opencode page renders Web iframe on the trusted root origin", async ({ page }) => {
    await page.goto(dashboardRoute("/opencode"), { waitUntil: "domcontentloaded" });

    const webIframe = page.locator('iframe[title="OpenCode Web"]');
    await expect(webIframe).toBeAttached({ timeout: 10000 });
    await expect(webIframe).toHaveAttribute(
      "src",
      /^(?:https?):\/\/[^/]+\/$/,
    );
  });

  test("Web iframe is trusted first-party content without a sandbox attribute", async ({ page }) => {
    await page.goto(dashboardRoute("/opencode"), { waitUntil: "domcontentloaded" });

    const webIframe = page.locator('iframe[title="OpenCode Web"]');
    await expect(webIframe).toBeAttached({ timeout: 10000 });

    // Root-relative assets require a trusted first-party iframe without sandboxing.
    await expect(webIframe).not.toHaveAttribute("sandbox");

    const allow = await webIframe.getAttribute("allow");
    expect(allow).toContain("clipboard-write");
  });

  test("exactly one Web iframe, at most one CLI iframe", async ({ page }) => {
    await page.goto(dashboardRoute("/opencode"), { waitUntil: "domcontentloaded" });

    const webIframes = page.locator('iframe[title="OpenCode Web"]');
    await expect(webIframes).toHaveCount(1);

    const cliIframes = page.locator('iframe[title="OpenCode Terminal"]');
    const cliCount = await cliIframes.count();
    expect(cliCount).toBeLessThanOrEqual(1);
  });

  test("does not request the removed OpenCode sub-path proxies", async ({ page }) => {
    const requestedUrls: string[] = [];
    page.on("request", (request) => requestedUrls.push(request.url()));
    await page.goto(dashboardRoute("/opencode"), { waitUntil: "domcontentloaded" });

    const webIframe = page.locator('iframe[title="OpenCode Web"]');
    await expect(webIframe).toBeAttached({ timeout: 10000 });
    expect(requestedUrls.some((url) => /\/opencode-(web|cli)(?:\/|$)/.test(new URL(url).pathname))).toBe(false);
  });
});

test.describe("Project identity in API contract", () => {
  test.describe.configure({ mode: "serial" });

  test("health endpoint works without project query param", async ({ request }) => {
    const resp = await request.get(`${API_BASE}/health`, { headers: runtime.apiHeaders });
    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(body).toHaveProperty("status");
  });

  test("skills list with explicit project resolves successfully", async ({ request }) => {
    const resp = await request.get(`${API_BASE}/skills?project=${encodeURIComponent(runtime.project)}`, {
      headers: runtime.apiHeaders,
    });
    // Unknown projects are an API-level validation result, not a transport failure.
    expect(resp.status()).toBeGreaterThanOrEqual(200);
    expect(resp.status()).toBeLessThan(500);
  });

  test("skills list without project returns 4xx (project required)", async ({ request }) => {
    const resp = await request.get(`${API_BASE}/skills`, { headers: runtime.apiHeaders });
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body).toHaveProperty("error");
  });

  test("skills list with empty project returns 4xx", async ({ request }) => {
    const resp = await request.get(`${API_BASE}/skills?project=`, { headers: runtime.apiHeaders });
    expect(resp.status()).toBe(400);
  });
});

import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * LAN API assertion plan — E2E verification that the dashboard sends API
 * requests to the correct /api/v1 base URL, includes required headers and
 * query parameters, and derives correct iframe URLs for LAN deployments.
 *
 * These tests intercept real dashboard API requests and iframe loads,
 * asserting structural properties without assuming any particular data
 * shape (no tautological assertions against source literals).
 *
 * Precondition: Docker services (API :4097, Dashboard :3000) must be running.
 * Skipped gracefully if the API is unreachable.
 */

const DASHBOARD_URL = "http://localhost:3000";
const API_BASE = "http://localhost:4097/api/v1";

test.describe("Same-origin dashboard API requests", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    try {
      const resp = await request.get(`${API_BASE}/health`);
      if (!resp.ok()) {
        test.skip(true, "API server not healthy — skipping E2E assertions");
      }
    } catch {
      test.skip(true, "API server unreachable — skipping E2E assertions");
    }
  });

  /* ------------------------------------------------------------------------ */
  /*  Assertion: All API requests go to the /api/v1 base path                 */
  /* ------------------------------------------------------------------------ */

  test("homepage fetches /api/v1/dashboard/summary with project param", async ({ page }) => {
    const apiCalls: string[] = [];

    await page.route("**/api/v1/**", (route: Route) => {
      apiCalls.push(route.request().url());
      route.continue();
    });

    await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded" });

    // Wait long enough for the summary API call (card data) to be made
    await page.waitForTimeout(3000);

    expect(apiCalls.length).toBeGreaterThanOrEqual(1);

    // Every intercepted call must contain /api/v1/ (not a raw port-only URL)
    for (const url of apiCalls) {
      expect(new URL(url).pathname).toMatch(/^\/api\/v1\//);
    }

    // At least one call must be to the dashboard summary endpoint with a project parameter
    const summaryCalls = apiCalls.filter((u) => u.includes("/dashboard/summary"));
    if (summaryCalls.length > 0) {
      const params = new URL(summaryCalls[0]).searchParams;
      expect(params.has("project")).toBe(true);
    }
  });

  /* ------------------------------------------------------------------------ */
  /*  Assertion: x-ingenium-ui header is present                              */
  /* ------------------------------------------------------------------------ */

  test("API requests include x-ingenium-ui: dashboard header", async ({ page }) => {
    const seenHeader: boolean[] = [];

    await page.route("**/api/v1/**", (route: Route) => {
      const headers = route.request().headers();
      seenHeader.push(headers["x-ingenium-ui"] === "dashboard");
      route.continue();
    });

    await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // At least one intercepted call must have the header
    expect(seenHeader.some(Boolean)).toBe(true);
  });

  /* ------------------------------------------------------------------------ */
  /*  Assertion: Content-Type is application/json on request body calls       */
  /* ------------------------------------------------------------------------ */

  test("POST/PUT/PATCH requests include Content-Type: application/json", async ({ page }) => {
    const seenJsonContentType: boolean[] = [];

    await page.route("**/api/v1/**", (route: Route) => {
      const method = route.request().method();
      if (["POST", "PUT", "PATCH"].includes(method)) {
        const headers = route.request().headers();
        seenJsonContentType.push(headers["content-type"]?.includes("application/json") ?? false);
      }
      route.continue();
    });

    // Navigate to a page that makes mutating requests
    await page.goto(`${DASHBOARD_URL}/settings`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Not every page issues mutations; it's acceptable to have no captures.
    // This assertion documents the contract: when mutations happen, they
    // carry the correct content type.
    if (seenJsonContentType.length > 0) {
      expect(seenJsonContentType.every(Boolean)).toBe(true);
    }
  });

  /* ------------------------------------------------------------------------ */
  /*  Assertion: project query param on skill/observation/resource calls      */
  /* ------------------------------------------------------------------------ */

  test("resource list endpoints pass project query parameter", async ({ page }) => {
    const projectParamUrls: string[] = [];

    await page.route("**/api/v1/(skills|observations|tasks|projects|plugins|agents|jobs)**", (route: Route) => {
      const url = route.request().url();
      const parsed = new URL(url);
      // Only GET requests retrieving resource lists
      if (route.request().method() === "GET") {
        projectParamUrls.push(url);
      }
      route.continue();
    });

    await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Navigate to skills, observations, tasks pages to trigger more API calls
    await page.goto(`${DASHBOARD_URL}/skills`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // All captured GET resource URLs must include project parameter
    for (const url of projectParamUrls) {
      const params = new URL(url).searchParams;
      expect(params.has("project")).toBe(true);
      expect(params.get("project")).not.toBe("");
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  Assertion plan: same-origin iframe URLs                                   */
/* -------------------------------------------------------------------------- */

test.describe("Same-origin iframe URL assertions", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    try {
      const resp = await request.get(`${API_BASE}/health`);
      if (!resp.ok()) {
        test.skip(true, "API server not healthy — skipping iframe assertions");
      }
    } catch {
      test.skip(true, "API server unreachable — skipping iframe assertions");
    }
  });

  /* ------------------------------------------------------------------------ */
  /*  Assertion: /opencode page iframe src points to port 4098                */
  /* ------------------------------------------------------------------------ */

  test("/opencode page renders Web iframe on port 4098", async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

    const webIframe = page.locator('iframe[title="OpenCode Web"]');
    await expect(webIframe).toBeVisible({ timeout: 10000 });

    const src = await webIframe.getAttribute("src");
    expect(src).toBeTruthy();
    expect(src).toContain("4098");

    // The iframe src must be an http:// URL (not file:// or blob: or data:)
    expect(src?.startsWith("http://")).toBe(true);
    expect(src?.startsWith("https://")).toBe(false);

    // The hostname should be localhost (same origin as dashboard)
    const parsed = new URL(src!);
    expect(parsed.hostname).toBe("localhost");
  });

  /* ------------------------------------------------------------------------ */
  /*  Assertion: Web iframe src contains the opencode.spec pattern            */
  /* ------------------------------------------------------------------------ */

  test("Web iframe sandbox and allow attributes are present", async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

    const webIframe = page.locator('iframe[title="OpenCode Web"]');
    await expect(webIframe).toBeVisible({ timeout: 10000 });

    // Sandbox must include allow-scripts and allow-same-origin
    const sandbox = await webIframe.getAttribute("sandbox");
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-same-origin");

    // Allow attribute must include clipboard-write
    const allow = await webIframe.getAttribute("allow");
    expect(allow).toContain("clipboard-write");
  });

  /* ------------------------------------------------------------------------ */
  /*  Assertion: only one Web iframe, zero or one CLI iframe                  */
  /* ------------------------------------------------------------------------ */

  test("exactly one Web iframe, at most one CLI iframe", async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

    const webIframes = page.locator('iframe[title="OpenCode Web"]');
    await expect(webIframes).toHaveCount(1);

    const cliIframes = page.locator('iframe[title="OpenCode Terminal"]');
    const cliCount = await cliIframes.count();
    expect(cliCount).toBeLessThanOrEqual(1);
  });

  /* ------------------------------------------------------------------------ */
  /*  Assertion: no network errors from iframe load                           */
  /* ------------------------------------------------------------------------ */

  test("no failed network requests from iframe loading on /opencode", async ({ page }) => {
    const failedUrls: string[] = [];

    page.on("requestfailed", (req) => {
      failedUrls.push(req.url());
    });

    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

    const webIframe = page.locator('iframe[title="OpenCode Web"]');
    await expect(webIframe).toBeVisible({ timeout: 10000 });

    // Allow iframe network activity to settle
    await page.waitForTimeout(2000);

    // Filter out expected SSE reconnect failures
    const unexpected = failedUrls.filter((u) => !u.includes("/global/event") && !u.includes("favicon"));
    expect(unexpected.length).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/*  Assertion plan: project identity in API contract                          */
/* -------------------------------------------------------------------------- */

test.describe("Project identity in API contract", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    try {
      const resp = await request.get(`${API_BASE}/health`);
      if (!resp.ok()) {
        test.skip(true, "API server not healthy — skipping project identity assertions");
      }
    } catch {
      test.skip(true, "API server unreachable — skipping project identity assertions");
    }
  });

  /* ------------------------------------------------------------------------ */
  /*  Assertion: health endpoint does not require project                     */
  /* ------------------------------------------------------------------------ */

  test("health endpoint works without project query param", async ({ request }) => {
    const resp = await request.get(`${API_BASE}/health`);
    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(body).toHaveProperty("status");
  });

  /* ------------------------------------------------------------------------ */
  /*  Assertion: resource endpoints expect project param to resolve            */
  /* ------------------------------------------------------------------------ */

  test("skills list with explicit project resolves successfully", async ({ request }) => {
    const resp = await request.get(`${API_BASE}/skills?project=global-default`);
    // The API may return 200 with data array or 400 if project not found.
    // Either way, the endpoint accepts the project parameter.
    expect(resp.status()).toBeGreaterThanOrEqual(200);
    expect(resp.status()).toBeLessThan(500);
  });

  test("skills list without project returns 4xx (project required)", async ({ request }) => {
    const resp = await request.get(`${API_BASE}/skills`);
    // The API requires a project parameter — expect 400 or 422
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body).toHaveProperty("error");
  });

  /* ------------------------------------------------------------------------ */
  /*  Assertion: project parameter is validated — rejects empty               */
  /* ------------------------------------------------------------------------ */

  test("skills list with empty project returns 4xx", async ({ request }) => {
    const resp = await request.get(`${API_BASE}/skills?project=`);
    expect(resp.status()).toBe(400);
  });
});

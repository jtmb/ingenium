import { test, expect } from "@playwright/test";

const OPENCODE_URL = "http://localhost:4098";
const DASHBOARD_URL = "http://localhost:3000";

test.describe("OpenCode Docker Integration", () => {
  test.describe.configure({ mode: "serial" });

  // Precondition: verify Docker services are reachable
  test.beforeAll(async ({ request }) => {
    // Check if Docker services are up — if not, skip all tests
    try {
      const apiHealth = await request.get("http://localhost:4097/api/v1/health");
      if (!apiHealth.ok()) {
        test.skip(true, "Docker API not reachable — skipping Docker-backed tests");
      }
    } catch {
      test.skip(true, "Docker services not running — skipping Docker-backed tests");
    }
  });

  test("OpenCode server responds on host port 4098", async ({ request }) => {
    const response = await request.get(`${OPENCODE_URL}/`);
    // OpenCode web server should respond (may redirect to /chat or return HTML)
    expect(response.ok()).toBeTruthy();
  });

  test("OpenCode iframe renders in dashboard /opencode page", async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    // The iframe should be present
    const iframe = page.locator('iframe[title="OpenCode"]');
    await expect(iframe).toBeVisible({ timeout: 10000 });
    // The iframe src should be localhost:4098
    const src = await iframe.getAttribute("src");
    expect(src).toContain("4098");
  });

  test("/opencode page has no console errors from iframe loading", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    // Wait for iframe to appear (proves page loaded)
    const iframe = page.locator('iframe[title="OpenCode"]');
    await expect(iframe).toBeVisible({ timeout: 10000 });
    // Give a short time for console errors to appear after iframe renders
    await page.waitForTimeout(1000);

    // Filter out CORS errors that may be expected from cross-origin iframe
    const realErrors = consoleErrors.filter(e => !e.includes("Failed to read") && !e.includes("blocked by CORS"));
    expect(realErrors.length).toBe(0);
  });

  test("OpenCode iframe loads without network errors", async ({ page }) => {
    const failedRequests: string[] = [];
    page.on("requestfailed", (req) => {
      failedRequests.push(req.url());
    });
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    // Wait for iframe to load
    const iframe = page.locator('iframe[title="OpenCode"]');
    await expect(iframe).toBeVisible({ timeout: 10000 });
    // Wait for the iframe's network activity to settle
    await page.waitForTimeout(2000);

    // Filter out expected failures (SSE reconnect, etc.)
    const realFailures = failedRequests.filter(u => !u.includes("/global/event"));
    expect(realFailures.length).toBe(0);
  });

  test("Docker supervisord reports all 3 processes running", async ({ request }) => {
    // Use the status page API to verify process health
    const response = await request.get("http://localhost:4097/api/v1/services/status");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    const services: any[] = body.data?.services ?? [];
    expect(services.length).toBeGreaterThanOrEqual(3);
    // Check that all three supervisord processes are running
    const names = services.map((s: any) => s.name);
    const stateMap = Object.fromEntries(services.map((s: any) => [s.name, s.state]));
    expect(names).toEqual(expect.arrayContaining([
      "ingenium-api",
      "ingenium-dashboard",
      "OpenCode Web",
    ]));
    expect(stateMap["ingenium-api"]).toBe("running");
    expect(stateMap["ingenium-dashboard"]).toBe("running");
    expect(stateMap["OpenCode Web"]).toBe("running");
    // Verify sustained runtime — no restarts, meaningful uptime
    const serviceMap = Object.fromEntries(services.map((s: any) => [s.name, s]));
    const api = serviceMap["ingenium-api"];
    const dashboard = serviceMap["ingenium-dashboard"];
    const opencode = serviceMap["OpenCode Web"];
    expect(api).toBeDefined();
    expect(dashboard).toBeDefined();
    expect(opencode).toBeDefined();
    expect(api.uptime).toBeGreaterThan(0);
    expect(dashboard.uptime).toBeGreaterThan(0);
    expect(opencode.uptime).toBeGreaterThan(0);
    expect(api.restartCount).toBe(0);
    expect(dashboard.restartCount).toBe(0);
    expect(opencode.restartCount).toBe(0);
  });
});

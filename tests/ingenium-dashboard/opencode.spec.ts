import { expect, test } from "./external-suite-navigation-governor";
import type { Page } from "@playwright/test";

const OPENCODE_WEB_URL = process.env.INGENIUM_E2E_OPENCODE_WEB_URL ?? "http://opencode.localhost:3000";

test.describe("OpenCode deterministic browser contract", () => {
  test.describe.configure({ mode: "serial" });

  // The health and iframe origins are mocked so these assertions cover the
  // dashboard contract without Docker, OpenCode, ttyd, or a provider.
  test.beforeEach(async ({ page }) => {
    await mockOpenCode(page);
  });

  async function mockOpenCode(page: Page): Promise<void> {
    await page.route("**/api/v1/opencode/health**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { healthy: true, status: "ready" } }),
      }),
    );
    await page.route(
      /^(?:http:\/\/localhost:(?:4098|4099)|http:\/\/(?:opencode|cli)\.localhost:3000)\/.*$/,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>OpenCode fixture</title>",
        }),
    );
  }

  test("OpenCode iframe renders in dashboard /opencode page", async ({ page }) => {
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    const webIframe = page.locator('iframe[title="OpenCode Web"]');
    await expect(webIframe).toBeVisible({ timeout: 10000 });
    // The URL is supplied by the selected runtime profile.
    const src = await webIframe.getAttribute("src");
    expect(src).toBe(`${OPENCODE_WEB_URL}/`);

    const cliIframe = page.locator('iframe[title="OpenCode Terminal"]');
    const cliCount = await cliIframe.count();
    expect(cliCount).toBeLessThanOrEqual(1);
  });

  test("/opencode page has no console errors from iframe loading", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    const webIframe = page.locator('iframe[title="OpenCode Web"]');
    await expect(webIframe).toBeVisible({ timeout: 10000 });
    const hydrationErrors = consoleErrors.filter(e => /hydrat|did not match|418|text content/i.test(e));
    expect(hydrationErrors, "Zero hydration errors — SSR/client DOM must match").toEqual([]);

    // Next dev mode emits this CSP diagnostic for its own eval-based stack
    // traces. It is unrelated to the iframe; every other browser error must
    // still fail the test rather than being swallowed.
    const unexpectedErrors = consoleErrors.filter(
      (message) => !message.startsWith("eval() is not supported in this environment."),
    );
    expect(unexpectedErrors).toEqual([]);
  });

  test("OpenCode iframe loads without network errors", async ({ page }) => {
    const failedRequests: string[] = [];
    page.on("requestfailed", (req) => {
      failedRequests.push(req.url());
    });
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    const webIframe = page.locator('iframe[title="OpenCode Web"]');
    await expect(webIframe).toBeVisible({ timeout: 10000 });
    expect(failedRequests).toEqual([]);
  });
});

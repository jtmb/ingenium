import { expect, test } from "./external-suite-navigation-governor";
import type { Page } from "@playwright/test";

const WEB_IFRAME = 'iframe[title="OpenCode Web"]';
const CLI_IFRAME = 'iframe[title="OpenCode Terminal"]';
const SWITCH_TO_CLI = 'button[aria-label="Switch to CLI mode"]';
const SWITCH_TO_WEB = 'button[aria-label="Switch to Web mode"]';

test.describe("OpenCode Web/CLI Mode Switch", () => {
  test.describe.configure({ mode: "serial" });

  // The health gateway is mocked so mode behavior can be exercised against a
  // local dashboard without requiring Docker or an OpenCode/provider process.
  test.beforeEach(async ({ page }) => {
    await mockOpenCodeHealth(page);
    await mockOpenCodeFrames(page);
  });

  async function mockOpenCodeHealth(page: Page) {
    await page.route("**/api/v1/opencode/health**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { healthy: true, status: "ready" } }),
      }),
    );
  }

  async function mockOpenCodeFrames(page: Page) {
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

  test("initial state: Web iframe visible, CLI iframe not yet mounted", async ({ page }) => {
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });

    const webFrame = page.locator(WEB_IFRAME);
    await expect(webFrame).toBeAttached({ timeout: 10000 });

    const webOpacity = await webFrame.evaluate((el) => window.getComputedStyle(el).opacity);
    const webVisibility = await webFrame.evaluate((el) => window.getComputedStyle(el).visibility);
    expect(webOpacity).toBe("1");
    expect(webVisibility).toBe("visible");

    await expect(page.locator(CLI_IFRAME)).toHaveCount(0);
  });

  test("switching to CLI mode mounts CLI iframe and hides Web iframe", async ({ page }) => {
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await expect(page.locator(WEB_IFRAME)).toBeAttached({ timeout: 10000 });

    const switchToCli = page.locator(SWITCH_TO_CLI);
    await expect(switchToCli).toBeVisible({ timeout: 5000 });
    await switchToCli.click();

    const cliFrame = page.locator(CLI_IFRAME);
    await expect(cliFrame).toBeAttached({ timeout: 10000 });

    const cliOpacity = await cliFrame.evaluate((el) => window.getComputedStyle(el).opacity);
    expect(cliOpacity).toBe("1");

    const webOpacity = await page.locator(WEB_IFRAME).evaluate((el) => window.getComputedStyle(el).opacity);
    expect(webOpacity).toBe("0");

    await expect(page.locator(SWITCH_TO_WEB)).toBeVisible({ timeout: 3000 });
  });

  test("CLI iframe never uses display:none", async ({ page }) => {
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await expect(page.locator(WEB_IFRAME)).toBeAttached({ timeout: 10000 });

    await page.locator(SWITCH_TO_CLI).click();
    const cliFrame = page.locator(CLI_IFRAME);
    await expect(cliFrame).toBeAttached({ timeout: 10000 });

    await page.locator(SWITCH_TO_WEB).click();

    await expect(cliFrame).toBeAttached();

    const display = await cliFrame.evaluate((el) => window.getComputedStyle(el).display);
    expect(display).not.toBe("none");
  });

  test("switching back to Web restores visibility without removing either iframe", async ({ page }) => {
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await expect(page.locator(WEB_IFRAME)).toBeAttached({ timeout: 10000 });

    await page.locator(SWITCH_TO_CLI).click();
    await page.locator(SWITCH_TO_WEB).click();

    const webOpacity = await page.locator(WEB_IFRAME).evaluate((el) => window.getComputedStyle(el).opacity);
    expect(webOpacity).toBe("1");

    await expect(page.locator(WEB_IFRAME)).toBeAttached();
    await expect(page.locator(CLI_IFRAME)).toBeAttached();
  });

  test("switch button has accessible role, aria-label, and aria-pressed", async ({ page }) => {
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await expect(page.locator(WEB_IFRAME)).toBeAttached({ timeout: 10000 });

    const switchBtn = page.locator(SWITCH_TO_CLI);
    await expect(switchBtn).toBeVisible({ timeout: 5000 });

    expect(await switchBtn.getAttribute("role")).toBe("button");
    expect(await switchBtn.getAttribute("aria-label")).toBe("Switch to CLI mode");
    expect(await switchBtn.getAttribute("aria-pressed")).toBe("false");

    await switchBtn.click();
    const cliBtn = page.locator(SWITCH_TO_WEB);
    await expect(cliBtn).toBeVisible({ timeout: 3000 });

    expect(await cliBtn.getAttribute("aria-pressed")).toBe("false");
    expect(await cliBtn.getAttribute("aria-label")).toBe("Switch to Web mode");
  });

  test("Ctrl+Shift+` keyboard shortcut toggles mode", async ({ page }) => {
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await expect(page.locator(WEB_IFRAME)).toBeAttached({ timeout: 10000 });

    await expect(page.locator(SWITCH_TO_CLI)).toBeVisible({ timeout: 5000 });

    await page.locator(SWITCH_TO_CLI).dispatchEvent("keydown", {
      key: "`",
      code: "Backquote",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });

    await expect(page.locator(CLI_IFRAME)).toBeAttached({ timeout: 10000 });

    await expect(page.locator(SWITCH_TO_WEB)).toBeVisible({ timeout: 5000 });

    await page.locator(SWITCH_TO_WEB).dispatchEvent("keydown", {
      key: "`",
      code: "Backquote",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });

    await expect(page.locator(SWITCH_TO_CLI)).toBeVisible({ timeout: 5000 });
  });

  test("mode persists across page reload via localStorage", async ({ page }) => {
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await expect(page.locator(WEB_IFRAME)).toBeAttached({ timeout: 10000 });

    await page.locator(SWITCH_TO_CLI).click();

    const stored = await page.evaluate(() => localStorage.getItem("opencode-mode"));
    expect(stored).toBe("cli");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });

    await expect(page.locator(SWITCH_TO_WEB)).toBeVisible({ timeout: 5000 });
  });

  test("mobile viewport (< 768px) keeps both mode controls accessible", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await expect(page.locator(WEB_IFRAME)).toBeAttached({ timeout: 10000 });

    const webButton = page.locator('button[aria-label="Switch to Web mode"]');
    const cliButton = page.locator(SWITCH_TO_CLI);
    await expect(webButton).toBeVisible({ timeout: 5000 });
    await expect(cliButton).toBeVisible({ timeout: 5000 });

    const viewport = page.viewportSize();
    const [webBox, cliBox] = await Promise.all([webButton.boundingBox(), cliButton.boundingBox()]);
    expect(viewport).not.toBeNull();
    expect(webBox).not.toBeNull();
    expect(cliBox).not.toBeNull();
    if (viewport && webBox && cliBox) {
      expect(webBox.x).toBeGreaterThanOrEqual(0);
      expect(cliBox.x + cliBox.width).toBeLessThanOrEqual(viewport.width);
    }
  });

  test("hidden iframe preserves full viewport dimensions (no display:none zeroing)", async ({ page }) => {
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await expect(page.locator(WEB_IFRAME)).toBeAttached({ timeout: 10000 });

    await page.locator(SWITCH_TO_CLI).click();
    await expect(page.locator(CLI_IFRAME)).toBeAttached({ timeout: 10000 });

    await page.locator(SWITCH_TO_WEB).click();

    const cliFrame = page.locator(CLI_IFRAME);
    const boundingBox = await cliFrame.boundingBox();
    expect(boundingBox).not.toBeNull();

    if (boundingBox) {
      const vs = page.viewportSize();
      if (vs) {
        expect(boundingBox.width).toBeGreaterThan(vs.width * 0.5);
        expect(boundingBox.height).toBeGreaterThan(vs.height * 0.5);
      }
    }

    const display = await cliFrame.evaluate((el) => window.getComputedStyle(el).display);
    expect(display).not.toBe("none");
  });
});

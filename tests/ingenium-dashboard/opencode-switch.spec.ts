import { test, expect, type Page } from "@playwright/test";

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

  /* ------------------------------------------------------------------ */
  /*  1. Initial state — Web iframe visible, CLI absent (lazy-mounted)    */
  /* ------------------------------------------------------------------ */
  test("initial state: Web iframe visible, CLI iframe not yet mounted", async ({ page }) => {
    // Start fresh — clear any persisted mode
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    // Full navigation to pick up cleared localStorage
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });

    // Web iframe should be in DOM and visible
    const webFrame = page.locator(WEB_IFRAME);
    await expect(webFrame).toBeAttached({ timeout: 10000 });

    const webOpacity = await webFrame.evaluate((el) => window.getComputedStyle(el).opacity);
    const webVisibility = await webFrame.evaluate((el) => window.getComputedStyle(el).visibility);
    expect(webOpacity).toBe("1");
    expect(webVisibility).toBe("visible");

    // CLI iframe should not exist yet (lazy-mounted on first CLI activation)
    await expect(page.locator(CLI_IFRAME)).toHaveCount(0);
  });

  /* ------------------------------------------------------------------ */
  /*  2. Switch to CLI mode — CLI mounts, Web hides                       */
  /* ------------------------------------------------------------------ */
  test("switching to CLI mode mounts CLI iframe and hides Web iframe", async ({ page }) => {
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await expect(page.locator(WEB_IFRAME)).toBeAttached({ timeout: 10000 });

    // Click switch to CLI
    const switchToCli = page.locator(SWITCH_TO_CLI);
    await expect(switchToCli).toBeVisible({ timeout: 5000 });
    await switchToCli.click();

    // CLI iframe should now be mounted and visible
    const cliFrame = page.locator(CLI_IFRAME);
    await expect(cliFrame).toBeAttached({ timeout: 10000 });

    const cliOpacity = await cliFrame.evaluate((el) => window.getComputedStyle(el).opacity);
    expect(cliOpacity).toBe("1");

    // Web iframe should be hidden (opacity 0, visibility hidden)
    const webOpacity = await page.locator(WEB_IFRAME).evaluate((el) => window.getComputedStyle(el).opacity);
    expect(webOpacity).toBe("0");

    // Switch label should now point to Web mode
    await expect(page.locator(SWITCH_TO_WEB)).toBeVisible({ timeout: 3000 });
  });

  /* ------------------------------------------------------------------ */
  /*  3. No display:none on CLI iframe                                    */
  /* ------------------------------------------------------------------ */
  test("CLI iframe never uses display:none", async ({ page }) => {
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await expect(page.locator(WEB_IFRAME)).toBeAttached({ timeout: 10000 });

    // Switch to CLI to mount it
    await page.locator(SWITCH_TO_CLI).click();
    const cliFrame = page.locator(CLI_IFRAME);
    await expect(cliFrame).toBeAttached({ timeout: 10000 });

    // Switch back to Web
    await page.locator(SWITCH_TO_WEB).click();

    // CLI iframe should still be in the DOM (not removed)
    await expect(cliFrame).toBeAttached();

    // display should NOT be "none"
    const display = await cliFrame.evaluate((el) => window.getComputedStyle(el).display);
    expect(display).not.toBe("none");
  });

  /* ------------------------------------------------------------------ */
  /*  4. Switching back preserves both iframes in DOM                     */
  /* ------------------------------------------------------------------ */
  test("switching back to Web restores visibility without removing either iframe", async ({ page }) => {
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await expect(page.locator(WEB_IFRAME)).toBeAttached({ timeout: 10000 });

    // Switch to CLI
    await page.locator(SWITCH_TO_CLI).click();
    // Switch back to Web
    await page.locator(SWITCH_TO_WEB).click();

    // Web iframe should be visible again
    const webOpacity = await page.locator(WEB_IFRAME).evaluate((el) => window.getComputedStyle(el).opacity);
    expect(webOpacity).toBe("1");

    // Both iframes should still be in the DOM
    await expect(page.locator(WEB_IFRAME)).toBeAttached();
    await expect(page.locator(CLI_IFRAME)).toBeAttached();
  });

  /* ------------------------------------------------------------------ */
  /*  5. Accessibility — correct role, label, and aria-pressed            */
  /* ------------------------------------------------------------------ */
  test("switch button has accessible role, aria-label, and aria-pressed", async ({ page }) => {
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await expect(page.locator(WEB_IFRAME)).toBeAttached({ timeout: 10000 });

    const switchBtn = page.locator(SWITCH_TO_CLI);
    await expect(switchBtn).toBeVisible({ timeout: 5000 });

    // role
    expect(await switchBtn.getAttribute("role")).toBe("button");
    // aria-label describes destination
    expect(await switchBtn.getAttribute("aria-label")).toBe("Switch to CLI mode");
    // aria-pressed should be false in web mode
    expect(await switchBtn.getAttribute("aria-pressed")).toBe("false");

    // Switch to CLI and re-check
    await switchBtn.click();
    const cliBtn = page.locator(SWITCH_TO_WEB);
    await expect(cliBtn).toBeVisible({ timeout: 3000 });

    expect(await cliBtn.getAttribute("aria-pressed")).toBe("false");
    expect(await cliBtn.getAttribute("aria-label")).toBe("Switch to Web mode");
  });

  /* ------------------------------------------------------------------ */
  /*  6. Keyboard shortcut Ctrl+Shift+` toggles mode                      */
  /* ------------------------------------------------------------------ */
  test("Ctrl+Shift+` keyboard shortcut toggles mode", async ({ page }) => {
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await expect(page.locator(WEB_IFRAME)).toBeAttached({ timeout: 10000 });

    // Initial: should have web mode button visible
    await expect(page.locator(SWITCH_TO_CLI)).toBeVisible({ timeout: 5000 });

    // Press keyboard shortcut — should switch to CLI
    await page.locator(SWITCH_TO_CLI).dispatchEvent("keydown", {
      key: "`",
      code: "Backquote",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });

    // CLI iframe should now be mounted
    await expect(page.locator(CLI_IFRAME)).toBeAttached({ timeout: 10000 });

    // Switch label should change to "Switch to Web mode"
    await expect(page.locator(SWITCH_TO_WEB)).toBeVisible({ timeout: 5000 });

    // Press shortcut again to switch back
    await page.locator(SWITCH_TO_WEB).dispatchEvent("keydown", {
      key: "`",
      code: "Backquote",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });

    // Should be back to Web mode
    await expect(page.locator(SWITCH_TO_CLI)).toBeVisible({ timeout: 5000 });
  });

  /* ------------------------------------------------------------------ */
  /*  7. Mode persists via localStorage across reload                     */
  /* ------------------------------------------------------------------ */
  test("mode persists across page reload via localStorage", async ({ page }) => {
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await expect(page.locator(WEB_IFRAME)).toBeAttached({ timeout: 10000 });

    // Switch to CLI mode
    await page.locator(SWITCH_TO_CLI).click();

    // Verify localStorage was set
    const stored = await page.evaluate(() => localStorage.getItem("opencode-mode"));
    expect(stored).toBe("cli");

    // Navigate away and back
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });

    // The selected mode should be restored from localStorage.
    await expect(page.locator(SWITCH_TO_WEB)).toBeVisible({ timeout: 5000 });
  });

  /* ------------------------------------------------------------------ */
  /*  8. Mobile viewport — mode controls remain accessible                 */
  /* ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ */
  /*  9. Hidden iframe preserves full viewport dimensions                  */
  /* ------------------------------------------------------------------ */
  test("hidden iframe preserves full viewport dimensions (no display:none zeroing)", async ({ page }) => {
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto("/opencode", { waitUntil: "domcontentloaded" });
    await expect(page.locator(WEB_IFRAME)).toBeAttached({ timeout: 10000 });

    // Switch to CLI to mount both frames
    await page.locator(SWITCH_TO_CLI).click();
    await expect(page.locator(CLI_IFRAME)).toBeAttached({ timeout: 10000 });

    // Switch back to Web — CLI is now hidden via opacity/visibility
    await page.locator(SWITCH_TO_WEB).click();

    // Hidden CLI iframe should still have a bounding box (not collapsed)
    const cliFrame = page.locator(CLI_IFRAME);
    const boundingBox = await cliFrame.boundingBox();
    expect(boundingBox).not.toBeNull();

    if (boundingBox) {
      // Should span at least half the viewport in each dimension
      const vs = page.viewportSize();
      if (vs) {
        expect(boundingBox.width).toBeGreaterThan(vs.width * 0.5);
        expect(boundingBox.height).toBeGreaterThan(vs.height * 0.5);
      }
    }

    // Explicit guard: display is NOT "none"
    const display = await cliFrame.evaluate((el) => window.getComputedStyle(el).display);
    expect(display).not.toBe("none");
  });
});

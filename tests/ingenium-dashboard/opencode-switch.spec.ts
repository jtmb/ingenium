import { test, expect } from "@playwright/test";

const DASHBOARD_URL = "http://localhost:3000";
const WEB_IFRAME = 'iframe[title="OpenCode Web"]';
const CLI_IFRAME = 'iframe[title="OpenCode Terminal"]';
const SWITCH_TO_CLI = 'button[aria-label="Switch to CLI mode"]';
const SWITCH_TO_WEB = 'button[aria-label="Switch to Web mode"]';

test.describe("OpenCode Web/CLI Mode Switch", () => {
  test.describe.configure({ mode: "serial" });

  // Precondition: verify services are reachable
  test.beforeAll(async ({ request }) => {
    try {
      const apiHealth = await request.get("http://localhost:4097/api/v1/health");
      if (!apiHealth.ok()) {
        test.skip(true, "API not reachable — skipping tests");
      }
    } catch {
      test.skip(true, "Services not running — skipping tests");
    }
  });

  /* ------------------------------------------------------------------ */
  /*  1. Initial state — Web iframe visible, CLI absent (lazy-mounted)    */
  /* ------------------------------------------------------------------ */
  test("initial state: Web iframe visible, CLI iframe not yet mounted", async ({ page }) => {
    // Start fresh — clear any persisted mode
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    // Full navigation to pick up cleared localStorage
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

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
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

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
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

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
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

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
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

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

    expect(await cliBtn.getAttribute("aria-pressed")).toBe("true");
    expect(await cliBtn.getAttribute("aria-label")).toBe("Switch to Web mode");
  });

  /* ------------------------------------------------------------------ */
  /*  6. Keyboard shortcut Ctrl+Shift+` toggles mode                      */
  /* ------------------------------------------------------------------ */
  test("Ctrl+Shift+` keyboard shortcut toggles mode", async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

    // Initial: should have web mode button visible
    await expect(page.locator(SWITCH_TO_CLI)).toBeVisible({ timeout: 5000 });

    // Press keyboard shortcut — should switch to CLI
    await page.keyboard.press("Control+Shift+`");

    // CLI iframe should now be mounted
    await expect(page.locator(CLI_IFRAME)).toBeAttached({ timeout: 10000 });

    // Switch label should change to "Switch to Web mode"
    await expect(page.locator(SWITCH_TO_WEB)).toBeVisible({ timeout: 5000 });

    // Press shortcut again to switch back
    await page.keyboard.press("Control+Shift+`");

    // Should be back to Web mode
    await expect(page.locator(SWITCH_TO_CLI)).toBeVisible({ timeout: 5000 });
  });

  /* ------------------------------------------------------------------ */
  /*  7. Mode persists via localStorage across reload                     */
  /* ------------------------------------------------------------------ */
  test("mode persists across page reload via localStorage", async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

    // Switch to CLI mode
    await page.locator(SWITCH_TO_CLI).click();

    // Verify localStorage was set
    const stored = await page.evaluate(() => localStorage.getItem("opencode-mode"));
    expect(stored).toBe("cli");

    // Navigate away and back
    await page.goto(`${DASHBOARD_URL}/`, { waitUntil: "domcontentloaded" });
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

    // CLI iframe should be mounted and visible (persisted mode)
    await expect(page.locator(CLI_IFRAME)).toBeAttached({ timeout: 10000 });
    await expect(page.locator(SWITCH_TO_WEB)).toBeVisible({ timeout: 5000 });
  });

  /* ------------------------------------------------------------------ */
  /*  8. Mobile viewport — compact pill button                            */
  /* ------------------------------------------------------------------ */
  test("mobile viewport (< 768px) shows compact pill button", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

    const switchBtn = page.locator(SWITCH_TO_CLI);
    // On mobile, the visible button should be the compact pill (md:hidden)
    // The desktop button has hidden md:flex; the mobile has md:hidden
    const visibleButton = switchBtn.first();
    await expect(visibleButton).toBeVisible({ timeout: 5000 });

    // Mobile pill should have rounded-full class (vs rounded-l-lg for desktop)
    const classList = await visibleButton.evaluate((el) => el.className);
    expect(classList).toContain("rounded-full");
  });

  /* ------------------------------------------------------------------ */
  /*  9. Hidden iframe preserves full viewport dimensions                  */
  /* ------------------------------------------------------------------ */
  test("hidden iframe preserves full viewport dimensions (no display:none zeroing)", async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

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

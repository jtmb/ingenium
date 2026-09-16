import { expect, test } from "./fixture";

const COMPATIBILITY_AUDIENCE_UNAVAILABLE = "The local runtime audience is unavailable. Check the service status and retry.";
const ISOLATED_NO_WORKSPACE = "No workspace has been authorized for your account.";

/**
 * The default suite owns a high-port fixture, not the loopback-only VS Code
 * deployment. It must therefore prove the route fails closed rather than mock
 * a successful code-server process or iframe.
 */
test("VS Code route reports an unhealthy compatibility audience in the deterministic fixture", async ({ page }) => {
  let statusRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/services/status") statusRequests += 1;
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/vscode", { waitUntil: "domcontentloaded" });

  const alert = page.getByRole("alert").filter({ hasText: "VS Code is unavailable" });
  await expect(alert).toContainText("VS Code is unavailable");
  await expect(alert).toContainText(COMPATIBILITY_AUDIENCE_UNAVAILABLE);
  await expect(alert).not.toContainText(ISOLATED_NO_WORKSPACE);
  await expect(page.locator('iframe[title="VS Code"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry VS Code" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pop out to standalone window" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(statusRequests).toBe(0);
});

test("VS Code route keeps isolated workspace guidance when no runtime is available", async ({ page }) => {
  await page.route("**/api/v1/runtimes/browser/status", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { mode: "isolated", status: "no_runtime", reason: "no_authorized_workspace" } }),
  }));
  await page.route("**/api/v1/runtimes/browser/workspaces", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: [] }),
  }));

  let compatibilityHealthRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/runtimes/browser/health") compatibilityHealthRequests += 1;
  });

  await page.goto("/vscode", { waitUntil: "domcontentloaded" });

  const alert = page.getByRole("alert").filter({ hasText: "No authorized workspaces" });
  await expect(alert).toContainText(ISOLATED_NO_WORKSPACE);
  await expect(alert).not.toContainText(COMPATIBILITY_AUDIENCE_UNAVAILABLE);
  await expect(page.locator('iframe[title="VS Code"]')).toHaveCount(0);
  expect(compatibilityHealthRequests).toBe(0);
});

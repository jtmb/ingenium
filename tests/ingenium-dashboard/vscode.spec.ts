import { expect, test } from "./fixture";

/**
 * The default suite owns a high-port fixture, not the loopback-only VS Code
 * deployment. It must therefore prove the route fails closed rather than mock
 * a successful code-server process or iframe.
 */
test("VS Code route stays local-only in the deterministic fixture", async ({ page }) => {
  let statusRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/services/status") statusRequests += 1;
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/vscode", { waitUntil: "domcontentloaded" });

  const alert = page.getByRole("alert").filter({ hasText: "VS Code is unavailable on this connection" });
  await expect(alert).toContainText("VS Code is unavailable on this connection");
  await expect(alert).toContainText("local-only, administrator-grade workspace");
  await expect(page.locator('iframe[title="VS Code"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open directly" })).toHaveAttribute(
    "href",
    "http://vscode.localhost:3000/",
  );
  await expect(page.getByRole("button", { name: "Pop out to standalone window" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(statusRequests).toBe(0);
});

import { expect, test } from "./fixture";

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test.describe(`runtime audience failure state — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("health-gates Web, CLI, and VS Code without exposing runtime internals", async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });

      await page.goto("/opencode");
      await expect(page.getByRole("heading", { name: "Workspace is unavailable" })).toBeVisible();
      await expect(page.getByLabel("OpenCode runtime unavailable")).toBeVisible();
      await expect(page.locator('iframe[title="OpenCode Web"]')).toHaveCount(0);

      await page.getByRole("button", { name: "Switch to CLI mode" }).click();
      await expect(page.getByRole("heading", { name: "Workspace is unavailable" })).toBeVisible();
      await expect(page.locator('iframe[title="OpenCode Terminal"]')).toHaveCount(0);

      await page.goto("/vscode");
      await expect(page.getByRole("heading", { name: "VS Code is unavailable" })).toBeVisible();
      await expect(page.locator('iframe[title="VS Code"]')).toHaveCount(0);

      const visibleText = await page.locator("body").innerText();
      expect(visibleText).not.toMatch(/backend|container|storagePath|sessionToken|127\.0\.0\.1:4(?:098|099|100)/i);
      expect(consoleErrors).toEqual([]);
    });
  });
}

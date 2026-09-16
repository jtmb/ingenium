import { expect, test } from "./external-suite-navigation-governor";
import { getDockerActiveProject } from "./docker-active-project";

test.describe("Secrets production route", () => {
  test("serves /secrets and retrieves vault status through the dashboard proxy", async ({ page }) => {
    const project = await getDockerActiveProject(page.request);
    const vaultStatusResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/vault/status" && url.searchParams.get("project") === project;
    });

    const pageResponse = await page.goto(`/secrets?project=${encodeURIComponent(project)}`, {
      waitUntil: "domcontentloaded",
    });

    expect(pageResponse?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Secrets" })).toBeVisible();

    const vaultStatus = await vaultStatusResponse;
    expect(vaultStatus.status()).toBe(200);
    await expect(vaultStatus.json()).resolves.toMatchObject({
      data: {
        sealed: expect.any(Boolean),
        initialized: expect.any(Boolean),
      },
    });
  });
});

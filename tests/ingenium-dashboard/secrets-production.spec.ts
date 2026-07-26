import { expect, test } from "@playwright/test";

const PROJECT = "global-default";

test.describe("Secrets production route", () => {
  test("serves /secrets and retrieves vault status through the dashboard proxy", async ({ page }) => {
    const vaultStatusResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/vault/status" && url.searchParams.get("project") === PROJECT;
    });

    const pageResponse = await page.goto(`/secrets?project=${PROJECT}`, {
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

import { expect, test } from "@playwright/test";

const ACCOUNT_ID = "oauth-account";

test("offers reconnect when an OAuth account has no worker or folders", async ({ page }) => {
  await page.route("**/api/v1/projects*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ data: [{ name: "global-default", is_global: 1 }] }),
  }));
  await page.route("**/api/v1/emails/accounts*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: [{ id: ACCOUNT_ID, email: "user@example.com", provider: "gmail", authType: "oauth2" }],
    }),
  }));
  await page.route("**/api/v1/emails/folders*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ data: [] }),
  }));
  await page.route("**/api/v1/emails/sync-status*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        overall: "idle",
        account: ACCOUNT_ID,
        totalFolders: 0,
        syncingFolders: 0,
        totalCached: 0,
        totalBodies: 0,
        folders: [],
        engine: { running: true, accounts: [] },
      },
    }),
  }));
  await page.route("**/api/v1/emails?*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ data: [], total: 0, source: "pending" }),
  }));

  await page.goto("/mail");

  await expect(page.getByRole("button", { name: "Reconnect Account" })).toBeVisible();
  await page.getByRole("button", { name: "Reconnect Account" }).click();
  await expect(page.getByRole("heading", { name: "Reconnect Email Account" })).toBeVisible();
  await expect(page.getByText("user@example.com")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect with Google" })).toBeVisible();
});

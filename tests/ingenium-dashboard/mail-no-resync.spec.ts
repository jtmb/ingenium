import { test, expect } from "@playwright/test";

const API_BASE = "http://localhost:4097/api/v1";

test.describe("Mail — no resync storm on folder click", () => {
  test("clicking Starred does not trigger full-account sync or clear INBOX cache", async ({ page }) => {
    // Precondition: find the email account ID
    const acctResp = await page.request.get(`${API_BASE}/emails/accounts?project=global-default`);
    const acctData = await acctResp.json();
    const accounts = acctData?.data ?? [];
    expect(accounts.length, "At least one email account is required").toBeGreaterThan(0);

    const accountId = accounts[0].id;

    // Verify INBOX is cached and has content
    const inboxResp = await page.request.get(
      `${API_BASE}/emails?project=global-default&folder=INBOX&account=${accountId}&limit=5`
    );
    const inboxData = await inboxResp.json();
    const inboxSource = inboxData?.source;
    const inboxTotal = inboxData?.total ?? 0;
    expect(inboxTotal, "INBOX must contain cached messages").toBeGreaterThan(0);
    expect(inboxSource).toBe("cache");

    // Open /mail page and intercept network
    await page.goto("/mail");
    await page.waitForLoadState("load");
    // Don't use networkidle — the mail page polls /sync-status every 2s
    await expect(page.locator("h1").filter({ hasText: "Mail" })).toBeVisible({ timeout: 15_000 });

    // Intercept all sync requests
    const syncCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/emails/sync") && !req.url().includes("/sync-status")) syncCalls.push(req.url());
    });

    // Click the Starred folder in the sidebar
    const starredLink = page.locator('button, a, div[role="button"]').filter({ hasText: /Starred/i }).first();
    const starredResponse = page.waitForResponse(
      (response) => response.url().includes("/api/v1/emails") &&
        !response.url().includes("/sync-status") &&
        decodeURIComponent(response.url()).includes("Starred") &&
        response.status() === 200,
      { timeout: 15_000 },
    );
    await expect(starredLink).toBeVisible({ timeout: 15_000 });
    await starredLink.click();
    await starredResponse;

    // Assert: NO sync request was made WITHOUT a folder param (which would be full-account)
    for (const call of syncCalls) {
      const url = new URL(call);
      const folder = url.searchParams.get("folder");
      expect(folder, `Sync call ${call} must specify a folder — full-account sync detected!`).toBeTruthy();
    }

    // Assert: INBOX cache is still intact (not wiped)
    const inboxAfter = await page.request.get(
      `${API_BASE}/emails?project=global-default&folder=INBOX&account=${accountId}&limit=5`
    );
    const inboxAfterData = await inboxAfter.json();
    expect(inboxAfterData?.source).toBe("cache");
    // Total should be roughly the same (±2 for possible new emails during test run)
    expect(Math.abs((inboxAfterData?.total ?? 0) - inboxTotal)).toBeLessThanOrEqual(2);
  });

  test("email body opens from cache in under 2 seconds", async ({ page }) => {
    // Precondition
    const acctResp = await page.request.get(`${API_BASE}/emails/accounts?project=global-default`);
    const accounts = (await acctResp.json())?.data ?? [];
    expect(accounts.length, "At least one email account is required").toBeGreaterThan(0);
    const accountId = accounts[0].id;

    // Get first email UID from cache
    const listResp = await page.request.get(
      `${API_BASE}/emails?project=global-default&folder=INBOX&account=${accountId}&limit=1`
    );
    const listData = await listResp.json();
    const emails = listData?.data ?? [];
    expect(emails, "INBOX must contain at least one cached email").not.toHaveLength(0);

    const firstUid = emails[0].uid;

    // Time the body fetch
    const start = Date.now();
    const bodyResp = await page.request.get(
      `${API_BASE}/emails/${firstUid}?project=global-default&account=${accountId}&folder=INBOX`
    );
    const elapsed = Date.now() - start;
    const bodyData = await bodyResp.json();

    expect(bodyData?.source).toBe("cache");
    expect(bodyData?.data?.body?.html || bodyData?.data?.body?.text, "Body must have content").toBeTruthy();
    expect(elapsed, `Email body read took ${elapsed}ms, expected <2000ms`).toBeLessThan(2000);
  });
});

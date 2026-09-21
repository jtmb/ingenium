import { test, expect } from "@playwright/test";

const API_BASE = "http://localhost:4097/api/v1";

test.describe("Mail — no resync storm on folder click", () => {
  test("clicking Starred does not trigger full-account sync or clear INBOX cache", async ({ page }) => {
    const acctResp = await page.request.get(`${API_BASE}/emails/accounts?project=global-default`);
    const acctData = await acctResp.json();
    const accounts = acctData?.data ?? [];
    expect(accounts.length, "At least one email account is required").toBeGreaterThan(0);

    const accountId = accounts[0].id;

    const inboxResp = await page.request.get(
      `${API_BASE}/emails?project=global-default&folder=INBOX&account=${accountId}&limit=5`
    );
    const inboxData = await inboxResp.json();
    const inboxSource = inboxData?.source;
    const inboxTotal = inboxData?.total ?? 0;
    expect(inboxTotal, "INBOX must contain cached messages").toBeGreaterThan(0);
    expect(inboxSource).toBe("cache");

    await page.goto("/mail");
    await page.waitForLoadState("load");
    // The page polls sync-status, so networkidle never settles here.
    await expect(page.locator("h1").filter({ hasText: "Mail" })).toBeVisible({ timeout: 15_000 });

    const syncCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/emails/sync") && !req.url().includes("/sync-status")) syncCalls.push(req.url());
    });

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

    for (const call of syncCalls) {
      const url = new URL(call);
      const folder = url.searchParams.get("folder");
      expect(folder, `Sync call ${call} must specify a folder — full-account sync detected!`).toBeTruthy();
    }

    const inboxAfter = await page.request.get(
      `${API_BASE}/emails?project=global-default&folder=INBOX&account=${accountId}&limit=5`
    );
    const inboxAfterData = await inboxAfter.json();
    expect(inboxAfterData?.source).toBe("cache");
    // Allow a small amount of mailbox churn during the live check.
    expect(Math.abs((inboxAfterData?.total ?? 0) - inboxTotal)).toBeLessThanOrEqual(2);
  });

  test("email body opens from cache in under 2 seconds", async ({ page }) => {
    const acctResp = await page.request.get(`${API_BASE}/emails/accounts?project=global-default`);
    const accounts = (await acctResp.json())?.data ?? [];
    expect(accounts.length, "At least one email account is required").toBeGreaterThan(0);
    const accountId = accounts[0].id;

    const listResp = await page.request.get(
      `${API_BASE}/emails?project=global-default&folder=INBOX&account=${accountId}&limit=1`
    );
    const listData = await listResp.json();
    const emails = listData?.data ?? [];
    expect(emails, "INBOX must contain at least one cached email").not.toHaveLength(0);

    const firstUid = emails[0].uid;

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

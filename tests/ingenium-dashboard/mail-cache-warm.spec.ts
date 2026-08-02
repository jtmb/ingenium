import { test, expect } from "@playwright/test";

/** Mail cache and cold-gating checks against the configured mail service. */

const API_BASE = "http://localhost:4097/api/v1";
const MAIL_PAGE = "http://localhost:3000/mail";
const ACCOUNT_ID = "68a96f5b-faaf-41d3-967e-5981564ec080";

/**
 * Poll the sync-status endpoint every 2s until the cache is warm.
 * Returns the final sync-status data.
 */
async function pollUntilWarm(page: any): Promise<any> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const resp = await page.request.get(
      `${API_BASE}/emails/sync-status?account=${ACCOUNT_ID}&project=global-default`,
    );
    if (!resp.ok()) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    const status = (await resp.json())?.data;
    if (
      status &&
      status.totalBodies > 50 &&
      status.folders.filter((f: any) => f.cachedCount > 0).length >= 3
    ) {
      return status;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Timed out waiting for cache to warm (totalBodies > 50, 3+ folders with cachedCount > 0)");
}

/**
 * Wait for the sync-status to show warm cache from the UI perspective.
 * The page polls every 2s internally.
 */
async function waitForWarmCache(page: any, timeout = 60_000): Promise<void> {
  await page.waitForFunction(
    async () => {
      try {
        const r = await fetch(
          `/api/v1/emails/sync-status?account=${ACCOUNT_ID}&project=global-default`,
        );
        const d = await r.json();
        return d?.data?.overall !== "syncing" && d?.data?.totalCached > 0;
      } catch {
        return false;
      }
    },
    { timeout, polling: 2000 },
  );
}

test.describe("Mail — Cache Warming", () => {
  test("1 - all folders have cached headers and bodies after sync", async ({ page }) => {
    // The sync completes folders sequentially, so this is intentionally bounded
    // by the suite's long-running mail timeout.
    const syncResp = await page.request.post(
      `${API_BASE}/emails/sync?account=${ACCOUNT_ID}&project=global-default`,
    );
    expect(syncResp.ok()).toBeTruthy();

    // Header caching happens during sync; body caching is demand-driven, so the
    // folder and INBOX thresholds intentionally use different counters.
    const status = await pollUntilWarm(page);

    expect(status.overall).toBe("done");
    expect(status.totalBodies).toBeGreaterThan(50);
    expect(status.totalCached).toBeGreaterThan(0);

    const inboxFolder = status.folders.find((f: any) => f.folder === "INBOX");
    expect(inboxFolder).toBeDefined();
    expect(inboxFolder.bodyCount).toBeGreaterThan(0);

    const foldersWithCache = status.folders.filter(
      (f: any) => f.cachedCount > 0,
    );
    expect(foldersWithCache.length).toBeGreaterThanOrEqual(3);

    test.info().annotations.push({
      type: "cache-stats",
      description: [
        `totalBodies=${status.totalBodies}`,
        `totalCached=${status.totalCached}`,
        `folders=${status.totalFolders}`,
        `cachedFolders=${foldersWithCache.length}`,
        ...foldersWithCache.map(
          (f: any) => `${f.folder}: cached=${f.cachedCount} bodies=${f.bodyCount}`,
        ),
      ].join("\n"),
    });
  });

  test("2 - folder click returns cached data, not pending", async ({ page }) => {
    await page.goto("/mail", { waitUntil: "load" });

    await waitForWarmCache(page);

    // The UI label and provider path differ for Gmail system folders.
    const starredBtn = page
      .locator("button")
      .filter({ hasText: /Starred/ })
      .first();
    await expect(starredBtn).toBeVisible({ timeout: 10_000 });

    const emailResponsePromise = page.waitForResponse(
      (resp) => {
        const url = resp.url();
        return (
          url.includes("/api/v1/emails") &&
          !url.includes("/sync-status") &&
          !url.includes("/search") &&
          (url.includes("%5BGmail%5D%2FStarred") ||
            url.includes("folder=Starred") ||
            decodeURIComponent(url).includes("[Gmail]/Starred")) &&
          resp.status() === 200
        );
      },
      { timeout: 30_000 },
    );

    await starredBtn.click();
    const emailResponse = await emailResponsePromise;
    const body = await emailResponse.json();

    expect(body.source).toBe("cache");
    expect(body.source).not.toBe("pending");
    expect(body.source).not.toBe("imap");
    expect(Array.isArray(body.data)).toBeTruthy();

    const emailRows = page.locator("div.cursor-pointer");
    await expect(emailRows.first()).toBeVisible({ timeout: 3000 });
  });

  test("3 - email body opens from cache in under 2 seconds", async ({ page }) => {
    await page.goto("/mail", { waitUntil: "load" });

    await waitForWarmCache(page);

    const starredBtn = page
      .locator("button")
      .filter({ hasText: /Starred/ })
      .first();
    await expect(starredBtn).toBeVisible({ timeout: 10_000 });
    await starredBtn.click();

    const emailRows = page.locator("div.cursor-pointer");
    await expect(emailRows.first()).toBeVisible({ timeout: 15_000 });

    const rowCount = await emailRows.count();
    expect(rowCount, "Starred must contain at least one cached email").toBeGreaterThan(0);

    const start = Date.now();
    await emailRows.first().click();

    // HTML and plain-text messages expose different completion markers.
    const readerContent = page.locator('[data-testid="email-reader-content"]');
    const htmlIframe = page.locator('[data-testid="email-html-iframe"]');
    await Promise.race([
      expect(readerContent).toBeVisible({ timeout: 10_000 }),
      expect(htmlIframe).toBeVisible({ timeout: 10_000 }),
    ]);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);

    test.info().annotations.push({
      type: "performance",
      description: `Cache-backed email open: ${elapsed}ms (under 2000ms ✓)`,
    });
  });

  test("4 - no [Gmail] bare container in sidebar", async ({ page }) => {
    await page.goto("/mail", { waitUntil: "load" });

    await expect(page.locator("button").filter({ hasText: /INBOX/ }).first()).toBeVisible({ timeout: 15_000 });

    // Gmail exposes system folders under a container; the container itself is
    // not a selectable folder.
    const allButtons = page.locator("button");
    const btnCount = await allButtons.count();
    let bareGmailCount = 0;
    for (let i = 0; i < btnCount; i++) {
      const btn = allButtons.nth(i);
      const text = await btn.textContent();
      if (text && text.includes("[Gmail]") && !text.includes("/")) {
        bareGmailCount++;
      }
    }
    expect(bareGmailCount).toBe(0);
  });

  test("5 - cold INBOX shows Preparing screen, not 3-pane content", async ({ page }) => {
    await page.route("**/api/v1/emails/sync-status**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            overall: "syncing",
            account: ACCOUNT_ID,
            totalFolders: 11,
            syncingFolders: 3,
            totalCached: 0,
            totalBodies: 0,
            folders: [
              {
                folder: "INBOX",
                cachedCount: 0,
                bodyCount: 0,
                syncing: true,
                lastSyncedAt: null,
              },
              {
                folder: "Personal",
                cachedCount: 0,
                bodyCount: 0,
                syncing: true,
                lastSyncedAt: null,
              },
              {
                folder: "Receipts",
                cachedCount: 0,
                bodyCount: 0,
                syncing: true,
                lastSyncedAt: null,
              },
            ],
          },
        }),
      });
    });

    await page.route(
      (url) =>
        url.pathname === "/api/v1/emails" &&
        url.searchParams.get("folder") === "INBOX" &&
        !url.searchParams.has("refresh"),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [],
            total: 0,
            source: "pending",
          }),
        });
      },
    );

    await page.goto("/mail", { waitUntil: "load" });

    const mailHeading = page.locator("h1").filter({ hasText: "Mail" });
    await expect(mailHeading).toBeVisible({ timeout: 5000 });

    const coldGating = page.locator('[data-testid="mail-gating-cold"]');
    await expect(coldGating).toBeVisible({ timeout: 5000 });

    const preparingHeading = page.getByText("Preparing your mailbox…");
    await expect(preparingHeading).toBeVisible({ timeout: 3000 });

    // Cold gating replaces the three-pane layout while INBOX has no cache.
    const threePaneLayout = page.locator(
      'div.flex.h-\\[calc\\(100vh-180px\\)\\]',
    );
    await expect(threePaneLayout).not.toBeVisible({ timeout: 3000 });

    const emailListPanel = page.locator('div.w-\\[350px\\].flex-shrink-0').first();
    await expect(emailListPanel).not.toBeVisible({ timeout: 3000 });

    const emailRows = page.locator("div.cursor-pointer");
    const rowCount = await emailRows.count();
    expect(rowCount).toBe(0);

    await page.unrouteAll();
  });
});

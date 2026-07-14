import { test, expect } from "@playwright/test";

/**
 * E2E tests for the mail page's DB-backed cache layer.
 *
 * Tests run against the live Docker container (port 3000/4097) with a real
 * Gmail account (james.branco@gmail.com, id 68a96f5b-faaf-41d3-967e-5981564ec080)
 * that has been synced to the SQLite cache. The cache is populated by the
 * 15-minute scheduler and serves sub-2ms responses.
 *
 * Test 5 uses page.route() to mock the cold-sync state — this is valid
 * because it tests the gating UI behavior, not the sync engine itself.
 *
 * Selectors use roles, labels, and text content. data-testid attributes
 * are used where available (EmailReader, EmailErrorBoundary, mail-gating-cold).
 *
 * 🔴 KNOWN ISSUE: page.waitForLoadState("load") is used, never "networkidle",
 * because the mail page polls /sync-status every 2s.
 * 🔴 KNOWN ISSUE: URL patterns matching GET /emails/** must exclude
 * /sync-status to avoid false matches.
 */

const API_BASE = "http://localhost:4097/api/v1";
const MAIL_PAGE = "http://localhost:3000/mail";
const ACCOUNT_ID = "68a96f5b-faaf-41d3-967e-5981564ec080";

// =========================================================================
//  Helpers
// =========================================================================

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

// =========================================================================
//  Tests
// =========================================================================

test.describe("Mail — Cache Warming", () => {
  /* ================================================================== */
  /*  1. All folders have cached data after sync                          */
  /* ================================================================== */

  test("1 - all folders have cached headers and bodies after sync", async ({ page }) => {
    // Trigger a full-account sync to ensure the cache is populated.
    // This blocks until all folders are synced sequentially — may take up
    // to 2 minutes for a 34K-message Gmail INBOX.
    const syncResp = await page.request.post(
      `${API_BASE}/emails/sync?account=${ACCOUNT_ID}&project=global-default`,
    );
    expect(syncResp.ok()).toBeTruthy();

    // Poll sync-status until cache is warm (totalBodies > 50, 3+ folders
    // with cached headers). Uses cachedCount (not bodyCount) for the
    // folder-level check because body caching occurs on individual email
    // reads, not during sync. INBOX bodyCount > 0 is asserted because
    // the scheduler/prior activity has precached bodies there.
    const status = await pollUntilWarm(page);

    // — Assertions —
    expect(status.overall).toBe("done");
    expect(status.totalBodies).toBeGreaterThan(50);
    expect(status.totalCached).toBeGreaterThan(0);

    // INBOX must have cached bodies
    const inboxFolder = status.folders.find((f: any) => f.folder === "INBOX");
    expect(inboxFolder).toBeDefined();
    expect(inboxFolder.bodyCount).toBeGreaterThan(0);

    // At least 3 folders must have cached headers (proves multi-folder sync)
    const foldersWithCache = status.folders.filter(
      (f: any) => f.cachedCount > 0,
    );
    expect(foldersWithCache.length).toBeGreaterThanOrEqual(3);

    // Log folder-level stats for diagnostics
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

  /* ================================================================== */
  /*  2. Folder click returns cached data, not pending                    */
  /* ================================================================== */

  test("2 - folder click returns cached data, not pending", async ({ page }) => {
    await page.goto("/mail", { waitUntil: "load" });

    // Wait for sync-status to show warm state. The page polls every 2s.
    await waitForWarmCache(page);

    // Click Starred folder in the sidebar (display name = "Starred",
    // IMAP path = "[Gmail]/Starred")
    const starredBtn = page
      .locator("button")
      .filter({ hasText: /Starred/ })
      .first();
    await expect(starredBtn).toBeVisible({ timeout: 10_000 });

    // Intercept the API response for the Starred folder email fetch
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

    // Assert: source is "cache", not "pending" or "imap"
    expect(body.source).toBe("cache");
    expect(body.source).not.toBe("pending");
    expect(body.source).not.toBe("imap");
    expect(Array.isArray(body.data)).toBeTruthy();

    // Email list must render within 3s of the response
    const emailRows = page.locator("div.cursor-pointer");
    await expect(emailRows.first()).toBeVisible({ timeout: 3000 });
  });

  /* ================================================================== */
  /*  3. Email body opens from cache in < 2s                              */
  /* ================================================================== */

  test("3 - email body opens from cache in under 2 seconds", async ({ page }) => {
    await page.goto("/mail", { waitUntil: "load" });

    // Wait for warm state
    await waitForWarmCache(page);

    // Click Starred folder to get the email list
    const starredBtn = page
      .locator("button")
      .filter({ hasText: /Starred/ })
      .first();
    await expect(starredBtn).toBeVisible({ timeout: 10_000 });
    await starredBtn.click();

    // Wait for email list to render
    const emailRows = page.locator("div.cursor-pointer");
    await expect(emailRows.first()).toBeVisible({ timeout: 15_000 });

    const rowCount = await emailRows.count();
    test.skip(rowCount === 0, "No cached emails in Starred folder — skipping timing test");

    // Click the first email and measure timing
    const start = Date.now();
    await emailRows.first().click();

    // Wait for reader content to appear — accepts either the HTML iframe
    // (for HTML emails) or the reader content container (for text emails).
    // The first visible of the two signals completion.
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

  /* ================================================================== */
  /*  4. No [Gmail] bare container in sidebar                             */
  /* ================================================================== */

  test("4 - no [Gmail] bare container in sidebar", async ({ page }) => {
    await page.goto("/mail", { waitUntil: "load" });

    // Wait for folders to load from the API
    await page.waitForTimeout(3000);

    // The mail page (page.tsx) filters the bare "[Gmail]" container from
    // the folder list (f.name !== "[Gmail]"). Verify no button shows
    // EXACT text "[Gmail]" without a trailing "/" (which would indicate a
    // subfolder path like "[Gmail]/Starred").
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

  /* ================================================================== */
  /*  5. Cold INBOX shows Preparing screen (not 3-pane layout)           */
  /* ================================================================== */

  test("5 - cold INBOX shows Preparing screen, not 3-pane content", async ({ page }) => {
    // Intercept sync-status to simulate cold cache (overall="syncing",
    // totalCached=0, INBOX cachedCount=0)
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

    // Intercept INBOX email listing to return pending state
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
    await page.waitForTimeout(2000);

    // The "h1 Mail" heading should always be present
    const mailHeading = page.locator("h1").filter({ hasText: "Mail" });
    await expect(mailHeading).toBeVisible({ timeout: 5000 });

    // ✅ The cold-gating "Preparing your mailbox…" screen should be visible
    // (data-testid="mail-gating-cold" rendered when isInboxCold is true)
    const coldGating = page.locator('[data-testid="mail-gating-cold"]');
    await expect(coldGating).toBeVisible({ timeout: 5000 });

    // ✅ "Preparing your mailbox…" heading text should be present
    const preparingHeading = page.getByText("Preparing your mailbox…");
    await expect(preparingHeading).toBeVisible({ timeout: 3000 });

    // ✅ 3-pane layout should NOT be visible — the flex container with
    // FolderSidebar + EmailList + EmailReader is replaced by cold gating
    // when isInboxCold is true (see page.tsx ternary at line 452).
    const threePaneLayout = page.locator(
      // The 3-pane container has border + rounded and wraps the three panels
      'div.flex.h-\\[calc\\(100vh-180px\\)\\]',
    );
    await expect(threePaneLayout).not.toBeVisible({ timeout: 3000 });

    // The email list panel (w-[350px] flex-shrink-0) should not be present
    const emailListPanel = page.locator('div.w-\\[350px\\].flex-shrink-0').first();
    await expect(emailListPanel).not.toBeVisible({ timeout: 3000 });

    // Also verify — no email rows should be present (cache is completely empty)
    const emailRows = page.locator("div.cursor-pointer");
    const rowCount = await emailRows.count();
    expect(rowCount).toBe(0);

    // Cleanup mocks
    await page.unrouteAll();
  });
});

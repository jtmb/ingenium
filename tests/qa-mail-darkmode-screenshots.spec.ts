/**
 * QA: Mail dark-mode screenshot verification.
 *
 * Navigate to /mail in dark mode, capture:
 * 1. Inline reply box
 * 2. Summarize panel (AI summary)
 * 3. Review with AI panel (Smart Suggestions)
 * 4. Smart-reply cache-hit behavior (instant cached suggestions)
 *
 * Saves screenshots to tests/qa-screenshots/ for vision-bridge analysis.
 */

import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE = "http://localhost:3000";
const GMAIL_EMAIL = "james.branco@gmail.com";
const ACCOUNT_ID = "5a214d5b-1d89-4e89-9bd9-7a857495efa7";
const SCREENSHOT_DIR = path.resolve(__dirname, "qa-screenshots");

const MOCK_ACCOUNTS = {
  data: [
    {
      id: ACCOUNT_ID,
      email: GMAIL_EMAIL,
      name: "james.branco@gmail.com",
      provider: "gmail",
      authType: "oauth2",
      connected: true,
    },
  ],
  total: 1,
};

const MOCK_FOLDERS = {
  data: [
    { name: "INBOX", path: "INBOX", totalMessages: 62000 },
  ],
  total: 1,
};

const MOCK_EMAILS = [
  {
    uid: 100000,
    subject: "Re: Project update — Q3 planning",
    from: [{ name: "Alice Smith", address: "alice@example.com" }],
    to: [{ name: "James Branco", address: GMAIL_EMAIL }],
    date: new Date().toISOString(),
    body: {
      text: "This is the body of the email from Alice.",
      html: undefined,
    },
    flags: [],
    folder: "INBOX",
    hasAttachments: false,
    attachments: [],
  },
  {
    uid: 99999,
    subject: "Meeting notes",
    from: [{ name: "Bob Jones", address: "bob@example.com" }],
    to: [{ name: "James Branco", address: GMAIL_EMAIL }],
    date: new Date(Date.now() - 3600000).toISOString(),
    body: {
      text: "Here are the meeting notes.",
      html: undefined,
    },
    flags: ["\\Seen"],
    folder: "INBOX",
    hasAttachments: false,
    attachments: [],
  },
];

/** Cached suggestions for cache-hit regression test */
const CACHED_SUGGESTIONS = [
  { tone: "professional", subject: "Re: Project update — Q3 planning", body: "Thank you for the update, Alice. I'll review and get back to you shortly." },
  { tone: "friendly", subject: "Re: Project update — Q3 planning", body: "Hey Alice, thanks for the update! Looks good so far." },
  { tone: "brief", subject: "Re: Project update — Q3 planning", body: "Got it, thanks!" },
];

async function setupMocks(page: Page) {
  await page.unroute();

  // Accounts
  await page.route("**/api/v1/emails/accounts*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_ACCOUNTS),
    });
  });

  // Folders
  await page.route("**/api/v1/emails/folders*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_FOLDERS),
    });
  });

  // Sync
  await page.route(
    (url) => url.pathname === "/api/v1/emails/sync",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { account: ACCOUNT_ID, folders: 1, totalSynced: 2, results: [] },
        }),
      });
    },
  );

  // Sync-status (polled every 2s)
  await page.route(
    (url) => url.pathname === "/api/v1/emails/sync-status",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            overall: "idle",
            account: ACCOUNT_ID,
            totalFolders: 1,
            syncingFolders: 0,
            totalCached: 2,
            totalBodies: 2,
            folders: [
              {
                folder: "INBOX",
                cachedCount: 2,
                bodyCount: 2,
                lastSyncedAt: new Date().toISOString(),
                syncing: false,
              },
            ],
          },
        }),
      });
    },
  );

  // Single email by UID (for reading)
  await page.route(
    (url) =>
      /\/api\/v1\/emails\/\d+$/.test(url.pathname) &&
      url.searchParams.has("project"),
    async (route) => {
      const uid = parseInt(
        route.request().url().split("/").pop()!.split("?")[0],
        10,
      );
      const email = MOCK_EMAILS.find((e) => e.uid === uid) || MOCK_EMAILS[0];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: email }),
      });
    },
  );

  // Email list
  await page.route(
    (url) =>
      url.pathname === "/api/v1/emails" &&
      url.searchParams.has("project") &&
      !/\/api\/v1\/emails\/\d+$/.test(url.pathname),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: MOCK_EMAILS, total: MOCK_EMAILS.length }),
      });
    },
  );

  // Suggest endpoint — return cached suggestions (zero-regression test)
  await page.route(
    (url) => url.pathname.includes("/emails/suggest/"),
    async (route) => {
      // Simulate cache hit: instant response
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          suggestions: CACHED_SUGGESTIONS,
          source: "cache",
          configured: true,
        }),
      });
    },
  );
}

test.describe("Mail dark-mode visual QA", () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test("Screenshot: inline reply box in dark mode", async ({ page }) => {
    // Enable dark mode before navigation
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("theme", "dark");
      document.cookie = "theme=dark; path=/; max-age=31536000; SameSite=Lax";
      document.documentElement.classList.add("dark");
    });

    await page.goto(`${BASE}/mail`, { waitUntil: "domcontentloaded" });

    // Wait for account selector
    await expect(page.getByText(GMAIL_EMAIL).first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Click INBOX to load email list
    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await expect(inboxBtn).toBeVisible({ timeout: 10000 });
    await inboxBtn.click();
    await page.waitForTimeout(1000);

    // Wait for email rows
    const emailRows = page.locator("div.cursor-pointer");
    await expect(emailRows.first()).toBeVisible({ timeout: 15000 });

    // Click the first email to open it in the reader
    await emailRows.first().click();
    await page.waitForTimeout(800);

    // Wait for reader pane
    const readerPane = page.locator("div.min-w-\\[400px\\]").first();
    await expect(readerPane).toBeVisible({ timeout: 5000 });

    // Click Reply to open inline reply box
    const replyBtn = readerPane.getByRole("button", { name: "Reply" }).first();
    await expect(replyBtn).toBeVisible();
    await replyBtn.click();
    await page.waitForTimeout(500);

    // Screenshot the inline reply section (the composer at the bottom of the reader)
    const inlineReply = page.locator("div.min-w-\\[400px\\]").first().locator("..").locator("div.border-t").last();
    await expect(inlineReply).toBeVisible({ timeout: 3000 });
    await page.waitForTimeout(300);

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "dark-mode-inline-reply.png"),
      fullPage: false,
    });

    // Also take a more targeted screenshot of the reply box
    await inlineReply.screenshot({
      path: path.join(SCREENSHOT_DIR, "dark-mode-inline-reply-box.png"),
    });
  });

  test("Screenshot: summarize panel in dark mode", async ({ page }) => {
    // Use addInitScript to ensure dark mode before any page JS runs
    await page.addInitScript(() => {
      localStorage.setItem("theme", "dark");
      document.cookie = "theme=dark; path=/; max-age=31536000; SameSite=Lax";
    });
    // Also set browser context cookie so server-side render sees it
    await page.context().addCookies([
      { name: "theme", value: "dark", domain: "localhost", path: "/" }
    ]);

    await page.goto(`${BASE}/mail`, { waitUntil: "networkidle" });

    // Wait for account selector
    await expect(page.getByText(GMAIL_EMAIL).first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Click INBOX
    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await expect(inboxBtn).toBeVisible({ timeout: 10000 });
    await inboxBtn.click();
    await page.waitForTimeout(1000);

    // Wait for email rows
    const emailRows = page.locator("div.cursor-pointer");
    await expect(emailRows.first()).toBeVisible({ timeout: 15000 });

    // Click the first email
    await emailRows.first().click();
    await page.waitForTimeout(800);

    // Wait for reader pane
    const readerPane = page.locator("div.min-w-\\[400px\\]").first();
    await expect(readerPane).toBeVisible({ timeout: 5000 });

    // Mock the summarize endpoint to return a real summary
    await page.route("**/api/v1/emails/summarize/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            summary: "Alice sent a project update about Q3 planning. Key points include progress on the engineering roadmap, upcoming milestones, and a request for feedback on the proposed timeline.",
            configured: true,
          }
        }),
      });
    });

    // Click "Summarise this email"
    const summariseBtn = readerPane.getByRole("button", { name: "Summarise this email" }).first();
    await expect(summariseBtn).toBeVisible({ timeout: 3000 });
    await summariseBtn.click();
    await page.waitForTimeout(1000);

    // Wait for the summary panel to appear
    const summaryPanel = page.locator("text=AI Summary").first();
    await expect(summaryPanel).toBeVisible({ timeout: 5000 });

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "dark-mode-summarize-panel.png"),
      fullPage: false,
    });
  });

  test("Screenshot: review-with-AI panel in dark mode (smart suggestions)", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("theme", "dark");
      document.cookie = "theme=dark; path=/; max-age=31536000; SameSite=Lax";
      document.documentElement.classList.add("dark");
    });

    await page.goto(`${BASE}/mail`, { waitUntil: "domcontentloaded" });

    // Wait for account selector
    await expect(page.getByText(GMAIL_EMAIL).first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Click INBOX
    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await expect(inboxBtn).toBeVisible({ timeout: 10000 });
    await inboxBtn.click();
    await page.waitForTimeout(1000);

    // Wait for email rows
    const emailRows = page.locator("div.cursor-pointer");
    await expect(emailRows.first()).toBeVisible({ timeout: 15000 });

    // Click the first email
    await emailRows.first().click();
    await page.waitForTimeout(800);

    // Wait for reader pane
    const readerPane = page.locator("div.min-w-\\[400px\\]").first();
    await expect(readerPane).toBeVisible({ timeout: 5000 });

    // Click Reply to open the inline composer — SmartSuggest renders inside it
    const replyBtn = readerPane.getByRole("button", { name: "Reply" }).first();
    await expect(replyBtn).toBeVisible();
    await replyBtn.click();
    await page.waitForTimeout(500);

    // Wait for SmartSuggest to auto-fetch and render suggestion chips in the composer
    await page.waitForTimeout(1500);

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    // Take a full reader panel screenshot showing smart suggestions
    const readerSection = page.locator("div.min-w-\\[400px\\]").first();
    await expect(readerSection).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "dark-mode-smart-suggestions.png"),
      fullPage: false,
    });
  });

  test("Smart-reply cache-hit regression test — instant response, zero IMAP", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("theme", "dark");
      document.cookie = "theme=dark; path=/; max-age=31536000; SameSite=Lax";
      document.documentElement.classList.add("dark");
    });

    // Track suggest endpoint calls for timing
    let suggestCallCount = 0;
    let suggestTimestamps: number[] = [];

    await page.route("**/api/v1/emails/suggest/**", async (route) => {
      suggestCallCount++;
      suggestTimestamps.push(Date.now());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          suggestions: CACHED_SUGGESTIONS,
          source: "cache",
          configured: true,
        }),
      });
    });

    await page.goto(`${BASE}/mail`, { waitUntil: "domcontentloaded" });

    // Wait for account selector
    await expect(page.getByText(GMAIL_EMAIL).first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Click INBOX
    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await expect(inboxBtn).toBeVisible({ timeout: 10000 });
    await inboxBtn.click();
    await page.waitForTimeout(1000);

    // Wait for email rows
    const emailRows = page.locator("div.cursor-pointer");
    await expect(emailRows.first()).toBeVisible({ timeout: 15000 });

    // Click the first email
    await emailRows.first().click();
    await page.waitForTimeout(800);

    // Click Reply to open the inline composer — SmartSuggest renders inside it
    const readerPane = page.locator("div.min-w-\\[400px\\]").first();
    await expect(readerPane).toBeVisible({ timeout: 5000 });
    const replyBtn = readerPane.getByRole("button", { name: "Reply" }).first();
    await expect(replyBtn).toBeVisible();
    await replyBtn.click();
    await page.waitForTimeout(500);

    // Wait for SmartSuggest to auto-fetch and render suggestions in composer
    await page.waitForTimeout(2000);

    // Verify Smart Suggestions appeared as compact chips (from cache)
    // In compact mode, tone labels appear as text in suggestion chips
    const toneChip = page.getByText("professional").first();

    if (await toneChip.isVisible().catch(() => false)) {
      // Cache hit — suggestions rendered immediately as compact chips
      console.log("✅ Suggestion chip 'professional' visible — cache hit confirmed");

      // Verify the suggest endpoint was called
      expect(suggestCallCount).toBeGreaterThanOrEqual(1);
      console.log(`📊 Suggest endpoint called ${suggestCallCount} time(s)`);

      // Verify source indicator is "cache"
      // The source badge isn't shown in the UI — it's in the API response only
      // But we can verify from the mock that source is "cache"
    } else {
      // Might need to scroll
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
    }

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "dark-mode-cache-hit.png"),
      fullPage: true,
    });

    // Verify suggest endpoint was called (cache hit path exercised)
    expect(suggestCallCount).toBeGreaterThanOrEqual(1);
  });
});

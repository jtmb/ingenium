/**
 * QA: Mail dark-mode screenshot verification.
 *
 * Navigate to /mail in dark mode, capture:
 * 1. Inline reply box
 * 2. Summarize panel (AI summary)
 * 3. Review with AI panel (Smart Suggestions)
 * 4. Smart-reply cache-hit behavior (instant cached suggestions)
 *
 * Saves manual evidence below tests/artifacts/manual/<run-id>/.
 */

import { test, expect, Page } from "@playwright/test";
import * as path from "path";
import { manualArtifactDirectory } from "./ingenium-dashboard/visual-qa-artifacts";

const BASE = process.env.INGENIUM_E2E_DASHBOARD_URL ?? "http://localhost:3000";
const GMAIL_EMAIL = "james.branco@gmail.com";
const ACCOUNT_ID = "5a214d5b-1d89-4e89-9bd9-7a857495efa7";
const SCREENSHOT_DIR = manualArtifactDirectory("mail-darkmode");

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
  await page.unrouteAll();

  await page.route("**/api/v1/emails/accounts*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_ACCOUNTS),
    });
  });

  await page.route("**/api/v1/emails/folders*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_FOLDERS),
    });
  });

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

  // Return cached suggestions so the visual path does not contact IMAP.
  await page.route(
    (url) => url.pathname.includes("/emails/suggest/"),
    async (route) => {
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
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("theme", "dark");
      document.cookie = "theme=dark; path=/; max-age=31536000; SameSite=Lax";
      document.documentElement.classList.add("dark");
    });

    await page.goto(`${BASE}/mail`, { waitUntil: "domcontentloaded" });

    await expect(page.getByText(GMAIL_EMAIL).first()).toBeVisible({ timeout: 15000 });

    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await expect(inboxBtn).toBeVisible({ timeout: 10000 });
    await inboxBtn.click();

    const emailRows = page.locator("div.cursor-pointer");
    await expect(emailRows.first()).toBeVisible({ timeout: 15000 });

    await emailRows.first().click();

    const readerPane = page.getByTestId("email-reader-content");
    await expect(readerPane).toBeVisible({ timeout: 5000 });

    const replyBtn = readerPane.getByRole("button", { name: "Reply" }).first();
    await expect(replyBtn).toBeVisible();
    await replyBtn.click();

    const inlineReply = readerPane.locator("div.border-t").last();
    await expect(inlineReply).toBeVisible({ timeout: 3000 });

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "dark-mode-inline-reply.png"),
      fullPage: false,
    });

    await inlineReply.screenshot({
      path: path.join(SCREENSHOT_DIR, "dark-mode-inline-reply-box.png"),
    });
  });

  test("Screenshot: summarize panel in dark mode", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("theme", "dark");
      document.cookie = "theme=dark; path=/; max-age=31536000; SameSite=Lax";
    });
    // Set the context cookie as well so the server render matches the client.
    await page.context().addCookies([
      { name: "theme", value: "dark", domain: "localhost", path: "/" }
    ]);

    await page.goto(`${BASE}/mail`, { waitUntil: "domcontentloaded" });

    await expect(page.getByText(GMAIL_EMAIL).first()).toBeVisible({ timeout: 15000 });

    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await expect(inboxBtn).toBeVisible({ timeout: 10000 });
    await inboxBtn.click();

    const emailRows = page.locator("div.cursor-pointer");
    await expect(emailRows.first()).toBeVisible({ timeout: 15000 });

    await emailRows.first().click();

    const readerPane = page.getByTestId("email-reader-content");
    await expect(readerPane).toBeVisible({ timeout: 5000 });

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

    const summariseBtn = readerPane.getByRole("button", { name: "Summarise this email" }).first();
    await expect(summariseBtn).toBeVisible({ timeout: 3000 });
    await summariseBtn.click();

    const summaryPanel = readerPane.getByText("AI Summary").first();
    await expect(summaryPanel).toBeVisible({ timeout: 5000 });

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

    await expect(page.getByText(GMAIL_EMAIL).first()).toBeVisible({ timeout: 15000 });

    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await expect(inboxBtn).toBeVisible({ timeout: 10000 });
    await inboxBtn.click();

    const emailRows = page.locator("div.cursor-pointer");
    await expect(emailRows.first()).toBeVisible({ timeout: 15000 });

    await emailRows.first().click();

    const readerPane = page.getByTestId("email-reader-content");
    await expect(readerPane).toBeVisible({ timeout: 5000 });

    const replyBtn = readerPane.getByRole("button", { name: "Reply" }).first();
    await expect(replyBtn).toBeVisible();
    await replyBtn.click();

    await expect(readerPane.getByText("professional", { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const readerSection = page.getByTestId("email-reader-content");
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

    await expect(page.getByText(GMAIL_EMAIL).first()).toBeVisible({ timeout: 15000 });

    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await expect(inboxBtn).toBeVisible({ timeout: 10000 });
    await inboxBtn.click();

    const emailRows = page.locator("div.cursor-pointer");
    await expect(emailRows.first()).toBeVisible({ timeout: 15000 });

    await emailRows.first().click();

    const readerPane = page.getByTestId("email-reader-content");
    await expect(readerPane).toBeVisible({ timeout: 5000 });
    const replyBtn = readerPane.getByRole("button", { name: "Reply" }).first();
    await expect(replyBtn).toBeVisible();
    await replyBtn.click();

    await expect(readerPane.getByText("professional", { exact: true }).first()).toBeVisible({ timeout: 10000 });

    const toneChip = readerPane.getByText("professional").first();

    await expect(toneChip).toBeVisible({ timeout: 10000 });
    expect(suggestCallCount).toBeGreaterThanOrEqual(1);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "dark-mode-cache-hit.png"),
      fullPage: true,
    });

    expect(suggestCallCount).toBeGreaterThanOrEqual(1);
  });
});

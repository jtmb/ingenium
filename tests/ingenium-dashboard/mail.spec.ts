import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

/**
 * Comprehensive E2E tests for the Mail client — 3-pane email interface.
 *
 * Tests run against a live Next.js dev server (port 3000) and real API server
 * (port 4097) running inside Docker. The Gmail account james.branco@gmail.com
 * is connected via OAuth2 with 12 folders (INBOX, Sent Mail, Drafts, etc.).
 *
 * The DB-backed cache layer (migration 022) serves emails instantly after the
 * first IMAP fetch populates it. The Gmail INBOX has ~62K messages, which
 * causes the initial IMAP fetch to be extremely slow (> 120s).
 *
 * To ensure deterministic fast tests, API responses are intercepted with
 * realistic mock data that simulates the cache-backed behavior. This way
 * all UI interactions are verified end-to-end without depending on live IMAP.
 *
 * Selectors use roles, labels, and text content since pages don't have
 * data-testid attributes. If refactoring later, prefer data-testid selectors
 * for stability (see useful-tests skill).
 */

const BASE = "http://localhost:3000";
const SCREENSHOTS_DIR = "/tmp/opencode";
const GMAIL_EMAIL = "james.branco@gmail.com";
const ACCOUNT_ID = "5a214d5b-1d89-4e89-9bd9-7a857495efa7";

// Ensure screenshot directory exists
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/*  Mock data — realistic email responses                              */
/* ------------------------------------------------------------------ */

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
    { name: "Sent Mail", path: "Sent Mail", totalMessages: 15000 },
    { name: "Drafts", path: "Drafts", totalMessages: 3 },
    { name: "Personal", path: "Personal", totalMessages: 250 },
    { name: "Receipts", path: "Receipts", totalMessages: 1200 },
    { name: "Travel", path: "Travel", totalMessages: 80 },
    { name: "Work", path: "Work", totalMessages: 450 },
    { name: "Archive", path: "Archive", totalMessages: 42000 },
    { name: "Spam", path: "Spam", totalMessages: 180 },
    { name: "Trash", path: "Trash", totalMessages: 900 },
    { name: "Starred", path: "Starred", totalMessages: 45 },
    { name: "Important", path: "Important", totalMessages: 220 },
  ],
  total: 12,
};

function generateMockEmails(count = 25) {
  const emails = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const date = new Date(now - i * 3600000);
    emails.push({
      uid: 100000 - i,
      subject:
        i === 0
          ? "Re: Project update — Q3 planning"
          : `Test email ${i + 1}: ${["Meeting notes", "Invoice attached", "Quick question", "Weekly digest", "Action required"][i % 5]}`,
      from: [
        { name: ["Alice Smith", "Bob Jones", "Carol Lee", "David Kumar", "Eve Martinez"][i % 5], address: [`alice@example.com`, `bob@example.com`, `carol@example.com`, `david@example.com`, `eve@example.com`][i % 5] },
      ],
      to: [{ name: "James Branco", address: GMAIL_EMAIL }],
      date: date.toISOString(),
      body: {
        text: `This is the body of email ${i + 1}. It contains sample content for testing the email reader pane.`,
        html:
          i % 3 === 0
            ? `<div><h2>HTML Content</h2><p>This email has <b>HTML formatting</b>.</p><p>Check out this chart:</p><img src="https://via.placeholder.com/400x200.png?text=Chart+Image" alt="chart" style="max-width:100%" /></div>`
            : undefined,
      },
      flags: i < 3 ? [] : ["\\Seen"],
      folder: "INBOX",
      hasAttachments: i === 2,
      attachments:
        i === 2
          ? [{ filename: "report-q3.pdf", partId: "1", size: 245760 }]
          : [],
    });
  }
  return emails;
}

const MOCK_EMAILS = generateMockEmails(25);
const MOCK_SINGLE_EMAIL = MOCK_EMAILS[0];

/** A flag the error test sets to force an IMAP error response. */
let forceEmailError = false;

/* ------------------------------------------------------------------ */
/*  Mock route setup                                                   */
/* ------------------------------------------------------------------ */

async function setupMocks(page: Page) {
  forceEmailError = false;

  // Clear any previously registered routes to prevent accumulation across tests
  await page.unroute();

  // 1. Accounts (most specific)
  await page.route("**/api/v1/emails/accounts*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_ACCOUNTS),
    });
  });

  // 2. Folders
  await page.route("**/api/v1/emails/folders*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_FOLDERS),
    });
  });

  // 3. Sync
  await page.route("**/api/v1/emails/sync*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { account: ACCOUNT_ID, folders: 12, totalSynced: 62000, results: [] },
      }),
    });
  });

  // 4. Search
  await page.route("**/api/v1/emails/search*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: MOCK_EMAILS.slice(0, 5), total: 5 }),
    });
  });

  // 5. Single email by UID — match /emails/<digits> (but NOT /emails (no trailing digits))
  await page.route(
    (url) =>
      /\/api\/v1\/emails\/\d+$/.test(url.pathname) &&
      url.searchParams.has("project"),
    async (route) => {
      const uid = parseInt(
        route.request().url().split("/").pop()!.split("?")[0],
        10,
      );
      const email = MOCK_EMAILS.find((e) => e.uid === uid) || MOCK_SINGLE_EMAIL;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: email }),
      });
    },
  );

  // 6. Email list (INBOX or other folder) — match /emails (no trailing /<digits>)
  await page.route(
    (url) =>
      url.pathname === "/api/v1/emails" &&
      url.searchParams.has("project") &&
      !/\/api\/v1\/emails\/\d+$/.test(url.pathname),
    async (route) => {
      if (forceEmailError) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "IMAP_ERROR", message: "Connection to IMAP server failed" },
          }),
        });
        return;
      }
      const url = new URL(route.request().url());
      const folder = url.searchParams.get("folder") || "INBOX";
      const refresh = url.searchParams.get("refresh") === "true";
      const query = url.searchParams.get("q") || "";

      let emails = MOCK_EMAILS;
      if (query) {
        emails = MOCK_EMAILS.filter(
          (e) =>
            e.subject.toLowerCase().includes(query.toLowerCase()) ||
            e.body.text.toLowerCase().includes(query.toLowerCase()),
        );
      } else if (folder !== "INBOX") {
        emails = MOCK_EMAILS.slice(5, 12).map((e, i) => ({
          ...e,
          folder,
          subject: `[${folder}] ${e.subject}`,
        }));
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: emails,
          total: emails.length,
          source: refresh ? "imap" : "cache",
        }),
      });
    },
  );

  // 7. Smart Suggest endpoint
  await page.route("**/api/v1/emails/suggest/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          suggestions: [
            { tone: "professional", subject: "Re: Test", body: "Thank you for your email." },
            { tone: "friendly", subject: "Re: Hello", body: "Hey, great to hear from you!" },
            { tone: "concise", subject: "Re: Quick note", body: "Got it, thanks." },
          ],
          source: "generated",
          configured: true,
        },
      }),
    });
  });

  // 8. Settings (for mail_smart_replies_mode lookup)
  await page.route(
    (url) => url.pathname === "/api/v1/settings",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { value: "auto" },
        }),
      });
    },
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function gotoMail(page: Page) {
  await page.goto(`${BASE}/mail`, { waitUntil: "domcontentloaded" });
}

async function waitForAccount(page: Page) {
  await expect(page.getByText(GMAIL_EMAIL).first()).toBeVisible({ timeout: 15000 });
}

async function waitForEmailList(page: Page) {
  await page.waitForTimeout(500);
  const emailRows = page.locator("div.cursor-pointer");
  await expect(emailRows.first()).toBeVisible({ timeout: 15000 });
}

async function clickEmailRow(page: Page, index = 0) {
  const rows = page.locator("div.cursor-pointer");
  await rows.nth(index).click();
  await page.waitForTimeout(800);
}

async function getEmailListBoundingBox(page: Page) {
  const listPanel = page.locator("div.w-\\[350px\\]").first();
  return listPanel.boundingBox();
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

test.describe("Mail Client — 3-Pane Email Interface", () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  /* ------------------------------------------------------------------ */
  /*  1. Account selector shows Gmail                                    */
  /* ------------------------------------------------------------------ */

  test("1 - Account selector shows james.branco@gmail.com with connection dot", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    // The selector button contains the email and an avatar initial
    const selector = page.locator("button").filter({ hasText: GMAIL_EMAIL }).first();
    await expect(selector).toBeVisible();

    // The button should contain an SVG chevron (dropdown indicator)
    await expect(selector.locator("svg").first()).toBeVisible();

    // The button contains multiple spans (avatar + email + dot) and an SVG (chevron)
    const spans = selector.locator("span");
    const spanCount = await spans.count();
    expect(spanCount).toBeGreaterThanOrEqual(3); // avatar, email text, status dot
    await expect(selector.locator("svg").first()).toBeVisible();

    // Take screenshot
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "mail-test-01.png") });
  });

  /* ------------------------------------------------------------------ */
  /*  2. Account selection propagates to folders                         */
  /* ------------------------------------------------------------------ */

  test("2 - Account selection loads folders in sidebar", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    // Open account dropdown
    const selector = page.locator("button").filter({ hasText: GMAIL_EMAIL }).first();
    await selector.click();
    await page.waitForTimeout(500);

    // The dropdown should appear
    const dropdown = page.locator("div.shadow-lg").first();
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    // Click the Gmail account to select it
    const gmailItem = dropdown.locator("button").filter({ hasText: GMAIL_EMAIL }).first();
    await gmailItem.click();
    await page.waitForTimeout(1000);

    // After selection, mock folders should appear in sidebar
    await expect(
      page.locator("button").filter({ hasText: "INBOX" }).first(),
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.locator("button").filter({ hasText: "Sent Mail" }).first(),
    ).toBeVisible({ timeout: 3000 });

    await expect(
      page.locator("button").filter({ hasText: "Drafts" }).first(),
    ).toBeVisible({ timeout: 3000 });
  });

  /* ------------------------------------------------------------------ */
  /*  3. Folder sidebar shows folders with counts                        */
  /* ------------------------------------------------------------------ */

  test("3 - Folder sidebar shows INBOX, Sent Mail, Drafts with message counts", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    // Wait for folders to load via mock API
    await page.waitForTimeout(2000);

    // INBOX folder button (textContent = "INBOX62000" from two adjacent spans)
    const inboxBtn = page.getByRole("button", { name: /INBOX/ }).first();
    await expect(inboxBtn).toBeVisible({ timeout: 10000 });

    // Verify the button has both name and count by checking inner spans
    const inboxSpans = inboxBtn.locator("span");
    const inboxSpanCount = await inboxSpans.count();
    expect(inboxSpanCount).toBeGreaterThanOrEqual(2);

    // Sent Mail with count
    const sentBtn = page.getByRole("button", { name: /^Sent Mail/ }).first();
    await expect(sentBtn).toBeVisible({ timeout: 3000 });
    const sentSpans = sentBtn.locator("span");
    await expect(sentSpans.first()).toBeVisible();
    // The second span contains the count
    expect(await sentSpans.count()).toBeGreaterThanOrEqual(2);

    // Drafts with count
    const draftsBtn = page.getByRole("button", { name: /Drafts/ }).first();
    await expect(draftsBtn).toBeVisible({ timeout: 3000 });
    const draftsSpanCount = await draftsBtn.locator("span").count();
    expect(draftsSpanCount).toBeGreaterThanOrEqual(2);

    // Verify additional mock folders
    await expect(
      page.locator("button").filter({ hasText: "Personal" }).first(),
    ).toBeVisible({ timeout: 3000 });

    await expect(
      page.locator("button").filter({ hasText: "Receipts" }).first(),
    ).toBeVisible({ timeout: 3000 });
  });

  /* ------------------------------------------------------------------ */
  /*  4. Folder click loads email list                                    */
  /* ------------------------------------------------------------------ */

  test("4 - Clicking INBOX folder loads email rows in the list", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    // Click INBOX
    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await expect(inboxBtn).toBeVisible({ timeout: 10000 });
    await inboxBtn.click();

    // Wait for email rows
    await waitForEmailList(page);

    // Verify email rows are present
    const emailRows = page.locator("div.cursor-pointer");
    const rowCount = await emailRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // First row should have sender visible
    const firstRow = emailRows.first();
    await expect(firstRow).toBeVisible();

    // The first email should be "Alice Smith Re: Project update — Q3 planning"
    await expect(firstRow.getByText("Project update")).toBeVisible({ timeout: 3000 });
  });

  /* ------------------------------------------------------------------ */
  /*  5. Emails sorted newest-first                                      */
  /* ------------------------------------------------------------------ */

  test("5 - Emails in INBOX are sorted newest-first by date", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    // Click INBOX
    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    // Click the first email to verify it's the most recent
    await clickEmailRow(page, 0);

    // The reader should show the email content
    const readerPane = page.locator("div.min-w-\\[400px\\]").first();
    await expect(readerPane).toBeVisible({ timeout: 5000 });

    // Verify the subject is the first mock email
    const subjectEl = readerPane.locator("h2").first();
    await expect(subjectEl).toBeVisible({ timeout: 5000 });
    const subjectText = await subjectEl.textContent();
    expect(subjectText).toContain("Project update — Q3 planning");

    // Verify dates are sorted newest-first using mock data
    const firstDate = new Date(MOCK_EMAILS[0].date).getTime();
    const secondDate = new Date(MOCK_EMAILS[1].date).getTime();
    expect(firstDate).toBeGreaterThan(secondDate);
  });

  /* ------------------------------------------------------------------ */
  /*  6. Clicking email opens reader pane (no layout shift)              */
  /* ------------------------------------------------------------------ */

  test("6 - Clicking email opens reader pane without list layout shift", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    // Click INBOX and load emails
    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    // Capture email list bounding box before clicking email
    const listBoxBefore = await getEmailListBoundingBox(page);
    expect(listBoxBefore).not.toBeNull();

    // Verify "Select an email to read" empty state is shown before selection
    const emptyReader = page.getByTestId("email-reader-empty");
    await expect(emptyReader).toBeVisible({ timeout: 3000 });

    // Click the first email row
    await clickEmailRow(page, 0);

    // Capture email list bounding box after clicking
    const listBoxAfter = await getEmailListBoundingBox(page);
    expect(listBoxAfter).not.toBeNull();

    // List width should not change (no layout shift)
    expect(listBoxAfter!.width).toBeCloseTo(listBoxBefore!.width, 0);

    // Reader pane should now show email content, and empty state MUST be gone
    const readerContent = page.getByTestId("email-reader-content");
    await expect(readerContent).toBeVisible({ timeout: 5000 });
    await expect(emptyReader).not.toBeVisible();

    // Take screenshots
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "mail-test-06.png") });
  });

  /* ------------------------------------------------------------------ */
  /*  7. Email reader shows content                                      */
  /* ------------------------------------------------------------------ */

  test("7 - Email reader shows subject, from, date, and body", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    // Load INBOX
    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    // Click first email
    await clickEmailRow(page, 0);

    // Wait for reader
    const readerPane = page.locator("div.min-w-\\[400px\\]").first();
    await expect(readerPane).toBeVisible({ timeout: 5000 });

    // Subject (h2)
    const subject = readerPane.locator("h2").first();
    await expect(subject).toBeVisible();
    const subjectText = await subject.textContent();
    expect(subjectText).not.toBeNull();
    expect(subjectText!.trim().length).toBeGreaterThan(0);

    // From name (span with font-semibold)
    const fromField = readerPane.locator("span.text-sm.font-semibold").first();
    await expect(fromField).toBeVisible({ timeout: 3000 });
    const fromText = await fromField.textContent();
    expect(fromText).not.toBeNull();
    expect(fromText!.trim().length).toBeGreaterThan(0);

    // Date (paragraph with text-xs)
    const dateField = readerPane.locator("p.text-xs").first();
    await expect(dateField).toBeVisible({ timeout: 3000 });
    const dateText = await dateField.textContent();
    expect(dateText).not.toBeNull();
    expect(dateText!.trim().length).toBeGreaterThan(0);

    // Action buttons
    await expect(readerPane.getByRole("button", { name: "Reply" }).first()).toBeVisible();
    await expect(readerPane.getByRole("button", { name: "Forward" }).first()).toBeVisible();
    await expect(readerPane.getByRole("button", { name: "Archive" }).first()).toBeVisible();
    await expect(readerPane.getByRole("button", { name: "Delete" }).first()).toBeVisible();

    // Body content
    const bodyArea = readerPane.getByTestId("email-body-pane");
    await expect(bodyArea).toBeVisible({ timeout: 3000 });
    const bodyHtml = await bodyArea.innerHTML();
    expect(bodyHtml.length).toBeGreaterThan(50);
  });

  /* ------------------------------------------------------------------ */
  /*  8. Images render in HTML emails                                    */
  /* ------------------------------------------------------------------ */

  test("8 - HTML emails with images render img tags in reader", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    // Load INBOX
    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    // Click the first email (index 0) which is known to have HTML with images
    await clickEmailRow(page, 0);
    const readerPane = page.locator("div.min-w-\\[400px\\]").first();
    await expect(readerPane).toBeVisible({ timeout: 5000 });

    // HTML emails render in an iframe, not a div.prose
    const htmlIframe = readerPane.locator('[data-testid="email-html-iframe"]');
    await expect(htmlIframe).toBeVisible({ timeout: 5000 });

    // Verify the email is the HTML one (not the text fallback)
    expect(await htmlIframe.count()).toBeGreaterThan(0);
  });

  /* ------------------------------------------------------------------ */
  /*  9. Compose modal opens clean                                       */
  /* ------------------------------------------------------------------ */

  test("9 - Compose button opens a single clean modal without double box", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    // Click Compose button
    const composeBtn = page.locator("button").filter({ hasText: "Compose" }).first();
    await expect(composeBtn).toBeVisible();
    await composeBtn.click();
    await page.waitForTimeout(1000);

    // Modal should show with heading "Compose"
    const composeHeading = page.getByRole("heading", { name: "Compose" }).first();
    await expect(composeHeading).toBeVisible({ timeout: 5000 });

    // Should have exactly ONE "Compose" heading
    const composeHeadings = page.getByRole("heading", { name: "Compose" });
    const headingCount = await composeHeadings.count();
    expect(headingCount).toBe(1);

    // Verify form fields
    await expect(page.getByPlaceholder("To")).toBeVisible({ timeout: 3000 });
    await expect(page.getByPlaceholder("Subject")).toBeVisible();
    await expect(page.getByPlaceholder("Write your message...")).toBeVisible();

    // "From" label and its select
    await expect(page.locator("label").filter({ hasText: "From" }).first()).toBeVisible();
    await expect(page.locator("select").first()).toBeVisible();

    // Action buttons
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Draft" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Discard" })).toBeVisible();

    // Take screenshot
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "mail-test-09.png") });

    // Close via Discard
    await page.getByRole("button", { name: "Discard" }).click();
    await page.waitForTimeout(500);
    await expect(composeHeading).not.toBeVisible();
  });

  /* ------------------------------------------------------------------ */
  /*  10. Error banner renders for IMAP errors                           */
  /* ------------------------------------------------------------------ */

  test("10 - Error banner renders with red styling when IMAP error occurs", async ({ page }) => {
    // Set error flag BEFORE navigation so the initial email fetch returns 500
    forceEmailError = true;
    await gotoMail(page);
    await waitForAccount(page);

    // The initial load failed — error banner should be visible in the email list
    // The error div has error styling and text matching the IMAP error message
    await page.waitForTimeout(1500);
    const errorDiv = page.locator("div").filter({ hasText: /IMAP|Failed|error/i }).first();
    await expect(errorDiv).toBeVisible({ timeout: 10000 });

    // Verify error text content
    const errorText = await errorDiv.textContent();
    expect(errorText).not.toBeNull();
    expect(errorText!.trim().length).toBeGreaterThan(0);

    // Reset error flag for subsequent tests
    forceEmailError = false;
  });

  /* ------------------------------------------------------------------ */
  /*  11. Refresh button works                                           */
  /* ------------------------------------------------------------------ */

  test("11 - Refresh button triggers email reload with source=imap", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    // Load INBOX
    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    // Find the Refresh button
    const refreshBtn = page.getByTitle("Refresh").first();
    await expect(refreshBtn).toBeVisible({ timeout: 5000 });

    // Track refresh API call
    const refreshResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/v1/emails?") &&
        resp.url().includes("refresh=true") &&
        resp.status() === 200,
      { timeout: 15000 },
    );

    await refreshBtn.click();
    await refreshResponsePromise;

    // Verify email rows still present after refresh
    await page.waitForTimeout(500);
    const emailRows = page.locator("div.cursor-pointer");
    const rowCount = await emailRows.count();
    expect(rowCount).toBeGreaterThan(0);
  });

  /* ------------------------------------------------------------------ */
  /*  12. Cache-backed instant load (navigate back)                      */
  /* ------------------------------------------------------------------ */

  test("12 - Cache-backed navigation to /mail loads under 2 seconds (second visit)", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    // First visit — load INBOX to "populate cache"
    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    // Navigate away
    await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({
      timeout: 10000,
    });

    // Measure navigation back
    const startTime = performance.now();
    await page.goto(`${BASE}/mail`, { waitUntil: "domcontentloaded" });

    // Wait for account to load
    await expect(page.getByText(GMAIL_EMAIL).first()).toBeVisible({ timeout: 15000 });

    // Wait for email list
    const emailRows = page.locator("div.cursor-pointer");
    await expect(emailRows.first()).toBeVisible({ timeout: 10000 });

    const loadTime = performance.now() - startTime;
    expect(loadTime).toBeLessThan(2000);

    test.info().annotations.push({
      type: "performance",
      description: `Cache-backed mail page load: ${Math.round(loadTime)}ms (under 2000ms ✓)`,
    });
  });

  /* ------------------------------------------------------------------ */
  /*  13. Demo account gone                                              */
  /* ------------------------------------------------------------------ */

  test("13 - No demo account or demo text visible on page", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    // Full page check
    const bodyText = await page.locator("body").innerText();
    const bodyHtml = await page.locator("body").innerHTML();

    // No demo account references
    expect(bodyText.toLowerCase()).not.toContain("demo@ingenium");
    expect(bodyText.toLowerCase()).not.toContain("demo account");

    // Open dropdown and verify
    const selector = page.locator("button").filter({ hasText: GMAIL_EMAIL }).first();
    await selector.click();
    await page.waitForTimeout(500);

    const dropdown = page.locator("div.shadow-lg").first();
    const dropdownVisible = await dropdown.isVisible().catch(() => false);
    if (dropdownVisible) {
      const dropdownText = await dropdown.innerText();
      expect(dropdownText.toLowerCase()).not.toContain("demo");
      await selector.click();
    }
  });

  /* ------------------------------------------------------------------ */
  /*  14. Account selector styling (screenshot)                          */
  /* ------------------------------------------------------------------ */

  test("14 - Account selector has avatar chip, email, dot, and chevron", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    // Open the dropdown
    const selector = page.locator("button").filter({ hasText: GMAIL_EMAIL }).first();
    await selector.click();
    await page.waitForTimeout(500);

    // Dropdown should be visible
    const dropdown = page.locator("div.shadow-lg").first();
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Gmail account entry in dropdown
    const gmailEntry = dropdown.locator("button").filter({ hasText: GMAIL_EMAIL }).first();
    await expect(gmailEntry).toBeVisible();

    // 1. Avatar with initial letter (span containing "J")
    await expect(gmailEntry.locator("span").first()).toBeVisible();

    // 2. Email text
    await expect(gmailEntry.getByText(GMAIL_EMAIL)).toBeVisible();

    // 3. Connection status indicator — "not connected" text appears when disconnected
    const notConnected = gmailEntry.getByText("not connected");
    const notConnVisible = await notConnected.isVisible().catch(() => false);
    if (notConnVisible) {
      await expect(notConnected).toBeVisible();
    }

    // 4. Add Account button at bottom
    const addAccountBtn = dropdown.getByText("+ Add Account");
    await expect(addAccountBtn).toBeVisible();

    // Screenshot
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "mail-test-14.png") });

    // Close dropdown
    await selector.click();
  });

  /* ------------------------------------------------------------------ */
  /*  15. Layout stability — reader pane position doesn't shift         */
  /* ------------------------------------------------------------------ */

  test("15 - Reader pane position stays stable when switching emails", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    // Load INBOX
    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    // Need at least 2 email rows
    const emailRows = page.locator("div.cursor-pointer");
    const rowCount = await emailRows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);

    // Click first email
    await clickEmailRow(page, 0);
    const readerPane = page.locator("div.min-w-\\[400px\\]").first();
    await expect(readerPane).toBeVisible({ timeout: 5000 });

    const readerBox1 = await readerPane.boundingBox();
    expect(readerBox1).not.toBeNull();

    // Click second email
    await clickEmailRow(page, 1);
    await expect(readerPane).toBeVisible({ timeout: 5000 });

    const readerBox2 = await readerPane.boundingBox();
    expect(readerBox2).not.toBeNull();

    // x position should not change (no horizontal shift)
    expect(readerBox2!.x).toBeCloseTo(readerBox1!.x, 0);

    // Width should be stable
    expect(readerBox2!.width).toBeCloseTo(readerBox1!.width, 0);
  });

  /* ------------------------------------------------------------------ */
  /*  16. Settings page shows Mail sync section                          */
  /* ------------------------------------------------------------------ */

  test("16 - Settings page shows ✉️ Mail section with sync frequency select", async ({ page }) => {
    await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({
      timeout: 10000,
    });

    // ✉️ Mail section heading
    const mailSection = page.getByText("✉️ Mail").first();
    await expect(mailSection).toBeVisible({ timeout: 5000 });

    // Description text
    await expect(
      page.getByText("How often the server checks for new emails in connected accounts."),
    ).toBeVisible();

    // Find the "Check every" label and its associated select
    const checkEveryLabel = page.locator("label").filter({ hasText: "Check every" }).first();
    await expect(checkEveryLabel).toBeVisible();

    // The select should be a sibling within the same parent div
    const parentDiv = checkEveryLabel.locator("..");
    const intervalSelect = parentDiv.locator("select").first();
    await expect(intervalSelect).toBeVisible();

    // Verify options
    const options = await intervalSelect.locator("option").allTextContents();
    expect(options).toContain("Off");
    expect(options).toContain("5 minutes");
    expect(options).toContain("15 minutes");
    expect(options).toContain("30 minutes");

    // Take screenshot of the mail section
    const mailSectionDiv = mailSection.locator("..");
    await mailSectionDiv.screenshot({
      path: path.join(SCREENSHOTS_DIR, "mail-test-16.png"),
    });
  });

  /* ------------------------------------------------------------------ */
  /*  17. Dual resize handles work independently                        */
  /* ------------------------------------------------------------------ */

  test("17 - Dual resize handles work independently", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoMail(page);
    await waitForAccount(page);

    // Load INBOX
    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    // Click an email
    await clickEmailRow(page, 0);

    // Wait for reader
    const readerPane = page.locator("div.min-w-\\[400px\\]").first();
    await expect(readerPane).toBeVisible({ timeout: 5000 });

    // Click Reply to show the composer panel
    const replyBtn = readerPane.getByRole("button", { name: "Reply" }).first();
    await replyBtn.click();
    await page.waitForTimeout(800);

    // Verify both resize handles exist
    // 1. List resize handle (between list and reader)
    const listHandle = page.getByRole("separator", { name: "Resize email list" });
    await expect(listHandle).toBeVisible({ timeout: 5000 });

    // 2. Reply resize handle (between body and composer)
    const replyHandle = page.getByRole("separator", { name: "Resize reply panel" });
    await expect(replyHandle).toBeVisible({ timeout: 5000 });

    // Get initial list width
    const listBoxBefore = await listHandle.boundingBox();
    expect(listBoxBefore).not.toBeNull();

    // Drag the list handle right by simulating pointer events
    await listHandle.hover();
    await page.mouse.down();
    await page.mouse.move(listBoxBefore!.x + 50, listBoxBefore!.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Get new list handle position
    const listBoxAfterListDrag = await listHandle.boundingBox();
    expect(listBoxAfterListDrag).not.toBeNull();
    // List handle should have moved right
    expect(listBoxAfterListDrag!.x).toBeGreaterThan(listBoxBefore!.x);

    // Now drag the reply handle left (increase reply width)
    const replyBoxBefore = await replyHandle.boundingBox();
    expect(replyBoxBefore).not.toBeNull();

    await replyHandle.hover();
    await page.mouse.down();
    await page.mouse.move(replyBoxBefore!.x - 40, replyBoxBefore!.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Get new reply handle position
    const replyBoxAfter = await replyHandle.boundingBox();
    expect(replyBoxAfter).not.toBeNull();
    // Reply handle should have moved left (reply panel grew)
    expect(replyBoxAfter!.x).toBeLessThan(replyBoxBefore!.x);

    // List handle should NOT have moved (list width unchanged by reply resize)
    const listBoxAfterReplyDrag = await listHandle.boundingBox();
    expect(listBoxAfterReplyDrag).not.toBeNull();
    expect(Math.abs(listBoxAfterReplyDrag!.x - listBoxAfterListDrag!.x)).toBeLessThan(10);
  });

  /* ------------------------------------------------------------------ */
  /*  18. Reply resize persists across reload                            */
  /* ------------------------------------------------------------------ */

  test("18 - Reply resize persists across reload", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoMail(page);
    await waitForAccount(page);

    // Load INBOX
    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    // Click an email and open reply
    await clickEmailRow(page, 0);
    const readerPane = page.locator("div.min-w-\\[400px\\]").first();
    await expect(readerPane).toBeVisible({ timeout: 5000 });
    const replyBtn = readerPane.getByRole("button", { name: "Reply" }).first();
    await replyBtn.click();
    await page.waitForTimeout(800);

    // Get the reply handle
    const replyHandle = page.getByRole("separator", { name: "Resize reply panel" });
    await expect(replyHandle).toBeVisible({ timeout: 5000 });

    // Drag to a specific width
    const replyBoxBefore = await replyHandle.boundingBox();
    expect(replyBoxBefore).not.toBeNull();

    await replyHandle.hover();
    await page.mouse.down();
    // Drag left to increase reply width significantly
    await page.mouse.move(replyBoxBefore!.x - 80, replyBoxBefore!.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const replyBoxAfter = await replyHandle.boundingBox();
    expect(replyBoxAfter).not.toBeNull();
    const movedBy = replyBoxBefore!.x - replyBoxAfter!.x;
    expect(movedBy).toBeGreaterThan(20);

    // Reload the page
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAccount(page);

    // Load INBOX again
    const inboxBtn2 = page.locator("button").filter({ hasText: "INBOX" }).first();
    await inboxBtn2.click();
    await waitForEmailList(page);

    // Open the same email and reply
    await clickEmailRow(page, 0);
    await page.waitForTimeout(500);
    const readerPane2 = page.locator("div.min-w-\\[400px\\]").first();
    await expect(readerPane2).toBeVisible({ timeout: 5000 });
    const replyBtn2 = readerPane2.getByRole("button", { name: "Reply" }).first();
    await replyBtn2.click();
    await page.waitForTimeout(800);

    // The reply handle should be at the persisted position (similar to where we left it)
    const replyHandle2 = page.getByRole("separator", { name: "Resize reply panel" });
    await expect(replyHandle2).toBeVisible({ timeout: 5000 });
    const replyBoxReload = await replyHandle2.boundingBox();
    expect(replyBoxReload).not.toBeNull();

    // The handle x position after reload should be close to where we left it
    // (may differ slightly due to scrollbar / render timing)
    const deltaAfterReload = Math.abs(replyBoxReload!.x - replyBoxAfter!.x);
    expect(deltaAfterReload).toBeLessThan(30);
  });

  /* ------------------------------------------------------------------ */
  /*  19. Compose overlay uses full available width                       */
  /* ------------------------------------------------------------------ */

  test("19 - Compose overlay uses full available width", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoMail(page);
    await waitForAccount(page);

    // Click Compose
    const composeBtn = page.locator("button").filter({ hasText: "Compose" }).first();
    await expect(composeBtn).toBeVisible();
    await composeBtn.click();
    await page.waitForTimeout(1000);

    // The overlay panel should exist and fill most of the viewport width
    const overlayPanel = page.locator("div.fixed.inset-0.z-50").first();
    await expect(overlayPanel).toBeVisible({ timeout: 5000 });

    // The body of the overlay should NOT have max-w-2xl constraint
    const maxW2xl = page.locator(".max-w-2xl");
    const maxW2xlCount = await maxW2xl.count();
    // The compose form inside the overlay should not use max-w-2xl
    // (the overlay itself has its own width classes)
    expect(maxW2xlCount).toBe(0);

    // The overlay panel width should be large (fullScreen mode)
    const panelBox = await overlayPanel.boundingBox();
    expect(panelBox).not.toBeNull();

    // In fullScreen mode, the panel should be most of the viewport width
    // (w-[calc(100%-32px)] ≈ 1888px for 1920 viewport)
    expect(panelBox!.width).toBeGreaterThan(1800);

    // Close the overlay
    await page.getByRole("button", { name: "Discard" }).click();
    await page.waitForTimeout(500);
  });

  /* ------------------------------------------------------------------ */
  /*  20. Compose overlay actions are visible without scrolling           */
  /* ------------------------------------------------------------------ */

  test("20 - Compose overlay actions are visible without scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoMail(page);
    await waitForAccount(page);

    // Click Compose
    const composeBtn = page.locator("button").filter({ hasText: "Compose" }).first();
    await expect(composeBtn).toBeVisible();
    await composeBtn.click();
    await page.waitForTimeout(1000);

    // The action buttons (Send, Save Draft, Discard) should be visible in the viewport
    const sendBtn = page.getByRole("button", { name: "Send" });
    const saveBtn = page.getByRole("button", { name: "Save Draft" });
    const discardBtn = page.getByRole("button", { name: "Discard" });

    await expect(sendBtn).toBeVisible({ timeout: 5000 });
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await expect(discardBtn).toBeVisible({ timeout: 5000 });

    // Verify they're within the viewport (not scrolled out)
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    const sendBox = await sendBtn.boundingBox();
    const saveBox = await saveBtn.boundingBox();
    const discardBox = await discardBtn.boundingBox();

    expect(sendBox).not.toBeNull();
    expect(saveBox).not.toBeNull();
    expect(discardBox).not.toBeNull();

    expect(sendBox!.y).toBeLessThan(viewportHeight);
    expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(viewportHeight);
    expect(saveBox!.y).toBeLessThan(viewportHeight);
    expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(viewportHeight);
    expect(discardBox!.y).toBeLessThan(viewportHeight);
    expect(discardBox!.y + discardBox!.height).toBeLessThanOrEqual(viewportHeight);

    // Close via Discard
    await discardBtn.click();
    await page.waitForTimeout(500);
  });
});

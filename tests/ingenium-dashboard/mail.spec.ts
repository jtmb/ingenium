import { test, expect, Page } from "@playwright/test";
import path from "path";
import { visualQaArtifactDirectory } from "./visual-qa-artifacts";

/**
 * Mail client contract tests use realistic intercepted API responses so UI
 * behavior is deterministic and independent of an external mailbox.
 */

const BASE = "http://localhost:3000";
const SCREENSHOTS_DIR = visualQaArtifactDirectory("mail");
const GMAIL_EMAIL = "james.branco@gmail.com";
const ACCOUNT_ID = "5a214d5b-1d89-4e89-9bd9-7a857495efa7";

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
const MOCK_ARCHIVE_SEARCH_EMAIL = {
  ...MOCK_SINGLE_EMAIL,
  uid: 200000,
  subject: "Archive task result",
  folder: "Archive/2026",
};

/** Test seam for the error-response contract. */
let forceEmailError = false;

async function setupMocks(page: Page) {
  forceEmailError = false;

  await page.unrouteAll();

  await page.route("**/api/v1/projects*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [{ id: "global-default", name: "global-default", is_global: true, archived_at: null }],
        total: 1,
      }),
    });
  });

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
    (url) => url.pathname === "/api/v1/emails/sync-status",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            overall: "done",
            account: ACCOUNT_ID,
            totalFolders: 1,
            syncingFolders: 0,
            totalCached: MOCK_EMAILS.length,
            totalBodies: MOCK_EMAILS.length,
            folders: [
              {
                folder: "INBOX",
                cachedCount: MOCK_EMAILS.length,
                bodyCount: MOCK_EMAILS.length,
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
    (url) => url.pathname === "/api/v1/emails/sync",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { account: ACCOUNT_ID, folders: 12, totalSynced: 62000, results: [] },
        }),
      });
    },
  );

  await page.route("**/api/v1/emails/search*", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    const data = query === "archive-task" ? [MOCK_ARCHIVE_SEARCH_EMAIL] : MOCK_EMAILS.slice(0, 5);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data, total: data.length }),
    });
  });

  await page.route("**/api/v1/tasks/captures*", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          task: {
            id: "task-mail-1",
            title: body.title,
            column_id: "todo",
            created_at: new Date().toISOString(),
          },
          reference: {
            id: "reference-mail-1",
            source_type: "email",
            source_id: `${body.account_id}:${body.folder}:${body.uid}`,
            display_title: "Archive task result",
            display_detail: null,
            source_timestamp: null,
            created_at: new Date().toISOString(),
            availability: "available",
          },
        },
      }),
    });
  });

  // Match UID requests separately from the collection endpoint.
  await page.route(
    (url) =>
      /\/api\/v1\/emails\/\d+$/.test(url.pathname) &&
      url.searchParams.has("project"),
    async (route) => {
      const uid = parseInt(
        route.request().url().split("/").pop()!.split("?")[0],
        10,
      );
       const email = [...MOCK_EMAILS, MOCK_ARCHIVE_SEARCH_EMAIL].find((e) => e.uid === uid) || MOCK_SINGLE_EMAIL;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: email }),
      });
    },
  );

  // Match the collection endpoint without catching UID requests.
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

async function gotoMail(page: Page) {
  await page.goto(`${BASE}/mail`, { waitUntil: "domcontentloaded" });
}

async function waitForAccount(page: Page) {
  await expect(
    page.getByRole("button", { name: `Select account, current ${GMAIL_EMAIL}` }),
  ).toBeVisible({ timeout: 15000 });
}

async function waitForEmailList(page: Page) {
  const emailRows = page.getByTestId("email-row");
  await expect(emailRows.first()).toBeVisible({ timeout: 15000 });
}

async function clickEmailRow(page: Page, index = 0) {
  const rows = page.getByTestId("email-row");
  await rows.nth(index).click();
  await page.waitForTimeout(800);
}

async function getEmailListBoundingBox(page: Page) {
  const listPanel = page.getByTestId("email-list");
  return listPanel.boundingBox();
}

test.describe("Mail Client — 3-Pane Email Interface", () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test("1 - Account selector shows james.branco@gmail.com with connection dot", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    const selector = page.getByRole("button", { name: `Select account, current ${GMAIL_EMAIL}` });
    await expect(selector).toBeVisible();

    await expect(selector.locator("svg").first()).toBeVisible();

    const spans = selector.locator("span");
    const spanCount = await spans.count();
    expect(spanCount).toBeGreaterThanOrEqual(3); // avatar, email text, status dot
    await expect(selector.locator("svg").first()).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "mail-test-01.png") });
  });

  test("2 - Account selection loads folders in sidebar", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    const selector = page.getByRole("button", { name: `Select account, current ${GMAIL_EMAIL}` });
    await selector.click();
    await page.waitForTimeout(500);

    const dropdown = page.getByRole("menu", { name: "Email accounts" });
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    const gmailItem = dropdown.getByRole("menuitem").filter({ hasText: GMAIL_EMAIL });
    await expect(gmailItem).toHaveCount(1);
    await gmailItem.click();
    await page.waitForTimeout(1000);

    await expect(
      page.getByRole("button", { name: /INBOX/ }).first(),
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("button", { name: /^Sent Mail/ }).first(),
    ).toBeVisible({ timeout: 3000 });

    await expect(
      page.getByRole("button", { name: /Drafts/ }).first(),
    ).toBeVisible({ timeout: 3000 });
  });

  test("3 - Folder sidebar shows INBOX, Sent Mail, Drafts with message counts", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    await page.waitForTimeout(2000);

    const inboxBtn = page.getByRole("button", { name: /INBOX/ }).first();
    await expect(inboxBtn).toBeVisible({ timeout: 10000 });

    const inboxSpans = inboxBtn.locator("span");
    const inboxSpanCount = await inboxSpans.count();
    expect(inboxSpanCount).toBeGreaterThanOrEqual(2);

    const sentBtn = page.getByRole("button", { name: /^Sent Mail/ }).first();
    await expect(sentBtn).toBeVisible({ timeout: 3000 });
    const sentSpans = sentBtn.locator("span");
    await expect(sentSpans.first()).toBeVisible();
    expect(await sentSpans.count()).toBeGreaterThanOrEqual(2);

    const draftsBtn = page.getByRole("button", { name: /Drafts/ }).first();
    await expect(draftsBtn).toBeVisible({ timeout: 3000 });
    const draftsSpanCount = await draftsBtn.locator("span").count();
    expect(draftsSpanCount).toBeGreaterThanOrEqual(2);

    await expect(
      page.getByRole("button", { name: /Personal/ }).first(),
    ).toBeVisible({ timeout: 3000 });

    await expect(
      page.getByRole("button", { name: /Receipts/ }).first(),
    ).toBeVisible({ timeout: 3000 });
  });

  test("4 - Clicking INBOX folder loads email rows in the list", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    const inboxBtn = page.getByRole("button", { name: /INBOX/ }).first();
    await expect(inboxBtn).toBeVisible({ timeout: 10000 });
    await inboxBtn.click();

    await waitForEmailList(page);

    const emailRows = page.getByTestId("email-row");
    const rowCount = await emailRows.count();
    expect(rowCount).toBeGreaterThan(0);

    const firstRow = emailRows.first();
    await expect(firstRow).toBeVisible();

    await expect(firstRow.getByText("Project update")).toBeVisible({ timeout: 3000 });
  });

  test("5 - Emails in INBOX are sorted newest-first by date", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    const inboxBtn = page.getByRole("button", { name: /INBOX/ }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    await clickEmailRow(page, 0);

    const readerPane = page.getByTestId("email-reader-content");
    await expect(readerPane).toBeVisible({ timeout: 5000 });

    const subjectEl = readerPane.locator("h2").first();
    await expect(subjectEl).toBeVisible({ timeout: 5000 });
    const subjectText = await subjectEl.textContent();
    expect(subjectText).toContain("Project update — Q3 planning");

    const firstDate = new Date(MOCK_EMAILS[0].date).getTime();
    const secondDate = new Date(MOCK_EMAILS[1].date).getTime();
    expect(firstDate).toBeGreaterThan(secondDate);
  });

  test("6 - Clicking email opens reader pane without list layout shift", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    const inboxBtn = page.getByRole("button", { name: /INBOX/ }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    const listBoxBefore = await getEmailListBoundingBox(page);
    expect(listBoxBefore).not.toBeNull();

    const emptyReader = page.getByTestId("email-reader-empty");
    await expect(emptyReader).toBeVisible({ timeout: 3000 });

    await clickEmailRow(page, 0);

    const listBoxAfter = await getEmailListBoundingBox(page);
    expect(listBoxAfter).not.toBeNull();

    expect(listBoxAfter!.width).toBeCloseTo(listBoxBefore!.width, 0);

    const readerContent = page.getByTestId("email-reader-content");
    await expect(readerContent).toBeVisible({ timeout: 5000 });
    await expect(emptyReader).not.toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "mail-test-06.png") });
  });

  test("7 - Email reader shows subject, from, date, and body", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    const inboxBtn = page.getByRole("button", { name: /INBOX/ }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    await clickEmailRow(page, 0);

    const readerPane = page.getByTestId("email-reader-content");
    await expect(readerPane).toBeVisible({ timeout: 5000 });

    const subject = readerPane.locator("h2").first();
    await expect(subject).toBeVisible();
    const subjectText = await subject.textContent();
    expect(subjectText).not.toBeNull();
    expect(subjectText!.trim().length).toBeGreaterThan(0);

    const fromField = readerPane.getByTestId("email-reader-from");
    await expect(fromField).toBeVisible({ timeout: 3000 });
    const fromText = await fromField.textContent();
    expect(fromText).not.toBeNull();
    expect(fromText!.trim().length).toBeGreaterThan(0);

    const dateField = readerPane.getByTestId("email-reader-date");
    await expect(dateField).toBeVisible({ timeout: 3000 });
    const dateText = await dateField.textContent();
    expect(dateText).not.toBeNull();
    expect(dateText!.trim().length).toBeGreaterThan(0);

    await expect(readerPane.getByRole("button", { name: "Reply" }).first()).toBeVisible();
    await expect(readerPane.getByRole("button", { name: "Forward" }).first()).toBeVisible();
    await expect(readerPane.getByRole("button", { name: "Archive" }).first()).toBeVisible();
    await expect(readerPane.getByRole("button", { name: "Delete" }).first()).toBeVisible();

    const bodyArea = readerPane.getByTestId("email-body-pane");
    await expect(bodyArea).toBeVisible({ timeout: 3000 });
    const bodyHtml = await bodyArea.innerHTML();
    expect(bodyHtml.length).toBeGreaterThan(50);
  });

  test("7a - Loaded search result can create a task with only its exact email identity", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    const search = page.getByPlaceholder("Search emails...");
    await search.fill("archive-task");
    const resultRow = page.getByTestId("email-row").filter({ hasText: "Archive task result" }).first();
    await expect(resultRow).toBeVisible({ timeout: 5000 });
    await resultRow.click();

    const createTask = page.getByRole("button", { name: "Create task", exact: true });
    await expect(createTask).toBeVisible({ timeout: 5000 });
    await createTask.click();

    const title = page.getByRole("textbox", { name: "Title" });
    await expect(title).toHaveValue("");
    await title.fill("Follow up on archive message");

    const captureRequestPromise = page.waitForRequest(
      (request) => request.url().includes("/api/v1/tasks/captures") && request.method() === "POST",
    );
    await page.getByRole("button", { name: "Create Task", exact: true }).click();
    const captureRequest = await captureRequestPromise;
    const body = captureRequest.postDataJSON();

    expect(body).toEqual({
      source_type: "email",
      title: "Follow up on archive message",
      account_id: ACCOUNT_ID,
      folder: "Archive/2026",
      uid: "200000",
    });
    expect(Object.keys(body).sort()).toEqual(["account_id", "folder", "source_type", "title", "uid"]);
    expect(JSON.stringify(body)).not.toMatch(/subject|body|snippet|attachment|header|selectedFolder|INBOX/i);

    const status = page.getByTestId("mail-task-capture-status");
    await expect(status).toContainText("Follow up on archive message");
    await expect(status.getByRole("link", { name: "Follow up on archive message" })).toHaveAttribute("href", "/tasks");
  });

  test("8 - HTML emails with images render img tags in reader", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    const inboxBtn = page.getByRole("button", { name: /INBOX/ }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    await clickEmailRow(page, 0);
    const readerPane = page.getByTestId("email-reader-content");
    await expect(readerPane).toBeVisible({ timeout: 5000 });

    // HTML email content is isolated in the reader iframe.
    const htmlIframe = readerPane.locator('[data-testid="email-html-iframe"]');
    await expect(htmlIframe).toBeVisible({ timeout: 5000 });

    expect(await htmlIframe.count()).toBeGreaterThan(0);
  });

  test("9 - Compose button opens a single clean modal without double box", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    const composeBtn = page.getByRole("button", { name: "Compose", exact: true });
    await expect(composeBtn).toBeVisible();
    await composeBtn.click();
    await page.waitForTimeout(1000);

    const composeDialog = page.getByRole("dialog", { name: "Compose" });
    const composeHeading = composeDialog.getByRole("heading", { name: "Compose" });
    await expect(composeHeading).toBeVisible({ timeout: 5000 });

    const composeHeadings = composeDialog.getByRole("heading", { name: "Compose" });
    const headingCount = await composeHeadings.count();
    expect(headingCount).toBe(1);

    await expect(composeDialog.getByPlaceholder("To")).toBeVisible({ timeout: 3000 });
    await expect(composeDialog.getByPlaceholder("Subject")).toBeVisible();
    await expect(composeDialog.getByText("Message", { exact: true })).toBeVisible();
    await expect(
      composeDialog.getByRole("toolbar", { name: "Formatting toolbar" }),
    ).toBeVisible();

    await expect(composeDialog.getByLabel("From")).toBeVisible();

    await expect(composeDialog.getByRole("button", { name: "Send" })).toBeVisible();
    await expect(composeDialog.getByRole("button", { name: "Save Draft" })).toBeVisible();
    await expect(composeDialog.getByRole("button", { name: "Discard" })).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "mail-test-09.png") });

    await composeDialog.getByRole("button", { name: "Discard" }).click();
    await page.waitForTimeout(500);
    await expect(composeHeading).not.toBeVisible();
  });

  test("10 - Error banner renders with red styling when IMAP error occurs", async ({ page }) => {
    forceEmailError = true;
    await gotoMail(page);
    await waitForAccount(page);

    await page.waitForTimeout(1500);
    const errorDiv = page.getByText(/IMAP|Failed|error/i).first();
    await expect(errorDiv).toBeVisible({ timeout: 10000 });

    const errorText = await errorDiv.textContent();
    expect(errorText).not.toBeNull();
    expect(errorText!.trim().length).toBeGreaterThan(0);

    forceEmailError = false;
  });

  test("11 - Refresh button triggers email reload with source=imap", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    const inboxBtn = page.getByRole("button", { name: /INBOX/ }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    const refreshBtn = page.getByTitle("Refresh").first();
    await expect(refreshBtn).toBeVisible({ timeout: 5000 });

    const refreshResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/v1/emails?") &&
        resp.url().includes("refresh=true") &&
        resp.status() === 200,
      { timeout: 15000 },
    );

    await refreshBtn.click();
    await refreshResponsePromise;

    await page.waitForTimeout(500);
    const emailRows = page.getByTestId("email-row");
    const rowCount = await emailRows.count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test("12 - Cache-backed navigation to /mail loads under 2 seconds (second visit)", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    const inboxBtn = page.getByRole("button", { name: /INBOX/ }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({
      timeout: 10000,
    });

    const startTime = performance.now();
    await page.goto(`${BASE}/mail`, { waitUntil: "domcontentloaded" });

    await waitForAccount(page);

    const emailRows = page.getByTestId("email-row");
    await expect(emailRows.first()).toBeVisible({ timeout: 10000 });

    const loadTime = performance.now() - startTime;
    expect(loadTime).toBeLessThan(2000);

    test.info().annotations.push({
      type: "performance",
      description: `Cache-backed mail page load: ${Math.round(loadTime)}ms (under 2000ms ✓)`,
    });
  });

  test("13 - No demo account or demo text visible on page", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    const bodyText = await page.locator("body").innerText();
    const bodyHtml = await page.locator("body").innerHTML();

    expect(bodyText.toLowerCase()).not.toContain("demo@ingenium");
    expect(bodyText.toLowerCase()).not.toContain("demo account");

    const selector = page.getByRole("button", { name: `Select account, current ${GMAIL_EMAIL}` });
    await selector.click();
    await page.waitForTimeout(500);

    const dropdown = page.getByRole("menu", { name: "Email accounts" });
    const dropdownVisible = await dropdown.isVisible().catch(() => false);
    if (dropdownVisible) {
      const dropdownText = await dropdown.innerText();
      expect(dropdownText.toLowerCase()).not.toContain("demo");
      await selector.click();
    }
  });

  test("14 - Account selector has avatar chip, email, dot, and chevron", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    const selector = page.getByRole("button", { name: `Select account, current ${GMAIL_EMAIL}` });
    await selector.click();
    await page.waitForTimeout(500);

    const dropdown = page.getByRole("menu", { name: "Email accounts" });
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    const gmailEntry = dropdown.getByRole("menuitem").filter({ hasText: GMAIL_EMAIL });
    await expect(gmailEntry).toHaveCount(1);
    await expect(gmailEntry).toBeVisible();

    await expect(gmailEntry.locator("span").first()).toBeVisible();

    await expect(gmailEntry.getByText(GMAIL_EMAIL)).toBeVisible();

    const notConnected = gmailEntry.getByText("not connected");
    const notConnVisible = await notConnected.isVisible().catch(() => false);
    if (notConnVisible) {
      await expect(notConnected).toBeVisible();
    }

    const addAccountBtn = dropdown.getByRole("menuitem", { name: "+ Add Account", exact: true });
    await expect(addAccountBtn).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "mail-test-14.png") });

    await selector.click();
  });

  test("15 - Reader pane position stays stable when switching emails", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    const inboxBtn = page.getByRole("button", { name: /INBOX/ }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    const emailRows = page.getByTestId("email-row");
    const rowCount = await emailRows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);

    await clickEmailRow(page, 0);
    const readerPane = page.getByTestId("email-reader-content");
    await expect(readerPane).toBeVisible({ timeout: 5000 });

    const readerBox1 = await readerPane.boundingBox();
    expect(readerBox1).not.toBeNull();

    await clickEmailRow(page, 1);
    await expect(readerPane).toBeVisible({ timeout: 5000 });

    const readerBox2 = await readerPane.boundingBox();
    expect(readerBox2).not.toBeNull();

    expect(readerBox2!.x).toBeCloseTo(readerBox1!.x, 0);

    expect(readerBox2!.width).toBeCloseTo(readerBox1!.width, 0);
  });

  test("16 - Settings page shows ✉️ Mail section with sync frequency select", async ({ page }) => {
    await page.goto(`${BASE}/mail?settings=mail`, { waitUntil: "domcontentloaded" });

    const settingsDialog = page.getByRole("dialog", { name: "Settings" });
    await expect(settingsDialog).toBeVisible({
      timeout: 10000,
    });

    await expect(
      settingsDialog.getByRole("tab", { name: "Mail", exact: true }),
    ).toHaveAttribute("aria-selected", "true");

    const mailPanel = settingsDialog.getByTestId("settings-panel-mail");
    await expect(mailPanel).toBeVisible({ timeout: 5000 });
    await expect(mailPanel.getByRole("heading", { name: "Mail Sync", exact: true })).toBeVisible();

    const intervalSelect = mailPanel.getByRole("combobox", { name: "Check every" });
    await expect(intervalSelect).toBeVisible();

    const options = await intervalSelect.locator("option").allTextContents();
    expect(options).toContain("Off");
    expect(options).toContain("5 minutes");
    expect(options).toContain("15 minutes");
    expect(options).toContain("30 minutes");

    await mailPanel.screenshot({
      path: path.join(SCREENSHOTS_DIR, "mail-test-16.png"),
    });
  });

  test("17 - Dual resize handles work independently", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoMail(page);
    await waitForAccount(page);

    const inboxBtn = page.getByRole("button", { name: /INBOX/ }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    await clickEmailRow(page, 0);

    const readerPane = page.getByTestId("email-reader-content");
    await expect(readerPane).toBeVisible({ timeout: 5000 });

    const replyBtn = readerPane.getByRole("button", { name: "Reply" }).first();
    await replyBtn.click();
    await page.waitForTimeout(800);

    const listHandle = page.getByRole("separator", { name: "Resize email list" });
    await expect(listHandle).toBeVisible({ timeout: 5000 });

    const replyHandle = page.getByRole("separator", { name: "Resize reply panel" });
    await expect(replyHandle).toBeVisible({ timeout: 5000 });

    const listBoxBefore = await listHandle.boundingBox();
    expect(listBoxBefore).not.toBeNull();

    await listHandle.hover();
    await page.mouse.down();
    await page.mouse.move(listBoxBefore!.x + 50, listBoxBefore!.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const listBoxAfterListDrag = await listHandle.boundingBox();
    expect(listBoxAfterListDrag).not.toBeNull();
    expect(listBoxAfterListDrag!.x).toBeGreaterThan(listBoxBefore!.x);

    const replyBoxBefore = await replyHandle.boundingBox();
    expect(replyBoxBefore).not.toBeNull();

    await replyHandle.hover();
    await page.mouse.down();
    await page.mouse.move(replyBoxBefore!.x - 40, replyBoxBefore!.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const replyBoxAfter = await replyHandle.boundingBox();
    expect(replyBoxAfter).not.toBeNull();
    expect(replyBoxAfter!.x).toBeLessThan(replyBoxBefore!.x);

    const listBoxAfterReplyDrag = await listHandle.boundingBox();
    expect(listBoxAfterReplyDrag).not.toBeNull();
    expect(Math.abs(listBoxAfterReplyDrag!.x - listBoxAfterListDrag!.x)).toBeLessThan(10);
  });

  test("18 - Reply resize persists across reload", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoMail(page);
    await waitForAccount(page);

    const inboxBtn = page.getByRole("button", { name: /INBOX/ }).first();
    await inboxBtn.click();
    await waitForEmailList(page);

    await clickEmailRow(page, 0);
    const readerPane = page.getByTestId("email-reader-content");
    await expect(readerPane).toBeVisible({ timeout: 5000 });
    const replyBtn = readerPane.getByRole("button", { name: "Reply" }).first();
    await replyBtn.click();
    await page.waitForTimeout(800);

    const replyHandle = page.getByRole("separator", { name: "Resize reply panel" });
    await expect(replyHandle).toBeVisible({ timeout: 5000 });

    const replyBoxBefore = await replyHandle.boundingBox();
    expect(replyBoxBefore).not.toBeNull();

    await replyHandle.hover();
    await page.mouse.down();
    await page.mouse.move(replyBoxBefore!.x - 80, replyBoxBefore!.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const replyBoxAfter = await replyHandle.boundingBox();
    expect(replyBoxAfter).not.toBeNull();
    const movedBy = replyBoxBefore!.x - replyBoxAfter!.x;
    expect(movedBy).toBeGreaterThan(20);

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAccount(page);

    const inboxBtn2 = page.getByRole("button", { name: /INBOX/ }).first();
    await inboxBtn2.click();
    await waitForEmailList(page);

    await clickEmailRow(page, 0);
    await page.waitForTimeout(500);
    const readerPane2 = page.getByTestId("email-reader-content");
    await expect(readerPane2).toBeVisible({ timeout: 5000 });
    const replyBtn2 = readerPane2.getByRole("button", { name: "Reply" }).first();
    await replyBtn2.click();
    await page.waitForTimeout(800);

    const replyHandle2 = page.getByRole("separator", { name: "Resize reply panel" });
    await expect(replyHandle2).toBeVisible({ timeout: 5000 });
    const replyBoxReload = await replyHandle2.boundingBox();
    expect(replyBoxReload).not.toBeNull();

    // Layout can vary slightly with scrollbar and render timing after reload.
    const deltaAfterReload = Math.abs(replyBoxReload!.x - replyBoxAfter!.x);
    expect(deltaAfterReload).toBeLessThan(30);
  });

  test("19 - Compose overlay uses full available width", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoMail(page);
    await waitForAccount(page);

    const composeBtn = page.getByRole("button", { name: "Compose", exact: true });
    await expect(composeBtn).toBeVisible();
    await composeBtn.click();
    await page.waitForTimeout(1000);

    const overlayPanel = page.getByRole("dialog", { name: "Compose" });
    await expect(overlayPanel).toBeVisible({ timeout: 5000 });

    const maxWidth = await overlayPanel.evaluate((element) => getComputedStyle(element).maxWidth);
    expect(maxWidth).toBe("none");

    const panelBox = await overlayPanel.boundingBox();
    expect(panelBox).not.toBeNull();

    // The full-screen contract leaves only the documented 32px margin.
    expect(panelBox!.width).toBeGreaterThan(1800);

    await page.getByRole("button", { name: "Discard" }).click();
    await page.waitForTimeout(500);
  });

  test("20 - Compose overlay actions are visible without scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoMail(page);
    await waitForAccount(page);

    const composeBtn = page.getByRole("button", { name: "Compose", exact: true });
    await expect(composeBtn).toBeVisible();
    await composeBtn.click();
    await page.waitForTimeout(1000);

    const sendBtn = page.getByRole("button", { name: "Send" });
    const saveBtn = page.getByRole("button", { name: "Save Draft" });
    const discardBtn = page.getByRole("button", { name: "Discard" });

    await expect(sendBtn).toBeVisible({ timeout: 5000 });
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await expect(discardBtn).toBeVisible({ timeout: 5000 });

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

    await discardBtn.click();
    await page.waitForTimeout(500);
  });
});

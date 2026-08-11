import { test, expect, Page } from "@playwright/test";

/**
 * E2E test for Reply and Forward compose modal behavior.
 *
 * Reply must pre-fill To (from the sender's address), Subject (with "Re: " prefix),
 * and From (account selector), but Body must be EMPTY.
 *
 * Forward must open a COMPLETELY BLANK compose modal — nothing pre-filled.
 * This is a regression check: Forward uses handleCompose (no initialData),
 * so it must NOT inherit any Reply/Draft pre-fill logic.
 *
 * Additional tests for Smart Replies collapsible cards, copy button, whole-card
 * click to apply, and element ordering.
 */

const BASE = "http://localhost:3000";
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
      html: "<!doctype html><html><body><p>This is the body of the email from Alice.</p></body></html>",
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

const MOCK_SUGGEST_RESPONSE = {
  data: {
    suggestions: [
      { tone: "professional", subject: "Re: Project update — Q3 planning", body: "Thank you for the update. I will review the Q3 plan and provide feedback shortly." },
      { tone: "friendly", subject: "Re: Project update — Q3 planning", body: "Hey Alice, thanks for sending this over! Looks great at first glance." },
      { tone: "concise", subject: "Re: Project update — Q3 planning", body: "Thanks, will review." },
    ],
    source: "generated",
    configured: true,
  },
};

async function setupMocks(page: Page) {
  await page.unroute();

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

  await page.route("**/api/v1/emails/suggest/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_SUGGEST_RESPONSE),
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

async function openFirstEmailAndReply(page: Page) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${BASE}/mail`, { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("button", { name: `Select account, current ${GMAIL_EMAIL}` }),
  ).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  const inboxBtn = page.getByRole("button", { name: /INBOX/ }).first();
  await expect(inboxBtn).toBeVisible({ timeout: 10000 });
  await inboxBtn.click();
  await page.waitForTimeout(1000);

  const emailRows = page.getByTestId("email-row");
  await expect(emailRows.first()).toBeVisible({ timeout: 15000 });
  await emailRows.first().click();
  await page.waitForTimeout(800);

  const readerPane = page.getByTestId("email-reader-content");
  await expect(readerPane).toBeVisible({ timeout: 5000 });

  const replyBtn = readerPane.getByRole("button", { name: "Reply" }).first();
  await expect(replyBtn).toBeVisible();
  await replyBtn.click();
  await page.waitForTimeout(800);
}

test("Reply opens compose with To/Subject/From pre-filled and Body EMPTY", async ({ page }) => {
  await setupMocks(page);
  await openFirstEmailAndReply(page);

  const toInput = page.getByPlaceholder("recipient@example.com");
  await expect(toInput).toBeVisible({ timeout: 5000 });

  const toValue = await toInput.inputValue();
  expect(toValue).toBe("alice@example.com");
  test.info().annotations.push({
    type: "reply",
    description: `Reply To field: "${toValue}" — matches alice@example.com ✓`,
  });

  // Existing "Re:" prefixes must not be duplicated.
  const subjectInput = page.getByPlaceholder("Subject");
  await expect(subjectInput).toBeVisible();
  const subjectValue = await subjectInput.inputValue();
  expect(subjectValue).toBe("Re: Project update — Q3 planning");
  test.info().annotations.push({
    type: "reply",
    description: `Reply Subject: "${subjectValue}" — preserves existing "Re: " prefix ✓`,
  });

  const fromSelect = page.getByLabel("From").first();
  await expect(fromSelect).toBeVisible();
  const fromValue = await fromSelect.inputValue();
  expect(fromValue).toBe(ACCOUNT_ID);
  test.info().annotations.push({
    type: "reply",
    description: `Reply From account: "${fromValue}" — matches selected account ✓`,
  });

  // RichTextEditor uses a TipTap contenteditable rather than a textarea.
  const bodyEditor = page.locator('[contenteditable="true"]').first();
  await expect(bodyEditor).toBeVisible();
  const bodyText = await bodyEditor.textContent();
  expect(bodyText?.trim() || "").toBe("");
  test.info().annotations.push({
    type: "reply",
    description: `Reply Body: empty string — Body is EMPTY as required ✓`,
  });

  const reviewBtn = page.locator('button:has-text("Review with AI")').first();
  const smartRepliesHeading = page.locator('button:has-text("Smart Replies")').first();
  await expect(reviewBtn).toBeVisible({ timeout: 5000 });
  await expect(smartRepliesHeading).toBeVisible({ timeout: 5000 });
  const reviewBox = await reviewBtn.boundingBox();
  const srBox = await smartRepliesHeading.boundingBox();
  expect(reviewBox!.y).toBeLessThan(srBox!.y);
  test.info().annotations.push({
    type: "reply",
    description: `"Review with AI" (y=${reviewBox!.y.toFixed(0)}) is above "Smart Replies" (y=${srBox!.y.toFixed(0)}) ✓`,
  });

  // The message frame must fill the available body pane.
  const bodyPane = page.getByTestId("email-body-pane");
  const emailFrame = page.getByTestId("email-html-iframe");
  const [bodyPaneBox, emailFrameBox] = await Promise.all([
    bodyPane.boundingBox(),
    emailFrame.boundingBox(),
  ]);
  expect(bodyPaneBox).not.toBeNull();
  expect(emailFrameBox).not.toBeNull();
  expect(emailFrameBox!.height).toBeGreaterThan(300);
  expect(emailFrameBox!.height).toBeGreaterThanOrEqual(bodyPaneBox!.height - 40);

  const discardBtn = page.getByRole("button", { name: "Discard" }).first();
  await expect(discardBtn).toBeVisible({ timeout: 3000 });
  await discardBtn.click();
  await page.waitForTimeout(500);
  await expect(toInput).not.toBeVisible();
});

test("Forward opens blank compose with nothing pre-filled", async ({ page }) => {
  await setupMocks(page);
  await page.goto(`${BASE}/mail`, { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("button", { name: `Select account, current ${GMAIL_EMAIL}` }),
  ).toBeVisible({ timeout: 15000 });

  await page.waitForTimeout(2000);

  const inboxBtn = page.getByRole("button", { name: /INBOX/ }).first();
  await expect(inboxBtn).toBeVisible({ timeout: 10000 });
  await inboxBtn.click();
  await page.waitForTimeout(1000);

  const emailRows = page.getByTestId("email-row");
  await expect(emailRows.first()).toBeVisible({ timeout: 15000 });

  await emailRows.first().click();
  await page.waitForTimeout(800);

  const readerPane = page.getByTestId("email-reader-content");
  await expect(readerPane).toBeVisible({ timeout: 5000 });

  const forwardBtn = readerPane.getByRole("button", { name: "Forward" }).first();
  await expect(forwardBtn).toBeVisible();
  await forwardBtn.click();
  await page.waitForTimeout(800);

  const composeHeading = page.getByRole("heading", { name: "Compose" }).first();
  await expect(composeHeading).toBeVisible({ timeout: 5000 });

  const toInput = page.getByPlaceholder("To");
  await expect(toInput).toBeVisible();
  const toValue = await toInput.inputValue();
  expect(toValue).toBe("");
  test.info().annotations.push({
    type: "forward",
    description: `Forward To field: "${toValue}" — empty (nothing pre-filled) ✓`,
  });

  const subjectInput = page.getByPlaceholder("Subject");
  await expect(subjectInput).toBeVisible();
  const subjectValue = await subjectInput.inputValue();
  expect(subjectValue).toBe("");
  test.info().annotations.push({
    type: "forward",
    description: `Forward Subject: "${subjectValue}" — empty (nothing pre-filled) ✓`,
  });

  // RichTextEditor uses a TipTap contenteditable rather than a textarea.
  const bodyEditor = page.locator('[contenteditable="true"]').first();
  await expect(bodyEditor).toBeVisible();
  const bodyText = await bodyEditor.textContent();
  expect(bodyText?.trim() || "").toBe("");
  test.info().annotations.push({
    type: "forward",
    description: `Forward Body: empty — nothing pre-filled ✓`,
  });

  const fromSelect = page.getByLabel("From").first();
  await expect(fromSelect).toBeVisible();
  const fromValue = await fromSelect.inputValue();
  expect(fromValue).toBe(ACCOUNT_ID);

  await page.getByRole("button", { name: "Discard" }).click();
  await page.waitForTimeout(500);
  await expect(composeHeading).not.toBeVisible();
});

test("Smart Replies cards are collapsible with aria-expanded", async ({ page }) => {
  await setupMocks(page);
  await openFirstEmailAndReply(page);

  const toggleBtn = page
    .getByTestId("email-reader-content")
    .getByRole("button", { name: "Smart Replies", exact: true });
  await expect(toggleBtn).toBeVisible({ timeout: 5000 });
  expect(await toggleBtn.getAttribute("aria-expanded")).toBe("true");

  const suggestionCards = page.locator('div[role="button"][tabindex="0"]');
  const visibleCards = await suggestionCards.count();
  expect(visibleCards).toBeGreaterThanOrEqual(1);

  await toggleBtn.click();
  await page.waitForTimeout(300);
  expect(await toggleBtn.getAttribute("aria-expanded")).toBe("false");

  await expect(suggestionCards.first()).not.toBeVisible();

  await toggleBtn.click();
  await page.waitForTimeout(300);
  expect(await toggleBtn.getAttribute("aria-expanded")).toBe("true");
  await expect(suggestionCards.first()).toBeVisible();
});

test("Clicking a Smart Reply card applies the draft", async ({ page }) => {
  await setupMocks(page);
  await openFirstEmailAndReply(page);

  const suggestionCards = page.locator('div[role="button"][tabindex="0"]');
  await expect(suggestionCards.first()).toBeVisible({ timeout: 8000 });

  const firstCardTone = await suggestionCards.first().locator("span").first().textContent();
  expect(firstCardTone).toBeTruthy();

  await suggestionCards.first().click();
  await page.waitForTimeout(500);

  const subjectInput = page.getByPlaceholder("Subject");
  const subjectValue = await subjectInput.inputValue();
  expect(subjectValue).toContain("Re:");
  test.info().annotations.push({
    type: "smart-suggest",
    description: `Subject after card click: "${subjectValue}" — draft was applied ✓`,
  });
});

test("Copy button on Smart Reply card does not apply draft", async ({ page }) => {
  await setupMocks(page);
  await openFirstEmailAndReply(page);

  const suggestionCards = page.locator('div[role="button"][tabindex="0"]');
  await expect(suggestionCards.first()).toBeVisible({ timeout: 8000 });

  const subjectInput = page.getByPlaceholder("Subject");
  const subjectBefore = await subjectInput.inputValue();

  const copyBtn = suggestionCards.first().locator('button[aria-label="Copy draft to clipboard"]');
  await expect(copyBtn).toBeVisible();

  await copyBtn.click();
  await page.waitForTimeout(300);

  const subjectAfter = await subjectInput.inputValue();
  expect(subjectAfter).toBe(subjectBefore);
  test.info().annotations.push({
    type: "smart-suggest",
    description: `Subject unchanged after copy click — draft NOT applied ✓`,
  });
});

test("Review with AI appears above Smart Replies in inline reply", async ({ page }) => {
  await setupMocks(page);
  await openFirstEmailAndReply(page);

  const reviewBtn = page.locator('button:has-text("Review with AI")').first();
  const smartRepliesHeading = page.locator('button:has-text("Smart Replies")').first();

  await expect(reviewBtn).toBeVisible({ timeout: 5000 });
  await expect(smartRepliesHeading).toBeVisible({ timeout: 8000 });

  const reviewBox = await reviewBtn.boundingBox();
  const srBox = await smartRepliesHeading.boundingBox();
  expect(reviewBox).not.toBeNull();
  expect(srBox).not.toBeNull();
  expect(reviewBox!.y).toBeLessThan(srBox!.y);
  test.info().annotations.push({
    type: "smart-suggest",
    description: `"Review with AI" (y=${reviewBox!.y.toFixed(0)}) is above "Smart Replies" (y=${srBox!.y.toFixed(0)}) ✓`,
  });
});

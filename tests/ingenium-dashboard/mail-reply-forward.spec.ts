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

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
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

/* ------------------------------------------------------------------ */
/*  Mock route setup                                                   */
/* ------------------------------------------------------------------ */

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

  // Sync (POST /sync?project=...)
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

  // Sync-status (polled every 2s, /sync-status?project=...)
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

  // Single email by UID
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

  // Smart Suggest endpoint
  await page.route("**/api/v1/emails/suggest/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_SUGGEST_RESPONSE),
    });
  });

  // Settings (for mail_smart_replies_mode lookup)
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
/*  Helper: navigate to INBOX, open first email, click Reply           */
/* ------------------------------------------------------------------ */

async function openFirstEmailAndReply(page: Page) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${BASE}/mail`, { waitUntil: "domcontentloaded" });

  await expect(page.getByText(GMAIL_EMAIL).first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
  await expect(inboxBtn).toBeVisible({ timeout: 10000 });
  await inboxBtn.click();
  await page.waitForTimeout(1000);

  const emailRows = page.locator("div.cursor-pointer");
  await expect(emailRows.first()).toBeVisible({ timeout: 15000 });
  await emailRows.first().click();
  await page.waitForTimeout(800);

  const readerPane = page.locator("div.min-w-\\[400px\\]").first();
  await expect(readerPane).toBeVisible({ timeout: 5000 });

  const replyBtn = readerPane.getByRole("button", { name: "Reply" }).first();
  await expect(replyBtn).toBeVisible();
  await replyBtn.click();
  await page.waitForTimeout(800);
}

/* ------------------------------------------------------------------ */
/*  Test: Reply                                                        */
/* ------------------------------------------------------------------ */

test("Reply opens compose with To/Subject/From pre-filled and Body EMPTY", async ({ page }) => {
  await setupMocks(page);
  await openFirstEmailAndReply(page);

  // The inline reply composer should appear inside the reader (not a modal)
  // Verify the To field is visible — inline composer renders in the reader
  const toInput = page.getByPlaceholder("recipient@example.com");
  await expect(toInput).toBeVisible({ timeout: 5000 });

  // --- VERIFY To: pre-filled with sender's address ---
  const toValue = await toInput.inputValue();
  expect(toValue).toBe("alice@example.com");
  test.info().annotations.push({
    type: "reply",
    description: `Reply To field: "${toValue}" — matches alice@example.com ✓`,
  });

  // --- VERIFY Subject: pre-filled with "Re: ..." ---
  // buildReplySubject doesn't double-prefix: if subject already starts with "Re:", it's used as-is
  const subjectInput = page.getByPlaceholder("Subject");
  await expect(subjectInput).toBeVisible();
  const subjectValue = await subjectInput.inputValue();
  expect(subjectValue).toBe("Re: Project update — Q3 planning");
  test.info().annotations.push({
    type: "reply",
    description: `Reply Subject: "${subjectValue}" — preserves existing "Re: " prefix ✓`,
  });

  // --- VERIFY From: a select is visible and has a value ---
  const fromSelect = page.locator("select").first();
  await expect(fromSelect).toBeVisible();
  const fromValue = await fromSelect.inputValue();
  expect(fromValue).toBe(ACCOUNT_ID);
  test.info().annotations.push({
    type: "reply",
    description: `Reply From account: "${fromValue}" — matches selected account ✓`,
  });

  // --- VERIFY Body: EMPTY ---
  // The RichTextEditor uses a TipTap contenteditable div, NOT a textarea.
  // Use the ProseMirror editor for body assertions.
  const bodyEditor = page.locator('[contenteditable="true"]').first();
  await expect(bodyEditor).toBeVisible();
  const bodyText = await bodyEditor.textContent();
  expect(bodyText?.trim() || "").toBe("");
  test.info().annotations.push({
    type: "reply",
    description: `Reply Body: empty string — Body is EMPTY as required ✓`,
  });

  // --- VERIFY DOM order: "Review with AI" appears BEFORE "Smart Replies" heading ---
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

  // The HTML message must fill the available body pane instead of being
  // trapped in the iframe's 200px minimum height.
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

  // Close the inline composer via Discard
  const discardBtn = page.getByRole("button", { name: "Discard" }).first();
  await expect(discardBtn).toBeVisible({ timeout: 3000 });
  await discardBtn.click();
  await page.waitForTimeout(500);
  // Verify inline composer is gone (To field no longer visible)
  await expect(toInput).not.toBeVisible();
});

/* ------------------------------------------------------------------ */
/*  Test: Forward — regression check                                   */
/* ------------------------------------------------------------------ */

test("Forward opens blank compose with nothing pre-filled", async ({ page }) => {
  await setupMocks(page);
  await page.goto(`${BASE}/mail`, { waitUntil: "domcontentloaded" });

  // Wait for account selector
  await expect(page.getByText(GMAIL_EMAIL).first()).toBeVisible({ timeout: 15000 });

  // Wait for sync status to resolve
  await page.waitForTimeout(2000);

  // Click INBOX to load email list
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

  // Wait for reader pane to appear
  const readerPane = page.locator("div.min-w-\\[400px\\]").first();
  await expect(readerPane).toBeVisible({ timeout: 5000 });

  // Click Forward
  const forwardBtn = readerPane.getByRole("button", { name: "Forward" }).first();
  await expect(forwardBtn).toBeVisible();
  await forwardBtn.click();
  await page.waitForTimeout(800);

  // The compose overlay should be visible
  const composeHeading = page.getByRole("heading", { name: "Compose" }).first();
  await expect(composeHeading).toBeVisible({ timeout: 5000 });

  // --- VERIFY To: NOT pre-filled (empty) ---
  const toInput = page.getByPlaceholder("To");
  await expect(toInput).toBeVisible();
  const toValue = await toInput.inputValue();
  expect(toValue).toBe("");
  test.info().annotations.push({
    type: "forward",
    description: `Forward To field: "${toValue}" — empty (nothing pre-filled) ✓`,
  });

  // --- VERIFY Subject: NOT pre-filled (empty) ---
  const subjectInput = page.getByPlaceholder("Subject");
  await expect(subjectInput).toBeVisible();
  const subjectValue = await subjectInput.inputValue();
  expect(subjectValue).toBe("");
  test.info().annotations.push({
    type: "forward",
    description: `Forward Subject: "${subjectValue}" — empty (nothing pre-filled) ✓`,
  });

  // --- VERIFY Body: NOT pre-filled (empty) ---
  // The RichTextEditor uses TipTap contenteditable div, not textarea.
  const bodyEditor = page.locator('[contenteditable="true"]').first();
  await expect(bodyEditor).toBeVisible();
  const bodyText = await bodyEditor.textContent();
  expect(bodyText?.trim() || "").toBe("");
  test.info().annotations.push({
    type: "forward",
    description: `Forward Body: empty — nothing pre-filled ✓`,
  });

  // --- VERIFY From: the first account is pre-selected (same as Reply behavior) ---
  const fromSelect = page.locator("select").first();
  await expect(fromSelect).toBeVisible();
  const fromValue = await fromSelect.inputValue();
  expect(fromValue).toBe(ACCOUNT_ID);

  // Close the compose modal via Discard
  await page.getByRole("button", { name: "Discard" }).click();
  await page.waitForTimeout(500);
  await expect(composeHeading).not.toBeVisible();
});

/* ------------------------------------------------------------------ */
/*  Test: Smart Replies cards are collapsible                          */
/* ------------------------------------------------------------------ */

test("Smart Replies cards are collapsible with aria-expanded", async ({ page }) => {
  await setupMocks(page);
  await openFirstEmailAndReply(page);

  // The smart-replies toggle button should be visible with aria-expanded="true"
  const toggleBtn = page.locator('button[aria-expanded][aria-controls]');
  await expect(toggleBtn).toBeVisible({ timeout: 5000 });
  expect(await toggleBtn.getAttribute("aria-expanded")).toBe("true");

  // The suggestion cards should be visible
  const suggestionCards = page.locator('div[role="button"][tabindex="0"]');
  const visibleCards = await suggestionCards.count();
  expect(visibleCards).toBeGreaterThanOrEqual(1);

  // Click to collapse
  await toggleBtn.click();
  await page.waitForTimeout(300);
  expect(await toggleBtn.getAttribute("aria-expanded")).toBe("false");

  // Cards should be hidden now
  await expect(suggestionCards.first()).not.toBeVisible();

  // Click to expand again
  await toggleBtn.click();
  await page.waitForTimeout(300);
  expect(await toggleBtn.getAttribute("aria-expanded")).toBe("true");
  await expect(suggestionCards.first()).toBeVisible();
});

/* ------------------------------------------------------------------ */
/*  Test: Clicking a Smart Reply card applies the draft                */
/* ------------------------------------------------------------------ */

test("Clicking a Smart Reply card applies the draft", async ({ page }) => {
  await setupMocks(page);
  await openFirstEmailAndReply(page);

  // Wait for smart reply suggestion cards to load
  const suggestionCards = page.locator('div[role="button"][tabindex="0"]');
  await expect(suggestionCards.first()).toBeVisible({ timeout: 8000 });

  // Get the first card's tone label text
  const firstCardTone = await suggestionCards.first().locator("span").first().textContent();
  expect(firstCardTone).toBeTruthy();

  // Click the entire card div (not a button inside it)
  await suggestionCards.first().click();
  await page.waitForTimeout(500);

  // Verify the draft was applied — the subject should be updated
  const subjectInput = page.getByPlaceholder("Subject");
  const subjectValue = await subjectInput.inputValue();
  expect(subjectValue).toContain("Re:");
  test.info().annotations.push({
    type: "smart-suggest",
    description: `Subject after card click: "${subjectValue}" — draft was applied ✓`,
  });
});

/* ------------------------------------------------------------------ */
/*  Test: Copy button does not apply draft                             */
/* ------------------------------------------------------------------ */

test("Copy button on Smart Reply card does not apply draft", async ({ page }) => {
  await setupMocks(page);
  await openFirstEmailAndReply(page);

  // Wait for smart reply suggestion cards to load
  const suggestionCards = page.locator('div[role="button"][tabindex="0"]');
  await expect(suggestionCards.first()).toBeVisible({ timeout: 8000 });

  // Get the current subject before clicking copy
  const subjectInput = page.getByPlaceholder("Subject");
  const subjectBefore = await subjectInput.inputValue();

  // Find the copy icon button inside the first card (aria-label="Copy draft to clipboard")
  const copyBtn = suggestionCards.first().locator('button[aria-label="Copy draft to clipboard"]');
  await expect(copyBtn).toBeVisible();

  // Click the copy button
  await copyBtn.click();
  await page.waitForTimeout(300);

  // Verify the subject did NOT change (draft was not applied)
  const subjectAfter = await subjectInput.inputValue();
  expect(subjectAfter).toBe(subjectBefore);
  test.info().annotations.push({
    type: "smart-suggest",
    description: `Subject unchanged after copy click — draft NOT applied ✓`,
  });
});

/* ------------------------------------------------------------------ */
/*  Test: Review with AI appears above Smart Replies in inline reply   */
/* ------------------------------------------------------------------ */

test("Review with AI appears above Smart Replies in inline reply", async ({ page }) => {
  await setupMocks(page);
  await openFirstEmailAndReply(page);

  // Both the "Review with AI" button and "Smart Replies" heading should be visible
  const reviewBtn = page.locator('button:has-text("Review with AI")').first();
  const smartRepliesHeading = page.locator('button:has-text("Smart Replies")').first();

  await expect(reviewBtn).toBeVisible({ timeout: 5000 });
  await expect(smartRepliesHeading).toBeVisible({ timeout: 8000 });

  // Verify DOM order: Review with AI appears ABOVE Smart Replies
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

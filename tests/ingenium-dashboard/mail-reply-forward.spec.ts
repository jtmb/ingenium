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
}

/* ------------------------------------------------------------------ */
/*  Test: Reply                                                        */
/* ------------------------------------------------------------------ */

test("Reply opens compose with To/Subject/From pre-filled and Body EMPTY", async ({ page }) => {
  await setupMocks(page);
  await page.goto(`${BASE}/mail`, { waitUntil: "domcontentloaded" });

  // Wait for account selector
  await expect(page.getByText(GMAIL_EMAIL).first()).toBeVisible({ timeout: 15000 });

  // Wait for sync status to resolve so inbox renders
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

  // Wait for reader pane to appear
  const readerPane = page.locator("div.min-w-\\[400px\\]").first();
  await expect(readerPane).toBeVisible({ timeout: 5000 });

  // Click Reply
  const replyBtn = readerPane.getByRole("button", { name: "Reply" }).first();
  await expect(replyBtn).toBeVisible();
  await replyBtn.click();
  await page.waitForTimeout(800);

  // The compose overlay should be visible
  const composeHeading = page.getByRole("heading", { name: "Compose" }).first();
  await expect(composeHeading).toBeVisible({ timeout: 5000 });

  // --- VERIFY To: pre-filled with sender's address ---
  const toInput = page.getByPlaceholder("To");
  await expect(toInput).toBeVisible();
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
  const bodyTextarea = page.getByPlaceholder("Write your message...");
  await expect(bodyTextarea).toBeVisible();
  const bodyValue = await bodyTextarea.inputValue();
  expect(bodyValue).toBe("");
  test.info().annotations.push({
    type: "reply",
    description: `Reply Body: empty string "${bodyValue}" — Body is EMPTY as required ✓`,
  });

  // Close the compose modal via Discard
  await page.getByRole("button", { name: "Discard" }).click();
  await page.waitForTimeout(500);
  await expect(composeHeading).not.toBeVisible();
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
  const bodyTextarea = page.getByPlaceholder("Write your message...");
  await expect(bodyTextarea).toBeVisible();
  const bodyValue = await bodyTextarea.inputValue();
  expect(bodyValue).toBe("");
  test.info().annotations.push({
    type: "forward",
    description: `Forward Body: "${bodyValue}" — empty (nothing pre-filled) ✓`,
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

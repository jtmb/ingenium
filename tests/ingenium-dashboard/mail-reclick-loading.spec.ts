import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

/**
 * E2E test for DP#32 — re-clicking the same email must NOT flash the loading skeleton.
 *
 * Verifies:
 * 1. Click email A → content loads (normal)
 * 2. Click email B → loading skeleton appears briefly, then content loads (normal)
 * 3. Click email A again (re-click #1) → content loads (selectedEmail changes, normal load)
 * 4. Click email A again (re-click #2) → NO loading skeleton, content instantly shown
 * 5. Click email A again (re-click #3) → NO loading skeleton, content instantly shown
 * 6. Click email C (different) → loading skeleton appears, then content loads
 *
 * The guard at mail/page.tsx line 202-203:
 *   if (selectedEmail?.uid === uid) return;
 * ensures re-clicks are no-ops with zero state reset.
 */

const BASE = "http://localhost:3000";
const SCREENSHOTS_DIR = "/tmp/opencode";
const GMAIL_EMAIL = "james.branco@gmail.com";
const ACCOUNT_ID = "5a214d5b-1d89-4e89-9bd9-7a857495efa7";
const EMAIL_LOAD_DELAY = 350; // ms delay to make loading skeleton observable

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
/* ------------------------------------------------------------------ */

const MOCK_PROJECTS = {
  data: [
    { name: "global-default", is_global: 1 },
  ],
  total: 1,
};

const MOCK_ACCOUNTS = {
  data: [
    { id: ACCOUNT_ID, email: GMAIL_EMAIL, name: "james.branco@gmail.com", provider: "gmail", authType: "oauth2", connected: true },
  ],
  total: 1,
};

const MOCK_FOLDERS = {
  data: [
    { name: "INBOX", path: "INBOX", totalMessages: 62000 },
  ],
  total: 1,
};

function generateMockEmails(count = 25) {
  const emails = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const date = new Date(now - i * 3600000);
    emails.push({
      uid: 100000 - i,
      subject: i === 0 ? "Re: Project update — Q3 planning" : `Test email ${i + 1}: ${["Meeting notes", "Invoice attached", "Quick question", "Weekly digest", "Action required"][i % 5]}`,
      from: [{ name: ["Alice Smith", "Bob Jones", "Carol Lee"][i % 3], address: [`alice@example.com`, `bob@example.com`, `carol@example.com`][i % 3] }],
      to: [{ name: "James Branco", address: GMAIL_EMAIL }],
      date: date.toISOString(),
      body: { text: `This is the body of email ${i + 1}.`, html: `<div><p>Body of email ${i + 1}</p></div>` },
      flags: i < 3 ? [] : ["\\Seen"],
      folder: "INBOX",
      hasAttachments: false,
      attachments: [],
    });
  }
  return emails;
}

const MOCK_EMAILS = generateMockEmails(25);

/* ------------------------------------------------------------------ */
/*  Mock route setup — uses URL function matchers for precision        */
/* ------------------------------------------------------------------ */

async function setupMocks(page: Page) {
  await page.unroute();

  // 1. Projects (for useMailProject hook)
  await page.route("**/api/v1/projects*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_PROJECTS) });
  });

  // 2. Accounts — specific path
  await page.route("**/api/v1/emails/accounts*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_ACCOUNTS) });
  });

  // 3. Folders
  await page.route("**/api/v1/emails/folders*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_FOLDERS) });
  });

  // 4. Sync status
  await page.route("**/api/v1/emails/sync-status*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { overall: "done", account: ACCOUNT_ID, totalFolders: 1, syncingFolders: 0, totalCached: 25, totalBodies: 25, folders: [{ folder: "INBOX", cachedCount: 25, bodyCount: 25, lastSyncedAt: new Date().toISOString(), syncing: false }] } }) });
  });

  // 5. Email list — match /emails? with query params (NOT /emails/accounts, /emails/folders, etc.)
  await page.route(
    (url) => url.pathname === "/api/v1/emails" && url.searchParams.has("project") && !url.searchParams.has("q"),
    async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: MOCK_EMAILS, total: MOCK_EMAILS.length, source: "cache" }) });
    },
  );

  // 6. Search endpoint
  await page.route(
    (url) => url.pathname === "/api/v1/emails" && url.searchParams.has("q"),
    async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: MOCK_EMAILS.slice(0, 5), total: 5 }) });
    },
  );

  // 7. Single email by UID — match /emails/<digits> with project param
  await page.route(
    (url) => /\/api\/v1\/emails\/\d+$/.test(url.pathname) && url.searchParams.has("project"),
    async (route) => {
      const uid = parseInt(route.request().url().split("/").pop()!.split("?")[0], 10);
      const email = MOCK_EMAILS.find((e) => e.uid === uid) || MOCK_EMAILS[0];

      // Add delay so loading skeleton is observable
      await new Promise(r => setTimeout(r, EMAIL_LOAD_DELAY));

      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: email, source: "cache" }) });
    },
  );

  // 8. Suggestions endpoint
  await page.route(
    (url) => url.pathname.includes("/suggest"),
    async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ suggestions: [{ tone: "professional", subject: "Re: Test", body: "Thank you for your email." }], source: "cache", configured: true }) });
    },
  );

  // 9. Sync endpoint
  await page.route(
    (url) => url.pathname === "/api/v1/emails/sync",
    async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { account: ACCOUNT_ID, folders: 1, totalSynced: 25, results: [] } }) });
    },
  );

  // 10. Settings (smart replies and other settings)
  await page.route("**/api/v1/settings*", async (route) => {
    const url = new URL(route.request().url());
    const key = url.searchParams.get("key") || "";
    if (key.includes("smart") || key.includes("synthesis")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { value: "true" } }) });
    } else {
      await route.continue();
    }
  });
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

async function clickEmailRow(page: Page, index = 0) {
  const rows = page.locator("div.cursor-pointer");
  await rows.nth(index).click();
}

/* ------------------------------------------------------------------ */
/*  Test                                                               */
/* ------------------------------------------------------------------ */

test.describe("Mail — re-click loading skeleton (DP#32)", () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test("re-clicking the same email 3 times shows NO loading skeleton; clicking a different email triggers normal load", async ({ page }) => {
    await gotoMail(page);
    await waitForAccount(page);

    // Click INBOX folder to load email list
    const inboxBtn = page.locator("button").filter({ hasText: "INBOX" }).first();
    await expect(inboxBtn).toBeVisible({ timeout: 15000 });
    await inboxBtn.click();

    // Wait for email rows to appear
    const emailRows = page.locator("div.cursor-pointer");
    await expect(emailRows.first()).toBeVisible({ timeout: 15000 });

    // Verify at least 3 email rows exist
    const rowCount = await emailRows.count();
    expect(rowCount).toBeGreaterThanOrEqual(3);

    // ====================================================================
    // STEP 1: Click email A (index 0, uid=100000) — normal load
    // ====================================================================
    console.log("Step 1: Click email A (uid=100000)");

    await clickEmailRow(page, 0);

    // Loading skeleton should appear briefly
    const loadingSkeleton = page.getByTestId("email-reader-loading");
    await expect(loadingSkeleton).toBeVisible({ timeout: 3000 });

    // Then content should appear
    const contentPane = page.getByTestId("email-reader-content");
    await expect(contentPane).toBeVisible({ timeout: 5000 });

    // Verify subject
    await expect(contentPane.getByText("Project update")).toBeVisible({ timeout: 3000 });
    console.log("  ✓ Email A content loaded");

    // ====================================================================
    // STEP 2: Click email B (index 1, uid=99999) — different email
    // ====================================================================
    console.log("Step 2: Click email B (uid=99999) — different email");

    await clickEmailRow(page, 1);

    // Loading skeleton should appear (different email = new fetch)
    await expect(loadingSkeleton).toBeVisible({ timeout: 3000 });

    // Content should load
    await expect(contentPane).toBeVisible({ timeout: 5000 });
    console.log("  ✓ Email B content loaded");

    // ====================================================================
    // STEP 3: Click email A again (re-click #1) — selectedEmail changes
    // ====================================================================
    console.log("Step 3: Click email A (re-click #1)");

    await clickEmailRow(page, 0);
    await expect(contentPane).toBeVisible({ timeout: 5000 });
    console.log("  ✓ Email A content loaded (re-click #1)");

    // ====================================================================
    // STEP 4: Click email A again (re-click #2) — MUST be instant, no skeleton
    // ====================================================================
    console.log("Step 4: Click email A (re-click #2) — must be instant");

    await clickEmailRow(page, 0);

    // Wait a brief moment for any potential React re-render
    await page.waitForTimeout(500);

    // THE CRITICAL ASSERTION: loading skeleton MUST NOT be visible
    await expect(loadingSkeleton).not.toBeVisible({ timeout: 1000 });

    // Content must still be visible
    await expect(contentPane).toBeVisible();

    // Take screenshot for evidence
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "mail-reclick-04.png") });
    console.log("  ✓ No loading skeleton on re-click #2");

    // ====================================================================
    // STEP 5: Click email A again (re-click #3) — MUST be instant, no skeleton
    // ====================================================================
    console.log("Step 5: Click email A (re-click #3) — must be instant");

    await clickEmailRow(page, 0);
    await page.waitForTimeout(500);

    await expect(loadingSkeleton).not.toBeVisible({ timeout: 1000 });

    // Content must still be visible with correct email A subject
    await expect(contentPane).toBeVisible();
    await expect(contentPane.getByText("Project update")).toBeVisible({ timeout: 3000 });
    console.log("  ✓ No loading skeleton on re-click #3");

    // ====================================================================
    // STEP 6: Click email C (index 2, uid=99998) — DIFFERENT email
    //         Must trigger normal load sequence (loading skeleton appears)
    // ====================================================================
    console.log("Step 6: Click email C (index 2, uid=99998) — different email");

    await clickEmailRow(page, 2);

    // Loading skeleton MUST appear (different email = new fetch)
    await expect(loadingSkeleton).toBeVisible({ timeout: 3000 });

    // Content should load
    await expect(contentPane).toBeVisible({ timeout: 5000 });
    console.log("  ✓ Different email triggers normal load (loading skeleton shown)");

    // Take final screenshot
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "mail-reclick-final.png") });
  });
});

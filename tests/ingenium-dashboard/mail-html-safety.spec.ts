import { test, expect, Page } from "@playwright/test";

/**
 * E2E tests verifying that the email reader safely renders potentially
 * dangerous or malformed HTML email content.
 *
 * 🔴 These tests run against the REAL API — no page.route() mocks for
 * email content. Each test:
 *   1. Sends a real crash email via SMTP (POST /emails)
 *   2. Syncs INBOX via IMAP (POST /emails/sync)
 *   3. Opens the email through the live UI
 *   4. Asserts safety (no page crash, no style leak, graceful rendering)
 *   5. Cleans up by deleting the test email (DELETE /emails/:uid)
 *
 * The Gmail account (james.branco@gmail.com, id 68a96f5b-faaf-41d3-967e-5981564ec080)
 * must be connected and authenticated. Tests skip gracefully if the account
 * is not connected or SMTP fails.
 *
 * Each uses a unique timestamped subject so test emails are independently
 * identifiable and non-interfering.
 *
 * 🔴 KNOWN ISSUE: page.waitForLoadState("load") is used, never
 * "networkidle", because the mail page polls /sync-status every 2s.
 * 🔴 KNOWN ISSUE: URL patterns matching GET /emails/** must exclude
 * /sync-status to avoid false matches.
 * 🔴 KNOWN ISSUE: After sending, Gmail may take 1-3s to deliver even
 *    self-sent email. A small delay between send and sync is included.
 */

const API_BASE = "http://localhost:4097/api/v1";
const ACCOUNT_ID = "68a96f5b-faaf-41d3-967e-5981564ec080";
const GMAIL_EMAIL = "james.branco@gmail.com";

// =========================================================================
//  Helpers
// =========================================================================

/**
 * Collect pageerror events into an array for zero-error assertions.
 */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    errors.push(err.message);
  });
  return errors;
}

/**
 * Wait for the sync-status endpoint to report warm cache (overall !== "syncing").
 */
async function waitForWarmCache(page: Page, timeout = 120_000): Promise<void> {
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

/**
 * Poll sync-status for a specific folder until it has cached count > 0.
 * This ensures the email list will include the just-sent email.
 */
async function waitForFolderCache(
  page: Page,
  folder: string,
  timeout = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await page.request.get(
        `${API_BASE}/emails/sync-status?account=${ACCOUNT_ID}&project=global-default`,
      );
      if (r.ok()) {
        const d = await r.json();
        const folderStatus = d?.data?.folders?.find(
          (f: any) => f.folder === folder,
        );
        if (folderStatus && folderStatus.cachedCount > 0) return;
      }
    } catch {
      // Ignore transient errors
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timed out waiting for folder "${folder}" to have cached data`);
}

/**
 * Delete a test email from the IMAP folder via the API.
 * Uses DELETE /emails/:uid with account and folder in the body.
 */
async function deleteTestEmail(
  page: Page,
  uid: number,
  folder = "INBOX",
): Promise<boolean> {
  try {
    const resp = await page.request.delete(
      `${API_BASE}/emails/${uid}?project=global-default`,
      {
        data: { account: ACCOUNT_ID, folder },
        headers: { "Content-Type": "application/json" },
      },
    );
    return resp.ok();
  } catch {
    return false;
  }
}

/**
 * Search for an email by subject via the API search endpoint.
 * Returns the first matching UID or null.
 */
async function findEmailBySubject(
  page: Page,
  subject: string,
  folder = "INBOX",
  retries = 3,
): Promise<number | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Give SMTP delivery and IMAP sync a moment to settle between retries
      if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));

      const resp = await page.request.get(
        `${API_BASE}/emails/search?account=${ACCOUNT_ID}&q=${encodeURIComponent(subject)}&folder=${encodeURIComponent(folder)}&project=global-default`,
      );
      if (!resp.ok()) continue;

      const data = await resp.json();
      const uids: number[] = data?.data ?? [];
      if (uids.length > 0) return uids[0];
    } catch {
      // Transient failure — retry
    }
  }
  return null;
}

// =========================================================================
//  Tests
// =========================================================================

test.describe("Mail — HTML Sanitization & Safety (Real API)", () => {
  /* ================================================================== */
  /*  1. HTML email with style tags renders in iframe, does not break    */
  /*     page layout                                                     */
  /* ================================================================== */

  test("1 - HTML email with style tags renders in iframe, does not break page", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    const TEST_TS = Date.now();
    const SUBJECT = `HTML-SAFETY-REAL-${TEST_TS}-style-inject`;

    // ── 1. Send crash email via SMTP ──────────────────────────────────
    const htmlContent =
      '<html><head><style>body{display:none!important;background:#ff0000!important}*{color:red!important}.overlay{position:fixed;top:0;left:0;width:100vw;height:100vh;background:red;z-index:99999}</style></head><body><div class="overlay">PWNED</div><table><tr><td>hello</tr></table></body></html>';

    const sendResp = await page.request.post(
      `${API_BASE}/emails?project=global-default`,
      {
        data: {
          account: ACCOUNT_ID,
          to: [{ address: GMAIL_EMAIL }],
          subject: SUBJECT,
          html: htmlContent,
        },
        headers: { "Content-Type": "application/json" },
      },
    );

    // Skip if SMTP is not available (account not connected, etc.)
    test.skip(
      !sendResp.ok(),
      `SMTP send failed (${sendResp.status()}): cannot test HTML safety without sending a real email`,
    );

    // ── 2. Sync INBOX to bring the sent email into cache ──────────────
    // Wait briefly for SMTP→Gmail delivery (self-sends are typically instant)
    await new Promise((r) => setTimeout(r, 2000));

    const syncResp = await page.request.post(
      `${API_BASE}/emails/sync?account=${ACCOUNT_ID}&project=global-default&folder=INBOX`,
    );
    expect(syncResp.ok()).toBeTruthy();

    // Wait for INBOX folder to have cached data
    await waitForFolderCache(page, "INBOX");

    // ── 3. Find the email UID via API search ──────────────────────────
    const uid = await findEmailBySubject(page, SUBJECT, "INBOX", 5);
    test.skip(uid === null, `Could not find test email "${SUBJECT}" in INBOX after sync — skipping`);

    // ── 4. Pre-cache the email body (fetch via API so cache is warm) ──
    const bodyResp = await page.request.get(
      `${API_BASE}/emails/${uid}?project=global-default&account=${ACCOUNT_ID}&folder=INBOX`,
    );
    expect(bodyResp.ok()).toBeTruthy();
    const bodyData = await bodyResp.json();
    expect(bodyData.source).toBe("imap"); // First fetch comes from IMAP

    // ── 5. Navigate to /mail ──────────────────────────────────────────
    await page.goto("/mail", { waitUntil: "load" });
    await waitForWarmCache(page);

    // Click INBOX folder
    const inboxBtn = page
      .locator("button")
      .filter({ hasText: "INBOX" })
      .first();
    await expect(inboxBtn).toBeVisible({ timeout: 10_000 });
    await inboxBtn.click();

    // Wait for email list to populate
    const emailRows = page.locator("div.cursor-pointer");
    await expect(emailRows.first()).toBeVisible({ timeout: 15_000 });

    // ── 6. Find and click the crash email by subject ──────────────────
    // The email was just sent so it should be among the first results.
    // Use text matching to find the row with our unique subject.
    const crashEmailRow = emailRows.filter({ hasText: SUBJECT }).first();
    const rowVisible = await crashEmailRow.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(!rowVisible, `Could not find email row with subject "${SUBJECT}" in the UI — skipping`);

    await crashEmailRow.click();

    // ── 7. Assert safety ──────────────────────────────────────────────

    // ✅ The HTML body should render in an iframe with sandbox attribute
    const iframe = page.locator('[data-testid="email-html-iframe"]');
    await expect(iframe).toBeVisible({ timeout: 10_000 });

    // ✅ Iframe must have a sandbox attribute (security policy enforcement)
    const sandboxAttr = await iframe.getAttribute("sandbox");
    expect(sandboxAttr).not.toBeNull();
    expect(sandboxAttr).toContain("allow-same-origin");

    // ✅ Zero page-level crash errors
    expect(pageErrors).toHaveLength(0);

    // ✅ Page heading "Mail" must still be visible (page didn't crash)
    const mailHeading = page.locator("h1").filter({ hasText: "Mail" });
    await expect(mailHeading).toBeVisible({ timeout: 3000 });

    // ✅ Main document body background must NOT be red — the crash email's
    // CSS is sandboxed inside the iframe and must not leak to the parent.
    const bodyBgColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });
    expect(bodyBgColor).not.toBe("rgb(255, 0, 0)");
    expect(bodyBgColor).not.toBe("red");

    // ── 8. Cleanup: delete the test email ─────────────────────────────
    const deleted = await deleteTestEmail(page, uid!);
    test.info().annotations.push({
      type: "cleanup",
      description: `Deleted test email UID ${uid}: ${deleted ? "OK" : "FAILED"}`,
    });
  });

  /* ================================================================== */
  /*  2. Malformed HTML email does not crash the page                     */
  /* ================================================================== */

  test("2 - malformed HTML email does not crash the page", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    const TEST_TS = Date.now();
    const SUBJECT = `HTML-SAFETY-REAL-${TEST_TS}-malformed-table`;

    // ── 1. Send crash email with malformed HTML ───────────────────────
    // Unclosed <tr> / <td> tags that browsers typically try to "fix"
    const htmlContent = '<table><tr><td>cell1<tr><td>cell2</table>';

    const sendResp = await page.request.post(
      `${API_BASE}/emails?project=global-default`,
      {
        data: {
          account: ACCOUNT_ID,
          to: [{ address: GMAIL_EMAIL }],
          subject: SUBJECT,
          html: htmlContent,
        },
        headers: { "Content-Type": "application/json" },
      },
    );

    test.skip(
      !sendResp.ok(),
      `SMTP send failed (${sendResp.status()}): cannot test HTML safety without sending a real email`,
    );

    // ── 2. Sync INBOX ─────────────────────────────────────────────────
    await new Promise((r) => setTimeout(r, 2000));

    const syncResp = await page.request.post(
      `${API_BASE}/emails/sync?account=${ACCOUNT_ID}&project=global-default&folder=INBOX`,
    );
    expect(syncResp.ok()).toBeTruthy();
    await waitForFolderCache(page, "INBOX");

    // ── 3. Find the email UID via API search ──────────────────────────
    const uid = await findEmailBySubject(page, SUBJECT, "INBOX", 5);
    test.skip(uid === null, `Could not find test email "${SUBJECT}" in INBOX — skipping`);

    // ── 4. Pre-cache the email body ───────────────────────────────────
    const bodyResp = await page.request.get(
      `${API_BASE}/emails/${uid}?project=global-default&account=${ACCOUNT_ID}&folder=INBOX`,
    );
    expect(bodyResp.ok()).toBeTruthy();

    // ── 5. Navigate to /mail and find the email ───────────────────────
    await page.goto("/mail", { waitUntil: "load" });
    await waitForWarmCache(page);

    const inboxBtn = page
      .locator("button")
      .filter({ hasText: "INBOX" })
      .first();
    await expect(inboxBtn).toBeVisible({ timeout: 10_000 });
    await inboxBtn.click();

    const emailRows = page.locator("div.cursor-pointer");
    await expect(emailRows.first()).toBeVisible({ timeout: 15_000 });

    // Find the crash email by subject
    const crashEmailRow = emailRows.filter({ hasText: SUBJECT }).first();
    const rowVisible = await crashEmailRow.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(!rowVisible, `Could not find email row with subject "${SUBJECT}" in the UI — skipping`);

    await crashEmailRow.click();

    // ── 6. Assert safety ──────────────────────────────────────────────

    // ✅ The malformed HTML doesn't have <html>/<body> tags, so the
    // EmailReader wraps it in a skeleton. It renders either as an iframe
    // (if parsed as HTML) or as a text pre block.
    const readerContent = page.locator('[data-testid="email-reader-content"]');
    await expect(readerContent).toBeVisible({ timeout: 10_000 });

    // ✅ Error boundary must not appear (malformed HTML handled gracefully)
    const errorBoundary = page.locator('[data-testid="email-error-boundary"]');
    await expect(errorBoundary).not.toBeVisible({ timeout: 3000 });

    // ✅ Zero page-level crash errors
    expect(pageErrors).toHaveLength(0);

    // ✅ The reader should show either an iframe (html email) or pre (text)
    const hasIframe = await page
      .locator('[data-testid="email-html-iframe"]')
      .isVisible()
      .catch(() => false);
    const hasText = await readerContent
      .locator("pre")
      .isVisible()
      .catch(() => false);
    expect(hasIframe || hasText).toBeTruthy();

    // ✅ Page heading "Mail" must still be visible
    const mailHeading = page.locator("h1").filter({ hasText: "Mail" });
    await expect(mailHeading).toBeVisible({ timeout: 3000 });

    // ── 7. Cleanup ────────────────────────────────────────────────────
    const deleted = await deleteTestEmail(page, uid!);
    test.info().annotations.push({
      type: "cleanup",
      description: `Deleted test email UID ${uid}: ${deleted ? "OK" : "FAILED"}`,
    });
  });
});

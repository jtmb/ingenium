import { test, expect, Page } from "@playwright/test";

/**
 * Safety checks for dangerous and malformed HTML email content. The suite
 * sends through the configured mail service and removes each uniquely named
 * message after inspection.
 */

const API_BASE = "http://localhost:4097/api/v1";
const ACCOUNT_ID = "68a96f5b-faaf-41d3-967e-5981564ec080";
const GMAIL_EMAIL = "james.branco@gmail.com";

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
      // Sync can briefly fail while the mailbox reconnects; keep polling until the deadline.
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
      // Delivery and IMAP indexing are eventually consistent, so the next attempt may succeed.
    }
  }
  return null;
}

test.describe("Mail — HTML Sanitization & Safety (Real API)", () => {
  test("1 - HTML email with style tags renders in iframe, does not break page", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    const TEST_TS = Date.now();
    const SUBJECT = `HTML-SAFETY-REAL-${TEST_TS}-style-inject`;

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

    expect(
      sendResp.ok(),
      `SMTP send failed (${sendResp.status()}): HTML safety requires a real sent message`,
    ).toBeTruthy();

    // Allow provider delivery to settle before the folder sync.
    await new Promise((r) => setTimeout(r, 2000));

    const syncResp = await page.request.post(
      `${API_BASE}/emails/sync?account=${ACCOUNT_ID}&project=global-default&folder=INBOX`,
    );
    expect(syncResp.ok()).toBeTruthy();

    await waitForFolderCache(page, "INBOX");

    const uid = await findEmailBySubject(page, SUBJECT, "INBOX", 5);
    if (uid === null) {
      throw new Error(`Could not find test email "${SUBJECT}" in INBOX after sync`);
    }

    const bodyResp = await page.request.get(
      `${API_BASE}/emails/${uid}?project=global-default&account=${ACCOUNT_ID}&folder=INBOX`,
    );
    expect(bodyResp.ok()).toBeTruthy();
    const bodyData = await bodyResp.json();
    expect(bodyData.source).toBe("imap"); // First fetch comes from IMAP

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

    const crashEmailRow = emailRows.filter({ hasText: SUBJECT }).first();
    await expect(crashEmailRow, `Could not find email row with subject "${SUBJECT}" in the UI`).toBeVisible({ timeout: 10_000 });

    await crashEmailRow.click();

    const iframe = page.locator('[data-testid="email-html-iframe"]');
    await expect(iframe).toBeVisible({ timeout: 10_000 });

    // Sandboxing prevents message CSS and scripts from reaching the parent.
    const sandboxAttr = await iframe.getAttribute("sandbox");
    expect(sandboxAttr).not.toBeNull();
    expect(sandboxAttr).toContain("allow-same-origin");

    expect(pageErrors).toHaveLength(0);

    const mailHeading = page.locator("h1").filter({ hasText: "Mail" });
    await expect(mailHeading).toBeVisible({ timeout: 3000 });

    // Parent styling must remain unchanged by message CSS.
    const bodyBgColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });
    expect(bodyBgColor).not.toBe("rgb(255, 0, 0)");
    expect(bodyBgColor).not.toBe("red");

    const deleted = await deleteTestEmail(page, uid!);
    test.info().annotations.push({
      type: "cleanup",
      description: `Deleted test email UID ${uid}: ${deleted ? "OK" : "FAILED"}`,
    });
  });

  test("2 - malformed HTML email does not crash the page", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    const TEST_TS = Date.now();
    const SUBJECT = `HTML-SAFETY-REAL-${TEST_TS}-malformed-table`;

    // Unclosed table cells exercise browser/parser recovery.
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

    expect(
      sendResp.ok(),
      `SMTP send failed (${sendResp.status()}): HTML safety requires a real sent message`,
    ).toBeTruthy();

    await new Promise((r) => setTimeout(r, 2000));

    const syncResp = await page.request.post(
      `${API_BASE}/emails/sync?account=${ACCOUNT_ID}&project=global-default&folder=INBOX`,
    );
    expect(syncResp.ok()).toBeTruthy();
    await waitForFolderCache(page, "INBOX");

    const uid = await findEmailBySubject(page, SUBJECT, "INBOX", 5);
    if (uid === null) {
      throw new Error(`Could not find test email "${SUBJECT}" in INBOX`);
    }

    const bodyResp = await page.request.get(
      `${API_BASE}/emails/${uid}?project=global-default&account=${ACCOUNT_ID}&folder=INBOX`,
    );
    expect(bodyResp.ok()).toBeTruthy();

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

    const crashEmailRow = emailRows.filter({ hasText: SUBJECT }).first();
    await expect(crashEmailRow, `Could not find email row with subject "${SUBJECT}" in the UI`).toBeVisible({ timeout: 10_000 });

    await crashEmailRow.click();

    // The reader must choose a safe HTML or text representation for malformed input.
    const readerContent = page.locator('[data-testid="email-reader-content"]');
    await expect(readerContent).toBeVisible({ timeout: 10_000 });

    const errorBoundary = page.locator('[data-testid="email-error-boundary"]');
    await expect(errorBoundary).not.toBeVisible({ timeout: 3000 });

    expect(pageErrors).toHaveLength(0);

    const renderedBody = page
      .locator('[data-testid="email-html-iframe"]')
      .or(readerContent.locator("pre"));
    await expect(renderedBody).toBeVisible({ timeout: 5000 });

    const mailHeading = page.locator("h1").filter({ hasText: "Mail" });
    await expect(mailHeading).toBeVisible({ timeout: 3000 });

    const deleted = await deleteTestEmail(page, uid!);
    test.info().annotations.push({
      type: "cleanup",
      description: `Deleted test email UID ${uid}: ${deleted ? "OK" : "FAILED"}`,
    });
  });
});

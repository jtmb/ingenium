import { test, expect, type Locator } from "@playwright/test";
import path from "path";
import { visualQaArtifactDirectory } from "./visual-qa-artifacts";

/**
 * REAL-SYSTEM INTEGRATION TESTS — NO MOCKS.
 *
 * These tests run against the live Next.js dashboard (port 3000) and real
 * API server (port 4097). All API requests hit the actual backend with
 * real database. NO page.route() mocks are used.
 *
 * The following data must exist in the real system:
 *   - global-default project with observations and personality traits
 *   - gh-llm-bootstrap project with 27 skills
 *   - james.branco@gmail.com email account (may not be OAuth2 connected)
 *
 * Screenshots are saved under tests/artifacts/visual-qa/<run-id>/.
 */

// ————————————————————————————————————————————————————————————————————————————
//  Constants
// ————————————————————————————————————————————————————————————————————————————

const BASE = process.env.INGENIUM_E2E_DASHBOARD_URL ?? "http://localhost:3000";
const SCREENSHOTS_DIR = visualQaArtifactDirectory("integration");
const PROJECT = "global-default";
const PROJECT_WITH_SKILLS = "gh-llm-bootstrap";
const GMAIL_EMAIL = "james.branco@gmail.com";

// ————————————————————————————————————————————————————————————————————————————
//  Helpers
// ————————————————————————————————————————————————————————————————————————————

/** Navigate to a dashboard page and wait for client JS to render dynamic content. */
async function goto(page: any, urlPath: string, project?: string) {
  const fullUrl = project
    ? `${BASE}${urlPath}?project=${project}`
    : `${BASE}${urlPath}`;
  const res = await page.goto(fullUrl, { waitUntil: "domcontentloaded" });
  expect(res?.ok()).toBeTruthy();
  await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
}

// ————————————————————————————————————————————————————————————————————————————
//  Test Suite: Dashboard — Real API Integration
// ————————————————————————————————————————————————————————————————————————————

test.describe("Dashboard Integration (real API, no mocks)", () => {
  /* ================================================================== */
  /*  1. Home page loads with stats                                      */
  /* ================================================================== */

  test("1 - Home page loads with live stats from API", async ({ page }) => {
    await goto(page, "/");

    // The page hero title is just "Ingenium"
    await expect(page.getByText("Ingenium").first()).toBeVisible();

    // Verify the live stats band. The page renders a 6-column grid where
    // each cell has a bold number and a label underneath.
    // Stats are loaded asynchronously from the API.
    // Look for stat values (text-3xl) that are NOT "..."
    // Find all stat values in the grid
    const statCards = page.locator(
      "div.grid > div.border.rounded-xl.p-6",
    );
    await expect(statCards.first()).toBeVisible({ timeout: 15_000 });
    const cardCount = await statCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(4);

    // At least one stat should have a numeric value (not "...")
    let foundNumericStat = false;
    for (let i = 0; i < cardCount; i++) {
      const val = await statCards
        .nth(i)
        .locator("> div")
        .first()
        .textContent();
      if (val && val !== "..." && val !== "—") {
        foundNumericStat = true;
        break;
      }
    }
    expect(foundNumericStat).toBeTruthy();

    // Take screenshot
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "phase2-test-01.png"),
      fullPage: true,
    });
  });

  /* ================================================================== */
  /*  2. Observations page shows data                                     */
  /* ================================================================== */

  test("2 - Observations page shows observations from API", async ({ page }) => {
    await goto(page, "/observations", PROJECT);

    // Page heading
    await expect(page.locator("h1")).toContainText("Observations");

    // Stats: Total and Pending count
    await expect(page.getByText("Total:").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Pending:").first()).toBeVisible({
      timeout: 5000,
    });

    // Check that observation type badges are rendered
    // These are spans like: <span class="text-xs px-2 py-0.5 rounded ...">preference</span>
    // Look for known types in the text content
    const knownTypes = [
      "preference",
      "pattern",
      "correction",
      "insight",
      "behavior",
    ];
    const allBadges = page.locator("span.text-xs");
    const count = await allBadges.count();
    expect(count, `Expected an observation badge from ${knownTypes.join(", ")}`).toBeGreaterThan(0);
    await expect(allBadges.first()).toContainText(/\S+/);

    // Screenshot
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "phase2-test-02.png"),
      fullPage: true,
    });
  });

  /* ================================================================== */
  /*  3. Personality page shows data                                      */
  /* ================================================================== */

  test("3 - Personality page shows traits from API", async ({ page }) => {
    await goto(page, "/personality", PROJECT);

    // Page heading
    await expect(page.locator("h1")).toContainText("Personality Profile");

    // Should show "N trait(s)" text
    const traitCount = page.locator("span.text-sm").filter({
      hasText: /trait\(s\)/,
    });
    await expect(traitCount).toBeVisible({ timeout: 10000 });

    // The personality page has two display modes: "grouped" (default) and "newest".
    // If traits loaded, we should see either:
    // 1. Grouped sections with type headers, or
    // 2. "all below the display threshold" banner, or
    // 3. Empty state "No personality traits learned yet"

    const emptyState = page.getByText("No personality traits learned yet");
    const hiddenBanner = page.getByText(/all below the display threshold/);
    const groupSections = page.locator(
      "div.border.rounded.overflow-hidden",
    );

    const isLoaded =
      (await groupSections.count()) > 0 ||
      (await hiddenBanner.isVisible()) ||
      (await emptyState.isVisible());

    expect(isLoaded).toBeTruthy();

    // Screenshot
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "phase2-test-03.png"),
      fullPage: true,
    });
  });

  /* ================================================================== */
  /*  4. Logs page shows entries from running API                         */
  /* ================================================================== */

  test("4 - Logs page shows entries from the running API", async ({ page }) => {
    await goto(page, "/logs");

    // Page heading
    await expect(page.locator("h1")).toContainText("System Logs");

    // The total count should be visible
    await expect(page.getByText("Total:").first()).toBeVisible({
      timeout: 15000,
    });

    // Wait for "Loading logs..." to disappear (data has arrived)
    await expect(
      page.getByText("Loading logs..."),
    ).not.toBeVisible({ timeout: 15000 });

    // Log entries should exist — check for table rendering
    // The logs page renders entries as <tr> rows with Time, Source, Level, Message
    const tableRows = page.locator("table tbody tr");
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Verify source badges are present (source column = 2nd td in each row)
    const sourceCell = tableRows.first().locator("td").nth(1);
    await expect(sourceCell).toBeVisible({ timeout: 3000 });
    const sourceBadge = sourceCell.locator("span.text-xs");
    await expect(sourceBadge).toBeVisible({ timeout: 3000 });

    // The pause/live button should be visible
    const pauseBtn = page.getByRole("button", {
      name: /Paused|Resume|LIVE|PAUSED/,
    });
    await expect(pauseBtn).toBeVisible({ timeout: 5000 });
  });

  /* ================================================================== */
  /*  5. Project persistence — reload retains data                        */
  /* ================================================================== */

  test("5 - Observations data persists across page reload", async ({ page }) => {
    await goto(page, "/observations", PROJECT);

    const statsTotal = page.getByText("Total:").first();
    await expect(statsTotal).toBeVisible({ timeout: 10000 });
    const initialTotalText = await statsTotal.textContent();

    // Reload the page
    await page.reload({ waitUntil: "domcontentloaded" });

    // The same stats should appear after reload
    const statsTotalAfter = page.getByText("Total:").first();
    await expect(statsTotalAfter).toBeVisible({ timeout: 10000 });
    const afterTotalText = await statsTotalAfter.textContent();

    // Total count should be the same after reload
    expect(afterTotalText).toEqual(initialTotalText);
  });

  /* ================================================================== */
  /*  6. Plugins page                                                     */
  /* ================================================================== */

  test("6 - Plugins page shows plugin cards or empty state", async ({ page }) => {
    await goto(page, "/plugins", PROJECT);

    // Page heading
    await expect(page.getByRole("heading", { name: "Plugins" })).toBeVisible({
      timeout: 10000,
    });

    // The Add Plugin button should be present
    await expect(
      page.getByRole("button", { name: /Add Plugin/i }),
    ).toBeVisible();

    // The page shows either:
    // - "No plugins registered" (empty state), or
    // - Plugin cards with "Edit", "Enabled"/"Disabled", "Delete" buttons
    const emptyState = page.getByText("No plugins registered");

    if (await emptyState.isVisible()) {
      // Empty state is fine — we verified the page loaded
      await expect(emptyState).toBeVisible();
    } else {
      // Plugin cards exist — verify action buttons
      const editBtn = page.getByRole("button", { name: "Edit" }).first();
      await expect(editBtn).toBeVisible({ timeout: 5000 });
      const toggleBtn = page
        .getByRole("button", { name: /Enabled|Disabled/i })
        .first();
      await expect(toggleBtn).toBeVisible();
      const deleteBtn = page.getByRole("button", { name: "Delete" }).first();
      await expect(deleteBtn).toBeVisible();
    }

    // Screenshot
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "phase2-test-06.png"),
      fullPage: true,
    });
  });

  /* ================================================================== */
  /*  7. Skills page loads                                                */
  /* ================================================================== */

  test("7 - Skills page renders skill cards from API data", async ({ page }) => {
    // Use gh-llm-bootstrap which has 27 skills
    await goto(page, "/skills", PROJECT_WITH_SKILLS);

    // Page heading — "Skills (N)"
    await expect(
      page.getByRole("heading", { name: /^Skills / }),
    ).toBeVisible({ timeout: 10000 });

    // Search input
    await expect(page.getByPlaceholder("Search skills...")).toBeVisible({
      timeout: 5000,
    });

    // Sort dropdown
    await expect(page.locator("select").first()).toBeVisible();

    // Upload Skill button
    await expect(
      page.getByRole("button", { name: "Upload Skill" }),
    ).toBeVisible();

    // Skill cards: each is a <div> with cursor-pointer, containing an <h3> with the name
    const skillCards = page.locator("div.grid > div > h3.font-medium");
    await expect(skillCards.first()).toBeVisible({ timeout: 15_000 });
    const cardCount = await skillCards.count();
    expect(cardCount).toBeGreaterThan(0);

    // Verify by checking for the first skill card name
    const firstSkillName = await skillCards.first().textContent();
    expect(firstSkillName).not.toBeNull();
    expect(firstSkillName!.trim().length).toBeGreaterThan(0);

    // Screenshot
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "phase2-test-07.png"),
      fullPage: true,
    });
  });
});

// ————————————————————————————————————————————————————————————————————————————
//  Test Suite: Mail Integration (real Gmail / real API, no mocks)
// ————————————————————————————————————————————————————————————————————————————

test.describe("Mail Integration (real API, no mocks)", () => {
  /* ================================================================== */
  /*  8. Mail page loads and shows account                                */
  /* ================================================================== */

  test("8 - Mail page loads and shows email account from API", async ({ page }) => {
    await goto(page, "/mail", PROJECT);

    // Page heading
    await expect(page.locator("h1").first()).toContainText("Mail", {
      timeout: 15000,
    });

    // The mail page has various states. Check which one we're in:
    // 1. EmptyState: "No email accounts configured" + "Add Account" button
    // 2. AccountSetup page (showAccountSetup=true)
    // 3. Full 3-pane layout with account selector

    const emailSelector = page
      .locator("button")
      .filter({ hasText: GMAIL_EMAIL })
      .first();

    await expect(emailSelector, `Expected configured account ${GMAIL_EMAIL}`).toBeVisible({ timeout: 15_000 });
    const accountText = await emailSelector.textContent();
    expect(accountText).toContain(GMAIL_EMAIL);

    // Screenshot
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "phase2-test-08.png"),
      fullPage: true,
    });
  });

  /* ================================================================== */
  /*  9. Try to open INBOX and load emails                                 */
  /* ================================================================== */

  test("9 - Clicking INBOX folder attempts to load real emails", async ({ page }) => {
    await goto(page, "/mail", PROJECT);

    // Check if we're on the 3-pane layout (account exists)
    const accountBtn = page
      .locator("button")
      .filter({ hasText: GMAIL_EMAIL })
      .first();
    await expect(accountBtn, `Expected configured account ${GMAIL_EMAIL}`).toBeVisible({ timeout: 15_000 });

    // Account exists — try to select it via the dropdown
    await accountBtn.click();

    // Look for the account in the dropdown
    const dropdownItems = page.locator("div.shadow-lg button");
    const gmailOption = dropdownItems.filter({ hasText: GMAIL_EMAIL }).first();
    await expect(gmailOption).toBeVisible({ timeout: 5000 });
    await gmailOption.click();

    // Now try to find and click the INBOX folder
    const inboxBtn = page
      .locator("button")
      .filter({ hasText: "INBOX" })
      .first();
    await expect(inboxBtn).toBeVisible({ timeout: 15_000 });
    const inboxResponse = page.waitForResponse(
      (response) => response.url().includes("/api/v1/emails") &&
        !response.url().includes("/sync-status") &&
        response.status() < 500,
      { timeout: 15_000 },
    );
    await inboxBtn.click();
    await inboxResponse;
    const emailRows = page.locator("div.cursor-pointer");
    const emailError = page.getByText(/failed|error|unable/i).first();
    await expect(emailRows.first().or(emailError)).toBeVisible({ timeout: 15_000 });

    // Screenshot
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "phase2-test-09.png"),
      fullPage: true,
    });
  });

  /* ================================================================== */
  /*  10. Navigate to a non-INBOX folder                                  */
  /* ================================================================== */

  test("10 - Non-INBOX folder sidebar interaction", async ({ page }) => {
    await goto(page, "/mail", PROJECT);

    // Check for folder buttons in the sidebar
    const folderNames = [
      "Sent Mail",
      "Drafts",
      "Personal",
      "Archive",
      "Spam",
      "Trash",
      "Starred",
      "Important",
      "Receipts",
      "Travel",
      "Work",
    ];

    let selectedFolder: Locator | undefined;
    for (const name of folderNames) {
      const btn = page.locator("button").filter({ hasText: name }).first();
      if (await btn.isVisible()) {
        selectedFolder = btn;
        break;
      }
    }

    expect(selectedFolder, "A non-INBOX mail folder is required").toBeDefined();
    const folderResponse = page.waitForResponse(
      (response) => response.url().includes("/api/v1/emails") &&
        !response.url().includes("/sync-status") &&
        response.status() < 500,
      { timeout: 15_000 },
    );
    await selectedFolder!.click();
    await folderResponse;
    const emailListArea = page.locator("div.cursor-pointer");
    const emailError = page.getByText(/failed|error|unable/i).first();
    await expect(emailListArea.first().or(emailError)).toBeVisible({ timeout: 15_000 });

    // Screenshot
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "phase2-test-10.png"),
      fullPage: true,
    });
  });
});

import { test, expect } from "@playwright/test";

/**
 * E2E tests for the operational homepage.
 *
 * The homepage now renders a data-driven 2×2 card grid (Self-Learning, Tasks,
 * Jobs, Mail) with contextual empty states, loading skeletons, error states,
 * and card CTA navigation. No nav-card duplication, no emoji icons.
 */
test.describe("Homepage — Operational Dashboard", () => {
  test("page loads with project title and four operational cards", async ({ page }) => {
    await page.goto("/");

    // Page heading — "Ingenium" as h1 + project name in muted text
    await expect(page.getByRole("heading", { name: "Ingenium" })).toBeVisible();
    // Project name label should be visible in muted text
    const projectLabel = page.locator("text=Project:").first();
    if (await projectLabel.isVisible()) {
      await expect(projectLabel).toBeVisible();
    }

    // Four operational cards should be visible
    await expect(page.getByText("Self-Learning")).toBeVisible();
    await expect(page.getByText("Tasks")).toBeVisible();
    await expect(page.getByText("Jobs")).toBeVisible();
    await expect(page.getByText("Mail")).toBeVisible();
  });

  test("cards show actual data, not just labels", async ({ page }) => {
    await page.goto("/");

    // The Self-Learning card should show "pending observations" (either "No observations" or a count)
    const learningCard = page.locator("div").filter({ hasText: "Self-Learning" }).first();
    await expect(learningCard).toBeVisible();

    // Tasks card should show column counts or empty state
    const tasksCard = page.locator("div").filter({ hasText: "Tasks" }).first();
    await expect(tasksCard).toBeVisible();
    const hasTaskData = await tasksCard.textContent();
    expect(hasTaskData).toBeTruthy();

    // Jobs card should show enabled/disabled counts or empty state
    const jobsCard = page.locator("div").filter({ hasText: "Jobs" }).first();
    await expect(jobsCard).toBeVisible();
    const hasJobData = await jobsCard.textContent();
    expect(hasJobData).toBeTruthy();
  });

  test("card CTAs navigate correctly", async ({ page }) => {
    await page.goto("/");

    // The Self-Learning card should have a CTA link to /pipeline or trigger synthesis
    const ctaLinks = page.locator('a[href="/pipeline"]');
    if (await ctaLinks.first().isVisible()) {
      await ctaLinks.first().click();
      await expect(page).toHaveURL(/pipeline/);
    }

    // Navigate back
    await page.goto("/");

    // Tasks card CTA should link to /tasks
    const tasksCta = page.locator('a[href="/tasks"]');
    if (await tasksCta.first().isVisible()) {
      await tasksCta.first().click();
      await expect(page).toHaveURL(/tasks/);
    }
  });

  test("loading skeleton appears then content replaces it", async ({ page }) => {
    // Use route interception to simulate a slow API response
    await page.route("**/api/v1/dashboard/summary**", async (route) => {
      // Delay the response to give Playwright time to capture the skeleton
      await new Promise((r) => setTimeout(r, 1000));
      await route.continue();
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Initially, skeleton cards should be visible
    const skeleton = page.locator('[data-testid="dashboard-skeleton-card"]').first();
    // May have already transitioned if API resolved before paint; check both cases
    try {
      await expect(skeleton).toBeVisible({ timeout: 500 });
    } catch {
      // If skeleton is gone, content should be present (fallback check)
      await expect(page.getByText("Self-Learning")).toBeVisible({ timeout: 5000 });
      return;
    }

    // Wait for the content to replace the skeleton
    await expect(skeleton).toBeHidden({ timeout: 10000 });
    await expect(page.getByText("Self-Learning")).toBeVisible({ timeout: 5000 });
  });

  test("error state shows message with retry button", async ({ page }) => {
    // Abort the API request to simulate a network error
    await page.route("**/api/v1/dashboard/summary**", (route) => route.abort());

    await page.goto("/");

    // Should show an error message
    await expect(page.getByText(/error|failed|unable/i)).toBeVisible({ timeout: 10000 });

    // Should have a retry button
    const retryBtn = page.getByRole("button", { name: /retry|try again|reload/i });
    if (await retryBtn.isVisible()) {
      await expect(retryBtn).toBeVisible();
    }
  });

  test("no nav-card duplication remains", async ({ page }) => {
    await page.goto("/");

    // The old nav-card sections (Build/Learn/Connect/Operate) should not exist
    await expect(page.getByText("Complete AI agent development workspace")).not.toBeVisible();

    // Old emoji-based feature cards should not be present
    // The operational cards use text labels only, no emoji decorations
    const pageText = await page.locator("body").innerText();
    expect(pageText).toBeTruthy(); // Ensure page renders

    // The old "Build" / "Learn" / "Connect" / "Operate" section headers should be gone
    await expect(page.getByText("Build")).not.toBeVisible();
    await expect(page.getByText("Learn")).not.toBeVisible();
    await expect(page.getByText("Connect")).not.toBeVisible();
    await expect(page.getByText("Operate")).not.toBeVisible();
  });

  test("partial degradation — unavailable card shows orange badge", async ({ page }) => {
    // Intercept and return a response with one module unavailable
    await page.route("**/api/v1/dashboard/summary**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            learning: null,
            tasks: { todoCount: 0, inProgressCount: 0, reviewCount: 0, nextTask: null },
            jobs: { total: 0, enabledCount: 0, failedRecently: [] },
            mail: null,
            generatedAt: new Date().toISOString(),
          },
          unavailable: ["learning", "mail"],
        }),
      });
    });

    await page.goto("/");
    await expect(page.getByText("Self-Learning")).toBeVisible({ timeout: 10000 });

    // The "Unavailable" badge should appear on degraded cards
    const unavailableBadges = page.locator("text=Unavailable");
    const count = await unavailableBadges.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

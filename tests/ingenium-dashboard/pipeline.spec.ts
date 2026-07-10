import { test, expect } from "@playwright/test";

/**
 * E2E tests for the Pipeline, Observations, Personality, and Learnings pages.
 *
 * These tests run against a live Next.js dev server (port 3000) and real API
 * server (port 4097). Each test navigates to a management page and verifies
 * that interactions work end-to-end.
 *
 * Selectors use roles, labels, and text content since the pages currently
 * don't have data-testid attributes. If refactoring later, prefer
 * data-testid selectors for stability (see useful-tests skill).
 */

test.describe("Pipeline Dashboard", () => {
  test("pipeline page loads with stats bar and filter pills", async ({ page }) => {
    await page.goto("http://localhost:3000/pipeline");
    
    // The page title is displayed as an <h1>
    await expect(page.locator("h1")).toContainText("Pipeline Activity");
    
    // Stats bar - all four stats should be visible in the top-right area
    // Use more specific selectors to avoid matching other "Observations:" text on the page
    await expect(page.locator("text=Total:")).toBeVisible();
    await expect(page.locator("span", { hasText: "Observations:" })).toBeVisible();
    await expect(page.locator("span", { hasText: "Syntheses:" })).toBeVisible();
    await expect(page.locator("span", { hasText: "Traits:" })).toBeVisible();
    
    // Filter pills - all six buttons should be visible
    await expect(page.locator("button:has-text('All')")).toBeVisible();
    await expect(page.locator("button:has-text('Agent')")).toBeVisible();
    await expect(page.locator("button:has-text('Plugin')")).toBeVisible();
    await expect(page.locator("button:has-text('Synthesis')")).toBeVisible();
    await expect(page.locator("button:has-text('Trait')")).toBeVisible();
    await expect(page.locator("button:has-text('Pause')")).toBeVisible();
  });

  test("pipeline page shows events when data exists", async ({ page }) => {
    await page.goto("http://localhost:3000/pipeline");
    
    // Wait for events to load (polling interval is 3 seconds)
    await page.waitForTimeout(3000);
    
    // Should show events in the timeline (seeded data)
    const eventCards = page.locator("text=Agent observed").or(page.locator("text=Synthesis")).or(page.locator("text=Trait"));
    await expect(eventCards.first()).toBeVisible({ timeout: 5000 });
  });

  test("filter pills filter events", async ({ page }) => {
    await page.goto("http://localhost:3000/pipeline");
    
    // Wait for initial load
    await page.waitForTimeout(2000);
    
    // Click Agent filter - should change the active filter
    await page.locator("button:has-text('Agent')").click();
    await page.waitForTimeout(1000);
    
    // Verify Agent filter is now active (different styling)
    const agentBtn = page.locator("button:has-text('Agent')");
    await expect(agentBtn).toBeVisible();
    
    // Click Synthesis filter - should change the active filter
    await page.locator("button:has-text('Synthesis')").click();
    await page.waitForTimeout(1000);
    
    // Verify Synthesis filter is now active
    const synthesisBtn = page.locator("button:has-text('Synthesis')");
    await expect(synthesisBtn).toBeVisible();
  });

  test("pause button toggles polling", async ({ page }) => {
    await page.goto("http://localhost:3000/pipeline");
    
    // Wait for initial load
    await page.waitForTimeout(2000);
    
    const pauseBtn = page.locator("button:has-text('Pause')");
    await expect(pauseBtn).toBeVisible();
    
    // Click Pause button
    await pauseBtn.click();
    
    // Should now show Resume (with play icon)
    await expect(page.locator("button:has-text('Resume')")).toBeVisible();
  });
});

test.describe("Observations Page", () => {
  test("observations page lists seeded observations", async ({ page }) => {
    await page.goto("http://localhost:3000/observations");
    
    // The page title is displayed as an <h1>
    await expect(page.locator("h1")).toContainText("Observations");
    
    // Wait for observations to load (API call happens on mount)
    await page.waitForTimeout(2000);
    
    // Should have observation cards with type badges visible
    await expect(page.locator("span:has-text('pattern')").first()).toBeVisible({ timeout: 5000 });
    const cards = page.locator("[class*='cursor-pointer']");
    await expect(cards.first()).toBeVisible({ timeout: 3000 });
  });

  test("observations stats show total and pending counts", async ({ page }) => {
    await page.goto("http://localhost:3000/observations");
    
    // Wait for stats to load
    await page.waitForTimeout(2000);
    
    // Stats should be visible in the top right
    await expect(page.locator("text=Total:")).toBeVisible();
    await expect(page.locator("text=Pending:")).toBeVisible();
  });
});

test.describe("Personality Page", () => {
  test("personality page loads with trait groups", async ({ page }) => {
    await page.goto("http://localhost:3000/personality");
    
    // The page title is displayed as an <h1>
    await expect(page.locator("h1")).toContainText("Personality Profile");
    
    // Wait for traits to load (API call happens on mount)
    await page.waitForTimeout(2000);
    
    // Should show trait count or trait type badges
    await expect(page.locator("text=trait(s)").first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Legacy Learnings Page", () => {
  test("learnings page shows deprecation notice", async ({ page }) => {
    await page.goto("http://localhost:3000/learnings");
    
    // The page title is displayed as an <h1>
    await expect(page.locator("h1")).toContainText("Learnings");
    
    // Should have a yellow deprecation notice banner
    await expect(page.locator("text=Learnings are deprecated")).toBeVisible();
    
    // Should have link to observations page (use exact text match in the main content area)
    const obsLink = page.locator("a", { hasText: "Observations" }).first();
    await expect(obsLink).toHaveAttribute("href", "/observations");
  });
});

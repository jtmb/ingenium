import { expect, test, type Page } from "./fixture";

const emptySummary = {
  learning: null,
  tasks: null,
  jobs: null,
  mail: null,
  attention: { items: [], count: 0 },
  resume: null,
  activity: [],
  health: {
    api: { status: "ok", uptime: 1 },
    dashboard: { status: "ok" },
    opencode: { status: "ok" },
    docker: { status: "unknown" },
    services: [],
  },
  generatedAt: "2026-07-28T00:00:00.000Z",
};

async function mockSummary(page: Page): Promise<void> {
  await page.route("**/api/v1/dashboard/summary**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: emptySummary, unavailable: [] }),
  }));
}

/** E2E contracts for the current operational cockpit homepage. */
test.describe("Homepage — Operational Cockpit", () => {
  test.beforeEach(async ({ page }) => {
    await mockSummary(page);
  });

  test("renders the current cockpit sections and quick actions", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Ingenium", exact: true })).toBeVisible();
    await expect(page.getByText(/Project:/)).toBeVisible();

    for (const heading of ["Attention Queue", "Resume Work", "Activity Timeline"]) {
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }
    await expect(page.getByText("All systems operational")).toBeVisible();

    for (const label of ["New Doc", "Open CLI", "New Task", "Compose Mail", "Run Synthesis"]) {
      await expect(page.getByRole(label === "Run Synthesis" ? "button" : "link", { name: label, exact: true })).toBeVisible();
    }
  });

  test("loading skeleton is replaced by current cockpit content", async ({ page }) => {
    await page.route("**/api/v1/dashboard/summary**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: emptySummary, unavailable: [] }),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="dashboard-skeleton-card"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-skeleton-card"]').first()).toBeHidden({ timeout: 5000 });
    await expect(page.getByRole("heading", { name: "Attention Queue", exact: true })).toBeVisible();
  });

  test("error state exposes a retry action without legacy card expectations", async ({ page }) => {
    await page.unroute("**/api/v1/dashboard/summary**");
    await page.route("**/api/v1/dashboard/summary**", (route) => route.abort());

    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Unable to load dashboard" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Attention Queue", exact: true })).toHaveCount(0);
  });

  test("partial degradation uses the current unavailable-sections contract", async ({ page }) => {
    await page.unroute("**/api/v1/dashboard/summary**");
    await page.route("**/api/v1/dashboard/summary**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          ...emptySummary,
          attention: null,
          resume: null,
          activity: null,
          health: null,
        },
        unavailable: ["attention.tasks", "attention.jobs", "resume", "activity"],
      }),
    }));

    await page.goto("/");

    await expect(page.getByText("Some sections are unavailable:")).toBeVisible();
    await expect(page.getByText(/Attention — Tasks/)).toBeVisible();
    await expect(page.getByText("Attention Queue", { exact: true })).toBeVisible();
    await expect(page.getByText("Health data unavailable", { exact: true })).toBeVisible();
  });

});

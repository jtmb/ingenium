import { expect, test, type Page } from "./fixture";
import { getDefaultSuiteRuntime } from "./default-suite-runtime";

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

test("bootstraps a clean QA Vision browser into the isolated fixture session", async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error("Fixture dashboard URL is unavailable");
  const context = await browser.newContext();
  const page = await context.newPage();
  const browserServerOnlyHeaders: Array<Record<string, string>> = [];
  page.on("request", (request) => {
    const headers = request.headers();
    const serverOnly = Object.fromEntries(Object.entries(headers).filter(([name]) =>
      name === "authorization" || name.startsWith("x-ingenium-fixture-") || name === "x-ingenium-internal-service"));
    if (Object.keys(serverOnly).length > 0) browserServerOnlyHeaders.push(serverOnly);
  });
  try {
    const fixtureUrl = new URL("/test-fixture/session", baseURL);
    fixtureUrl.hostname = "localhost";
    await page.goto(fixtureUrl.toString());
    expect(new URL(page.url()).searchParams.has("project")).toBe(false);
    const project = getDefaultSuiteRuntime().project;
    expect((await context.cookies()).some((cookie) => cookie.name === "__Host-ingenium_session")).toBe(true);
    expect(browserServerOnlyHeaders).toEqual([]);

    const fixtureState = await page.evaluate(async () => {
      const [projectsResponse, organizationsResponse] = await Promise.all([
        fetch("/api/v1/projects"),
        fetch("/api/v1/organizations"),
      ]);
      const projectsBody = await projectsResponse.text();
      const organizationsBody = await organizationsResponse.text();
      const projects = projectsResponse.ok ? JSON.parse(projectsBody) : { data: [] };
      const organizations = organizationsResponse.ok ? JSON.parse(organizationsBody) : { data: [] };
      const csrfResponse = await fetch("/api/v1/auth/session/csrf", {
        method: "POST",
        headers: { "x-ingenium-ui": "dashboard" },
      });
      const csrfBody = await csrfResponse.text();
      const csrfToken = csrfResponse.ok
        ? (JSON.parse(csrfBody) as { data: { csrfToken: string } }).data.csrfToken
        : "";
      const mutation = csrfToken
        ? await fetch("/api/v1/opencode/sessions?directory=%2Fworkspace", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ingenium-ui": "dashboard",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify({ title: "Visual fixture CSRF smoke" }),
        })
        : undefined;
      return {
        projects: projects.data,
        organizations: organizations.data,
        projectsStatus: projectsResponse.status,
        projectsBody,
        organizationsStatus: organizationsResponse.status,
        organizationsBody,
        csrfStatus: csrfResponse.status,
        csrfBody,
        mutationStatus: mutation?.status,
        mutationBody: mutation ? await mutation.text() : "CSRF bootstrap failed",
      };
    });
    expect(fixtureState.projectsStatus, fixtureState.projectsBody).toBe(200);
    expect(fixtureState.organizationsStatus, fixtureState.organizationsBody).toBe(200);
    expect(fixtureState.projects).toEqual([
      expect.objectContaining({ name: project, is_global: 1 }),
    ]);
    expect(fixtureState.organizations.map((entry: { slug: string }) => entry.slug)).toEqual([project]);
    expect(fixtureState.csrfStatus, fixtureState.csrfBody).toBe(200);
    expect(fixtureState.mutationStatus, fixtureState.mutationBody).toBe(201);
    expect(browserServerOnlyHeaders).toEqual([]);
  } finally {
    await context.close();
  }
});

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

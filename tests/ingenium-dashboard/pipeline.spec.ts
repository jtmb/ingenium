import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { getDefaultSuiteRuntime } from "./default-suite-runtime";

const runtime = getDefaultSuiteRuntime();
const projectQuery = encodeURIComponent(runtime.project);
const dashboardRoute = runtime.dashboardRoute;

async function createPipelineEvent(request: APIRequestContext, title: string, source = "agent"): Promise<void> {
  const response = await request.post(
    `${runtime.apiBase}/pipeline/events?project=${projectQuery}`,
    {
      headers: runtime.apiHeaders,
      data: {
        event_type: "observation_created",
        event_source: source,
        title,
        description: "Created by the isolated Playwright fixture run",
      },
    },
  );
  expect(response.status()).toBe(201);
}

async function expectPipelineEventInRunProject(request: APIRequestContext, title: string): Promise<void> {
  const response = await request.get(
    `${runtime.apiBase}/pipeline/events?project=${projectQuery}`,
    { headers: runtime.apiHeaders },
  );
  expect(response.status()).toBe(200);
  const body = await response.json() as { data?: Array<{ title?: string }> };
  expect(body.data?.some((event) => event.title === title)).toBe(true);
}

async function openPipeline(page: Page): Promise<void> {
  const eventsResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/v1/pipeline/events"
      && url.searchParams.get("project") === runtime.project
      && response.request().method() === "GET"
      && response.status() === 200;
  });
  await page.goto(dashboardRoute("/pipeline"), { waitUntil: "domcontentloaded" });
  await eventsResponse;
}

async function createObservation(request: APIRequestContext, content: string): Promise<void> {
  const response = await request.post(
    `${runtime.apiBase}/observations?project=${projectQuery}`,
    {
      headers: runtime.apiHeaders,
      // Keep the fixture within the observations table's SQL source constraint.
      data: { observation_type: "pattern", content, importance: 5, source: "agent" },
    },
  );
  expect(response.status()).toBe(201);
}

async function expectObservationInRunProject(request: APIRequestContext, content: string): Promise<void> {
  const response = await request.get(
    `${runtime.apiBase}/observations?project=${projectQuery}`,
    { headers: runtime.apiHeaders },
  );
  expect(response.status()).toBe(200);
  const body = await response.json() as { data?: Array<{ content?: string; observation_type?: string }> };
  expect(body.data?.some((observation) =>
    observation.content === content && observation.observation_type === "pattern",
  )).toBe(true);
}

async function openObservations(page: Page): Promise<void> {
  const listResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/v1/observations"
      && url.searchParams.get("project") === runtime.project
      && response.request().method() === "GET"
      && response.status() === 200;
  });
  await page.goto(dashboardRoute("/observations"), { waitUntil: "domcontentloaded" });
  await listResponse;
}

async function openPersonality(page: Page): Promise<void> {
  const listResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/v1/personality"
      && url.searchParams.get("project") === runtime.project
      && response.request().method() === "GET"
      && response.status() === 200;
  });
  await page.goto(dashboardRoute("/personality"), { waitUntil: "domcontentloaded" });
  await listResponse;
}

async function createEmergingTrait(request: APIRequestContext, value: string): Promise<number> {
  const response = await request.post(
    `${runtime.apiBase}/personality?project=${projectQuery}`,
    {
      headers: runtime.apiHeaders,
      data: {
        trait_type: "code_preference",
        trait_value: value,
        display_label: `Emerging E2E trait ${value}`,
        confidence: 0.15,
        source: "manual",
      },
    },
  );
  expect(response.status()).toBe(201);
  const body = await response.json() as { data?: { id?: number } };
  expect(body.data?.id).toBeDefined();
  return body.data!.id!;
}

/**
 * E2E coverage for the Pipeline, Observations, and Personality pages. Fixture
 * writes are asserted against the run-owned project through the API so page
 * rendering remains independent of the dashboard's global-project default.
 */
test.describe("Pipeline Dashboard", () => {
  test("pipeline page loads with stats bar and filter pills", async ({ page }) => {
    await openPipeline(page);

    await expect(page.locator("h1")).toContainText("Pipeline Activity");
    await expect(page.locator("text=Total:")).toBeVisible();
    await expect(page.locator("span", { hasText: "Observations:" })).toBeVisible();
    await expect(page.locator("span", { hasText: "Syntheses:" })).toBeVisible();
    await expect(page.locator("span", { hasText: "Traits:" })).toBeVisible();

    for (const label of ["All", "Agent", "Plugin", "Synthesis", "Trait", "Pause"]) {
      await expect(page.getByRole("button", { name: label, exact: label !== "Pause" })).toBeVisible();
    }
  });

  test("pipeline event is persisted in the isolated project", async ({ page, request }) => {
    const title = `E2E pipeline event ${Date.now()}`;
    await createPipelineEvent(request, title);
    await expectPipelineEventInRunProject(request, title);
    await openPipeline(page);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });

  test("filter pills filter events without arbitrary delays", async ({ page, request }) => {
    await createPipelineEvent(request, `E2E filter event ${Date.now()}`);
    await openPipeline(page);

    const agentResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/pipeline/events"
        && url.searchParams.get("project") === runtime.project
        && url.searchParams.get("source") === "agent"
        && response.request().method() === "GET"
        && response.status() === 200;
    });
    const agentButton = page.getByRole("button", { name: "Agent", exact: true });
    await agentButton.click();
    await agentResponse;
    await expect(agentButton).toHaveClass(/bg-gray-800/);

    const synthesisResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/pipeline/events"
        && url.searchParams.get("project") === runtime.project
        && url.searchParams.get("source") === "synthesis"
        && response.request().method() === "GET"
        && response.status() === 200;
    });
    const synthesisButton = page.getByRole("button", { name: "Synthesis", exact: true });
    await synthesisButton.click();
    await synthesisResponse;
    await expect(synthesisButton).toHaveClass(/bg-gray-800/);
  });

  test("pause button toggles polling", async ({ page }) => {
    await openPipeline(page);

    const pauseButton = page.getByRole("button", { name: /Pause/ });
    await expect(pauseButton).toBeVisible();
    await pauseButton.click();
    await expect(page.getByRole("button", { name: /Resume/ })).toBeVisible();
  });
});

test.describe("Observations Page", () => {
  test("observation is persisted in the isolated project", async ({ page, request }) => {
    const content = `E2E observation ${Date.now()}`;
    await createObservation(request, content);
    await expectObservationInRunProject(request, content);
    await openObservations(page);

    await expect(page.locator("h1")).toContainText("Observations");
    await expect(page.getByText(content, { exact: true })).toBeVisible();
  });

  test("observations stats show total and pending counts", async ({ page, request }) => {
    await createObservation(request, `E2E stats observation ${Date.now()}`);
    await openObservations(page);

    await expect(page.locator("text=Total:")).toBeVisible();
    await expect(page.locator("text=Pending:")).toBeVisible();
  });
});

test.describe("Personality Page", () => {
  test("personality page loads with trait groups", async ({ page }) => {
    await openPersonality(page);
    await expect(page.locator("h1")).toContainText("Personality Profile");
    await expect(page.getByRole("status", { name: "Personality trait counts" })).toContainText("Established:");
    await expect(page.getByRole("status", { name: "Personality trait counts" })).toContainText("Emerging:");
  });

  test("shows and dismisses an active emerging trait in both sort modes", async ({ page, request }) => {
    const value = `emerging-${Date.now()}`;
    const traitId = await createEmergingTrait(request, value);
    await openPersonality(page);

    const emergingSection = page.getByTestId("emerging-traits-section");
    const emergingCard = page.getByTestId(`emerging-trait-${traitId}`);
    await expect(emergingSection).toBeVisible();
    await expect(emergingCard).toContainText("Emerging · 15% confidence");

    await page.getByLabel("Sort personality traits").selectOption("newest");
    await expect(page.getByTestId(`emerging-trait-${traitId}`)).toBeVisible();

    await emergingCard.getByRole("button", { name: "Dismiss trait" }).click();
    await expect(page.getByTestId(`emerging-trait-${traitId}`)).toHaveCount(0);
  });
});

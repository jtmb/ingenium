import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { getDefaultSuiteRuntime } from "./default-suite-runtime";

const runtime = getDefaultSuiteRuntime();
const projectQuery = encodeURIComponent(runtime.project);

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

async function openPipeline(page: Page): Promise<void> {
  const eventsResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/v1/pipeline/events"
      && response.request().method() === "GET"
      && response.status() === 200;
  });
  await page.goto("/pipeline", { waitUntil: "domcontentloaded" });
  await eventsResponse;
}

async function createObservation(request: APIRequestContext, content: string): Promise<void> {
  const response = await request.post(
    `${runtime.apiBase}/observations?project=${projectQuery}`,
    {
      headers: runtime.apiHeaders,
      data: { observation_type: "pattern", content, importance: 5, source: "playwright" },
    },
  );
  expect(response.status()).toBe(201);
}

async function openObservations(page: Page): Promise<void> {
  const listResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/v1/observations"
      && response.request().method() === "GET"
      && response.status() === 200;
  });
  await page.goto("/observations", { waitUntil: "domcontentloaded" });
  await listResponse;
}

async function openPersonality(page: Page): Promise<void> {
  const listResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/v1/personality"
      && response.request().method() === "GET"
      && response.status() === 200;
  });
  await page.goto("/personality", { waitUntil: "domcontentloaded" });
  await listResponse;
}

/** E2E coverage for the isolated Pipeline, Observations, Personality, and Learnings pages. */
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

  test("pipeline page shows an event created in the isolated project", async ({ page, request }) => {
    const title = `E2E pipeline event ${Date.now()}`;
    await createPipelineEvent(request, title);
    await openPipeline(page);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });

  test("filter pills filter events without arbitrary delays", async ({ page, request }) => {
    await createPipelineEvent(request, `E2E filter event ${Date.now()}`);
    await openPipeline(page);

    const agentResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/pipeline/events"
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
  test("observations page lists an observation from the isolated project", async ({ page, request }) => {
    await createObservation(request, `E2E observation ${Date.now()}`);
    await openObservations(page);

    await expect(page.locator("h1")).toContainText("Observations");
    await expect(page.locator("span", { hasText: "pattern" }).first()).toBeVisible();
    await expect(page.locator("[class*='cursor-pointer']").first()).toBeVisible();
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
    await expect(page.locator("text=trait(s)").first()).toBeVisible();
  });
});

test.describe("Legacy Learnings Page", () => {
  test("learnings page shows deprecation notice", async ({ page }) => {
    await page.goto("/learnings", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toContainText("Learnings");
    await expect(page.locator("text=Learnings are deprecated")).toBeVisible();
    await expect(page.locator("a", { hasText: "Observations" }).first()).toHaveAttribute("href", "/observations");
  });
});

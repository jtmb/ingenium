import { expect, test } from "./external-suite-navigation-governor";
import type { Page, Response } from "@playwright/test";
import path from "path";
import { getDockerActiveProject } from "./docker-active-project";
import { visualQaArtifactDirectory } from "./visual-qa-artifacts";

/**
 * Integration checks use configured dashboard and API endpoints without
 * browser route mocks. The assertions tolerate the documented empty states.
 */

const BASE = process.env.INGENIUM_E2E_DASHBOARD_URL ?? "http://localhost:3000";
const SCREENSHOTS_DIR = visualQaArtifactDirectory("integration");

interface ObservationRead {
  total: number;
  pending: number;
  observations: Array<{ id: number; content: string; status: string }>;
}

function isObservationRead(response: Response, project: string, status: string, type: string): boolean {
  const url = new URL(response.url());
  if (url.pathname !== "/api/v1/observations" || response.request().method() !== "GET") return false;
  return url.searchParams.get("project") === project
    && (url.searchParams.get("status") ?? "") === status
    && (url.searchParams.get("type") ?? "") === type;
}

function isObservationStatsRead(response: Response, project: string): boolean {
  const url = new URL(response.url());
  return url.pathname === "/api/v1/observations/stats"
    && response.request().method() === "GET"
    && url.searchParams.get("project") === project;
}

async function readObservationResponses(
  page: Page,
  project: string,
  status: string,
  type: string,
): Promise<ObservationRead> {
  const [listResponse, statsResponse] = await Promise.all([
    page.waitForResponse((response) => isObservationRead(response, project, status, type), { timeout: 15_000 }),
    page.waitForResponse((response) => isObservationStatsRead(response, project), { timeout: 15_000 }),
  ]);
  expect(listResponse.status(), "observations list request failed").toBe(200);
  expect(statsResponse.status(), "observations stats request failed").toBe(200);

  const [listBody, statsBody] = await Promise.all([
    listResponse.json() as Promise<{ data?: unknown }>,
    statsResponse.json() as Promise<{ data?: unknown }>,
  ]);
  if (!Array.isArray(listBody.data)) throw new Error("Observations list did not return data[]");
  if (!statsBody.data || typeof statsBody.data !== "object") throw new Error("Observations stats did not return data");
  const stats = statsBody.data as { total?: unknown; pending?: unknown };
  if (!Number.isSafeInteger(stats.total) || (stats.total as number) < 0) {
    throw new Error("Observations stats total did not contain a non-negative integer");
  }
  if (!Number.isSafeInteger(stats.pending) || (stats.pending as number) < 0) {
    throw new Error("Observations stats pending did not contain a non-negative integer");
  }

  return {
    total: stats.total as number,
    pending: stats.pending as number,
    observations: listBody.data.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const observation = value as { id?: unknown; content?: unknown; status?: unknown };
      const id = observation.id;
      return typeof id === "number"
        && Number.isSafeInteger(id)
        && typeof observation.content === "string"
        && typeof observation.status === "string"
        ? [{ id, content: observation.content, status: observation.status }]
        : [];
    }),
  };
}

/** Navigate to a dashboard page and wait for client JS to render dynamic content. */
async function goto(page: Page, urlPath: string): Promise<string> {
  const url = new URL(urlPath, BASE);
  const project = await getDockerActiveProject(page.request);
  url.searchParams.set("project", project);
  const res = await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  expect(res?.ok()).toBeTruthy();
  await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
  return project;
}

test.describe("Dashboard Integration (real API, no mocks)", () => {
  test("1 - Home page loads with live stats from API", async ({ page }) => {
    const project = await goto(page, "/");
    const dashboard = page.locator("main");

    await expect(dashboard.getByRole("heading", { name: "Ingenium" })).toBeVisible();
    await expect(dashboard.getByText(`Project: ${project}`)).toBeVisible();
    await expect(dashboard.getByRole("link", { name: "New Doc" })).toBeVisible();
    await expect(dashboard.getByRole("button", { name: "Run Synthesis" })).toBeVisible();
    await expect(dashboard.getByRole("heading", { name: /^Attention Queue/ })).toBeVisible();
    await expect(dashboard.getByRole("heading", { name: "Resume Work" })).toBeVisible();
    await expect(dashboard.getByRole("heading", { name: "Activity Timeline" })).toBeVisible();

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "phase2-test-01.png"),
      fullPage: true,
    });
  });

  test("2 - Observations page shows observations from API", async ({ page }) => {
    await goto(page, "/observations");

    await expect(page.locator("h1")).toContainText("Observations");

    await expect(page.getByText("Total:").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Pending:").first()).toBeVisible({
      timeout: 5000,
    });

    await expect(page.getByText("Failed to load observations — API may be unreachable")).toHaveCount(0);

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "phase2-test-02.png"),
      fullPage: true,
    });
  });

  test("3 - Personality page shows traits from API", async ({ page }) => {
    await goto(page, "/personality");

    await expect(page.locator("h1")).toContainText("Personality Profile");

    const traitCounts = page.getByRole("status", { name: "Personality trait counts" });
    await expect(traitCounts).toContainText("Established:", { timeout: 10000 });
    await expect(traitCounts).toContainText("Emerging:");

    const emptyState = page.getByText("No personality traits learned yet");
    const emergingSection = page.getByTestId("emerging-traits-section");
    const groupSections = page.locator(
      "div.border.rounded.overflow-hidden",
    );

    const isLoaded =
      (await groupSections.count()) > 0 ||
      (await emergingSection.isVisible()) ||
      (await emptyState.isVisible());

    expect(isLoaded).toBeTruthy();

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "phase2-test-03.png"),
      fullPage: true,
    });
  });

  test("4 - Logs page shows entries from the running API", async ({ page }) => {
    await goto(page, "/logs");

    await expect(page.locator("h1")).toContainText("System Logs");

    await expect(page.getByText("Total:").first()).toBeVisible({
      timeout: 15000,
    });

    await expect(
      page.getByText("Loading logs..."),
    ).not.toBeVisible({ timeout: 15000 });

    await expect(page.getByText("Failed to fetch logs")).toHaveCount(0);

    const pauseBtn = page.getByRole("button", {
      name: /Paused|Resume|LIVE|PAUSED/,
    });
    await expect(pauseBtn).toBeVisible({ timeout: 5000 });
  });

  test("5 - Observations data persists across page reload", async ({ page }) => {
    const project = await getDockerActiveProject(page.request);
    const initialRead = readObservationResponses(page, project, "", "");
    const url = new URL("/observations", BASE);
    url.searchParams.set("project", project);
    const initialPage = await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    expect(initialPage?.ok()).toBeTruthy();
    await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });

    const statusFilter = page.getByRole("combobox", { name: "Filter observations by status" });
    const typeFilter = page.getByRole("combobox", { name: "Filter observations by type" });
    const [initial, initialStatus, initialType] = await Promise.all([
      initialRead,
      statusFilter.inputValue(),
      typeFilter.inputValue(),
    ]);

    const reloadedRead = readObservationResponses(page, project, initialStatus, initialType);
    await page.reload({ waitUntil: "domcontentloaded" });
    const reloaded = await reloadedRead;

    await expect(page.getByText("Failed to load observations — API may be unreachable")).toHaveCount(0);
    await expect(statusFilter).toHaveValue(initialStatus);
    await expect(typeFilter).toHaveValue(initialType);
    // Synthesis may move an observation out of a selected status, so filtered
    // results need only stay valid. The canonical unfiltered total must never
    // fall without an explicit deletion.
    if (!initialStatus && !initialType) {
      expect(reloaded.total, "unfiltered canonical observations total decreased without deletion").toBeGreaterThanOrEqual(initial.total);
    }
    const knownObservation = initial.observations[0];
    if (knownObservation && reloaded.observations.some(({ id }) => id === knownObservation.id)) {
      await expect(page.getByText(knownObservation.content, { exact: true })).toBeVisible();
    }
  });

  test("6 - Plugins page shows plugin cards or empty state", async ({ page }) => {
    await goto(page, "/plugins");

    await expect(page.getByRole("heading", { name: "Plugins" })).toBeVisible({
      timeout: 10000,
    });

    await expect(
      page.getByRole("button", { name: /Add Plugin/i }),
    ).toBeVisible();

    const emptyState = page.getByText("No plugins registered");

    if (await emptyState.isVisible()) {
      await expect(emptyState).toBeVisible();
    } else {
      const editBtn = page.getByRole("button", { name: "Edit" }).first();
      await expect(editBtn).toBeVisible({ timeout: 5000 });
      const toggleBtn = page
        .getByRole("button", { name: /Enabled|Disabled/i })
        .first();
      await expect(toggleBtn).toBeVisible();
      const deleteBtn = page.getByRole("button", { name: "Delete" }).first();
      await expect(deleteBtn).toBeVisible();
    }

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "phase2-test-06.png"),
      fullPage: true,
    });
  });

  test("7 - Skills page renders skill cards from API data", async ({ page }) => {
    const project = await goto(page, "/skills");

    await expect(
      page.getByRole("heading", { name: /^Active Skills/ }),
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByPlaceholder("Search skills...")).toBeVisible({
      timeout: 5000,
    });

    await expect(page.locator("select").first()).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Upload Skill" }),
    ).toBeVisible();

    const skillCards = page.locator("[data-testid^='skill-card-']");
    const noSkills = page.getByText(`No active skills in ${project}. Use the project selector above to switch projects.`);
    await expect(skillCards.first().or(noSkills)).toBeVisible({ timeout: 15_000 });

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, "phase2-test-07.png"),
      fullPage: true,
    });
  });
});

test.describe("Mail Integration (real API, no mocks)", () => {
  test("8 - Mail page renders an account-independent state", async ({ page }) => {
    await goto(page, "/mail");

    await expect(page.getByRole("heading", { name: "Mail" }).first()).toBeVisible({ timeout: 15_000 });
    const mailboxState = page.getByText("No email accounts configured")
      .or(page.getByTestId("mail-folder-sidebar"))
      .or(page.getByRole("heading", { name: "Setting up your mailbox" }));
    await expect(mailboxState.first()).toBeVisible({ timeout: 15_000 });
  });
});

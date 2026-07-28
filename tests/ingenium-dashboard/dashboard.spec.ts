import { test, expect } from "@playwright/test";

/**
 * E2E contracts for current dashboard routes that are not covered by a
 * dedicated workflow spec. Retired learning, archive, and server page
 * contracts intentionally do not appear here.
 */
test.describe("Ingenium Dashboard", () => {
  test("home page exposes current navigation links", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Ingenium", exact: true })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    for (const name of [
      "Chat",
      "OpenCode",
      "Mail",
      "Tasks",
      "Docs",
      "Skills",
      "Agents",
      "Observations",
      "Personality",
      "Context",
      "Pipeline",
      "Jobs",
      "Backups",
      "Logs",
      "Usage",
      "Status",
      "Projects",
      "Plugins",
      "MCP Servers",
      "Config",
      "Secrets",
    ]) {
      await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Learnings", exact: true })).toHaveCount(0);
  });

  test("projects page creates a project", async ({ page }) => {
    await page.goto("/projects");

    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "+ New Project", exact: true }).click();
    const projectName = `E2E Project ${Date.now()}`;
    await page.getByPlaceholder("Project name").fill(projectName);
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect(page.getByText(projectName, { exact: true }).first()).toBeVisible();
  });

  test("skills page loads with its current search contract", async ({ page }) => {
    await page.goto("/skills");

    await expect(page.getByRole("heading", { name: /^Skills \(/ })).toBeVisible();
    await expect(page.getByPlaceholder("Search skills...", { exact: true })).toBeVisible();
  });

  test("tasks page creates a task through the current modal", async ({ page }) => {
    await page.goto("/tasks");

    await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
    const taskTitle = `E2E Task ${Date.now()}`;
    await page.getByRole("button", { name: "+ Add Task", exact: true }).click();
    await expect(page.getByRole("heading", { name: "New Task", exact: true })).toBeVisible();
    await page.getByPlaceholder("Task title", { exact: true }).fill(taskTitle);
    await page.getByRole("button", { name: "Create Task", exact: true }).click();
    await expect(page.getByText(taskTitle, { exact: true })).toBeVisible();
  });

  test("plugins page exposes the current management entry point", async ({ page }) => {
    await page.goto("/plugins");

    await expect(page.getByRole("heading", { name: "Plugins", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Add Plugin/i })).toBeVisible();
  });

  test("context page uses the current immutable conversation workspace", async ({ page }) => {
    await page.route("**/api/v1/context/conversations**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { data: [], nextCursor: null } }),
    }));

    await page.goto("/context");

    await expect(page.getByRole("heading", { name: "Context", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Conversation index", exact: true })).toBeVisible();
    await expect(page.getByTestId("context-empty")).toBeVisible();
    await expect(page.getByText(/immutable conversation memory/)).toBeVisible();
  });
});

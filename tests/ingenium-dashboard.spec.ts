import { test, expect } from "@playwright/test";

/**
 * E2E tests for the Ingenium Dashboard.
 *
 * These tests run against a live Next.js dev server (port 3000) and real API
 * server (port 4097). Each test navigates to a management page and verifies
 * that interactions (creating, moving, listing) work end-to-end.
 *
 * Selectors use roles, labels, and text content since the pages currently
 * don't have data-testid attributes. If refactoring later, prefer
 * data-testid selectors for stability (see useful-tests skill).
 */
test.describe("Ingenium Dashboard", () => {
  /* ------------------------------------------------------------------ */
  /*  1. Home page                                                       */
  /* ------------------------------------------------------------------ */

  test("home page loads with title and navigation links", async ({ page }) => {
    await page.goto("/");

    // The page title is displayed as an <h1>
    await expect(
      page.getByRole("heading", { name: "Ingenium Dashboard" }),
    ).toBeVisible();

    // The subtitle should be present
    await expect(
      page.getByText("Manage your AI agent skill system, learnings, tasks, and MCP servers."),
    ).toBeVisible();

    // All six navigation links should be present in the top nav bar
    const nav = page.locator("nav");
    const links = ["Projects", "Skills", "Learnings", "Tasks", "Plugins", "Servers"];
    for (const name of links) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }

    // The home page should also contain six card-style link tiles
    const cardLinks = page.locator("a[href]").filter({ has: page.locator("h2") });
    await expect(cardLinks).toHaveCount(6);
  });

  /* ------------------------------------------------------------------ */
  /*  2. Projects page                                                   */
  /* ------------------------------------------------------------------ */

  test("projects page creates a project", async ({ page }) => {
    await page.goto("/projects");

    // Page heading
    await expect(
      page.getByRole("heading", { name: "Projects" }),
    ).toBeVisible();

    // Create a new project via the inline form
    const projectName = `E2E Project ${Date.now()}`;
    await page.getByPlaceholder("Project name").fill(projectName);
    await page.getByRole("button", { name: "Create" }).click();

    // The newly created project should appear in the list below the form
    await expect(page.getByText(projectName).first()).toBeVisible();
  });

  /* ------------------------------------------------------------------ */
  /*  3. Skills page                                                     */
  /* ------------------------------------------------------------------ */

  test("skills page loads with search", async ({ page }) => {
    await page.goto("/skills");

    // The heading shows "Skills" and a count of loaded skills
    await expect(
      page.getByRole("heading", { name: /^Skills / }),
    ).toBeVisible();

    // The search input should be rendered
    await expect(
      page.getByPlaceholder("Search skills..."),
    ).toBeVisible();
  });

  /* ------------------------------------------------------------------ */
  /*  4. Learnings page                                                  */
  /* ------------------------------------------------------------------ */

  test("learnings page logs an entry", async ({ page }) => {
    await page.goto("/learnings");

    // Page heading
    await expect(
      page.getByRole("heading", { name: "Learnings" }),
    ).toBeVisible();

    // Select a learning type from the dropdown
    await page.locator("select").selectOption("pattern");

    // Fill in the content textarea
    const entryText = `E2E learning entry ${Date.now()}`;
    await page.getByPlaceholder("What did you learn?").fill(entryText);

    // Click the "Log Learning" button
    await page.getByRole("button", { name: "Log Learning" }).click();

    // The new entry should appear in the list
    await expect(page.getByText(entryText)).toBeVisible();

    // The type badge ("pattern") should also be visible for the new entry
    // Use a more specific selector to avoid matching the <option> in the dropdown
    await expect(page.locator("span", { hasText: "pattern" }).first()).toBeVisible();
  });

  /* ------------------------------------------------------------------ */
  /*  5. Tasks page                                                      */
  /* ------------------------------------------------------------------ */

  test("tasks page creates and moves a task", async ({ page }) => {
    await page.goto("/tasks");

    // Page heading
    await expect(
      page.getByRole("heading", { name: "Tasks" }),
    ).toBeVisible();

    // Create a new task (starts in "todo" column)
    const taskTitle = `E2E Task ${Date.now()}`;
    await page.getByPlaceholder("Task title").fill(taskTitle);
    await page.getByRole("button", { name: "Add" }).click();

    // The task should appear on the board after creation
    await expect(page.getByText(taskTitle)).toBeVisible();

    // Click the task to advance it to "in progress"
    // The task element's onClick handler computes the next column via modulo
    // arithmetic: todo → in_progress → review → done
    await page.getByText(taskTitle).click();

    // Wait for the PATCH request that moves the task to complete
    await page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/v1/tasks/") &&
        resp.request().method() === "PATCH" &&
        resp.status() === 200,
    );

    // The task should still be visible after moving to the next column
    await expect(page.getByText(taskTitle)).toBeVisible();
  });

  /* ------------------------------------------------------------------ */
  /*  6. Plugins page                                                    */
  /* ------------------------------------------------------------------ */

  test("plugins page renders", async ({ page }) => {
    await page.goto("/plugins");

    // Page heading
    await expect(
      page.getByRole("heading", { name: "Plugins" }),
    ).toBeVisible();

    // Page heading is already verified above — the page structure loaded correctly
  });

  /* ------------------------------------------------------------------ */
  /*  7. Servers page                                                    */
  /* ------------------------------------------------------------------ */

  test("servers page adds a server", async ({ page }) => {
    await page.goto("/servers");

    // Page heading is "MCP Servers" (not just "Servers")
    await expect(
      page.getByRole("heading", { name: "MCP Servers" }),
    ).toBeVisible();

    // Fill in the server creation form
    const serverName = `E2E Server ${Date.now()}`;
    const serverCommand = "echo test-connection";

    await page.getByPlaceholder("Server name").fill(serverName);
    await page
      .getByPlaceholder("Command (e.g. kaban mcp)")
      .fill(serverCommand);
    await page.getByRole("button", { name: "Add Server" }).click();

    // The server should appear in the list
    await expect(page.getByText(serverName).first()).toBeVisible();
    await expect(page.getByText(serverCommand).first()).toBeVisible();

    // A "Stopped" status badge should be visible for the new server
    await expect(page.getByText("Stopped").first()).toBeVisible();
  });
});

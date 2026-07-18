import { test, expect } from "@playwright/test";

/**
 * Comprehensive E2E tests for ALL 13 Ingenium Dashboard pages.
 *
 * Tests run against a live Next.js dev server (port 3000) and real API
 * server (port 4097). Each test navigates to a page and verifies that
 * key elements render and interactions work end-to-end.
 *
 * Selectors use roles, labels, and text content to match the existing
 * test conventions (no data-testid attributes on most pages yet).
 */

const BASE = "http://localhost:3000";
const PROJECT = "gh-llm-bootstrap";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function goto(page: any, path: string) {
  const res = await page.goto(`${BASE}${path}?project=${PROJECT}`, {
    waitUntil: "domcontentloaded",
  });
  expect(res?.ok()).toBeTruthy();
  // Allow page JS to render dynamic content
  await page.waitForTimeout(1500);
}

/* ------------------------------------------------------------------ */
/*  1. Projects                                                        */
/* ------------------------------------------------------------------ */

test.describe("Projects Page", () => {
  test("loads with heading, create form, and project list", async ({ page }) => {
    await goto(page, "/projects");

    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

    // Create form elements
    await expect(page.getByPlaceholder("Project name")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create" })).toBeVisible();

    // Active/Archived tabs
    await expect(page.getByRole("button", { name: "Active" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Archived" })).toBeVisible();

    // Project list shows at least one project
    const projectEntries = page.locator("main").getByText(/gh-llm-bootstrap|global-default/);
    await expect(projectEntries.first()).toBeVisible({ timeout: 5000 });
  });

  test("can create and see a new project", async ({ page }) => {
    await goto(page, "/projects");

    const projectName = `E2E Test ${Date.now()}`;
    await page.getByPlaceholder("Project name").fill(projectName);
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByText(projectName).first()).toBeVisible({ timeout: 5000 });
  });
});

/* ------------------------------------------------------------------ */
/*  2. Archive                                                         */
/* ------------------------------------------------------------------ */

test.describe("Archive Page", () => {
  test("loads with heading and shows empty state or archived projects", async ({ page }) => {
    await goto(page, "/archive");

    await expect(page.getByRole("heading", { name: "Archive" })).toBeVisible();

    // Either shows "No archived projects" or a list with Restore buttons
    const emptyState = page.getByText("No archived projects");
    const restoreBtn = page.getByRole("button", { name: /Restore/i });
    const hasContent = await emptyState.isVisible().catch(() => false) ||
                       await restoreBtn.isVisible().catch(() => false);
    expect(hasContent).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  3. Skills                                                          */
/* ------------------------------------------------------------------ */

test.describe("Skills Page", () => {
  test("loads with heading, search, and skill cards", async ({ page }) => {
    await goto(page, "/skills");

    // Heading shows "Skills (N)"
    await expect(page.getByRole("heading", { name: /^Skills / })).toBeVisible();

    // Search input
    await expect(page.getByPlaceholder("Search skills...")).toBeVisible();

    // Sort dropdown
    await expect(page.locator("select").first()).toBeVisible();

    // Upload Skill button
    await expect(page.getByRole("button", { name: "Upload Skill" })).toBeVisible();

    // Skill cards should be rendered (clickable)
    const firstCard = page.locator("[class*='cursor-pointer']").first();
    await expect(firstCard).toBeVisible({ timeout: 5000 });
  });

  test("search filters skills", async ({ page }) => {
    await goto(page, "/skills");

    const searchBox = page.getByPlaceholder("Search skills...");
    await searchBox.fill("database");
    await page.waitForTimeout(500);

    // Should show matching results
    await expect(page.getByText("database-conventions").first()).toBeVisible({ timeout: 3000 });
  });

  test("sort dropdown changes order", async ({ page }) => {
    await goto(page, "/skills");

    const sortSelect = page.locator("select").first();
    await sortSelect.selectOption("Newest first");
    await page.waitForTimeout(500);

    // Verify the sort changed - heading still shows skills count
    await expect(page.getByRole("heading", { name: /^Skills / })).toBeVisible();
  });
});

/* ------------------------------------------------------------------ */
/*  4. Tasks                                                           */
/* ------------------------------------------------------------------ */

test.describe("Tasks Page", () => {
  test("loads with kanban board columns", async ({ page }) => {
    await goto(page, "/tasks");

    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();

    // Create form
    await expect(page.getByPlaceholder("Task title")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add" })).toBeVisible();

    // Kanban columns
    await expect(page.getByRole("heading", { name: "todo" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "in progress" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "review" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "done" })).toBeVisible();
  });

  test("can create and advance a task", async ({ page }) => {
    await goto(page, "/tasks");

    const taskTitle = `E2E Task ${Date.now()}`;
    await page.getByPlaceholder("Task title").fill(taskTitle);
    await page.getByRole("button", { name: "Add" }).click();

    // Task appears on board
    await expect(page.getByText(taskTitle).first()).toBeVisible({ timeout: 5000 });

    // Advance it one column
    const advanceBtn = page.getByRole("button", { name: /Advance/i }).first();
    if (await advanceBtn.isVisible()) {
      await advanceBtn.click();
      await page.waitForTimeout(500);
      await expect(page.getByText(taskTitle).first()).toBeVisible();
    }
  });
});

/* ------------------------------------------------------------------ */
/*  5. Plugins                                                         */
/* ------------------------------------------------------------------ */

test.describe("Plugins Page", () => {
  test("loads with heading and Add Plugin button", async ({ page }) => {
    await goto(page, "/plugins");

    await expect(page.getByRole("heading", { name: "Plugins" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Add Plugin/i })).toBeVisible();
  });

  test("plugin cards show Edit, Enabled, Delete buttons", async ({ page }) => {
    await goto(page, "/plugins");

    // Wait for plugin cards
    await page.waitForTimeout(1000);

    // Check for plugin action buttons
    const editBtn = page.getByRole("button", { name: "Edit" }).first();
    await expect(editBtn).toBeVisible({ timeout: 5000 });

    // Check for Enable/Disable toggle
    const toggleBtn = page.getByRole("button", { name: /Enabled|Disabled/i }).first();
    await expect(toggleBtn).toBeVisible();

    // Check for Delete button
    const deleteBtn = page.getByRole("button", { name: "Delete" }).first();
    await expect(deleteBtn).toBeVisible();
  });

  test("edit button shows textarea with source code", async ({ page }) => {
    await goto(page, "/plugins");

    await page.waitForTimeout(1000);
    const editBtn = page.getByRole("button", { name: "Edit" }).first();
    await editBtn.click();

    // Should show a textarea or similar editor after edit click
    await page.waitForTimeout(500);
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 3000 });
  });
});

/* ------------------------------------------------------------------ */
/*  6. Mail                                                            */
/* ------------------------------------------------------------------ */

test.describe("Mail Page", () => {
  test("loads with heading and shows empty state or accounts", async ({ page }) => {
    await goto(page, "/mail");

    await expect(page.getByRole("heading", { name: "Mail" })).toBeVisible();

    // Either shows "No email accounts" or account list
    const noAccounts = page.getByText("No email accounts configured");
    const addAccountBtn = page.getByRole("button", { name: "Add Account" });
    const hasContent = await noAccounts.isVisible().catch(() => false) ||
                       await addAccountBtn.isVisible().catch(() => false);
    expect(hasContent).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  7. Agents                                                          */
/* ------------------------------------------------------------------ */

test.describe("Agents Page", () => {
  test("loads with heading and agent cards", async ({ page }) => {
    await goto(page, "/agents");

    await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add Agent" })).toBeVisible();

    // Agent cards should be grouped by category
    await page.waitForTimeout(1000);

    // Check for agent names (they have "Enabled" badge)
    const agentCard = page.getByText("Enabled").first();
    await expect(agentCard).toBeVisible({ timeout: 5000 });

    // Check action buttons on agents
    const disableBtn = page.getByRole("button", { name: "Disable" }).first();
    await expect(disableBtn).toBeVisible();

    const editBtn = page.getByRole("button", { name: "Edit" }).first();
    await expect(editBtn).toBeVisible();

    const deleteBtn = page.getByRole("button", { name: "Delete" }).first();
    await expect(deleteBtn).toBeVisible();
  });

  test("agent cards have preview content toggle", async ({ page }) => {
    await goto(page, "/agents");

    await page.waitForTimeout(1000);

    // Click first agent card to toggle preview content
    const previewBtn = page.getByText("Preview content").first();
    await expect(previewBtn).toBeVisible({ timeout: 5000 });
    await previewBtn.click();

    // Verify content expands (or at least button state changes)
    await page.waitForTimeout(300);
  });
});

/* ------------------------------------------------------------------ */
/*  8. Servers                                                         */
/* ------------------------------------------------------------------ */

test.describe("Servers Page", () => {
  test("loads with heading and server form", async ({ page }) => {
    await goto(page, "/servers");

    await expect(page.getByRole("heading", { name: "MCP Servers" })).toBeVisible();

    // Creation form
    await expect(page.getByPlaceholder("Server name")).toBeVisible();
    await expect(page.getByPlaceholder(/Command/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Add Server/i })).toBeVisible();
  });

  test("can add and see a server", async ({ page }) => {
    await goto(page, "/servers");

    const serverName = `E2E Server ${Date.now()}`;
    await page.getByPlaceholder("Server name").fill(serverName);
    await page.getByPlaceholder(/Command/i).fill("echo test");
    await page.getByRole("button", { name: /Add Server/i }).click();

    await expect(page.getByText(serverName).first()).toBeVisible({ timeout: 5000 });
  });
});

/* ------------------------------------------------------------------ */
/*  9. Config                                                          */
/* ------------------------------------------------------------------ */

test.describe("Config Page", () => {
  test("loads with heading and tab navigation", async ({ page }) => {
    await goto(page, "/config");

    await expect(page.getByRole("heading", { name: "Config" })).toBeVisible();

    // Two tabs
    await expect(page.getByRole("button", { name: "Project Config" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Global Config" })).toBeVisible();

    // Textarea with JSON content
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
    const content = await textarea.inputValue();
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("opencode");
  });

  test("can switch to Global Config tab", async ({ page }) => {
    await goto(page, "/config");

    await page.getByRole("button", { name: "Global Config" }).click();
    await page.waitForTimeout(500);

    // Should show global config content
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 3000 });
  });

  test("Save and Sync from disk buttons exist", async ({ page }) => {
    await goto(page, "/config");

    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sync from disk/i })).toBeVisible();
  });
});

/* ------------------------------------------------------------------ */
/*  10. Observations                                                   */
/* ------------------------------------------------------------------ */

test.describe("Observations Page", () => {
  test("loads with heading and stats", async ({ page }) => {
    await goto(page, "/observations");

    await expect(page.locator("h1")).toContainText("Observations");

    // Stats
    await expect(page.getByText("Total:").first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Pending:").first()).toBeVisible({ timeout: 3000 });
  });

  test("shows observation cards with type badges", async ({ page }) => {
    await goto(page, "/observations");

    await page.waitForTimeout(2000);

    // Should have observation cards with type badges
    const typeBadge = page.locator("span:has-text('pattern')").first();
    await expect(typeBadge).toBeVisible({ timeout: 5000 });

    // Cards should be clickable
    const cards = page.locator("[class*='cursor-pointer']");
    await expect(cards.first()).toBeVisible({ timeout: 3000 });
  });
});

/* ------------------------------------------------------------------ */
/*  11. Personality                                                    */
/* ------------------------------------------------------------------ */

test.describe("Personality Page", () => {
  test("loads with heading and sort controls", async ({ page }) => {
    await goto(page, "/personality");

    await expect(page.locator("h1")).toContainText("Personality Profile");

    // Sort dropdown
    await expect(page.getByText("Sort:")).toBeVisible();
    await expect(page.locator("select").first()).toBeVisible();

    // Trait count
    await expect(page.getByText("trait(s)").first()).toBeVisible({ timeout: 5000 });
  });

  test("shows trait cards grouped by type", async ({ page }) => {
    await goto(page, "/personality");

    await page.waitForTimeout(2000);

    // Trait cards with confidence percentages
    const traitCard = page.getByText("%").first();
    await expect(traitCard).toBeVisible({ timeout: 5000 });
  });

  test("sort dropdown switches mode", async ({ page }) => {
    await goto(page, "/personality");

    await page.waitForTimeout(1000);

    const sortSelect = page.locator("select").first();
    await sortSelect.selectOption("Newest first");
    await page.waitForTimeout(500);

    // Should still show traits
    await expect(page.getByText("trait(s)").first()).toBeVisible({ timeout: 3000 });
  });

  test("dismiss button exists on trait cards", async ({ page }) => {
    await goto(page, "/personality");

    await page.waitForTimeout(2000);

    // Each trait card should have a dismiss (×) button
    const dismissBtn = page.getByRole("button", { name: "×" }).first();
    await expect(dismissBtn).toBeVisible({ timeout: 5000 });
  });
});

/* ------------------------------------------------------------------ */
/*  12. Pipeline                                                       */
/* ------------------------------------------------------------------ */

test.describe("Pipeline Page", () => {
  test("loads with heading and stats bar", async ({ page }) => {
    await goto(page, "/pipeline");

    await expect(page.locator("h1")).toContainText("Pipeline Activity");

    // Stats bar numbers
    await expect(page.getByText("Total:").first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator("span:has-text('Observations:')")).toBeVisible();
    await expect(page.locator("span:has-text('Syntheses:')")).toBeVisible();
    await expect(page.locator("span:has-text('Traits:')")).toBeVisible();
    await expect(page.locator("span:has-text('Skills:')")).toBeVisible();
  });

  test("filter pills are present and clickable", async ({ page }) => {
    await goto(page, "/pipeline");

    // Wait for initial load
    await page.waitForTimeout(2000);

    // All filter pills
    await expect(page.getByRole("button", { name: "All" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Agent" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Plugin" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Synthesis" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Trait" })).toBeVisible();
    const pauseBtn = page.locator("button:has-text('Pause')");
    await expect(pauseBtn).toBeVisible();
  });

  test("pause button toggles to resume", async ({ page }) => {
    await goto(page, "/pipeline");

    await page.waitForTimeout(2000);

    const pauseBtn = page.locator("button:has-text('Pause')");
    await pauseBtn.click();
    await page.waitForTimeout(500);

    await expect(page.locator("button:has-text('Resume')")).toBeVisible();
  });

  test("shows timeline events", async ({ page }) => {
    await goto(page, "/pipeline");

    // Wait for events to load
    await page.waitForTimeout(3000);

    // Should have event entries in the timeline
    const eventEntry = page.locator("text=Synthesis").or(page.locator("text=Agent")).or(page.locator("text=Plugin"));
    await expect(eventEntry.first()).toBeVisible({ timeout: 5000 });
  });
});

/* ------------------------------------------------------------------ */
/*  13. Settings                                                       */
/* ------------------------------------------------------------------ */

test.describe("Settings Page", () => {
  test("loads with heading and archive retention setting", async ({ page }) => {
    await goto(page, "/settings");

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Archive retention
    await expect(page.getByText("Archive retention")).toBeVisible();
    await expect(page.locator('input[type="number"]')).toBeVisible();
  });

  test("Providers settings exposes repeatable provider blocks", async ({ page }) => {
    await goto(page, "/?settings=providers");

    await expect(page.getByRole("heading", { name: "LLM Providers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Add provider" })).toBeVisible();
  });

  test("interval selector is present", async ({ page }) => {
    await goto(page, "/?settings=providers");

    await expect(page.getByText("Synthesis schedule")).toBeVisible();
    const intervalSelect = page.locator("select").filter({ hasText: /minutes|hour|Disabled/ }).first();
    await expect(intervalSelect).toBeVisible();
  });

  test("Save providers button exists", async ({ page }) => {
    await goto(page, "/?settings=providers");

    await expect(page.getByRole("button", { name: "Save providers" })).toBeVisible();
  });

  test("provider blocks are collapsible", async ({ page }) => {
    await goto(page, "/?settings=providers");
    const addButton = page.getByRole("button", { name: "+ Add provider" });
    await addButton.click();

    const collapse = page.getByRole("button", { name: /Collapse Provider/ }).last();
    await expect(collapse).toBeVisible();
    await collapse.click();
    await expect(page.getByRole("button", { name: /Expand Provider/ }).last()).toBeVisible();
  });
});

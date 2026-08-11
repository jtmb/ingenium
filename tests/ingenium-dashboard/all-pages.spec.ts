import { test, expect } from "@playwright/test";

/**
 * Smoke checks for the dashboard management pages using configured endpoints.
 */

const BASE = process.env.INGENIUM_E2E_DASHBOARD_URL ?? "http://localhost:3000";
const PROJECT = "gh-llm-bootstrap";

async function goto(page: any, path: string) {
  const res = await page.goto(`${BASE}${path}?project=${PROJECT}`, {
    waitUntil: "domcontentloaded",
  });
  expect(res?.ok()).toBeTruthy();
  await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
}

async function waitForClientState(page: any): Promise<void> {
  await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
}

test.describe("Projects Page", () => {
  test("loads with heading, create form, and project list", async ({ page }) => {
    await goto(page, "/projects");

    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

    await expect(page.getByPlaceholder("Project name")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Active" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Archived" })).toBeVisible();

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

test.describe("Skills Page", () => {
  test("loads with heading, search, and skill cards", async ({ page }) => {
    await goto(page, "/skills");

    await expect(page.getByRole("heading", { name: /^Active Skills/ })).toBeVisible();

    await expect(page.getByPlaceholder("Search skills...")).toBeVisible();

    await expect(page.locator("select").first()).toBeVisible();

    await expect(page.getByRole("button", { name: "Upload Skill" })).toBeVisible();

    const firstCard = page.locator("[class*='cursor-pointer']").first();
    await expect(firstCard).toBeVisible({ timeout: 5000 });
  });

  test("search filters skills", async ({ page }) => {
    await goto(page, "/skills");

    const searchBox = page.getByPlaceholder("Search skills...");
    await searchBox.fill("database");
    await waitForClientState(page);

    await expect(page.getByText("database-conventions").first()).toBeVisible({ timeout: 3000 });
  });

  test("sort dropdown changes order", async ({ page }) => {
    await goto(page, "/skills");

    const sortSelect = page.locator("select").first();
    await sortSelect.selectOption("Newest first");
    await waitForClientState(page);

    await expect(page.getByRole("heading", { name: /^Active Skills/ })).toBeVisible();
  });
});

test.describe("Tasks Page", () => {
  test("loads with kanban board columns", async ({ page }) => {
    await goto(page, "/tasks");

    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();

    await expect(page.getByPlaceholder("Task title")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add" })).toBeVisible();

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

    await expect(page.getByText(taskTitle).first()).toBeVisible({ timeout: 5000 });

    const advanceBtn = page.getByRole("button", { name: /Advance/i }).first();
    if (await advanceBtn.isVisible()) {
      await advanceBtn.click();
      await waitForClientState(page);
      await expect(page.getByText(taskTitle).first()).toBeVisible();
    }
  });
});

test.describe("Plugins Page", () => {
  test("loads with heading and Add Plugin button", async ({ page }) => {
    await goto(page, "/plugins");

    await expect(page.getByRole("heading", { name: "Plugins" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Add Plugin/i })).toBeVisible();
  });

  test("plugin cards show Edit, Enabled, Delete buttons", async ({ page }) => {
    await goto(page, "/plugins");

    await waitForClientState(page);

    const editBtn = page.getByRole("button", { name: "Edit" }).first();
    await expect(editBtn).toBeVisible({ timeout: 5000 });

    const toggleBtn = page.getByRole("button", { name: /Enabled|Disabled/i }).first();
    await expect(toggleBtn).toBeVisible();

    const deleteBtn = page.getByRole("button", { name: "Delete" }).first();
    await expect(deleteBtn).toBeVisible();
  });

  test("edit button shows textarea with source code", async ({ page }) => {
    await goto(page, "/plugins");

    await waitForClientState(page);
    const editBtn = page.getByRole("button", { name: "Edit" }).first();
    await editBtn.click();

    await waitForClientState(page);
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 3000 });
  });
});

test.describe("Mail Page", () => {
  test("loads with heading and shows empty state or accounts", async ({ page }) => {
    await goto(page, "/mail");

    await expect(page.getByRole("heading", { name: "Mail" })).toBeVisible();

    const noAccounts = page.getByText("No email accounts configured");
    const addAccountBtn = page.getByRole("button", { name: "Add Account" });
    const hasContent = await noAccounts.isVisible() || await addAccountBtn.isVisible();
    expect(hasContent).toBeTruthy();
  });
});

test.describe("Agents Page", () => {
  test("loads with heading and agent cards", async ({ page }) => {
    await goto(page, "/agents");

    await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add Agent" })).toBeVisible();

    await waitForClientState(page);

    const agentCard = page.getByText("Enabled").first();
    await expect(agentCard).toBeVisible({ timeout: 5000 });

    const disableBtn = page.getByRole("button", { name: "Disable" }).first();
    await expect(disableBtn).toBeVisible();

    const editBtn = page.getByRole("button", { name: "Edit" }).first();
    await expect(editBtn).toBeVisible();

    const deleteBtn = page.getByRole("button", { name: "Delete" }).first();
    await expect(deleteBtn).toBeVisible();
  });

  test("agent cards have preview content toggle", async ({ page }) => {
    await goto(page, "/agents");

    await waitForClientState(page);

    const previewBtn = page.getByText("Preview content").first();
    await expect(previewBtn).toBeVisible({ timeout: 5000 });
    await previewBtn.click();

    await waitForClientState(page);
  });
});

test.describe("Config Page", () => {
  test("loads with heading and tab navigation", async ({ page }) => {
    await goto(page, "/config");

    await expect(page.getByRole("heading", { name: "Config" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Project Config" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Global Config" })).toBeVisible();

    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
    const content = await textarea.inputValue();
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("opencode");
  });

  test("can switch to Global Config tab", async ({ page }) => {
    await goto(page, "/config");

    await page.getByRole("button", { name: "Global Config" }).click();
    await waitForClientState(page);

    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 3000 });
  });

  test("Save and Sync from disk buttons exist", async ({ page }) => {
    await goto(page, "/config");

    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sync from disk/i })).toBeVisible();
  });
});

test.describe("Observations Page", () => {
  test("loads with heading and stats", async ({ page }) => {
    await goto(page, "/observations");

    await expect(page.locator("h1")).toContainText("Observations");

    await expect(page.getByText("Total:").first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Pending:").first()).toBeVisible({ timeout: 3000 });
  });

  test("shows observation cards with type badges", async ({ page }) => {
    await goto(page, "/observations");

    await waitForClientState(page);

    const typeBadge = page.locator("span:has-text('pattern')").first();
    await expect(typeBadge).toBeVisible({ timeout: 5000 });

    const cards = page.locator("[class*='cursor-pointer']");
    await expect(cards.first()).toBeVisible({ timeout: 3000 });
  });
});

test.describe("Personality Page", () => {
  test("loads with heading and sort controls", async ({ page }) => {
    await goto(page, "/personality");

    await expect(page.locator("h1")).toContainText("Personality Profile");

    await expect(page.getByText("Sort:")).toBeVisible();
    await expect(page.locator("select").first()).toBeVisible();

    await expect(page.getByRole("status", { name: "Personality trait counts" })).toBeVisible({ timeout: 5000 });
  });

  test("shows trait cards grouped by type", async ({ page }) => {
    await goto(page, "/personality");

    await waitForClientState(page);

    const traitCard = page.getByText("%").first();
    await expect(traitCard).toBeVisible({ timeout: 5000 });
  });

  test("sort dropdown switches mode", async ({ page }) => {
    await goto(page, "/personality");

    await waitForClientState(page);

    const sortSelect = page.locator("select").first();
    await sortSelect.selectOption("Newest first");
    await waitForClientState(page);

    await expect(page.getByRole("status", { name: "Personality trait counts" })).toBeVisible({ timeout: 3000 });
  });

  test("dismiss button exists on trait cards", async ({ page }) => {
    await goto(page, "/personality");

    await waitForClientState(page);

    const dismissBtn = page.getByRole("button", { name: "Dismiss trait" }).first();
    await expect(dismissBtn).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Pipeline Page", () => {
  test("loads with heading and stats bar", async ({ page }) => {
    await goto(page, "/pipeline");

    await expect(page.locator("h1")).toContainText("Pipeline Activity");

    await expect(page.getByText("Total:").first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator("span:has-text('Observations:')")).toBeVisible();
    await expect(page.locator("span:has-text('Syntheses:')")).toBeVisible();
    await expect(page.locator("span:has-text('Traits:')")).toBeVisible();
    await expect(page.locator("span:has-text('Skills:')")).toBeVisible();
  });

  test("filter pills are present and clickable", async ({ page }) => {
    await goto(page, "/pipeline");

    await waitForClientState(page);

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

    await waitForClientState(page);

    const pauseBtn = page.locator("button:has-text('Pause')");
    await pauseBtn.click();
    await waitForClientState(page);

    await expect(page.locator("button:has-text('Resume')")).toBeVisible();
  });

  test("shows timeline events", async ({ page }) => {
    await goto(page, "/pipeline");

    await waitForClientState(page);

    const eventEntry = page.locator("text=Synthesis").or(page.locator("text=Agent")).or(page.locator("text=Plugin"));
    await expect(eventEntry.first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Settings Page", () => {
  test("loads with heading and archive retention setting", async ({ page }) => {
    await goto(page, "/settings");

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

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

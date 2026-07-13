# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/ingenium-dashboard/dashboard.spec.ts >> Ingenium Dashboard >> skills page loads with search
- Location: tests/ingenium-dashboard/dashboard.spec.ts:69:7

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/skills", waiting until "load"

```

# Test source

```ts
  1   | import { test, expect } from "@playwright/test";
  2   | 
  3   | /**
  4   |  * E2E tests for the Ingenium Dashboard.
  5   |  *
  6   |  * These tests run against a live Next.js dev server (port 3000) and real API
  7   |  * server (port 4097). Each test navigates to a management page and verifies
  8   |  * that interactions (creating, moving, listing) work end-to-end.
  9   |  *
  10  |  * Selectors use roles, labels, and text content since the pages currently
  11  |  * don't have data-testid attributes. If refactoring later, prefer
  12  |  * data-testid selectors for stability (see useful-tests skill).
  13  |  */
  14  | test.describe("Ingenium Dashboard", () => {
  15  |   /* ------------------------------------------------------------------ */
  16  |   /*  1. Home page                                                       */
  17  |   /* ------------------------------------------------------------------ */
  18  | 
  19  |   test("home page loads with title and navigation links", async ({ page }) => {
  20  |     await page.goto("/");
  21  | 
  22  |     // The page title is displayed as an <h1>
  23  |     await expect(
  24  |       page.getByRole("heading", { name: "Ingenium Dashboard" }),
  25  |     ).toBeVisible();
  26  | 
  27  |     // The subtitle should be present
  28  |     await expect(
  29  |       page.getByText("Manage your AI agent skill system, learnings, tasks, and MCP servers."),
  30  |     ).toBeVisible();
  31  | 
  32  |     // All navigation links should be present in the top nav bar
  33  |     const nav = page.locator("nav");
  34  |     const links = ["Projects", "Archive", "Skills", "Learnings", "Tasks", "Plugins", "Servers", "Settings"];
  35  |     for (const name of links) {
  36  |       await expect(nav.getByRole("link", { name })).toBeVisible();
  37  |     }
  38  | 
  39  |     // The home page should also contain card-style link tiles
  40  |     const cardLinks = page.locator("a[href]").filter({ has: page.locator("h2") });
  41  |     await expect(cardLinks).toHaveCount(7);
  42  |   });
  43  | 
  44  |   /* ------------------------------------------------------------------ */
  45  |   /*  2. Projects page                                                   */
  46  |   /* ------------------------------------------------------------------ */
  47  | 
  48  |   test("projects page creates a project", async ({ page }) => {
  49  |     await page.goto("/projects");
  50  | 
  51  |     // Page heading
  52  |     await expect(
  53  |       page.getByRole("heading", { name: "Projects" }),
  54  |     ).toBeVisible();
  55  | 
  56  |     // Create a new project via the inline form
  57  |     const projectName = `E2E Project ${Date.now()}`;
  58  |     await page.getByPlaceholder("Project name").fill(projectName);
  59  |     await page.getByRole("button", { name: "Create" }).click();
  60  | 
  61  |     // The newly created project should appear in the list below the form
  62  |     await expect(page.getByText(projectName).first()).toBeVisible();
  63  |   });
  64  | 
  65  |   /* ------------------------------------------------------------------ */
  66  |   /*  3. Skills page                                                     */
  67  |   /* ------------------------------------------------------------------ */
  68  | 
  69  |   test("skills page loads with search", async ({ page }) => {
> 70  |     await page.goto("/skills");
      |                ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  71  | 
  72  |     // The heading shows "Skills" and a count of loaded skills
  73  |     await expect(
  74  |       page.getByRole("heading", { name: /^Skills / }),
  75  |     ).toBeVisible();
  76  | 
  77  |     // The search input should be rendered
  78  |     await expect(
  79  |       page.getByPlaceholder("Search skills..."),
  80  |     ).toBeVisible();
  81  |   });
  82  | 
  83  |   /* ------------------------------------------------------------------ */
  84  |   /*  4. Learnings page                                                  */
  85  |   /* ------------------------------------------------------------------ */
  86  | 
  87  |   test("learnings page logs an entry", async ({ page }) => {
  88  |     await page.goto("/learnings");
  89  | 
  90  |     // Page heading
  91  |     await expect(
  92  |       page.getByRole("heading", { name: "Learnings" }),
  93  |     ).toBeVisible();
  94  | 
  95  |     // Select a learning type from the dropdown
  96  |     await page.locator("select").selectOption("pattern");
  97  | 
  98  |     // Fill in the content textarea
  99  |     const entryText = `E2E learning entry ${Date.now()}`;
  100 |     await page.getByPlaceholder("What did you learn?").fill(entryText);
  101 | 
  102 |     // Click the "Log Learning" button
  103 |     await page.getByRole("button", { name: "Log Learning" }).click();
  104 | 
  105 |     // The new entry should appear in the list
  106 |     await expect(page.getByText(entryText)).toBeVisible();
  107 | 
  108 |     // The type badge ("pattern") should also be visible for the new entry
  109 |     // Use a more specific selector to avoid matching the <option> in the dropdown
  110 |     await expect(page.locator("span", { hasText: "pattern" }).first()).toBeVisible();
  111 |   });
  112 | 
  113 |   /* ------------------------------------------------------------------ */
  114 |   /*  5. Tasks page                                                      */
  115 |   /* ------------------------------------------------------------------ */
  116 | 
  117 |   test("tasks page creates and moves a task", async ({ page }) => {
  118 |     await page.goto("/tasks");
  119 | 
  120 |     // Page heading
  121 |     await expect(
  122 |       page.getByRole("heading", { name: "Tasks" }),
  123 |     ).toBeVisible();
  124 | 
  125 |     // Create a new task (starts in "todo" column)
  126 |     const taskTitle = `E2E Task ${Date.now()}`;
  127 |     await page.getByPlaceholder("Task title").fill(taskTitle);
  128 |     await page.getByRole("button", { name: "Add" }).click();
  129 | 
  130 |     // The task should appear on the board after creation
  131 |     await expect(page.getByText(taskTitle)).toBeVisible();
  132 | 
  133 |     // Click the Advance → button inside the task card to move it to "in progress"
  134 |     const taskCard = page.getByText(taskTitle).first();
  135 |     await taskCard.locator("..").getByRole("button", { name: /Advance/i }).click();
  136 | 
  137 |     // Wait for the PATCH request that moves the task to complete
  138 |     await page.waitForResponse(
  139 |       (resp) =>
  140 |         resp.url().includes("/api/v1/tasks/") &&
  141 |         resp.request().method() === "PATCH" &&
  142 |         resp.status() === 200,
  143 |     );
  144 | 
  145 |     // The task should still be visible after moving to the next column
  146 |     await expect(page.getByText(taskTitle)).toBeVisible();
  147 |   });
  148 | 
  149 |   /* ------------------------------------------------------------------ */
  150 |   /*  6. Plugins page                                                    */
  151 |   /* ------------------------------------------------------------------ */
  152 | 
  153 |   test("plugins page renders with heading and Add Plugin button", async ({ page }) => {
  154 |     await page.goto("/plugins");
  155 | 
  156 |     // Page heading
  157 |     await expect(
  158 |       page.getByRole("heading", { name: "Plugins" }),
  159 |     ).toBeVisible();
  160 | 
  161 |     // Add Plugin button should be present
  162 |     await expect(page.getByRole("button", { name: /Add Plugin/i })).toBeVisible();
  163 |   });
  164 | 
  165 |   test("plugins page creates and shows a plugin", async ({ page }) => {
  166 |     const ts = Date.now().toString();
  167 |     await page.goto("/plugins");
  168 |     await page.getByRole("button", { name: /Add Plugin/i }).click();
  169 |     await page.getByPlaceholder("my-plugin", { exact: true }).fill(`e2e-plugin-${ts}`);
  170 |     await page.getByPlaceholder("my-plugin.ts").fill(`e2e-plugin-${ts}.ts`);
```
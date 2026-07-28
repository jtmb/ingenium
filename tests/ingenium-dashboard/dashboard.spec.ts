import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { visualQaArtifactDirectory } from "./visual-qa-artifacts";

const SKILLS_SCREENSHOTS_DIR = visualQaArtifactDirectory("skills");
const nestedMarkdownPath = "references/nested/deep/a-very-long-path-name-that-must-not-widen-the-skills-dialog/wide-markdown.md";
const wideMarkdown = [
  "# Responsive skill preview",
  "",
  "```text",
  "unbroken-markdown-content-".repeat(80),
  "```",
  "",
  ...Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1}: ${"content ".repeat(12)}`),
].join("\n");

const layoutSkill = {
  id: "skills-layout",
  project_id: "global-default",
  name: "skills-layout",
  description: "Deterministic nested-file layout fixture",
  content: "# Skill fixture",
  category: null,
  tags: null,
  always_apply: 0,
  file_tree: JSON.stringify({ [nestedMarkdownPath]: wideMarkdown }),
  enabled: 1,
  revision: 1,
  archived_at: null,
  created_at: "2026-07-28T00:00:00.000Z",
  updated_at: "2026-07-28T00:00:00.000Z",
};

async function mockSkillsDetail(page: Page): Promise<void> {
  await page.route((url) => url.pathname === "/api/v1/projects", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: [{
        id: "global-default",
        name: "global-default",
        is_global: true,
        created_at: "2026-07-28T00:00:00.000Z",
        updated_at: "2026-07-28T00:00:00.000Z",
      }],
    }),
  }));
  await page.route(
    (url) => url.pathname === "/api/v1/skills" && url.searchParams.has("project"),
    (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [layoutSkill] }),
    }),
  );
  await page.route(
    (url) => url.pathname === "/api/v1/skills/skills-layout",
    (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: layoutSkill }),
    }),
  );
}

async function openLayoutSkill(page: Page) {
  await mockSkillsDetail(page);
  await page.goto("/skills", { waitUntil: "domcontentloaded" });
  await page.getByTestId("skill-card-skills-layout").click();
  const dialog = page.getByRole("dialog", { name: "skills-layout" });
  await expect(dialog).toBeVisible();
  return dialog;
}

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

  test("skills detail stays viewport-bounded beside nested wide Markdown on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const dialog = await openLayoutSkill(page);

    const references = page.getByRole("button", { name: "Collapse references", exact: true });
    await expect(references).toHaveAttribute("aria-expanded", "true");
    await references.click();
    await expect(page.getByRole("button", { name: "Expand references", exact: true })).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Expand references", exact: true }).click();
    await page.getByRole("button", { name: `Open ${nestedMarkdownPath}`, exact: true }).click();

    const geometry = await dialog.evaluate((dialogElement) => {
      const tree = dialogElement.querySelector<HTMLElement>("[data-testid='skill-file-tree']")!;
      const preview = dialogElement.querySelector<HTMLElement>("[data-testid='skill-preview']")!;
      const previewContent = dialogElement.querySelector<HTMLElement>("[data-testid='skill-preview-content']")!;
      return {
        dialog: dialogElement.getBoundingClientRect().toJSON(),
        tree: tree.getBoundingClientRect().toJSON(),
        preview: preview.getBoundingClientRect().toJSON(),
        pageOverflows: document.documentElement.scrollWidth > window.innerWidth,
        previewScrolls: previewContent.scrollHeight > previewContent.clientHeight,
      };
    });

    expect(geometry.dialog.height).toBeGreaterThanOrEqual(809);
    expect(geometry.dialog.height).toBeLessThanOrEqual(811);
    expect(geometry.tree.x).toBeLessThan(geometry.preview.x);
    expect(Math.abs(geometry.tree.y - geometry.preview.y)).toBeLessThanOrEqual(1);
    expect(geometry.pageOverflows).toBe(false);
    expect(geometry.previewScrolls).toBe(true);
    await page.screenshot({ path: path.join(SKILLS_SCREENSHOTS_DIR, "skills-detail-desktop.png") });
  });

  test("skills detail stacks its tree above a scrollable preview on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const dialog = await openLayoutSkill(page);
    await page.getByRole("button", { name: `Open ${nestedMarkdownPath}`, exact: true }).click();

    const geometry = await dialog.evaluate((dialogElement) => {
      const tree = dialogElement.querySelector<HTMLElement>("[data-testid='skill-file-tree']")!;
      const preview = dialogElement.querySelector<HTMLElement>("[data-testid='skill-preview']")!;
      const previewContent = dialogElement.querySelector<HTMLElement>("[data-testid='skill-preview-content']")!;
      return {
        dialog: dialogElement.getBoundingClientRect().toJSON(),
        tree: tree.getBoundingClientRect().toJSON(),
        preview: preview.getBoundingClientRect().toJSON(),
        pageOverflows: document.documentElement.scrollWidth > window.innerWidth,
        previewScrolls: previewContent.scrollHeight > previewContent.clientHeight,
      };
    });

    expect(geometry.dialog.height).toBeGreaterThanOrEqual(759);
    expect(geometry.dialog.height).toBeLessThanOrEqual(761);
    expect(geometry.tree.y).toBeLessThan(geometry.preview.y);
    expect(geometry.tree.width).toBeLessThanOrEqual(geometry.dialog.width);
    expect(geometry.preview.width).toBeLessThanOrEqual(geometry.dialog.width);
    expect(geometry.pageOverflows).toBe(false);
    expect(geometry.previewScrolls).toBe(true);
    await page.screenshot({ path: path.join(SKILLS_SCREENSHOTS_DIR, "skills-detail-mobile.png") });
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

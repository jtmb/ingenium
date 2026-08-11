import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { getDefaultSuiteRuntime } from "./default-suite-runtime";
import { visualQaArtifactDirectory } from "./visual-qa-artifacts";

const SKILLS_SCREENSHOTS_DIR = visualQaArtifactDirectory("skills");
const { dashboardUrl } = getDefaultSuiteRuntime();
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

const createProposal = {
  id: "proposal-create",
  projectId: "global-default",
  status: "pending",
  proposalType: "create",
  targetSkillId: null,
  targetName: "new-skill",
  sourceProjectId: null,
  sourceName: null,
  expectedRevision: null,
  expectedSourceRevision: null,
  targetRevisionBefore: null,
  sourceRevisionBefore: null,
  targetCreated: 1,
  proposedState: { description: "A new skill", content: "# New skill" },
  evidence: [],
  observationIds: [],
  qualityScore: 0.9,
  noveltyScore: 0.8,
  contradictionFlag: 0,
  candidateGroupKey: null,
  reviewer: null,
  reviewReason: null,
  alwaysApply: 0,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  reviewedAt: null,
  appliedAt: null,
  rolledBackAt: null,
};

const createProposalSummary = {
  id: createProposal.id,
  status: createProposal.status,
  proposalType: createProposal.proposalType,
  targetName: createProposal.targetName,
  sourceName: createProposal.sourceName,
  qualityScore: createProposal.qualityScore,
  noveltyScore: createProposal.noveltyScore,
  createdAt: createProposal.createdAt,
};

async function mockProjectContext(page: Page): Promise<void> {
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
}

async function mockSkillsDetail(page: Page): Promise<void> {
  await mockProjectContext(page);
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

async function expectWithinViewport(locator: import("@playwright/test").Locator, width: number): Promise<void> {
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    return box !== null && box.x >= 0 && box.x + box.width <= width;
  }, { message: "expected the element to settle inside the viewport" }).toBe(true);
  const box = await locator.boundingBox();
  expect(box, "expected a visible viewport-bounded element").not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
}

async function expectNoHorizontalPageScroll(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth
      && document.body.scrollWidth <= window.innerWidth,
  )).toBe(true);
}

/**
 * E2E contracts for current dashboard routes that are not covered by a
 * dedicated workflow spec. Retired learning, archive, and server page
 * contracts intentionally do not appear here.
 */
test.describe("Ingenium Dashboard", () => {
  test("home page keeps the desktop navigation links available in both rail densities", async ({ page }) => {
    await mockProjectContext(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Ingenium", exact: true })).toBeVisible();
    const rail = page.locator("#nav-sidebar");
    const nav = page.getByRole("navigation", { name: "Desktop navigation" });
    await expect(rail).toHaveCSS("width", "224px");
    await expect(page.getByRole("button", { name: "Active project: global-default" })).toContainText("global-default");
    for (const name of [
      "Chat",
      "OpenCode",
      "VS Code",
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

    await nav.getByRole("button", { name: "Workspace", exact: true }).click();
    const workspaceGroup = page.locator("#desktop-nav-group-workspace");
    await expect(workspaceGroup).toHaveAttribute("aria-hidden", "true");
    await expect(workspaceGroup).toHaveAttribute("inert", "");
    await expect(nav.getByRole("link", { name: "Chat", exact: true })).toHaveCount(0);
    await nav.getByRole("button", { name: "Workspace", exact: true }).click();

    await page.getByRole("button", { name: "Collapse navigation" }).click();
    await expect(rail).toHaveCSS("width", "56px");
    await expect(page.getByRole("button", { name: "Expand navigation" })).toHaveAttribute("aria-expanded", "false");
    for (const name of ["Chat", "VS Code", "Tasks", "Skills", "MCP Servers", "Secrets"]) {
      const link = nav.getByRole("link", { name, exact: true });
      await expect(link).toHaveAttribute("aria-label", name);
      await expect(link).toHaveAttribute("title", name);
    }
  });

  test("desktop branding and navigation remain inside the 1440px viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockProjectContext(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const topbar = page.locator("nav[data-nav-background='topbar']");
    const branding = topbar.locator("a[href='/']");
    const rail = page.locator("#nav-sidebar");
    await expect(topbar).toBeVisible();
    await expect(branding).toBeVisible();
    await expect(rail).toBeVisible();
    await expectWithinViewport(topbar, 1440);
    await expectWithinViewport(branding, 1440);
    await expectWithinViewport(rail, 1440);
    await expectNoHorizontalPageScroll(page);
  });

  test("mobile branding and the fully open drawer remain inside the 390px viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockProjectContext(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const topbar = page.locator("nav[data-nav-background='topbar']");
    const branding = topbar.locator("a[href='/']");
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    const drawer = page.locator("#mobile-navigation-dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("data-edge-drawer-state", "open");
    await expectWithinViewport(topbar, 390);
    await expectWithinViewport(branding, 390);
    await expectWithinViewport(drawer, 390);
    await expectNoHorizontalPageScroll(page);
  });

  test("mobile navigation drawer is mounted only while open", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockProjectContext(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#nav-sidebar")).toBeHidden();
    const trigger = page.getByRole("button", { name: "Open navigation menu" });
    await trigger.click();

    const drawer = page.getByRole("dialog", { name: "Ingenium" });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(await page.locator("body").evaluate((element) => (element as HTMLElement).style.overflow)).toBe("hidden");
    await expect(drawer.getByRole("link", { name: "Tasks", exact: true })).toBeVisible();
    await expect(page.locator('[data-nav-background="topbar"]')).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator('[data-nav-background="content"]')).toHaveAttribute("aria-hidden", "true");

    await page.setViewportSize({ width: 1024, height: 844 });
    await expect(drawer).not.toBeAttached();
    expect(await page.locator("body").evaluate((element) => (element as HTMLElement).style.overflow)).toBe("");
    await expect(page.locator('[data-nav-background="topbar"]')).not.toHaveAttribute("aria-hidden");
    await expect(page.locator('[data-nav-background="content"]')).not.toHaveAttribute("aria-hidden");
    await expect(page.getByRole("button", { name: "Collapse navigation" })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await trigger.click();
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeAttached();
    await expect(trigger).toBeFocused();
  });

  test("Mail settings remain scrollable within the mobile settings dialog", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockProjectContext(page);
    await page.route(
      (url) => url.pathname.startsWith("/api/v1/settings/"),
      (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { value: "" } }),
      }),
    );
    await page.goto("/?settings=mail", { waitUntil: "domcontentloaded" });

    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("settings-panel-mail")).toBeVisible();
    await expect(page.getByPlaceholder("Google Cloud OAuth client ID")).toBeVisible();

    const geometry = await page.getByTestId("settings-panel-scroll").evaluate((element) => {
      const scrollRegion = element as HTMLElement;
      scrollRegion.scrollTop = scrollRegion.scrollHeight;
      return {
        clientHeight: scrollRegion.clientHeight,
        scrollHeight: scrollRegion.scrollHeight,
        scrollTop: scrollRegion.scrollTop,
        overflowY: getComputedStyle(scrollRegion).overflowY,
      };
    });

    expect(geometry.overflowY).toBe("auto");
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
    expect(geometry.scrollTop).toBeGreaterThan(0);
    await expectNoHorizontalPageScroll(page);
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

    await expect(page.getByRole("heading", { name: /^Active Skills/ })).toBeVisible();
    await expect(page.getByPlaceholder("Search skills...", { exact: true })).toBeVisible();
  });

  test("skills controls stay within the viewport on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSkillsDetail(page);
    await page.goto(new URL("/skills", dashboardUrl).toString(), { waitUntil: "domcontentloaded" });

    const geometry = await page.getByTestId("skills-search").evaluate((searchElement) => {
      const controls = searchElement.parentElement!;
      const upload = controls.querySelector<HTMLElement>("[data-testid='skills-upload-btn']")!;
      return {
        controls: controls.getBoundingClientRect().toJSON(),
        upload: upload.getBoundingClientRect().toJSON(),
        pageOverflows: document.documentElement.scrollWidth > window.innerWidth,
      };
    });

    expect(geometry.pageOverflows).toBe(false);
    expect(geometry.upload.left).toBeGreaterThanOrEqual(geometry.controls.left);
    expect(geometry.upload.right).toBeLessThanOrEqual(geometry.controls.right);
  });

  test("skills card opens by keyboard and restores focus after Escape", async ({ page }) => {
    await mockSkillsDetail(page);
    await page.goto("/skills", { waitUntil: "domcontentloaded" });

    const opener = page.getByTestId("skill-card-skills-layout");
    await expect(opener).toHaveAttribute("type", "button");
    await expect(page.getByRole("button", { name: "Open skill skills-layout", exact: true })).toBeVisible();
    await opener.focus();

    for (const key of ["Enter", "Space"]) {
      await opener.press(key);
      const dialog = page.getByRole("dialog", { name: "skills-layout" });
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(opener).toBeFocused();
    }
  });

  test("create proposal cards open by keyboard without fetching a missing target", async ({ page }) => {
    let targetFetches = 0;
    let legacyProposalListRequests = 0;
    await mockProjectContext(page);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "GET" && url.pathname === "/api/v1/skills/proposals") legacyProposalListRequests += 1;
    });
    await page.route(
      (url) => url.pathname === "/api/v1/skills/proposals/counts"
        && url.searchParams.get("project") === createProposal.projectId,
      (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            open: 1,
            history: 0,
            byStatus: { draft: 0, pending: 1, stale: 0, rejected: 0, applied: 0, rolledBack: 0 },
          },
        }),
      }),
    );
    await page.route(
      (url) => {
        if (url.pathname !== "/api/v1/skills/proposals/page"
          || url.searchParams.get("project") !== createProposal.projectId) return false;
        const view = url.searchParams.get("view");
        const rawLimit = url.searchParams.get("limit");
        const limit = rawLimit === null ? NaN : Number(rawLimit);
        const cursor = url.searchParams.get("cursor");
        return (view === "open" || view === "history")
          && Number.isSafeInteger(limit)
          && limit >= 1
          && limit <= 100
          && (cursor === null || (cursor.length > 0 && cursor.length <= 512));
      },
      (route) => {
        const url = new URL(route.request().url());
        const view = url.searchParams.get("view");
        const limit = Number(url.searchParams.get("limit"));
        const cursor = url.searchParams.get("cursor");
        const data = view === "open" && cursor === null ? [createProposalSummary].slice(0, limit) : [];
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data, pagination: { nextCursor: null, hasMore: false } }),
        });
      },
    );
    await page.route(
      (url) => url.pathname === "/api/v1/skills/proposals/proposal-create"
        && url.searchParams.get("project") === createProposal.projectId,
      (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { ...createProposal, currentSkill: null, observations: [] } }),
      }),
    );
    await page.route(
      (url) => url.pathname === "/api/v1/skills/new-skill",
      (route) => {
        targetFetches += 1;
        return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { message: "not found" } }) });
      },
    );

    await page.goto("/skills", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-proposals").click();
    const card = page.getByRole("button", { name: "Open create proposal for new-skill" });
    await expect(card).toBeVisible();
    await card.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("proposal-overlay")).toBeVisible();
    expect(targetFetches).toBe(0);
    expect(legacyProposalListRequests).toBe(0);
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
    await page.route("**/api/v1/context/sources**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [], total: 0, limit: 20, offset: 0 }),
    }));
    await page.route("**/api/v1/context/conversations**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { data: [], nextCursor: null } }),
    }));

    await page.goto("/context");

    await expect(page.getByRole("heading", { name: "Context", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Context sources", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Conversation index", exact: true })).toBeVisible();
    await expect(page.getByTestId("context-sources-empty")).toBeVisible();
    await expect(page.getByTestId("context-empty")).toBeVisible();
    await expect(page.getByText(/immutable conversation memory/)).toBeVisible();
  });
});

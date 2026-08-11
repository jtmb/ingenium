import { expect, test, type Locator, type Page } from "@playwright/test";

const PROJECT = "responsive-fixture";
const LONG_TOKEN = "responsive-route-long-unbroken-content-".repeat(28);
const ISO = "2026-07-28T12:00:00.000Z";
const MOBILE_VIEWPORT = { width: 390, height: 844 };

/**
 * These route-local responses keep the responsive suite deterministic and
 * read-only: no dashboard request reaches the fixture API's mutable state.
 */
async function mockRouteData(page: Page): Promise<void> {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const response = (data: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data }),
    });

    if (path === "/api/v1/projects") {
      return response([{
        id: "project-1",
        name: PROJECT,
        path: LONG_TOKEN,
        created_at: ISO,
        updated_at: ISO,
        is_global: true,
      }]);
    }
    if (path === "/api/v1/projects/archive") return response([]);
    if (path === `/api/v1/projects/${PROJECT}/detail`) {
      return response({
        skills_count: 1,
        observation_stats: { total: 1, pending: 0, recent: [] },
        pipeline: [],
      });
    }
    if (path === "/api/v1/personality") {
      return response([{
        id: 1,
        project_id: PROJECT,
        trait_type: "communication_style",
        trait_value: LONG_TOKEN,
        display_label: LONG_TOKEN,
        confidence: 0.8,
        source: "fixture",
        is_active: true,
        created_at: ISO,
        updated_at: ISO,
      }]);
    }
    if (path === "/api/v1/observations/stats") return response({ total: 1, pending: 1 });
    if (path === "/api/v1/observations") {
      return response([{
        id: 1,
        project_id: PROJECT,
        observation_type: "pattern",
        content: LONG_TOKEN,
        context: LONG_TOKEN,
        importance: 10,
        status: "pending",
        created_at: ISO,
        updated_at: ISO,
      }]);
    }
    if (path === "/api/v1/logs") {
      return response({
        entries: [{ timestamp: ISO, source: "scheduler", level: "info", message: LONG_TOKEN, data: null }],
        sources: ["scheduler"],
        total: 1,
      });
    }
    if (path === "/api/v1/agents") {
      return response([{
        id: "agent-1",
        name: LONG_TOKEN,
        description: LONG_TOKEN,
        category: "execution",
        mode: "subagent",
        model: LONG_TOKEN,
        content: LONG_TOKEN,
        enabled: true,
        created_at: ISO,
        updated_at: ISO,
      }]);
    }
    if (path === "/api/v1/plugins") {
      return response([{
        id: "plugin-1",
        name: LONG_TOKEN,
        file_path: LONG_TOKEN,
        source_content: LONG_TOKEN,
        enabled: true,
      }]);
    }
    if (path === "/api/v1/backups/schedule") {
      return response({
        hourly: { enabled: true, retention: 24 },
        daily: { enabled: false, retention: 7 },
        manual_retention: 10,
      });
    }
    if (path === "/api/v1/backups") {
      return response([{
        id: "backup-1",
        filename: `${LONG_TOKEN}.sqlite`,
        type: "manual",
        size: 1024,
        status: "completed",
        created_at: ISO,
      }]);
    }

    return response([]);
  });
}

async function openMobileRoute(page: Page, route: string, heading: string): Promise<void> {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await mockRouteData(page);
  await page.goto(`${route}?project=${PROJECT}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
}

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  )).toBe(true);
}

async function expectVisibleInBounds(locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, "expected a visible control bounding box").not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(MOBILE_VIEWPORT.height);
}

test.describe("responsive route regressions at 390x844", () => {
  test("/personality contains long traits while keeping sort and dismissal controls in bounds", async ({ page }) => {
    await openMobileRoute(page, "/personality", "Personality Profile");
    await expect(page.getByText(LONG_TOKEN, { exact: true })).toBeVisible();
    await expectNoDocumentOverflow(page);
    await expectVisibleInBounds(page.getByRole("combobox", { name: "Sort personality traits" }));
    await expectVisibleInBounds(page.getByRole("button", { name: "Dismiss trait" }));
  });

  test("/observations contains long content while keeping filters and card actions in bounds", async ({ page }) => {
    await openMobileRoute(page, "/observations", "Observations");
    await expect(page.getByText(LONG_TOKEN, { exact: true }).first()).toBeVisible();
    await expectNoDocumentOverflow(page);
    await expectVisibleInBounds(page.getByRole("combobox", { name: "Filter observations by status" }));
    await expectVisibleInBounds(page.getByRole("combobox", { name: "Filter observations by type" }));
    await expectVisibleInBounds(page.getByRole("button", { name: "Open", exact: true }));
  });

  test("/logs owns its wide table without widening the document", async ({ page }) => {
    await openMobileRoute(page, "/logs", "System Logs");
    await expect(page.getByText(LONG_TOKEN, { exact: true })).toBeVisible();
    const table = page.getByRole("region", { name: "System logs table" });
    await expect(table).toHaveAttribute("tabindex", "0");
    await expectNoDocumentOverflow(page);
    await expectVisibleInBounds(page.getByRole("button", { name: /LIVE/ }));
  });

  test("/projects wraps long identifiers, actions, and the creation dialog", async ({ page }) => {
    await openMobileRoute(page, "/projects", "Projects");
    await expect(page.getByRole("button", { name: `View details for ${PROJECT}`, exact: true })).toBeVisible();
    await expectNoDocumentOverflow(page);
    const create = page.getByRole("button", { name: "+ New Project", exact: true });
    await expectVisibleInBounds(create);
    await create.click();
    const dialog = page.getByRole("dialog", { name: "New Project" });
    await expect(dialog).toBeVisible();
    await expectNoDocumentOverflow(page);
    await expectVisibleInBounds(dialog.getByRole("button", { name: "Create", exact: true }));
  });

  test("/agents wraps long agent metadata while preserving all touch actions", async ({ page }) => {
    await openMobileRoute(page, "/agents", "Agents");
    await expect(page.getByText(LONG_TOKEN, { exact: true }).first()).toBeVisible();
    await expectNoDocumentOverflow(page);
    await expectVisibleInBounds(page.getByRole("button", { name: "Add Agent" }));
    await expectVisibleInBounds(page.getByRole("button", { name: "Disable" }));
    await expectVisibleInBounds(page.getByRole("button", { name: "Edit" }));
    await expectVisibleInBounds(page.getByRole("button", { name: "Delete" }));
  });

  test("/plugins wraps long plugin metadata while preserving all touch actions", async ({ page }) => {
    await openMobileRoute(page, "/plugins", "Plugins");
    await expect(page.getByText(LONG_TOKEN, { exact: true }).first()).toBeVisible();
    await expectNoDocumentOverflow(page);
    await expectVisibleInBounds(page.getByRole("button", { name: "Add Plugin" }));
    await expectVisibleInBounds(page.getByRole("button", { name: "Edit" }));
    await expectVisibleInBounds(page.getByRole("button", { name: "Enabled" }));
    await expectVisibleInBounds(page.getByRole("button", { name: "Delete" }));
  });

  test("/backups displays its mobile backup card and exposes named schedule switches", async ({ page }) => {
    await openMobileRoute(page, "/backups", "Backups");
    const mobileCard = page.getByTestId("backup-mobile-card-backup-1");
    await expect(mobileCard.getByText(`${LONG_TOKEN}.sqlite`, { exact: true })).toBeVisible();
    await expectNoDocumentOverflow(page);
    await expectVisibleInBounds(page.getByRole("button", { name: "Create Backup Now" }));
    await expectVisibleInBounds(page.getByRole("switch", { name: "Enable hourly backups" }));
    await expectVisibleInBounds(page.getByRole("switch", { name: "Enable daily backups" }));
  });
});

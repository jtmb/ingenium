import { expect, test } from "../ingenium-dashboard/external-suite-navigation-governor";
import type { BrowserContext, Page, Request } from "@playwright/test";
import {
  buildPageSpecificQueryVariants,
  discoverRouteInventory,
  isRetiredDashboardRoute,
  loadProductionArtifactRoutes,
  normalizeRoute,
  routeWithQuery,
  type RouteInventory,
  type SettingsDeepLink,
} from "./route-inventory";
import { productionDashboardRoute } from "./runtime";

const inventory: RouteInventory = discoverRouteInventory();
const retiredRouteExpectation = inventory.canonicalNavigationRoutes.filter(isRetiredDashboardRoute);
const NO_ACCOUNT_SENTINEL = "route-parity-no-account";
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DOCS_SPACES_LIST_URL = /\/api\/v1\/docs\/spaces\/?(?:\?.*)?$/;
const SETTINGS_VIEWPORTS = [
  { name: "desktop", width: 1_440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;
const UNSUPPORTED_SETTINGS_ID = "unsupported-settings-tab";

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

interface ReadOnlyBrowserGuards {
  mutationRequests: string[];
  interceptedDocsSpaceRequests: string[];
  stop: () => void;
}

/**
 * Monitor the whole browser context, not just the main document request. This
 * includes subframes and every request in a redirect chain. A route check that
 * emits a mutation therefore fails even when the mutation is not the final
 * navigation response.
 */
function collectMutatingRequests(context: BrowserContext): { requests: string[]; stop: () => void } {
  const requests: string[] = [];
  const listener = (request: Request) => {
    if (MUTATION_METHODS.has(request.method())) requests.push(`${request.method()} ${request.url()}`);
  };
  context.on("request", listener);
  return { requests, stop: () => context.removeListener("request", listener) };
}

/**
 * Prevent the known state-creating docs list endpoint from reaching the
 * production API. Document-only route checks normally abort before this
 * endpoint can be requested; this fixture is defense in depth for any page
 * that unexpectedly starts the docs client. The response is isolated,
 * deterministic fixture data and never comes from production.
 */
async function installReadOnlyBrowserGuards(
  page: Page,
  context: BrowserContext,
): Promise<ReadOnlyBrowserGuards> {
  const interceptedDocsSpaceRequests: string[] = [];
  await page.route(DOCS_SPACES_LIST_URL, async (route) => {
    const request = route.request();
    interceptedDocsSpaceRequests.push(`${request.method()} ${request.url()}`);
    if (request.method() !== "GET") {
      await route.abort("blockedbyclient");
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [], total: 0 }),
    });
  });

  const requestGuard = collectMutatingRequests(context);
  return {
    mutationRequests: requestGuard.requests,
    interceptedDocsSpaceRequests,
    stop: requestGuard.stop,
  };
}

/**
 * Make route/query checks document-only. Aborting scripts, styles, frames,
 * and XHR/fetch requests both keeps the assertion focused on gateway routing
 * and prevents client effects from touching production APIs. Redirect
 * navigations remain document requests and are therefore still observed.
 */
async function installDocumentOnlyRoute(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "document") {
      await route.fallback();
      return;
    }
    await route.abort("blockedbyclient");
  });
}

/**
 * Assert that the browser performed no mutation and that any docs-space
 * request was handled by the isolated GET-only fixture above.
 */
function assertReadOnlyBrowserGuards(guards: ReadOnlyBrowserGuards, label: string): void {
  expect(guards.mutationRequests, `${label} issued a mutating browser request`).toEqual([]);
  expect(
    guards.interceptedDocsSpaceRequests.filter((request) => !request.startsWith("GET ")),
    `${label} attempted a non-GET docs-space request`,
  ).toEqual([]);
}

async function runReadOnlyBrowserCheck<T>(
  page: Page,
  context: BrowserContext,
  label: string,
  operation: () => Promise<T>,
  options: { documentOnly?: boolean } = {},
): Promise<T> {
  const guards = await installReadOnlyBrowserGuards(page, context);
  if (options.documentOnly) await installDocumentOnlyRoute(page);
  let result: T | undefined;
  let operationError: unknown;
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  } finally {
    guards.stop();
  }

  assertReadOnlyBrowserGuards(guards, label);
  if (operationError) throw operationError;
  return result as T;
}

async function assertGatewayRoute(
  page: Page,
  path: string,
  query: Readonly<Record<string, string>>,
): Promise<void> {
  // Route/query coverage is deliberately a document-level assertion. It does
  // not depend on rendered client state; the docs-space route fixture above
  // keeps the one known state-creating GET off production if client effects do
  // run while the response is being inspected.
  const url = productionDashboardRoute(routeWithQuery(path, query));
  const response = await gotoProductionRoute(page, url);
  expect(response?.status(), `${url} is not served by the production gateway`).toBe(200);
  const body = await page.content();
  expect(body, `${url} returned an application error page`).not.toMatch(
    /Application error: a client-side exception|404: This page could not be found/i,
  );
}

async function gotoProductionRoute(
  page: Page,
  path: string,
): Promise<Awaited<ReturnType<Page["goto"]>>> {
  return page.goto(path, { waitUntil: "domcontentloaded" });
}

async function openSettingsDeepLink(page: Page, tab: string): Promise<void> {
  const path = routeWithQuery("/", { project: "global-default", settings: tab });
  const dialog = page.getByRole("dialog");
  await gotoProductionRoute(page, path);
  await expect(dialog, `settings=${tab} did not open the overlay`).toBeVisible();
}

/**
 * Verify the selected settings category by identity, not just by overlay
 * visibility. This covers the desktop tablist and the mobile category select,
 * then proves that the requested ID controls the visible panel. Route-linked
 * categories must expose their documented same-origin workspace link; compact
 * panels must not accidentally expose another category's link.
 */
async function assertSettingsSelection(
  page: Page,
  deepLink: SettingsDeepLink,
  viewportName: (typeof SETTINGS_VIEWPORTS)[number]["name"],
): Promise<void> {
  const activePanel = page.getByTestId(deepLink.panelTestId);
  await expect(activePanel, `${deepLink.id} did not render its expected panel`).toBeVisible();
  expect(
    await activePanel.evaluate((panel) => !panel.closest("[hidden], [inert]")),
    `${deepLink.id} selected a hidden or inert panel`,
  ).toBe(true);

  const visibleRegisteredPanels = page.locator(
    inventory.settingsDeepLinks
      .map(({ panelTestId }) => `[data-testid="${panelTestId}"]:visible`)
      .join(", "),
  );
  await expect(
    visibleRegisteredPanels,
    `${deepLink.id} did not select exactly one visible panel`,
  ).toHaveCount(1);
  await expect(visibleRegisteredPanels).toHaveAttribute(
    "data-testid",
    deepLink.panelTestId,
  );

  if (viewportName === "desktop") {
    await expect(page.getByRole("tablist", { name: "Settings categories" })).toBeVisible();
    const selectedTab = page.locator('[role="tab"][aria-selected="true"]');
    await expect(selectedTab).toHaveCount(1);
    await expect(selectedTab).toHaveText(deepLink.label);
  } else {
    await expect(page.getByRole("tablist", { name: "Settings categories" })).toBeHidden();
    await expect(page.getByRole("combobox", { name: "Settings category" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Settings category" })).toHaveValue(deepLink.id);
  }

  const visibleRouteLinks = page.locator('[data-testid^="settings-route-link-"]:visible');
  if (deepLink.routeLink) {
    await expect(visibleRouteLinks, `${deepLink.id} did not select exactly one workspace link`).toHaveCount(1);
    const link = page.getByTestId(deepLink.routeLink.testId);
    await expect(link, `${deepLink.id} did not render its expected workspace link`).toBeVisible();
    await expect(link).toHaveAttribute("href", deepLink.routeLink.destination);

    const href = await link.getAttribute("href");
    if (!href) throw new Error(`Expected a href for settings=${deepLink.id}`);
    const actualTarget = new URL(href, page.url());
    const expectedTarget = new URL(productionDashboardRoute(deepLink.routeLink.destination));
    expect(actualTarget.origin, `${deepLink.id} link escaped the dashboard origin`).toBe(expectedTarget.origin);
    expect(actualTarget.pathname, `${deepLink.id} link target drifted`).toBe(expectedTarget.pathname);
    expect(actualTarget.search, `${deepLink.id} link query drifted`).toBe(expectedTarget.search);
  } else {
    await expect(visibleRouteLinks, `${deepLink.id} unexpectedly exposed a route-linked panel`).toHaveCount(0);
  }
}

async function openSettingsCompatibilityRoute(page: Page): Promise<void> {
  const path = routeWithQuery("/settings", { project: "global-default" });
  const dialog = page.getByRole("dialog");
  await gotoProductionRoute(page, path);
  await expect
    .poll(
      () => new URL(page.url()).searchParams.get("settings"),
      {
        timeout: 15_000,
        message: "settings compatibility redirect did not reach settings=general",
      },
    )
    .toBe("general");
  await expect(dialog).toBeVisible();
}

test.describe("Production dashboard route parity", () => {
  test("derives the complete primary navigation and rejects retired page routes", () => {
    expect(inventory.canonicalNavigationRoutes).toContain("/");
    expect(inventory.canonicalNavigationRoutes).toContain("/secrets");
    expect(inventory.canonicalNavigationRoutes).toContain("/mcp-servers");
    expect(inventory.canonicalNavigationRoutes).toContain("/usage");
    expect(inventory.canonicalNavigationRoutes).toContain("/vscode");
    expect(retiredRouteExpectation).toEqual([]);
    expect(sorted(inventory.canonicalNavigationRoutes)).toHaveLength(24);
  });

  test("uses the explicit 14-ID settings deep-link inventory", () => {
    expect(inventory.settingsDeepLinks.map(({ id }) => id)).toEqual([
      "general",
      "projects",
      "skills",
      "tasks",
      "jobs",
      "plugins",
      "mail",
      "agents",
      "mcp-servers",
      "config",
      "observations",
      "personality",
      "providers",
      "logs",
    ]);
    expect(inventory.settingsDeepLinks).toHaveLength(14);
    expect(inventory.settingsDeepLinks.map(({ panelTestId }) => panelTestId)).toEqual(
      inventory.settingsDeepLinks.map(({ id }) => `settings-panel-${id}`),
    );
    expect(inventory.settingsDeepLinks.some(({ id }) => id === "destination" || id === "description")).toBe(false);
    expect(inventory.supportedSettingsTabs).toEqual(inventory.settingsDeepLinks.map(({ id }) => id));
  });

  test("the production artifact contains every derived primary navigation route", () => {
    const artifact = loadProductionArtifactRoutes();
    const missing = inventory.canonicalNavigationRoutes.filter((route) => !artifact.routes.has(route));
    expect(missing, `Routes missing from ${artifact.directory}`).toEqual([]);
    expect([...artifact.routes].filter(isRetiredDashboardRoute), "Production artifact contains retired page routes").toEqual([]);
  });

  test("the rendered navigation has no missing or stale page targets", async ({ page, context }) => {
    await runReadOnlyBrowserCheck(page, context, "navigation and route inspection", async () => {
      await gotoProductionRoute(page, routeWithQuery("/", { project: "global-default" }));
      await expect(page.locator("#nav-sidebar")).toBeVisible();

      const hrefs = await page.locator("#nav-sidebar a[href]").evaluateAll((links) =>
        links
          .map((link) => (link as HTMLAnchorElement).getAttribute("href"))
          .filter((href): href is string => Boolean(href)),
      );
      const renderedRoutes = hrefs
        .map((href) => normalizeRoute(new URL(href, page.url()).pathname))
        .filter((route): route is string => route !== null);

      expect(sorted(renderedRoutes), "Rendered navigation drifted from source navigation").toEqual(
        sorted(inventory.canonicalNavigationRoutes),
      );

      const artifact = loadProductionArtifactRoutes();
      await installDocumentOnlyRoute(page);
      for (const route of inventory.canonicalNavigationRoutes) {
        expect(artifact.routes.has(route), `${route} is absent from the production artifact`).toBe(true);
        await assertGatewayRoute(page, route, { project: "global-default" });
      }
    });
  });

  for (const route of inventory.canonicalNavigationRoutes) {
    test(`smoke renders canonical route ${route}`, async ({ page, context }) => {
      await runReadOnlyBrowserCheck(page, context, `canonical route ${route}`, async () => {
        await assertGatewayRoute(page, route, { project: "global-default" });
      }, { documentOnly: true });
    });
  }

  test("covers every supported project/settings query variant through the gateway", async ({ page, context }) => {
    await runReadOnlyBrowserCheck(page, context, "project and settings query variants", async () => {
      for (const variant of inventory.queryVariants) {
        await assertGatewayRoute(page, variant.path, variant.query);
      }
    }, { documentOnly: true });
  });

  test("covers safe page-specific and standalone query variants", async ({ page, context }) => {
    // Do not discover IDs from production. In particular, GET /docs/spaces
    // creates Personal on an empty workspace. Numeric sentinels keep these
    // URL-shape checks isolated and route-only while retaining coverage.
    const variants = buildPageSpecificQueryVariants({
      docsSpaceId: "0",
      docsPageId: "0",
      mailAccount: NO_ACCOUNT_SENTINEL,
    });
    expect(variants, "page-specific query inventory must not be empty").not.toEqual([]);

    await runReadOnlyBrowserCheck(page, context, "page-specific and standalone query variants", async () => {
      for (const variant of variants) {
        expect(isRetiredDashboardRoute(variant.path), `${variant.name} uses a retired route`).toBe(false);
        await assertGatewayRoute(page, variant.path, variant.query);
      }
    }, { documentOnly: true });
  });

  for (const viewport of SETTINGS_VIEWPORTS) {
    for (const deepLink of inventory.settingsDeepLinks) {
      test(`selects settings=${deepLink.id} at ${viewport.name}`, async ({ page, context }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await runReadOnlyBrowserCheck(page, context, `settings=${deepLink.id} at ${viewport.name}`, async () => {
          await openSettingsDeepLink(page, deepLink.id);
          await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
          const url = new URL(page.url());
          expect(url.searchParams.get("settings")).toBe(deepLink.id);
          expect(url.searchParams.get("project")).toBe("global-default");
          await assertSettingsSelection(page, deepLink, viewport.name);
        });
      });
    }
  }

  for (const viewport of SETTINGS_VIEWPORTS) {
    test(`falls back to General for unsupported settings IDs at ${viewport.name}`, async ({ page, context }) => {
      const general = inventory.settingsDeepLinks.find(({ id }) => id === "general");
      if (!general) throw new Error("The explicit settings inventory is missing the general fallback");

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await runReadOnlyBrowserCheck(page, context, `unsupported settings ID at ${viewport.name}`, async () => {
        await openSettingsDeepLink(page, UNSUPPORTED_SETTINGS_ID);
        await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
        await assertSettingsSelection(page, general, viewport.name);
        // Invalid IDs open the overlay but are not rewritten by the client;
        // retaining the request also keeps this assertion non-mutating.
        expect(new URL(page.url()).searchParams.get("settings")).toBe(UNSUPPORTED_SETTINGS_ID);
      });
    });
  }

  test("keeps the direct settings compatibility route on the supported redirect path", async ({ page, context }) => {
    await runReadOnlyBrowserCheck(page, context, "settings compatibility redirect", async () => {
      await openSettingsCompatibilityRoute(page);
    });
  });

  test("does not introduce stale dashboard route expectations into this suite", () => {
    const suiteRoutes = [
      ...inventory.canonicalNavigationRoutes,
      ...inventory.compatibilityRoutes,
      ...inventory.queryVariants.map((variant) => variant.path),
      ...buildPageSpecificQueryVariants({
        docsSpaceId: "0",
        docsPageId: "0",
        mailAccount: NO_ACCOUNT_SENTINEL,
      }).map((variant) => variant.path),
    ];
    expect(suiteRoutes.filter(isRetiredDashboardRoute)).toEqual([]);
  });
});

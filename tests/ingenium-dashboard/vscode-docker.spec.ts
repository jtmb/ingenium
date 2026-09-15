import { expect, test } from "./external-suite-navigation-governor";
import type { BrowserContext, ConsoleMessage, Page, Request, Response } from "@playwright/test";
import {
  assertCollectorCanDetach,
  isDashboardVscodeRscNavigationAbort,
  toleratedConsoleFailure,
  toleratedDashboardVscodeRscNavigationAbort,
  toleratedRequestFailure,
  toleratedResponseFailure,
  type ToleratedRequestFailure,
  type ToleratedResponseFailure,
  type ToleratedConsoleFailure,
} from "./vscode-docker-failure-policy";

const VSCODE_ORIGIN = "http://vscode.localhost:3000";
const VSCODE_URL = `${VSCODE_ORIGIN}/`;
const VSCODE_WORKBENCH_URL = `${VSCODE_ORIGIN}/?folder=/workspace`;
const DASHBOARD_ORIGIN = new URL(process.env.INGENIUM_E2E_DASHBOARD_URL ?? "http://localhost:3000").origin;

interface RuntimeRequestFailure {
  scope: string;
  observedAt: number;
  kind: "http" | "requestfailed";
  url: string;
  resourceType: string;
  reason: string;
  errorText?: string;
  status?: number;
  method?: string;
  responseStatus?: number;
  nextRouterPrefetch?: string;
}

interface ToleratedRequest {
  scope: string;
  observedAt: number;
  url: string;
  resourceType: string;
  errorText: string;
  reason: ToleratedRequestFailure;
  responseStatus?: number;
  nextRouterPrefetch?: string;
  destinationReadyAt?: number;
}

interface ToleratedResponse {
  scope: string;
  observedAt: number;
  url: string;
  resourceType: string;
  status: number;
  reason: ToleratedResponseFailure;
}

interface ToleratedConsole {
  scope: string;
  observedAt: number;
  message: string;
  locationUrl: string;
  reason: ToleratedConsoleFailure;
}

interface RuntimeConsoleFailure {
  scope: string;
  observedAt: number;
  kind: "console" | "pageerror";
  message: string;
  locationUrl?: string;
}

interface RuntimeFailureCollector {
  assertSteadyState(): void;
  detach(): void;
  wasSteadyStateAsserted(): boolean;
  expectDashboardVscodeNavigation(): void;
  markDashboardVscodeDestinationReady(): void;
}

function collectRuntimeFailures(page: Page, scope: string): RuntimeFailureCollector {
  const toleratedRequests: ToleratedRequest[] = [];
  const toleratedResponses: ToleratedResponse[] = [];
  const toleratedConsoleFailures: ToleratedConsole[] = [];
  const responseStatuses = new WeakMap<Request, number>();
  const responseStatusesByUrl = new Map<string, number>();
  const unexpectedConsoleFailures: RuntimeConsoleFailure[] = [];
  const unexpectedRequestFailures: RuntimeRequestFailure[] = [];
  const deferredDashboardVscodeNavigationAborts: Array<{ request: Request; observedAt: number; errorText: string }> = [];
  let attached = true;
  let steadyStateAsserted = false;
  let dashboardVscodeNavigationExpected = false;
  let dashboardVscodeDestinationReadyAt: number | undefined;
  const dashboardOrigin = DASHBOARD_ORIGIN;

  const observedAt = (): number => Date.now();
  const diagnostic = (): string => JSON.stringify({
    scope,
    toleratedRequests,
    toleratedResponses,
    toleratedConsoleFailures,
    unexpectedConsoleFailures,
    unexpectedRequestFailures,
  }, null, 2);

  const isFirstParty = (url: string): boolean => {
    try {
      const origin = new URL(url).origin;
      return origin === dashboardOrigin || origin === VSCODE_ORIGIN;
    } catch {
      return false;
    }
  };

  const onConsole = (message: ConsoleMessage): void => {
    if (message.type() !== "error") return;
    const locationUrl = message.location().url;
    const reason = toleratedConsoleFailure({
      type: message.type(),
      text: message.text(),
      locationUrl,
      responseStatus: responseStatusesByUrl.get(locationUrl),
    }, VSCODE_ORIGIN);
    if (reason) {
      toleratedConsoleFailures.push({
        scope,
        observedAt: observedAt(),
        message: message.text(),
        locationUrl,
        reason,
      });
      return;
    }
    unexpectedConsoleFailures.push({
      scope,
      observedAt: observedAt(),
      kind: "console",
      message: message.text(),
      locationUrl,
    });
  };
  const onPageError = (error: Error): void => {
    unexpectedConsoleFailures.push({
      scope,
      observedAt: observedAt(),
      kind: "pageerror",
      message: error.message,
    });
  };
  const onResponse = (response: Response): void => {
    if (!isFirstParty(response.url())) return;
    const at = observedAt();
    responseStatuses.set(response.request(), response.status());
    responseStatusesByUrl.set(response.url(), response.status());
    if (response.status() < 400) return;

    const reason = toleratedResponseFailure({ url: response.url(), status: response.status() }, VSCODE_ORIGIN);
    if (reason) {
      toleratedResponses.push({
        scope,
        observedAt: at,
        url: response.url(),
        resourceType: response.request().resourceType(),
        status: response.status(),
        reason,
      });
      return;
    }
    unexpectedRequestFailures.push({
      scope,
      observedAt: at,
      kind: "http",
      url: response.url(),
      resourceType: response.request().resourceType(),
      reason: "http-status",
      status: response.status(),
    });
  };
  const onRequestFailed = (request: Request): void => {
    if (!isFirstParty(request.url())) return;
    const at = observedAt();
    const errorText = request.failure()?.errorText ?? "unknown request failure";
    const reason = toleratedRequestFailure({
      url: request.url(),
      errorText,
      responseStatus: responseStatuses.get(request),
      method: request.method(),
      headers: request.headers(),
    }, VSCODE_ORIGIN, dashboardOrigin);
    if (reason) {
      toleratedRequests.push({
        scope,
        observedAt: at,
        url: request.url(),
        resourceType: request.resourceType(),
        errorText,
        reason,
      });
      return;
    }
    if (dashboardVscodeNavigationExpected && isDashboardVscodeRscNavigationAbort({
      url: request.url(),
      errorText,
      responseStatus: responseStatuses.get(request),
      method: request.method(),
    }, dashboardOrigin)) {
      deferredDashboardVscodeNavigationAborts.push({ request, observedAt: at, errorText });
      return;
    }
    unexpectedRequestFailures.push({
      scope,
      observedAt: at,
      kind: "requestfailed",
      url: request.url(),
      resourceType: request.resourceType(),
      reason: "requestfailed",
      errorText,
      method: request.method(),
      responseStatus: responseStatuses.get(request),
      nextRouterPrefetch: request.headers()["next-router-prefetch"],
    });
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);

  return {
    assertSteadyState(): void {
      for (const deferred of deferredDashboardVscodeNavigationAborts) {
        const responseStatus = responseStatuses.get(deferred.request);
        const reason = toleratedDashboardVscodeRscNavigationAbort({
          url: deferred.request.url(),
          errorText: deferred.errorText,
          responseStatus,
          method: deferred.request.method(),
        }, dashboardOrigin, dashboardVscodeDestinationReadyAt !== undefined);
        if (reason) {
          toleratedRequests.push({
            scope,
            observedAt: deferred.observedAt,
            url: deferred.request.url(),
            resourceType: deferred.request.resourceType(),
            errorText: deferred.errorText,
            responseStatus,
            nextRouterPrefetch: deferred.request.headers()["next-router-prefetch"],
            destinationReadyAt: dashboardVscodeDestinationReadyAt,
            reason,
          });
          continue;
        }
        unexpectedRequestFailures.push({
          scope,
          observedAt: deferred.observedAt,
          kind: "requestfailed",
          url: deferred.request.url(),
          resourceType: deferred.request.resourceType(),
          reason: "requestfailed",
          errorText: deferred.errorText,
          method: deferred.request.method(),
          responseStatus,
          nextRouterPrefetch: deferred.request.headers()["next-router-prefetch"],
        });
      }
      expect([
        ...unexpectedConsoleFailures,
        ...unexpectedRequestFailures,
      ], diagnostic()).toEqual([]);
      steadyStateAsserted = true;
    },
    detach(): void {
      assertCollectorCanDetach(steadyStateAsserted);
      if (!attached) return;
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("response", onResponse);
      page.off("requestfailed", onRequestFailed);
      attached = false;
    },
    wasSteadyStateAsserted(): boolean {
      return steadyStateAsserted;
    },
    expectDashboardVscodeNavigation(): void {
      dashboardVscodeNavigationExpected = true;
    },
    markDashboardVscodeDestinationReady(): void {
      if (!dashboardVscodeNavigationExpected) {
        throw new Error("VS Code destination readiness must follow the sidebar navigation action");
      }
      dashboardVscodeDestinationReadyAt = observedAt();
    },
  };
}

async function withFreshPage(
  context: BrowserContext,
  scope: string,
  action: (page: Page, failures: RuntimeFailureCollector) => Promise<void>,
): Promise<void> {
  const page = await context.newPage();
  const failures = collectRuntimeFailures(page, scope);
  try {
    await action(page, failures);
    failures.assertSteadyState();
  } finally {
    if (failures.wasSteadyStateAsserted()) failures.detach();
    await page.close();
  }
}

async function waitForRunningVSCodeProcess(page: Page): Promise<void> {
  await page.waitForResponse(async (response) => {
    if (new URL(response.url()).pathname !== "/api/v1/services/status" || !response.ok()) return false;
    const body = await response.json().catch(() => null) as { data?: { services?: unknown } } | null;
    return Array.isArray(body?.data?.services)
      && body.data.services.some((service) => (
        typeof service === "object"
        && service !== null
        && (service as { name?: unknown; state?: unknown }).name === "VS Code"
        && (service as { state?: unknown }).state === "running"
      ));
  }, { timeout: 30_000 });
}

async function expectWorkbenchReady(page: Page): Promise<void> {
  await expect.poll(async () => {
    const frame = page.frames().find((candidate) => candidate.url().startsWith(VSCODE_ORIGIN));
    if (!frame) return false;
    if (frame.url() !== VSCODE_WORKBENCH_URL) return false;
    return frame.locator(".monaco-workbench[role='application']").isVisible().catch(() => false);
  }, { timeout: 30_000 }).toBe(true);
}

async function expectWorkerIframeLoaded(page: Page): Promise<void> {
  await expect.poll(() => {
    const frameUrls = page.frames().map((frame) => frame.url());
    return frameUrls.some((url) => (
      url.startsWith(VSCODE_ORIGIN)
      && url.includes("/webWorkerExtensionHostIframe.html")
    )) && !frameUrls.some((url) => url.startsWith("chrome-error://"));
  }, { timeout: 30_000 }).toBe(true);
}

async function expectLiveWorkbench(page: Page): Promise<void> {
  await expect(page.locator('iframe[title="VS Code"]')).toBeVisible({ timeout: 30_000 });
  await expectWorkbenchReady(page);
  await expectWorkerIframeLoaded(page);
}

function isDashboardVscodeRscResponse(response: Response, dashboardOrigin: string): boolean {
  try {
    const url = new URL(response.url());
    const parameters = [...url.searchParams.entries()];
    return url.origin === dashboardOrigin
      && url.pathname === "/vscode"
      && parameters.length === 1
      && parameters[0]?.[0] === "_rsc"
      && response.request().method() === "GET";
  } catch {
    return false;
  }
}

test("VS Code Docker workspace exposes the trusted live workbench without mutating it", async ({ page }) => {
  const context = page.context();
  try {
    await withFreshPage(context, "wrapper", async (wrapperPage) => {
      const processReady = waitForRunningVSCodeProcess(wrapperPage);
      await wrapperPage.goto("/vscode", { waitUntil: "domcontentloaded" });
      await processReady;

      const frame = wrapperPage.locator('iframe[title="VS Code"]');
      await expect(frame).toHaveAttribute("src", VSCODE_URL);
      await expect(frame).toHaveAttribute("allow", "clipboard-write");
      await expect(frame).toHaveAttribute("loading", "eager");
      await expect(frame).not.toHaveAttribute("sandbox");
      await expect(wrapperPage.getByRole("heading", { name: "VS Code" })).toBeVisible();
      await expect(wrapperPage.getByRole("link", { name: "Open directly" })).toHaveAttribute("href", VSCODE_URL);
      await expect(wrapperPage.getByRole("link", { name: "Open directly" })).toHaveAttribute("target", "_blank");
      await expect(wrapperPage.getByRole("link", { name: "Open directly" })).toHaveAttribute("rel", "noopener noreferrer");
      await expect(wrapperPage.getByRole("button", { name: "Pop out to standalone window" })).toBeVisible();
      await expect(wrapperPage.getByRole("alert").filter({ hasText: "VS Code is unavailable on this connection" })).toHaveCount(0);
      await expectLiveWorkbench(wrapperPage);
    });

    await withFreshPage(context, "sidebar navigation", async (sidebarPage, failures) => {
      const processReady = waitForRunningVSCodeProcess(sidebarPage);
      await sidebarPage.goto("/", { waitUntil: "domcontentloaded" });
      await expect(sidebarPage).not.toHaveURL(/\/vscode$/);
      const workspaceLink = sidebarPage.locator("#nav-sidebar").getByRole("link", { name: "VS Code" });
      await expect(workspaceLink).toBeVisible();
      failures.expectDashboardVscodeNavigation();
      const routeTransition = sidebarPage.waitForResponse(
        (response) => isDashboardVscodeRscResponse(response, DASHBOARD_ORIGIN),
        { timeout: 5_000 },
      ).catch(() => undefined);
      await workspaceLink.click();
      await processReady;
      await expect(sidebarPage).toHaveURL(/\/vscode$/);
      await expectLiveWorkbench(sidebarPage);
      const transitionResponse = await routeTransition;
      if (transitionResponse) {
        expect(transitionResponse.status(), "sidebar VS Code RSC transition did not succeed").toBeGreaterThanOrEqual(200);
        expect(transitionResponse.status(), "sidebar VS Code RSC transition did not succeed").toBeLessThanOrEqual(299);
      }
      failures.markDashboardVscodeDestinationReady();
    });

    await withFreshPage(context, "mobile wrapper", async (mobilePage) => {
      const processReady = waitForRunningVSCodeProcess(mobilePage);
      await mobilePage.setViewportSize({ width: 390, height: 844 });
      await mobilePage.goto("/vscode", { waitUntil: "domcontentloaded" });
      await processReady;
      await expectLiveWorkbench(mobilePage);
      await expect(mobilePage.getByRole("link", { name: "Open directly" })).toBeVisible();
      await expect(mobilePage.getByRole("button", { name: "Pop out to standalone window" })).toBeVisible();
      await expect.poll(() => mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    await withFreshPage(context, "standalone wrapper", async (standalonePage) => {
      const processReady = waitForRunningVSCodeProcess(standalonePage);
      await standalonePage.goto("/standalone?page=vscode&standalone=1", { waitUntil: "domcontentloaded" });
      await processReady;
      await expect(standalonePage.getByRole("heading", { name: "VS Code", exact: true })).toBeVisible();
      const frame = standalonePage.locator('iframe[title="VS Code"]');
      await expect(frame).toHaveAttribute("src", VSCODE_URL);
      await expect(frame).not.toHaveAttribute("sandbox");
      await expectLiveWorkbench(standalonePage);
    });

    await withFreshPage(context, "direct VS Code origin", async (directPage) => {
      await directPage.goto(VSCODE_WORKBENCH_URL, { waitUntil: "domcontentloaded" });
      await expect(directPage).toHaveURL(VSCODE_WORKBENCH_URL);
      await expectWorkbenchReady(directPage);
      await expectWorkerIframeLoaded(directPage);
    });
  } finally {
    await page.close();
  }
});

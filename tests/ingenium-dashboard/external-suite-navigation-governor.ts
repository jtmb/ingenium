import { setTimeout as delay } from "node:timers/promises";
import {
  expect,
  test as base,
  type BrowserContext,
  type Response,
  type Route,
} from "@playwright/test";

export const GATEWAY_REQUESTS_PER_SECOND = 30;
export const GATEWAY_BURST_REQUESTS = 60;
// Retained external traces observed at most 11 dynamic dashboard requests for
// one route transition. Reserve one request of headroom for a new transition.
export const OBSERVED_DYNAMIC_DASHBOARD_REQUESTS_PER_ROUTE = 11;
export const CONSERVATIVE_DASHBOARD_REQUESTS_PER_PAGE =
  OBSERVED_DYNAMIC_DASHBOARD_REQUESTS_PER_ROUTE + 1;
export const DASHBOARD_NAVIGATION_INTERVAL_MS = Math.ceil(
  (1_000 * CONSERVATIVE_DASHBOARD_REQUESTS_PER_PAGE) / GATEWAY_REQUESTS_PER_SECOND,
);
export const GATEWAY_FULL_BUCKET_DRAIN_MS = Math.ceil(
  (1_000 * GATEWAY_BURST_REQUESTS) / GATEWAY_REQUESTS_PER_SECOND,
);
export const API_FIXED_WINDOW_MS = 60_000;
export const API_FIXED_WINDOW_REQUEST_LIMIT = 100;
// The latest retained Docker chat trace has 12 logical read dispatches in one
// 758ms scenario. Seven reach the API: projects (3), permissions (2), and
// questions (2); the four session reads and one chat-config read are mocked.
export const OBSERVED_DOCKER_LOGICAL_READS_PER_TEST = 12;
export const OBSERVED_DOCKER_DIRECT_API_READS_PER_TEST = 7;
export const DOCKER_API_PREFLIGHT_READS = 2;
export const ROUTE_PARITY_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS = 3_000;
export const DOCKER_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS = 6_000;
export const DOCKER_TESTS_PER_API_WINDOW = Math.floor(
  API_FIXED_WINDOW_MS / DOCKER_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS,
);
export const DOCKER_API_READS_PER_WINDOW =
  (DOCKER_TESTS_PER_API_WINDOW * OBSERVED_DOCKER_DIRECT_API_READS_PER_TEST)
  + DOCKER_API_PREFLIGHT_READS;
export const DOCKER_API_HEADROOM_PER_WINDOW =
  API_FIXED_WINDOW_REQUEST_LIMIT - DOCKER_API_READS_PER_WINDOW;
// Keep the established route-parity cadence as the default for configurations
// that do not explicitly opt into Docker's larger fixed-window budget.
export const EXTERNAL_SUITE_TRANSITION_INTERVAL_MS =
  ROUTE_PARITY_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS;
export const EXTERNAL_SUITE_TRANSITION_INTERVAL_METADATA_KEY =
  "externalSuiteTransitionIntervalMs";
export const API_RETRY_AFTER_MAX_MS = 10_000;
export const API_RETRY_CLOCK_TICK_MS = 1;

export interface GovernorClock {
  now: () => number;
  sleep: (milliseconds: number) => Promise<unknown>;
}

const realClock: GovernorClock = { now: Date.now, sleep: delay };

/** Read the per-suite transition interval from Playwright project metadata. */
export function externalSuiteTransitionInterval(
  metadata: Readonly<Record<string, unknown>> | undefined,
): number {
  const configured = metadata?.[EXTERNAL_SUITE_TRANSITION_INTERVAL_METADATA_KEY];
  if (configured === undefined) return EXTERNAL_SUITE_TRANSITION_INTERVAL_MS;
  if (!Number.isSafeInteger(configured) || configured <= 0) {
    throw new Error(`${EXTERNAL_SUITE_TRANSITION_INTERVAL_METADATA_KEY} must be a positive integer`);
  }
  return configured;
}

interface StartupRateLimitResponse {
  status: number;
  headers: { get(name: string): string | null };
}

/**
 * A suite may arrive while the prior external run's API window is still open.
 * Recover that startup probe once, but never extend browser-request recovery
 * beyond its separate 10-second bound.
 */
export async function retryExternalSuiteStartupApiPreflight<ResponseType extends StartupRateLimitResponse>(
  request: () => Promise<ResponseType>,
  clock: GovernorClock = realClock,
): Promise<ResponseType> {
  const initial = await request();
  if (initial.status !== 429) return initial;

  const retryAfter = parseBoundedRetryAfter(
    initial.headers.get("retry-after"),
    clock.now(),
    API_FIXED_WINDOW_MS,
  );
  if ("reason" in retryAfter) return initial;

  await clock.sleep(retryAfter.milliseconds + API_RETRY_CLOCK_TICK_MS);
  return request();
}

/** Wait for the gateway's entire 60-request burst to decay at 30r/s. */
export async function drainGatewayRequestBucket(clock: GovernorClock = realClock): Promise<void> {
  await clock.sleep(GATEWAY_FULL_BUCKET_DRAIN_MS);
}

/** Pace external test transitions below the configured API fixed-window budget. */
export async function paceExternalSuiteTransition(
  clock: GovernorClock = realClock,
  intervalMs = EXTERNAL_SUITE_TRANSITION_INTERVAL_MS,
): Promise<void> {
  await clock.sleep(intervalMs);
}

/** Serialize dashboard document dispatches without retrying a failed request. */
export class DashboardNavigationGovernor {
  private nextNavigationAt = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly intervalMs = DASHBOARD_NAVIGATION_INTERVAL_MS,
    private readonly clock: GovernorClock = realClock,
  ) {}

  private async serialize(callback: () => Promise<void>): Promise<void> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;

    try {
      await callback();
    } finally {
      release();
    }
  }

  /** Drain between external test transitions instead of retrying a 429. */
  async beforeSuiteTransition(intervalMs = EXTERNAL_SUITE_TRANSITION_INTERVAL_MS): Promise<void> {
    await this.serialize(async () => {
      await paceExternalSuiteTransition(this.clock, intervalMs);
      this.nextNavigationAt = this.clock.now();
    });
  }

  async beforeNavigation(): Promise<void> {
    await this.serialize(async () => {
      const waitMilliseconds = this.nextNavigationAt - this.clock.now();
      if (waitMilliseconds > 0) await this.clock.sleep(waitMilliseconds);
      this.nextNavigationAt = this.clock.now() + this.intervalMs;
    });
  }
}

export function isDashboardDocumentNavigation(
  url: string,
  resourceType: string,
  dashboardOrigin: string,
): boolean {
  if (resourceType !== "document") return false;
  try {
    return new URL(url).origin === dashboardOrigin;
  } catch {
    return false;
  }
}

export type RateLimitSource = "api-fixed-window" | "nginx-gateway" | "unknown";
export type RateLimitBodyKind = "api-rate-limited-json" | "nginx-html" | "other-json" | "other-text" | "unavailable";

export interface RateLimitObservation {
  observedAt: string;
  resourceType: string;
  url: string;
  retryAfter: string | null;
  server: string | null;
  source: RateLimitSource;
  bodyKind: RateLimitBodyKind;
  outcome: "recovered" | "fatal";
  attempt: 1 | 2;
  waitMilliseconds?: number;
  reason?: "missing-retry-after" | "invalid-retry-after" | "excessive-retry-after" | "second-429";
}

interface RetryAfterDelay {
  milliseconds: number;
  kind: "delay-seconds" | "http-date";
}

interface RetryAfterFailure {
  reason: "missing-retry-after" | "invalid-retry-after" | "excessive-retry-after";
}

interface RateLimitResponse {
  status(): number;
  headers(): Record<string, string>;
  text(): Promise<string>;
}

interface RecoverableRequest {
  url(): string;
  method(): string;
  resourceType?: () => string;
  headers?: () => Readonly<Record<string, string>>;
  postDataBuffer?: () => unknown;
}

interface RecoverableRoute<ResponseType extends RateLimitResponse> {
  request(): RecoverableRequest;
  fetch(options?: { maxRetries?: number }): Promise<ResponseType>;
  fulfill(options: { response: ResponseType }): Promise<void>;
}

function recoverablePlaywrightRoute(
  route: Route,
): RecoverableRoute<Awaited<ReturnType<Route["fetch"]>>> {
  return {
    request: () => route.request(),
    fetch: (options) => route.fetch(options),
    fulfill: (options) => route.fulfill(options),
  };
}

function fulfillRouteOnce<ResponseType extends RateLimitResponse>(
  route: RecoverableRoute<ResponseType>,
): (response: ResponseType) => Promise<void> {
  let fulfilled = false;
  return async (response: ResponseType): Promise<void> => {
    if (fulfilled) return;
    fulfilled = true;
    await route.fulfill({ response });
  };
}

const HTTP_DATE = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4})$/;

function header(headers: Readonly<Record<string, string>>, name: string): string | null {
  const matched = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return matched?.[1]?.trim() || null;
}

function bodyKind(body: string | undefined): RateLimitBodyKind {
  if (body === undefined) return "unavailable";
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown } };
    return parsed.error?.code === "RATE_LIMITED" ? "api-rate-limited-json" : "other-json";
  } catch {
    return /<html|<center|nginx/i.test(body) ? "nginx-html" : "other-text";
  }
}

/** Classify a 429 without retaining its potentially sensitive response body. */
export function classifyRateLimitResponse(
  headers: Readonly<Record<string, string>>,
  body: string | undefined,
): Pick<RateLimitObservation, "retryAfter" | "server" | "source" | "bodyKind"> {
  const retryAfter = header(headers, "retry-after");
  const server = header(headers, "server");
  const classifiedBody = bodyKind(body);
  const source: RateLimitSource = classifiedBody === "api-rate-limited-json" || retryAfter !== null
    ? "api-fixed-window"
    : classifiedBody === "nginx-html" || server?.toLowerCase().includes("nginx")
      ? "nginx-gateway"
      : "unknown";
  return { retryAfter, server, source, bodyKind: classifiedBody };
}

/** Parse an RFC Retry-After delay-seconds or HTTP-date value within the replay bound. */
export function parseBoundedRetryAfter(
  value: string | null,
  now: number,
  maximumMilliseconds = API_RETRY_AFTER_MAX_MS,
): RetryAfterDelay | RetryAfterFailure {
  if (!value) return { reason: "missing-retry-after" };

  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized);
    if (!Number.isSafeInteger(seconds)) return { reason: "invalid-retry-after" };
    const milliseconds = seconds * 1_000;
    if (!Number.isSafeInteger(milliseconds)) return { reason: "invalid-retry-after" };
    return milliseconds <= maximumMilliseconds
      ? { milliseconds, kind: "delay-seconds" }
      : { reason: "excessive-retry-after" };
  }

  if (!HTTP_DATE.test(normalized)) return { reason: "invalid-retry-after" };
  const retryAt = Date.parse(normalized);
  if (Number.isNaN(retryAt)) return { reason: "invalid-retry-after" };
  const milliseconds = Math.max(0, retryAt - now);
  return milliseconds <= maximumMilliseconds
    ? { milliseconds, kind: "http-date" }
    : { reason: "excessive-retry-after" };
}

/** True only for a same-origin, bodyless API read; RSC and mutations never replay. */
export function isRecoverableExternalApiRead(
  request: RecoverableRequest,
  dashboardOrigin: string,
): boolean {
  if (request.method() !== "GET" && request.method() !== "HEAD") return false;
  const body = request.postDataBuffer?.();
  if (body !== null && body !== undefined) return false;
  if (header(request.headers?.() ?? {}, "accept")?.toLowerCase().includes("text/event-stream")) return false;
  try {
    const url = new URL(request.url());
    return url.origin === dashboardOrigin
      && url.pathname.startsWith("/api/v1/")
      && !url.searchParams.has("_rsc");
  } catch {
    return false;
  }
}

export function isExternalSuiteRateLimitRecoveryEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.RUN_DASHBOARD_DOCKER === "1" || environment.RUN_DASHBOARD_ROUTE_PARITY === "1";
}

async function observeRateLimit(
  response: RateLimitResponse,
  request: RecoverableRequest,
  clock: GovernorClock,
  details: Omit<RateLimitObservation, "observedAt" | "resourceType" | "url" | "retryAfter" | "server" | "source" | "bodyKind">,
): Promise<RateLimitObservation> {
  let responseBody: string | undefined;
  try {
    responseBody = await response.text();
  } catch {
    // Diagnostics keep only a body classification; a failed body read is not retained.
  }
  return {
    observedAt: new Date(clock.now()).toISOString(),
    resourceType: request.resourceType?.() ?? "unknown",
    url: request.url(),
    ...classifyRateLimitResponse(response.headers(), responseBody),
    ...details,
  };
}

/**
 * Replay exactly once only after a standards-compliant API Retry-After value.
 * route.fetch preserves the original URL, headers, authentication, and body;
 * this helper stores no response body and never retries a browser RSC request.
 */
export async function recoverExternalApiRead<ResponseType extends RateLimitResponse>(
  route: RecoverableRoute<ResponseType>,
  dashboardOrigin: string,
  record: (diagnostic: RateLimitObservation) => void,
  clock: GovernorClock = realClock,
): Promise<boolean> {
  const request = route.request();
  if (!isRecoverableExternalApiRead(request, dashboardOrigin)) return false;
  const fulfill = fulfillRouteOnce(route);

  const initial = await route.fetch({ maxRetries: 0 });
  if (initial.status() !== 429) {
    await fulfill(initial);
    return true;
  }

  const initialDiagnostic = await observeRateLimit(initial, request, clock, { outcome: "recovered", attempt: 1 });
  const retryAfter = parseBoundedRetryAfter(initialDiagnostic.retryAfter, clock.now());
  if ("reason" in retryAfter) {
    record({ ...initialDiagnostic, outcome: "fatal", reason: retryAfter.reason });
    await fulfill(initial);
    return true;
  }

  const waitMilliseconds = retryAfter.milliseconds + API_RETRY_CLOCK_TICK_MS;
  record({ ...initialDiagnostic, waitMilliseconds });
  await clock.sleep(waitMilliseconds);

  const replay = await route.fetch({ maxRetries: 0 });
  if (replay.status() === 429) {
    record({
      ...(await observeRateLimit(replay, request, clock, { outcome: "fatal", attempt: 2 })),
      reason: "second-429",
    });
  }
  await fulfill(replay);
  return true;
}

const workerGovernor = new DashboardNavigationGovernor();

/**
 * Install the external-suite-only governor before test code can navigate.
 * Context routing includes pages created later by tests, while the origin check
 * deliberately leaves OpenCode and code-server documents/assets untouched.
 */
export interface ExternalSuiteGovernorInstallation {
  stop: () => Promise<void>;
}

export function isExpectedPostTeardownRouteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message === "Test ended."
    || /^(?:route\.(?:fulfill|continue|fallback): )?Route is already handled!$/.test(message);
}

async function waitForTasks(tasks: ReadonlySet<Promise<void>>): Promise<void> {
  const settled = await Promise.allSettled([...tasks]);
  const failed = settled.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

export async function installDashboardNavigationGovernor(
  context: BrowserContext,
  baseURL: string | undefined,
  governor = workerGovernor,
): Promise<ExternalSuiteGovernorInstallation> {
  const dashboardOrigin = new URL(baseURL ?? "http://localhost:3000").origin;
  const rateLimits: RateLimitObservation[] = [];
  const interceptedApiReads = new WeakSet<RecoverableRequest>();
  const responseTasks = new Set<Promise<void>>();
  const inFlightRouteHandlers = new Set<Promise<void>>();
  const admittedRoutes = new WeakSet<Route>();
  let acceptingRoutes = true;
  let teardownStarted = false;
  let stopPromise: Promise<void> | undefined;

  const handleRoute = async (route: Route): Promise<void> => {
    const request = route.request();
    if (isDashboardDocumentNavigation(request.url(), request.resourceType(), dashboardOrigin)) {
      await governor.beforeNavigation();
      await route.continue();
      return;
    }
    if (isExternalSuiteRateLimitRecoveryEnabled() && isRecoverableExternalApiRead(request, dashboardOrigin)) {
      interceptedApiReads.add(request);
      await recoverExternalApiRead(
        recoverablePlaywrightRoute(route),
        dashboardOrigin,
        (diagnostic) => rateLimits.push(diagnostic),
      );
      return;
    }
    // Preserve page-level mocks and normal subrequest handling. Continuing a
    // context-wide route here changes RSC prefetch cancellation semantics.
    await route.fallback();
  };
  const routeHandler = (route: Route): Promise<void> => {
    // unroute prevents future callbacks. A callback already queued during
    // teardown must not begin a new intercepted request.
    if (!acceptingRoutes || admittedRoutes.has(route)) return Promise.resolve();
    admittedRoutes.add(route);

    const task = handleRoute(route).catch((error: unknown) => {
      if (teardownStarted && isExpectedPostTeardownRouteError(error)) return;
      throw error;
    });
    inFlightRouteHandlers.add(task);
    void task.then(
      () => inFlightRouteHandlers.delete(task),
      () => inFlightRouteHandlers.delete(task),
    );
    return task;
  };
  const responseListener = (response: Response): void => {
    if (response.status() !== 429) return;
    const request = response.request();
    if (interceptedApiReads.has(request)) return;
    try {
      if (new URL(response.url()).origin !== dashboardOrigin) return;
    } catch {
      return;
    }
    const task = observeRateLimit(response, request, realClock, { outcome: "fatal", attempt: 1 })
      .then((diagnostic) => { rateLimits.push(diagnostic); });
    responseTasks.add(task);
    void task.then(
      () => responseTasks.delete(task),
      () => responseTasks.delete(task),
    );
  };

  await context.route("**/*", routeHandler);
  context.on("response", responseListener);

  return {
    stop: (): Promise<void> => {
      if (stopPromise) return stopPromise;
      acceptingRoutes = false;
      teardownStarted = true;
      context.off("response", responseListener);

      stopPromise = (async (): Promise<void> => {
        // Remove the registered handler before waiting. This closes admission,
        // then lets already-started fetch/fulfill work complete before Playwright
        // tears down its page and context fixtures.
        await context.unroute("**/*", routeHandler);
        await waitForTasks(inFlightRouteHandlers);
        await waitForTasks(responseTasks);

        const fatalRateLimits = rateLimits.filter((diagnostic) => diagnostic.outcome === "fatal");
        if (fatalRateLimits.length === 0) return;
        throw new Error([
          "External dashboard request rate limited:",
          ...rateLimits.map(({ observedAt, resourceType, url, retryAfter, server, source, bodyKind: classifiedBody, outcome, attempt, waitMilliseconds, reason }) =>
            `${observedAt} ${resourceType} ${url} -> HTTP 429 (${source}; server: ${server ?? "missing"}; body: ${classifiedBody}; Retry-After: ${retryAfter ?? "missing"}; attempt: ${attempt}; outcome: ${outcome}${waitMilliseconds === undefined ? "" : `; waited: ${waitMilliseconds}ms`}${reason === undefined ? "" : `; reason: ${reason}`})`,
          ),
        ].join("\n"));
      })();
      return stopPromise;
    },
  };
}

/** External Docker and route-parity specs opt in by importing this fixture. */
export const test = base.extend<{
  externalSuiteTransition: void;
  externalSuiteGovernorLifecycle: ExternalSuiteGovernorInstallation;
}>({
  externalSuiteTransition: [async ({}, use, testInfo) => {
    if (process.env.RUN_DASHBOARD_DOCKER === "1" || process.env.RUN_DASHBOARD_ROUTE_PARITY === "1") {
      await workerGovernor.beforeSuiteTransition(
        externalSuiteTransitionInterval(testInfo.project.metadata),
      );
    }
    await use(undefined);
  }, { auto: true }],
  externalSuiteGovernorLifecycle: [async ({ context, baseURL, externalSuiteTransition }, provideFixture) => {
    await Promise.resolve(externalSuiteTransition);
    const installation = await installDashboardNavigationGovernor(context, baseURL);
    try {
      await provideFixture(installation);
    } finally {
      await installation.stop();
    }
  }, { auto: true }],
  page: async ({ page, externalSuiteGovernorLifecycle }, provideFixture) => {
    try {
      await provideFixture(page);
    } finally {
      // This test-scoped teardown runs before the base page fixture releases
      // its page and context, including when the test body throws.
      await externalSuiteGovernorLifecycle.stop();
    }
  },
});

export { expect };

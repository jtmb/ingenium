import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BrowserContext } from "@playwright/test";
import {
  API_FIXED_WINDOW_MS,
  API_FIXED_WINDOW_REQUEST_LIMIT,
  API_RETRY_CLOCK_TICK_MS,
  CONSERVATIVE_DASHBOARD_REQUESTS_PER_PAGE,
  DASHBOARD_NAVIGATION_INTERVAL_MS,
  DashboardNavigationGovernor,
  EXTERNAL_SUITE_TRANSITION_INTERVAL_MS,
  DOCKER_API_HEADROOM_PER_WINDOW,
  DOCKER_API_PREFLIGHT_READS,
  DOCKER_API_READS_PER_WINDOW,
  DOCKER_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS,
  DOCKER_TESTS_PER_API_WINDOW,
  EXTERNAL_SUITE_TRANSITION_INTERVAL_METADATA_KEY,
  GATEWAY_BURST_REQUESTS,
  GATEWAY_FULL_BUCKET_DRAIN_MS,
  GATEWAY_REQUESTS_PER_SECOND,
  OBSERVED_DOCKER_DIRECT_API_READS_PER_TEST,
  OBSERVED_DOCKER_LOGICAL_READS_PER_TEST,
  classifyRateLimitResponse,
  drainGatewayRequestBucket,
  externalSuiteTransitionInterval,
  isDashboardDocumentNavigation,
  isExternalSuiteRateLimitRecoveryEnabled,
  isExpectedPostTeardownRouteError,
  isRecoverableExternalApiRead,
  installDashboardNavigationGovernor,
  OBSERVED_DYNAMIC_DASHBOARD_REQUESTS_PER_ROUTE,
  parseBoundedRetryAfter,
  recoverExternalApiRead,
  retryExternalSuiteStartupApiPreflight,
  ROUTE_PARITY_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS,
  type GovernorClock,
  type RateLimitObservation,
} from "./external-suite-navigation-governor";

const originalEnvironment = { ...process.env };
const repositoryRoot = process.cwd();

afterEach(() => {
  process.env = { ...originalEnvironment };
});

interface FakeResponse {
  status(): number;
  headers(): Record<string, string>;
  text(): Promise<string>;
}

function fakeResponse(status: number, headers: Record<string, string> = {}, body = ""): FakeResponse {
  return { status: () => status, headers: () => headers, text: async () => body };
}

function fakeRoute(
  request: { url: string; method?: string; body?: unknown; headers?: Record<string, string> },
  responses: FakeResponse[],
): {
  route: {
    request(): { url(): string; method(): string; resourceType(): string; headers(): Record<string, string>; postDataBuffer(): unknown };
    fetch(options?: { maxRetries?: number }): Promise<FakeResponse>;
    fulfill(options: { response: FakeResponse }): Promise<void>;
  };
  fetchCalls: Array<{ maxRetries?: number } | undefined>;
  fulfilled: FakeResponse[];
} {
  const fetchCalls: Array<{ maxRetries?: number } | undefined> = [];
  const fulfilled: FakeResponse[] = [];
  return {
    route: {
      request: () => ({
        url: () => request.url,
        method: () => request.method ?? "GET",
        resourceType: () => "fetch",
        headers: () => request.headers ?? {},
        postDataBuffer: () => request.body ?? null,
      }),
      fetch: async (options) => {
        fetchCalls.push(options);
        const response = responses.shift();
        if (!response) throw new Error("Unexpected replay");
        return response;
      },
      fulfill: async ({ response }) => { fulfilled.push(response); },
    },
    fetchCalls,
    fulfilled,
  };
}

function fakeClock(now = 0): { clock: GovernorClock; waits: number[] } {
  const waits: number[] = [];
  return {
    clock: {
      now: () => now,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      },
    },
    waits,
  };
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function fakeGovernorContext(unrouteGate: Promise<void> = Promise.resolve()): {
  context: BrowserContext;
  dispatch: (route: unknown) => Promise<boolean>;
  hasHandler: () => boolean;
  unrouteStarted: Promise<void>;
} {
  type RouteHandler = (route: unknown) => Promise<void>;
  let handler: RouteHandler | undefined;
  const unrouteStarted = deferred<void>();
  const context = {
    route: async (_pattern: unknown, nextHandler: unknown) => {
      handler = nextHandler as RouteHandler;
    },
    unroute: async (_pattern: unknown, expectedHandler: unknown) => {
      if (handler === expectedHandler) handler = undefined;
      unrouteStarted.resolve();
      await unrouteGate;
    },
    on: () => undefined,
    off: () => undefined,
  } as unknown as BrowserContext;

  return {
    context,
    dispatch: async (route) => {
      const activeHandler = handler;
      if (!activeHandler) return false;
      await activeHandler(route);
      return true;
    },
    hasHandler: () => handler !== undefined,
    unrouteStarted: unrouteStarted.promise,
  };
}

describe("external-suite dashboard navigation governor", () => {
  it("derives the navigation interval and full-bucket drain from the gateway budget", () => {
    expect(CONSERVATIVE_DASHBOARD_REQUESTS_PER_PAGE).toBe(
      OBSERVED_DYNAMIC_DASHBOARD_REQUESTS_PER_ROUTE + 1,
    );
    expect(DASHBOARD_NAVIGATION_INTERVAL_MS).toBe(
      Math.ceil((1_000 * CONSERVATIVE_DASHBOARD_REQUESTS_PER_PAGE) / GATEWAY_REQUESTS_PER_SECOND),
    );
    expect(GATEWAY_FULL_BUCKET_DRAIN_MS).toBe(
      Math.ceil((1_000 * GATEWAY_BURST_REQUESTS) / GATEWAY_REQUESTS_PER_SECOND),
    );
    expect(DASHBOARD_NAVIGATION_INTERVAL_MS).toBe(400);
    expect(GATEWAY_FULL_BUCKET_DRAIN_MS).toBe(2_000);
    expect(API_FIXED_WINDOW_REQUEST_LIMIT).toBe(100);
    expect(ROUTE_PARITY_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS).toBe(3_000);
    expect(EXTERNAL_SUITE_TRANSITION_INTERVAL_MS).toBe(3_000);
  });

  it("reserves Docker's fixed window with separate per-suite metadata", () => {
    expect(OBSERVED_DOCKER_LOGICAL_READS_PER_TEST).toBe(12);
    expect(OBSERVED_DOCKER_DIRECT_API_READS_PER_TEST).toBe(7);
    expect(DOCKER_API_PREFLIGHT_READS).toBe(2);
    expect(DOCKER_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS).toBe(6_000);
    expect(DOCKER_TESTS_PER_API_WINDOW).toBe(10);
    expect(DOCKER_API_READS_PER_WINDOW).toBe(72);
    expect(DOCKER_API_HEADROOM_PER_WINDOW).toBe(28);
    expect(externalSuiteTransitionInterval({
      [EXTERNAL_SUITE_TRANSITION_INTERVAL_METADATA_KEY]: DOCKER_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS,
    })).toBe(DOCKER_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS);
    expect(externalSuiteTransitionInterval({
      [EXTERNAL_SUITE_TRANSITION_INTERVAL_METADATA_KEY]: ROUTE_PARITY_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS,
    })).toBe(ROUTE_PARITY_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS);
    expect(externalSuiteTransitionInterval(undefined)).toBe(ROUTE_PARITY_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS);
    expect(() => externalSuiteTransitionInterval({
      [EXTERNAL_SUITE_TRANSITION_INTERVAL_METADATA_KEY]: 0,
    })).toThrow("must be a positive integer");
  });

  it("grounds the Docker burst budget in the chat source polling intervals", () => {
    const chatHook = readFileSync(
      resolve(repositoryRoot, "services/ingenium-dashboard/src/lib/use-opencode-chat.ts"),
      "utf8",
    );

    expect(chatHook).toContain("setInterval(refreshPermissions, 5000)");
    expect(chatHook).toContain("setInterval(refreshQuestions, 3000)");
  });

  it("ties the fixed-window budget to the API source and threshold test", () => {
    const config = readFileSync(
      resolve(repositoryRoot, "services/ingenium-api/config/index.ts"),
      "utf8",
    );
    const limiter = readFileSync(
      resolve(repositoryRoot, "services/ingenium-api/lib/middleware/rate-limit.ts"),
      "utf8",
    );
    const limiterTest = readFileSync(
      resolve(repositoryRoot, "services/ingenium-api/tests/rate-limit.test.ts"),
      "utf8",
    );

    expect(config).toContain('INGENIUM_API_RATE_LIMIT ?? "100"');
    expect(limiter).toContain("windowMs = 60_000");
    expect(limiterTest).toContain('INGENIUM_API_RATE_LIMIT ?? "100"');
  });

  it("serializes fresh-page dispatches and preserves cooldown between tests", async () => {
    let now = 0;
    const waits: number[] = [];
    const governor = new DashboardNavigationGovernor(100, {
      now: () => now,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      },
    });

    await Promise.all([
      governor.beforeNavigation(),
      governor.beforeNavigation(),
      governor.beforeNavigation(),
    ]);
    await governor.beforeNavigation();

    expect(waits).toEqual([100, 100, 100]);
  });

  it("paces route parity and Docker transitions with their configured intervals", async () => {
    let now = 0;
    const waits: number[] = [];
    const governor = new DashboardNavigationGovernor(100, {
      now: () => now,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      },
    });

    await governor.beforeSuiteTransition(ROUTE_PARITY_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS);
    await governor.beforeNavigation();

    expect(waits).toEqual([EXTERNAL_SUITE_TRANSITION_INTERVAL_MS]);

    await governor.beforeSuiteTransition(DOCKER_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS);

    expect(waits).toEqual([
      EXTERNAL_SUITE_TRANSITION_INTERVAL_MS,
      DOCKER_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS,
    ]);
  });

  it("keeps the separate gateway burst drain at two seconds", async () => {
    const { clock, waits } = fakeClock();

    await drainGatewayRequestBucket(clock);

    expect(waits).toEqual([GATEWAY_FULL_BUCKET_DRAIN_MS]);
  });

  it("paces only dashboard documents, never OpenCode/code-server or subrequests", () => {
    const dashboardOrigin = "http://localhost:3000";

    expect(isDashboardDocumentNavigation("http://localhost:3000/chat", "document", dashboardOrigin)).toBe(true);
    expect(isDashboardDocumentNavigation("http://localhost:3000/api/v1/projects", "fetch", dashboardOrigin)).toBe(false);
    expect(isDashboardDocumentNavigation("http://opencode.localhost:3000/", "document", dashboardOrigin)).toBe(false);
    expect(isDashboardDocumentNavigation("http://vscode.localhost:3000/", "document", dashboardOrigin)).toBe(false);
  });

  it("classifies API fixed-window and Nginx 429s without retaining bodies", () => {
    expect(classifyRateLimitResponse(
      { "retry-after": "3", server: "nginx" },
      JSON.stringify({ error: { code: "RATE_LIMITED" } }),
    )).toMatchObject({ source: "api-fixed-window", bodyKind: "api-rate-limited-json", retryAfter: "3" });
    expect(classifyRateLimitResponse(
      { server: "nginx" },
      "<html><center>nginx</center></html>",
    )).toMatchObject({ source: "nginx-gateway", bodyKind: "nginx-html", retryAfter: null });
  });

  it("replays a bounded API GET once after a valid Retry-After delay", async () => {
    const { clock, waits } = fakeClock();
    const { route, fetchCalls, fulfilled } = fakeRoute(
      { url: "http://localhost:3000/api/v1/projects" },
      [
        fakeResponse(429, { "Retry-After": "3" }, JSON.stringify({ error: { code: "RATE_LIMITED" } })),
        fakeResponse(200),
      ],
    );
    const diagnostics: RateLimitObservation[] = [];

    await expect(recoverExternalApiRead(route, "http://localhost:3000", (diagnostic) => diagnostics.push(diagnostic), clock))
      .resolves.toBe(true);

    expect(fetchCalls).toEqual([{ maxRetries: 0 }, { maxRetries: 0 }]);
    expect(waits).toEqual([3_000 + API_RETRY_CLOCK_TICK_MS]);
    expect(fulfilled.map((response) => response.status())).toEqual([200]);
    expect(diagnostics).toMatchObject([{
      source: "api-fixed-window",
      bodyKind: "api-rate-limited-json",
      outcome: "recovered",
      attempt: 1,
      waitMilliseconds: 3_000 + API_RETRY_CLOCK_TICK_MS,
    }]);
  });

  it("accepts a bounded HTTP-date Retry-After", async () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const { clock, waits } = fakeClock(now);
    const { route } = fakeRoute(
      { url: "http://localhost:3000/api/v1/projects" },
      [
        fakeResponse(429, { "retry-after": new Date(now + 10_000).toUTCString() }, JSON.stringify({ error: { code: "RATE_LIMITED" } })),
        fakeResponse(200),
      ],
    );

    await recoverExternalApiRead(route, "http://localhost:3000", () => {}, clock);
    expect(waits).toEqual([10_000 + API_RETRY_CLOCK_TICK_MS]);
  });

  it("keeps missing, invalid, excessive, and repeated API rate limits fatal", async () => {
    for (const [retryAfter, reason] of [
      [undefined, "missing-retry-after"],
      ["3.5", "invalid-retry-after"],
      ["11", "excessive-retry-after"],
    ] as const) {
      const { clock, waits } = fakeClock();
      const { route, fetchCalls, fulfilled } = fakeRoute(
        { url: "http://localhost:3000/api/v1/projects" },
        [fakeResponse(429, retryAfter === undefined ? {} : { "retry-after": retryAfter }, JSON.stringify({ error: { code: "RATE_LIMITED" } }))],
      );
      const diagnostics: RateLimitObservation[] = [];
      await recoverExternalApiRead(route, "http://localhost:3000", (diagnostic) => diagnostics.push(diagnostic), clock);
      expect(fetchCalls).toHaveLength(1);
      expect(waits).toEqual([]);
      expect(fulfilled[0]?.status()).toBe(429);
      expect(diagnostics[0]).toMatchObject({ outcome: "fatal", attempt: 1, reason });
    }

    const { clock, waits } = fakeClock();
    const { route, fetchCalls, fulfilled } = fakeRoute(
      { url: "http://localhost:3000/api/v1/projects" },
      [
        fakeResponse(429, { "retry-after": "2" }, JSON.stringify({ error: { code: "RATE_LIMITED" } })),
        fakeResponse(429, { "retry-after": "2" }, JSON.stringify({ error: { code: "RATE_LIMITED" } })),
      ],
    );
    const diagnostics: RateLimitObservation[] = [];
    await recoverExternalApiRead(route, "http://localhost:3000", (diagnostic) => diagnostics.push(diagnostic), clock);
    expect(fetchCalls).toHaveLength(2);
    expect(waits).toEqual([2_000 + API_RETRY_CLOCK_TICK_MS]);
    expect(fulfilled[0]?.status()).toBe(429);
    expect(diagnostics.at(-1)).toMatchObject({ outcome: "fatal", attempt: 2, reason: "second-429" });
  });

  it("never replays mutations, bodies, non-API requests, or RSC requests", async () => {
    const requests = [
      { url: "http://localhost:3000/api/v1/projects", method: "POST" },
      { url: "http://localhost:3000/api/v1/projects", body: Buffer.from("body") },
      { url: "http://localhost:3000/api/v1/opencode/sessions/session/events", headers: { accept: "text/event-stream" } },
      { url: "http://localhost:3000/projects" },
      { url: "http://localhost:3000/vscode?_rsc=abc" },
      { url: "http://other.localhost:3000/api/v1/projects" },
    ];
    for (const request of requests) {
      const { route, fetchCalls } = fakeRoute(request, [fakeResponse(429)]);
      expect(isRecoverableExternalApiRead(route.request(), "http://localhost:3000")).toBe(false);
      await expect(recoverExternalApiRead(route, "http://localhost:3000", () => {})).resolves.toBe(false);
      expect(fetchCalls).toEqual([]);
    }
  });

  it("permits a bodyless HEAD API read", async () => {
    const { route, fulfilled } = fakeRoute(
      { url: "http://localhost:3000/api/v1/projects", method: "HEAD" },
      [fakeResponse(204)],
    );
    await expect(recoverExternalApiRead(route, "http://localhost:3000", () => {})).resolves.toBe(true);
    expect(fulfilled[0]?.status()).toBe(204);
  });

  it("limits recovery to explicit Docker and route-parity suites", () => {
    expect(isExternalSuiteRateLimitRecoveryEnabled({})).toBe(false);
    expect(isExternalSuiteRateLimitRecoveryEnabled({ RUN_DASHBOARD_DOCKER: "1" })).toBe(true);
    expect(isExternalSuiteRateLimitRecoveryEnabled({ RUN_DASHBOARD_ROUTE_PARITY: "1" })).toBe(true);
  });

  it("parses only bounded standard Retry-After values", () => {
    expect(parseBoundedRetryAfter("10", 0)).toMatchObject({ milliseconds: 10_000, kind: "delay-seconds" });
    expect(parseBoundedRetryAfter("10.1", 0)).toEqual({ reason: "invalid-retry-after" });
    expect(parseBoundedRetryAfter("12", 0)).toEqual({ reason: "excessive-retry-after" });
  });

  it("honors one valid startup Retry-After through the known API window", async () => {
    const { clock, waits } = fakeClock();
    const responses = [
      { status: 429, headers: { get: () => "60" } },
      { status: 200, headers: { get: () => null } },
    ];
    let calls = 0;

    const result = await retryExternalSuiteStartupApiPreflight(
      async () => responses[calls++]!,
      clock,
    );

    expect(result.status).toBe(200);
    expect(calls).toBe(2);
    expect(waits).toEqual([API_FIXED_WINDOW_MS + API_RETRY_CLOCK_TICK_MS]);
  });

  it("keeps invalid, excessive, and second startup 429s fatal to the caller", async () => {
    const excessive = fakeClock();
    let excessiveCalls = 0;
    const excessiveResult = await retryExternalSuiteStartupApiPreflight(
      async () => {
        excessiveCalls += 1;
        return { status: 429, headers: { get: () => "61" } };
      },
      excessive.clock,
    );
    expect(excessiveResult.status).toBe(429);
    expect(excessiveCalls).toBe(1);
    expect(excessive.waits).toEqual([]);

    const repeated = fakeClock();
    const repeatedResponses = [
      { status: 429, headers: { get: () => "2" } },
      { status: 429, headers: { get: () => "2" } },
    ];
    let repeatedCalls = 0;
    const repeatedResult = await retryExternalSuiteStartupApiPreflight(
      async () => repeatedResponses[repeatedCalls++]!,
      repeated.clock,
    );
    expect(repeatedResult.status).toBe(429);
    expect(repeatedCalls).toBe(2);
    expect(repeated.waits).toEqual([2_000 + API_RETRY_CLOCK_TICK_MS]);
  });

  it("unroutes before teardown, waits for in-flight work, and admits no post-test callback", async () => {
    process.env.RUN_DASHBOARD_DOCKER = "1";
    const unrouteGate = deferred<void>();
    const fakeContext = fakeGovernorContext(unrouteGate.promise);
    const pendingResponse = deferred<FakeResponse>();
    const active = fakeRoute(
      { url: "http://localhost:3000/api/v1/projects" },
      [],
    );
    active.route.fetch = async () => pendingResponse.promise;
    const installation = await installDashboardNavigationGovernor(fakeContext.context, "http://localhost:3000");

    const handling = fakeContext.dispatch(active.route);
    await Promise.resolve();
    await expect(fakeContext.dispatch(active.route)).resolves.toBe(true);
    const stopping = installation.stop();
    await fakeContext.unrouteStarted;
    expect(fakeContext.hasHandler()).toBe(false);

    pendingResponse.resolve(fakeResponse(200));
    await expect(handling).resolves.toBe(true);
    expect(active.fulfilled.map((response) => response.status())).toEqual([200]);

    let stopped = false;
    void stopping.then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);

    unrouteGate.resolve();
    await expect(stopping).resolves.toBeUndefined();

    const postTest = fakeRoute(
      { url: "http://localhost:3000/api/v1/projects" },
      [fakeResponse(200)],
    );
    await expect(fakeContext.dispatch(postTest.route)).resolves.toBe(false);
    expect(postTest.fulfilled).toEqual([]);
  });

  it("suppresses only an exact already-handled route error after teardown", async () => {
    process.env.RUN_DASHBOARD_DOCKER = "1";
    const fakeContext = fakeGovernorContext();
    const pendingResponse = deferred<FakeResponse>();
    const route = fakeRoute(
      { url: "http://localhost:3000/api/v1/projects" },
      [],
    );
    let fulfillCalls = 0;
    route.route.fetch = async () => pendingResponse.promise;
    route.route.fulfill = async () => {
      fulfillCalls += 1;
      throw new Error("route.fulfill: Route is already handled!");
    };
    const installation = await installDashboardNavigationGovernor(fakeContext.context, "http://localhost:3000");

    const handling = fakeContext.dispatch(route.route);
    await Promise.resolve();
    const stopping = installation.stop();
    pendingResponse.resolve(fakeResponse(200));

    await expect(handling).resolves.toBe(true);
    await expect(stopping).resolves.toBeUndefined();
    expect(fulfillCalls).toBe(1);
    expect(isExpectedPostTeardownRouteError(new Error("Test ended."))).toBe(true);
    expect(isExpectedPostTeardownRouteError(new Error("Target page, context or browser has been closed"))).toBe(false);
  });

  it("keeps active-test route errors fatal", async () => {
    process.env.RUN_DASHBOARD_DOCKER = "1";
    const fakeContext = fakeGovernorContext();
    const route = fakeRoute(
      { url: "http://localhost:3000/api/v1/projects" },
      [fakeResponse(200)],
    );
    route.route.fulfill = async () => {
      throw new Error("route.fulfill: Route is already handled!");
    };
    const installation = await installDashboardNavigationGovernor(fakeContext.context, "http://localhost:3000");

    await expect(fakeContext.dispatch(route.route)).rejects.toThrow("Route is already handled");
    await expect(installation.stop()).resolves.toBeUndefined();
  });
});

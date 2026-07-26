import { setTimeout as delay } from "node:timers/promises";

export type ContainedSuite = "docker" | "provider" | "mail" | "manual";

const DASHBOARD_URL = process.env.INGENIUM_E2E_DASHBOARD_URL ?? "http://localhost:3000";
const API_URL = process.env.INGENIUM_E2E_API_URL ?? "http://localhost:4097";
const OPENCODE_URL = process.env.OPENCODE_SERVER_URL ?? "http://localhost:4098";

const OPT_IN_FLAGS: Record<ContainedSuite, string> = {
  docker: "RUN_DASHBOARD_DOCKER",
  provider: "RUN_DASHBOARD_PROVIDER",
  mail: "RUN_DASHBOARD_MAIL",
  manual: "RUN_DASHBOARD_MANUAL",
};

/**
 * Keep opt-in checks usable from both Playwright global setup and a suite's
 * direct `beforeAll`. Throwing is intentional: an accidentally requested
 * external suite must fail before a worker starts rather than be reported as
 * a passing/skipped test.
 */
export function requireSuiteOptIn(suite: ContainedSuite): void {
  const flag = OPT_IN_FLAGS[suite];
  if (process.env[flag] !== "1") {
    throw new Error(
      `${suite} dashboard suite is opt-in. Set ${flag}=1 before running this suite.`,
    );
  }
}

export type SuitePreflightTarget = "dashboard" | "api" | "opencode" | "cli";

/**
 * Return only the headers allowed for a preflight target. The dashboard and
 * OpenCode gateways are deliberately probed without an API bearer; only the
 * API health endpoint is an API-authenticated request.
 */
export function suitePreflightHeaders(target: SuitePreflightTarget): HeadersInit {
  if (target !== "api") return {};
  const token = process.env.INGENIUM_API_TOKEN?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * Check that a required external service is listening. A 401/403/404 is
 * treated as reachable because Docker gateways and protected upstreams may
 * intentionally reject an unauthenticated preflight request. Connection
 * failures and 5xx responses are actionable setup failures.
 */
async function assertReachable(
  label: string,
  url: string,
  target: SuitePreflightTarget,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      headers: suitePreflightHeaders(target),
      signal: controller.signal,
    });
    if (response.status >= 500) {
      throw new Error(`returned HTTP ${response.status}`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`External-suite preflight failed: ${label} is not ready at ${url}: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function assertExternalServices(suite: ContainedSuite): Promise<void> {
  const endpoints: Array<[string, string, SuitePreflightTarget]> = [
    ["dashboard", `${DASHBOARD_URL}/`, "dashboard"],
    ["API", `${API_URL}/api/v1/health`, "api"],
  ];

  if (suite === "docker" || suite === "provider") {
    endpoints.push(["OpenCode", `${OPENCODE_URL}/global/health`, "opencode"]);
  }

  if (suite === "docker") {
    endpoints.push([
      "OpenCode CLI",
      process.env.INGENIUM_E2E_CLI_URL ?? "http://localhost:4099/",
      "cli",
    ]);
  }

  for (const [label, url, target] of endpoints) {
    await assertReachable(label, url, target);
  }
}

/**
 * Playwright global setup for contained suites. The short delay between
 * checks lets a freshly restarted local gateway finish accepting connections
 * without turning readiness into an unbounded wait.
 */
export async function runSuitePreflight(suite: ContainedSuite): Promise<void> {
  requireSuiteOptIn(suite);
  await delay(25);
  await assertExternalServices(suite);
}

export async function dockerPreflight(): Promise<void> {
  await runSuitePreflight("docker");
}

export async function providerPreflight(): Promise<void> {
  await runSuitePreflight("provider");
}

export async function mailPreflight(): Promise<void> {
  await runSuitePreflight("mail");
}

export async function manualPreflight(): Promise<void> {
  await runSuitePreflight("manual");
}

export const suiteContainmentUrls = {
  dashboard: DASHBOARD_URL,
  api: API_URL,
  opencode: OPENCODE_URL,
  cli: process.env.INGENIUM_E2E_CLI_URL ?? "http://localhost:4099",
} as const;

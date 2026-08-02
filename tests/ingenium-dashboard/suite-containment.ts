import { resolveDockerActiveProject } from "./docker-active-project";
import {
  drainGatewayRequestBucket,
  retryExternalSuiteStartupApiPreflight,
} from "./external-suite-navigation-governor";

export type ContainedSuite = "docker" | "provider" | "mail" | "manual";

const DASHBOARD_URL = process.env.INGENIUM_E2E_DASHBOARD_URL ?? "http://localhost:3000";
const API_URL = process.env.INGENIUM_E2E_API_URL ?? "http://localhost:4097";

function configuredExternalUrl(fallback: string, ...values: Array<string | undefined>): string {
  for (const value of values) {
    const url = value?.trim();
    if (url) return url.replace(/\/+$/, "");
  }
  return fallback;
}

// External-suite probes must use the public gateway roots. OpenCode and ttyd
// listeners are private container ports and are never preflight defaults.
const OPENCODE_URL = configuredExternalUrl(
  "http://opencode.localhost:3000",
  process.env.INGENIUM_E2E_OPENCODE_WEB_URL,
  process.env.OPENCODE_SERVER_URL,
);
const CLI_URL = configuredExternalUrl(
  "http://cli.localhost:3000",
  process.env.INGENIUM_E2E_CLI_URL,
);
const VSCODE_URL = "http://vscode.localhost:3000";

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

export type SuitePreflightTarget = "dashboard" | "api" | "opencode" | "cli" | "vscode";

/**
 * Return only the headers allowed for a preflight target. The dashboard and
 * OpenCode gateways are deliberately probed without an API bearer; only the
 * API health endpoint is an API-authenticated request.
 */
export function suitePreflightHeaders(target: SuitePreflightTarget): Record<string, string> {
  if (target !== "api") return {};
  const token = process.env.INGENIUM_API_TOKEN?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

function resolvePreflightRequest(
  url: string,
  target: SuitePreflightTarget,
): { requestUrl: string; headers: Record<string, string> } {
  const headers = { ...suitePreflightHeaders(target) };
  if (target !== "opencode" && target !== "cli" && target !== "vscode") return { requestUrl: url, headers };

  const gateway = new URL(url);
  const expectedHost = target === "opencode"
    ? "opencode.localhost"
    : target === "cli"
      ? "cli.localhost"
      : "vscode.localhost";
  if (gateway.protocol !== "http:" || gateway.hostname !== expectedHost || gateway.port !== "3000") {
    return { requestUrl: url, headers };
  }

  // Node does not guarantee a .localhost resolver. Connect to the published
  // gateway loopback address while preserving its exact virtual-host boundary.
  gateway.hostname = "127.0.0.1";
  headers.host = `${expectedHost}:3000`;
  return { requestUrl: gateway.toString(), headers };
}

/**
 * Check that a required external service is listening. A 401/403/404 is
 * treated as reachable because Docker gateways and protected upstreams may
 * intentionally reject an unauthenticated preflight request. Connection
 * failures, 429 responses, and 5xx responses are actionable setup failures.
 */
async function assertReachable(
  label: string,
  url: string,
  target: SuitePreflightTarget,
): Promise<void> {
  try {
    const request = resolvePreflightRequest(url, target);
    const send = () => fetchWithTimeout(request.requestUrl, { headers: request.headers });
    const response = target === "api"
      ? await retryExternalSuiteStartupApiPreflight(send)
      : await send();
    if (response.status === 429) {
      throw new Error(`returned HTTP 429 (Retry-After: ${response.headers.get("retry-after")?.trim() || "missing"})`);
    }
    if (response.status >= 500) {
      throw new Error(`returned HTTP ${response.status}`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`External-suite preflight failed: ${label} is not ready at ${url}: ${reason}`);
  }
}

/** Bound each individual external request without truncating Retry-After recovery. */
async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function assertExternalServices(suite: ContainedSuite): Promise<void> {
  const endpoints: Array<[string, string, SuitePreflightTarget]> = [
    ["API", `${API_URL}/api/v1/health`, "api"],
    ["dashboard", `${DASHBOARD_URL}/`, "dashboard"],
  ];

  if (suite === "docker" || suite === "provider") {
    endpoints.push(["OpenCode", `${OPENCODE_URL}/`, "opencode"]);
  }

  if (suite === "docker") {
    endpoints.push([
      "OpenCode CLI",
      `${CLI_URL}/`,
      "cli",
    ]);
    endpoints.push(["VS Code", `${VSCODE_URL}/`, "vscode"]);
  }

  for (const [label, url, target] of endpoints) {
    await assertReachable(label, url, target);
  }
}

async function assertDockerActiveProject(): Promise<void> {
  const endpoint = new URL("/api/v1/projects", DASHBOARD_URL).toString();
  try {
    const response = await fetchWithTimeout(endpoint);
    if (response.status === 429) {
      throw new Error(`GET /api/v1/projects returned HTTP 429 (Retry-After: ${response.headers.get("retry-after")?.trim() || "missing"})`);
    }
    if (response.status !== 200) {
      throw new Error(`GET /api/v1/projects returned HTTP ${response.status}`);
    }
    resolveDockerActiveProject(await response.json());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Docker project preflight failed at ${endpoint}: ${reason}`);
  }
}

/**
 * Playwright global setup for contained suites. It validates a semantically
 * usable Docker project after the public services become reachable.
 */
export async function runSuitePreflight(suite: ContainedSuite): Promise<void> {
  requireSuiteOptIn(suite);
  await assertExternalServices(suite);
  if (suite === "docker") await assertDockerActiveProject();
  await drainGatewayRequestBucket();
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
  cli: CLI_URL,
  vscode: VSCODE_URL,
} as const;

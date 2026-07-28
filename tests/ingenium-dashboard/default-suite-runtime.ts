import { TEST_API_TOKEN } from "../test-server-lifecycle";
import {
  getTestRunContext,
  getTestRunDashboardUrl,
  type TestRunContext,
} from "../test-run-context";
import { getDashboardFixtureEnvironment } from "./fixture-credentials";

const DEVELOPMENT_PORTS = new Set([3000, 4097, 4098, 4099, 4999]);

export interface DefaultSuiteRuntime {
  context: TestRunContext;
  dashboardUrl: string;
  dashboardRoute: (route?: string) => string;
  apiBase: string;
  project: string;
  apiHeaders: Record<string, string>;
  dashboardEnvironment: Record<string, string>;
}

/**
 * Resolve endpoints and credentials for the deterministic Playwright suite.
 *
 * This deliberately refuses the development/Docker ports. A default-suite
 * test that cannot prove it is using the manifest-owned run must fail rather
 * than accidentally exercise a deployment.
 */
export function getDefaultSuiteRuntime(): DefaultSuiteRuntime {
  const context = getTestRunContext();
  const ports = Object.values(context.ports);
  if (ports.some((port) => DEVELOPMENT_PORTS.has(port))) {
    throw new Error("Default Playwright suite cannot use a development or Docker port");
  }
  const dashboardEnvironment = getDashboardFixtureEnvironment(context, TEST_API_TOKEN);

  return {
    context,
    dashboardUrl: getTestRunDashboardUrl(context),
    dashboardRoute: (route = "/") => getTestRunDashboardUrl(context, route),
    apiBase: `http://127.0.0.1:${context.ports.api}/api/v1`,
    project: context.project,
    apiHeaders: { authorization: `Bearer ${TEST_API_TOKEN}` },
    dashboardEnvironment,
  };
}

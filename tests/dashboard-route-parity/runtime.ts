import { resolve } from "node:path";
import { repositoryRoot } from "./route-inventory";
import { getDefaultSuiteRuntime } from "../ingenium-dashboard/default-suite-runtime";
import { getTestRunDashboardWorkspace } from "../test-run-context";

export const ROUTE_PARITY_OPT_IN = "RUN_DASHBOARD_ROUTE_PARITY";

/**
 * Resolve the run-owned production-mode dashboard fixture.
 * The suite never accepts a developer or deployed production origin.
 */
export function productionDashboardUrl(requireExplicit = false): string {
  void requireExplicit;
  const target = new URL(getDefaultSuiteRuntime().dashboardUrl);
  target.hostname = "localhost";
  return `${target.origin}/`;
}

export function productionDashboardRoute(path: string): string {
  const target = new URL(productionDashboardUrl());
  const route = new URL(path, target);
  if (route.origin !== target.origin) throw new Error(`Route escaped the dashboard gateway origin: ${path}`);
  return route.toString();
}

export function artifactDirectory(): string {
  const configured = process.env.INGENIUM_DASHBOARD_ARTIFACT_DIR?.trim();
  return configured
    ? resolve(repositoryRoot(), configured)
    : resolve(getTestRunDashboardWorkspace(getDefaultSuiteRuntime().context), ".next");
}

export function requireRouteParityOptIn(): void {
  if (process.env[ROUTE_PARITY_OPT_IN] !== "1") {
    throw new Error(
      `Production dashboard route parity is opt-in. Set ${ROUTE_PARITY_OPT_IN}=1 before running this suite.`,
    );
  }
}

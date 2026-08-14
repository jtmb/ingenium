import { resolve } from "node:path";
import { repositoryRoot } from "./route-inventory";

const TARGET_ENVIRONMENT_VARIABLES = [
  "INGENIUM_ROUTE_PARITY_URL",
  "INGENIUM_PRODUCTION_DASHBOARD_URL",
  "INGENIUM_E2E_DASHBOARD_URL",
] as const;
const API_TARGET_ENVIRONMENT_VARIABLES = ["INGENIUM_E2E_API_URL"] as const;

export const ROUTE_PARITY_OPT_IN = "RUN_DASHBOARD_ROUTE_PARITY";

/**
 * Resolve the already-running production dashboard gateway.
 *
 * This suite deliberately does not start a server, build Docker, or fall back
 * to a dev server. The explicit opt-in and target URL make accidental smoke
 * runs against a developer process fail closed.
 */
export function productionDashboardUrl(requireExplicit = false): string {
  const raw = TARGET_ENVIRONMENT_VARIABLES
    .map((name) => process.env[name]?.trim())
    .find((value): value is string => Boolean(value));

  if (!raw) {
    if (requireExplicit) {
      throw new Error(
        `Set ${TARGET_ENVIRONMENT_VARIABLES.join(" or ")} to the root production dashboard/gateway URL`,
      );
    }
    // Config loading and `--list` remain side-effect free. Global setup still
    // requires an explicit target before any network request is made.
    return "http://127.0.0.1:3000/";
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new Error(`Production dashboard target is not an absolute URL: ${raw}`);
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(`Production dashboard target must use HTTP(S): ${raw}`);
  }
  if (target.username || target.password || target.search || target.hash) {
    throw new Error("Production dashboard target must not contain credentials, query, or hash data");
  }
  if (target.pathname !== "/" && target.pathname !== "") {
    throw new Error("Production dashboard target must be a root gateway origin, not a shared sub-path");
  }
  return `${target.origin}/`;
}

export function productionDashboardRoute(path: string): string {
  const target = new URL(productionDashboardUrl());
  const route = new URL(path, target);
  if (route.origin !== target.origin) throw new Error(`Route escaped the dashboard gateway origin: ${path}`);
  return route.toString();
}

export function productionApiHealthRequest(): { url: string; headers: Record<string, string> } {
  const raw = API_TARGET_ENVIRONMENT_VARIABLES
    .map((name) => process.env[name]?.trim())
    .find((value): value is string => Boolean(value));
  if (!raw) {
    throw new Error(`Set ${API_TARGET_ENVIRONMENT_VARIABLES.join(" or ")} to the authenticated production API root`);
  }

  const token = process.env.INGENIUM_API_TOKEN?.trim();
  if (!token || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    throw new Error("INGENIUM_API_TOKEN must contain the production API preflight credential");
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new Error(`Production API target is not an absolute URL: ${raw}`);
  }
  if ((target.protocol !== "http:" && target.protocol !== "https:")
    || target.username || target.password || target.search || target.hash) {
    throw new Error("Production API target must be a credential-free HTTP(S) URL");
  }
  const path = target.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/") target.pathname = "/api/v1/health";
  else if (path === "/api/v1") target.pathname = "/api/v1/health";
  else if (path !== "/api/v1/health") throw new Error("Production API target must be the root, /api/v1, or /api/v1/health");

  return {
    url: target.toString(),
    headers: { Authorization: `Bearer ${token}` },
  };
}

export function artifactDirectory(): string {
  const configured = process.env.INGENIUM_DASHBOARD_ARTIFACT_DIR?.trim();
  return configured ? resolve(repositoryRoot(), configured) : resolve(repositoryRoot(), "services/ingenium-dashboard/.next");
}

export function requireRouteParityOptIn(): void {
  if (process.env[ROUTE_PARITY_OPT_IN] !== "1") {
    throw new Error(
      `Production dashboard route parity is opt-in. Set ${ROUTE_PARITY_OPT_IN}=1 before running this suite.`,
    );
  }
}

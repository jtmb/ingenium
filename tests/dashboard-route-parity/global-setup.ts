import { loadProductionArtifactRoutes } from "./route-inventory";
import { productionDashboardUrl, requireRouteParityOptIn } from "./runtime";
import {
  drainGatewayRequestBucket,
  retryExternalSuiteStartupApiPreflight,
} from "../ingenium-dashboard/external-suite-navigation-governor";

/**
 * Read-only preflight for the production artifact/gateway route suite.
 * No API bearer, provider credential, mail account, or mutation request is
 * created here; network access is limited to read-only API health and gateway
 * root GETs.
 */
export default async function routeParityGlobalSetup(): Promise<void> {
  requireRouteParityOptIn();
  const artifact = loadProductionArtifactRoutes();
  const target = productionDashboardUrl(true);

  try {
    const apiHealth = new URL("/api/v1/health", target).toString();
    const apiResponse = await retryExternalSuiteStartupApiPreflight(
      () => fetch(apiHealth, { method: "GET", redirect: "follow" }),
    );
    if (apiResponse.status === 429) {
      throw new Error(`Production dashboard API startup preflight returned HTTP 429 (Retry-After: ${apiResponse.headers.get("retry-after")?.trim() || "missing"})`);
    }
    if (!apiResponse.ok) {
      throw new Error(`Production dashboard API startup preflight returned HTTP ${apiResponse.status}: ${apiHealth}`);
    }

    const response = await fetch(target, { method: "GET", redirect: "follow" });
    if (response.status === 429) {
      throw new Error(`Production dashboard gateway preflight returned HTTP 429 (Retry-After: ${response.headers.get("retry-after")?.trim() || "missing"})`);
    }
    if (!response.ok) {
      throw new Error(`Production dashboard gateway preflight returned HTTP ${response.status}: ${target}`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Production dashboard gateway is unreachable at ${target}: ${reason}`);
  }

  if (artifact.routes.size === 0 || !artifact.buildId) {
    throw new Error(`Production dashboard artifact is incomplete: ${artifact.directory}`);
  }

  await drainGatewayRequestBucket();
}

import { loadProductionArtifactRoutes } from "./route-inventory";
import { productionApiHealthRequest, productionDashboardUrl, requireRouteParityOptIn } from "./runtime";
import {
  drainGatewayRequestBucket,
  retryExternalSuiteStartupApiPreflight,
} from "../ingenium-dashboard/external-suite-navigation-governor";

/**
 * Read-only preflight for the production artifact/gateway route suite.
 * The API bearer is used only by this Node preflight request. It is never
 * installed in a browser context or forwarded to the dashboard gateway.
 */
export default async function routeParityGlobalSetup(): Promise<void> {
  requireRouteParityOptIn();
  const artifact = loadProductionArtifactRoutes();
  const target = productionDashboardUrl(true);

  try {
    const apiHealth = productionApiHealthRequest();
    const apiResponse = await retryExternalSuiteStartupApiPreflight(
      () => fetch(apiHealth.url, { method: "GET", headers: apiHealth.headers, redirect: "follow" }),
    );
    if (apiResponse.status === 429) {
      throw new Error(`Production dashboard API startup preflight returned HTTP 429 (Retry-After: ${apiResponse.headers.get("retry-after")?.trim() || "missing"})`);
    }
    if (!apiResponse.ok) {
      throw new Error(`Production dashboard API startup preflight returned HTTP ${apiResponse.status}: ${apiHealth.url}`);
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

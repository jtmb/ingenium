import { loadProductionArtifactRoutes } from "./route-inventory";
import { productionDashboardUrl, requireRouteParityOptIn } from "./runtime";

/**
 * Read-only preflight for the production artifact/gateway route suite.
 * No API bearer, provider credential, mail account, or mutation request is
 * created here; the only network operation is a GET of the gateway root.
 */
export default async function routeParityGlobalSetup(): Promise<void> {
  requireRouteParityOptIn();
  const artifact = loadProductionArtifactRoutes();
  const target = productionDashboardUrl(true);

  let response: Response;
  try {
    response = await fetch(target, { method: "GET", redirect: "follow" });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Production dashboard gateway is unreachable at ${target}: ${reason}`);
  }

  if (!response.ok) {
    throw new Error(`Production dashboard gateway preflight returned HTTP ${response.status}: ${target}`);
  }

  if (artifact.routes.size === 0 || !artifact.buildId) {
    throw new Error(`Production dashboard artifact is incomplete: ${artifact.directory}`);
  }
}

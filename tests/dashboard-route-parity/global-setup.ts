import fixtureGlobalSetup from "../playwright-global-setup";
import { getDefaultSuiteRuntime } from "../ingenium-dashboard/default-suite-runtime";
import { provisionTestRunBrowserSession, stopRunFromManifest } from "../test-server-lifecycle";
import { productionDashboardUrl, requireRouteParityOptIn } from "./runtime";

/** Start the isolated production-mode fixture before route inspection. */
export default async function routeParityGlobalSetup(): Promise<void> {
  requireRouteParityOptIn();
  await fixtureGlobalSetup();
  const context = getDefaultSuiteRuntime().context;
  try {
    const dashboardHost = new URL(productionDashboardUrl()).hostname;
    if (dashboardHost !== "127.0.0.1" && dashboardHost !== "localhost") {
      throw new Error("Route parity dashboard host escaped the isolated loopback fixture");
    }
    await provisionTestRunBrowserSession(context, dashboardHost);
  } catch (error) {
    try {
      await stopRunFromManifest(context.manifestPath, { cleanup: false });
    } catch (cleanupError) {
      // eslint-disable-next-line no-console
      console.error(`[route-parity] setup cleanup diagnostics: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    }
    throw error;
  }
}

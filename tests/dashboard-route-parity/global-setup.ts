import fixtureGlobalSetup from "../playwright-global-setup";
import { requireRouteParityOptIn } from "./runtime";

/** Start the isolated production-mode fixture before route inspection. */
export default async function routeParityGlobalSetup(): Promise<void> {
  requireRouteParityOptIn();
  await fixtureGlobalSetup();
}

import { defineConfig } from "@playwright/test";
import { productionDashboardUrl } from "./runtime";

/** The exclusive allow-list intentionally selects no legacy dashboard specs. */
export const ROUTE_PARITY_TEST_MATCH = "production-route-parity.spec.ts";

export default defineConfig({
  testDir: ".",
  testMatch: ROUTE_PARITY_TEST_MATCH,
  globalSetup: "./global-setup.ts",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  outputDir: "../../tests/artifacts/playwright/dashboard-route-parity",
  use: {
    // The target must be an already-running production artifact/gateway. This
    // config never invokes `next dev`, `next start`, Docker, or a fixture.
    baseURL: productionDashboardUrl(),
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});

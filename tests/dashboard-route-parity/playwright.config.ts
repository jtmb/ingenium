import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import { getPlaywrightOutputDirectory } from "../test-run-context";
import {
  ROUTE_PARITY_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS,
} from "../ingenium-dashboard/external-suite-navigation-governor";
import { productionDashboardUrl } from "./runtime";
import { getDefaultSuiteRuntime } from "../ingenium-dashboard/default-suite-runtime";
import { getDashboardStorageStatePath } from "../ingenium-dashboard/fixture-credentials";

/** The exclusive allow-list intentionally selects no legacy dashboard specs. */
export const ROUTE_PARITY_TEST_MATCH = "production-route-parity.spec.ts";
const PLAYWRIGHT_REPO_ROOT = resolve(__dirname, "../..");
const runtime = getDefaultSuiteRuntime();

export default defineConfig({
  testDir: ".",
  testMatch: ROUTE_PARITY_TEST_MATCH,
  globalSetup: "./global-setup.ts",
  globalTeardown: "../playwright-global-teardown.ts",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  projects: [{
    name: "dashboard-route-parity",
    metadata: {
      externalSuiteTransitionIntervalMs: ROUTE_PARITY_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS,
    },
  }],
  outputDir: getPlaywrightOutputDirectory("dashboard-route-parity", PLAYWRIGHT_REPO_ROOT),
  use: {
    baseURL: productionDashboardUrl(),
    storageState: getDashboardStorageStatePath(runtime.context),
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});

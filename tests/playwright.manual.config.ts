import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import { getPlaywrightOutputDirectory } from "./test-run-context";
import { externalPlaywrightDefaults } from "./playwright.external-defaults";

const PLAYWRIGHT_REPO_ROOT = resolve(__dirname, "..");

/** Manual visual evidence is never selected by the default Playwright run. */
export default defineConfig({
  ...externalPlaywrightDefaults,
  testMatch: ["**/qa-mail-darkmode-screenshots.spec.ts"],
  globalSetup: "./ingenium-dashboard/manual-global-setup.ts",
  timeout: 60000,
  outputDir: getPlaywrightOutputDirectory("manual", PLAYWRIGHT_REPO_ROOT),
  use: {
    ...externalPlaywrightDefaults.use,
    baseURL: process.env.INGENIUM_E2E_DASHBOARD_URL ?? "http://localhost:3000",
  },
});

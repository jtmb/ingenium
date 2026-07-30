import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import { getPlaywrightOutputDirectory } from "./test-run-context";

const PLAYWRIGHT_REPO_ROOT = resolve(import.meta.dirname, "..");

/** Manual visual evidence is never selected by the default Playwright run. */
export default defineConfig({
  testDir: ".",
  testMatch: ["**/qa-mail-darkmode-screenshots.spec.ts"],
  globalSetup: "./ingenium-dashboard/manual-global-setup.ts",
  timeout: 60000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: getPlaywrightOutputDirectory("manual", PLAYWRIGHT_REPO_ROOT),
  use: {
    baseURL: process.env.INGENIUM_E2E_DASHBOARD_URL ?? "http://localhost:3000",
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});

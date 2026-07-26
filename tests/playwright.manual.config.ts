import { defineConfig } from "@playwright/test";

/** Manual visual evidence is never selected by the default Playwright run. */
export default defineConfig({
  testDir: ".",
  testMatch: ["**/qa-mail-darkmode-screenshots.spec.ts"],
  globalSetup: "./ingenium-dashboard/manual-global-setup.ts",
  timeout: 60000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: "artifacts/playwright/manual",
  use: {
    baseURL: process.env.INGENIUM_E2E_DASHBOARD_URL ?? "http://localhost:3000",
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});

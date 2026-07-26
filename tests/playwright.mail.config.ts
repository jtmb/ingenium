import { defineConfig } from "@playwright/test";

/**
 * Explicit mail-suite config. Mocked mail UI tests and live mail tests share
 * this allow-list, but neither is part of the default deterministic run.
 * Live-account failures are test failures; there are no conditional skips.
 */
export default defineConfig({
  testDir: ".",
  testMatch: [
    "**/ingenium-dashboard/mail.spec.ts",
    "**/ingenium-dashboard/mail-reclick-loading.spec.ts",
    "**/ingenium-dashboard/mail-no-resync.spec.ts",
    "**/ingenium-dashboard/mail-cache-warm.spec.ts",
    "**/ingenium-dashboard/mail-oauth-recovery.spec.ts",
    "**/ingenium-dashboard/mail-reply-forward.spec.ts",
    "**/ingenium-dashboard/mail-html-safety.spec.ts",
  ],
  globalSetup: "./ingenium-dashboard/mail-global-setup.ts",
  timeout: 120000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: "artifacts/playwright/mail",
  use: {
    baseURL: process.env.INGENIUM_E2E_DASHBOARD_URL ?? "http://localhost:3000",
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});

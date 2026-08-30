import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import { getPlaywrightOutputDirectory } from "./test-run-context";
import { externalPlaywrightDefaults } from "./playwright.external-defaults";

const PLAYWRIGHT_REPO_ROOT = resolve(__dirname, "..");

/**
 * Explicit mail-suite config. Mocked mail UI tests and live mail tests share
 * this allow-list, but neither is part of the default deterministic run.
 * Live-account failures are test failures; there are no conditional skips.
 */
export default defineConfig({
  ...externalPlaywrightDefaults,
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
  outputDir: getPlaywrightOutputDirectory("mail", PLAYWRIGHT_REPO_ROOT),
  use: {
    ...externalPlaywrightDefaults.use,
    baseURL: process.env.INGENIUM_E2E_DASHBOARD_URL ?? "http://localhost:3000",
  },
});

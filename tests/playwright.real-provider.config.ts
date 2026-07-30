import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import { getPlaywrightOutputDirectory } from "./test-run-context";

const PLAYWRIGHT_REPO_ROOT = resolve(import.meta.dirname, "..");

/**
 * Playwright E2E test configuration for real-provider smoke tests.
 *
 * This config is for the real-provider smoke suite only. It does not start
 * Docker or any web servers; the requested provider environment must already
 * be running.
 *
 * Key differences from the main playwright.config.ts:
 * - No webServer entries (Docker handles everything)
 * - No TEST_DB_PATH / TEST_PROJECT / TEST_TMP (Docker manages the DB)
 * - baseURL is configurable for an authenticated external deployment
 * - Longer timeouts (3 min test, 2 min expect) for real LLM calls
 * - fullyParallel: false — one test at a time to avoid session races
 *
 * Run with:
 *   npx playwright test --config=tests/playwright.real-provider.config.ts
 */

export default defineConfig({
  testDir: ".",
  testMatch: ["**/ingenium-dashboard/chat-real-provider.smoke.spec.ts"],
  globalSetup: "./ingenium-dashboard/provider-global-setup.ts",
  timeout: 180000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: getPlaywrightOutputDirectory("real-provider", PLAYWRIGHT_REPO_ROOT),
  use: {
    baseURL: process.env.INGENIUM_E2E_DASHBOARD_URL ?? "http://localhost:3000",
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Generous timeout for expect() assertions — real LLM responses can be slow
    actionTimeout: 120000,
  },
  expect: {
    timeout: 120000,
  },
});

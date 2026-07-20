import { defineConfig } from "@playwright/test";

/**
 * Playwright E2E test configuration for real-provider smoke tests.
 *
 * This config is for smoke tests that require a fully running Docker
 * deployment (API, Dashboard, OpenCode, etc.). It does NOT start any
 * webServer entries — the Docker container provides all services.
 *
 * Key differences from the main playwright.config.ts:
 * - No webServer entries (Docker handles everything)
 * - No TEST_DB_PATH / TEST_PROJECT / TEST_TMP (Docker manages the DB)
 * - baseURL hardcoded to http://localhost:3000
 * - Longer timeouts (3 min test, 2 min expect) for real LLM calls
 * - fullyParallel: false — one test at a time to avoid session races
 *
 * Run with:
 *   npx playwright test --config=tests/playwright.real-provider.config.ts
 */

export default defineConfig({
  testDir: ".",
  timeout: 180000,
  retries: 1,
  fullyParallel: false,
  outputDir: "./tests/test-results",
  use: {
    baseURL: "http://localhost:3000",
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

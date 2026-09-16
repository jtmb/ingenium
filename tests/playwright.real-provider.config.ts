import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import { getPlaywrightOutputDirectory } from "./test-run-context";
import { externalPlaywrightDefaults } from "./playwright.external-defaults";

const PLAYWRIGHT_REPO_ROOT = resolve(import.meta.dirname, "..");

/**
 * Playwright E2E test configuration for real-provider smoke tests.
 *
 * This config is for the real-provider smoke suite only. It does not start
 * Docker or any web servers; the configured provider service must already be
 * available.
 *
 * Key differences from the main playwright.config.ts:
 * - No webServer entries (Docker handles everything)
 * - No fixture database is started; provider setup owns the external state
 * - baseURL is configurable for an authenticated external deployment
 * - Longer timeouts (3 min test, 2 min expect) for real LLM calls
 * - fullyParallel: false — one test at a time to avoid session races
 *
 * Run with:
 *   npx playwright test --config=tests/playwright.real-provider.config.ts
 */

export default defineConfig({
  ...externalPlaywrightDefaults,
  testMatch: ["**/ingenium-dashboard/chat-real-provider.smoke.spec.ts"],
  globalSetup: "./ingenium-dashboard/provider-global-setup.ts",
  timeout: 180000,
  outputDir: getPlaywrightOutputDirectory("real-provider", PLAYWRIGHT_REPO_ROOT),
  use: {
    ...externalPlaywrightDefaults.use,
    baseURL: process.env.INGENIUM_E2E_DASHBOARD_URL ?? "http://localhost:3000",
    // Provider responses may exceed normal UI interaction timing.
    actionTimeout: 120000,
  },
  expect: {
    timeout: 120000,
  },
});

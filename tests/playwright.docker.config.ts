import { defineConfig } from "@playwright/test";

/**
 * Docker-backed Playwright config for OpenCode integration tests.
 * Assumes Docker is running the full stack (API :4097, Dashboard :3000, OpenCode :4098).
 * Does NOT start its own web servers — tests run against the Docker-managed services.
 */
export default defineConfig({
  testDir: "./ingenium-dashboard",
  testMatch: "opencode*.spec.ts",
  timeout: 30000,
  retries: 0,
  fullyParallel: false,
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // No webServer config — Docker provides all services
});

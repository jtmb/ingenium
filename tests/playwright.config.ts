import { defineConfig } from "@playwright/test";

/**
 * Playwright E2E test configuration for the Ingenium Dashboard.
 *
 * Starts both the API server (port 4097) and the Next.js dashboard (port 3000)
 * as managed web servers, then runs tests in the tests/ directory.
 */
export default defineConfig({
  testDir: ".",
  timeout: 15000,
  retries: 1,
  fullyParallel: false,
  outputDir: "./tests/test-results",
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command:
        "INGENIUM_CORE_DB_PATH=/home/brajam/repos/gh-llm-bootstrap/.ingenium/data NODE_ENV=production npx tsx /home/brajam/repos/gh-llm-bootstrap/services/ingenium-api/scripts/api-server.ts",
      port: 4097,
      timeout: 15000,
      reuseExistingServer: true,
    },
    {
      command:
        "cd services/ingenium-dashboard && NODE_ENV=development npx next dev --port 3000",
      port: 3000,
      timeout: 30000,
      reuseExistingServer: true,
    },
  ],
});

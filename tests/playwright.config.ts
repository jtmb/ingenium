import { defineConfig } from "@playwright/test";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Playwright E2E test configuration for the Ingenium Dashboard.
 *
 * Derives workspace paths dynamically (no hardcoded /home/brajam paths).
 * Creates an isolated temporary DB and test project so tests never
 * mutate the developer's real database.
 *
 * Starts both the API server (port 4097) and the Next.js dashboard (port 3000)
 * as managed web servers with bounded lifecycles.
 *
 * Set INGENIUM_PLAYWRIGHT_REPO_ROOT to override repo-root discovery
 * (defaults to process.cwd() — run from repo root).
 */

// Resolve repo root: respect env override, then cwd (assumes run from repo root)
const REPO_ROOT = process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT
  ? resolve(process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT)
  : process.cwd();

// Create a dedicated temp directory for this test run's database
const TEST_TMP = mkdtempSync(join(tmpdir(), "ingenium-playwright-"));
const TEST_DB_DIR = join(TEST_TMP, ".ingenium");
if (!existsSync(TEST_DB_DIR)) {
  mkdirSync(TEST_DB_DIR, { recursive: true });
}
const TEST_DB_PATH = join(TEST_TMP, ".ingenium", "data.db");

// Unique project name per run to avoid collisions
const TEST_PROJECT = `playwright-test-${randomUUID().slice(0, 8)}`;

// Log the temp paths for debugging
// eslint-disable-next-line no-console
console.log(`[playwright] REPO_ROOT   = ${REPO_ROOT}`);
// eslint-disable-next-line no-console
console.log(`[playwright] TEST_DB_PATH = ${TEST_DB_PATH}`);
// eslint-disable-next-line no-console
console.log(`[playwright] TEST_PROJECT = ${TEST_PROJECT}`);

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
      command: [
        `INGENIUM_CORE_DB_PATH="${TEST_DB_PATH}"`,
        `INGENIUM_HOME="${TEST_TMP}/.ingenium"`,
        `INGENIUM_PROJECT="${TEST_PROJECT}"`,
        `NODE_ENV=production`,
        `npx tsx "${REPO_ROOT}/services/ingenium-api/scripts/api-server.ts"`,
      ].join(" "),
      port: 4097,
      timeout: 15000,
      reuseExistingServer: false,
    },
    {
      command: [
        `INGENIUM_CORE_DB_PATH="${TEST_DB_PATH}"`,
        `INGENIUM_HOME="${TEST_TMP}/.ingenium"`,
        `NODE_ENV=development`,
      ].join(" ") + ` && npx next dev --port 3000`,
      cwd: resolve(REPO_ROOT, "services", "ingenium-dashboard"),
      port: 3000,
      timeout: 30000,
      reuseExistingServer: false,
    },
  ],
});

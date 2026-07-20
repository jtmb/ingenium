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
 * Starts both the API server and the Next.js dashboard as managed web
 * servers with bounded lifecycles.
 *
 * Port selection:
 * - Default: API on :4097, Dashboard on :3000
 * - With INGENIUM_E2E_API_PORT / INGENIUM_E2E_DASH_PORT: use custom ports
 *   (useful when Docker already occupies :3000/:4097)
 *
 * Chat E2E fixture:
 * - Set OPENCODE_SERVER_URL=http://localhost:4999 to route OpenCode requests
 *   to the fixture server instead of the real OpenCode backend
 * - Set OPENCODE_SERVER_PASSWORD=test-fixture so the API can authenticate
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

// Allow custom ports via env vars (Docker occupies default 3000/4097)
const API_PORT = process.env.INGENIUM_E2E_API_PORT
  ? parseInt(process.env.INGENIUM_E2E_API_PORT, 10)
  : 4097;
const DASH_PORT = process.env.INGENIUM_E2E_DASH_PORT
  ? parseInt(process.env.INGENIUM_E2E_DASH_PORT, 10)
  : 3000;

// Log the temp paths for debugging
// eslint-disable-next-line no-console
console.log(`[playwright] REPO_ROOT   = ${REPO_ROOT}`);
// eslint-disable-next-line no-console
console.log(`[playwright] TEST_DB_PATH = ${TEST_DB_PATH}`);
// eslint-disable-next-line no-console
console.log(`[playwright] TEST_PROJECT = ${TEST_PROJECT}`);
// eslint-disable-next-line no-console
console.log(`[playwright] API_PORT     = ${API_PORT}`);
// eslint-disable-next-line no-console
console.log(`[playwright] DASH_PORT    = ${DASH_PORT}`);

export default defineConfig({
  testDir: ".",
  timeout: 15000,
  retries: 1,
  fullyParallel: false,
  outputDir: "./tests/test-results",
  use: {
    baseURL: `http://localhost:${DASH_PORT}`,
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `npx tsx "${REPO_ROOT}/services/ingenium-api/scripts/api-server.ts"`,
      env: {
        INGENIUM_CORE_DB_PATH: TEST_DB_PATH,
        INGENIUM_HOME: `${TEST_TMP}/.ingenium`,
        INGENIUM_PROJECT: TEST_PROJECT,
        INGENIUM_API_PORT: String(API_PORT),
        CORS_ORIGIN: `http://localhost:${DASH_PORT}`,
        NODE_ENV: "production",
        OPENCODE_SERVER_URL: "http://localhost:4999",
        OPENCODE_SERVER_PASSWORD: "test-fixture",
      },
      port: API_PORT,
      timeout: 15000,
      reuseExistingServer: false,
    },
    {
      command: `npx next dev --port ${DASH_PORT}`,
      cwd: resolve(REPO_ROOT, "services", "ingenium-dashboard"),
      env: {
        INGENIUM_CORE_DB_PATH: TEST_DB_PATH,
        INGENIUM_HOME: `${TEST_TMP}/.ingenium`,
        INGENIUM_API_PORT: String(API_PORT),
        NODE_ENV: "development",
        PORT: String(DASH_PORT),
      },
      port: DASH_PORT,
      timeout: 30000,
      reuseExistingServer: false,
    },
    {
      command: `npx tsx "${REPO_ROOT}/tests/chat-fixture-server.ts"`,
      port: 4999,
      timeout: 5000,
      reuseExistingServer: false,
    },
  ],
});

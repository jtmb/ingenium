import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import { getPlaywrightOutputDirectory } from "./test-run-context";

const PLAYWRIGHT_REPO_ROOT = resolve(import.meta.dirname, "..");

/**
 * Docker-backed Playwright config for live-system integration tests.
 *
 * This config never starts Docker itself. It is explicit opt-in and fails in
 * global setup if the requested Docker services are not reachable.
 */
export default defineConfig({
  testDir: ".",
  testMatch: [
    "**/ingenium-dashboard/opencode.spec.ts",
    "**/ingenium-dashboard/opencode-chat.spec.ts",
    "**/ingenium-dashboard/opencode-switch.spec.ts",
    "**/ingenium-dashboard/ttyd-websocket.spec.ts",
    "**/ingenium-dashboard/integration.spec.ts",
    "**/ingenium-dashboard/all-pages.spec.ts",
    "**/ingenium-dashboard/secrets-production.spec.ts",
  ],
  globalSetup: "./ingenium-dashboard/docker-global-setup.ts",
  timeout: 60000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: getPlaywrightOutputDirectory("docker", PLAYWRIGHT_REPO_ROOT),
  use: {
    baseURL: process.env.INGENIUM_E2E_DASHBOARD_URL ?? "http://localhost:3000",
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // No webServer config — an already-running Docker deployment provides all services.
});

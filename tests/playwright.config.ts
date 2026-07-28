import { defineConfig } from "@playwright/test";
import {
  cleanupTestRun,
  readTestRunManifest,
  TEST_RUN_MANIFEST_ENV,
} from "./test-run-context";
import { getDefaultSuiteRuntime } from "./ingenium-dashboard/default-suite-runtime";

/**
 * Playwright E2E configuration for the isolated fixture run.
 *
 * The runner owns one temp directory, one manifest, and one high-port block
 * per invocation. Global setup starts production API/dashboard processes plus
 * the chat fixture; global teardown stops exact manifest PIDs and removes only
 * the manifest's realpath-validated run directory.
 *
 * `INGENIUM_E2E_SKIP_BUILD=1` is an explicit local optimization for a caller
 * that has already built the production artifacts. It never changes the
 * server mode: the dashboard still runs `next start`, not `next dev`.
 */
// `--list`, config errors, and worker bootstrap failures can exit before
// Playwright invokes global teardown. The synchronous exit hook removes only
// this manifest-owned directory; normal teardown remains responsible for
// processes and ports first.
process.once("exit", () => {
  try {
    const manifestPath = process.env[TEST_RUN_MANIFEST_ENV];
    if (!manifestPath) return;
    // A worker may load the serialized config in its own process. Once setup
    // has begun, only global teardown owns cleanup of the running services.
    if (readTestRunManifest(manifestPath).status === "created") {
      cleanupTestRun(manifestPath);
    }
  } catch {
    // Never replace the runner's original exit status with cleanup noise.
  }
});

const runtime = getDefaultSuiteRuntime();
const context = runtime.context;

// eslint-disable-next-line no-console
console.log(`[playwright] run=${context.runId} manifest=${context.manifestPath}`);
// eslint-disable-next-line no-console
console.log(`[playwright] api=${context.ports.api} dashboard=${context.ports.dashboard} fixture=${context.ports.fixture}`);

export default defineConfig({
  testDir: ".",
  // Explicit deterministic allow-list. Docker, live-provider, live-mail, and
  // manual visual suites are selected only by their dedicated configs. The
  // current Context contract remains in mcp-tools.spec.ts; retired learning,
  // archive, and server page suites are intentionally not selected.
  testMatch: [
    "**/mcp-tools.spec.ts",
    "**/ingenium-dashboard/mcp-tool-controls.spec.ts",
    "**/ingenium-dashboard/homepage.spec.ts",
    "**/ingenium-dashboard/dashboard.spec.ts",
    "**/ingenium-dashboard/docs-ai.spec.ts",
    "**/ingenium-dashboard/chat-states.spec.ts",
    "**/ingenium-dashboard/chat-e2e-smoke.spec.ts",
    "**/ingenium-dashboard/opencode-chat.spec.ts",
    "**/ingenium-dashboard/jobs.spec.ts",
    "**/ingenium-dashboard/pipeline.spec.ts",
    "**/ingenium-dashboard/settings-providers.spec.ts",
    "**/ingenium-dashboard/vault-first-run.spec.ts",
    "**/ingenium-dashboard/lan-api-assertions.spec.ts",
    "**/ingenium-dashboard/theme-flash.spec.ts",
    "**/ingenium-dashboard/usage.spec.ts",
  ],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // Fixture state is intentionally single-writer. Retries are disabled so a
  // failed run cannot silently reuse a session or hide a lifecycle leak.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  outputDir: "artifacts/playwright/default",
  globalSetup: "./playwright-global-setup.ts",
  globalTeardown: "./playwright-global-teardown.ts",
  use: {
    baseURL: runtime.dashboardUrl,
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});

import { cleanupStaleTestRuns, readTestRunManifest } from "./test-run-context";
import { getDefaultSuiteRuntime } from "./ingenium-dashboard/default-suite-runtime";
import {
  installRunSignalHandlers,
  startTestServers,
  stopRunFromManifest,
} from "./test-server-lifecycle";

/**
 * Own the complete fixture run instead of delegating it to watcher-oriented
 * Playwright webServer commands. The manifest is the hand-off between setup,
 * workers, teardown, and signal handling.
 */
export default async function globalSetup(): Promise<void> {
  const runtime = getDefaultSuiteRuntime();
  const context = runtime.context;
  const staleRuns = cleanupStaleTestRuns({ excludeRunId: context.runId });
  if (staleRuns.skipped.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[playwright] retained ${staleRuns.skipped.length} unverified stale temp entries`);
  }
  installRunSignalHandlers(context.manifestPath);
  try {
    await startTestServers(context, {
      production: true,
      build: process.env.INGENIUM_E2E_SKIP_BUILD !== "1",
      dashboardEnvironment: runtime.dashboardEnvironment,
    });
    const started = readTestRunManifest(context.manifestPath);
    if (started.project !== context.project || !started.projectProvisionedAt) {
      throw new Error("Default Playwright fixture did not provision its manifest-owned project");
    }
  } catch (error) {
    try {
      await stopRunFromManifest(context.manifestPath);
    } catch (cleanupError) {
      // Keep the startup failure as the thrown error, but do not discard
      // process/port diagnostics from the mandatory cleanup attempt.
      // eslint-disable-next-line no-console
      console.error(`[playwright] setup cleanup diagnostics: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    }
    throw error;
  }
}

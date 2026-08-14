import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDefaultSuiteRuntime } from "./ingenium-dashboard/default-suite-runtime";
import { cleanupStaleTestRuns, readTestRunManifest } from "./test-run-context";
import { startTestServers, stopRunFromManifest } from "./test-server-lifecycle";

const DEFAULT_LEASE_SECONDS = 1_800;
const MAX_LEASE_SECONDS = 3_600;

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function leaseSeconds(): number {
  const value = Number(option("--timeout-seconds") ?? DEFAULT_LEASE_SECONDS);
  if (!Number.isInteger(value) || value < 60 || value > MAX_LEASE_SECONDS) {
    throw new Error(`--timeout-seconds must be an integer from 60 to ${MAX_LEASE_SECONDS}`);
  }
  return value;
}

async function stop(manifestPath: string): Promise<void> {
  if (!existsSync(manifestPath)) return;
  await stopRunFromManifest(manifestPath, { cleanup: true });
}

function startGuardian(manifestPath: string, timeoutSeconds: number): void {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of ["HOME", "LANG", "LC_ALL", "PATH", "TEMP", "TMP", "TMPDIR", "TZ", "USER"]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  const guardian = spawn(process.execPath, [
    "--import", "tsx", fileURLToPath(import.meta.url), "guard",
    "--manifest", manifestPath,
    "--timeout-seconds", String(timeoutSeconds),
  ], {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    env: environment,
    stdio: "ignore",
  });
  if (!guardian.pid) throw new Error("Visual fixture cleanup guardian did not start");
  guardian.unref();
}

async function start(): Promise<void> {
  const runtime = getDefaultSuiteRuntime();
  const context = runtime.context;
  cleanupStaleTestRuns({ excludeRunId: context.runId });
  try {
    await startTestServers(context, {
      production: true,
      build: true,
      dashboardEnvironment: runtime.dashboardEnvironment,
      detachAfterStart: true,
    });
    const started = readTestRunManifest(context.manifestPath);
    if (started.status !== "running" || !started.projectProvisionedAt) {
      throw new Error("Visual fixture did not reach its authenticated running state");
    }
    const timeoutSeconds = leaseSeconds();
    startGuardian(context.manifestPath, timeoutSeconds);
    process.stdout.write(`${JSON.stringify({
      runId: context.runId,
      url: `http://localhost:${context.ports.dashboard}/test-fixture/session`,
      timeoutSeconds,
      cleanup: `npx tsx tests/visual-fixture.ts stop --manifest ${context.manifestPath}`,
    })}\n`);
  } catch (error) {
    await stop(context.manifestPath).catch(() => undefined);
    throw error;
  }
}

async function guard(manifestPath: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, leaseSeconds() * 1_000));
  await stop(manifestPath);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const manifestPath = option("--manifest");
  if (command === "start") await start();
  else if (command === "stop" && manifestPath) await stop(manifestPath);
  else if (command === "guard" && manifestPath) await guard(manifestPath);
  else throw new Error("Usage: visual-fixture.ts start [--timeout-seconds 1800] | stop --manifest <path>");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

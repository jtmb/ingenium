import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { createConnection } from "node:net";
import { basename, join } from "node:path";
import {
  cleanupTestRun,
  getPortEnvironment,
  getTestRunTelemetryPath,
  markTestRunRecovered,
  markTestRunProcessCleared,
  recordTestRunTelemetryFailure,
  readTestRunManifest,
  readTestRunTelemetry,
  releaseTestRunPortReservations,
  transferTestRunPortOwnership,
  type TestRunContext,
  type TestRunManifest,
  type TestRunProcess,
  updateTestRunManifest,
} from "./test-run-context";
import {
  capturePreexistingProcessBaseline,
  inspectProcessIdentity,
  readProcStat,
  type ProcessIdentity,
} from "./test-run-process-discovery";
import { writeDashboardStorageState } from "./ingenium-dashboard/fixture-credentials";
import {
  FIXTURE_INTERNAL_SERVICE_HEADER,
  TEST_API_TOKEN,
  testRunApiAuthHeaders,
} from "./fixture-api-auth";

export { inspectProcessIdentity, type ProcessIdentity } from "./test-run-process-discovery";
export { FIXTURE_INTERNAL_SERVICE_HEADER, TEST_API_TOKEN } from "./fixture-api-auth";

export const SERVER_START_TIMEOUT_MS = 45_000;
export const SERVER_STOP_TIMEOUT_MS = 8_000;
export const PRODUCTION_BUILD_TIMEOUT_MS = 180_000;
export const READINESS_REQUEST_TIMEOUT_MS = 1_000;
export const FIXTURE_PROJECT_PROVISION_TIMEOUT_MS = 5_000;
// The serialized fixture suite creates deliberate browser/API traffic. Keep
// this bounded override local to its isolated API process; production retains
// the configured default of 100 requests/minute.
export const FIXTURE_API_RATE_LIMIT = 1_000;
export const FIXTURE_OWNER_EMAIL = "playwright-owner@example.test";
export const FIXTURE_OWNER_PASSWORD = "Playwright-fixture-password-2026!";

interface CommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
}

export interface ServerSpec {
  name: "api" | "dashboard" | "fixture";
  port: number;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  readinessUrl: string;
  readinessHeaders?: Record<string, string>;
}

interface RunningServer {
  spec: ServerSpec;
  child: ChildProcess;
  record: TestRunProcess;
}

interface CapturedChildGroupIdentity {
  leaderPid: number;
  leaderStartTime: string;
  pgid: number;
  groupIdentity: string;
}

// A detached child can exit and be reaped before its PID can be inspected
// again. Keep the first child-associated leader and group start times observed
// at spawn time. A bare PGID is not sufficient: after the leader exits, a
// reused PGID could otherwise be mistaken for the original run's group.
const capturedChildGroupIdentities = new WeakMap<ChildProcess, CapturedChildGroupIdentity>();

export interface TestServerLifecycleOptions {
  production?: boolean;
  build?: boolean;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  buildTimeoutMs?: number;
  readinessRequestTimeoutMs?: number;
  spawnServer?: (spec: ServerSpec) => ChildProcess;
  /** Server-only dashboard credential produced by the suite runtime. */
  dashboardEnvironment?: Readonly<Record<string, string>>;
  /** Release parent stdio/handles after a manifest-owned external lease starts. */
  detachAfterStart?: boolean;
  /**
   * Test-only failure injection for the first durable process-record hand-off.
   * The default remains the real run-context writer.
   */
  updateManifest?: typeof updateTestRunManifest;
  /**
   * Test-only hook that runs after a child has spawned and before its
   * provisional record is persisted. It is intentionally awaitable so tests
   * can prove that a listener is live before forcing the persistence failure.
   */
  beforeInitialProcessRecordPersist?: (input: {
    child: ChildProcess;
    spec: ServerSpec;
    record: TestRunProcess;
  }) => void | Promise<void>;
}

export interface StopRunOptions {
  stopTimeoutMs?: number;
  cleanup?: boolean;
}

/**
 * Create the manifest-owned project through the same authenticated API that
 * the fixture exercises. A 200 means an interrupted setup already created
 * this exact run project, so it is the idempotent success case.
 */
export async function provisionTestRunProject(
  context: TestRunContext,
  timeoutMs = FIXTURE_PROJECT_PROVISION_TIMEOUT_MS,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `http://127.0.0.1:${context.ports.api}/api/v1/auth/fixture-bootstrap`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: testRunApiAuthHeaders(context),
      signal: controller.signal,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to provision fixture project ${context.project}: ${reason}`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`Unable to provision fixture project ${context.project}: API returned ${response.status}`);
  }

  // The run directory, database, and this manifest entry share one lifecycle:
  // a successful teardown removes all three. Retained runs keep the timestamp
  // as recovery evidence rather than redirecting fixture writes elsewhere.
  updateTestRunManifest(context.manifestPath, {
    projectProvisionedAt: new Date().toISOString(),
  });
}

function cookieFromResponse(response: Response, name: string): string {
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  const prefix = `${name}=`;
  if (!cookie?.startsWith(prefix) || cookie.length === prefix.length) {
    throw new Error(`Fixture authentication did not return ${name}`);
  }
  return cookie.slice(prefix.length);
}

async function fixtureRequest(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(FIXTURE_PROJECT_PROVISION_TIMEOUT_MS) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to authenticate fixture dashboard: ${reason}`);
  }
}

export async function provisionTestRunOwner(context: TestRunContext): Promise<void> {
  const apiBase = `http://127.0.0.1:${context.ports.api}/api/v1`;
  const operatorHeaders = { ...testRunApiAuthHeaders(context), "Content-Type": "application/json" };
  const claim = await fixtureRequest(`${apiBase}/bootstrap/claim`, {
    method: "POST",
    headers: operatorHeaders,
    body: JSON.stringify({ email: FIXTURE_OWNER_EMAIL, displayName: "Playwright Owner", password: FIXTURE_OWNER_PASSWORD }),
  });
  if (claim.status !== 201 && claim.status !== 409) {
    throw new Error(`Unable to claim fixture installation: API returned ${claim.status}`);
  }
}

export async function createTestRunBrowserStorageState(context: TestRunContext) {
  const apiBase = `http://127.0.0.1:${context.ports.api}/api/v1`;
  const session = await fixtureRequest(`${apiBase}/auth/fixture-session`, {
    method: "POST",
    headers: testRunApiAuthHeaders(context),
  });
  if (!session.ok) throw new Error(`Unable to create fixture dashboard session: API returned ${session.status}`);
  const sessionToken = cookieFromResponse(session, "__Host-ingenium_session");
  return {
    cookies: [{
      name: "__Host-ingenium_session",
      value: sessionToken,
      domain: "127.0.0.1",
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    }],
    origins: [],
  };
}

export async function provisionTestRunBrowserSession(context: TestRunContext): Promise<string> {
  return writeDashboardStorageState(context, await createTestRunBrowserStorageState(context), true);
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function nodeModuleBin(repoRoot: string, name: string): string {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  return join(repoRoot, "node_modules", ".bin", `${name}${suffix}`);
}

const INHERITED_ENV_ALLOWLIST = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "PATH",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "USER",
  "USERNAME",
] as const;

function allowlistedEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of INHERITED_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  // Only call sites in this file provide `extra`; unlike a parent-env spread,
  // this makes every credential crossing the process boundary reviewable.
  for (const [key, value] of Object.entries(extra)) environment[key] = value;
  return environment;
}

function serverEnvironment(context: TestRunManifest, extra: Record<string, string>): NodeJS.ProcessEnv {
  return allowlistedEnvironment({
    ...getPortEnvironment(context),
    INGENIUM_CORE_DB_PATH: context.dbPath,
    INGENIUM_HOME: context.homeDir,
    INGENIUM_PROJECT: context.project,
    INGENIUM_TEST_RUN_NONCE: context.runNonce,
    INGENIUM_API_PORT: String(context.ports.api),
    DASHBOARD_ALLOWED_ORIGINS: `http://127.0.0.1:${context.ports.dashboard},http://localhost:${context.ports.dashboard}`,
    NODE_ENV: "production",
    ...extra,
  });
}

export function getServerSpecs(
  context: TestRunContext,
  production = true,
  dashboardEnvironment: Readonly<Record<string, string>> = {},
): ServerSpec[] {
  const tsx = nodeModuleBin(context.repoRoot, "tsx");
  const next = nodeModuleBin(context.repoRoot, "next");
  const apiEntry = join(context.repoRoot, "services", "ingenium-api", "dist", "scripts", "api-server.js");
  const dashboardDir = join(context.repoRoot, "services", "ingenium-dashboard");

  return [
    {
      name: "api",
      port: context.ports.api,
      command: production ? process.execPath : tsx,
      args: production ? [apiEntry] : [join(context.repoRoot, "services", "ingenium-api", "scripts", "api-server.ts")],
      cwd: context.repoRoot,
      env: serverEnvironment(context, {
        OPENCODE_SERVER_URL: `http://127.0.0.1:${context.ports.fixture}`,
        OPENCODE_SERVER_PASSWORD: "test-fixture",
        INGENIUM_API_TOKEN: TEST_API_TOKEN,
        INGENIUM_API_TEST_MODE: "1",
        INGENIUM_API_DISABLE_BACKGROUND_SCHEDULERS: "1",
        INGENIUM_API_DISABLE_SCHEDULERS: "1",
        INGENIUM_API_DISABLE_MAIL_MAINTENANCE: "1",
        INGENIUM_API_DISABLE_MAIL: "1",
        INGENIUM_API_RATE_LIMIT: String(FIXTURE_API_RATE_LIMIT),
      }),
      readinessUrl: `http://127.0.0.1:${context.ports.api}/api/v1/health`,
      readinessHeaders: testRunApiAuthHeaders(context),
    },
    {
      name: "dashboard",
      port: context.ports.dashboard,
      command: next,
      args: production
        ? ["start", "--hostname", "127.0.0.1", "--port", String(context.ports.dashboard)]
        : ["dev", "--hostname", "127.0.0.1", "--port", String(context.ports.dashboard)],
      cwd: dashboardDir,
      env: serverEnvironment(context, {
        INGENIUM_API_TEST_MODE: "1",
        PORT: String(context.ports.dashboard),
        ...Object.fromEntries(
          Object.entries(dashboardEnvironment).filter(([key]) => key !== "INGENIUM_API_TOKEN"),
        ),
        NEXT_TELEMETRY_DISABLED: "1",
      }),
      readinessUrl: `http://127.0.0.1:${context.ports.dashboard}/`,
    },
    {
      name: "fixture",
      port: context.ports.fixture,
      command: tsx,
      args: [join(context.repoRoot, "tests", "chat-fixture-server.ts")],
      cwd: context.repoRoot,
      env: serverEnvironment(context, {
        CHAT_FIXTURE_PORT: String(context.ports.fixture),
        CHAT_FIXTURE_RUNNER: "1",
      }),
      readinessUrl: `http://127.0.0.1:${context.ports.fixture}/provider`,
    },
  ];
}

function appendOutput(buffer: { value: string }, chunk: Buffer | string): void {
  const text = chunk.toString();
  buffer.value = `${buffer.value}${text}`.slice(-32_000);
}

/**
 * Capture the PGID and leader/group start identity belonging to a spawned
 * detached child before it can exit.
 *
 * A PGID is useful for recovery only when the child is the group leader. A
 * child that was not detached must not turn the runner's own process group
 * into a signal target, so those groups are deliberately not recorded.
 */
export function captureSpawnedChildPgid(child: ChildProcess): number | undefined {
  const captured = capturedChildGroupIdentities.get(child);
  if (captured !== undefined) return captured.pgid;
  if (process.platform === "win32" || child.pid === undefined || child.pid === process.pid) return undefined;

  const stat = readProcStat(child.pid);
  if (!stat || stat.pgid !== child.pid || stat.pgid <= 1 || stat.pgid === process.pid) return undefined;
  const groupStat = readProcStat(stat.pgid);
  if (!groupStat || groupStat.pgid !== stat.pgid) return undefined;
  const identity: CapturedChildGroupIdentity = {
    leaderPid: child.pid,
    leaderStartTime: stat.startTime,
    pgid: stat.pgid,
    groupIdentity: `${stat.pgid}:${groupStat.startTime}`,
  };
  capturedChildGroupIdentities.set(child, identity);
  return identity.pgid;
}

async function waitForFinalProcessIdentity(pid: number, runNonce?: string): Promise<ProcessIdentity | undefined> {
  let lastIdentity: ProcessIdentity | undefined;
  // `node_modules/.bin/*` launchers use `/usr/bin/env node`. Do not record the
  // short-lived launcher executable because it would fail the later exact
  // executable check after exec() replaces it with Node.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const identity = inspectProcessIdentity(pid);
    if (!identity) return lastIdentity;
    if (runNonce !== undefined && identity.runNonce !== runNonce) return identity;
    lastIdentity = identity;
    if (basename(identity.executable) !== "env") return identity;
    await wait(25);
  }
  return lastIdentity;
}

export interface ProcessSignalValidation {
  valid: boolean;
  reason?: string;
}

function executableMatches(expected: string, current: string): boolean {
  if (expected === current) return true;
  if (basename(expected) !== "env") return false;
  try {
    return current === realpathSync(process.execPath);
  } catch {
    return false;
  }
}

export function validateProcessIdentity(
  manifest: TestRunManifest,
  processRecord: TestRunProcess,
): ProcessSignalValidation {
  if (processRecord.identityState === "provisional") {
    return { valid: false, reason: "process identity is provisional" };
  }
  if (processRecord.runNonce !== manifest.runNonce) return { valid: false, reason: "run nonce mismatch" };
  if (processRecord.pid === process.pid) return { valid: false, reason: "refusing to signal the test runner" };
  if (process.platform === "win32") {
    return { valid: false, reason: "process identity validation is unavailable on win32" };
  }
  const current = inspectProcessIdentity(processRecord.pid);
  if (!current) return { valid: false, reason: "process identity is no longer observable" };
  if (current.runNonce !== manifest.runNonce) return { valid: false, reason: "live process nonce mismatch" };
  if (current.pidStartTime !== processRecord.pidStartTime) return { valid: false, reason: "PID start time mismatch" };
  if (current.pgid !== processRecord.pgid || processRecord.pgid !== processRecord.pid) {
    return { valid: false, reason: "process group identity mismatch" };
  }
  if (!executableMatches(processRecord.executable, current.executable)) {
    return { valid: false, reason: "executable mismatch" };
  }
  if (current.groupIdentity !== processRecord.groupIdentity) return { valid: false, reason: "process group leader mismatch" };
  return { valid: true };
}

function signalProcess(
  manifest: TestRunManifest,
  processRecord: TestRunProcess,
  signal: NodeJS.Signals,
): void {
  const validation = validateProcessIdentity(manifest, processRecord);
  if (!validation.valid) throw new Error(`Refusing to signal ${processRecord.name}: ${validation.reason}`);
  try {
    // Servers are detached process groups, so a shell child or Next worker
    // cannot survive bounded teardown. The group leader/start-time checks
    // above make this negative-PGID signal safe against PID reuse.
    process.kill(process.platform === "win32" ? processRecord.pid : -processRecord.pgid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function processGroupHasMembers(pgid: number): boolean {
  if (process.platform === "win32") return false;
  try {
    for (const entry of readdirSync("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const stat = readProcStat(Number(entry.name));
      if (stat?.pgid === pgid && stat.state !== "Z") return true;
    }
  } catch {
    // A restricted /proc is treated as unknown by the caller rather than as
    // proof that a detached group has exited.
    return true;
  }
  return false;
}

function processGroupMemberPids(pgid: number): number[] | undefined {
  if (process.platform === "win32") return [];
  const members: number[] = [];
  try {
    for (const entry of readdirSync("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const pid = Number(entry.name);
      const stat = readProcStat(pid);
      if (stat?.pgid === pgid && stat.state !== "Z") members.push(pid);
    }
    return members;
  } catch {
    // A restricted /proc cannot prove that a group is empty or that its
    // descendants are owned by this run. Callers must fail closed.
    return undefined;
  }
}

function sameProcessIdentity(left: ProcessIdentity, right: ProcessIdentity, expectedRunNonce?: string): boolean {
  return left.pidStartTime === right.pidStartTime
    && left.pgid === right.pgid
    && left.executable === right.executable
    && left.groupIdentity === right.groupIdentity
    && (expectedRunNonce === undefined || left.runNonce === expectedRunNonce)
    && (right.runNonce === undefined || expectedRunNonce === undefined || right.runNonce === expectedRunNonce);
}

function detachedGroupIdentityIsValid(
  child: ChildProcess,
  identity: ProcessIdentity | undefined,
  expectedRunNonce?: string,
  capturedGroup?: CapturedChildGroupIdentity,
): identity is ProcessIdentity {
  return child.pid !== undefined
    && child.pid !== process.pid
    && identity !== undefined
    && identity.pgid === child.pid
    && identity.pgid > 1
    && capturedGroup !== undefined
    && capturedGroup.leaderPid === child.pid
    && capturedGroup.leaderStartTime === identity.pidStartTime
    && capturedGroup.pgid === identity.pgid
    && capturedGroup.groupIdentity === identity.groupIdentity
    && (expectedRunNonce === undefined || identity.runNonce === expectedRunNonce);
}

async function waitForDetachedGroupIdentity(
  child: ChildProcess,
  expectedRunNonce: string | undefined,
  timeoutMs: number,
): Promise<ProcessIdentity | undefined> {
  if (process.platform === "win32" || !child.pid || child.pid === process.pid) return undefined;
  const deadline = Date.now() + Math.max(1, Math.min(timeoutMs, 1_000));
  while (Date.now() < deadline) {
    captureSpawnedChildPgid(child);
    const identity = inspectProcessIdentity(child.pid);
    if (detachedGroupIdentityIsValid(
      child,
      identity,
      expectedRunNonce,
      capturedChildGroupIdentities.get(child),
    )) return identity;
    if (childHasExited(child)) return undefined;
    await wait(25);
  }
  return undefined;
}

interface DetachedGroupDiscovery {
  identity?: ProcessIdentity;
  candidateCount: number;
  scanFailed: boolean;
  provenEmpty: boolean;
}

function discoverDetachedGroupIdentity(
  child: Pick<ChildProcess, "pid">,
  expectedRunNonce: string | undefined,
  capturedGroup?: CapturedChildGroupIdentity,
): DetachedGroupDiscovery {
  if (
    process.platform === "win32"
    || !child.pid
    || child.pid === process.pid
    || !expectedRunNonce
    || capturedGroup === undefined
    || capturedGroup.leaderPid !== child.pid
    || capturedGroup.pgid !== child.pid
    || capturedGroup.pgid <= 1
    || capturedGroup.pgid === process.pid
  ) {
    return { candidateCount: 0, scanFailed: false, provenEmpty: false };
  }

  // Never search all same-nonce groups. The only safe fallback is the group
  // captured from this exact child before it exited. A surviving member is
  // evidence to retain, not proof that the original leader/group is still
  // associated and therefore not a signal target.
  const members = processGroupMemberPids(capturedGroup.pgid);
  if (members === undefined) return { candidateCount: 1, scanFailed: true, provenEmpty: false };
  return {
    candidateCount: members.length > 0 ? 1 : 0,
    scanFailed: false,
    provenEmpty: members.length === 0,
  };
}

function detachedGroupIsStillOwned(
  pid: number,
  expected: ProcessIdentity,
  expectedRunNonce?: string,
): boolean {
  // A negative-PGID signal is safe only while the recorded PID is still the
  // process-group leader. Same-nonce descendants alone cannot establish that
  // association: the leader may have exited and the PGID may have been reused.
  if (pid <= 1 || expected.pgid !== pid || expected.pgid === process.pid) return false;
  const current = inspectProcessIdentity(pid);
  return current !== undefined
    && current.pgid === pid
    && sameProcessIdentity(current, expected, expectedRunNonce);
}

function signalValidatedDetachedGroup(
  pid: number,
  expected: ProcessIdentity,
  signal: NodeJS.Signals,
  expectedRunNonce?: string,
): void {
  if (pid === process.pid || expected.pgid === process.pid) {
    throw new Error("Refusing to signal the test runner's process group");
  }
  if (expected.pgid !== pid) {
    throw new Error("Refusing to signal a process group without a live leader association");
  }
  if (!detachedGroupIsStillOwned(pid, expected, expectedRunNonce)) {
    throw new Error("Detached process group identity is no longer validated");
  }
  try {
    process.kill(-expected.pgid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function processRecordDetachedIdentity(processRecord: TestRunProcess): ProcessIdentity | undefined {
  if (processRecord.identityState === "provisional" || processRecord.pgid !== processRecord.pid) return undefined;
  return {
    pidStartTime: processRecord.pidStartTime,
    pgid: processRecord.pgid,
    executable: processRecord.executable,
    groupIdentity: processRecord.groupIdentity,
    runNonce: processRecord.runNonce,
  };
}

function bindManifestProcessIdentity(
  manifest: TestRunManifest,
  processRecord: TestRunProcess,
): TestRunProcess {
  if (processRecord.identityState !== "provisional") return processRecord;
  const discovery = discoverDetachedGroupIdentity({ pid: processRecord.pid }, manifest.runNonce);
  if (!discovery.identity) {
    throw new Error(`Refusing to stop ${processRecord.name}: provisional process group identity could not be validated`);
  }
  return {
    ...processRecord,
    pidStartTime: discovery.identity.pidStartTime,
    pgid: discovery.identity.pgid,
    executable: discovery.identity.executable,
    groupIdentity: discovery.identity.groupIdentity,
    identityState: "bound",
  };
}

function signalManifestProcess(
  manifest: TestRunManifest,
  processRecord: TestRunProcess,
  signal: NodeJS.Signals,
): void {
  const validation = validateProcessIdentity(manifest, processRecord);
  if (validation.valid) {
    signalProcess(manifest, processRecord, signal);
    return;
  }

  const detachedIdentity = processRecordDetachedIdentity(processRecord)
    ?? (processRecord.identityState === "provisional"
      ? discoverDetachedGroupIdentity({ pid: processRecord.pid }, manifest.runNonce).identity
      : undefined);
  if (detachedIdentity && detachedGroupIsStillOwned(processRecord.pid, detachedIdentity, manifest.runNonce)) {
    signalValidatedDetachedGroup(processRecord.pid, detachedIdentity, signal, manifest.runNonce);
    return;
  }

  if (processRecordIsGone(processRecord)) return;
  throw new Error(`Refusing to stop ${processRecord.name}: ${validation.reason}`);
}

async function waitForDetachedGroupExit(
  child: ChildProcess,
  expected: ProcessIdentity,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(1, timeoutMs);
  while (Date.now() < deadline) {
    const leader = child.pid ? readProcStat(child.pid) : undefined;
    if (!processGroupHasMembers(expected.pgid)
      && (!child.pid || !processExists(child.pid) || leader?.state === "Z")) {
      return true;
    }
    await wait(25);
  }
  return !processGroupHasMembers(expected.pgid)
    && (!child.pid || !processExists(child.pid) || readProcStat(child.pid)?.state === "Z");
}

function processRecordIsGone(processRecord: TestRunProcess): boolean {
  if (processRecord.identityState === "provisional") return false;
  // An unobservable /proc entry is only treated as an exited process when the
  // PID is also gone. A reused PID remains unknown and must stay in the
  // manifest rather than being mistaken for a clean exit.
  const stat = readProcStat(processRecord.pid);
  return (inspectProcessIdentity(processRecord.pid) === undefined || stat?.state === "Z")
    && (!processExists(processRecord.pid) || stat?.state === "Z")
    && !processGroupHasMembers(processRecord.pgid);
}

function processRecordIdentityMatches(
  current: ProcessIdentity | undefined,
  processRecord: TestRunProcess,
  manifest: TestRunManifest,
): boolean {
  return processRecord.identityState !== "provisional"
    && current !== undefined
    && current.runNonce === manifest.runNonce
    && current.pidStartTime === processRecord.pidStartTime
    && current.pgid === processRecord.pgid
    && executableMatches(processRecord.executable, current.executable)
    && current.groupIdentity === processRecord.groupIdentity;
}

async function waitForRecordedProcessExit(
  manifest: TestRunManifest,
  processRecord: TestRunProcess,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processRecordIsGone(processRecord)) return;
    const current = inspectProcessIdentity(processRecord.pid);
    if (current && !processRecordIdentityMatches(current, processRecord, manifest)) {
      throw new Error(`Process identity changed for ${processRecord.name}; retaining its manifest record`);
    }
    if (current || processExists(processRecord.pid)) await wait(50);
    else return;
  }
  if (processRecordIsGone(processRecord)) return;
  throw new Error(`Process ${processRecord.name} (pid ${processRecord.pid}) did not exit within ${timeoutMs}ms`);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForPortClosed(port: number, timeoutMs = SERVER_STOP_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      const done = (value: boolean) => {
        socket.destroy();
        resolve(value);
      };
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
      socket.setTimeout(250, () => done(false));
    });
    if (!open) return;
    await wait(50);
  }
  throw new Error(`Port ${port} did not close within ${timeoutMs}ms`);
}

export async function waitForReady(
  spec: ServerSpec,
  timeoutMs: number,
  requestTimeoutMs = READINESS_REQUEST_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const requestTimer = setTimeout(
      () => controller.abort(),
      Math.max(1, Math.min(requestTimeoutMs, Math.max(1, deadline - Date.now()))),
    );
    try {
      const response = await fetch(spec.readinessUrl, {
        headers: spec.readinessHeaders,
        signal: controller.signal,
      });
      // A protected health endpoint returns 401/403 until the intended
      // readiness credential is supplied. Treating any 4xx as ready would let
      // an authentication failure pass startup, so readiness requires a 2xx
      // response from the exact endpoint configured by the server spec.
      if (response.ok) return;
    } catch {
      // The bounded polling loop is expected to observe connection refusal
      // while the process is still booting. The AbortController also bounds a
      // hung TCP request so it cannot consume the entire readiness budget.
    } finally {
      clearTimeout(requestTimer);
    }
    await wait(100);
  }
  throw new Error(`${spec.name} did not become ready at ${spec.readinessUrl}`);
}

function spawnServer(spec: ServerSpec, ignoreOutput = false): ChildProcess {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    detached: process.platform !== "win32",
    stdio: ignoreOutput ? "ignore" : ["ignore", "pipe", "pipe"],
  });
  captureSpawnedChildPgid(child);
  const output = { value: "" };
  child.stdout?.on("data", (chunk: Buffer) => appendOutput(output, chunk));
  child.stderr?.on("data", (chunk: Buffer) => appendOutput(output, chunk));
  child.once("exit", (code, signal) => {
    if (code !== 0 && signal !== null) appendOutput(output, `\n[${spec.name}] exited via ${signal}\n`);
  });
  (child as ChildProcess & { __testRunOutput?: { value: string } }).__testRunOutput = output;
  return child;
}

function childHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (childHasExited(child)) return true;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (closed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("close", onClose);
      child.removeListener("error", onError);
      resolve(closed);
    };
    const onClose = () => finish(true);
    const onError = () => {
      // A spawn error is followed by close in Node, but the close event is
      // the boundary we wait for. Do not treat error alone as proof of exit.
      if (childHasExited(child)) finish(true);
    };
    const timer = setTimeout(() => finish(childHasExited(child)), Math.max(1, timeoutMs));
    child.once("close", onClose);
    child.once("error", onError);
    if (childHasExited(child)) finish(true);
  });
}

/**
 * Stop a just-spawned child without consulting the manifest.
 *
 * A provisional record has no trustworthy persisted PID start-time or
 * process-group identity. The ChildProcess handle is therefore used to bind
 * the live detached leader first; once its run nonce and PGID are validated,
 * teardown targets the complete process group rather than only the leader.
 * This matters for portless build commands whose descendants do not own a
 * listener that could otherwise reveal the leak.
 */
export async function terminateChildProcessHandle(
  child: ChildProcess,
  timeoutMs = SERVER_STOP_TIMEOUT_MS,
  expectedRunNonce?: string,
): Promise<void> {
  const totalTimeoutMs = Math.max(2, timeoutMs);
  const termTimeoutMs = Math.max(1, Math.floor(totalTimeoutMs / 2));
  const killTimeoutMs = Math.max(1, totalTimeoutMs - termTimeoutMs);
  const diagnostics: unknown[] = [];

  // This is intentionally the first observation. If the child is later
  // reaped, recovery must use this exact leader/group identity or refuse to
  // signal anything.
  const capturedPgid = captureSpawnedChildPgid(child);
  const observedIdentity = await waitForDetachedGroupIdentity(child, expectedRunNonce, totalTimeoutMs);
  const capturedGroupAfterWait = capturedChildGroupIdentities.get(child);
  const capturedPgidAfterWait = capturedPgid ?? capturedGroupAfterWait?.pgid;
  const discoveredGroup = observedIdentity
    ? { identity: observedIdentity, candidateCount: 1, scanFailed: false, provenEmpty: false }
    : discoverDetachedGroupIdentity(child, expectedRunNonce, capturedGroupAfterWait);
  const detachedIdentity = discoveredGroup.identity;
  if (detachedIdentity) {
    try {
      if (childHasExited(child) && !processGroupHasMembers(detachedIdentity.pgid)) return;
      signalValidatedDetachedGroup(child.pid!, detachedIdentity, "SIGTERM", expectedRunNonce);
      let exited = await waitForChildClose(child, termTimeoutMs);
      if (exited) exited = await waitForDetachedGroupExit(child, detachedIdentity, termTimeoutMs);
      else exited = await waitForDetachedGroupExit(child, detachedIdentity, termTimeoutMs);
      if (!exited) {
        signalValidatedDetachedGroup(child.pid!, detachedIdentity, "SIGKILL", expectedRunNonce);
        const childClosed = await waitForChildClose(child, killTimeoutMs);
        const groupExited = await waitForDetachedGroupExit(child, detachedIdentity, killTimeoutMs);
        exited = childClosed && groupExited;
      }
      if (!exited) {
        diagnostics.push(new Error(`Detached process group did not exit within ${totalTimeoutMs}ms`));
      }
    } catch (error) {
      diagnostics.push(error);
    }
    if (diagnostics.length > 0) throw combineLifecycleErrors(undefined, diagnostics);
    return;
  }

  if (expectedRunNonce !== undefined) {
    if (discoveredGroup.provenEmpty && childHasExited(child)) return;
    throw new Error(
      capturedPgidAfterWait === undefined
        ? "Spawned child PGID was never observed; refusing to signal an unvalidated process group"
        : "Captured child process group could not be validated; refusing to signal it",
    );
  }

  const send = (signal: NodeJS.Signals): void => {
    if (childHasExited(child)) return;
    try {
      const delivered = child.kill(signal);
      if (!delivered && !childHasExited(child)) {
        diagnostics.push(new Error(`ChildProcess.kill(${signal}) did not report delivery`));
      }
    } catch (error) {
      diagnostics.push(error);
    }
  };

  send("SIGTERM");
  let closed = await waitForChildClose(child, termTimeoutMs);
  if (!closed) {
    send("SIGKILL");
    closed = await waitForChildClose(child, killTimeoutMs);
  }
  if (!closed && !childHasExited(child)) {
    diagnostics.push(new Error(`Child process did not close within ${totalTimeoutMs}ms`));
  }
  if (expectedRunNonce && process.platform !== "win32" && childHasExited(child)) {
    const unresolvedGroup = !discoveredGroup.provenEmpty
      && (discoveredGroup.scanFailed || discoveredGroup.candidateCount > 0 || !detachedIdentity);
    if (unresolvedGroup) {
      diagnostics.push(new Error("Detached process leader exited but surviving descendants could not be safely validated"));
    }
  }
  if (diagnostics.length > 0) throw combineLifecycleErrors(undefined, diagnostics);
}

async function stopRunningServerHandles(running: RunningServer[], timeoutMs: number): Promise<void> {
  const diagnostics: unknown[] = [];
  for (const { child, spec } of [...running].reverse()) {
    try {
      const record = running.find((candidate) => candidate.child === child)?.record;
      await terminateChildProcessHandle(child, timeoutMs, record?.runNonce);
      if (spec.port > 0) await waitForPortClosed(spec.port, timeoutMs);
    } catch (error) {
      diagnostics.push(error);
    }
  }
  if (diagnostics.length > 0) throw combineLifecycleErrors(undefined, diagnostics);
}

async function runBoundedCommand(
  repoRoot: string,
  args: string[],
  timeoutMs: number,
  extraEnvironment: NodeJS.ProcessEnv = {},
  expectedRunNonce?: string,
  runContext?: TestRunContext,
): Promise<CommandResult> {
  const child = spawn(npmCommand(), args, {
    cwd: repoRoot,
    env: allowlistedEnvironment({
      NEXT_TELEMETRY_DISABLED: "1",
      ...(expectedRunNonce ? { INGENIUM_TEST_RUN_NONCE: expectedRunNonce } : {}),
      ...Object.fromEntries(
        Object.entries(extraEnvironment).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      ),
    }),
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  captureSpawnedChildPgid(child);
  const output = { value: "" };
  child.stdout?.on("data", (chunk: Buffer) => appendOutput(output, chunk));
  child.stderr?.on("data", (chunk: Buffer) => appendOutput(output, chunk));

  let record: TestRunProcess | undefined;
  if (runContext) {
    if (!child.pid) {
      try {
         await terminateChildProcessHandle(child, timeoutMs, runContext.runNonce);
      } catch (cleanupError) {
        throw combineLifecycleErrors(
          new Error(`Detached build did not expose a PID: ${args.join(" ")}`),
          [cleanupError],
        );
      }
      throw new Error(`Detached build did not expose a PID: ${args.join(" ")}`);
    }
    record = {
      name: "build",
      pid: child.pid,
      port: 0,
      startedAt: new Date().toISOString(),
      runNonce: runContext.runNonce,
      pidStartTime: "pending",
      pgid: 0,
      executable: "",
      groupIdentity: "pending",
      identityState: "provisional",
    };
    try {
      const manifest = readTestRunManifest(runContext.manifestPath);
      updateTestRunManifest(runContext.manifestPath, {
        status: manifest.status === "created" ? "starting" : manifest.status,
        processes: [...manifest.processes, record],
      });
    } catch (error) {
      // A child for which the durable hand-off failed must not be allowed to
      // continue as an unowned detached process. The ChildProcess handle is
      // the only safe target before identity binding is available.
      try {
        await terminateChildProcessHandle(child, timeoutMs, runContext.runNonce);
      } catch (cleanupError) {
        throw combineLifecycleErrors(error, [cleanupError]);
      }
      throw error;
    }

    const identity = await waitForFinalProcessIdentity(child.pid, runContext.runNonce);
    if (identity) {
      record = {
        ...record,
        pidStartTime: identity.pidStartTime,
        pgid: identity.pgid,
        executable: identity.executable,
        groupIdentity: identity.groupIdentity,
        identityState: "bound",
      };
      const manifest = readTestRunManifest(runContext.manifestPath);
      updateTestRunManifest(runContext.manifestPath, {
        processes: manifest.processes.map((candidate) => sameProcessRecord(candidate, record!) ? record! : candidate),
      });
    }
    if (!identity || identity.runNonce !== runContext.runNonce) {
      throw new Error(`Detached build identity could not be bound to run ${runContext.runId}`);
    }
  }

  return new Promise<CommandResult>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const timeoutReason = `Timed out running ${npmCommand()} ${args.join(" ")}`;
      const cleanupDiagnostics: unknown[] = [];
      if (record && runContext) {
        try {
          recordTestRunTelemetryFailure(runContext.manifestPath, timeoutReason, record);
        } catch {
          // The startup caller retains the manifest if telemetry cannot be written.
        }
      }
      void terminateChildProcessHandle(child, timeoutMs, runContext?.runNonce)
        .catch((cleanupError: unknown) => {
          cleanupDiagnostics.push(cleanupError);
        })
        .finally(() => {
          reject(combineLifecycleErrors(new Error(`${timeoutReason}\n${output.value}`), cleanupDiagnostics));
        });
    }, timeoutMs);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (record && runContext) {
        try {
          recordTestRunTelemetryFailure(runContext.manifestPath, error.message, record);
        } catch {
          // Keep the manifest record as the primary recovery hand-off.
        }
      }
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (record && runContext) {
        if (code === 0 && signal === null) {
          try {
            markTestRunProcessCleared(runContext.manifestPath, record);
            const manifest = readTestRunManifest(runContext.manifestPath);
            updateTestRunManifest(runContext.manifestPath, {
              processes: manifest.processes.filter((candidate) => !sameProcessRecord(candidate, record!)),
            });
          } catch (error) {
            try {
              recordTestRunTelemetryFailure(runContext.manifestPath, asError(error).message, record);
            } catch {
              // Preserve the retained record if the clear path fails.
            }
          }
        } else {
          try {
            recordTestRunTelemetryFailure(
              runContext.manifestPath,
              `Detached build exited with code ${String(code)}${signal ? ` via ${signal}` : ""}`,
              record,
            );
          } catch {
            // Preserve the retained record if telemetry is unavailable.
          }
        }
      }
      resolve({ code, signal, output: output.value });
    });
  });
}

export async function buildProductionArtifacts(context: TestRunContext, timeoutMs = PRODUCTION_BUILD_TIMEOUT_MS): Promise<void> {
  const workspaces = [
    "packages/ingenium-core",
    "packages/ingenium-email",
    "services/ingenium-api",
    "services/ingenium-dashboard",
  ];
  try {
    for (const workspace of workspaces) {
      const result = await runBoundedCommand(
        context.repoRoot,
        ["run", "build", `--workspace=${workspace}`],
        timeoutMs,
        workspace === "services/ingenium-dashboard"
          ? { NODE_ENV: "production", INGENIUM_API_PORT: String(context.ports.api) }
          : {},
        context.runNonce,
        context,
      );
      if (result.code !== 0) {
        throw new Error(`Production build failed for ${workspace}\n${result.output}`);
      }
    }
  } catch (error) {
    try {
      const manifest = readTestRunManifest(context.manifestPath);
      if (manifest.status !== "stopping") updateTestRunManifest(context.manifestPath, { status: "stopping" });
    } catch {
      // Preserve the original build failure; the retained telemetry remains
      // the next recovery source if the manifest cannot be updated.
    }
    throw error;
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function combineLifecycleErrors(primary: unknown, diagnostics: unknown[]): Error {
  const errors = [primary, ...diagnostics].filter((value): value is unknown => value !== undefined);
  if (errors.length === 1) return asError(errors[0]);
  const message = errors.map((value) => asError(value).message).join("\n");
  const combined = new Error(message);
  (combined as Error & { errors?: Error[] }).errors = errors.map(asError);
  return combined;
}

async function stopProcessRecordFromManifest(
  manifestPath: string,
  manifest: TestRunManifest,
  processRecord: TestRunProcess,
  timeoutMs: number,
): Promise<void> {
  let targetRecord = processRecord;
  try {
    targetRecord = bindManifestProcessIdentity(manifest, processRecord);
    if (targetRecord !== processRecord) {
      const latest = readTestRunManifest(manifestPath);
      updateTestRunManifest(manifestPath, {
        processes: latest.processes.map((record) => sameProcessRecord(record, processRecord) ? targetRecord : record),
      });
    }
    const targetManifest = targetRecord === processRecord ? manifest : readTestRunManifest(manifestPath);
    signalManifestProcess(targetManifest, targetRecord, "SIGTERM");

    try {
      await waitForRecordedProcessExit(targetManifest, targetRecord, timeoutMs);
    } catch (error) {
      // Escalate only when the original identity is still observable. A stale
      // PID must never become a SIGKILL target.
      const current = inspectProcessIdentity(targetRecord.pid);
      if (processRecordIdentityMatches(current, targetRecord, targetManifest)) {
        signalProcess(targetManifest, targetRecord, "SIGKILL");
      } else {
        const detachedIdentity = processRecordDetachedIdentity(targetRecord);
        if (!detachedIdentity || !detachedGroupIsStillOwned(targetRecord.pid, detachedIdentity, targetManifest.runNonce)) {
          throw error;
        }
        signalValidatedDetachedGroup(targetRecord.pid, detachedIdentity, "SIGKILL", targetManifest.runNonce);
      }
      await waitForRecordedProcessExit(targetManifest, targetRecord, timeoutMs);
    }

    // Process exit is necessary but not sufficient: the service port is the
    // externally observable ownership boundary and must be closed too.
    if (targetRecord.port > 0) await waitForPortClosed(targetRecord.port, timeoutMs);
    markTestRunProcessCleared(manifestPath, targetRecord);
    const latest = readTestRunManifest(manifestPath);
    updateTestRunManifest(manifestPath, {
      status: "stopping",
      processes: latest.processes.filter((record) => !sameProcessRecord(record, targetRecord)),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      recordTestRunTelemetryFailure(manifestPath, reason, targetRecord);
    } catch {
      // The original teardown failure is more useful than a secondary
      // telemetry-write error. The manifest itself remains untouched.
    }
    throw error;
  }
}

function sameProcessRecord(left: TestRunProcess, right: TestRunProcess): boolean {
  const sameSpawn = left.name === right.name
    && left.pid === right.pid
    && left.runNonce === right.runNonce
    && left.startedAt === right.startedAt;
  if (sameSpawn && (left.identityState === "provisional" || right.identityState === "provisional")) return true;
  return sameSpawn
    && left.pidStartTime === right.pidStartTime
    && left.pgid === right.pgid
    && left.groupIdentity === right.groupIdentity;
}

async function stopRunningServers(
  manifestPath: string,
  running: RunningServer[],
  timeoutMs: number,
): Promise<void> {
  const diagnostics: unknown[] = [];
  const manifest = readTestRunManifest(manifestPath);
  // Use the persisted manifest, not only in-memory ChildProcess handles. This
  // is the same recovery path used after the runner itself is interrupted.
  const records = manifest.processes.length > 0
    ? manifest.processes
    : running.map(({ record }) => record);
  for (const processRecord of [...records].reverse()) {
    try {
      await stopProcessRecordFromManifest(manifestPath, readTestRunManifest(manifestPath), processRecord, timeoutMs);
    } catch (error) {
      diagnostics.push(error);
    }
  }
  if (diagnostics.length > 0) throw combineLifecycleErrors(undefined, diagnostics);
}

export async function startTestServers(
  context: TestRunContext,
  options: TestServerLifecycleOptions = {},
): Promise<void> {
  const production = options.production ?? true;
  const shouldBuild = options.build ?? production;
  const startTimeoutMs = options.startTimeoutMs ?? SERVER_START_TIMEOUT_MS;
  const stopTimeoutMs = options.stopTimeoutMs ?? SERVER_STOP_TIMEOUT_MS;
  const persistManifest = options.updateManifest ?? updateTestRunManifest;
  const specs = getServerSpecs(context, production, options.dashboardEnvironment);
  const running: RunningServer[] = [];
  try {
    capturePreexistingProcessBaseline(context);
    if (production && shouldBuild) await buildProductionArtifacts(context, options.buildTimeoutMs);
    if (production) {
      if (!existsSync(specs[0]!.args[0]!)) throw new Error("API production entrypoint is missing after build");
      if (!existsSync(join(context.repoRoot, "services", "ingenium-dashboard", ".next", "BUILD_ID"))) {
        throw new Error("Dashboard production build is missing after build");
      }
    }

    updateTestRunManifest(context.manifestPath, { status: "starting", processes: [] });
    for (const spec of specs) {
      const child = options.spawnServer?.(spec) ?? spawnServer(spec, options.detachAfterStart === true);
      captureSpawnedChildPgid(child);
      if (!child.pid) {
        try {
           await terminateChildProcessHandle(child, stopTimeoutMs, context.runNonce);
        } catch (cleanupError) {
          throw combineLifecycleErrors(new Error(`${spec.name} process did not expose a PID`), [cleanupError]);
        }
        throw new Error(`${spec.name} process did not expose a PID`);
      }
      const record: TestRunProcess = {
        name: spec.name,
        pid: child.pid,
        port: spec.port,
        startedAt: new Date().toISOString(),
        runNonce: context.runNonce,
        pidStartTime: "pending",
        pgid: 0,
        executable: "",
        groupIdentity: "pending",
        identityState: "provisional",
      };
      running.push({ spec, child, record });
      try {
        await options.beforeInitialProcessRecordPersist?.({ child, spec, record });
        const manifestAfterSpawn = readTestRunManifest(context.manifestPath);
        persistManifest(context.manifestPath, {
          status: manifestAfterSpawn.status === "created" ? "starting" : manifestAfterSpawn.status,
          processes: running.map(({ record: item }) => item),
        });
      } catch (error) {
        // The provisional record is not a valid signal target. Clean up with
        // the exact handle while it is still available, before any manifest
        // based recovery path can run (or fail because the manifest vanished).
        try {
           await terminateChildProcessHandle(child, stopTimeoutMs, context.runNonce);
        } catch (cleanupError) {
          // Keep the in-memory ownership record when bounded cleanup itself
          // fails so the outer catch can retry the same exact ChildProcess
          // handle without relying on the manifest.
          throw combineLifecycleErrors(error, [cleanupError]);
        }
        const runningIndex = running.findIndex(({ child: candidate }) => candidate === child);
        if (runningIndex >= 0) running.splice(runningIndex, 1);
        throw error;
      }

      const identity = await waitForFinalProcessIdentity(child.pid, context.runNonce);
      if (identity) {
        const boundRecord: TestRunProcess = {
          ...record,
          pidStartTime: identity.pidStartTime,
          pgid: identity.pgid,
          executable: identity.executable,
          groupIdentity: identity.groupIdentity,
          identityState: "bound",
        };
        running[running.length - 1]!.record = boundRecord;
        persistManifest(context.manifestPath, {
          processes: running.map(({ record: item }) => item),
        });
      }
      if (!identity || identity.runNonce !== context.runNonce) {
        // The provisional record is already durable. If a different nonce was
        // observed, the bound evidence is retained but validation will refuse
        // to signal the process as belonging to this run.
        throw new Error(`${spec.name} process identity could not be bound to this test run`);
      }
      await waitForReady(spec, startTimeoutMs, options.readinessRequestTimeoutMs);
      // No dashboard or fixture process is started until the API has accepted
      // this exact manifest-owned project. This is the boundary before any
      // project-scoped fixture write can occur; there is intentionally no
      // global-project fallback.
      if (spec.name === "api") {
        await provisionTestRunProject(context);
        await provisionTestRunOwner(context);
        await provisionTestRunBrowserSession(context);
      }
      // The filesystem reservation protects the pre-listener race. The exact
      // readiness response is the ownership-transfer boundary; after it, the
      // child listener itself prevents another process from binding the port.
      transferTestRunPortOwnership(context.manifestPath, spec.port);
    }
    updateTestRunManifest(context.manifestPath, { status: "running" });
    if (options.detachAfterStart) {
      for (const { child } of running) child.unref();
    }
  } catch (error) {
    const diagnostics: unknown[] = [];
    let manifestUsable = false;
    try {
      readTestRunManifest(context.manifestPath);
      manifestUsable = true;
    } catch (manifestError) {
      // The primary failure may be the manifest hand-off itself. Do not turn
      // a missing manifest into the only cleanup strategy or mask the primary
      // error with a second, redundant read failure.
      if (existsSync(context.manifestPath)) diagnostics.push(manifestError);
    }
    if (manifestUsable) {
      try {
        recordTestRunTelemetryFailure(context.manifestPath, asError(error).message);
      } catch (telemetryError) {
        diagnostics.push(telemetryError);
      }
      try {
        await stopRunningServers(context.manifestPath, running, stopTimeoutMs);
      } catch (cleanupError) {
        diagnostics.push(cleanupError);
        try {
          updateTestRunManifest(context.manifestPath, { status: "stopping" });
        } catch (statusError) {
          diagnostics.push(statusError);
        }
      }
    }
    // If the manifest path is unavailable or manifest-driven cleanup failed,
    // use the still-owned ChildProcess handles. This is the only safe fallback
    // for a provisional spawn and also prevents earlier children from leaking
    // when a later durable write removes the recovery record.
    if (!manifestUsable || diagnostics.length > 0) {
      try {
        await stopRunningServerHandles(running, stopTimeoutMs);
      } catch (handleCleanupError) {
        diagnostics.push(handleCleanupError);
      }
    }
    // A failed startup is a recovery state. Records that could not be proven
    // exited remain in the manifest and the status stays `stopping`; clearing
    // them here would make the next invocation unable to recover the orphan.
    if (manifestUsable && existsSync(context.manifestPath)) {
      try {
        const remaining = readTestRunManifest(context.manifestPath);
        if (remaining.status !== "stopping") updateTestRunManifest(context.manifestPath, { status: "stopping" });
      } catch (manifestError) {
        diagnostics.push(manifestError);
      }
    }
    throw combineLifecycleErrors(error, diagnostics);
  }
}

export async function stopRunFromManifest(manifestPath: string, options: StopRunOptions = {}): Promise<void> {
  if (!existsSync(manifestPath)) {
    throw new Error(`Test-run manifest is missing; recovery evidence was retained: ${manifestPath}`);
  }
  const stopTimeoutMs = options.stopTimeoutMs ?? SERVER_STOP_TIMEOUT_MS;
  // This is deliberately the first operation. A forged or malformed manifest
  // must fail before even a single signal or status write is attempted.
  const manifest = readTestRunManifest(manifestPath);
  const diagnostics: unknown[] = [];
  let cleaned = false;
  try {
    updateTestRunManifest(manifestPath, { status: "stopping" });
    for (const processRecord of [...manifest.processes].reverse()) {
      try {
        await stopProcessRecordFromManifest(
          manifestPath,
          readTestRunManifest(manifestPath),
          processRecord,
          stopTimeoutMs,
        );
      } catch (error) {
        diagnostics.push(error);
      }
    }

    // A port without a surviving process record is still a leak. This check is
    // intentionally driven by the manifest's dynamic ports, not a fixed list.
    const current = readTestRunManifest(manifestPath);
    for (const port of Object.values(current.ports)) {
      try {
        await waitForPortClosed(port, stopTimeoutMs);
      } catch (error) {
        diagnostics.push(error);
      }
    }
    const remaining = readTestRunManifest(manifestPath);
    if (diagnostics.length === 0 && remaining.processes.length === 0) {
      // Resolve telemetry before publishing `complete`. If execution is
      // interrupted after this point, the stopping manifest is still a valid
      // recovery hand-off; the next pass can idempotently publish completion.
      markTestRunRecovered(manifestPath);
      updateTestRunManifest(manifestPath, { status: "complete", processes: [] });
      releaseTestRunPortReservations(readTestRunManifest(manifestPath), { allowMissing: true });
      if (options.cleanup ?? true) {
        cleanupTestRun(manifestPath);
        cleaned = true;
      }
    }
  } catch (error) {
    diagnostics.push(error);
  } finally {
    if (!cleaned && diagnostics.length > 0 && existsSync(manifestPath)) {
      try {
        recordTestRunTelemetryFailure(manifestPath, diagnostics.map((error) => asError(error).message).join("; "));
      } catch (telemetryError) {
        diagnostics.push(telemetryError);
      }
      try {
        const remaining = readTestRunManifest(manifestPath);
        if (remaining.status !== "stopping") updateTestRunManifest(manifestPath, { status: "stopping" });
      } catch (statusError) {
        diagnostics.push(statusError);
      }
    }
  }
  if (diagnostics.length > 0) throw combineLifecycleErrors(undefined, diagnostics);
}

export interface RecoverRunOptions {
  portTimeoutMs?: number;
}

/**
 * Explicitly resolve a retained stopping manifest without deleting its run
 * directory or telemetry. Recovery is deliberately proof-based: every active
 * or retained identity must be gone and every manifest-owned listener must be
 * closed before either record is marked resolved.
 */
export async function recoverStoppingTestRun(
  manifestPath: string,
  options: RecoverRunOptions = {},
): Promise<void> {
  const manifest = readTestRunManifest(manifestPath);
  if (manifest.status !== "stopping" && manifest.status !== "complete") {
    throw new Error(`Refusing recovery for a non-stopping test run (${manifest.status})`);
  }
  const telemetry = readTestRunTelemetry(getTestRunTelemetryPath(manifest), manifest.repoRoot);
  if (manifest.status === "complete"
    && manifest.processes.length === 0
    && telemetry.status === "complete"
    && telemetry.activeProcesses.length === 0
    && telemetry.resolution?.status === "resolved") {
    return;
  }
  const records = new Map<string, TestRunProcess>();
  for (const record of manifest.processes) {
    records.set(`${record.runNonce}:${record.name}:${record.pid}:${record.startedAt}`, record);
  }
  for (const entry of telemetry.processes) {
    if (entry.state !== "active" && entry.state !== "retained") continue;
    const record = entry.record;
    records.set(`${record.runNonce}:${record.name}:${record.pid}:${record.startedAt}`, record);
  }

  for (const record of records.values()) {
    if (!processRecordIsGone(record)) {
      const identity = inspectProcessIdentity(record.pid);
      if (identity && !processRecordIdentityMatches(identity, record, manifest)) {
        throw new Error(`Cannot recover ${record.name}: process identity is still occupied by another process`);
      }
      throw new Error(`Cannot recover ${record.name}: process identity is still running`);
    }
  }
  const portTimeoutMs = options.portTimeoutMs ?? SERVER_STOP_TIMEOUT_MS;
  for (const port of Object.values(manifest.ports)) {
    await waitForPortClosed(port, portTimeoutMs);
  }

  // Re-persist the identity list before changing status. This also repairs a
  // partially-written hand-off whose manifest record exists but telemetry
  // history was interrupted before the process entry was indexed.
  updateTestRunManifest(manifestPath, { processes: manifest.processes });
  // Resolve telemetry first. Only after the recovery evidence is durable is
  // the manifest promoted to complete, preventing an unrecoverable split
  // state if the runner is interrupted between the two writes.
  markTestRunRecovered(manifestPath);
  updateTestRunManifest(manifestPath, { status: "complete", processes: [] });
  releaseTestRunPortReservations(readTestRunManifest(manifestPath), { allowMissing: true });
}

/** Compatibility alias for callers that use the shorter recovery name. */
export const recoverTestRun = recoverStoppingTestRun;
export const recoverTestRunFromManifest = recoverStoppingTestRun;

export interface SignalSource {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  removeListener(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export interface RunSignalHandlerOptions {
  signalSource?: SignalSource;
  stop?: (manifestPath: string) => Promise<void>;
  exit?: (code: number) => void;
}

/** Install one idempotent bounded cleanup path for both runner signals. */
export function installRunSignalHandlers(
  manifestPath: string,
  options: RunSignalHandlerOptions = {},
): () => void {
  const signalSource = options.signalSource ?? process;
  const stop = options.stop ?? ((path: string) => stopRunFromManifest(path));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let handling = false;
  const handler = (signal: "SIGINT" | "SIGTERM") => {
    if (handling) return;
    handling = true;
    void stop(manifestPath)
      .catch((error: unknown) => {
        // Do not turn a port/process cleanup failure into silent loss of the
        // runner's diagnostics before the signal-specific exit code fires.
        // eslint-disable-next-line no-console
        console.error(`[playwright] signal cleanup diagnostics: ${asError(error).message}`);
      })
      .finally(() => exit(signal === "SIGINT" ? 130 : 143));
  };
  const onInterrupt = () => handler("SIGINT");
  const onTerminate = () => handler("SIGTERM");
  signalSource.once("SIGINT", onInterrupt);
  signalSource.once("SIGTERM", onTerminate);
  return () => {
    signalSource.removeListener("SIGINT", onInterrupt);
    signalSource.removeListener("SIGTERM", onTerminate);
  };
}

export function productionArtifactsExist(context: TestRunContext): boolean {
  return existsSync(join(context.repoRoot, "services", "ingenium-api", "dist", "scripts", "api-server.js"))
    && existsSync(join(context.repoRoot, "services", "ingenium-dashboard", ".next", "BUILD_ID"));
}

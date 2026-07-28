import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const TEST_RUN_MANIFEST_VERSION = 2;
export const TEST_RUN_TELEMETRY_VERSION = 1;
export const TEST_RUN_TEMP_PREFIX = "ingenium-playwright-run-";
export const TEST_RUN_STALE_PREFIX = "ingenium-playwright-";
export const TEST_RUN_MANIFEST_ENV = "INGENIUM_TEST_RUN_MANIFEST";
export const TEST_RUN_NONCE_ENV = "INGENIUM_TEST_RUN_NONCE";
export const TEST_RUN_TELEMETRY_ENV = "INGENIUM_TEST_RUN_TELEMETRY";
export const TEST_RUN_STALE_AFTER_MS = 60 * 60 * 1_000;
const TEST_RUN_ARTIFACT_DIRECTORY = "test-runs";
const TEST_RUN_TELEMETRY_FILENAME = "runner-telemetry.json";
const TEST_RUN_PORT_LOCK_ROOT = ".ingenium-playwright-port-locks";
const TEST_RUN_PORT_LOCK_FILENAME = "reservation.json";
const TEST_RUN_PORT_LOCK_VERSION = 1;
export const TEST_RUN_CREATION_FAILURE_FILENAME = "creation-failure.json";
const DEVELOPMENT_PORTS = new Set([3000, 4097, 4098, 4099, 4999]);
export const TEST_RUN_API_TOKEN_FILENAME = "api-token";

/**
 * Derive the only project identity that the default Playwright fixture may
 * use. Keeping it a deterministic manifest property prevents the fixture
 * from ever falling back to a shared project namespace.
 */
export function getTestRunProjectName(runId: string): string {
  return `playwright-test-${runId.slice(0, 8)}`;
}

/**
 * Build a same-origin dashboard URL that always carries this fixture run's
 * manifest-owned project. An explicit route project is deliberately replaced
 * so browser coverage cannot silently fall back to the dashboard global.
 */
export function getTestRunDashboardUrl(
  context: Pick<TestRunContext, "ports" | "project">,
  route = "/",
): string {
  const origin = `http://127.0.0.1:${context.ports.dashboard}`;
  const url = new URL(route, origin);
  if (url.origin !== origin) {
    throw new Error("Test-run dashboard URL must remain on the fixture origin");
  }
  url.searchParams.set("project", context.project);
  return url.toString();
}

export interface TestRunPorts {
  api: number;
  dashboard: number;
  fixture: number;
}

export interface TestRunProcess {
  name: "api" | "dashboard" | "fixture" | "build";
  pid: number;
  /** Service port, or 0 for a detached build command with no listener. */
  port: number;
  startedAt: string;
  runNonce: string;
  pidStartTime: string;
  pgid: number;
  executable: string;
  groupIdentity: string;
  /**
   * A process is written provisionally before /proc identity becomes
   * observable. Provisional records are evidence only and are never valid
   * signal targets.
   */
  identityState?: "provisional" | "bound";
}

export interface TestRunManifest {
  version: typeof TEST_RUN_MANIFEST_VERSION;
  runId: string;
  runNonce: string;
  createdAt: string;
  status: "created" | "starting" | "running" | "stopping" | "complete";
  repoRoot: string;
  tempRoot: string;
  runDir: string;
  homeDir: string;
  dbPath: string;
  apiTokenFile?: string;
  manifestPath: string;
  telemetryPath?: string;
  project: string;
  /** Set only after the isolated project is accepted by the fixture API. */
  projectProvisionedAt?: string;
  ports: TestRunPorts;
  portReservations?: TestRunPortReservation[];
  processes: TestRunProcess[];
}

export interface TestRunContext extends TestRunManifest {
  manifestPath: string;
}

export interface TestRunPortReservation {
  port: number;
  path: string;
  state: "reserved" | "transferred";
}

interface TestRunPortLockOwner {
  version: typeof TEST_RUN_PORT_LOCK_VERSION;
  runId: string;
  runNonce: string;
  repoRoot: string;
  runDir: string;
  port: number;
}

export type TestRunTelemetryProcessState = "active" | "cleared" | "retained";

export interface TestRunTelemetryResolution {
  status: "resolved";
  resolvedAt: string;
  method: "explicit-recovery";
}

export interface TestRunTelemetryProcess {
  record: TestRunProcess;
  state: TestRunTelemetryProcessState;
  updatedAt: string;
  reason?: string;
}

export interface TestRunTelemetry {
  version: typeof TEST_RUN_TELEMETRY_VERSION;
  runId: string;
  runNonce: string;
  repoRoot: string;
  manifestPath: string;
  status: TestRunManifest["status"];
  updatedAt: string;
  ports: TestRunPorts;
  activeProcesses: TestRunProcess[];
  processes: TestRunTelemetryProcess[];
  failures: string[];
  resolution?: TestRunTelemetryResolution;
}

export interface CreateTestRunContextOptions {
  repoRoot?: string;
  tempRoot?: string;
  ports?: Partial<TestRunPorts>;
  now?: () => Date;
  /** Test-only opt-out for process-local environment mutation. */
  applyEnvironment?: boolean;
  /** Test-only failure injection point immediately after mkdtempSync. */
  afterRunDirectoryCreated?: (runDir: string) => void;
}

let cachedContext: TestRunContext | undefined;

function parsePort(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer between 1024 and 65535`);
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name} must be an integer between 1024 and 65535`);
  }
  return port;
}

function validatePorts(ports: TestRunPorts): TestRunPorts {
  const values = Object.values(ports);
  if (new Set(values).size !== values.length) {
    throw new Error("Test-run services must use distinct ports");
  }
  for (const port of values) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error(`Test-run port ${String(port)} is outside the user-port range`);
    }
  }
  if (values.some((port) => DEVELOPMENT_PORTS.has(port))) {
    throw new Error("Default Playwright suite cannot use a development or Docker port");
  }
  return ports;
}

function defaultPorts(runId: string): TestRunPorts {
  // A per-run block avoids the application's development ports and avoids
  // making concurrent Playwright invocations fight over 3000/4097/4999.
  const slot = Number.parseInt(runId.slice(0, 6), 16) % 5000;
  const api = 41000 + slot * 3;
  return validatePorts({ api, dashboard: api + 1, fixture: api + 2 });
}

function portsFromEnvironment(runId: string): TestRunPorts {
  const defaults = defaultPorts(runId);
  return validatePorts({
    api: parsePort(process.env.INGENIUM_E2E_API_PORT, "INGENIUM_E2E_API_PORT") ?? defaults.api,
    dashboard: parsePort(process.env.INGENIUM_E2E_DASH_PORT, "INGENIUM_E2E_DASH_PORT") ?? defaults.dashboard,
    fixture: parsePort(process.env.INGENIUM_E2E_FIXTURE_PORT, "INGENIUM_E2E_FIXTURE_PORT") ?? defaults.fixture,
  });
}

function pathIsInside(parent: string, child: string): boolean {
  const fromParent = relative(resolve(parent), resolve(child));
  return fromParent === "" || (!fromParent.startsWith("..") && !isAbsolute(fromParent));
}

function assertNoSymlinkedAncestors(path: string, containmentRoot: string, name: string): void {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(containmentRoot);
  if (!pathIsInside(resolvedRoot, resolvedPath)) {
    throw new Error(`${name} is outside its canonical containment root: ${path}`);
  }

  let cursor = resolvedPath;
  const missing: string[] = [];
  while (!existsSync(cursor)) {
    missing.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  if (!existsSync(cursor)) {
    throw new Error(`${name} has no existing canonical ancestor: ${path}`);
  }
  try {
    if (realpathSync(cursor) !== cursor) {
      throw new Error(`${name} has a symlinked ancestor: ${path}`);
    }
    lstatSync(cursor);
    for (const component of missing.reverse()) {
      // Missing components cannot be symlinks yet, but the explicit walk keeps
      // the pre-write invariant obvious and makes the post-write check symmetric.
      if (existsSync(component) && lstatSync(component).isSymbolicLink()) {
        throw new Error(`${name} has a symlinked ancestor: ${path}`);
      }
    }

    let current = cursor;
    for (const component of missing.reverse()) {
      current = component;
      if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
        throw new Error(`${name} has a symlinked ancestor: ${path}`);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("symlinked ancestor")) throw error;
    throw new Error(`${name} cannot be inspected safely: ${path}`);
  }
}

function assertCanonicalExistingPath(path: string, containmentRoot: string, name: string): string {
  assertNoSymlinkedAncestors(path, containmentRoot, name);
  const resolvedPath = resolve(path);
  let canonical: string;
  try {
    canonical = realpathSync(resolvedPath);
  } catch {
    throw new Error(`${name} does not exist: ${path}`);
  }
  if (canonical !== resolvedPath || !pathIsInside(containmentRoot, canonical)) {
    throw new Error(`${name} is not a canonical path: ${path}`);
  }
  return canonical;
}

function assertCanonicalPathForWrite(path: string, containmentRoot: string, name: string): string {
  assertNoSymlinkedAncestors(path, containmentRoot, name);
  const resolvedPath = resolve(path);
  if (existsSync(resolvedPath)) {
    if (lstatSync(resolvedPath).isSymbolicLink()) {
      throw new Error(`${name} must not be a symlink: ${path}`);
    }
    if (realpathSync(resolvedPath) !== resolvedPath) {
      throw new Error(`${name} is not a canonical path: ${path}`);
    }
  }
  return resolvedPath;
}

/**
 * Return the one repository root allowed to own runner artifacts.
 *
 * A caller may provide a path through an environment variable, but it must be
 * the canonical checkout root rather than a symlink, a nested package, or an
 * arbitrary directory. This prevents a test run from writing evidence into a
 * path that merely resembles the repository.
 */
export function getCanonicalRepoRoot(candidate = process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT ?? process.cwd()): string {
  assertAbsolutePath(candidate, "repoRoot");
  const resolved = resolve(candidate);
  if (candidate !== resolved) {
    throw new Error(`Test-run artifact root must use a canonical lexical path: ${candidate}`);
  }
  let canonical: string;
  try {
    canonical = realpathSync(resolved);
  } catch {
    throw new Error(`Test-run artifact root does not exist: ${candidate}`);
  }
  if (canonical !== resolved) {
    throw new Error(`Test-run artifact root must be the canonical repository root: ${candidate}`);
  }
  assertNoSymlinkedAncestors(canonical, canonical, "repository root");
  let gitRoot: string;
  try {
    gitRoot = execFileSync("git", ["-C", canonical, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(`Test-run artifact root is not a git worktree: ${candidate}`);
  }
  if (!isAbsolute(gitRoot) || gitRoot !== resolve(gitRoot) || realpathSync(gitRoot) !== gitRoot || gitRoot !== canonical) {
    throw new Error(`Test-run artifact root is not the canonical git worktree root: ${candidate}`);
  }
  if (!existsSync(join(canonical, "package.json")) || !existsSync(join(canonical, ".git"))) {
    throw new Error(`Test-run artifact root is not the canonical repository root: ${candidate}`);
  }
  return canonical;
}

export function getTestRunArtifactRoot(repoRoot = getCanonicalRepoRoot()): string {
  const canonicalRepoRoot = getCanonicalRepoRoot(repoRoot);
  const artifactRoot = join(canonicalRepoRoot, "tests", "artifacts", TEST_RUN_ARTIFACT_DIRECTORY);
  assertCanonicalPathForWrite(artifactRoot, canonicalRepoRoot, "test-run artifact root");
  return artifactRoot;
}

function telemetryPathFor(manifest: Pick<TestRunManifest, "repoRoot" | "runId">): string {
  return join(getTestRunArtifactRoot(manifest.repoRoot), manifest.runId, TEST_RUN_TELEMETRY_FILENAME);
}

export function getTestRunTelemetryPath(
  manifest: Pick<TestRunManifest, "repoRoot" | "runId" | "telemetryPath">,
): string {
  return manifest.telemetryPath ?? telemetryPathFor(manifest);
}

/**
 * Return the only credential path a fixture run may use for the dashboard.
 *
 * The path is derived from the manifest-owned home directory. Normal teardown
 * therefore removes it with the run, while a retained stopping run keeps the
 * credential alongside its recovery evidence.
 */
export function getTestRunApiTokenPath(
  manifest: Pick<TestRunManifest, "runDir" | "homeDir" | "apiTokenFile">,
): string {
  const expected = join(manifest.homeDir, TEST_RUN_API_TOKEN_FILENAME);
  if (manifest.apiTokenFile !== undefined && manifest.apiTokenFile !== expected) {
    throw new Error("Refusing to use an unowned test-run API token path");
  }
  if (!pathIsInside(resolve(manifest.runDir), expected)) {
    throw new Error("Refusing to use a test-run API token outside its run directory");
  }
  return expected;
}

/**
 * Resolve the only filesystem root this fixture is allowed to own.
 *
 * The value is resolved before any caller-supplied temp path is used. This is
 * intentionally the OS temp directory, not a configurable arbitrary path.
 */
export function getApprovedTempRoot(): string {
  return realpathSync(tmpdir());
}

/**
 * Port reservations live in one canonical OS-temp directory shared by all
 * runner processes. The reservation is an atomic directory creation, not a
 * connect() probe, so two runners cannot both pass a check and then race to
 * start a service on the same port.
 */
export function getTestRunPortLockRoot(): string {
  const approvedRoot = getApprovedTempRoot();
  const lockRoot = join(approvedRoot, TEST_RUN_PORT_LOCK_ROOT);
  assertCanonicalPathForWrite(lockRoot, approvedRoot, "test-run port lock root");
  mkdirSync(lockRoot, { recursive: true, mode: 0o700 });
  assertNoSymlinkedAncestors(lockRoot, approvedRoot, "test-run port lock root");
  if (realpathSync(lockRoot) !== lockRoot) throw new Error("Test-run port lock root is not canonical");
  return lockRoot;
}

export function getTestRunPortLockPath(port: number): string {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Test-run port ${String(port)} is outside the user-port range`);
  }
  return join(getTestRunPortLockRoot(), `port-${port}.lock`);
}

function portLockFilePath(lockPath: string): string {
  return join(lockPath, TEST_RUN_PORT_LOCK_FILENAME);
}

function readPortLockOwner(lockPath: string): TestRunPortLockOwner {
  const lockFile = portLockFilePath(lockPath);
  assertCanonicalExistingPath(lockFile, getTestRunPortLockRoot(), "test-run port reservation");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(lockFile, "utf8"));
  } catch {
    throw new Error(`Test-run port reservation is not valid JSON: ${lockPath}`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error(`Invalid test-run port reservation: ${lockPath}`);
  const owner = parsed as Partial<TestRunPortLockOwner> & Record<string, unknown>;
  const port = owner.port;
  const allowedKeys = new Set(["version", "runId", "runNonce", "repoRoot", "runDir", "port"]);
  if (Object.keys(owner).some((key) => !allowedKeys.has(key))
    || owner.version !== TEST_RUN_PORT_LOCK_VERSION
    || !isUuid(owner.runId)
    || !isUuid(owner.runNonce)
    || typeof owner.repoRoot !== "string"
    || typeof owner.runDir !== "string"
    || typeof port !== "number"
    || !Number.isInteger(port)
    || port < 1024
    || port > 65535) {
    throw new Error(`Invalid test-run port reservation: ${lockPath}`);
  }
  assertAbsolutePath(owner.repoRoot, "port reservation repoRoot");
  assertAbsolutePath(owner.runDir, "port reservation runDir");
  return { ...owner, port } as TestRunPortLockOwner;
}

function reservationOwnerMatches(owner: TestRunPortLockOwner, expected: TestRunPortLockOwner): boolean {
  return owner.version === expected.version
    && owner.runId === expected.runId
    && owner.runNonce === expected.runNonce
    && owner.repoRoot === expected.repoRoot
    && owner.runDir === expected.runDir
    && owner.port === expected.port;
}

function ownerForReservation(
  input: Pick<TestRunManifest, "runId" | "runNonce" | "repoRoot" | "runDir">,
  port: number,
): TestRunPortLockOwner {
  return {
    version: TEST_RUN_PORT_LOCK_VERSION,
    runId: input.runId,
    runNonce: input.runNonce,
    repoRoot: input.repoRoot,
    runDir: input.runDir,
    port,
  };
}

function removeOwnedPortLock(
  reservation: TestRunPortReservation,
  owner: TestRunPortLockOwner,
  allowMissing: boolean,
): void {
  const expectedPath = getTestRunPortLockPath(reservation.port);
  if (reservation.path !== expectedPath) {
    throw new Error(`Refusing to release an unowned test-run port reservation: ${reservation.path}`);
  }
  if (!existsSync(expectedPath)) {
    if (allowMissing) return;
    throw new Error(`Test-run port reservation is missing: ${expectedPath}`);
  }
  const canonicalPath = assertCanonicalExistingPath(expectedPath, getTestRunPortLockRoot(), "test-run port reservation");
  const currentOwner = readPortLockOwner(canonicalPath);
  if (!reservationOwnerMatches(currentOwner, owner)) {
    throw new Error(`Refusing to release a test-run port reservation owned by another run: ${expectedPath}`);
  }
  rmSync(canonicalPath, { recursive: true, force: true });
  if (existsSync(canonicalPath)) throw new Error(`Test-run port reservation was not released: ${expectedPath}`);
}

function releasePortReservationsForOwner(
  input: Pick<TestRunManifest, "runId" | "runNonce" | "repoRoot" | "runDir">,
  reservations: TestRunPortReservation[],
  allowMissingAll = false,
): void {
  const errors: Error[] = [];
  for (const reservation of reservations) {
    try {
      removeOwnedPortLock(
        reservation,
        ownerForReservation(input, reservation.port),
        allowMissingAll || reservation.state === "transferred",
      );
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (errors.length > 0) throw new Error(errors.map((error) => error.message).join("\n"));
}

/**
 * Acquire all requested ports before any child process is spawned. Directory
 * creation is the cross-process lock; acquiring in sorted order also avoids
 * partial-order deadlocks when two runners request overlapping port blocks.
 */
export function reserveTestRunPorts(
  input: Pick<TestRunManifest, "runId" | "runNonce" | "repoRoot" | "runDir" | "ports">,
): TestRunPortReservation[] {
  const ports = [...new Set(Object.values(input.ports))].sort((left, right) => left - right);
  const reservations: TestRunPortReservation[] = [];
  try {
    for (const port of ports) {
      const lockPath = getTestRunPortLockPath(port);
      try {
        mkdirSync(lockPath, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error(`Test-run port ${port} is already reserved by another runner`);
        }
        throw error;
      }
      try {
        assertNoSymlinkedAncestors(lockPath, getTestRunPortLockRoot(), "test-run port reservation");
        const owner = ownerForReservation(input, port);
        writeOwnedJson(portLockFilePath(lockPath), owner, getTestRunPortLockRoot(), "test-run port reservation");
        reservations.push({ port, path: lockPath, state: "reserved" });
      } catch (error) {
        rmSync(lockPath, { recursive: true, force: true });
        throw error;
      }
    }
    return reservations;
  } catch (error) {
    try {
      releasePortReservationsForOwner(input, reservations, false);
    } catch {
      // The original reservation conflict/bootstrap failure is the useful
      // error. A failed rollback remains visible through the lock directory.
    }
    throw error;
  }
}

/**
 * Release a run's remaining reservations after terminal process/port cleanup.
 * Transferred reservations are normally already absent; a present lock is
 * still removed only after its owner identity is verified.
 */
export function releaseTestRunPortReservations(
  manifest: Pick<TestRunManifest, "runId" | "runNonce" | "repoRoot" | "runDir" | "ports" | "portReservations">,
  options: { allowMissing?: boolean } = {},
): void {
  const reservations = manifest.portReservations ?? Object.values(manifest.ports).map((port) => ({
    port,
    path: getTestRunPortLockPath(port),
    state: "transferred" as const,
  }));
  releasePortReservationsForOwner(manifest, reservations, options.allowMissing ?? false);
}

/**
 * Mark one port as owned by its ready child, then drop only the matching
 * reservation. The manifest state is durable before the lock is removed so a
 * crash during hand-off leaves recoverable evidence rather than an ambiguous
 * reservation.
 */
export function transferTestRunPortOwnership(manifestPath: string, port: number): void {
  const manifest = readTestRunManifest(manifestPath);
  const reservation = manifest.portReservations?.find((candidate) => candidate.port === port);
  if (!reservation || reservation.state === "transferred") return;
  const updatedReservations = manifest.portReservations!.map((candidate) =>
    candidate.port === port ? { ...candidate, state: "transferred" as const } : candidate,
  );
  updateTestRunManifest(manifestPath, { portReservations: updatedReservations });
  removeOwnedPortLock(
    { ...reservation, state: "transferred" },
    ownerForReservation(manifest, port),
    false,
  );
}

function assertApprovedTempRoot(tempRoot: string): string {
  const approvedRoot = getApprovedTempRoot();
  const resolvedTempRoot = resolve(tempRoot);
  if (!pathIsInside(approvedRoot, resolvedTempRoot)) {
    throw new Error(`Refusing to use a temp root outside the approved root: ${tempRoot}`);
  }
  assertNoSymlinkedAncestors(resolvedTempRoot, approvedRoot, "test-run temp root");
  let canonicalTempRoot: string;
  try {
    canonicalTempRoot = realpathSync(resolvedTempRoot);
  } catch {
    throw new Error(`Refusing to use a non-existent temp root: ${tempRoot}`);
  }
  if (canonicalTempRoot !== resolvedTempRoot) {
    throw new Error(`Refusing to use a symlinked temp root: ${tempRoot}`);
  }
  if (!pathIsInside(approvedRoot, canonicalTempRoot)) {
    throw new Error(`Refusing to use a temp root outside the approved root: ${tempRoot}`);
  }
  return canonicalTempRoot;
}

function assertManifestCandidatePath(manifestPath: string): string {
  if (typeof manifestPath !== "string" || !isAbsolute(manifestPath) || /[\u0000-\u001f\u007f]/.test(manifestPath)) {
    throw new Error("Test-run manifest path must be an absolute, control-character-free path");
  }
  const resolvedPath = resolve(manifestPath);
  if (basename(resolvedPath) !== "run-manifest.json" || !pathIsInside(getApprovedTempRoot(), resolvedPath)) {
    throw new Error(`Refusing to read a manifest outside the approved temp root: ${manifestPath}`);
  }
  assertNoSymlinkedAncestors(dirname(resolvedPath), getApprovedTempRoot(), "test-run manifest");
  const canonicalPath = realpathSync(resolvedPath);
  if (canonicalPath !== resolvedPath || !pathIsInside(getApprovedTempRoot(), canonicalPath)) {
    throw new Error("Refusing to read a symlinked or relocated test-run manifest");
  }
  return resolvedPath;
}

function assertAbsolutePath(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !isAbsolute(value) || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Test-run manifest ${name} must be an absolute path without control characters`);
  }
}

function assertSafeRunDirectory(manifest: TestRunManifest): void {
  const approvedRoot = getApprovedTempRoot();
  const canonicalRepoRoot = getCanonicalRepoRoot(manifest.repoRoot);
  assertAbsolutePath(manifest.tempRoot, "tempRoot");
  assertAbsolutePath(manifest.runDir, "runDir");
  assertAbsolutePath(manifest.manifestPath, "manifestPath");
  if (manifest.apiTokenFile !== undefined) assertAbsolutePath(manifest.apiTokenFile, "apiTokenFile");
  if (manifest.telemetryPath !== undefined) assertAbsolutePath(manifest.telemetryPath, "telemetryPath");
  if (!isAbsolute(manifest.tempRoot) || !isAbsolute(manifest.runDir) || !isAbsolute(manifest.manifestPath)) {
    throw new Error("Refusing to clean a test run with relative paths");
  }
  const runDirName = manifest.runDir.split(/[\\/]/).pop();
  if (!runDirName?.startsWith(TEST_RUN_TEMP_PREFIX)) {
    throw new Error(`Refusing to clean a non-run directory: ${manifest.runDir}`);
  }

  if (!pathIsInside(approvedRoot, manifest.tempRoot)) {
    throw new Error("Refusing to clean a test run outside the canonical approved temp root");
  }
  const tempRoot = assertCanonicalExistingPath(manifest.tempRoot, approvedRoot, "test-run temp root");
  const runDir = assertCanonicalExistingPath(manifest.runDir, approvedRoot, "test-run directory");
  const manifestPath = assertCanonicalExistingPath(manifest.manifestPath, approvedRoot, "test-run manifest");
  if (tempRoot !== resolve(manifest.tempRoot) || !pathIsInside(approvedRoot, tempRoot)) {
    throw new Error("Refusing to clean a test run outside the canonical approved temp root");
  }
  if (runDir !== resolve(manifest.runDir) || manifestPath !== resolve(manifest.manifestPath)) {
    throw new Error("Refusing to clean a symlinked test-run path");
  }
  if (realpathSync(dirname(runDir)) !== tempRoot) {
    throw new Error("Refusing to clean a test-run directory outside its temp root");
  }
  if (!pathIsInside(runDir, manifestPath) || manifestPath !== join(runDir, "run-manifest.json")) {
    throw new Error("Refusing to clean an unexpected test-run manifest path");
  }

  if (manifest.homeDir !== join(runDir, ".ingenium") || manifest.dbPath !== join(manifest.homeDir, "data.db")) {
    throw new Error("Refusing to clean unexpected test-run data paths");
  }
  const apiTokenFile = getTestRunApiTokenPath(manifest);
  if (manifest.apiTokenFile !== undefined && manifest.apiTokenFile !== apiTokenFile) {
    throw new Error("Refusing to clean an unexpected test-run API token path");
  }
  for (const ownedPath of [manifest.homeDir, manifest.dbPath]) {
    if (!pathIsInside(runDir, resolve(ownedPath))) {
      throw new Error(`Refusing to clean an unowned path: ${ownedPath}`);
    }
    if (existsSync(ownedPath) && !pathIsInside(runDir, realpathSync(ownedPath))) {
      throw new Error(`Refusing to clean a symlinked owned path: ${ownedPath}`);
    }
  }
  if (existsSync(apiTokenFile)) {
    const tokenPath = resolve(apiTokenFile);
    if (!pathIsInside(runDir, tokenPath) || realpathSync(tokenPath) !== tokenPath || !lstatSync(tokenPath).isFile()) {
      throw new Error("Refusing to clean a symlinked or non-file test-run API token");
    }
  }

  const telemetryRoot = getTestRunArtifactRoot(canonicalRepoRoot);
  const telemetryPath = getTestRunTelemetryPath(manifest);
  assertCanonicalPathForWrite(dirname(telemetryPath), telemetryRoot, "runner telemetry directory");
  if (telemetryPath !== resolve(telemetryPath)
    || !pathIsInside(telemetryRoot, telemetryPath)
    || basename(telemetryPath) !== TEST_RUN_TELEMETRY_FILENAME
    || dirname(telemetryPath) !== join(telemetryRoot, manifest.runId)) {
    throw new Error("Refusing to use an unowned runner telemetry path");
  }
  if (existsSync(telemetryPath) && realpathSync(telemetryPath) !== telemetryPath) {
    throw new Error("Refusing to use a symlinked runner telemetry path");
  }
}

function writeManifest(manifest: TestRunManifest): void {
  const runDir = assertCanonicalExistingPath(manifest.runDir, getApprovedTempRoot(), "test-run directory");
  const manifestPath = join(runDir, "run-manifest.json");
  if (manifest.manifestPath !== manifestPath) throw new Error("Test-run manifest path is not run-owned");
  writeOwnedJson(manifestPath, manifest, runDir, "test-run manifest");
}

function sameProcessRecord(left: TestRunProcess, right: TestRunProcess): boolean {
  const sameSpawn = left.name === right.name
    && left.pid === right.pid
    && left.runNonce === right.runNonce
    && left.startedAt === right.startedAt;
  if (sameSpawn && (isProvisionalProcessRecord(left) || isProvisionalProcessRecord(right))) return true;
  return sameSpawn
    && left.pidStartTime === right.pidStartTime
    && left.pgid === right.pgid
    && left.groupIdentity === right.groupIdentity;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function validateProcessRecord(
  value: unknown,
  ports: TestRunPorts,
  expectedNonce: string,
  processNames: Set<string>,
  allowDuplicateName = false,
): TestRunProcess {
  if (!value || typeof value !== "object") throw new Error("Invalid test-run process record");
  const record = value as Partial<TestRunProcess>;
  const allowedProcessKeys = new Set([
    "name",
    "pid",
    "port",
    "startedAt",
    "runNonce",
    "pidStartTime",
    "pgid",
    "executable",
    "groupIdentity",
    "identityState",
  ]);
  if (Object.keys(record).some((key) => !allowedProcessKeys.has(key))) {
    throw new Error("Test-run process identity contains unexpected fields");
  }
  const name = record.name;
  const pid = record.pid;
  const port = record.port;
  const pgid = record.pgid;
  const identityState = record.identityState ?? "bound";
  if (name !== "api" && name !== "dashboard" && name !== "fixture" && name !== "build") {
    throw new Error("Invalid test-run process identity");
  }
  const expectedPort = name === "build" ? 0 : ports[name];
  if ((!allowDuplicateName && processNames.has(name))
    || typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 1
    || typeof port !== "number" || !Number.isInteger(port) || port !== expectedPort
    || !isTimestamp(record.startedAt)
    || record.runNonce !== expectedNonce
    || (identityState !== "provisional" && identityState !== "bound")) {
    throw new Error("Invalid test-run process identity");
  }
  if (identityState === "provisional") {
    if (record.pidStartTime !== "pending"
      || pgid !== 0
      || record.executable !== ""
      || record.groupIdentity !== "pending") {
      throw new Error("Invalid provisional test-run process identity");
    }
  } else if (typeof record.pidStartTime !== "string" || !/^\d+$/.test(record.pidStartTime)
    || typeof pgid !== "number" || !Number.isSafeInteger(pgid) || pgid <= 1
    || typeof record.executable !== "string" || !isAbsolute(record.executable)
    || /[\u0000-\u001f\u007f]/.test(record.executable)
    || typeof record.groupIdentity !== "string" || !/^\d+:\d+$/.test(record.groupIdentity)) {
    throw new Error("Invalid test-run process identity");
  }
  processNames.add(name);
  return record as TestRunProcess;
}

function isProvisionalProcessRecord(record: TestRunProcess): boolean {
  return record.identityState === "provisional";
}

function telemetryProcessKey(record: TestRunProcess): string {
  return isProvisionalProcessRecord(record)
    ? `${record.runNonce}:${record.name}:${record.pid}:${record.startedAt}:provisional`
    : `${record.runNonce}:${record.name}:${record.pid}:${record.pidStartTime}:${record.groupIdentity}`;
}

function validateTelemetryShape(value: unknown): TestRunTelemetry {
  if (!value || typeof value !== "object") throw new Error("Runner telemetry must be an object");
  const parsed = value as Partial<TestRunTelemetry> & Record<string, unknown>;
  const allowedKeys = new Set([
    "version",
    "runId",
    "runNonce",
    "repoRoot",
    "manifestPath",
    "status",
    "updatedAt",
    "ports",
    "activeProcesses",
    "processes",
    "failures",
    "resolution",
  ]);
  if (Object.keys(parsed).some((key) => !allowedKeys.has(key))) {
    throw new Error("Runner telemetry contains unexpected fields");
  }
  if (parsed.version !== TEST_RUN_TELEMETRY_VERSION
    || !isUuid(parsed.runId)
    || !isUuid(parsed.runNonce)
    || typeof parsed.repoRoot !== "string"
    || typeof parsed.manifestPath !== "string"
    || !isTimestamp(parsed.updatedAt)
    || !["created", "starting", "running", "stopping", "complete"].includes(parsed.status ?? "")
    || !parsed.ports
    || typeof parsed.ports !== "object"
    || !Array.isArray(parsed.activeProcesses)
    || !Array.isArray(parsed.processes)
    || !Array.isArray(parsed.failures)) {
    throw new Error("Invalid runner telemetry");
  }
  assertAbsolutePath(parsed.repoRoot, "telemetry.repoRoot");
  assertAbsolutePath(parsed.manifestPath, "telemetry.manifestPath");
  const telemetryPorts = parsed.ports as Partial<TestRunPorts>;
  if (Object.keys(telemetryPorts).some((key) => key !== "api" && key !== "dashboard" && key !== "fixture")
    || typeof telemetryPorts.api !== "number"
    || typeof telemetryPorts.dashboard !== "number"
    || typeof telemetryPorts.fixture !== "number") {
    throw new Error("Invalid runner telemetry ports");
  }
  const ports = validatePorts({
    api: telemetryPorts.api,
    dashboard: telemetryPorts.dashboard,
    fixture: telemetryPorts.fixture,
  });

  const processKeys = new Set<string>();
  const processes: TestRunTelemetryProcess[] = [];
  for (const entryValue of parsed.processes) {
    if (!entryValue || typeof entryValue !== "object") throw new Error("Invalid runner telemetry process entry");
    const entry = entryValue as Partial<TestRunTelemetryProcess> & Record<string, unknown>;
    if (Object.keys(entry).some((key) => !["record", "state", "updatedAt", "reason"].includes(key))) {
      throw new Error("Runner telemetry process entry contains unexpected fields");
    }
    if (!Array.isArray(parsed.processes) || !["active", "cleared", "retained"].includes(entry.state ?? "") || !isTimestamp(entry.updatedAt)) {
      throw new Error("Invalid runner telemetry process entry");
    }
    if (entry.reason !== undefined
      && (typeof entry.reason !== "string" || entry.reason.length === 0 || /[\u0000-\u001f\u007f]/.test(entry.reason))) {
      throw new Error("Invalid runner telemetry process reason");
    }
    const record = validateProcessRecord(entry.record, ports, parsed.runNonce, new Set(), true);
    const identityKey = telemetryProcessKey(record);
    if (processKeys.has(identityKey)) throw new Error("Duplicate runner telemetry process identity");
    processKeys.add(identityKey);
    processes.push({ record, state: entry.state as TestRunTelemetryProcessState, updatedAt: entry.updatedAt, ...(entry.reason !== undefined ? { reason: entry.reason } : {}) });
  }

  const activeProcesses: TestRunProcess[] = [];
  for (const value of parsed.activeProcesses) {
    const record = validateProcessRecord(value, ports, parsed.runNonce, new Set(), true);
    if (activeProcesses.some((candidate) => sameProcessRecord(candidate, record))) {
      throw new Error("Duplicate active runner telemetry process identity");
    }
    activeProcesses.push(record);
  }
  const expectedActive = processes
    .filter((entry) => entry.state === "active" || entry.state === "retained")
    .map((entry) => entry.record);
  if (expectedActive.length !== activeProcesses.length
    || expectedActive.some((record, index) => !sameProcessRecord(activeProcesses[index]!, record))) {
    throw new Error("Runner telemetry active process index is inconsistent");
  }
  if (parsed.failures.some((failure) => typeof failure !== "string" || failure.length === 0)) {
    throw new Error("Invalid runner telemetry failures");
  }
  if (parsed.resolution !== undefined) {
    const resolution = parsed.resolution as Partial<TestRunTelemetryResolution> & Record<string, unknown>;
    if (Object.keys(resolution).some((key) => !["status", "resolvedAt", "method"].includes(key))
      || resolution.status !== "resolved"
      || !isTimestamp(resolution.resolvedAt)
      || resolution.method !== "explicit-recovery"
      || parsed.status !== "complete"
      || activeProcesses.length > 0) {
      throw new Error("Invalid runner telemetry resolution");
    }
  }
  return {
    version: TEST_RUN_TELEMETRY_VERSION,
    runId: parsed.runId,
    runNonce: parsed.runNonce,
    repoRoot: parsed.repoRoot,
    manifestPath: parsed.manifestPath,
    status: parsed.status as TestRunManifest["status"],
    updatedAt: parsed.updatedAt,
    ports,
    activeProcesses,
    processes,
    failures: parsed.failures,
    ...(parsed.resolution !== undefined ? { resolution: parsed.resolution as TestRunTelemetryResolution } : {}),
  };
}

function readTelemetryIfPresent(path: string): TestRunTelemetry | undefined {
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Runner telemetry is not valid JSON");
  }
  return validateTelemetryShape(parsed);
}

function telemetryReason(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").slice(0, 16_384);
}

function writeOwnedJson(path: string, value: unknown, containmentRoot: string, name: string): void {
  const resolvedPath = assertCanonicalPathForWrite(path, containmentRoot, name);
  const parent = dirname(resolvedPath);
  assertCanonicalPathForWrite(parent, containmentRoot, `${name} directory`);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  assertNoSymlinkedAncestors(parent, containmentRoot, `${name} directory`);
  if (realpathSync(parent) !== parent) throw new Error(`${name} directory is not canonical`);
  const temporaryPath = join(parent, `.${basename(resolvedPath)}.${randomUUID()}.tmp`);
  try {
    assertCanonicalPathForWrite(temporaryPath, containmentRoot, `${name} temporary file`);
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    assertNoSymlinkedAncestors(temporaryPath, containmentRoot, `${name} temporary file`);
    renameSync(temporaryPath, resolvedPath);
    assertNoSymlinkedAncestors(resolvedPath, containmentRoot, name);
    if (realpathSync(resolvedPath) !== resolvedPath || lstatSync(resolvedPath).isSymbolicLink()) {
      throw new Error(`${name} was relocated during write`);
    }
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
}

function writeRunnerTelemetry(manifest: TestRunManifest, now = new Date().toISOString()): void {
  const telemetryPath = getTestRunTelemetryPath(manifest);
  const artifactDirectory = dirname(telemetryPath);
  const artifactRoot = getTestRunArtifactRoot(manifest.repoRoot);
  assertCanonicalPathForWrite(artifactDirectory, artifactRoot, "runner telemetry directory");
  mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
  assertNoSymlinkedAncestors(artifactDirectory, artifactRoot, "runner telemetry directory");
  const previous = readTelemetryIfPresent(telemetryPath);
  if (previous && (previous.runId !== manifest.runId
    || previous.runNonce !== manifest.runNonce
    || previous.repoRoot !== manifest.repoRoot
    || previous.manifestPath !== manifest.manifestPath)) {
    throw new Error("Runner telemetry identity does not match its manifest");
  }
  const history = previous?.processes ? [...previous.processes] : [];
  for (const entry of history) {
    const current = manifest.processes.find((record) => sameProcessRecord(record, entry.record));
    if (current) {
      // A manifest write can be interrupted after telemetry has recorded the
      // bound identity. Never downgrade that evidence back to a provisional
      // record while repairing the two-file hand-off, but do upgrade a
      // provisional history entry once its durable identity is available.
      if (isProvisionalProcessRecord(entry.record) || !isProvisionalProcessRecord(current)) {
        entry.record = current;
      }
      // A retained identity remains retained while status-only updates (for
      // example the stopping transition) are persisted. It is promoted to
      // active only when a cleared record is deliberately reintroduced.
      if (entry.state === "cleared") entry.state = "active";
      entry.updatedAt = now;
    }
  }
  for (const record of manifest.processes) {
    if (!history.some((entry) => sameProcessRecord(entry.record, record))) {
      history.push({ record, state: "active", updatedAt: now });
    }
  }
  const activeProcesses = history
    .filter((entry) => entry.state === "active" || entry.state === "retained")
    .map((entry) => entry.record);
  const telemetry: TestRunTelemetry = {
    version: TEST_RUN_TELEMETRY_VERSION,
    runId: manifest.runId,
    runNonce: manifest.runNonce,
    repoRoot: manifest.repoRoot,
    manifestPath: manifest.manifestPath,
    status: manifest.status,
    updatedAt: now,
    ports: manifest.ports,
    activeProcesses,
    processes: history,
    failures: previous?.failures ?? [],
    ...(previous?.resolution && manifest.status === "complete" && activeProcesses.length === 0
      ? { resolution: previous.resolution }
      : {}),
  };
  writeOwnedJson(telemetryPath, telemetry, artifactRoot, "runner telemetry");
}

interface TestRunDirectoryIdentity {
  device: number;
  inode: number;
}

function captureRunDirectoryIdentity(runDir: string): TestRunDirectoryIdentity {
  const stat = lstatSync(runDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Test-run directory is not a canonical directory");
  }
  return { device: stat.dev, inode: stat.ino };
}

function assertAllocatedRunDirectory(
  runDir: string,
  tempRoot: string,
  identity: TestRunDirectoryIdentity,
): void {
  const resolvedRunDir = resolve(runDir);
  if (resolvedRunDir !== runDir
    || !basename(runDir).startsWith(TEST_RUN_TEMP_PREFIX)
    || !pathIsInside(tempRoot, runDir)) {
    throw new Error("Refusing to remove an unowned allocated test-run directory");
  }
  assertNoSymlinkedAncestors(runDir, getApprovedTempRoot(), "test-run directory");
  const stat = lstatSync(runDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || stat.dev !== identity.device
    || stat.ino !== identity.inode
    || realpathSync(runDir) !== runDir
    || realpathSync(dirname(runDir)) !== tempRoot) {
    throw new Error("Refusing to remove a relocated allocated test-run directory");
  }
}

function rollbackAllocatedRunDirectory(
  runDir: string,
  tempRoot: string,
  identity: TestRunDirectoryIdentity,
): void {
  assertAllocatedRunDirectory(runDir, tempRoot, identity);
  rmSync(runDir, { recursive: true, force: true });
  if (existsSync(runDir)) throw new Error("Allocated test-run directory was not removed");
}

function errorMessage(value: unknown): string {
  return telemetryReason(value instanceof Error ? value.message : String(value));
}

function combineCreationErrors(primary: unknown, diagnostics: unknown[]): Error {
  if (diagnostics.length === 0) return primary instanceof Error ? primary : new Error(String(primary));
  const errors = [primary, ...diagnostics].map((value) => value instanceof Error ? value : new Error(String(value)));
  const combined = new Error(errors.map((error) => error.message).join("\n"));
  (combined as Error & { errors?: Error[] }).errors = errors;
  return combined;
}

function writeCreationFailureDiagnostic(input: {
  artifactRoot: string;
  runId: string;
  runNonce: string;
  createdAt: string;
  runDir?: string;
  primaryError: unknown;
  cleanupError?: unknown;
}): void {
  const diagnosticPath = join(input.artifactRoot, input.runId, TEST_RUN_CREATION_FAILURE_FILENAME);
  const diagnostic = {
    version: 1,
    runId: input.runId,
    runNonce: input.runNonce,
    createdAt: input.createdAt,
    failedAt: new Date().toISOString(),
    ...(input.runDir !== undefined ? { runDir: input.runDir } : {}),
    error: errorMessage(input.primaryError),
    cleanup: input.cleanupError === undefined ? "removed" : "retained",
    ...(input.cleanupError !== undefined ? { cleanupError: errorMessage(input.cleanupError) } : {}),
  } as const;
  writeOwnedJson(diagnosticPath, diagnostic, input.artifactRoot, "test-run creation failure diagnostic");
}

export function readTestRunTelemetry(telemetryPath: string, expectedRepoRoot = getCanonicalRepoRoot()): TestRunTelemetry {
  assertAbsolutePath(telemetryPath, "telemetryPath");
  const resolvedPath = resolve(telemetryPath);
  const repoRoot = getCanonicalRepoRoot(expectedRepoRoot);
  const artifactRoot = getTestRunArtifactRoot(repoRoot);
  const artifactRelativePath = relative(artifactRoot, resolvedPath).split(/[\\/]/);
  if (!pathIsInside(artifactRoot, resolvedPath)
    || artifactRelativePath.length !== 2
    || artifactRelativePath[1] !== TEST_RUN_TELEMETRY_FILENAME) {
    throw new Error(`Refusing to read runner telemetry outside the canonical artifact root: ${telemetryPath}`);
  }
  if (existsSync(resolvedPath) && realpathSync(resolvedPath) !== resolvedPath) {
    throw new Error("Refusing to read symlinked runner telemetry");
  }
  const telemetry = readTelemetryIfPresent(resolvedPath);
  if (!telemetry) throw new Error(`Runner telemetry does not exist: ${telemetryPath}`);
  if (telemetry.repoRoot !== repoRoot) throw new Error("Runner telemetry repository identity is invalid");
  if (artifactRelativePath[0] !== telemetry.runId || !isUuid(telemetry.runId) || !isUuid(telemetry.runNonce)) {
    throw new Error("Runner telemetry run identity is invalid");
  }
  assertNoSymlinkedAncestors(dirname(resolvedPath), artifactRoot, "runner telemetry");
  const telemetryManifestPath = resolve(telemetry.manifestPath);
  if (basename(telemetryManifestPath) !== "run-manifest.json"
    || !basename(dirname(telemetryManifestPath)).startsWith(TEST_RUN_TEMP_PREFIX)
    || !pathIsInside(getApprovedTempRoot(), telemetryManifestPath)) {
    throw new Error("Runner telemetry manifest path is outside the approved temp root");
  }
  assertNoSymlinkedAncestors(dirname(telemetryManifestPath), getApprovedTempRoot(), "runner telemetry manifest");
  if (existsSync(telemetryManifestPath) && realpathSync(telemetryManifestPath) !== telemetryManifestPath) {
    throw new Error("Runner telemetry manifest path is symlinked");
  }
  return telemetry;
}

export function markTestRunProcessCleared(
  manifestPath: string,
  record: TestRunProcess,
  now = new Date().toISOString(),
): void {
  const manifest = readTestRunManifest(manifestPath);
  const telemetryPath = getTestRunTelemetryPath(manifest);
  const telemetry = readTelemetryIfPresent(telemetryPath);
  if (!telemetry) throw new Error("Cannot clear a process without runner telemetry");
  const entry = telemetry.processes.find((candidate) => sameProcessRecord(candidate.record, record));
  if (entry) {
    entry.state = "cleared";
    entry.updatedAt = now;
  }
  telemetry.updatedAt = now;
  telemetry.activeProcesses = telemetry.processes
    .filter((candidate) => candidate.state === "active" || candidate.state === "retained")
    .map((candidate) => candidate.record);
  writeOwnedJson(telemetryPath, telemetry, getTestRunArtifactRoot(manifest.repoRoot), "runner telemetry");
}

export function recordTestRunTelemetryFailure(
  manifestPath: string,
  reason: string,
  record?: TestRunProcess,
  now = new Date().toISOString(),
): void {
  const manifest = readTestRunManifest(manifestPath);
  const telemetryPath = getTestRunTelemetryPath(manifest);
  const telemetry = readTelemetryIfPresent(telemetryPath);
  if (!telemetry) return;
  telemetry.status = "stopping";
  delete telemetry.resolution;
  telemetry.updatedAt = now;
  const safeReason = telemetryReason(reason);
  telemetry.failures.push(safeReason);
  if (record) {
    let entry = telemetry.processes.find((candidate) => sameProcessRecord(candidate.record, record));
    if (!entry) {
      entry = { record, state: "retained", updatedAt: now, reason: safeReason };
      telemetry.processes.push(entry);
    } else {
      entry.state = "retained";
      entry.reason = safeReason;
      entry.updatedAt = now;
    }
  }
  telemetry.activeProcesses = telemetry.processes
    .filter((candidate) => candidate.state === "active" || candidate.state === "retained")
    .map((candidate) => candidate.record);
  writeOwnedJson(telemetryPath, telemetry, getTestRunArtifactRoot(manifest.repoRoot), "runner telemetry");
}

/**
 * Resolve a manifest only after the lifecycle helper has proved that its
 * identities and ports are gone. The old process entries remain in telemetry
 * as cleared history, including their failure reasons; only the active index
 * and recovery status change.
 */
export function markTestRunRecovered(
  manifestPath: string,
  now = new Date().toISOString(),
): void {
  const manifest = readTestRunManifest(manifestPath);
  const telemetryPath = getTestRunTelemetryPath(manifest);
  const telemetry = readTelemetryIfPresent(telemetryPath);
  if (!telemetry) throw new Error("Cannot resolve a run without runner telemetry");
  for (const entry of telemetry.processes) {
    if (entry.state === "active" || entry.state === "retained") {
      entry.state = "cleared";
      entry.updatedAt = now;
    }
  }
  telemetry.status = "complete";
  telemetry.updatedAt = now;
  telemetry.activeProcesses = [];
  telemetry.resolution = {
    status: "resolved",
    resolvedAt: now,
    method: "explicit-recovery",
  };
  writeOwnedJson(telemetryPath, telemetry, getTestRunArtifactRoot(manifest.repoRoot), "runner telemetry");
}

export function createTestRunContext(options: CreateTestRunContextOptions = {}): TestRunContext {
  const now = options.now ?? (() => new Date());
  const repoRoot = getCanonicalRepoRoot(options.repoRoot ?? process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT ?? process.cwd());
  const tempRoot = assertApprovedTempRoot(resolve(options.tempRoot ?? getApprovedTempRoot()));
  assertNoSymlinkedAncestors(tempRoot, getApprovedTempRoot(), "test-run temp root");

  // Complete all caller/environment configuration validation before allocating
  // a run directory. A malformed port configuration must not leave behind a
  // directory that has no manifest and therefore cannot be recovered safely.
  const runId = randomUUID();
  const runNonce = randomUUID();
  const defaults = portsFromEnvironment(runId);
  const ports = validatePorts({
    api: options.ports?.api ?? defaults.api,
    dashboard: options.ports?.dashboard ?? defaults.dashboard,
    fixture: options.ports?.fixture ?? defaults.fixture,
  });
  const createdAt = now().toISOString();
  const artifactRoot = getTestRunArtifactRoot(repoRoot);
  const telemetryPath = join(artifactRoot, runId, TEST_RUN_TELEMETRY_FILENAME);
  assertCanonicalPathForWrite(telemetryPath, artifactRoot, "runner telemetry path");

  let runDirPath: string | undefined;
  let runDir: string | undefined;
  let runDirectoryIdentity: TestRunDirectoryIdentity | undefined;
  let portReservations: TestRunPortReservation[] = [];
  try {
    runDirPath = mkdtempSync(join(tempRoot, TEST_RUN_TEMP_PREFIX));
    assertNoSymlinkedAncestors(runDirPath, getApprovedTempRoot(), "test-run directory");
    runDir = assertCanonicalExistingPath(runDirPath, getApprovedTempRoot(), "test-run directory");
    runDirectoryIdentity = captureRunDirectoryIdentity(runDir);
    options.afterRunDirectoryCreated?.(runDir);
    assertAllocatedRunDirectory(runDir, tempRoot, runDirectoryIdentity);

    const homeDir = join(runDir, ".ingenium");
    mkdirSync(homeDir, { recursive: true });
    assertNoSymlinkedAncestors(homeDir, runDir, "test-run home directory");
    if (realpathSync(homeDir) !== homeDir) throw new Error("Test-run home directory is not canonical");

    portReservations = reserveTestRunPorts({
      runId,
      runNonce,
      repoRoot,
      runDir,
      ports,
    });

    const manifest: TestRunContext = {
      version: TEST_RUN_MANIFEST_VERSION,
      runId,
      runNonce,
      createdAt,
      status: "created",
      repoRoot,
      tempRoot,
      runDir,
      homeDir,
      dbPath: join(homeDir, "data.db"),
      apiTokenFile: join(homeDir, TEST_RUN_API_TOKEN_FILENAME),
      manifestPath: join(runDir, "run-manifest.json"),
      telemetryPath,
      project: getTestRunProjectName(runId),
      ports,
      portReservations,
      processes: [],
    };

    writeManifest(manifest);
    writeRunnerTelemetry(manifest, manifest.createdAt);
    if (options.applyEnvironment ?? true) applyTestRunEnvironment(manifest);
    return manifest;
  } catch (error) {
    // mkdtempSync is the ownership boundary. Before it succeeds there is no
    // run directory to roll back; after it succeeds, never leave an untracked
    // directory behind merely because bootstrap failed. The inode check makes
    // this rollback fail closed if the path was replaced between operations.
    if (runDirPath !== undefined) {
      let cleanupError: unknown;
      if (portReservations.length > 0 && runDir !== undefined) {
        try {
          releasePortReservationsForOwner({ runId, runNonce, repoRoot, runDir }, portReservations, false);
        } catch (reservationError) {
          cleanupError = reservationError;
        }
      }
      if (runDir !== undefined && runDirectoryIdentity !== undefined) {
        try {
          rollbackAllocatedRunDirectory(runDir, tempRoot, runDirectoryIdentity);
        } catch (rollbackError) {
          cleanupError = rollbackError;
        }
      } else {
        cleanupError = new Error("Allocated test-run directory could not be proven safe to remove");
      }

      const diagnostics: unknown[] = [];
      if (cleanupError !== undefined) diagnostics.push(cleanupError);
      try {
        writeCreationFailureDiagnostic({
          artifactRoot,
          runId,
          runNonce,
          createdAt,
          runDir: runDirPath,
          primaryError: error,
          cleanupError,
        });
      } catch (diagnosticError) {
        diagnostics.push(diagnosticError);
      }
      throw combineCreationErrors(error, diagnostics);
    }
    throw error;
  }
}

export function applyTestRunEnvironment(manifest: TestRunManifest): void {
  process.env[TEST_RUN_MANIFEST_ENV] = manifest.manifestPath;
  process.env[TEST_RUN_NONCE_ENV] = manifest.runNonce;
  process.env[TEST_RUN_TELEMETRY_ENV] = getTestRunTelemetryPath(manifest);
  process.env.INGENIUM_CORE_DB_PATH = manifest.dbPath;
  process.env.INGENIUM_HOME = manifest.homeDir;
  process.env.INGENIUM_PROJECT = manifest.project;
  process.env.INGENIUM_API_TOKEN_FILE = getTestRunApiTokenPath(manifest);
  process.env.INGENIUM_E2E_API_PORT = String(manifest.ports.api);
  process.env.INGENIUM_E2E_DASH_PORT = String(manifest.ports.dashboard);
  process.env.INGENIUM_E2E_FIXTURE_PORT = String(manifest.ports.fixture);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseManifest(value: string): TestRunContext {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Test-run manifest is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Test-run manifest must be an object");
  const manifest = parsed as Partial<TestRunContext> & Record<string, unknown>;
  const allowedManifestKeys = new Set([
    "version",
    "runId",
    "runNonce",
    "createdAt",
    "status",
    "repoRoot",
    "tempRoot",
    "runDir",
    "homeDir",
    "dbPath",
    "apiTokenFile",
    "manifestPath",
    "telemetryPath",
    "project",
    "projectProvisionedAt",
    "ports",
    "portReservations",
    "processes",
  ]);
  if (Object.keys(parsed).some((key) => !allowedManifestKeys.has(key))) {
    throw new Error("Test-run manifest contains unexpected fields");
  }
  if (manifest.version !== TEST_RUN_MANIFEST_VERSION) {
    throw new Error("Unsupported test-run manifest");
  }
  if (
    !isUuid(manifest.runId)
    || !isUuid(manifest.runNonce)
    || !isTimestamp(manifest.createdAt)
    || !["created", "starting", "running", "stopping", "complete"].includes(manifest.status ?? "")
    || typeof manifest.repoRoot !== "string"
    || typeof manifest.tempRoot !== "string"
    || typeof manifest.runDir !== "string"
    || typeof manifest.homeDir !== "string"
    || typeof manifest.dbPath !== "string"
    || (manifest.apiTokenFile !== undefined && typeof manifest.apiTokenFile !== "string")
    || typeof manifest.manifestPath !== "string"
    || typeof manifest.project !== "string"
    || !manifest.ports
    || !Array.isArray(manifest.processes)
  ) {
    throw new Error("Incomplete test-run manifest");
  }
  for (const [name, value] of Object.entries({
    repoRoot: manifest.repoRoot,
    tempRoot: manifest.tempRoot,
    runDir: manifest.runDir,
    homeDir: manifest.homeDir,
    dbPath: manifest.dbPath,
    ...(manifest.apiTokenFile !== undefined ? { apiTokenFile: manifest.apiTokenFile } : {}),
    manifestPath: manifest.manifestPath,
  })) {
    assertAbsolutePath(value, name);
  }
  if (!manifest.project.trim() || /[\u0000-\u001f\u007f]/.test(manifest.project)) {
    throw new Error("Invalid test-run project identity");
  }
  if (manifest.project !== getTestRunProjectName(manifest.runId)) {
    throw new Error("Test-run project identity is not run-owned");
  }
  if (manifest.projectProvisionedAt !== undefined && !isTimestamp(manifest.projectProvisionedAt)) {
    throw new Error("Invalid test-run project provisioning timestamp");
  }
  const ports = manifest.ports as Partial<TestRunPorts>;
  if (Object.keys(ports).some((key) => key !== "api" && key !== "dashboard" && key !== "fixture")) {
    throw new Error("Test-run port manifest contains unexpected fields");
  }
  if (typeof ports.api !== "number" || typeof ports.dashboard !== "number" || typeof ports.fixture !== "number") {
    throw new Error("Incomplete test-run port manifest");
  }
  const validatedPorts = validatePorts({
    api: ports.api as number,
    dashboard: ports.dashboard as number,
    fixture: ports.fixture as number,
  });

  if (manifest.portReservations !== undefined) {
    if (!Array.isArray(manifest.portReservations)) throw new Error("Invalid test-run port reservations");
    const reservationPorts = new Set<number>();
    for (const value of manifest.portReservations) {
      if (!value || typeof value !== "object") throw new Error("Invalid test-run port reservation");
      const reservation = value as Partial<TestRunPortReservation> & Record<string, unknown>;
      if (Object.keys(reservation).some((key) => !["port", "path", "state"].includes(key))
        || typeof reservation.port !== "number"
        || !Object.values(validatedPorts).includes(reservation.port)
        || reservationPorts.has(reservation.port)
        || typeof reservation.path !== "string"
        || !isAbsolute(reservation.path)
        || /[\u0000-\u001f\u007f]/.test(reservation.path)
        || (reservation.state !== "reserved" && reservation.state !== "transferred")
        || reservation.path !== getTestRunPortLockPath(reservation.port)) {
        throw new Error("Invalid test-run port reservation");
      }
      reservationPorts.add(reservation.port);
    }
  }

  const processNames = new Set<string>();
  manifest.processes = manifest.processes.map((processRecord) => validateProcessRecord(
    processRecord,
    validatedPorts,
    manifest.runNonce as string,
    processNames,
  ));
  return manifest as TestRunContext;
}

export function readTestRunManifest(manifestPath: string): TestRunContext {
  const resolvedPath = assertManifestCandidatePath(manifestPath);
  const manifest = parseManifest(readFileSync(resolvedPath, "utf8"));
  if (resolve(manifest.manifestPath) !== resolvedPath) {
    throw new Error("Test-run manifest path does not match its contents");
  }
  assertSafeRunDirectory(manifest);
  return manifest;
}

export function getTestRunContext(): TestRunContext {
  if (cachedContext) return cachedContext;
  const manifestPath = process.env[TEST_RUN_MANIFEST_ENV];
  cachedContext = manifestPath
    ? readTestRunManifest(manifestPath)
    : createTestRunContext();
  applyTestRunEnvironment(cachedContext);
  return cachedContext;
}

export function updateTestRunManifest(
  manifestPath: string,
  update: Partial<Pick<TestRunManifest, "status" | "projectProvisionedAt" | "portReservations" | "processes">>,
): TestRunContext {
  const manifest = readTestRunManifest(manifestPath);
  const updated: TestRunContext = { ...manifest, ...update };
  // Telemetry is the recovery side of the hand-off. Persist it first so a
  // failure between the two files cannot leave a `complete` manifest with
  // unresolved telemetry. A later recovery pass can safely reconcile a
  // stopping manifest whose telemetry is already ahead.
  writeRunnerTelemetry(updated);
  writeManifest(updated);
  return updated;
}

/**
 * Remove exactly the run directory recorded in its own manifest.
 *
 * This deliberately does not scan tmpdir(), match a glob, or remove stale
 * directories. A malformed, symlinked, or relocated manifest fails closed.
 */
export function cleanupTestRun(manifestPath: string): void {
  if (!existsSync(manifestPath)) return;
  const manifest = readTestRunManifest(manifestPath);
  if (manifest.status === "stopping") {
    throw new Error("Refusing to remove recovery evidence for a stopping test run");
  }
  if (manifest.processes.length > 0) {
    throw new Error("Refusing to remove a test run with retained process records");
  }
  if (manifest.status === "created") {
    const telemetry = readTelemetryIfPresent(getTestRunTelemetryPath(manifest));
    if (!telemetry
      || telemetry.runId !== manifest.runId
      || telemetry.runNonce !== manifest.runNonce
      || telemetry.repoRoot !== manifest.repoRoot
      || resolve(telemetry.manifestPath) !== resolve(manifest.manifestPath)
      || telemetry.activeProcesses.length > 0
      || telemetry.processes.some((entry) => entry.state === "active" || entry.state === "retained")) {
      throw new Error("Refusing to remove a created run with unresolved telemetry");
    }
    // A config/bootstrap failure can delete a created manifest before the
    // normal stopping → complete transition. Resolve its already-empty
    // telemetry first so the retained artifact is never an orphan record.
    telemetry.status = "complete";
    telemetry.updatedAt = new Date().toISOString();
    telemetry.resolution = {
      status: "resolved",
      resolvedAt: telemetry.updatedAt,
      method: "explicit-recovery",
    };
    writeOwnedJson(
      getTestRunTelemetryPath(manifest),
      telemetry,
      getTestRunArtifactRoot(manifest.repoRoot),
      "runner telemetry",
    );
  } else if (manifest.status !== "complete") {
    throw new Error(`Refusing to remove a test run in ${manifest.status} state`);
  } else {
    const telemetry = readTelemetryIfPresent(getTestRunTelemetryPath(manifest));
    if (!telemetry || telemetry.status !== "complete"
      || telemetry.activeProcesses.length > 0
      || telemetry.resolution?.status !== "resolved") {
      throw new Error("Refusing to remove a complete run without resolved telemetry");
    }
  }
  const apiTokenFile = getTestRunApiTokenPath(manifest);
  releaseTestRunPortReservations(manifest, { allowMissing: true });
  rmSync(manifest.runDir, { recursive: true, force: true });
  const environment = {
    [TEST_RUN_MANIFEST_ENV]: manifest.manifestPath,
    [TEST_RUN_NONCE_ENV]: manifest.runNonce,
    [TEST_RUN_TELEMETRY_ENV]: getTestRunTelemetryPath(manifest),
    INGENIUM_CORE_DB_PATH: manifest.dbPath,
    INGENIUM_HOME: manifest.homeDir,
    INGENIUM_PROJECT: manifest.project,
    INGENIUM_API_TOKEN_FILE: apiTokenFile,
    INGENIUM_E2E_API_PORT: String(manifest.ports.api),
    INGENIUM_E2E_DASH_PORT: String(manifest.ports.dashboard),
    INGENIUM_E2E_FIXTURE_PORT: String(manifest.ports.fixture),
  };
  for (const [name, value] of Object.entries(environment)) {
    if (process.env[name] === value) delete process.env[name];
  }
  cachedContext = undefined;
}

export interface StaleRunCleanupResult {
  inspected: number;
  cleaned: string[];
  skipped: Array<{ path: string; reason: string }>;
}

/**
 * Remove only old, empty, schema-valid runs owned by this fixture.
 *
 * The directory scan is discovery only. No directory is removed unless its
 * exact manifest passes all schema, canonical-root, and ownership checks.
 * Directories with no manifest (including old Playwright temp directories)
 * are deliberately retained because their ownership cannot be proven.
 */
export function cleanupStaleTestRuns(
  options: { root?: string; now?: number; staleAfterMs?: number; excludeRunId?: string } = {},
): StaleRunCleanupResult {
  const root = assertApprovedTempRoot(resolve(options.root ?? getApprovedTempRoot()));
  const now = options.now ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? TEST_RUN_STALE_AFTER_MS;
  const result: StaleRunCleanupResult = { inspected: 0, cleaned: [], skipped: [] };

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(TEST_RUN_STALE_PREFIX)) continue;
    result.inspected += 1;
    const candidate = join(root, entry.name, "run-manifest.json");
    if (!existsSync(candidate)) {
      result.skipped.push({ path: join(root, entry.name), reason: "manifest missing" });
      continue;
    }
    try {
      const manifest = readTestRunManifest(candidate);
      if (manifest.runId === options.excludeRunId) continue;
      if (now - Date.parse(manifest.createdAt) < staleAfterMs) continue;
      if (manifest.status !== "created" && manifest.status !== "complete") {
        result.skipped.push({ path: manifest.runDir, reason: `status=${manifest.status}` });
        continue;
      }
      if (manifest.processes.length > 0) {
        result.skipped.push({ path: manifest.runDir, reason: "process records present" });
        continue;
      }
      cleanupTestRun(candidate);
      result.cleaned.push(manifest.runDir);
    } catch (error) {
      result.skipped.push({ path: candidate, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  cleanupOrphanedTestRunPortReservations();
  return result;
}

export function resetTestRunContextForTests(): void {
  cachedContext = undefined;
  cleanupOrphanedTestRunPortReservations();
}

/**
 * Test-process recovery for a runner that removed its temp directory before
 * normal manifest cleanup ran. A lock is orphaned only when its verified owner
 * run directory is gone; locks for live/recovery runs remain untouched.
 */
export function cleanupOrphanedTestRunPortReservations(): string[] {
  const lockRoot = getTestRunPortLockRoot();
  const removed: string[] = [];
  for (const entry of readdirSync(lockRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^port-\d+\.lock$/.test(entry.name)) continue;
    const lockPath = join(lockRoot, entry.name);
    try {
      const owner = readPortLockOwner(lockPath);
      if (existsSync(owner.runDir)) continue;
      assertNoSymlinkedAncestors(lockPath, lockRoot, "orphaned test-run port reservation");
      rmSync(lockPath, { recursive: true, force: true });
      if (!existsSync(lockPath)) removed.push(lockPath);
    } catch {
      // Unknown/corrupt reservations are evidence, not safe cleanup targets.
    }
  }
  return removed;
}

export function getPortEnvironment(manifest: TestRunManifest): Record<string, string> {
  return {
    INGENIUM_API_PORT: String(manifest.ports.api),
    PORT: String(manifest.ports.dashboard),
    CHAT_FIXTURE_PORT: String(manifest.ports.fixture),
  };
}

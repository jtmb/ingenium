import { connect } from "node:net";
import {
  existsSync,
  readdirSync,
  realpathSync,
  readFileSync,
  readlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  TEST_RUN_MANIFEST_ENV,
  TEST_RUN_TELEMETRY_ENV,
  getCanonicalRepoRoot,
  getTestRunArtifactRoot,
  getTestRunTelemetryPath,
  readTestRunManifest,
  readTestRunTelemetry,
  type TestRunManifest,
  type TestRunProcess,
  type TestRunTelemetry,
} from "./test-run-context";
import { inspectProcessIdentity, type ProcessIdentity } from "./test-server-lifecycle";

const DEFAULT_PORTS = [3000, 4097, 4098, 4099, 4999];
const DEFAULT_TEMP_PREFIX = "ingenium-playwright-";
const DEFAULT_RSS_LIMIT = 512 * 1024 * 1024;

interface PortState {
  port: number;
  listening: boolean;
  owned: boolean;
}

export interface ManagedProcessState {
  name: string;
  pid: number;
  port: number;
  expectedRunNonce: string;
  state: "running" | "exited" | "identity-mismatch" | "unobservable";
  identity?: ProcessIdentity;
}

export interface DiscoveredProcessState {
  pid: number;
  pidStartTime: string;
  pgid: number;
  groupIdentity: string;
  cwd: string;
  executable: string;
  runNonce?: string;
  listeningPorts: number[];
  reason: "manifestless-candidate";
}

export type ArtifactClassification =
  | "legacy-visual-qa-manual"
  | "legacy-visual-qa"
  | "legacy-test-run"
  | "legacy-playwright-mcp"
  | "misplaced-test-results"
  | "unscoped-visual-qa";

export interface ArtifactEvidenceClassification {
  path: string;
  classification: ArtifactClassification;
  disposition: "informational" | "failure";
}

export interface ContainmentAuditReport {
  repoRoot: string;
  manifestPath?: string;
  manifestStatus?: TestRunManifest["status"];
  ports: PortState[];
  managedPorts: number[];
  expectedPorts: number[];
  tempEntries: string[];
  managedProcesses: ManagedProcessState[];
  discoveredProcesses: DiscoveredProcessState[];
  holds: string[];
  telemetryErrors: string[];
  /** Retained evidence from pre-runner/legacy suites; never a runnable run. */
  legacyEvidence: string[];
  /** Human-readable audit information that is intentionally not a failure. */
  informational: string[];
  /** Explicit classification of retained evidence and hygiene residuals. */
  artifactClassifications: ArtifactEvidenceClassification[];
  /** Artifact residuals that require action; evidence is never deleted here. */
  artifactResiduals: string[];
  /** True when the repository-wide artifact scan is enabled for strict audit. */
  repositoryArtifactScan: boolean;
  telemetry: Array<Pick<TestRunTelemetry, "runId" | "status" | "updatedAt" | "failures" | "resolution"> & {
    path: string;
    manifestPath: string;
    activeProcessCount: number;
    manifestState: "valid" | "missing" | "invalid";
    manifestError?: string;
  }>;
  process: { activeHandles: number; rssBytes: number };
  rssLimitBytes: number;
}

type TelemetryManifestState = "valid" | "missing" | "invalid";

export interface ContainmentAuditOptions {
  /** Explicit telemetry scope for an isolated runner/test context. */
  telemetryPaths?: string[];
  /** Repository-wide discovery is reserved for the explicit strict audit. */
  includeRepositoryTelemetry?: boolean;
  manifestPath?: string;
}

interface TelemetryManifestCheck {
  state: TelemetryManifestState;
  error?: string;
}

function checkTelemetryManifest(entry: TestRunTelemetry, repoRoot: string): TelemetryManifestCheck {
  if (!existsSync(entry.manifestPath)) return { state: "missing", error: "manifest is missing" };
  try {
    const manifest = readTestRunManifest(entry.manifestPath);
    const identityMatches = manifest.runId === entry.runId
      && manifest.runNonce === entry.runNonce
      && manifest.repoRoot === repoRoot
      && resolve(manifest.manifestPath) === resolve(entry.manifestPath)
      && manifest.ports.api === entry.ports.api
      && manifest.ports.dashboard === entry.ports.dashboard
      && manifest.ports.fixture === entry.ports.fixture;
    if (!identityMatches) {
      return { state: "invalid", error: "manifest identity does not match telemetry" };
    }
    return { state: "valid" };
  } catch (error) {
    return {
      state: "invalid",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parsePorts(): number[] {
  const raw = process.env.INGENIUM_AUDIT_PORTS;
  if (!raw) return DEFAULT_PORTS;

  const values = raw.split(",").map((value) => value.trim());
  if (values.length === 0 || values.some((value) => !/^\d+$/.test(value))) {
    throw new Error("INGENIUM_AUDIT_PORTS must contain only valid TCP ports");
  }
  const ports = values.map(Number);
  if (ports.some((value) => !Number.isInteger(value) || value < 1 || value > 65535)) {
    throw new Error("INGENIUM_AUDIT_PORTS must contain valid TCP ports");
  }
  return [...new Set(ports)];
}

function parseExpectedPorts(): Set<number> {
  const raw = process.env.INGENIUM_AUDIT_EXPECT_PORTS;
  if (!raw) return new Set();
  const values = raw.split(",").map((value) => value.trim());
  if (values.some((value) => !/^\d+$/.test(value))) {
    throw new Error("INGENIUM_AUDIT_EXPECT_PORTS must contain only valid TCP ports");
  }
  const ports = values.map(Number);
  if (ports.some((value) => !Number.isInteger(value) || value < 1 || value > 65535)) {
    throw new Error("INGENIUM_AUDIT_EXPECT_PORTS must contain valid TCP ports");
  }
  return new Set(ports);
}

function isListening(port: number): Promise<boolean> {
  return new Promise((resolveResult) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (listening: boolean) => {
      socket.destroy();
      resolveResult(listening);
    };
    socket.setTimeout(750, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function auditPorts(ports: number[], ownedPorts: Set<number>): Promise<PortState[]> {
  return Promise.all(ports.map(async (port) => ({
    port,
    listening: await isListening(port),
    owned: ownedPorts.has(port),
  })));
}

function auditTemp(resolvedManifestPaths: Set<string> = new Set()): string[] {
  const entries = readdirSync(tmpdir(), { withFileTypes: true });
  const prefix = process.env.INGENIUM_AUDIT_TEMP_PREFIX ?? DEFAULT_TEMP_PREFIX;
  return entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => join(tmpdir(), entry.name))
    .filter((path) => !resolvedManifestPaths.has(join(path, "run-manifest.json")));
}

function auditProcesses(): { activeHandles: number; rssBytes: number } {
  const processWithHandles = process as NodeJS.Process & {
    _getActiveHandles?: () => unknown[];
  };
  return {
    activeHandles: processWithHandles._getActiveHandles?.().length ?? -1,
    rssBytes: process.memoryUsage().rss,
  };
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
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

function identityMatches(record: TestRunProcess, identity: ProcessIdentity, expectedRunNonce: string): boolean {
  return identity.runNonce === expectedRunNonce
    && identity.pidStartTime === record.pidStartTime
    && identity.pgid === record.pgid
    && executableMatches(record.executable, identity.executable)
    && identity.groupIdentity === record.groupIdentity;
}

function inspectManagedProcess(record: TestRunProcess, expectedRunNonce: string): ManagedProcessState {
  const identity = inspectProcessIdentity(record.pid);
  if (identity && identityMatches(record, identity, expectedRunNonce)) {
    return { name: record.name, pid: record.pid, port: record.port, expectedRunNonce, state: "running", identity };
  }
  if (!identity && !processExists(record.pid)) {
    return { name: record.name, pid: record.pid, port: record.port, expectedRunNonce, state: "exited" };
  }
  if (!identity) {
    return { name: record.name, pid: record.pid, port: record.port, expectedRunNonce, state: "unobservable" };
  }
  return {
    name: record.name,
    pid: record.pid,
    port: record.port,
    expectedRunNonce,
    state: "identity-mismatch",
    identity,
  };
}

function isLegacyEvidencePath(path: string, repoRoot: string): boolean {
  const artifactRoot = getTestRunArtifactRoot(repoRoot);
  const parts = relative(artifactRoot, resolve(path)).split(/[\\/]/);
  return parts.length >= 2 && /^legacy-/.test(parts[0] ?? "");
}

function legacyEvidenceDirectories(repoRoot: string): string[] {
  const artifactRoot = getTestRunArtifactRoot(repoRoot);
  const testRunEvidence = !existsSync(artifactRoot)
    ? []
    : readdirSync(artifactRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^legacy-/.test(entry.name))
    .map((entry) => join(artifactRoot, entry.name));
  const visualQaRoot = join(repoRoot, "tests", "artifacts", "visual-qa");
  const visualEvidence = !existsSync(visualQaRoot)
    ? []
    : readdirSync(visualQaRoot, { withFileTypes: true })
      .filter((entry) => /^manual-/.test(entry.name) || /^legacy-/.test(entry.name))
      .map((entry) => join(visualQaRoot, entry.name));
  const playwrightMcp = join(repoRoot, ".playwright-mcp");
  const mcpEvidence = existsSync(playwrightMcp) ? [playwrightMcp] : [];
  return [...testRunEvidence, ...visualEvidence, ...mcpEvidence].sort();
}

function artifactEvidenceClassifications(repoRoot: string): ArtifactEvidenceClassification[] {
  const classifications: ArtifactEvidenceClassification[] = [];
  const testRunRoot = getTestRunArtifactRoot(repoRoot);
  if (existsSync(testRunRoot)) {
    for (const entry of readdirSync(testRunRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && /^legacy-/.test(entry.name)) {
        classifications.push({
          path: join(testRunRoot, entry.name),
          classification: "legacy-test-run",
          disposition: "informational",
        });
      }
    }
  }

  const visualQaRoot = join(repoRoot, "tests", "artifacts", "visual-qa");
  if (existsSync(visualQaRoot)) {
    for (const entry of readdirSync(visualQaRoot, { withFileTypes: true })) {
      const entryPath = join(visualQaRoot, entry.name);
      if (/^manual-/.test(entry.name)) {
        classifications.push({
          path: entryPath,
          classification: "legacy-visual-qa-manual",
          disposition: "informational",
        });
      } else if (/^legacy-/.test(entry.name)) {
        classifications.push({
          path: entryPath,
          classification: "legacy-visual-qa",
          disposition: "informational",
        });
      } else if (!entry.isDirectory()) {
        classifications.push({
          path: entryPath,
          classification: "unscoped-visual-qa",
          disposition: "failure",
        });
      }
    }
  }

  const playwrightMcp = join(repoRoot, ".playwright-mcp");
  if (existsSync(playwrightMcp)) {
    classifications.push({
      path: playwrightMcp,
      classification: "legacy-playwright-mcp",
      disposition: "informational",
    });
  }

  const misplacedTestResults = join(repoRoot, "tests", "tests", "test-results");
  if (existsSync(misplacedTestResults)) {
    classifications.push({
      path: misplacedTestResults,
      classification: "misplaced-test-results",
      disposition: "failure",
    });
  }

  return classifications.sort((left, right) => left.path.localeCompare(right.path));
}

function telemetryCandidates(
  repoRoot: string,
  manifest: TestRunManifest | undefined,
  options: ContainmentAuditOptions,
): string[] {
  const candidates = new Set<string>();
  const configured = options.telemetryPaths ?? (
    process.env[TEST_RUN_TELEMETRY_ENV] !== undefined
      ? [process.env[TEST_RUN_TELEMETRY_ENV] as string]
      : undefined
  );
  for (const path of configured ?? []) candidates.add(resolve(path));
  if (manifest) candidates.add(getTestRunTelemetryPath(manifest));

  // A configured run (the normal default Playwright path) is deliberately
  // scoped to its own telemetry. Scanning every historical/current run here
  // made two concurrent runners observe each other's teardown snapshots.
  if (configured !== undefined || manifest !== undefined || options.includeRepositoryTelemetry !== true) {
    return [...candidates];
  }

  // Successful teardown removes the temp manifest, but deliberately retains
  // the run-scoped telemetry under the canonical repository artifact root.
  // Discovery reads only existing exact runner-telemetry.json files; it never
  // turns creation diagnostics or retained legacy evidence into missing-run
  // telemetry errors, and it never deletes or glob-removes artifacts.
  const artifactRoot = getTestRunArtifactRoot(repoRoot);
  if (existsSync(artifactRoot)) {
    for (const entry of readdirSync(artifactRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || /^legacy-/.test(entry.name)) continue;
      const telemetryPath = join(artifactRoot, entry.name, "runner-telemetry.json");
      if (existsSync(telemetryPath)) candidates.add(telemetryPath);
    }
  }
  return [...candidates];
}

function loadManifest(repoRoot: string, configuredManifestPath = process.env[TEST_RUN_MANIFEST_ENV]): { manifest?: TestRunManifest; error?: string } {
  const manifestPath = configuredManifestPath;
  if (!manifestPath) return {};
  if (!existsSync(manifestPath)) return { error: `manifest is missing: ${manifestPath}` };
  try {
    const manifest = readTestRunManifest(manifestPath);
    if (manifest.repoRoot !== repoRoot) return { error: "manifest repository root does not match the canonical artifact root" };
    return { manifest };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function collectManagedRecords(
  manifest: TestRunManifest | undefined,
  telemetry: TestRunTelemetry[],
): Array<{ record: TestRunProcess; runNonce: string }> {
  const records = new Map<string, { record: TestRunProcess; runNonce: string }>();
  if (manifest) {
    for (const record of manifest.processes) {
      records.set(`${manifest.runNonce}:${record.name}:${record.pid}:${record.startedAt}`, {
        record,
        runNonce: manifest.runNonce,
      });
    }
  }
  for (const entry of telemetry) {
    for (const process of entry.processes) {
      if (process.state !== "active" && process.state !== "retained") continue;
      records.set(`${entry.runNonce}:${process.record.name}:${process.record.pid}:${process.record.startedAt}`, {
        record: process.record,
        runNonce: entry.runNonce,
      });
    }
  }
  return [...records.values()];
}

function pathIsInside(parent: string, child: string): boolean {
  const fromParent = relative(resolve(parent), resolve(child));
  return fromParent === "" || (!fromParent.startsWith("..") && !isAbsolute(fromParent));
}

function readProcNonce(pid: number): string | undefined {
  try {
    const environ = readFileSync(`/proc/${pid}/environ`, "utf8");
    return environ.split("\u0000")
      .find((entry) => entry.startsWith("INGENIUM_TEST_RUN_NONCE="))
      ?.slice("INGENIUM_TEST_RUN_NONCE=".length);
  } catch {
    return undefined;
  }
}

function readListeningInodes(): Map<string, number[]> {
  const inodes = new Map<string, number[]>();
  if (process.platform === "win32") return inodes;
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      const lines = readFileSync(file, "utf8").trim().split("\n").slice(1);
      for (const line of lines) {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 10 || fields[3] !== "0A") continue;
        const portText = fields[1]?.split(":")[1];
        const port = portText ? Number.parseInt(portText, 16) : Number.NaN;
        const inode = fields[9];
        if (!Number.isInteger(port) || port < 1 || port > 65535 || !inode || !/^\d+$/.test(inode)) continue;
        const ports = inodes.get(inode) ?? [];
        if (!ports.includes(port)) ports.push(port);
        inodes.set(inode, ports);
      }
    } catch {
      // /proc/net may be unavailable in a restricted audit environment. The
      // process identity scan remains read-only and still reports nonce-bound
      // candidates.
    }
  }
  return inodes;
}

function listeningPortsForPid(pid: number, inodes: Map<string, number[]>): number[] {
  const ports = new Set<number>();
  try {
    for (const fd of readdirSync(`/proc/${pid}/fd`)) {
      let target: string;
      try {
        target = readlinkSync(`/proc/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      const match = /^socket:\[(\d+)\]$/.exec(target);
      if (!match) continue;
      for (const port of inodes.get(match[1]!) ?? []) ports.add(port);
    }
  } catch {
    // A disappearing process or a protected fd directory is not a reason to
    // signal anything. The candidate is simply omitted unless its nonce is
    // independently visible.
  }
  return [...ports].sort((left, right) => left - right);
}

function repositoryProcessCandidate(
  repoRoot: string,
  pid: number,
  listeningInodes: Map<string, number[]>,
): DiscoveredProcessState | undefined {
  if (pid <= 1 || pid === process.pid) return undefined;
  const identity = inspectProcessIdentity(pid);
  if (!identity) return undefined;
  let cwd: string;
  let executable: string;
  let commandLine: string[] = [];
  try {
    cwd = realpathSync(`/proc/${pid}/cwd`);
    executable = realpathSync(`/proc/${pid}/exe`);
    commandLine = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\u0000").filter(Boolean);
  } catch {
    return undefined;
  }
  const commandPathCandidate = commandLine.some((argument) => isAbsolute(argument) && pathIsInside(repoRoot, argument));
  if (!pathIsInside(repoRoot, cwd) && !pathIsInside(repoRoot, executable) && !commandPathCandidate) return undefined;
  const listeningPorts = listeningPortsForPid(pid, listeningInodes);
  const runNonce = identity.runNonce ?? readProcNonce(pid);
  if (listeningPorts.length === 0 && !runNonce) return undefined;
  return {
    pid,
    pidStartTime: identity.pidStartTime,
    pgid: identity.pgid,
    groupIdentity: identity.groupIdentity,
    cwd,
    executable,
    ...(runNonce ? { runNonce } : {}),
    listeningPorts,
    reason: "manifestless-candidate",
  };
}

/**
 * Discover only; this function never sends signals or mutates process state.
 * A candidate is a repository-cwd/executable process with a dynamic listener
 * or a run nonce. Manifest ownership is intentionally resolved by the caller.
 */
export function discoverRepositoryProcesses(repoRoot: string): DiscoveredProcessState[] {
  if (process.platform === "win32") return [];
  const listeningInodes = readListeningInodes();
  const discovered: DiscoveredProcessState[] = [];
  try {
    for (const entry of readdirSync("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const candidate = repositoryProcessCandidate(repoRoot, Number(entry.name), listeningInodes);
      if (candidate) discovered.push(candidate);
    }
  } catch {
    return discovered;
  }
  return discovered;
}

export const discoverManifestlessProcesses = discoverRepositoryProcesses;

export async function auditSuiteContainment(options: ContainmentAuditOptions = {}): Promise<ContainmentAuditReport> {
  const repoRoot = getCanonicalRepoRoot(process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT ?? process.cwd());
  const loadedManifest = loadManifest(repoRoot, options.manifestPath);
  const telemetryPaths = telemetryCandidates(repoRoot, loadedManifest.manifest, options);
  const telemetry: TestRunTelemetry[] = [];
  const telemetryErrors: string[] = [];
  const legacyEvidence = legacyEvidenceDirectories(repoRoot);
  const artifactClassifications = artifactEvidenceClassifications(repoRoot);
  const artifactResiduals = artifactClassifications
    .filter(({ disposition }) => disposition === "failure")
    .map(({ path }) => path);
  for (const path of telemetryPaths) {
    if (isLegacyEvidencePath(path, repoRoot)) continue;
    try {
      telemetry.push(readTestRunTelemetry(path, repoRoot));
    } catch (error) {
      telemetryErrors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const managedPorts = new Set<number>();
  if (loadedManifest.manifest) {
    for (const port of Object.values(loadedManifest.manifest.ports)) managedPorts.add(port);
  }
  for (const entry of telemetry) {
    for (const port of Object.values(entry.ports)) managedPorts.add(port);
  }
  const managedRecords = collectManagedRecords(loadedManifest.manifest, telemetry);
  const managedProcesses = managedRecords.map(({ record, runNonce }) => inspectManagedProcess(record, runNonce));
  const managedIdentityKeys = new Set(managedRecords.map(({ record, runNonce }) =>
    `${runNonce}:${record.pid}:${record.pidStartTime}:${record.groupIdentity}`));
  const managedProvisionalSpawns = new Set(
    managedRecords
      .filter(({ record }) => record.identityState === "provisional")
      .map(({ record, runNonce }) => `${runNonce}:${record.pid}`),
  );
  const discoveredProcesses = discoverRepositoryProcesses(repoRoot).filter((candidate) =>
    !managedIdentityKeys.has(`${candidate.runNonce ?? ""}:${candidate.pid}:${candidate.pidStartTime}:${candidate.groupIdentity}`)
    && !managedProvisionalSpawns.has(`${candidate.runNonce ?? ""}:${candidate.pid}`));
  const holds = discoveredProcesses.map((candidate) =>
    `manifestless candidate ${candidate.pid} listening on ${candidate.listeningPorts.join(",") || "no recorded port"}`);
  const discoveredPorts = discoveredProcesses.flatMap((candidate) => candidate.listeningPorts);
  const ports = await auditPorts([...new Set([...parsePorts(), ...managedPorts, ...discoveredPorts])], managedPorts);
  const resolvedManifestPaths = new Set(
    telemetry
      .filter((entry) => entry.resolution?.status === "resolved")
      .map((entry) => resolve(entry.manifestPath)),
  );
  const rssLimit = Number(process.env.INGENIUM_AUDIT_RSS_LIMIT ?? DEFAULT_RSS_LIMIT);
  const selectedManifestPath = options.manifestPath ?? process.env[TEST_RUN_MANIFEST_ENV];
  return {
    repoRoot,
    ...(selectedManifestPath ? { manifestPath: selectedManifestPath } : {}),
    ...(loadedManifest.manifest ? { manifestStatus: loadedManifest.manifest.status } : {}),
    ports,
    managedPorts: [...managedPorts],
    expectedPorts: [...parseExpectedPorts()],
    tempEntries: auditTemp(resolvedManifestPaths),
    managedProcesses,
    discoveredProcesses,
    holds,
    telemetryErrors,
    legacyEvidence,
    informational: legacyEvidence.map((path) => `legacy evidence retained (non-runnable): ${path}`),
    artifactClassifications,
    artifactResiduals,
    repositoryArtifactScan: options.includeRepositoryTelemetry === true,
    telemetry: telemetry.map((entry) => {
      const manifestCheck = checkTelemetryManifest(entry, repoRoot);
      return {
        manifestState: manifestCheck.state,
        ...(manifestCheck.error ? { manifestError: manifestCheck.error } : {}),
        path: getTestRunTelemetryPath(entry),
        manifestPath: entry.manifestPath,
        runId: entry.runId,
        status: entry.status,
        updatedAt: entry.updatedAt,
        failures: entry.failures,
        ...(entry.resolution ? { resolution: entry.resolution } : {}),
        activeProcessCount: entry.activeProcesses.length,
      };
    }),
    process: auditProcesses(),
    rssLimitBytes: rssLimit,
  };
}

export function strictFailures(report: ContainmentAuditReport, manifestError?: string): string[] {
  const failures: string[] = [];
  const configuredManifestPath = report.manifestPath
    && isAbsolute(report.manifestPath)
    && resolve(report.manifestPath) === report.manifestPath
    ? report.manifestPath
    : undefined;
  const missingManifestWithResolvedTelemetry = manifestError?.startsWith("manifest is missing:")
    && configuredManifestPath !== undefined
    && report.telemetry.some((entry) => entry.manifestPath === configuredManifestPath
      && entry.status === "complete"
      && entry.activeProcessCount === 0
      && entry.resolution?.status === "resolved");
  if (manifestError && !missingManifestWithResolvedTelemetry) failures.push(`manifest: ${manifestError}`);
  if (report.telemetryErrors.length > 0) failures.push(`telemetry: ${report.telemetryErrors.join("; ")}`);
  const expectedPorts = new Set(report.expectedPorts);
  const openPorts = report.ports
    .filter((state) => state.listening && (state.owned || !expectedPorts.has(state.port)))
    .map((state) => state.port);
  if (openPorts.length > 0) failures.push(`listening ports: ${openPorts.join(", ")}`);
  if (report.tempEntries.length > 0) failures.push(`temp entries: ${report.tempEntries.join(", ")}`);
  const badProcesses = report.managedProcesses.filter((process) => process.state !== "exited");
  if (badProcesses.length > 0) {
    failures.push(`managed processes: ${badProcesses.map((process) => `${process.name}:${process.pid}:${process.state}`).join(", ")}`);
  }
  if (report.holds.length > 0) failures.push(`containment holds: ${report.holds.join("; ")}`);
  if (report.manifestStatus === "stopping") failures.push("manifest remains in stopping recovery state");
  for (const telemetry of report.telemetry) {
    const terminallyResolved = telemetry.status === "complete"
      && telemetry.activeProcessCount === 0
      && telemetry.resolution?.status === "resolved";
    const hasMatchingManifest = telemetry.manifestState === "valid";
    if (!terminallyResolved) {
      failures.push(
        `runner telemetry requires recovery (not terminally resolved): ${telemetry.path}`
          + ` (status=${telemetry.status}, activeProcesses=${telemetry.activeProcessCount}`
          + `, resolution=${telemetry.resolution?.status ?? "missing"})`,
      );
    }
    if (!hasMatchingManifest && !terminallyResolved) {
      failures.push(
        `runner telemetry has no matching valid manifest: ${telemetry.path}`
          + (telemetry.manifestError ? ` (${telemetry.manifestError})` : ""),
      );
    }
  }
  if (report.repositoryArtifactScan && report.artifactResiduals.length > 0) {
    failures.push(`artifact hygiene residuals (retained, not deleted): ${report.artifactResiduals.join(", ")}`);
  }
  if (report.process.rssBytes > report.rssLimitBytes) {
    failures.push(`RSS ${report.process.rssBytes} above limit ${report.rssLimitBytes}`);
  }
  return failures;
}

async function main(): Promise<void> {
  let report: ContainmentAuditReport;
  let manifestError: string | undefined;
  try {
    const repoRoot = getCanonicalRepoRoot(process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT ?? process.cwd());
    const loaded = loadManifest(repoRoot);
    manifestError = loaded.error;
    report = await auditSuiteContainment({ includeRepositoryTelemetry: true });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (process.argv.includes("--strict")) {
    const failures = strictFailures(report, manifestError);
    if (failures.length > 0) throw new Error(`Strict audit failed: ${failures.join("; ")}`);
  }
}

if (basename(process.argv[1] ?? "") === "suite-containment-audit.ts"
  || basename(process.argv[1] ?? "") === "suite-containment-audit.js") {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

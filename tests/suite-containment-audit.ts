import { connect } from "node:net";
import {
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  TEST_RUN_MANIFEST_ENV,
  TEST_RUN_TELEMETRY_ENV,
  getCanonicalRepoRoot,
  getContainmentAuditTempRoots,
  getTestRunArtifactRoot,
  getTestRunTelemetryPath,
  readTestRunManifestForContainmentAudit,
  readTestRunTelemetryForContainmentAudit,
  type TestRunManifest,
  type TestRunProcess,
  type TestRunPreexistingProcessBaseline,
  type TestRunTelemetry,
} from "./test-run-context";
import {
  discoverRepositoryProcessCandidates,
  inspectProcessIdentity,
  type ProcessIdentity,
  type RepositoryProcessCandidate,
} from "./test-run-process-discovery";
import {
  COMPOSE_OWNED_HOST_PORTS,
  inspectComposeOwnership,
  type ComposeOwnershipReport,
} from "./compose-ownership";

const DEFAULT_PORTS = [3000, 4097, 1455, 4098, 4099, 4999];
const DEFAULT_TEMP_PREFIX = "ingenium-playwright-";
const DEFAULT_RSS_LIMIT = 512 * 1024 * 1024;
// A missing manifest can only be treated as retained historical evidence after
// a full stale-run interval. Fresh evidence remains a strict recovery failure.
const HISTORICAL_INERT_EVIDENCE_AFTER_MS = 60 * 60 * 1_000;

export type PortOwnership = "fixture-owned" | "compose-owned" | "pre-existing-unowned" | "unverified" | "unowned";

export interface PortState {
  port: number;
  listening: boolean;
  /** Legacy manifest association; not sufficient to authorize an open port. */
  owned: boolean;
  ownership: PortOwnership;
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

export interface PreexistingUnownedProcessState extends Omit<DiscoveredProcessState, "reason"> {
  reason: "pre-existing-unowned";
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

export type TelemetryEvidenceDisposition = "current" | "historical-inert";

export interface TelemetryAuditEntry {
  path: string;
  manifestPath: string;
  runId: string;
  status: TestRunTelemetry["status"];
  updatedAt: string;
  failures: string[];
  resolution?: TestRunTelemetry["resolution"];
  activeProcessCount: number;
  manifestState: TelemetryManifestState;
  manifestError?: string;
  /** Current evidence fails strictly; authenticated inert history is retained. */
  evidenceDisposition: TelemetryEvidenceDisposition;
}

export interface ContainmentAuditReport {
  repoRoot: string;
  manifestPath?: string;
  manifestStatus?: TestRunManifest["status"];
  ports: PortState[];
  composeOwnership: ComposeOwnershipReport;
  managedPorts: number[];
  expectedPorts: number[];
  /** Manifest-backed temporary runs requiring recovery. */
  tempEntries: string[];
  /** Manifestless temp evidence is retained and reported, never deleted. */
  unownedTempEntries: string[];
  managedProcesses: ManagedProcessState[];
  discoveredProcesses: DiscoveredProcessState[];
  preexistingUnownedProcesses: PreexistingUnownedProcessState[];
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
  telemetry: TelemetryAuditEntry[];
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
  /** Test seam for Docker-free ownership classification tests. */
  composeOwnership?: ComposeOwnershipReport;
  /** Test seam for port classification without opening real listeners. */
  portProbe?: (port: number) => Promise<boolean>;
}

interface TelemetryManifestCheck {
  state: TelemetryManifestState;
  error?: string;
}

function preexistingProcessBaselinesMatch(
  left: TestRunPreexistingProcessBaseline | undefined,
  right: TestRunPreexistingProcessBaseline | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function checkTelemetryManifest(entry: TestRunTelemetry, repoRoot: string): TelemetryManifestCheck {
  if (!existsSync(entry.manifestPath)) return { state: "missing", error: "manifest is missing" };
  try {
    const manifest = readTestRunManifestForContainmentAudit(entry.manifestPath);
    const identityMatches = manifest.runId === entry.runId
      && manifest.runNonce === entry.runNonce
      && manifest.repoRoot === repoRoot
      && resolve(manifest.manifestPath) === resolve(entry.manifestPath)
      && manifest.ports.api === entry.ports.api
      && manifest.ports.dashboard === entry.ports.dashboard
      && manifest.ports.fixture === entry.ports.fixture
      && preexistingProcessBaselinesMatch(manifest.preexistingProcessBaseline, entry.preexistingProcessBaseline);
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

export function classifyPortOwnership(input: {
  port: number;
  listening: boolean;
  managedPorts: ReadonlySet<number>;
  fixtureOwnedPorts: ReadonlySet<number>;
  preexistingUnownedPorts: ReadonlySet<number>;
  composeOwnership: ComposeOwnershipReport;
}): PortOwnership {
  if (!input.listening) return "unowned";
  if (input.fixtureOwnedPorts.has(input.port)) return "fixture-owned";
  if (input.preexistingUnownedPorts.has(input.port)) return "pre-existing-unowned";
  if (input.composeOwnership.classification === "compose-owned"
    && input.composeOwnership.hostPorts.includes(input.port)) {
    return "compose-owned";
  }
  if (input.managedPorts.has(input.port) || (COMPOSE_OWNED_HOST_PORTS as readonly number[]).includes(input.port)) {
    return "unverified";
  }
  return "unowned";
}

async function auditPorts(
  ports: number[],
  managedPorts: Set<number>,
  fixtureOwnedPorts: Set<number>,
  preexistingUnownedPorts: Set<number>,
  composeOwnership: ComposeOwnershipReport,
  portProbe: (port: number) => Promise<boolean> = isListening,
): Promise<PortState[]> {
  return Promise.all(ports.map(async (port) => {
    const listening = await portProbe(port);
    return {
      port,
      listening,
      owned: managedPorts.has(port),
      ownership: classifyPortOwnership({
        port,
        listening,
        managedPorts,
        fixtureOwnedPorts,
        preexistingUnownedPorts,
        composeOwnership,
      }),
    };
  }));
}

function auditTemp(resolvedManifestPaths: Set<string> = new Set()): {
  manifestBacked: string[];
  manifestless: string[];
} {
  const prefix = process.env.INGENIUM_AUDIT_TEMP_PREFIX ?? DEFAULT_TEMP_PREFIX;
  const manifestBacked: string[] = [];
  const manifestless: string[] = [];
  for (const root of getContainmentAuditTempRoots()) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
      const path = join(root, entry.name);
      const manifestPath = join(path, "run-manifest.json");
      if (resolvedManifestPaths.has(manifestPath)) continue;
      if (optionalLstat(manifestPath)) manifestBacked.push(path);
      else manifestless.push(path);
    }
  }
  return { manifestBacked: [...new Set(manifestBacked)], manifestless: [...new Set(manifestless)] };
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

export interface OwnedArtifactInventoryEntry {
  relativePath: string;
  type: "directory" | "file";
}

export interface OwnedMisplacedTestResults {
  path: string;
  inventory: OwnedArtifactInventoryEntry[];
}

function optionalLstat(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function assertCanonicalDirectory(path: string, containmentRoot: string, name: string): void {
  const metadata = optionalLstat(path);
  if (!metadata) throw new Error(`${name} does not exist: ${path}`);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()
    || realpathSync(path) !== path || !pathIsInside(containmentRoot, path)) {
    throw new Error(`${name} is not a canonical owned directory: ${path}`);
  }
}

function inventoryOwnedDirectory(root: string, current = root): OwnedArtifactInventoryEntry[] {
  const entries: OwnedArtifactInventoryEntry[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(current, entry.name);
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Refusing to remove misplaced test results with a symlink: ${path}`);
    }
    const relativePath = relative(root, path);
    if (!pathIsInside(root, path)) {
      throw new Error(`Refusing to inventory an escaped misplaced test-results path: ${path}`);
    }
    if (metadata.isDirectory()) {
      entries.push({ relativePath, type: "directory" });
      entries.push(...inventoryOwnedDirectory(root, path));
    } else if (metadata.isFile()) {
      entries.push({ relativePath, type: "file" });
    } else {
      throw new Error(`Refusing to remove misplaced test results with a non-file entry: ${path}`);
    }
  }
  return entries;
}

/**
 * Inspect only the known bad Playwright residual. It is never discovered by a
 * glob: the lexical path, canonical parents, and every inventory entry must
 * be proven before removal is possible.
 */
export function inspectOwnedMisplacedTestResults(repoRootCandidate: string): OwnedMisplacedTestResults | undefined {
  const repoRoot = getCanonicalRepoRoot(repoRootCandidate);
  const testsRoot = join(repoRoot, "tests");
  const nestedTestsRoot = join(testsRoot, "tests");
  const misplacedRoot = join(nestedTestsRoot, "test-results");
  const candidate = optionalLstat(misplacedRoot);
  if (!candidate) return undefined;

  assertCanonicalDirectory(testsRoot, repoRoot, "tests root");
  assertCanonicalDirectory(nestedTestsRoot, testsRoot, "nested tests root");
  assertCanonicalDirectory(misplacedRoot, nestedTestsRoot, "misplaced test-results root");
  const nestedEntries = readdirSync(nestedTestsRoot).sort();
  if (nestedEntries.length !== 1 || nestedEntries[0] !== "test-results") {
    throw new Error("Refusing to remove misplaced test results alongside unowned nested-test entries");
  }

  return { path: misplacedRoot, inventory: inventoryOwnedDirectory(misplacedRoot) };
}

/**
 * Delete only the exact known residual after a stable canonical-path and
 * symlink-free inventory proof. Any changed path or inventory fails closed;
 * no other evidence root is considered or deleted.
 */
export function removeOwnedMisplacedTestResults(repoRootCandidate: string): OwnedMisplacedTestResults | undefined {
  const first = inspectOwnedMisplacedTestResults(repoRootCandidate);
  if (!first) return undefined;
  const before = lstatSync(first.path);
  const second = inspectOwnedMisplacedTestResults(repoRootCandidate);
  if (!second
    || before.dev !== lstatSync(second.path).dev
    || before.ino !== lstatSync(second.path).ino
    || JSON.stringify(first.inventory) !== JSON.stringify(second.inventory)) {
    throw new Error("Refusing to remove misplaced test results because ownership evidence changed during reinspection");
  }
  rmSync(second.path, { recursive: true, force: false, maxRetries: 2 });
  if (optionalLstat(second.path)) {
    throw new Error(`Owned misplaced test-results residual was not removed: ${second.path}`);
  }
  return second;
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

function scopedTelemetryPaths(
  manifest: TestRunManifest | undefined,
  options: ContainmentAuditOptions,
): Set<string> {
  const configured = options.telemetryPaths ?? (
    process.env[TEST_RUN_TELEMETRY_ENV] !== undefined
      ? [process.env[TEST_RUN_TELEMETRY_ENV] as string]
      : []
  );
  const paths = new Set(configured.map((path) => resolve(path)));
  if (manifest) paths.add(getTestRunTelemetryPath(manifest));
  return paths;
}

function loadManifest(repoRoot: string, configuredManifestPath = process.env[TEST_RUN_MANIFEST_ENV]): { manifest?: TestRunManifest; error?: string } {
  const manifestPath = configuredManifestPath;
  if (!manifestPath) return {};
  if (!existsSync(manifestPath)) return { error: `manifest is missing: ${manifestPath}` };
  try {
    const manifest = readTestRunManifestForContainmentAudit(manifestPath);
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

function discoveredProcessState(candidate: RepositoryProcessCandidate): DiscoveredProcessState {
  return {
    pid: candidate.pid,
    pidStartTime: candidate.pidStartTime,
    pgid: candidate.pgid,
    groupIdentity: candidate.groupIdentity,
    cwd: candidate.cwd,
    executable: candidate.executable,
    ...(candidate.runNonce ? { runNonce: candidate.runNonce } : {}),
    listeningPorts: candidate.listeningPorts,
    reason: "manifestless-candidate",
  };
}

/**
 * Discover only; this function never sends signals or mutates process state.
 * A candidate is a repository-cwd/executable process with a dynamic listener
 * or a run nonce. Manifest ownership is intentionally resolved by the caller.
 */
export function discoverRepositoryProcesses(repoRoot: string): DiscoveredProcessState[] {
  return discoverRepositoryProcessCandidates(repoRoot).map(discoveredProcessState);
}

export const discoverManifestlessProcesses = discoverRepositoryProcesses;

function isHistoricalInertTelemetry(
  entry: TestRunTelemetry,
  telemetryPath: string,
  manifestCheck: TelemetryManifestCheck,
  ports: PortState[],
  scopedTelemetry: Set<string>,
  selectedManifestPath: string | undefined,
  repositoryArtifactScan: boolean,
): boolean {
  if (!repositoryArtifactScan || scopedTelemetry.has(telemetryPath) || manifestCheck.state !== "missing") return false;
  if (selectedManifestPath !== undefined && resolve(entry.manifestPath) === resolve(selectedManifestPath)) return false;
  if (Date.now() - Date.parse(entry.updatedAt) < HISTORICAL_INERT_EVIDENCE_AFTER_MS) return false;
  if (entry.activeProcesses.some((record) => inspectManagedProcess(record, entry.runNonce).state !== "exited")) return false;
  return Object.values(entry.ports).every((port) => !ports.some((state) => state.port === port && state.listening));
}

function isTerminallyResolved(entry: TestRunTelemetry): boolean {
  return entry.status === "complete"
    && entry.activeProcesses.length === 0
    && entry.resolution?.status === "resolved";
}

function baselineMatchesCandidate(
  baseline: TestRunPreexistingProcessBaseline,
  candidate: RepositoryProcessCandidate,
  managedPorts: ReadonlySet<number>,
): boolean {
  if (candidate.runNonce !== undefined || candidate.listeningPorts.some((port) => managedPorts.has(port))) {
    return false;
  }
  return baseline.candidates.some((record) => record.pid === candidate.pid
    && record.pidStartTime === candidate.pidStartTime
    && record.pgid === candidate.pgid
    && record.groupIdentity === candidate.groupIdentity
    && record.executableHash === candidate.executableHash
    && record.commandHash === candidate.commandHash
    && JSON.stringify(record.listeningPorts) === JSON.stringify(candidate.listeningPorts));
}

function preexistingUnownedProcessState(candidate: RepositoryProcessCandidate): PreexistingUnownedProcessState {
  return { ...discoveredProcessState(candidate), reason: "pre-existing-unowned" };
}

export async function auditSuiteContainment(options: ContainmentAuditOptions = {}): Promise<ContainmentAuditReport> {
  const repoRoot = getCanonicalRepoRoot(process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT ?? process.cwd());
  const loadedManifest = loadManifest(repoRoot, options.manifestPath);
  const telemetryPaths = telemetryCandidates(repoRoot, loadedManifest.manifest, options);
  const scopedTelemetry = scopedTelemetryPaths(loadedManifest.manifest, options);
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
      telemetry.push(readTestRunTelemetryForContainmentAudit(path, repoRoot));
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
  const telemetryManifestChecks = new Map(
    telemetry.map((entry) => [entry, checkTelemetryManifest(entry, repoRoot)]),
  );
  const newestTelemetry = telemetry.reduce<TestRunTelemetry | undefined>((latest, entry) => {
    if (!latest) return entry;
    const latestTime = Date.parse(latest.updatedAt);
    const entryTime = Date.parse(entry.updatedAt);
    if (entryTime > latestTime) return entry;
    if (entryTime < latestTime) return latest;
    return getTestRunTelemetryPath(entry).localeCompare(getTestRunTelemetryPath(latest)) > 0 ? entry : latest;
  }, undefined);
  const newestManifestCheck = newestTelemetry === undefined
    ? undefined
    : telemetryManifestChecks.get(newestTelemetry);
  const trustedPreexistingBaselines = newestTelemetry?.preexistingProcessBaseline !== undefined
    && newestManifestCheck?.state === "missing"
    && isTerminallyResolved(newestTelemetry)
    ? [newestTelemetry.preexistingProcessBaseline]
    : [];
  const managedRecords = collectManagedRecords(loadedManifest.manifest, telemetry);
  const managedProcesses = managedRecords.map(({ record, runNonce }) => inspectManagedProcess(record, runNonce));
  const fixtureOwnedPorts = new Set(
    managedProcesses
      .filter((process) => process.state === "running")
      .map((process) => process.port),
  );
  const managedIdentityKeys = new Set(managedRecords.map(({ record, runNonce }) =>
    `${runNonce}:${record.pid}:${record.pidStartTime}:${record.groupIdentity}`));
  const managedProvisionalSpawns = new Set(
    managedRecords
      .filter(({ record }) => record.identityState === "provisional")
      .map(({ record, runNonce }) => `${runNonce}:${record.pid}`),
  );
  const unmanagedCandidates = discoverRepositoryProcessCandidates(repoRoot).filter((candidate) =>
    !managedIdentityKeys.has(`${candidate.runNonce ?? ""}:${candidate.pid}:${candidate.pidStartTime}:${candidate.groupIdentity}`)
    && !managedProvisionalSpawns.has(`${candidate.runNonce ?? ""}:${candidate.pid}`));
  const preexistingUnownedCandidates = unmanagedCandidates.filter((candidate) =>
    trustedPreexistingBaselines.some((baseline) => baselineMatchesCandidate(baseline, candidate, managedPorts)));
  const preexistingUnownedPids = new Set(preexistingUnownedCandidates.map((candidate) => candidate.pid));
  const discoveredProcesses = unmanagedCandidates
    .filter((candidate) => !preexistingUnownedPids.has(candidate.pid))
    .map(discoveredProcessState);
  const preexistingUnownedProcesses = preexistingUnownedCandidates.map(preexistingUnownedProcessState);
  const holds = discoveredProcesses.map((candidate) =>
    `manifestless candidate ${candidate.pid} listening on ${candidate.listeningPorts.join(",") || "no recorded port"}`);
  const discoveredPorts = unmanagedCandidates.flatMap((candidate) => candidate.listeningPorts);
  const preexistingUnownedPorts = new Set(preexistingUnownedCandidates.flatMap((candidate) => candidate.listeningPorts));
  const expectedOciRevision = process.env.INGENIUM_AUDIT_OCI_REVISION?.trim() || undefined;
  const composeOwnership = options.composeOwnership ?? inspectComposeOwnership({
    repoRoot,
    ...(expectedOciRevision ? { expectedOciRevision } : {}),
  });
  const ports = await auditPorts(
    [...new Set([...parsePorts(), ...managedPorts, ...discoveredPorts, ...composeOwnership.hostPorts])],
    managedPorts,
    fixtureOwnedPorts,
    preexistingUnownedPorts,
    composeOwnership,
    options.portProbe,
  );
  const resolvedManifestPaths = new Set(
    telemetry
      .filter((entry) => entry.resolution?.status === "resolved")
      .map((entry) => resolve(entry.manifestPath)),
  );
  const tempAudit = auditTemp(resolvedManifestPaths);
  const rssLimit = Number(process.env.INGENIUM_AUDIT_RSS_LIMIT ?? DEFAULT_RSS_LIMIT);
  const selectedManifestPath = options.manifestPath ?? process.env[TEST_RUN_MANIFEST_ENV];
  const telemetryReport = telemetry.map((entry) => {
    const manifestCheck = telemetryManifestChecks.get(entry)!;
    const path = getTestRunTelemetryPath(entry);
    const evidenceDisposition: TelemetryEvidenceDisposition = isHistoricalInertTelemetry(
      entry,
      path,
      manifestCheck,
      ports,
      scopedTelemetry,
      selectedManifestPath,
      options.includeRepositoryTelemetry === true,
    ) ? "historical-inert" : "current";
    return {
      manifestState: manifestCheck.state,
      ...(manifestCheck.error ? { manifestError: manifestCheck.error } : {}),
      path,
      manifestPath: entry.manifestPath,
      runId: entry.runId,
      status: entry.status,
      updatedAt: entry.updatedAt,
      failures: entry.failures,
      ...(entry.resolution ? { resolution: entry.resolution } : {}),
      activeProcessCount: entry.activeProcesses.length,
      evidenceDisposition,
    };
  });
  const inertHistoricalEvidence = telemetryReport
    .filter((entry) => entry.evidenceDisposition === "historical-inert")
    .map((entry) => `validated inert historical telemetry retained (non-runnable): ${entry.path}`);
  return {
    repoRoot,
    ...(selectedManifestPath ? { manifestPath: selectedManifestPath } : {}),
    ...(loadedManifest.manifest ? { manifestStatus: loadedManifest.manifest.status } : {}),
    ports,
    composeOwnership,
    managedPorts: [...managedPorts],
    expectedPorts: [...parseExpectedPorts()],
    tempEntries: tempAudit.manifestBacked,
    unownedTempEntries: tempAudit.manifestless,
    managedProcesses,
    discoveredProcesses,
    preexistingUnownedProcesses,
    holds,
    telemetryErrors,
    legacyEvidence,
    informational: [
      ...legacyEvidence.map((path) => `legacy evidence retained (non-runnable): ${path}`),
      ...inertHistoricalEvidence,
      ...preexistingUnownedProcesses.map((candidate) =>
        `pre-existing unowned candidate retained: ${candidate.pid} listening on ${candidate.listeningPorts.join(",")}`),
      ...tempAudit.manifestless.map((path) => `manifestless temp evidence retained (unowned, not deleted): ${path}`),
    ],
    artifactClassifications,
    artifactResiduals,
    repositoryArtifactScan: options.includeRepositoryTelemetry === true,
    telemetry: telemetryReport,
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
  const openPorts = report.ports
    // A raw expected-port setting is not ownership proof. A listener is
    // accepted only after fixture/Compose ownership or a stable baseline
    // identity has bound the exact process and its current listener set.
    .filter((state) => state.listening
      && state.ownership !== "fixture-owned"
      && state.ownership !== "compose-owned"
      && state.ownership !== "pre-existing-unowned")
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
    if (telemetry.evidenceDisposition === "historical-inert") continue;
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
    if (process.argv.includes("--remove-owned-misplaced-test-results")) {
      const removed = removeOwnedMisplacedTestResults(repoRoot);
      process.stdout.write(removed
        ? `Removed exact owned misplaced test-results residual after inventory proof: ${removed.path} (${removed.inventory.length} entries)\n`
        : "No misplaced test-results residual was present\n");
    }
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

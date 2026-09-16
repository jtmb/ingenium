import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  type Stats,
  constants as fsConstants,
} from "node:fs";
import { connect } from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  TEST_RUN_MANIFEST_ENV,
  TEST_RUN_TELEMETRY_ENV,
  getCanonicalRepoRoot,
  getTestRunArtifactRoot,
  parseTestRunTelemetryPayload,
  readTestRunTelemetryForContainmentAudit,
  type TestRunProcess,
  type TestRunTelemetry,
} from "./test-run-context";
import { discoverRepositoryProcessCandidates, inspectProcessIdentity, readProcStat } from "./test-run-process-discovery";
import {
  TEST_RUN_RETENTION_PLAN_DIRECTORY,
  TEST_RUN_RETENTION_LOCK_DIRECTORY,
  TEST_RUN_RETENTION_LOCK_FILENAME,
  TEST_RUN_RETENTION_LOCK_TTL_MS,
  TEST_RUN_RETENTION_LOCK_VERSION,
  TEST_RUN_RETENTION_QUARANTINE_DIRECTORY,
  TEST_RUN_RETENTION_RECEIPT_DIRECTORY,
  TEST_RUN_RETENTION_REPORT_DIRECTORY,
  ensureTestRunRetentionSubdirectory,
  getTestRunRetentionControlRoot,
  getTestRunRetentionLockPath,
  inspectTestRunArtifactLock,
  releaseTestRunArtifactLock,
  stealDeadTestRunArtifactLock,
  type TestRunArtifactLockToken,
  type TestRunRetentionLockOwner,
} from "./test-run-retention-lock";

export const ARTIFACT_RETENTION_POLICY_ID = "telemetry-100-v1";
export const ARTIFACT_RETENTION_MINIMUM_AGE_DAYS = 30;
export const ARTIFACT_RETENTION_PLAN_TTL_MS = 15 * 60 * 1_000;
export const ARTIFACT_RETENTION_TELEMETRY_FILENAME = "runner-telemetry.json";
const ARTIFACT_RETENTION_PLAN_VERSION = 1;
const ARTIFACT_RETENTION_RECEIPT_VERSION = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ArtifactRetentionReasonCode =
  | "ACTIVE_PROCESS"
  | "AUXILIARY_EVIDENCE"
  | "CANDIDATE_CHANGED"
  | "CANDIDATE_MISSING"
  | "CROSS_DEVICE"
  | "CURRENT_RUN"
  | "FAILURE_EVIDENCE"
  | "INVENTORY_UNSAFE"
  | "LINK_UNSAFE"
  | "LOCK_ACTIVE"
  | "LOCK_DEAD"
  | "LOCK_EXPIRED"
  | "LOCK_MALFORMED"
  | "MANIFEST_PRESENT"
  | "MODE_UNSAFE"
  | "NON_CANONICAL_ROOT"
  | "OWNER_UNSAFE"
  | "PATH_UNSAFE"
  | "PORT_OPEN"
  | "PROCESS_UNKNOWN"
  | "QUARANTINE_CHANGED"
  | "RESOLUTION_UNRESOLVED"
  | "STATUS_INCOMPLETE"
  | "TELEMETRY_MALFORMED"
  | "TOO_RECENT";

const RETENTION_REASON_CODES = new Set<ArtifactRetentionReasonCode>([
  "ACTIVE_PROCESS", "AUXILIARY_EVIDENCE", "CANDIDATE_CHANGED", "CANDIDATE_MISSING",
  "CROSS_DEVICE", "CURRENT_RUN", "FAILURE_EVIDENCE", "INVENTORY_UNSAFE", "LINK_UNSAFE",
  "LOCK_ACTIVE", "LOCK_DEAD", "LOCK_EXPIRED", "LOCK_MALFORMED", "MANIFEST_PRESENT",
  "MODE_UNSAFE", "NON_CANONICAL_ROOT", "OWNER_UNSAFE", "PATH_UNSAFE", "PORT_OPEN",
  "PROCESS_UNKNOWN", "QUARANTINE_CHANGED", "RESOLUTION_UNRESOLVED", "STATUS_INCOMPLETE",
  "TELEMETRY_MALFORMED", "TOO_RECENT",
]);

export interface ArtifactRetentionInventoryEntry {
  name: typeof ARTIFACT_RETENTION_TELEMETRY_FILENAME;
  type: "file";
  device: number;
  inode: number;
  mode: number;
  uid: number;
  links: number;
  bytes: number;
  sha256: string;
}

export interface ArtifactRetentionCandidateEvidence {
  runId: string;
  relativePath: string;
  directory: {
    device: number;
    inode: number;
    mode: number;
    uid: number;
    inventoryCount: 1;
  };
  inventory: [ArtifactRetentionInventoryEntry];
  telemetrySha256: string;
  estimatedBytes: number;
}

export interface ArtifactRetentionPlan {
  version: typeof ARTIFACT_RETENTION_PLAN_VERSION;
  planId: string;
  policy: {
    id: typeof ARTIFACT_RETENTION_POLICY_ID;
    minimumAgeDays: typeof ARTIFACT_RETENTION_MINIMUM_AGE_DAYS;
    telemetryFile: typeof ARTIFACT_RETENTION_TELEMETRY_FILENAME;
  };
  repository: { root: string; device: number; inode: number };
  generatedAt: string;
  cutoff: string;
  expiresAt: string;
  eligible: ArtifactRetentionCandidateEvidence[];
  excludedRuns: Array<{ runId: string; codes: ArtifactRetentionReasonCode[] }>;
  reasonCounts: Partial<Record<ArtifactRetentionReasonCode, number>>;
  digest: string;
}

export interface ArtifactRetentionReport {
  version: 1;
  planId: string;
  planDigest: string;
  generatedAt: string;
  expiresAt: string;
  eligibleRunIds: string[];
  reasonCounts: ArtifactRetentionPlan["reasonCounts"];
}

export interface ArtifactRetentionReceipt {
  version: typeof ARTIFACT_RETENTION_RECEIPT_VERSION;
  planId: string;
  planDigest: string;
  policyId: typeof ARTIFACT_RETENTION_POLICY_ID;
  repository: ArtifactRetentionPlan["repository"];
  executedAt: string;
  deleted: Array<{
    runId: string;
    relativePath: string;
    directoryDevice: number;
    directoryInode: number;
    telemetrySha256: string;
  }>;
  skipped: Array<{ runId: string; codes: ArtifactRetentionReasonCode[] }>;
  recoverable: Array<{
    runId: string;
    codes: ArtifactRetentionReasonCode[];
    quarantineRelativePath: string;
    directoryDevice: number;
    directoryInode: number;
    telemetrySha256: string;
  }>;
  digest: string;
}

export interface ArtifactRetentionVerification {
  verified: boolean;
  deletedPathsGone: string[];
  recoverableQuarantines: string[];
  quarantineClean: boolean;
}

export interface ArtifactRetentionOptions {
  repoRoot?: string;
  now?: Date;
  selectedRunIds?: Iterable<string>;
  portProbe?: (port: number) => Promise<boolean>;
}

interface CandidateClassification {
  runId: string;
  codes: ArtifactRetentionReasonCode[];
  evidence?: ArtifactRetentionCandidateEvidence;
  telemetry?: TestRunTelemetry;
}

interface ExecuteOptions extends ArtifactRetentionOptions {
  planPath: string;
  confirmSha256: string;
  afterQuarantine?: (input: { runId: string; quarantinePath: string; lock: TestRunArtifactLockToken }) => void | Promise<void>;
  afterFinalDescriptorOpen?: (input: { runId: string; telemetryPath: string }) => void;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function mode(metadata: Stats): number {
  return metadata.mode & 0o777;
}

function currentUid(): number {
  if (typeof process.getuid !== "function") throw new Error("Artifact retention requires POSIX ownership checks");
  return process.getuid();
}

function pathIsInside(parent: string, child: string): boolean {
  const fromParent = relative(resolve(parent), resolve(child));
  return fromParent === "" || (!fromParent.startsWith("..") && !isAbsolute(fromParent));
}

function optionalLstat(path: string): Stats | undefined {
  try {
    return lstatSync(path) as Stats;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function stableDigest<T extends { digest: string }>(value: T): string {
  const { digest: _digest, ...body } = value;
  return sha256(JSON.stringify(body));
}

function selectedRunIds(options: ArtifactRetentionOptions): Set<string> {
  const selected = new Set(options.selectedRunIds ?? []);
  const telemetryPath = process.env[TEST_RUN_TELEMETRY_ENV];
  if (telemetryPath && basename(telemetryPath) === ARTIFACT_RETENTION_TELEMETRY_FILENAME) {
    const candidate = basename(dirname(resolve(telemetryPath)));
    if (UUID_PATTERN.test(candidate)) selected.add(candidate);
  }
  const manifestPath = process.env[TEST_RUN_MANIFEST_ENV];
  if (manifestPath && existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as { runId?: unknown };
      if (typeof parsed.runId === "string" && UUID_PATTERN.test(parsed.runId)) selected.add(parsed.runId);
    } catch {
      // A malformed selected manifest is never used to make evidence eligible.
    }
  }
  return selected;
}

function defaultPortProbe(port: number): Promise<boolean> {
  return new Promise((resolveResult) => {
    const socket = connect({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveResult(open);
    };
    socket.setTimeout(300, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function exactProcessIsActive(record: TestRunProcess, runNonce: string): "active" | "gone" | "unknown" {
  if (record.identityState === "provisional") return "unknown";
  const identity = inspectProcessIdentity(record.pid);
  if (identity) {
    return identity.runNonce === runNonce
      && identity.pidStartTime === record.pidStartTime
      && identity.pgid === record.pgid
      && identity.groupIdentity === record.groupIdentity
      ? "active"
      : "gone";
  }
  try {
    process.kill(record.pid, 0);
    return "unknown";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? "gone" : "unknown";
  }
}

function processActivity(telemetry: TestRunTelemetry): "active" | "gone" | "unknown" {
  for (const entry of telemetry.processes) {
    const state = exactProcessIsActive(entry.record, telemetry.runNonce);
    if (state !== "gone") return state;
  }
  if (process.platform === "win32" || !existsSync("/proc")) return "unknown";
  const recordedGroups = new Set(telemetry.processes.map(({ record }) => record.pgid).filter((pgid) => pgid > 1));
  try {
    for (const entry of readdirSync("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const pid = Number(entry.name);
      const stat = readProcStat(pid);
      if (stat && recordedGroups.has(stat.pgid)) return "active";
    }
    return discoverRepositoryProcessCandidates(telemetry.repoRoot)
      .some((candidate) => candidate.runNonce === telemetry.runNonce)
      ? "active"
      : "gone";
  } catch {
    return "unknown";
  }
}

function candidateEvidence(
  repoRoot: string,
  artifactRoot: string,
  runId: string,
  directoryPath: string,
  expectedParent = artifactRoot,
  relativePathOverride?: string,
): { evidence?: ArtifactRetentionCandidateEvidence; codes: ArtifactRetentionReasonCode[] } {
  const codes = new Set<ArtifactRetentionReasonCode>();
  const directoryMetadata = optionalLstat(directoryPath);
  if (!directoryMetadata || !directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    return { codes: ["PATH_UNSAFE"] };
  }
  if (resolve(directoryPath) !== directoryPath || realpathSync(directoryPath) !== directoryPath
    || dirname(directoryPath) !== expectedParent || !pathIsInside(repoRoot, directoryPath)) {
    codes.add("PATH_UNSAFE");
  }
  if (directoryMetadata.uid !== currentUid()) codes.add("OWNER_UNSAFE");
  if ((mode(directoryMetadata) & 0o077) !== 0) codes.add("MODE_UNSAFE");
  const artifactDevice = lstatSync(artifactRoot).dev;
  if (directoryMetadata.dev !== artifactDevice) codes.add("CROSS_DEVICE");

  const entries = readdirSync(directoryPath, { withFileTypes: true });
  if (entries.length !== 1 || entries[0]?.name !== ARTIFACT_RETENTION_TELEMETRY_FILENAME) {
    codes.add(entries.some(({ name }) => name !== ARTIFACT_RETENTION_TELEMETRY_FILENAME)
      ? "AUXILIARY_EVIDENCE"
      : "INVENTORY_UNSAFE");
    return { codes: [...codes].sort() };
  }
  const telemetryPath = join(directoryPath, ARTIFACT_RETENTION_TELEMETRY_FILENAME);
  const telemetryMetadata = lstatSync(telemetryPath);
  if (!telemetryMetadata.isFile() || telemetryMetadata.isSymbolicLink() || realpathSync(telemetryPath) !== telemetryPath) {
    codes.add("LINK_UNSAFE");
  }
  if (telemetryMetadata.nlink !== 1) codes.add("LINK_UNSAFE");
  if (telemetryMetadata.uid !== currentUid()) codes.add("OWNER_UNSAFE");
  if ((mode(telemetryMetadata) & 0o077) !== 0) codes.add("MODE_UNSAFE");
  if (telemetryMetadata.dev !== directoryMetadata.dev) codes.add("CROSS_DEVICE");
  if (codes.size > 0) return { codes: [...codes].sort() };

  const telemetrySha256 = sha256(readFileSync(telemetryPath));
  const relativePath = relativePathOverride ?? relative(repoRoot, directoryPath).split("\\").join("/");
  return {
    codes: [],
    evidence: {
      runId,
      relativePath,
      directory: {
        device: directoryMetadata.dev,
        inode: directoryMetadata.ino,
        mode: mode(directoryMetadata),
        uid: directoryMetadata.uid,
        inventoryCount: 1,
      },
      inventory: [{
        name: ARTIFACT_RETENTION_TELEMETRY_FILENAME,
        type: "file",
        device: telemetryMetadata.dev,
        inode: telemetryMetadata.ino,
        mode: mode(telemetryMetadata),
        uid: telemetryMetadata.uid,
        links: telemetryMetadata.nlink,
        bytes: telemetryMetadata.size,
        sha256: telemetrySha256,
      }],
      telemetrySha256,
      estimatedBytes: directoryMetadata.size + telemetryMetadata.size,
    },
  };
}

async function classifyCandidate(input: {
  repoRoot: string;
  artifactRoot: string;
  runId: string;
  cutoffMs: number;
  selected: ReadonlySet<string>;
  portProbe: (port: number) => Promise<boolean>;
  expectedLock?: TestRunArtifactLockToken;
}): Promise<CandidateClassification> {
  const directoryPath = join(input.artifactRoot, input.runId);
  const codes = new Set<ArtifactRetentionReasonCode>();
  if (input.selected.has(input.runId)) codes.add("CURRENT_RUN");
  const lock = inspectTestRunArtifactLock(input.artifactRoot, input.runId);
  const expectedLock = input.expectedLock;
  const ownsLock = expectedLock !== undefined && lock.state === "active"
    && lock.owner.token === expectedLock.owner.token && lock.ownerHash === expectedLock.ownerHash;
  if (!ownsLock) {
    if (lock.state === "active") codes.add("LOCK_ACTIVE");
    else if (lock.state === "dead") codes.add("LOCK_DEAD");
    else if (lock.state === "expired") codes.add("LOCK_EXPIRED");
    else if (lock.state === "malformed") codes.add("LOCK_MALFORMED");
  }

  let evidenceResult: ReturnType<typeof candidateEvidence>;
  try {
    evidenceResult = candidateEvidence(input.repoRoot, input.artifactRoot, input.runId, directoryPath);
  } catch {
    codes.add("PATH_UNSAFE");
    return { runId: input.runId, codes: [...codes].sort() };
  }
  for (const code of evidenceResult.codes) codes.add(code);
  if (!evidenceResult.evidence) return { runId: input.runId, codes: [...codes].sort() };

  const telemetryPath = join(directoryPath, ARTIFACT_RETENTION_TELEMETRY_FILENAME);
  let telemetry: TestRunTelemetry;
  try {
    telemetry = readTestRunTelemetryForContainmentAudit(telemetryPath, input.repoRoot);
  } catch {
    codes.add("TELEMETRY_MALFORMED");
    return { runId: input.runId, codes: [...codes].sort(), evidence: evidenceResult.evidence };
  }
  if (telemetry.runId !== input.runId || telemetry.repoRoot !== input.repoRoot) codes.add("TELEMETRY_MALFORMED");
  if (optionalLstat(telemetry.manifestPath)) codes.add("MANIFEST_PRESENT");
  if (telemetry.status !== "complete") codes.add("STATUS_INCOMPLETE");
  if (telemetry.resolution?.status !== "resolved") codes.add("RESOLUTION_UNRESOLVED");
  if (telemetry.activeProcesses.length !== 0) codes.add("ACTIVE_PROCESS");
  if (telemetry.failures.length !== 0) codes.add("FAILURE_EVIDENCE");
  const telemetryMetadata = lstatSync(telemetryPath);
  const directoryMetadata = lstatSync(directoryPath);
  if (Date.parse(telemetry.updatedAt) > input.cutoffMs
    || telemetryMetadata.mtimeMs > input.cutoffMs
    || directoryMetadata.mtimeMs > input.cutoffMs) {
    codes.add("TOO_RECENT");
  }
  const activity = processActivity(telemetry);
  if (activity === "active") codes.add("ACTIVE_PROCESS");
  else if (activity === "unknown") codes.add("PROCESS_UNKNOWN");
  const portStates = await Promise.all(Object.values(telemetry.ports).map(input.portProbe));
  if (portStates.some(Boolean)) codes.add("PORT_OPEN");
  return {
    runId: input.runId,
    codes: [...codes].sort(),
    evidence: evidenceResult.evidence,
    telemetry,
  };
}

function countReasons(classifications: CandidateClassification[], nonCanonicalCount: number): ArtifactRetentionPlan["reasonCounts"] {
  const counts: ArtifactRetentionPlan["reasonCounts"] = {};
  if (nonCanonicalCount > 0) counts.NON_CANONICAL_ROOT = nonCanonicalCount;
  for (const classification of classifications) {
    for (const code of classification.codes) counts[code] = (counts[code] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function assertArtifactRoot(repoRoot: string): string {
  const artifactRoot = getTestRunArtifactRoot(repoRoot);
  const metadata = lstatSync(artifactRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(artifactRoot) !== artifactRoot
    || metadata.uid !== currentUid() || !pathIsInside(repoRoot, artifactRoot)) {
    throw new Error("Canonical test-run artifact root is unsafe");
  }
  return artifactRoot;
}

export async function previewArtifactRetention(options: ArtifactRetentionOptions = {}): Promise<ArtifactRetentionPlan> {
  const repoRoot = getCanonicalRepoRoot(options.repoRoot ?? process.cwd());
  const artifactRoot = assertArtifactRoot(repoRoot);
  const now = options.now ?? new Date();
  const cutoffMs = now.getTime() - ARTIFACT_RETENTION_MINIMUM_AGE_DAYS * 24 * 60 * 60 * 1_000;
  const selected = selectedRunIds(options);
  const classifications: CandidateClassification[] = [];
  let nonCanonicalCount = 0;
  for (const entry of readdirSync(artifactRoot, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!UUID_PATTERN.test(entry.name)) {
      nonCanonicalCount += 1;
      continue;
    }
    if (!entry.isDirectory()) {
      classifications.push({ runId: entry.name, codes: ["PATH_UNSAFE"] });
      continue;
    }
    classifications.push(await classifyCandidate({
      repoRoot,
      artifactRoot,
      runId: entry.name,
      cutoffMs,
      selected,
      portProbe: options.portProbe ?? defaultPortProbe,
    }));
  }
  const repositoryMetadata = lstatSync(repoRoot);
  const unsigned = {
    version: ARTIFACT_RETENTION_PLAN_VERSION,
    planId: randomUUID(),
    policy: {
      id: ARTIFACT_RETENTION_POLICY_ID,
      minimumAgeDays: ARTIFACT_RETENTION_MINIMUM_AGE_DAYS,
      telemetryFile: ARTIFACT_RETENTION_TELEMETRY_FILENAME,
    },
    repository: { root: repoRoot, device: repositoryMetadata.dev, inode: repositoryMetadata.ino },
    generatedAt: now.toISOString(),
    cutoff: new Date(cutoffMs).toISOString(),
    expiresAt: new Date(now.getTime() + ARTIFACT_RETENTION_PLAN_TTL_MS).toISOString(),
    eligible: classifications.filter(({ codes }) => codes.length === 0).map(({ evidence }) => evidence!),
    excludedRuns: classifications.filter(({ codes }) => codes.length > 0)
      .map(({ runId, codes }) => ({ runId, codes })),
    reasonCounts: countReasons(classifications, nonCanonicalCount),
    digest: "",
  } satisfies ArtifactRetentionPlan;
  return { ...unsigned, digest: stableDigest(unsigned) };
}

function assertOwnerOnlyControlFile(path: string, expectedRoot: string): void {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== currentUid()
    || metadata.nlink !== 1 || (mode(metadata) & 0o077) !== 0
    || realpathSync(path) !== path || !pathIsInside(expectedRoot, path)) {
    throw new Error("Retention control file is unsafe");
  }
}

function assertOwnerOnlyControlDirectory(path: string, expectedParent: string): void {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== currentUid()
    || (mode(metadata) & 0o077) !== 0 || realpathSync(path) !== path
    || !pathIsInside(expectedParent, path)) {
    throw new Error("Retention control directory is unsafe");
  }
}

function writeControlJson(path: string, value: unknown, root: string): void {
  if (existsSync(path)) throw new Error("Retention control file already exists");
  const temporaryPath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temporaryPath, path);
  chmodSync(path, 0o600);
  assertOwnerOnlyControlFile(path, root);
}

function retentionOwnerToken(
  path: string,
  owner: TestRunRetentionLockOwner,
): TestRunArtifactLockToken {
  const directory = lstatSync(path);
  const ownerHash = sha256(readFileSync(join(path, TEST_RUN_RETENTION_LOCK_FILENAME)));
  return { path, owner, device: directory.dev, inode: directory.ino, ownerHash };
}

function writeRetentionMarker(path: string, owner: TestRunRetentionLockOwner): TestRunArtifactLockToken {
  const ownerPath = join(path, TEST_RUN_RETENTION_LOCK_FILENAME);
  const temporaryPath = join(path, `.${TEST_RUN_RETENTION_LOCK_FILENAME}.${owner.token}.tmp`);
  writeFileSync(temporaryPath, `${JSON.stringify(owner, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temporaryPath, ownerPath);
  chmodSync(ownerPath, 0o600);
  return retentionOwnerToken(path, owner);
}

function acquireValidatedRetentionTransition(input: {
  artifactRoot: string;
  repoRoot: string;
  plan: ArtifactRetentionPlan;
  planned: ArtifactRetentionCandidateEvidence;
  telemetry: TestRunTelemetry;
  quarantineParent: string;
  validatedAt: Date;
}): TestRunArtifactLockToken {
  if (input.plan.digest !== stableDigest(input.plan)
    || input.plan.policy.id !== ARTIFACT_RETENTION_POLICY_ID
    || input.validatedAt.getTime() > Date.parse(input.plan.expiresAt)
    || !input.plan.eligible.some((candidate) => evidenceMatches(candidate, input.planned))
    || input.telemetry.runId !== input.planned.runId
    || input.telemetry.repoRoot !== input.repoRoot) {
    throw new Error("Validated retention transition preconditions are invalid");
  }
  const lockRoot = ensureTestRunRetentionSubdirectory(input.artifactRoot, TEST_RUN_RETENTION_LOCK_DIRECTORY);
  const path = getTestRunRetentionLockPath(input.artifactRoot, input.planned.runId);
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("RUN_ARTIFACT_LOCKED");
    throw error;
  }
  try {
    const identity = inspectProcessIdentity(process.pid);
    if (!identity) throw new Error("RUN_ARTIFACT_LOCK_PROCESS_UNVERIFIABLE");
    const quarantineParent = lstatSync(input.quarantineParent);
    const telemetryFile = input.planned.inventory[0];
    const now = new Date();
    const owner: TestRunRetentionLockOwner = {
      version: TEST_RUN_RETENTION_LOCK_VERSION,
      runId: input.planned.runId,
      runNonce: input.telemetry.runNonce,
      repoRoot: input.repoRoot,
      mode: "retention",
      pid: process.pid,
      pidStartTime: identity.pidStartTime,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TEST_RUN_RETENTION_LOCK_TTL_MS).toISOString(),
      token: randomUUID(),
      planId: input.plan.planId,
      planDigest: input.plan.digest,
      candidate: {
        relativePath: input.planned.relativePath,
        directoryDevice: input.planned.directory.device,
        directoryInode: input.planned.directory.inode,
        telemetryDevice: telemetryFile.device,
        telemetryInode: telemetryFile.inode,
        telemetryLinks: 1,
        telemetryUid: telemetryFile.uid,
        telemetryMode: telemetryFile.mode,
        telemetryBytes: telemetryFile.bytes,
        telemetrySha256: telemetryFile.sha256,
      },
      quarantine: {
        phase: "prepared",
        relativePath: relative(input.repoRoot, join(input.quarantineParent, input.planned.runId)).split("\\").join("/"),
        parentDevice: quarantineParent.dev,
        parentInode: quarantineParent.ino,
        directoryDevice: input.planned.directory.device,
        directoryInode: input.planned.directory.inode,
      },
    };
    if (dirname(path) !== lockRoot) throw new Error("Retention lock escaped its exact root");
    return writeRetentionMarker(path, owner);
  } catch (error) {
    for (const entry of readdirSync(path)) unlinkSync(join(path, entry));
    rmdirSync(path);
    throw error;
  }
}

function markRetentionTransitionQuarantined(
  token: TestRunArtifactLockToken,
  quarantinePath: string,
): TestRunArtifactLockToken {
  const inspection = inspectTestRunArtifactLock(dirname(dirname(dirname(token.path))), token.owner.runId);
  if (inspection.state !== "active" || inspection.owner.mode !== "retention"
    || inspection.owner.token !== token.owner.token || inspection.ownerHash !== token.ownerHash
    || inspection.owner.quarantine.phase !== "prepared") {
    throw new Error("Retention transition marker changed before quarantine binding");
  }
  const directory = lstatSync(quarantinePath);
  if (!directory.isDirectory() || directory.isSymbolicLink()
    || directory.dev !== inspection.owner.candidate.directoryDevice
    || directory.ino !== inspection.owner.candidate.directoryInode) {
    throw new Error("Retention quarantine identity does not match the validated candidate");
  }
  const owner: TestRunRetentionLockOwner = {
    ...inspection.owner,
    quarantine: { ...inspection.owner.quarantine, phase: "quarantined" },
  };
  return writeRetentionMarker(token.path, owner);
}

export async function reportArtifactRetention(options: ArtifactRetentionOptions = {}): Promise<{
  plan: ArtifactRetentionPlan;
  report: ArtifactRetentionReport;
  planPath: string;
  reportPath: string;
}> {
  const plan = await previewArtifactRetention(options);
  const artifactRoot = assertArtifactRoot(plan.repository.root);
  const planRoot = ensureTestRunRetentionSubdirectory(artifactRoot, TEST_RUN_RETENTION_PLAN_DIRECTORY);
  const reportRoot = ensureTestRunRetentionSubdirectory(artifactRoot, TEST_RUN_RETENTION_REPORT_DIRECTORY);
  const planPath = join(planRoot, `${plan.planId}.json`);
  const reportPath = join(reportRoot, `${plan.planId}.json`);
  const report: ArtifactRetentionReport = {
    version: 1,
    planId: plan.planId,
    planDigest: plan.digest,
    generatedAt: plan.generatedAt,
    expiresAt: plan.expiresAt,
    eligibleRunIds: plan.eligible.map(({ runId }) => runId),
    reasonCounts: plan.reasonCounts,
  };
  writeControlJson(planPath, plan, planRoot);
  writeControlJson(reportPath, report, reportRoot);
  return { plan, report, planPath, reportPath };
}

function parsePlan(value: unknown): ArtifactRetentionPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Retention plan is malformed");
  const plan = value as ArtifactRetentionPlan;
  const allowedPlanKeys = new Set([
    "version", "planId", "policy", "repository", "generatedAt", "cutoff", "expiresAt",
    "eligible", "excludedRuns", "reasonCounts", "digest",
  ]);
  if (Object.keys(plan).some((key) => !allowedPlanKeys.has(key))
    || plan.version !== ARTIFACT_RETENTION_PLAN_VERSION || !UUID_PATTERN.test(plan.planId)
    || plan.policy?.id !== ARTIFACT_RETENTION_POLICY_ID
    || plan.policy.minimumAgeDays !== ARTIFACT_RETENTION_MINIMUM_AGE_DAYS
    || plan.policy.telemetryFile !== ARTIFACT_RETENTION_TELEMETRY_FILENAME
    || !isTimestamp(plan.generatedAt) || !isTimestamp(plan.cutoff) || !isTimestamp(plan.expiresAt)
    || Date.parse(plan.cutoff) !== Date.parse(plan.generatedAt) - ARTIFACT_RETENTION_MINIMUM_AGE_DAYS * 24 * 60 * 60 * 1_000
    || Date.parse(plan.expiresAt) !== Date.parse(plan.generatedAt) + ARTIFACT_RETENTION_PLAN_TTL_MS
    || !Array.isArray(plan.eligible) || !Array.isArray(plan.excludedRuns)
    || typeof plan.digest !== "string" || !/^[a-f0-9]{64}$/.test(plan.digest)
    || stableDigest(plan) !== plan.digest) {
    throw new Error("Retention plan is malformed or its digest is invalid");
  }
  if (!plan.repository || Object.keys(plan.repository).some((key) => !["root", "device", "inode"].includes(key))
    || Object.keys(plan.policy).some((key) => !["id", "minimumAgeDays", "telemetryFile"].includes(key))
    || typeof plan.repository.root !== "string" || !isAbsolute(plan.repository.root)
    || resolve(plan.repository.root) !== plan.repository.root
    || !Number.isSafeInteger(plan.repository.device) || !Number.isSafeInteger(plan.repository.inode)
    || plan.repository.device < 0 || plan.repository.inode <= 0) {
    throw new Error("Retention plan repository identity is malformed");
  }
  const seen = new Set<string>();
  for (const candidate of plan.eligible) {
    const inventory = candidate?.inventory?.[0];
    if (!candidate || Object.keys(candidate).some((key) => ![
      "runId", "relativePath", "directory", "inventory", "telemetrySha256", "estimatedBytes",
    ].includes(key))
      || !UUID_PATTERN.test(candidate.runId) || seen.has(candidate.runId)
      || candidate.relativePath !== `tests/artifacts/test-runs/${candidate.runId}`
      || !candidate.directory || Object.keys(candidate.directory).some((key) => ![
        "device", "inode", "mode", "uid", "inventoryCount",
      ].includes(key))
      || ![candidate.directory.device, candidate.directory.inode, candidate.directory.mode,
        candidate.directory.uid, candidate.estimatedBytes].every(Number.isSafeInteger)
      || candidate.directory.device < 0 || candidate.directory.inode <= 0
      || candidate.directory.mode !== 0o700 || candidate.directory.uid < 0
      || candidate.directory.inventoryCount !== 1
      || !Array.isArray(candidate.inventory) || candidate.inventory.length !== 1
      || !inventory || Object.keys(inventory).some((key) => ![
        "name", "type", "device", "inode", "mode", "uid", "links", "bytes", "sha256",
      ].includes(key))
      || inventory.name !== ARTIFACT_RETENTION_TELEMETRY_FILENAME || inventory.type !== "file"
      || ![inventory.device, inventory.inode, inventory.mode, inventory.uid,
        inventory.links, inventory.bytes].every(Number.isSafeInteger)
      || inventory.device !== candidate.directory.device || inventory.inode <= 0
      || inventory.mode !== 0o600 || inventory.uid !== candidate.directory.uid
      || inventory.links !== 1 || inventory.bytes < 0
      || !/^[a-f0-9]{64}$/.test(inventory.sha256)
      || candidate.telemetrySha256 !== inventory.sha256
      || candidate.estimatedBytes < inventory.bytes) {
      throw new Error("Retention plan candidate evidence is malformed");
    }
    seen.add(candidate.runId);
  }
  for (const excluded of plan.excludedRuns) {
    if (!excluded || Object.keys(excluded).some((key) => key !== "runId" && key !== "codes")
      || !UUID_PATTERN.test(excluded.runId) || seen.has(excluded.runId)
      || !Array.isArray(excluded.codes) || excluded.codes.length === 0
      || excluded.codes.some((code) => !RETENTION_REASON_CODES.has(code))) {
      throw new Error("Retention plan exclusion evidence is malformed");
    }
    seen.add(excluded.runId);
  }
  if (!plan.reasonCounts || typeof plan.reasonCounts !== "object" || Array.isArray(plan.reasonCounts)
    || Object.entries(plan.reasonCounts).some(([code, count]) => !RETENTION_REASON_CODES.has(code as ArtifactRetentionReasonCode)
      || !Number.isSafeInteger(count) || (count ?? 0) <= 0)) {
    throw new Error("Retention plan reason counts are malformed");
  }
  return plan;
}

function readPlan(planPath: string, repoRoot: string): ArtifactRetentionPlan {
  const artifactRoot = assertArtifactRoot(repoRoot);
  const controlRoot = getTestRunRetentionControlRoot(artifactRoot);
  const planRoot = join(controlRoot, TEST_RUN_RETENTION_PLAN_DIRECTORY);
  const resolvedPath = resolve(planPath);
  if (dirname(resolvedPath) !== planRoot || !UUID_PATTERN.test(basename(resolvedPath, ".json"))
    || basename(resolvedPath) !== `${basename(resolvedPath, ".json")}.json`) {
    throw new Error("Retention plan path is outside the exact plan root");
  }
  assertOwnerOnlyControlDirectory(controlRoot, artifactRoot);
  assertOwnerOnlyControlDirectory(planRoot, controlRoot);
  assertOwnerOnlyControlFile(resolvedPath, planRoot);
  const plan = parsePlan(JSON.parse(readFileSync(resolvedPath, "utf8")));
  if (plan.planId !== basename(resolvedPath, ".json") || plan.repository.root !== repoRoot) {
    throw new Error("Retention plan repository or path identity is invalid");
  }
  const repositoryMetadata = lstatSync(repoRoot);
  if (repositoryMetadata.dev !== plan.repository.device || repositoryMetadata.ino !== plan.repository.inode) {
    throw new Error("Retention plan repository identity changed");
  }
  return plan;
}

export type ArtifactRetentionTransitionInspection =
  | { state: "missing"; runId: string }
  | { state: "invalid"; runId: string; code: string }
  | {
    state: "valid";
    phase: "prepared" | "quarantined";
    runId: string;
    telemetryPath: string;
    quarantinePath: string;
    planPath: string;
    markerToken: string;
    markerHash: string;
  };

export function inspectValidatedArtifactRetentionTransition(input: {
  repoRoot?: string;
  runId: string;
  now?: Date;
}): ArtifactRetentionTransitionInspection {
  const runId = input.runId;
  try {
    if (!UUID_PATTERN.test(runId)) return { state: "invalid", runId, code: "MARKER_RUN_ID_INVALID" };
    const repoRoot = getCanonicalRepoRoot(input.repoRoot ?? process.cwd());
    const artifactRoot = assertArtifactRoot(repoRoot);
    const lock = inspectTestRunArtifactLock(artifactRoot, runId, (input.now ?? new Date()).getTime());
    if (lock.state === "missing") return { state: "missing", runId };
    if (lock.state !== "active" || lock.owner.mode !== "retention") {
      return { state: "invalid", runId, code: `MARKER_${lock.state.toUpperCase()}` };
    }
    const owner = lock.owner;
    if (owner.repoRoot !== repoRoot || owner.runId !== runId) {
      return { state: "invalid", runId, code: "MARKER_IDENTITY_MISMATCH" };
    }
    const planPath = join(
      getTestRunRetentionControlRoot(artifactRoot),
      TEST_RUN_RETENTION_PLAN_DIRECTORY,
      `${owner.planId}.json`,
    );
    const plan = readPlan(planPath, repoRoot);
    const now = (input.now ?? new Date()).getTime();
    if (plan.digest !== owner.planDigest || now > Date.parse(plan.expiresAt)) {
      return { state: "invalid", runId, code: "MARKER_PLAN_MISMATCH_OR_EXPIRED" };
    }
    const planned = plan.eligible.find((candidate) => candidate.runId === runId);
    if (!planned) return { state: "invalid", runId, code: "MARKER_CANDIDATE_MISSING" };
    const telemetryFile = planned.inventory[0];
    const expectedCandidateBinding = {
      relativePath: planned.relativePath,
      directoryDevice: planned.directory.device,
      directoryInode: planned.directory.inode,
      telemetryDevice: telemetryFile.device,
      telemetryInode: telemetryFile.inode,
      telemetryLinks: 1 as const,
      telemetryUid: telemetryFile.uid,
      telemetryMode: telemetryFile.mode,
      telemetryBytes: telemetryFile.bytes,
      telemetrySha256: telemetryFile.sha256,
    };
    if (JSON.stringify(owner.candidate) !== JSON.stringify(expectedCandidateBinding)) {
      return { state: "invalid", runId, code: "MARKER_CANDIDATE_BINDING_MISMATCH" };
    }
    const canonicalRunPath = join(artifactRoot, runId);
    const quarantineParent = join(
      getTestRunRetentionControlRoot(artifactRoot),
      TEST_RUN_RETENTION_QUARANTINE_DIRECTORY,
      plan.planId,
    );
    const quarantinePath = join(quarantineParent, runId);
    const expectedQuarantineRelative = relative(repoRoot, quarantinePath).split("\\").join("/");
    const parent = lstatSync(quarantineParent);
    if (!parent.isDirectory() || parent.isSymbolicLink() || realpathSync(quarantineParent) !== quarantineParent
      || owner.quarantine.relativePath !== expectedQuarantineRelative
      || owner.quarantine.parentDevice !== parent.dev || owner.quarantine.parentInode !== parent.ino) {
      return { state: "invalid", runId, code: "MARKER_QUARANTINE_PARENT_MISMATCH" };
    }
    const canonicalTelemetryPath = join(canonicalRunPath, ARTIFACT_RETENTION_TELEMETRY_FILENAME);
    if (owner.quarantine.phase === "prepared") {
      if (optionalLstat(quarantinePath)) return { state: "invalid", runId, code: "MARKER_PREMATURE_QUARANTINE" };
      const evidence = candidateEvidence(repoRoot, artifactRoot, runId, canonicalRunPath).evidence;
      if (!evidenceMatches(evidence, planned)) {
        return { state: "invalid", runId, code: "MARKER_PREPARED_CANDIDATE_MISMATCH" };
      }
      const telemetry = readTestRunTelemetryForContainmentAudit(canonicalTelemetryPath, repoRoot);
      if (telemetry.runId !== runId || telemetry.runNonce !== owner.runNonce || telemetry.repoRoot !== repoRoot) {
        return { state: "invalid", runId, code: "MARKER_TELEMETRY_IDENTITY_MISMATCH" };
      }
      return {
        state: "valid",
        phase: "prepared",
        runId,
        telemetryPath: canonicalTelemetryPath,
        quarantinePath,
        planPath,
        markerToken: owner.token,
        markerHash: lock.ownerHash,
      };
    }
    if (optionalLstat(canonicalRunPath)) return { state: "invalid", runId, code: "MARKER_CANDIDATE_RECREATED" };
    const evidence = quarantineEvidence(repoRoot, artifactRoot, runId, quarantinePath, planned.relativePath);
    if (!evidenceMatches(evidence, planned)
      || owner.quarantine.directoryDevice !== planned.directory.device
      || owner.quarantine.directoryInode !== planned.directory.inode) {
      return { state: "invalid", runId, code: "MARKER_QUARANTINE_EVIDENCE_MISMATCH" };
    }
    const telemetryPath = join(quarantinePath, ARTIFACT_RETENTION_TELEMETRY_FILENAME);
    const telemetry = parseTestRunTelemetryPayload(JSON.parse(readFileSync(telemetryPath, "utf8")));
    if (telemetry.runId !== runId || telemetry.runNonce !== owner.runNonce || telemetry.repoRoot !== repoRoot) {
      return { state: "invalid", runId, code: "MARKER_TELEMETRY_IDENTITY_MISMATCH" };
    }
    return {
      state: "valid",
      phase: "quarantined",
      runId,
      telemetryPath: canonicalTelemetryPath,
      quarantinePath,
      planPath,
      markerToken: owner.token,
      markerHash: lock.ownerHash,
    };
  } catch {
    return { state: "invalid", runId, code: "MARKER_VALIDATION_FAILED" };
  }
}

function evidenceMatches(left: ArtifactRetentionCandidateEvidence | undefined, right: ArtifactRetentionCandidateEvidence): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

async function noRunActivity(
  owner: { runNonce: string },
  telemetry: TestRunTelemetry,
  portProbe: (port: number) => Promise<boolean>,
): Promise<boolean> {
  if (owner.runNonce !== telemetry.runNonce || processActivity(telemetry) !== "gone") return false;
  return !(await Promise.all(Object.values(telemetry.ports).map(portProbe))).some(Boolean);
}

function quarantineEvidence(
  repoRoot: string,
  artifactRoot: string,
  runId: string,
  quarantinePath: string,
  plannedRelativePath: string,
): ArtifactRetentionCandidateEvidence | undefined {
  return candidateEvidence(
    repoRoot,
    artifactRoot,
    runId,
    quarantinePath,
    dirname(quarantinePath),
    plannedRelativePath,
  ).evidence;
}

function finalValidateAndUnlinkQuarantinedTelemetry(input: {
  artifactRoot: string;
  planned: ArtifactRetentionCandidateEvidence;
  quarantineParent: string;
  quarantinePath: string;
  lock: TestRunArtifactLockToken;
  afterDescriptorOpen?: (input: { runId: string; telemetryPath: string }) => void;
}): "deleted" | "changed" {
  const lock = inspectTestRunArtifactLock(input.artifactRoot, input.planned.runId);
  if (lock.state !== "active" || lock.owner.mode !== "retention"
    || lock.owner.token !== input.lock.owner.token || lock.ownerHash !== input.lock.ownerHash
    || lock.owner.quarantine.phase !== "quarantined") return "changed";
  const parent = lstatSync(input.quarantineParent);
  const directory = lstatSync(input.quarantinePath);
  if (!parent.isDirectory() || parent.isSymbolicLink() || realpathSync(input.quarantineParent) !== input.quarantineParent
    || parent.dev !== lock.owner.quarantine.parentDevice || parent.ino !== lock.owner.quarantine.parentInode
    || !directory.isDirectory() || directory.isSymbolicLink() || realpathSync(input.quarantinePath) !== input.quarantinePath
    || directory.dev !== input.planned.directory.device || directory.ino !== input.planned.directory.inode
    || directory.uid !== input.planned.directory.uid || mode(directory) !== input.planned.directory.mode) {
    return "changed";
  }
  const entries = readdirSync(input.quarantinePath);
  if (entries.length !== 1 || entries[0] !== ARTIFACT_RETENTION_TELEMETRY_FILENAME) return "changed";
  const telemetryPath = join(input.quarantinePath, ARTIFACT_RETENTION_TELEMETRY_FILENAME);
  const plannedFile = input.planned.inventory[0];
  let descriptor: number | undefined;
  try {
    const pathBefore = lstatSync(telemetryPath);
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink()
      || pathBefore.dev !== plannedFile.device || pathBefore.ino !== plannedFile.inode
      || pathBefore.nlink !== 1 || pathBefore.uid !== plannedFile.uid
      || mode(pathBefore) !== plannedFile.mode || pathBefore.size !== plannedFile.bytes) return "changed";
    descriptor = openSync(telemetryPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor);
    if (before.dev !== plannedFile.device || before.ino !== plannedFile.inode || before.nlink !== 1
      || before.uid !== plannedFile.uid || mode(before) !== plannedFile.mode || before.size !== plannedFile.bytes) {
      return "changed";
    }
    input.afterDescriptorOpen?.({ runId: input.planned.runId, telemetryPath });
    const content = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const pathFinal = lstatSync(telemetryPath);
    if (after.dev !== before.dev || after.ino !== before.ino || after.nlink !== 1 || after.size !== before.size
      || pathFinal.dev !== before.dev || pathFinal.ino !== before.ino || pathFinal.nlink !== 1
      || pathFinal.uid !== before.uid || mode(pathFinal) !== mode(before) || pathFinal.size !== before.size
      || sha256(content) !== plannedFile.sha256) return "changed";
    unlinkSync(telemetryPath);
  } catch {
    return "changed";
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  rmdirSync(input.quarantinePath);
  return "deleted";
}

function receiptDigest(receipt: ArtifactRetentionReceipt): string {
  return stableDigest(receipt);
}

function parseReceipt(value: unknown): ArtifactRetentionReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Retention receipt is malformed");
  const receipt = value as ArtifactRetentionReceipt;
  if (Object.keys(receipt).some((key) => ![
    "version", "planId", "planDigest", "policyId", "repository", "executedAt",
    "deleted", "skipped", "recoverable", "digest",
  ].includes(key))
    || receipt.version !== ARTIFACT_RETENTION_RECEIPT_VERSION || !UUID_PATTERN.test(receipt.planId)
    || receipt.policyId !== ARTIFACT_RETENTION_POLICY_ID || !isTimestamp(receipt.executedAt)
    || !Array.isArray(receipt.deleted) || !Array.isArray(receipt.skipped) || !Array.isArray(receipt.recoverable)
    || !/^[a-f0-9]{64}$/.test(receipt.planDigest) || !/^[a-f0-9]{64}$/.test(receipt.digest)
    || receiptDigest(receipt) !== receipt.digest) {
    throw new Error("Retention receipt is malformed or its digest is invalid");
  }
  if (!receipt.repository || Object.keys(receipt.repository).some((key) => !["root", "device", "inode"].includes(key))
    || typeof receipt.repository.root !== "string" || !isAbsolute(receipt.repository.root)
    || resolve(receipt.repository.root) !== receipt.repository.root
    || !Number.isSafeInteger(receipt.repository.device) || !Number.isSafeInteger(receipt.repository.inode)
    || receipt.repository.device < 0 || receipt.repository.inode <= 0) {
    throw new Error("Retention receipt repository identity is malformed");
  }
  const seen = new Set<string>();
  for (const entry of receipt.deleted) {
    if (!entry || Object.keys(entry).some((key) => ![
      "runId", "relativePath", "directoryDevice", "directoryInode", "telemetrySha256",
    ].includes(key)) || !UUID_PATTERN.test(entry.runId) || seen.has(entry.runId)
      || entry.relativePath !== `tests/artifacts/test-runs/${entry.runId}`
      || !Number.isSafeInteger(entry.directoryDevice) || !Number.isSafeInteger(entry.directoryInode)
      || entry.directoryDevice < 0 || entry.directoryInode <= 0
      || !/^[a-f0-9]{64}$/.test(entry.telemetrySha256)) {
      throw new Error("Retention receipt deleted evidence is malformed");
    }
    seen.add(entry.runId);
  }
  for (const entry of receipt.skipped) {
    if (!entry || Object.keys(entry).some((key) => key !== "runId" && key !== "codes")
      || !UUID_PATTERN.test(entry.runId) || seen.has(entry.runId)
      || !Array.isArray(entry.codes) || entry.codes.length === 0
      || entry.codes.some((code) => !RETENTION_REASON_CODES.has(code))) {
      throw new Error("Retention receipt skipped evidence is malformed");
    }
    seen.add(entry.runId);
  }
  for (const entry of receipt.recoverable) {
    if (!entry || Object.keys(entry).some((key) => ![
      "runId", "codes", "quarantineRelativePath", "directoryDevice", "directoryInode", "telemetrySha256",
    ].includes(key)) || !UUID_PATTERN.test(entry.runId) || seen.has(entry.runId)
      || !Array.isArray(entry.codes) || entry.codes.length === 0
      || entry.codes.some((code) => !RETENTION_REASON_CODES.has(code))
      || entry.quarantineRelativePath !== `tests/artifacts/test-runs/.retention-control/quarantine/${receipt.planId}/${entry.runId}`
      || !Number.isSafeInteger(entry.directoryDevice) || !Number.isSafeInteger(entry.directoryInode)
      || entry.directoryDevice < 0 || entry.directoryInode <= 0
      || !/^[a-f0-9]{64}$/.test(entry.telemetrySha256)) {
      throw new Error("Retention receipt recoverable evidence is malformed");
    }
    seen.add(entry.runId);
  }
  return receipt;
}

function receiptPathFor(artifactRoot: string, planId: string): string {
  return join(getTestRunRetentionControlRoot(artifactRoot), TEST_RUN_RETENTION_RECEIPT_DIRECTORY, `${planId}.json`);
}

function readExistingReceipt(path: string, receiptRoot: string, plan: ArtifactRetentionPlan): ArtifactRetentionReceipt | undefined {
  if (!existsSync(path)) return undefined;
  assertOwnerOnlyControlFile(path, receiptRoot);
  const receipt = parseReceipt(JSON.parse(readFileSync(path, "utf8")));
  if (receipt.planId !== plan.planId || receipt.planDigest !== plan.digest
    || JSON.stringify(receipt.repository) !== JSON.stringify(plan.repository)) {
    throw new Error("Existing retention receipt does not match the plan");
  }
  return receipt;
}

export async function executeArtifactRetention(options: ExecuteOptions): Promise<{
  receipt: ArtifactRetentionReceipt;
  receiptPath: string;
}> {
  const repoRoot = getCanonicalRepoRoot(options.repoRoot ?? process.cwd());
  const plan = readPlan(options.planPath, repoRoot);
  if (options.confirmSha256 !== plan.digest) throw new Error("Retention execution requires the exact confirm-sha256 digest");
  const now = options.now ?? new Date();
  if (now.getTime() > Date.parse(plan.expiresAt)) throw new Error("Retention plan expired");
  const artifactRoot = assertArtifactRoot(repoRoot);
  const receiptRoot = ensureTestRunRetentionSubdirectory(artifactRoot, TEST_RUN_RETENTION_RECEIPT_DIRECTORY);
  const receiptPath = receiptPathFor(artifactRoot, plan.planId);
  const existingReceipt = readExistingReceipt(receiptPath, receiptRoot, plan);
  if (existingReceipt) return { receipt: existingReceipt, receiptPath };
  const quarantineRoot = ensureTestRunRetentionSubdirectory(artifactRoot, TEST_RUN_RETENTION_QUARANTINE_DIRECTORY);
  const planQuarantineRoot = join(quarantineRoot, plan.planId);
  try {
    mkdirSync(planQuarantineRoot, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const concurrentReceipt = readExistingReceipt(receiptPath, receiptRoot, plan);
      if (concurrentReceipt) return { receipt: concurrentReceipt, receiptPath };
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    }
    throw new Error("Retention execution is active or has recoverable quarantine evidence");
  }
  chmodSync(planQuarantineRoot, 0o700);

  const deleted: ArtifactRetentionReceipt["deleted"] = [];
  const skipped: ArtifactRetentionReceipt["skipped"] = [];
  const recoverable: ArtifactRetentionReceipt["recoverable"] = [];
  const portProbe = options.portProbe ?? defaultPortProbe;
  for (const planned of plan.eligible) {
    const candidatePath = join(artifactRoot, planned.runId);
    if (!existsSync(candidatePath)) {
      skipped.push({ runId: planned.runId, codes: ["CANDIDATE_MISSING"] });
      continue;
    }
    let initial = await classifyCandidate({
      repoRoot, artifactRoot, runId: planned.runId, cutoffMs: Date.parse(plan.cutoff),
      selected: selectedRunIds(options), portProbe,
    });
    const initialBlockingCodes = initial.codes.filter((code) => ![
      "LOCK_ACTIVE", "LOCK_DEAD", "LOCK_EXPIRED", "LOCK_MALFORMED",
    ].includes(code));
    if (initialBlockingCodes.length > 0 || !evidenceMatches(initial.evidence, planned) || !initial.telemetry) {
      skipped.push({ runId: planned.runId, codes: initialBlockingCodes.length > 0 ? initialBlockingCodes : ["CANDIDATE_CHANGED"] });
      continue;
    }

    let lock: TestRunArtifactLockToken;
    try {
      lock = acquireValidatedRetentionTransition({
        artifactRoot,
        repoRoot,
        plan,
        planned,
        telemetry: initial.telemetry,
        quarantineParent: planQuarantineRoot,
        validatedAt: now,
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "RUN_ARTIFACT_LOCKED") {
        skipped.push({ runId: planned.runId, codes: ["LOCK_MALFORMED"] });
        continue;
      }
      const stolen = await stealDeadTestRunArtifactLock({
        artifactRoot,
        runId: planned.runId,
        noRunActivity: (owner) => noRunActivity(owner, initial.telemetry!, portProbe),
      });
      if (!stolen) {
        const inspection = inspectTestRunArtifactLock(artifactRoot, planned.runId, now.getTime());
        const code: ArtifactRetentionReasonCode = inspection.state === "malformed" ? "LOCK_MALFORMED"
          : inspection.state === "expired" ? "LOCK_EXPIRED"
            : inspection.state === "dead" ? "LOCK_DEAD" : "LOCK_ACTIVE";
        skipped.push({ runId: planned.runId, codes: [code] });
        continue;
      }
      lock = acquireValidatedRetentionTransition({
        artifactRoot,
        repoRoot,
        plan,
        planned,
        telemetry: initial.telemetry,
        quarantineParent: planQuarantineRoot,
        validatedAt: now,
      });
    }

    let releaseLock = true;
    try {
      initial = await classifyCandidate({
        repoRoot, artifactRoot, runId: planned.runId, cutoffMs: Date.parse(plan.cutoff),
        selected: selectedRunIds(options), portProbe, expectedLock: lock,
      });
      if (initial.codes.length > 0 || !evidenceMatches(initial.evidence, planned)) {
        skipped.push({ runId: planned.runId, codes: initial.codes.length > 0 ? initial.codes : ["CANDIDATE_CHANGED"] });
        continue;
      }
      const quarantinePath = join(planQuarantineRoot, planned.runId);
      if (existsSync(quarantinePath)) {
        skipped.push({ runId: planned.runId, codes: ["QUARANTINE_CHANGED"] });
        continue;
      }
      if (lstatSync(planQuarantineRoot).dev !== planned.directory.device) {
        skipped.push({ runId: planned.runId, codes: ["CROSS_DEVICE"] });
        continue;
      }
      renameSync(candidatePath, quarantinePath);
      const quarantinedMetadata = lstatSync(quarantinePath);
      if (quarantinedMetadata.dev !== planned.directory.device || quarantinedMetadata.ino !== planned.directory.inode) {
        if (!existsSync(candidatePath) && quarantinedMetadata.isDirectory() && !quarantinedMetadata.isSymbolicLink()) {
          renameSync(quarantinePath, candidatePath);
          skipped.push({ runId: planned.runId, codes: ["CANDIDATE_CHANGED"] });
        } else {
          recoverable.push({
            runId: planned.runId,
            codes: ["CANDIDATE_CHANGED"],
            quarantineRelativePath: relative(repoRoot, quarantinePath).split("\\").join("/"),
            directoryDevice: quarantinedMetadata.dev,
            directoryInode: quarantinedMetadata.ino,
            telemetrySha256: planned.telemetrySha256,
          });
        }
        continue;
      }
      const quarantinedEvidence = quarantineEvidence(
        repoRoot,
        artifactRoot,
        planned.runId,
        quarantinePath,
        planned.relativePath,
      );
      if (!evidenceMatches(quarantinedEvidence, planned)) {
        if (!existsSync(candidatePath) && quarantinedMetadata.dev === planned.directory.device
          && quarantinedMetadata.ino === planned.directory.inode) {
          renameSync(quarantinePath, candidatePath);
          skipped.push({ runId: planned.runId, codes: ["QUARANTINE_CHANGED"] });
        } else {
          recoverable.push({
            runId: planned.runId,
            codes: ["QUARANTINE_CHANGED"],
            quarantineRelativePath: relative(repoRoot, quarantinePath).split("\\").join("/"),
            directoryDevice: quarantinedMetadata.dev,
            directoryInode: quarantinedMetadata.ino,
            telemetrySha256: planned.telemetrySha256,
          });
        }
        continue;
      }
      lock = markRetentionTransitionQuarantined(lock, quarantinePath);
      if (options.afterQuarantine) {
        releaseLock = false;
        await options.afterQuarantine({ runId: planned.runId, quarantinePath, lock });
        releaseLock = true;
      }
      const finalState = finalValidateAndUnlinkQuarantinedTelemetry({
        artifactRoot,
        planned,
        quarantineParent: planQuarantineRoot,
        quarantinePath,
        lock,
        afterDescriptorOpen: options.afterFinalDescriptorOpen,
      });
      if (finalState === "deleted") {
        deleted.push({
          runId: planned.runId,
          relativePath: planned.relativePath,
          directoryDevice: planned.directory.device,
          directoryInode: planned.directory.inode,
          telemetrySha256: planned.telemetrySha256,
        });
      } else {
        const retained = lstatSync(quarantinePath);
        recoverable.push({
          runId: planned.runId,
          codes: ["QUARANTINE_CHANGED"],
          quarantineRelativePath: relative(repoRoot, quarantinePath).split("\\").join("/"),
          directoryDevice: retained.dev,
          directoryInode: retained.ino,
          telemetrySha256: sha256(readFileSync(join(quarantinePath, ARTIFACT_RETENTION_TELEMETRY_FILENAME))),
        });
      }
    } finally {
      if (releaseLock) releaseTestRunArtifactLock(lock);
    }
  }
  const unsigned = {
    version: ARTIFACT_RETENTION_RECEIPT_VERSION,
    planId: plan.planId,
    planDigest: plan.digest,
    policyId: ARTIFACT_RETENTION_POLICY_ID,
    repository: plan.repository,
    executedAt: now.toISOString(),
    deleted,
    skipped,
    recoverable,
    digest: "",
  } satisfies ArtifactRetentionReceipt;
  const receipt = { ...unsigned, digest: receiptDigest(unsigned) };
  writeControlJson(receiptPath, receipt, receiptRoot);
  if (existsSync(planQuarantineRoot) && readdirSync(planQuarantineRoot).length === 0) rmdirSync(planQuarantineRoot);
  return { receipt, receiptPath };
}

export function verifyArtifactRetention(input: { repoRoot?: string; receiptPath: string }): ArtifactRetentionVerification {
  const repoRoot = getCanonicalRepoRoot(input.repoRoot ?? process.cwd());
  const artifactRoot = assertArtifactRoot(repoRoot);
  const controlRoot = getTestRunRetentionControlRoot(artifactRoot);
  const receiptRoot = join(controlRoot, TEST_RUN_RETENTION_RECEIPT_DIRECTORY);
  const receiptPath = resolve(input.receiptPath);
  if (dirname(receiptPath) !== receiptRoot) throw new Error("Retention receipt path is outside the exact receipt root");
  assertOwnerOnlyControlDirectory(controlRoot, artifactRoot);
  assertOwnerOnlyControlDirectory(receiptRoot, controlRoot);
  assertOwnerOnlyControlFile(receiptPath, receiptRoot);
  const receipt = parseReceipt(JSON.parse(readFileSync(receiptPath, "utf8")));
  if (receipt.repository.root !== repoRoot) throw new Error("Retention receipt repository identity is invalid");
  const deletedPathsGone: string[] = [];
  for (const entry of receipt.deleted) {
    const expected = `tests/artifacts/test-runs/${entry.runId}`;
    if (entry.relativePath !== expected || !UUID_PATTERN.test(entry.runId)) throw new Error("Retention receipt contains a non-canonical deleted path");
    const path = join(repoRoot, entry.relativePath);
    if (optionalLstat(path)) throw new Error(`Retention receipt path still exists: ${entry.runId}`);
    deletedPathsGone.push(entry.relativePath);
  }
  const quarantineRoot = join(controlRoot, TEST_RUN_RETENTION_QUARANTINE_DIRECTORY);
  const planQuarantineRoot = join(quarantineRoot, receipt.planId);
  const expectedRecoverable = new Set(receipt.recoverable.map(({ runId }) => runId));
  const actualEntries = existsSync(planQuarantineRoot) ? readdirSync(planQuarantineRoot).sort() : [];
  if (actualEntries.some((entry) => !expectedRecoverable.has(entry)) || actualEntries.length !== expectedRecoverable.size) {
    throw new Error("Retention quarantine contains unexpected or missing entries");
  }
  const recoverableQuarantines: string[] = [];
  for (const entry of receipt.recoverable) {
    const path = join(planQuarantineRoot, entry.runId);
    const metadata = lstatSync(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.dev !== entry.directoryDevice
      || metadata.ino !== entry.directoryInode
      || sha256(readFileSync(join(path, ARTIFACT_RETENTION_TELEMETRY_FILENAME))) !== entry.telemetrySha256) {
      throw new Error("Recoverable retention quarantine identity changed");
    }
    recoverableQuarantines.push(entry.quarantineRelativePath);
  }
  return {
    verified: true,
    deletedPathsGone,
    recoverableQuarantines,
    quarantineClean: actualEntries.length === receipt.recoverable.length,
  };
}

function argumentValue(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "preview";
  if (!["preview", "report", "execute", "verify"].includes(command)) throw new Error("Usage: test-artifact-retention.ts [preview|report|execute|verify]");
  if (args.some((argument) => ["--force", "--all", "--delete-unowned"].includes(argument))) {
    throw new Error("Artifact retention has no force, all, or delete-unowned mode");
  }
  if ((command === "preview" || command === "report") && args.length > 1) {
    throw new Error(`${command} accepts no options`);
  }
  if (command === "execute") {
    const optionNames = args.slice(1).filter((_, index) => index % 2 === 0);
    if (args.length !== 5 || optionNames.length !== 2
      || new Set(optionNames).size !== 2
      || optionNames.some((name) => name !== "--plan" && name !== "--confirm-sha256")) {
      throw new Error("execute requires exactly --plan and --confirm-sha256");
    }
  }
  if (command === "verify" && (args.length !== 3 || args[1] !== "--receipt")) {
    throw new Error("verify requires exactly --receipt");
  }
  if (command === "preview") {
    process.stdout.write(`${JSON.stringify(await previewArtifactRetention(), null, 2)}\n`);
    return;
  }
  if (command === "report") {
    process.stdout.write(`${JSON.stringify(await reportArtifactRetention(), null, 2)}\n`);
    return;
  }
  if (command === "execute") {
    process.stdout.write(`${JSON.stringify(await executeArtifactRetention({
      planPath: argumentValue(args, "--plan"),
      confirmSha256: argumentValue(args, "--confirm-sha256"),
    }), null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(verifyArtifactRetention({
    receiptPath: argumentValue(args, "--receipt"),
  }), null, 2)}\n`);
}

if (["test-artifact-retention.ts", "test-artifact-retention.js"].includes(basename(process.argv[1] ?? ""))) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

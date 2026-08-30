import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const TEST_RUN_RETENTION_CONTROL_DIRECTORY = ".retention-control";
export const TEST_RUN_RETENTION_PLAN_DIRECTORY = "plans";
export const TEST_RUN_RETENTION_REPORT_DIRECTORY = "reports";
export const TEST_RUN_RETENTION_RECEIPT_DIRECTORY = "receipts";
export const TEST_RUN_RETENTION_QUARANTINE_DIRECTORY = "quarantine";
export const TEST_RUN_RETENTION_LOCK_DIRECTORY = "locks";
export const TEST_RUN_RETENTION_LOCK_FILENAME = "owner.json";
export const TEST_RUN_RETENTION_LOCK_VERSION = 2;
export const TEST_RUN_RETENTION_LOCK_TTL_MS = 60_000;

export type TestRunArtifactLockMode = "writer" | "retention";

interface TestRunArtifactLockOwnerBase {
  version: typeof TEST_RUN_RETENTION_LOCK_VERSION;
  runId: string;
  runNonce: string;
  repoRoot: string;
  pid: number;
  pidStartTime: string;
  acquiredAt: string;
  expiresAt: string;
  token: string;
}

export interface TestRunArtifactWriterLockOwner extends TestRunArtifactLockOwnerBase {
  mode: "writer";
}

export interface TestRunRetentionCandidateBinding {
  relativePath: string;
  directoryDevice: number;
  directoryInode: number;
  telemetryDevice: number;
  telemetryInode: number;
  telemetryLinks: 1;
  telemetryUid: number;
  telemetryMode: number;
  telemetryBytes: number;
  telemetrySha256: string;
}

export interface TestRunRetentionQuarantineBinding {
  phase: "prepared" | "quarantined";
  relativePath: string;
  parentDevice: number;
  parentInode: number;
  directoryDevice: number;
  directoryInode: number;
}

export interface TestRunRetentionLockOwner extends TestRunArtifactLockOwnerBase {
  mode: "retention";
  planId: string;
  planDigest: string;
  candidate: TestRunRetentionCandidateBinding;
  quarantine: TestRunRetentionQuarantineBinding;
}

export type TestRunArtifactLockOwner = TestRunArtifactWriterLockOwner | TestRunRetentionLockOwner;

export interface TestRunArtifactLockToken {
  path: string;
  owner: TestRunArtifactLockOwner;
  device: number;
  inode: number;
  ownerHash: string;
}

export type TestRunArtifactLockInspection =
  | { state: "missing"; path: string }
  | { state: "malformed"; path: string; code: string }
  | { state: "active" | "dead" | "expired"; path: string; owner: TestRunArtifactLockOwner; device: number; inode: number; ownerHash: string };

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function pathIsInside(parent: string, child: string): boolean {
  const fromParent = relative(resolve(parent), resolve(child));
  return fromParent === "" || (!fromParent.startsWith("..") && !isAbsolute(fromParent));
}

function currentUid(): number {
  if (typeof process.getuid !== "function") throw new Error("Run artifact locking requires POSIX ownership checks");
  return process.getuid();
}

function assertOwnerOnlyDirectory(path: string, parent: string, create = false): void {
  if (create && !existsSync(path)) mkdirSync(path, { mode: 0o700 });
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== currentUid()
    || (metadata.mode & 0o077) !== 0 || realpathSync(path) !== resolve(path) || !pathIsInside(parent, path)) {
    throw new Error(`Unsafe retention control directory: ${path}`);
  }
}

function assertCanonicalOwnedDirectory(path: string): void {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== currentUid()
    || realpathSync(path) !== resolve(path)) {
    throw new Error(`Unsafe retention containment root: ${path}`);
  }
}

function ensureOwnerOnlyDirectory(path: string, containmentRoot: string): void {
  const root = resolve(containmentRoot);
  const target = resolve(path);
  if (!pathIsInside(root, target)) throw new Error("Retention control path escaped its containment root");
  assertCanonicalOwnedDirectory(root);
  let cursor = root;
  for (const component of relative(root, target).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, component);
    assertOwnerOnlyDirectory(cursor, root, true);
    chmodSync(cursor, 0o700);
  }
}

function readPidStartTime(pid: number): string | undefined {
  if (process.platform === "win32") return undefined;
  try {
    const value = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closingParen = value.lastIndexOf(")");
    const fields = closingParen < 0 ? [] : value.slice(closingParen + 1).trim().split(/\s+/);
    const startTime = fields[19];
    return startTime && /^\d+$/.test(startTime) ? startTime : undefined;
  } catch {
    return undefined;
  }
}

function validNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseOwner(value: unknown): TestRunArtifactLockOwner {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("LOCK_NOT_OBJECT");
  const owner = value as Partial<TestRunArtifactLockOwner> & Record<string, unknown>;
  const allowed = new Set([
    "version", "runId", "runNonce", "repoRoot", "mode", "pid", "pidStartTime",
    "acquiredAt", "expiresAt", "token", "planId", "planDigest", "candidate", "quarantine",
  ]);
  if (Object.keys(owner).some((key) => !allowed.has(key))
    || owner.version !== TEST_RUN_RETENTION_LOCK_VERSION
    || !isUuid(owner.runId)
    || !isUuid(owner.runNonce)
    || typeof owner.repoRoot !== "string"
    || !isAbsolute(owner.repoRoot)
    || resolve(owner.repoRoot) !== owner.repoRoot
    || (owner.mode !== "writer" && owner.mode !== "retention")
    || typeof owner.pid !== "number"
    || !Number.isSafeInteger(owner.pid)
    || owner.pid <= 1
    || typeof owner.pidStartTime !== "string"
    || !/^\d+$/.test(owner.pidStartTime)
    || !isTimestamp(owner.acquiredAt)
    || !isTimestamp(owner.expiresAt)
    || Date.parse(owner.expiresAt) <= Date.parse(owner.acquiredAt)
    || !isUuid(owner.token)
    || (owner.mode === "writer" && (owner.planId !== undefined || owner.planDigest !== undefined
      || owner.candidate !== undefined || owner.quarantine !== undefined))) {
    throw new Error("LOCK_SCHEMA_INVALID");
  }
  if (owner.mode === "retention") {
    const candidate = owner.candidate as Partial<TestRunRetentionCandidateBinding> & Record<string, unknown> | undefined;
    const quarantine = owner.quarantine as Partial<TestRunRetentionQuarantineBinding> & Record<string, unknown> | undefined;
    if (!isUuid(owner.planId)
      || typeof owner.planDigest !== "string" || !/^[a-f0-9]{64}$/.test(owner.planDigest)
      || !candidate || Object.keys(candidate).some((key) => ![
        "relativePath", "directoryDevice", "directoryInode", "telemetryDevice", "telemetryInode",
        "telemetryLinks", "telemetryUid", "telemetryMode", "telemetryBytes", "telemetrySha256",
      ].includes(key))
      || typeof candidate.relativePath !== "string"
      || !validNonNegativeInteger(candidate.directoryDevice) || !validPositiveInteger(candidate.directoryInode)
      || !validNonNegativeInteger(candidate.telemetryDevice) || !validPositiveInteger(candidate.telemetryInode)
      || candidate.telemetryLinks !== 1 || !validNonNegativeInteger(candidate.telemetryUid)
      || candidate.telemetryMode !== 0o600 || !validNonNegativeInteger(candidate.telemetryBytes)
      || typeof candidate.telemetrySha256 !== "string" || !/^[a-f0-9]{64}$/.test(candidate.telemetrySha256)
      || !quarantine || Object.keys(quarantine).some((key) => ![
        "phase", "relativePath", "parentDevice", "parentInode", "directoryDevice", "directoryInode",
      ].includes(key))
      || (quarantine.phase !== "prepared" && quarantine.phase !== "quarantined")
      || typeof quarantine.relativePath !== "string"
      || !validNonNegativeInteger(quarantine.parentDevice) || !validPositiveInteger(quarantine.parentInode)
      || !validNonNegativeInteger(quarantine.directoryDevice) || !validPositiveInteger(quarantine.directoryInode)) {
      throw new Error("LOCK_SCHEMA_INVALID");
    }
  }
  return owner as TestRunArtifactLockOwner;
}

export function getTestRunRetentionControlRoot(artifactRoot: string): string {
  return join(resolve(artifactRoot), TEST_RUN_RETENTION_CONTROL_DIRECTORY);
}

export function getTestRunRetentionLockRoot(artifactRoot: string): string {
  return join(getTestRunRetentionControlRoot(artifactRoot), TEST_RUN_RETENTION_LOCK_DIRECTORY);
}

export function getTestRunRetentionLockPath(artifactRoot: string, runId: string): string {
  if (!isUuid(runId)) throw new Error("Retention lock run ID must be a UUID");
  return join(getTestRunRetentionLockRoot(artifactRoot), `${runId}.lock`);
}

export function ensureTestRunRetentionControlRoot(artifactRoot: string): string {
  const resolvedArtifactRoot = resolve(artifactRoot);
  ensureOwnerOnlyDirectory(getTestRunRetentionControlRoot(resolvedArtifactRoot), resolvedArtifactRoot);
  return getTestRunRetentionControlRoot(resolvedArtifactRoot);
}

export function ensureTestRunRetentionSubdirectory(artifactRoot: string, name: string): string {
  if (![TEST_RUN_RETENTION_PLAN_DIRECTORY, TEST_RUN_RETENTION_REPORT_DIRECTORY,
    TEST_RUN_RETENTION_RECEIPT_DIRECTORY, TEST_RUN_RETENTION_QUARANTINE_DIRECTORY,
    TEST_RUN_RETENTION_LOCK_DIRECTORY].includes(name)) {
    throw new Error("Unknown retention control subdirectory");
  }
  const controlRoot = ensureTestRunRetentionControlRoot(artifactRoot);
  const path = join(controlRoot, name);
  ensureOwnerOnlyDirectory(path, controlRoot);
  return path;
}

export function inspectTestRunArtifactLock(
  artifactRoot: string,
  runId: string,
  now = Date.now(),
): TestRunArtifactLockInspection {
  const path = getTestRunRetentionLockPath(artifactRoot, runId);
  if (!existsSync(path)) return { state: "missing", path };
  try {
    const lockRoot = getTestRunRetentionLockRoot(artifactRoot);
    assertOwnerOnlyDirectory(lockRoot, getTestRunRetentionControlRoot(artifactRoot));
    const metadata = lstatSync(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== currentUid()
      || (metadata.mode & 0o077) !== 0 || realpathSync(path) !== path) {
      return { state: "malformed", path, code: "LOCK_DIRECTORY_UNSAFE" };
    }
    const entries = readdirSync(path);
    if (entries.length !== 1 || entries[0] !== TEST_RUN_RETENTION_LOCK_FILENAME) {
      return { state: "malformed", path, code: "LOCK_INVENTORY_UNSAFE" };
    }
    const ownerPath = join(path, TEST_RUN_RETENTION_LOCK_FILENAME);
    const ownerMetadata = lstatSync(ownerPath);
    if (!ownerMetadata.isFile() || ownerMetadata.isSymbolicLink() || ownerMetadata.uid !== currentUid()
      || ownerMetadata.nlink !== 1 || (ownerMetadata.mode & 0o077) !== 0 || realpathSync(ownerPath) !== ownerPath
      || ownerMetadata.dev !== metadata.dev) {
      return { state: "malformed", path, code: "LOCK_OWNER_UNSAFE" };
    }
    const raw = readFileSync(ownerPath);
    const owner = parseOwner(JSON.parse(raw.toString("utf8")));
    if (owner.runId !== runId) return { state: "malformed", path, code: "LOCK_IDENTITY_MISMATCH" };
    const common = { path, owner, device: metadata.dev, inode: metadata.ino, ownerHash: sha256(raw) };
    if (Date.parse(owner.expiresAt) <= now) return { state: "expired", ...common };
    return readPidStartTime(owner.pid) === owner.pidStartTime
      ? { state: "active", ...common }
      : { state: "dead", ...common };
  } catch {
    return { state: "malformed", path, code: "LOCK_READ_FAILED" };
  }
}

export function acquireTestRunArtifactWriterLock(input: {
  artifactRoot: string;
  repoRoot: string;
  runId: string;
  runNonce: string;
  now?: Date;
}): TestRunArtifactLockToken {
  if (!isUuid(input.runId) || !isUuid(input.runNonce)) throw new Error("Run artifact lock identity must use UUIDs");
  const artifactRoot = resolve(input.artifactRoot);
  const lockRoot = ensureTestRunRetentionSubdirectory(artifactRoot, TEST_RUN_RETENTION_LOCK_DIRECTORY);
  const path = getTestRunRetentionLockPath(artifactRoot, input.runId);
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("RUN_ARTIFACT_LOCKED");
    throw error;
  }

  try {
    const now = input.now ?? new Date();
    const pidStartTime = readPidStartTime(process.pid);
    if (!pidStartTime) throw new Error("RUN_ARTIFACT_LOCK_PROCESS_UNVERIFIABLE");
    const owner: TestRunArtifactWriterLockOwner = {
      version: TEST_RUN_RETENTION_LOCK_VERSION,
      runId: input.runId,
      runNonce: input.runNonce,
      repoRoot: resolve(input.repoRoot),
      mode: "writer",
      pid: process.pid,
      pidStartTime,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TEST_RUN_RETENTION_LOCK_TTL_MS).toISOString(),
      token: randomUUID(),
    };
    parseOwner(owner);
    const temporaryPath = join(path, `.${TEST_RUN_RETENTION_LOCK_FILENAME}.${owner.token}.tmp`);
    const ownerPath = join(path, TEST_RUN_RETENTION_LOCK_FILENAME);
    writeFileSync(temporaryPath, `${JSON.stringify(owner, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporaryPath, ownerPath);
    const metadata = lstatSync(path);
    const raw = readFileSync(ownerPath);
    return { path, owner, device: metadata.dev, inode: metadata.ino, ownerHash: sha256(raw) };
  } catch (error) {
    for (const entry of readdirSync(path)) unlinkSync(join(path, entry));
    rmdirSync(path);
    throw error;
  }
}

export function releaseTestRunArtifactLock(token: TestRunArtifactLockToken): void {
  const inspection = inspectTestRunArtifactLock(dirname(dirname(dirname(token.path))), token.owner.runId);
  if (inspection.state === "missing") return;
  if (inspection.state === "malformed"
    || inspection.device !== token.device
    || inspection.inode !== token.inode
    || inspection.ownerHash !== token.ownerHash
    || inspection.owner.token !== token.owner.token) {
    throw new Error("RUN_ARTIFACT_LOCK_CHANGED");
  }
  unlinkSync(join(token.path, TEST_RUN_RETENTION_LOCK_FILENAME));
  rmdirSync(token.path);
}

function sameInspection(
  left: Exclude<TestRunArtifactLockInspection, { state: "missing" | "malformed" }>,
  right: TestRunArtifactLockInspection,
): boolean {
  return right.state !== "missing" && right.state !== "malformed"
    && left.device === right.device && left.inode === right.inode && left.ownerHash === right.ownerHash
    && left.owner.token === right.owner.token;
}

export async function stealDeadTestRunArtifactLock(input: {
  artifactRoot: string;
  runId: string;
  noRunActivity: (owner: TestRunArtifactLockOwner) => Promise<boolean>;
  stableDelayMs?: number;
}): Promise<boolean> {
  const first = inspectTestRunArtifactLock(input.artifactRoot, input.runId);
  if (first.state !== "dead" || first.owner.mode !== "writer") return false;
  if (!await input.noRunActivity(first.owner)) return false;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, input.stableDelayMs ?? 25));
  const second = inspectTestRunArtifactLock(input.artifactRoot, input.runId);
  if (second.state !== "dead" || second.owner.mode !== "writer"
    || !sameInspection(first, second) || !await input.noRunActivity(second.owner)) return false;
  unlinkSync(join(second.path, TEST_RUN_RETENTION_LOCK_FILENAME));
  rmdirSync(second.path);
  return true;
}

export function listTestRunRetentionLockEntries(artifactRoot: string): string[] {
  const lockRoot = getTestRunRetentionLockRoot(artifactRoot);
  if (!existsSync(lockRoot)) return [];
  try {
    assertOwnerOnlyDirectory(lockRoot, getTestRunRetentionControlRoot(artifactRoot));
    return readdirSync(lockRoot).sort();
  } catch {
    return ["<malformed-lock-root>"];
  }
}

export function retentionRunIdFromLockEntry(entry: string): string | undefined {
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.lock$/i.exec(basename(entry));
  return match?.[1];
}

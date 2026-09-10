#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readlinkSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  preflightApiAuthentication,
} from "../api-auth.js";
import {
  coordinationCredentialPurpose,
  resolveExtensionBinding,
} from "../extension-binding.js";
import {
  COORDINATION_OUTBOX_AUTHORIZED_OVERFLOW_KEY,
  COORDINATION_OUTBOX_OVERFLOW_AUTHORITY_SHA256,
  CoordinationOutbox,
} from "../coordination-outbox.js";
import { mcpToolData, openMcpToolClient, type McpToolClient } from "../mcp-client.js";
import {
  decodeReplacementFirstRestartRequest,
  isSafeRestartHandoffPath,
  parseRedactedRestartHandoff,
  runReplacementFirstRestart,
  type RedactedRestartHandoff,
  type ReplacementFirstRestartDependencies,
  type ReplacementFirstRestartEvidence,
  type ReplacementFirstRestartRequest,
  type ReplacementFirstRestartResult,
  type RestartProcessIdentity,
} from "../replacement-first-restart.js";
import {
  abortManagedRecoveryReplacement,
  bootstrapLegacyRecoveryOwner,
  commitManagedRecoveryReplacement,
  persistLegacyRecoveryHandoff,
  prepareManagedRecoveryReplacement,
  readLegacyRecoveryHandoff,
  readManagedRecoveryEnrollment,
  readRecoveryServerAuthentication,
  reconcileManagedRecoveryReplacement,
  recoveryServerAuthenticationPath,
  type RecoveryServerAuthentication,
} from "../tui-recovery.js";

const MAX_STATE_BYTES = 64 * 1024;
const MAX_AUTH_BYTES = 1024 * 1024;
const MAX_SESSION_EXPORT_BYTES = 32 * 1024 * 1024;
// Node does not expose Linux O_TMPFILE; the anonymous tmpfs inode keeps the export off disk and gives OpenCode a synchronous stdout.
const LINUX_O_TMPFILE = 0o20000000 | constants.O_DIRECTORY;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,256}$/;
const UNNONCED_PARENT_SHA256 = "0".repeat(64);
const GENERAL_CREDENTIAL_FILE = ".ingenium-mcp-credential";
const REPLACEMENT_SERVER_USERNAME = "opencode";
const LEGACY_HANDOFF_PATH = ".opencode/protected-runtime-index/tui-recovery/legacy-handoff.json";
export const PRODUCTION_RESTART_AUTHORIZED_OVERFLOW_KEY = COORDINATION_OUTBOX_AUTHORIZED_OVERFLOW_KEY;
const OVERFLOW_AUTHORIZATION_LIFETIME_MS = 24 * 60 * 60 * 1_000;
export const RECOVERY_BOOTSTRAP_GUARD = "INGENIUM_RECOVERY_BOOTSTRAP_VERIFIED";
export const RECOVERY_CANONICAL_WORKTREE = "INGENIUM_RECOVERY_CANONICAL_WORKTREE";
export const ADMITTED_RECOVERY_CONTEXT = "INGENIUM_ADMITTED_RECOVERY_CONTEXT";
const DEFAULT_TIMEOUTS: ReplacementFirstRestartRequest["timeouts"] = {
  handoffMs: 5_000,
  launchMs: 30_000,
  identityMs: 5_000,
  healthMs: 60_000,
  sessionMs: 10_000,
  memoryAckMs: 120_000,
  terminalIdleMs: 120_000,
  retirementMs: 10_000,
};

export type ProductionRestartBinding = ReplacementFirstRestartRequest["binding"] & {
  apiUrl: string;
  project: string;
  credentialFile: string;
};

export interface AdmittedRecoveryContext {
  readonly schemaVersion: 1;
  readonly action: "production-restart";
  readonly preflightDigest: string;
  readonly head: string;
  readonly parent: Readonly<RestartProcessIdentity & { sessionId: string }>;
  readonly binding: Readonly<{
    project: string;
    projectId: string;
    workspaceId: string;
    storageMappingHash: string;
    worktree: string;
  }>;
  readonly receipt: Readonly<{
    id: string;
    schema: "ingenium.recovery-admission-receipt";
    version: 1;
    action: "production-restart";
    admissionDigest: string;
    consumedAt: string;
  }>;
}

export interface ProductionRestartParentCandidate {
  binding: ReplacementFirstRestartRequest["binding"];
  oldProcess: RestartProcessIdentity;
  oldPort: number | null;
  oldDataHome: string;
  handoff: RedactedRestartHandoff;
  timeouts: ReplacementFirstRestartRequest["timeouts"];
}

export interface PreparedProductionReplacement<Session> {
  replacement: ReplacementFirstRestartRequest["replacement"];
  dependencies: ReplacementFirstRestartDependencies<Session>;
  release(): Promise<void> | void;
}

export type ProductionRestartCandidateRejectionReason =
  | "malformed"
  | "binding_mismatch"
  | "missing_nonce"
  | "unattested";

export interface ProductionRestartAdapterDependencies<Session> {
  canonicalWorktree(): string;
  resolveBinding(worktree: string): Promise<ProductionRestartBinding>;
  readParentCandidates(worktree: string): Promise<unknown[]> | unknown[];
  retainCandidateRejection(
    worktree: string,
    candidate: unknown,
    reason: ProductionRestartCandidateRejectionReason,
  ): Promise<void> | void;
  enrollParentCandidate?(
    worktree: string,
    binding: ProductionRestartBinding,
  ): Promise<ProductionRestartParentCandidate | undefined>;
  attestParentProcess(parent: ProductionRestartParentCandidate): Promise<boolean> | boolean;
  prepareReplacement(input: {
    worktree: string;
    binding: ProductionRestartBinding;
    parent: ProductionRestartParentCandidate;
  }): Promise<PreparedProductionReplacement<Session>>;
}

interface ReplacementSession {
  id: string;
  initialMessageCount: number;
  captureOffset: number;
  transactionSha256: string;
}

export interface RestartHandoffPublisher {
  client: McpToolClient;
  identity: {
    project: string;
    worktree_id: string;
    session_id: string;
    incarnation: number;
  };
  ownershipToken: string;
  revision: number;
  fence: number;
}

interface RestartCaptureClaim extends RestartHandoffPublisher {
  acceptedEpoch: number;
  operationId: string;
  clientClaimKey: string;
}

interface ProductionPreparedState {
  acknowledgementFile: string;
  child?: ChildProcess;
  captureFile: string;
  evidenceFile: string;
  executable: string;
  expectedExecutableSha256: string;
  expectedVersion: string;
  healthEvidenceFile: string;
  handoffPublisher?: RestartHandoffPublisher;
  logDescriptor: number;
  nonce: string;
  parentStateFile: string;
  parentStateSha256: string;
  port: number;
  reservation: Server;
  runDirectory: string;
  scoutEvidenceFile: string;
  traceFile: string;
  worktree: string;
  binding: ProductionRestartBinding;
  parent: ProductionRestartParentCandidate;
  productionRestartScriptSha256: string;
  serverAuthentication: RecoveryServerAuthentication;
  serverAuthenticationRetained: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isCanonicalRfc3339(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = RFC3339.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    && calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1
    && calendar.getUTCDate() === day && calendar.getUTCHours() === hour
    && calendar.getUTCMinutes() === minute && calendar.getUTCSeconds() === second;
}

export function parseAdmittedRecoveryContext(source: NodeJS.ProcessEnv = process.env): AdmittedRecoveryContext {
  const serialized = source[ADMITTED_RECOVERY_CONTEXT];
  let value: unknown;
  try { value = serialized ? JSON.parse(serialized) : undefined; } catch { value = undefined; }
  if (!hasExactKeys(value, ["schemaVersion", "action", "preflightDigest", "head", "parent", "binding", "receipt"])
    || value.schemaVersion !== 1 || value.action !== "production-restart"
    || typeof value.preflightDigest !== "string" || !SHA256.test(value.preflightDigest)
    || typeof value.head !== "string" || !/^[0-9a-f]{40,64}$/.test(value.head)
    || !hasExactKeys(value.parent, ["pid", "startTimeTicks", "executableSha256", "nonceSha256", "sessionId"])
    || !Number.isSafeInteger(value.parent.pid) || Number(value.parent.pid) < 2
    || !Number.isSafeInteger(value.parent.startTimeTicks) || Number(value.parent.startTimeTicks) < 1
    || typeof value.parent.executableSha256 !== "string" || !SHA256.test(value.parent.executableSha256)
    || typeof value.parent.nonceSha256 !== "string" || !SHA256.test(value.parent.nonceSha256)
    || typeof value.parent.sessionId !== "string" || !SAFE_SESSION_ID.test(value.parent.sessionId)
    || !hasExactKeys(value.binding, ["project", "projectId", "workspaceId", "storageMappingHash", "worktree"])
    || typeof value.binding.project !== "string" || value.binding.project.length < 1 || value.binding.project.length > 64
    || typeof value.binding.projectId !== "string" || !UUID.test(value.binding.projectId)
    || typeof value.binding.workspaceId !== "string"
    || value.binding.workspaceId.length < 1 || value.binding.workspaceId.length > 128
    || typeof value.binding.storageMappingHash !== "string" || !SHA256.test(value.binding.storageMappingHash)
    || typeof value.binding.worktree !== "string" || !isAbsolute(value.binding.worktree)
    || resolve(value.binding.worktree) !== value.binding.worktree
    || !hasExactKeys(value.receipt, ["id", "schema", "version", "action", "admissionDigest", "consumedAt"])
    || typeof value.receipt.id !== "string" || !UUID.test(value.receipt.id)
    || value.receipt.schema !== "ingenium.recovery-admission-receipt"
    || value.receipt.version !== 1 || value.receipt.action !== "production-restart"
    || typeof value.receipt.admissionDigest !== "string" || !SHA256.test(value.receipt.admissionDigest)
    || !isCanonicalRfc3339(value.receipt.consumedAt)) {
    throw new Error("Production restart admitted context is unavailable");
  }
  const context = value as unknown as AdmittedRecoveryContext;
  return Object.freeze({
    ...context,
    parent: Object.freeze({ ...context.parent }),
    binding: Object.freeze({ ...context.binding }),
    receipt: Object.freeze({ ...context.receipt }),
  });
}

function restartIdentitySha256(identity: RestartProcessIdentity): string {
  return hash(JSON.stringify({
    pid: identity.pid,
    startTimeTicks: identity.startTimeTicks,
    executableSha256: identity.executableSha256,
    nonceSha256: identity.nonceSha256,
  }));
}

function handoffCounts(handoff: RedactedRestartHandoff): {
  actionCount: number;
  changedPathCount: number;
  checkCount: number;
} {
  const validated = parseRedactedRestartHandoff(handoff);
  return {
    actionCount: validated.actions.length,
    changedPathCount: validated.changedPaths.length,
    checkCount: validated.checks.length,
  };
}

export function restartHandoffEvidence(handoff: RedactedRestartHandoff, handoffSha256: string): Record<string, unknown> {
  const validated = parseRedactedRestartHandoff(handoff);
  if (hash(JSON.stringify(validated)) !== handoffSha256) throw new Error("Production restart handoff hash changed");
  return { schemaVersion: 1, handoffSha256, ...handoffCounts(validated), handoff: validated };
}

export function typedMemoryAcknowledgementEvidence(input: {
  handoff: RedactedRestartHandoff;
  handoffSha256: string;
  captureFile: string;
  captureOffset: number;
  sessionId: string;
  replacementIdentity: RestartProcessIdentity;
  transactionSha256: string;
}): Record<string, unknown> {
  if (!isAbsolute(input.captureFile) || resolve(input.captureFile) !== input.captureFile
    || !Number.isSafeInteger(input.captureOffset) || input.captureOffset < 0
    || !SAFE_SESSION_ID.test(input.sessionId) || !SHA256.test(input.transactionSha256)) {
    throw new Error("Typed memory acknowledgement evidence is invalid");
  }
  const handoff = restartHandoffEvidence(input.handoff, input.handoffSha256);
  return {
    schemaVersion: 1,
    handoffSha256: input.handoffSha256,
    actionCount: handoff.actionCount,
    changedPathCount: handoff.changedPathCount,
    checkCount: handoff.checkCount,
    captureFile: input.captureFile,
    captureOffset: input.captureOffset,
    successorSessionSha256: hash(input.sessionId),
    replacementIdentitySha256: restartIdentitySha256(input.replacementIdentity),
    transactionSha256: input.transactionSha256,
    assistantResult: "completed",
    terminalStatus: "idle",
  };
}

function exactMode(mode: number, expected: number): boolean {
  return (mode & 0o777) === expected;
}

function processOwner(): number | undefined {
  return process.platform === "win32" || typeof process.getuid !== "function" ? undefined : process.getuid();
}

function productionCredentialPath(worktree: string): string {
  const root = realpathSync(resolve(worktree));
  let configured: string | undefined;
  let inlineCredential = process.env.INGENIUM_MCP_CREDENTIAL;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(join(root, "opencode.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_AUTH_BYTES) throw new Error("invalid config");
    const parsed: unknown = JSON.parse(readFileSync(descriptor, "utf8"));
    const environment = isRecord(parsed) && isRecord(parsed.mcp) && isRecord(parsed.mcp.ingenium)
      && isRecord(parsed.mcp.ingenium.environment) ? parsed.mcp.ingenium.environment : undefined;
    if (environment?.INGENIUM_MCP_CREDENTIAL !== undefined) inlineCredential = String(environment.INGENIUM_MCP_CREDENTIAL);
    if (environment?.INGENIUM_MCP_CREDENTIAL_FILE !== undefined
      && typeof environment.INGENIUM_MCP_CREDENTIAL_FILE !== "string") throw new Error("invalid config");
    if (typeof environment?.INGENIUM_MCP_CREDENTIAL_FILE === "string") configured = environment.INGENIUM_MCP_CREDENTIAL_FILE;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Production restart credential permission bootstrap failed");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (inlineCredential !== undefined) throw new Error("Production restart credential permission bootstrap failed");
  const operationEnvironment = process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE === "general";
  const reference = operationEnvironment
    ? process.env.INGENIUM_MCP_CREDENTIAL_FILE ?? configured ?? `.opencode/${GENERAL_CREDENTIAL_FILE}`
    : configured ?? process.env.INGENIUM_MCP_CREDENTIAL_FILE ?? `.opencode/${GENERAL_CREDENTIAL_FILE}`;
  const credential = resolve(root, reference);
  if (basename(credential) !== GENERAL_CREDENTIAL_FILE
    || (!isAbsolute(reference) && credential !== join(root, ".opencode", GENERAL_CREDENTIAL_FILE))) {
    throw new Error("Production restart credential permission bootstrap failed");
  }
  const parent = lstatSync(dirname(credential));
  const uid = processOwner();
  if (uid === undefined || !parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== uid
    || (parent.mode & 0o022) !== 0 || realpathSync(dirname(credential)) !== dirname(credential)) {
    throw new Error("Production restart credential permission bootstrap failed");
  }
  return credential;
}

interface CredentialPermissionFileSystem {
  closeSync(descriptor: number): void;
  fchmodSync(descriptor: number, mode: number): void;
  fstatSync(descriptor: number): Stats;
  lstatSync(path: string): Stats;
  openSync(path: string, flags: number, mode?: number): number;
}

function sameCredentialMetadata(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.uid === right.uid && left.gid === right.gid
    && left.nlink === right.nlink && left.rdev === right.rdev && left.size === right.size
    && left.blksize === right.blksize && left.blocks === right.blocks && left.atimeMs === right.atimeMs
    && left.mtimeMs === right.mtimeMs && left.birthtimeMs === right.birthtimeMs;
}

export function hardenLegacyProductionCredentialPermissions(
  worktree: string,
  fileSystem: CredentialPermissionFileSystem = { closeSync, fchmodSync, fstatSync, lstatSync, openSync },
): void {
  const credential = productionCredentialPath(worktree);
  const uid = processOwner();
  const before = fileSystem.lstatSync(credential);
  const mode = before.mode & 0o7777;
  if (uid === undefined || !before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== uid
    || (mode & 0o600) !== 0o600 || (mode & 0o022) !== 0 || (mode & 0o7111) !== 0) {
    throw new Error("Production restart credential permission bootstrap failed");
  }
  const descriptor = fileSystem.openSync(credential, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fileSystem.fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.uid !== uid || !sameCredentialMetadata(before, opened)
      || (opened.mode & 0o7777) !== mode) throw new Error("Production restart credential permission bootstrap failed");
    fileSystem.fchmodSync(descriptor, 0o600);
    const hardened = fileSystem.fstatSync(descriptor);
    const current = fileSystem.lstatSync(credential);
    if (!hardened.isFile() || hardened.nlink !== 1 || hardened.uid !== uid || (hardened.mode & 0o7777) !== 0o600
      || !sameCredentialMetadata(opened, hardened) || !current.isFile() || current.isSymbolicLink()
      || (current.mode & 0o7777) !== 0o600 || !sameCredentialMetadata(hardened, current)) {
      throw new Error("Production restart credential permission bootstrap failed");
    }
  } finally {
    fileSystem.closeSync(descriptor);
  }
}

function assertPrivateDirectory(path: string): void {
  const stat = lstatSync(path);
  const uid = processOwner();
  if (!stat.isDirectory() || stat.isSymbolicLink() || !exactMode(stat.mode, 0o700)
    || (uid !== undefined && stat.uid !== uid) || realpathSync(path) !== resolve(path)) {
    throw new Error("Production restart state is unavailable");
  }
}

function assertOwnedDirectory(path: string): void {
  const stat = lstatSync(path);
  const uid = processOwner();
  if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== undefined && stat.uid !== uid)
    || realpathSync(path) !== resolve(path)) throw new Error("Production restart state is unavailable");
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    fchmodSync(descriptor, 0o700);
    const stat = fstatSync(descriptor);
    const uid = processOwner();
    if (!stat.isDirectory() || !exactMode(stat.mode, 0o700) || (uid !== undefined && stat.uid !== uid)) {
      throw new Error("Production restart state is unavailable");
    }
  } finally {
    closeSync(descriptor);
  }
  assertPrivateDirectory(path);
}

interface PrivateFileReader {
  closeSync(descriptor: number): void;
  fstatSync(descriptor: number): Stats;
  lstatSync(path: string): Stats;
  openSync(path: string, flags: number): number;
  readSync(descriptor: number, buffer: Buffer, offset: number, length: number, position: number | null): number;
}

export function readPrivateProductionRestartFile(
  path: string,
  maximumBytes: number,
  fileSystem: PrivateFileReader = {
    closeSync,
    fstatSync,
    lstatSync,
    openSync,
    readSync,
  },
): Buffer {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_SESSION_EXPORT_BYTES) {
    throw new Error("Production restart state is unavailable");
  }
  const before = fileSystem.lstatSync(path);
  const uid = processOwner();
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1
    || before.size > maximumBytes || !exactMode(before.mode, 0o600) || (uid !== undefined && before.uid !== uid)) {
    throw new Error("Production restart state is unavailable");
  }
  const descriptor = fileSystem.openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fileSystem.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1
      || opened.size < 1 || opened.size > maximumBytes || opened.size !== before.size
      || !exactMode(opened.mode, 0o600) || (uid !== undefined && opened.uid !== uid)) {
      throw new Error("Production restart state is unavailable");
    }
    const buffer = Buffer.allocUnsafe(maximumBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const length = fileSystem.readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (length === 0) break;
      offset += length;
    }
    const content = buffer.subarray(0, offset);
    const afterDescriptor = fileSystem.fstatSync(descriptor);
    const afterPath = fileSystem.lstatSync(path);
    if (content.byteLength < 1 || content.byteLength > maximumBytes || content.byteLength !== opened.size
      || afterDescriptor.dev !== opened.dev || afterDescriptor.ino !== opened.ino || afterDescriptor.size !== opened.size
      || afterDescriptor.mtimeMs !== opened.mtimeMs || afterDescriptor.ctimeMs !== opened.ctimeMs
      || !afterPath.isFile() || afterPath.isSymbolicLink() || afterPath.nlink !== 1
      || afterPath.dev !== opened.dev || afterPath.ino !== opened.ino || afterPath.size !== opened.size
      || afterPath.mtimeMs !== opened.mtimeMs || afterPath.ctimeMs !== opened.ctimeMs
      || !exactMode(afterDescriptor.mode, 0o600) || !exactMode(afterPath.mode, 0o600)
      || (uid !== undefined && (afterDescriptor.uid !== uid || afterPath.uid !== uid))) {
      throw new Error("Production restart state is unavailable");
    }
    return content;
  } finally {
    fileSystem.closeSync(descriptor);
  }
}

function writePrivateFile(path: string, value: string): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, value, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    const directory = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function writePrivateNewFile(path: string, value: string): void {
  let descriptor: number | undefined;
  let completed = false;
  try {
    descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, value, "utf8");
    fsyncSync(descriptor);
    completed = true;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (!completed) try { unlinkSync(path); } catch {}
  }
  const directory = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

export function appendProductionRestartEvidence(
  path: string,
  evidence: ReplacementFirstRestartEvidence & { productionRestartScriptSha256?: string },
): void {
  const serialized = `${JSON.stringify(evidence)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_STATE_BYTES) throw new Error("Production restart evidence is too large");
  const descriptor = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    const uid = processOwner();
    if (!stat.isFile() || stat.nlink !== 1 || !exactMode(stat.mode, 0o600) || (uid !== undefined && stat.uid !== uid)) {
      throw new Error("Production restart evidence is unavailable");
    }
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function appendProductionRestartCandidateRejection(
  worktree: string,
  candidate: unknown,
  reason: ProductionRestartCandidateRejectionReason,
): void {
  const serializedCandidate = JSON.stringify(candidate);
  if (serializedCandidate === undefined || Buffer.byteLength(serializedCandidate) > MAX_STATE_BYTES) {
    throw new Error("Production restart candidate rejection is unavailable");
  }
  const record = `${JSON.stringify({
    schemaVersion: 1,
    disposition: "quarantined",
    reason,
    candidateSha256: hash(serializedCandidate),
    identitySha256: hash(JSON.stringify(isRecord(candidate) ? candidate.oldProcess ?? null : null)),
    handoffSha256: hash(JSON.stringify(isRecord(candidate) ? candidate.handoff ?? null : null)),
    occurredAt: new Date().toISOString(),
  })}\n`;
  const directory = createStateDirectory(worktree);
  const descriptor = openSync(
    join(directory, "candidate-rejections.jsonl"),
    constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const stat = fstatSync(descriptor);
    const uid = processOwner();
    if (!stat.isFile() || stat.nlink !== 1 || !exactMode(stat.mode, 0o600) || (uid !== undefined && stat.uid !== uid)) {
      throw new Error("Production restart candidate rejection is unavailable");
    }
    writeFileSync(descriptor, record, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const parent = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(parent); } finally { closeSync(parent); }
}

function writePrivateBuffer(path: string, value: Buffer): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, value);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    value.fill(0);
  }
}

function removeRecoveryServerAuthentication(
  dataHome: string,
  expected?: RecoveryServerAuthentication,
): void {
  const path = recoveryServerAuthenticationPath(dataHome);
  try {
    const current = readRecoveryServerAuthentication(dataHome);
    if (expected && (current.username !== expected.username || current.password !== expected.password)) {
      throw new Error("Recovery server authentication changed");
    }
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT"
      && !["Recovery server authentication is unavailable", "TUI recovery state is unavailable"].includes((error as Error).message)) {
      throw error;
    }
  }
}

function stateDirectory(worktree: string): string {
  const opencode = join(worktree, ".opencode");
  const protectedIndex = join(opencode, "protected-runtime-index");
  const restart = join(protectedIndex, "production-restart");
  assertOwnedDirectory(opencode);
  assertPrivateDirectory(protectedIndex);
  assertPrivateDirectory(restart);
  return restart;
}

function createStateDirectory(worktree: string): string {
  const opencode = join(worktree, ".opencode");
  const protectedIndex = join(opencode, "protected-runtime-index");
  const restart = join(protectedIndex, "production-restart");
  assertOwnedDirectory(opencode);
  assertPrivateDirectory(protectedIndex);
  ensurePrivateDirectory(restart);
  return restart;
}

function stateCandidate(value: unknown): ProductionRestartParentCandidate | undefined {
  if (!hasExactKeys(value, ["binding", "oldProcess", "oldPort", "oldDataHome", "handoff", "timeouts"])
    || !hasExactKeys(value.binding, ["projectId", "workspaceId", "launcherWorktree", "storageMappingHash", "audience"])
    || !hasExactKeys(value.oldProcess, ["pid", "startTimeTicks", "executableSha256", "nonceSha256"])) return undefined;
  return value as unknown as ProductionRestartParentCandidate;
}

export function readProtectedProductionRestartState(worktree: string): unknown[] {
  let serialized: string;
  try {
    serialized = readPrivateProductionRestartFile(join(stateDirectory(worktree), "state.json"), MAX_STATE_BYTES).toString("utf8");
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return [];
    throw error;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new Error("Production restart state is unavailable"); }
  if (!hasExactKeys(parsed, ["schemaVersion", "parentCandidates"]) || parsed.schemaVersion !== 1
    || !Array.isArray(parsed.parentCandidates) || parsed.parentCandidates.length > 2) {
    throw new Error("Production restart state is unavailable");
  }
  return parsed.parentCandidates;
}

function bindingsMatch(left: ReplacementFirstRestartRequest["binding"], right: ProductionRestartBinding): boolean {
  return left.projectId === right.projectId && left.workspaceId === right.workspaceId
    && left.launcherWorktree === right.launcherWorktree && left.storageMappingHash === right.storageMappingHash
    && left.audience === right.audience;
}

function encodeRequest(request: ReplacementFirstRestartRequest): string {
  return Buffer.from(JSON.stringify(request), "utf8").toString("base64url");
}

function validateParentCandidate(
  value: unknown,
  worktree: string,
): ProductionRestartParentCandidate {
  const candidate = stateCandidate(value);
  if (!candidate) throw new Error("Production restart parent candidate is malformed");
  const replacementPort = candidate.oldPort === null ? 65534 : candidate.oldPort === 65535 ? 65534 : candidate.oldPort + 1;
  const nonceSha256 = candidate.oldProcess.nonceSha256 === "0".repeat(64) ? "1".repeat(64) : "0".repeat(64);
  const validated = decodeReplacementFirstRestartRequest(encodeRequest({
    schemaVersion: 1,
    worktree,
    binding: candidate.binding,
    oldProcess: candidate.oldProcess,
    oldPort: candidate.oldPort,
    oldDataHome: candidate.oldDataHome,
    replacement: {
      port: replacementPort,
      dataHome: "/tmp/opencode/.ingenium-production-restart-validation",
      expectedIdentity: { executableSha256: candidate.oldProcess.executableSha256, nonceSha256 },
    },
    handoff: candidate.handoff,
    timeouts: candidate.timeouts,
  }), worktree);
  return {
    binding: validated.binding,
    oldProcess: validated.oldProcess,
    oldPort: validated.oldPort,
    oldDataHome: validated.oldDataHome,
    handoff: validated.handoff,
    timeouts: validated.timeouts,
  };
}

export async function runProductionRestartAdapter<Session>(
  dependencies: ProductionRestartAdapterDependencies<Session>,
  admittedContext?: AdmittedRecoveryContext,
): Promise<ReplacementFirstRestartResult> {
  const worktree = admittedContext?.binding.worktree ?? dependencies.canonicalWorktree();
  const binding = await dependencies.resolveBinding(worktree);
  if (admittedContext && (binding.project !== admittedContext.binding.project
    || binding.projectId !== admittedContext.binding.projectId
    || binding.workspaceId !== admittedContext.binding.workspaceId
    || binding.storageMappingHash !== admittedContext.binding.storageMappingHash
    || binding.launcherWorktree !== admittedContext.binding.worktree || binding.audience !== "mcp")) {
    throw new Error("Production restart binding changed after admission");
  }
  const candidates = await dependencies.readParentCandidates(worktree);
  const admitted: ProductionRestartParentCandidate[] = [];
  const admit = async (value: unknown, requireNonce: boolean): Promise<ProductionRestartParentCandidate | undefined> => {
    let candidate: ProductionRestartParentCandidate;
    try {
      candidate = validateParentCandidate(value, worktree);
    } catch {
      await dependencies.retainCandidateRejection(worktree, value, "malformed");
      return undefined;
    }
    if (!bindingsMatch(candidate.binding, binding)) {
      await dependencies.retainCandidateRejection(worktree, value, "binding_mismatch");
      return undefined;
    }
    if (admittedContext && (candidate.oldProcess.pid !== admittedContext.parent.pid
      || candidate.oldProcess.startTimeTicks !== admittedContext.parent.startTimeTicks
      || candidate.oldProcess.executableSha256 !== admittedContext.parent.executableSha256
      || candidate.oldProcess.nonceSha256 !== admittedContext.parent.nonceSha256)) {
      await dependencies.retainCandidateRejection(worktree, value, "binding_mismatch");
      return undefined;
    }
    if (requireNonce && candidate.oldProcess.nonceSha256 === UNNONCED_PARENT_SHA256) {
      await dependencies.retainCandidateRejection(worktree, value, "missing_nonce");
      return undefined;
    }
    let attested = false;
    try { attested = await dependencies.attestParentProcess(candidate); } catch {}
    if (!attested) {
      await dependencies.retainCandidateRejection(worktree, value, "unattested");
      return undefined;
    }
    return candidate;
  };
  for (const candidate of candidates) {
    const parent = await admit(candidate, true);
    if (parent) admitted.push(parent);
  }
  if (admitted.length > 1) throw new Error("Production restart parent identity is absent or ambiguous");
  let parent = admitted[0];
  if (!parent && !admittedContext && dependencies.enrollParentCandidate) {
    const enrolled = await dependencies.enrollParentCandidate(worktree, binding);
    if (enrolled) parent = await admit(enrolled, false);
  }
  if (!parent) throw new Error("Production restart parent identity is absent or ambiguous");
  const prepared = await dependencies.prepareReplacement({ worktree, binding, parent });
  try {
    const request = decodeReplacementFirstRestartRequest(encodeRequest({
      schemaVersion: 1,
      worktree,
      binding: parent.binding,
      oldProcess: parent.oldProcess,
      oldPort: parent.oldPort,
      oldDataHome: parent.oldDataHome,
      replacement: prepared.replacement,
      handoff: parent.handoff,
      timeouts: parent.timeouts,
    }), worktree);
    return await runReplacementFirstRestart(request, prepared.dependencies);
  } finally {
    await prepared.release();
  }
}

function procStat(pid: number): { parentPid: number; startTimeTicks: number; state: string } | undefined {
  try {
    const source = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = source.lastIndexOf(")");
    if (closeParen < 1) return undefined;
    const fields = source.slice(closeParen + 1).trim().split(/\s+/);
    const parentPid = Number(fields[1]);
    const startTimeTicks = Number(fields[19]);
    const state = fields[0];
    return Number.isSafeInteger(parentPid) && parentPid >= 0 && Number.isSafeInteger(startTimeTicks) && startTimeTicks > 0
      && typeof state === "string" && /^[A-Z]$/.test(state) ? { parentPid, startTimeTicks, state }
      : undefined;
  } catch {
    return undefined;
  }
}

function processEnvironment(pid: number): Record<string, string> | undefined {
  try {
    return Object.fromEntries(readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").filter(Boolean).map((entry) => {
      const separator = entry.indexOf("=");
      return separator > 0 ? [entry.slice(0, separator), entry.slice(separator + 1)] : [entry, ""];
    }));
  } catch {
    return undefined;
  }
}

function inspectProcessIdentity(pid: number, nonceSha256: string, requireProcessNonce: boolean): RestartProcessIdentity | undefined {
  const before = procStat(pid);
  if (!before) return undefined;
  const nonceBefore = processEnvironment(pid)?.INGENIUM_RESTART_NONCE;
  if (requireProcessNonce && (!nonceBefore || hash(nonceBefore) !== nonceSha256)) return undefined;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(`/proc/${pid}/exe`, constants.O_RDONLY);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || (opened.mode & 0o111) === 0) return undefined;
    const executableSha256 = hash(readFileSync(descriptor));
    const afterDescriptor = fstatSync(descriptor);
    const after = procStat(pid);
    const nonceAfter = processEnvironment(pid)?.INGENIUM_RESTART_NONCE;
    if (!after || before.parentPid !== after.parentPid || before.startTimeTicks !== after.startTimeTicks
      || opened.dev !== afterDescriptor.dev || opened.ino !== afterDescriptor.ino || opened.size !== afterDescriptor.size
      || opened.mtimeMs !== afterDescriptor.mtimeMs || opened.ctimeMs !== afterDescriptor.ctimeMs
      || nonceBefore !== nonceAfter) return undefined;
    return { pid, startTimeTicks: before.startTimeTicks, executableSha256, nonceSha256 };
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function inspectExpectedProcessIdentity(identity: RestartProcessIdentity): RestartProcessIdentity | undefined {
  if (identity.nonceSha256 === UNNONCED_PARENT_SHA256
    && processEnvironment(identity.pid)?.INGENIUM_RESTART_NONCE) return undefined;
  const inspected = inspectProcessIdentity(
    identity.pid,
    identity.nonceSha256,
    identity.nonceSha256 !== UNNONCED_PARENT_SHA256,
  );
  return identitiesMatch(inspected, identity) ? inspected : undefined;
}

function identitiesMatch(left: RestartProcessIdentity | undefined, right: RestartProcessIdentity): boolean {
  return left !== undefined && left.pid === right.pid && left.startTimeTicks === right.startTimeTicks
    && left.executableSha256 === right.executableSha256 && left.nonceSha256 === right.nonceSha256;
}

function currentAuthFile(dataHome: string): string {
  return join(dataHome, "opencode", "auth.json");
}

async function reservePort(): Promise<{ port: number; server: Server }> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string" || address.port < 1024) {
    server.close();
    throw new Error("Production restart port reservation failed");
  }
  return { port: address.port, server };
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Operation aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolvePromise();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function processServerAuthentication(pid: number): RecoveryServerAuthentication | undefined {
  const environment = processEnvironment(pid);
  const username = environment?.OPENCODE_SERVER_USERNAME ?? "opencode";
  const password = environment?.OPENCODE_SERVER_PASSWORD;
  return /^[A-Za-z0-9._-]{1,64}$/.test(username) && typeof password === "string"
    && /^[A-Za-z0-9_-]{43,128}$/.test(password) ? { username, password } : undefined;
}

export async function openCodeJsonRequest(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  authentication: RecoveryServerAuthentication,
): Promise<{ status: number; value: unknown }> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Basic ${Buffer.from(`${authentication.username}:${authentication.password}`, "utf8").toString("base64")}`);
  const response = await fetch(url, { ...init, headers, signal });
  return { status: response.status, value: await response.json().catch(() => null) };
}

export interface ReplacementHealthGateEvidence {
  schemaVersion: 1;
  unauthenticatedStatus: number | null;
  unauthenticatedRejected: boolean;
  authenticatedHealthStatus: number | null;
  authenticatedHealthReady: boolean;
  authenticatedAgentStatus: number | null;
  authenticatedAgentReady: boolean;
}

export async function probeReplacementHealthGate(
  baseUrl: string,
  expectedVersion: string,
  authentication: RecoveryServerAuthentication,
  signal: AbortSignal,
): Promise<ReplacementHealthGateEvidence> {
  const evidence: ReplacementHealthGateEvidence = {
    schemaVersion: 1,
    unauthenticatedStatus: null,
    unauthenticatedRejected: false,
    authenticatedHealthStatus: null,
    authenticatedHealthReady: false,
    authenticatedAgentStatus: null,
    authenticatedAgentReady: false,
  };
  const unauthenticated = await fetch(`${baseUrl}/global/health`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(1_000)]),
  });
  evidence.unauthenticatedStatus = unauthenticated.status;
  evidence.unauthenticatedRejected = unauthenticated.status === 401;
  await unauthenticated.body?.cancel();
  if (!evidence.unauthenticatedRejected) return evidence;

  const health = await openCodeJsonRequest(
    `${baseUrl}/global/health`,
    {},
    AbortSignal.any([signal, AbortSignal.timeout(1_000)]),
    authentication,
  );
  const healthValue = responseRecord(health.value);
  evidence.authenticatedHealthStatus = health.status;
  evidence.authenticatedHealthReady = health.status === 200 && healthValue?.healthy === true
    && healthValue.version === expectedVersion;
  if (!evidence.authenticatedHealthReady) return evidence;

  const agents = await openCodeJsonRequest(
    `${baseUrl}/agent`,
    {},
    AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    authentication,
  );
  evidence.authenticatedAgentStatus = agents.status;
  evidence.authenticatedAgentReady = agents.status === 200 && hasScoutCapabilities(agents.value);
  return evidence;
}

function replacementExecutable(pid: number): { path: string; sha256: string } | undefined {
  let descriptor: number | undefined;
  try {
    const linked = readlinkSync(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, "");
    const path = realpathSync(linked);
    const reference = lstatSync(path);
    const uid = processOwner();
    if (basename(path) !== "opencode" || !reference.isFile() || reference.isSymbolicLink() || reference.nlink !== 1
      || (reference.mode & 0o111) === 0 || (reference.mode & 0o022) !== 0
      || (uid !== undefined && reference.uid !== uid && reference.uid !== 0)) return undefined;
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== reference.dev || opened.ino !== reference.ino || opened.nlink !== 1
      || opened.uid !== reference.uid || (opened.mode & 0o111) === 0 || (opened.mode & 0o022) !== 0) return undefined;
    const sha256 = hash(readFileSync(descriptor));
    const after = fstatSync(descriptor);
    const current = lstatSync(path);
    if (opened.dev !== after.dev || opened.ino !== after.ino || opened.size !== after.size
      || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs
      || opened.dev !== current.dev || opened.ino !== current.ino || opened.size !== current.size) return undefined;
    return { path, sha256 };
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function processWorkingDirectory(pid: number): string | undefined {
  try {
    return realpathSync(readlinkSync(`/proc/${pid}/cwd`));
  } catch {
    return undefined;
  }
}

function processCommandLine(pid: number): string[] | undefined {
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`).toString("utf8").split("\0").filter(Boolean);
    return argv.length > 0 ? argv : undefined;
  } catch {
    return undefined;
  }
}

function sessionIdFromCommandLine(argv: string[]): string | undefined {
  const sessions: string[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === "-s" || argv[index] === "--session") {
      if (index + 1 < argv.length) sessions.push(argv[index + 1]!);
      index += 1;
    } else if (argv[index]!.startsWith("--session=")) {
      sessions.push(argv[index]!.slice("--session=".length));
    }
  }
  return sessions.length === 1 && SAFE_SESSION_ID.test(sessions[0]!) ? sessions[0] : undefined;
}

function isProcessAncestor(pid: number): boolean {
  let current = process.ppid;
  for (let depth = 0; depth < 32 && current > 1; depth += 1) {
    if (current === pid) return true;
    const stat = procStat(current);
    if (!stat || stat.parentPid === current) return false;
    current = stat.parentPid;
  }
  return false;
}

function parentDataHome(pid: number): string | undefined {
  const environment = processEnvironment(pid);
  const home = environment?.HOME;
  const candidate = environment?.XDG_DATA_HOME ?? (home ? join(home, ".local", "share") : undefined);
  if (!candidate || resolve(candidate) !== candidate) return undefined;
  try {
    return realpathSync(candidate);
  } catch {
    return undefined;
  }
}

function discoverInteractiveParent(worktree: string): { identity: RestartProcessIdentity; sessionId: string; dataHome: string } | undefined {
  const matches: Array<{ identity: RestartProcessIdentity; sessionId: string; dataHome: string }> = [];
  let pid = process.ppid;
  for (let depth = 0; depth < 32 && pid > 1; depth += 1) {
    const stat = procStat(pid);
    if (!stat) break;
    const argv = processCommandLine(pid);
    const sessionId = argv ? sessionIdFromCommandLine(argv) : undefined;
    if (argv && basename(argv[0]!) === "opencode" && sessionId && processWorkingDirectory(pid) === worktree) {
      const environment = processEnvironment(pid);
      const nonce = environment?.INGENIUM_RESTART_NONCE;
      const nonceSha256 = nonce ? hash(nonce) : UNNONCED_PARENT_SHA256;
      const identity = inspectProcessIdentity(pid, nonceSha256, Boolean(nonce));
      const dataHome = parentDataHome(pid);
      if (identity && dataHome) matches.push({ identity, sessionId, dataHome });
    }
    if (stat.parentPid === pid) break;
    pid = stat.parentPid;
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function isLoopbackAddress(encoded: string): boolean {
  return /^[0-9A-F]{6}7F$/i.test(encoded)
    || encoded.toUpperCase() === "00000000000000000000000001000000"
    || /^0000000000000000FFFF0000[0-9A-F]{6}7F$/i.test(encoded);
}

export function parseListeningLoopbackPorts(source: string): number[] {
  const ports = new Set<number>();
  for (const line of source.trim().split(/\r?\n/).slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4 || fields[3] !== "0A") continue;
    const local = fields[1]!;
    const separator = local.lastIndexOf(":");
    const port = Number.parseInt(local.slice(separator + 1), 16);
    if (separator > 0 && isLoopbackAddress(local.slice(0, separator)) && port >= 1024 && port <= 65535) ports.add(port);
  }
  return [...ports];
}

function listeningLoopbackPorts(): number[] {
  const ports = new Set<number>();
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try { for (const port of parseListeningLoopbackPorts(readFileSync(table, "utf8"))) ports.add(port); } catch { continue; }
  }
  return [...ports];
}

function messageList(value: unknown): unknown[] | undefined {
  const data = isRecord(value) && Object.hasOwn(value, "data") ? value.data : value;
  return Array.isArray(data) ? data : undefined;
}

function responseRecord(value: unknown): Record<string, unknown> | undefined {
  const data = isRecord(value) && Object.hasOwn(value, "data") ? value.data : value;
  return isRecord(data) ? data : undefined;
}

function handoffTodoState(counts: Omit<RedactedRestartHandoff["todos"], "total" | "state">): RedactedRestartHandoff["todos"]["state"] {
  const populated = [counts.pending, counts.inProgress, counts.completed, counts.cancelled].filter((count) => count > 0).length;
  if (populated === 0) return "none";
  if (populated > 1) return "mixed";
  if (counts.pending > 0) return "pending";
  if (counts.inProgress > 0) return "in_progress";
  if (counts.completed > 0) return "complete";
  return "cancelled";
}

function restartCheckName(command: unknown): RedactedRestartHandoff["checks"][number]["name"] | undefined {
  if (typeof command !== "string") return undefined;
  const value = command.toLowerCase();
  if (/\b(typecheck|tsc\b)/.test(value)) return "typecheck";
  if (/\b(eslint|lint\b)/.test(value)) return "lint";
  if (/\b(prettier|format\b)/.test(value)) return "format";
  if (/\b(audit|security|snyk)\b/.test(value)) return "security";
  if (/\b(build|compile)\b/.test(value)) return "build";
  if (/\b(test|vitest|jest|pytest|playwright)\b/.test(value)) return "test";
  if (/^\s*git\s+status(?:\s|$)/.test(value)) return "other";
  return undefined;
}

function restartExitCode(state: Record<string, unknown>): number | null {
  const metadata = isRecord(state.metadata) ? state.metadata : state;
  const value = metadata.exitCode ?? metadata.exit_code ?? metadata.code;
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 255 ? value as number : null;
}

function restartInputPath(input: Record<string, unknown>, worktree: string): string | undefined {
  const candidate = input.filePath ?? input.path;
  if (typeof candidate !== "string") return undefined;
  const path = isAbsolute(candidate) ? relative(worktree, resolve(candidate)) : candidate;
  return isSafeRestartHandoffPath(path) ? path : undefined;
}

function restartInputChanges(
  tool: string,
  input: Record<string, unknown>,
  worktree: string,
): Array<{ path: string; operation: "write" | "edit" }> {
  const path = restartInputPath(input, worktree);
  if (path) return [{ path, operation: tool === "write" || tool === "file_write" ? "write" : "edit" }];
  if (tool !== "apply_patch") return [];
  const patch = input.patchText ?? input.patch;
  if (typeof patch !== "string" || Buffer.byteLength(patch, "utf8") > 1024 * 1024) {
    throw new Error("Production restart patch capture is invalid");
  }
  const changes = [...patch.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)].map((match) => ({
    path: match[2]!,
    operation: match[1] === "Add" ? "write" as const : "edit" as const,
  }));
  if (changes.length === 0 || changes.some((change) => !isSafeRestartHandoffPath(change.path))) {
    throw new Error("Production restart patch capture is invalid");
  }
  return changes;
}

function redactedHandoffFromSession(
  messages: unknown,
  status: unknown,
  session: unknown,
  sessionId: string,
  worktree: string,
): RedactedRestartHandoff | undefined {
  const list = messageList(messages);
  if (!list) return undefined;
  let todos: unknown[] = [];
  for (const message of [...list].reverse()) {
    if (!isRecord(message) || !Array.isArray(message.parts)) continue;
    const part = [...message.parts].reverse().find((entry) => isRecord(entry) && entry.type === "tool"
      && entry.tool === "todowrite" && isRecord(entry.state) && entry.state.status === "completed"
      && isRecord(entry.state.input) && Array.isArray(entry.state.input.todos));
    if (isRecord(part) && isRecord(part.state) && isRecord(part.state.input)) {
      todos = part.state.input.todos as unknown[];
      break;
    }
  }
  const counts = { pending: 0, inProgress: 0, completed: 0, cancelled: 0 };
  for (const todo of todos) {
    if (!isRecord(todo) || !["pending", "in_progress", "completed", "cancelled"].includes(todo.status as string)) return undefined;
    if (todo.status === "in_progress") counts.inProgress += 1;
    else counts[todo.status as "pending" | "completed" | "cancelled"] += 1;
  }
  const current = responseRecord(status)?.[sessionId];
  const rawStatus = isRecord(current) ? current.type ?? current.status : current;
  const open = counts.pending > 0 || counts.inProgress > 0;
  const operationalStatus = rawStatus === "idle" ? "idle"
    : rawStatus === "busy" || rawStatus === "retry" || rawStatus === "working" || open ? "working" : "active";
  const actions: RedactedRestartHandoff["actions"] = [];
  const changed = new Map<string, RedactedRestartHandoff["changedPaths"][number]>();
  const checks: RedactedRestartHandoff["checks"] = [];
  for (const message of list) {
    if (!isRecord(message) || !Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      if (!isRecord(part) || part.type !== "tool" || typeof part.tool !== "string" || !isRecord(part.state)
        || !["completed", "error"].includes(part.state.status as string) || !isRecord(part.state.input)) continue;
      const tool = part.tool.toLowerCase().replace(/[.-]/g, "_");
      const changes = restartInputChanges(tool, part.state.input, worktree);
      const path = changes.length === 1 ? changes[0]!.path : undefined;
      const kind = tool === "read" ? "read" : tool === "grep" || tool === "glob" ? "search"
        : tool === "write" || tool === "file_write" ? "write" : tool === "edit" || tool === "file_edit" ? "edit" : "execute";
      if (part.state.status === "completed") {
        actions.push({
          kind,
          result: "succeeded",
          path: path ?? null,
          targetHash: path ? null : hash(`${tool}\0${JSON.stringify(part.state.input)}`),
        });
      }
      for (const change of changes) {
        if (!["write", "edit", "apply_patch"].includes(tool) && !["file_write", "file_edit"].includes(tool)) continue;
        changed.set(change.path, {
          ...change,
          additions: 0,
          deletions: 0,
          changeRevision: changed.size + 1,
        });
      }
      const name = tool === "bash" ? restartCheckName(part.state.input.command) : undefined;
      if (name) {
        const result = part.state.status === "completed" ? "passed" as const : "failed" as const;
        const checkStatus = result === "passed" ? "completed" as const : "failed" as const;
        const exitCode = restartExitCode(part.state);
        checks.push({
          name,
          status: checkStatus,
          result,
          exitCode,
          targetHash: hash(JSON.stringify({ name, status: checkStatus, result, exitCode,
            sourceTargetHash: hash(`${tool}\0${JSON.stringify(part.state.input)}`) })),
        });
      }
    }
  }
  const sessionValue = responseRecord(session);
  const task = sessionValue?.currentTaskId ?? sessionValue?.current_task_id ?? sessionValue?.taskId ?? sessionValue?.task_id;
  const taskHash = typeof task === "string" && task.length > 0 && task.length <= 512
    && !/[\u0000-\u001f\u007f]/.test(task) ? hash(task) : null;
  const boundedActions = actions.slice(-64);
  const boundedChangedPaths = [...changed.values()].slice(-32);
  const boundedChecks = checks.slice(-32);
  const failed = [...boundedChecks].reverse().find((check) => check.result === "failed");
  const latestCheck = boundedChecks.at(-1);
  const latestAction = boundedActions.at(-1);
  const nextWork = failed ? { kind: "address_failure" as const, referenceHash: failed.targetHash }
    : open ? { kind: "continue_task" as const, referenceHash: taskHash }
      : latestCheck ? { kind: "run_checks" as const, referenceHash: latestCheck.targetHash }
        : latestAction ? { kind: "review_changes" as const, referenceHash: latestAction.targetHash ?? hash(latestAction.path!) }
          : { kind: "none" as const, referenceHash: null };
  return parseRedactedRestartHandoff({
    status: operationalStatus,
    taskHash,
    actions: boundedActions,
    changedPaths: boundedChangedPaths,
    checks: boundedChecks,
    todos: { total: todos.length, ...counts, state: handoffTodoState(counts) },
    nextWork,
  });
}

function hasRunningProductionRestart(messages: unknown): boolean {
  return messageList(messages)?.some((message) => isRecord(message) && Array.isArray(message.parts)
    && message.parts.some((part) => isRecord(part) && part.type === "tool"
      && ["bash", "shell"].includes(String(part.tool).toLowerCase()) && isRecord(part.state)
      && ["pending", "running"].includes(String(part.state.status)) && isRecord(part.state.input)
      && part.state.input.command === "ingenium-build deployment production-restart")) === true;
}

export function redactedHandoffFromExport(
  exported: unknown,
  sessionId: string,
  worktree: string,
): RedactedRestartHandoff | undefined {
  if (!isRecord(exported) || !isRecord(exported.info) || !Array.isArray(exported.messages)
    || exported.info.id !== sessionId || exported.info.directory !== worktree
    || !hasRunningProductionRestart(exported.messages)) return undefined;
  return redactedHandoffFromSession(
    exported.messages,
    { [sessionId]: { type: "working" } },
    exported.info,
    sessionId,
    worktree,
  );
}

function readDurableParentHandoff(
  sessionId: string,
  worktree: string,
  parent: RestartProcessIdentity,
  dataHome: string,
): RedactedRestartHandoff | undefined {
  const environment = processEnvironment(parent.pid);
  if (!environment?.HOME || !isAbsolute(environment.HOME)) return undefined;
  let raw: Buffer | undefined;
  try {
    if (!identitiesMatch(inspectExpectedProcessIdentity(parent), parent)) return undefined;
    const descriptor = openSync("/dev/shm", constants.O_RDWR | constants.O_EXCL | LINUX_O_TMPFILE, 0o600);
    let stderr: Buffer | undefined;
    try {
      const result = spawnSync(`/proc/${parent.pid}/exe`, ["export", sessionId, "--pure"], {
        cwd: worktree,
        encoding: null,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
        stdio: ["ignore", descriptor, "pipe"],
        env: {
          HOME: environment.HOME,
          XDG_DATA_HOME: dataHome,
          PATH: "/usr/local/bin:/usr/bin:/bin",
        },
      });
      stderr = Buffer.isBuffer(result.stderr) ? result.stderr : undefined;
      if (result.error || result.signal || result.status !== 0) return undefined;
      const opened = fstatSync(descriptor);
      if (!opened.isFile() || opened.size < 1 || opened.size > MAX_SESSION_EXPORT_BYTES
        || (opened.mode & 0o077) !== 0 || (typeof process.getuid === "function" && opened.uid !== process.getuid())) return undefined;
      raw = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < raw.length) {
        const count = readSync(descriptor, raw, offset, raw.length - offset, offset);
        if (count === 0) return undefined;
        offset += count;
      }
    } finally {
      stderr?.fill(0);
      closeSync(descriptor);
    }
    const exported = parseProductionSessionExport(raw, sessionId, worktree);
    if (!identitiesMatch(inspectExpectedProcessIdentity(parent), parent)) return undefined;
    return redactedHandoffFromExport(exported, sessionId, worktree);
  } catch {
    return undefined;
  } finally {
    raw?.fill(0);
  }
}

export function parseProductionSessionExport(raw: Buffer, sessionId: string, worktree: string): unknown {
  if (raw.length < 1 || raw.length > MAX_SESSION_EXPORT_BYTES || !SAFE_SESSION_ID.test(sessionId)
    || !isAbsolute(worktree) || resolve(worktree) !== worktree) {
    throw new Error("Production session export framing is invalid");
  }
  const text = raw.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(raw)) throw new Error("Production session export framing is invalid");
  let exported: unknown;
  try {
    exported = JSON.parse(text);
  } catch {
    throw new Error("Production session export framing is invalid");
  }
  if (!hasExactKeys(exported, ["info", "messages"]) || !isRecord(exported.info) || !Array.isArray(exported.messages)) {
    throw new Error("Production session export framing is invalid");
  }
  if (exported.info.id !== sessionId || exported.info.directory !== worktree) {
    throw new Error("Production session export identity is invalid");
  }
  return exported;
}

async function readLiveParentHandoff(
  port: number,
  sessionId: string,
  worktree: string,
  parentPid: number,
): Promise<RedactedRestartHandoff | undefined> {
  const signal = AbortSignal.timeout(5_000);
  try {
    const authentication = processServerAuthentication(parentPid);
    if (!authentication) return undefined;
    const baseUrl = `http://127.0.0.1:${port}`;
    const [health, session, messages, status] = await Promise.all([
      openCodeJsonRequest(`${baseUrl}/global/health`, {}, signal, authentication),
      openCodeJsonRequest(`${baseUrl}/session/${encodeURIComponent(sessionId)}`, {}, signal, authentication),
      openCodeJsonRequest(`${baseUrl}/session/${encodeURIComponent(sessionId)}/message`, {}, signal, authentication),
      openCodeJsonRequest(`${baseUrl}/session/status`, {}, signal, authentication),
    ]);
    const healthValue = responseRecord(health.value);
    const sessionValue = responseRecord(session.value);
    if (health.status !== 200 || healthValue?.healthy !== true || typeof healthValue.version !== "string"
      || session.status !== 200 || sessionValue?.id !== sessionId || sessionValue.directory !== worktree
      || messages.status !== 200 || status.status !== 200) return undefined;
    return redactedHandoffFromSession(messages.value, status.value, session.value, sessionId, worktree);
  } catch {
    return undefined;
  }
}

async function enrollRunningProductionParent(
  worktree: string,
  binding: ProductionRestartBinding,
): Promise<ProductionRestartParentCandidate | undefined> {
  const discovered = discoverInteractiveParent(worktree);
  if (!discovered) return undefined;
  const matches: Array<{ port: number; handoff: RedactedRestartHandoff }> = [];
  for (const port of listeningLoopbackPorts()) {
    const handoff = await readLiveParentHandoff(port, discovered.sessionId, worktree, discovered.identity.pid);
    if (handoff) matches.push({ port, handoff });
  }
  if (matches.length > 1) return undefined;
  const durableHandoff = matches.length === 0
    ? readDurableParentHandoff(
        discovered.sessionId,
        worktree,
        discovered.identity,
        discovered.dataHome,
      )
    : undefined;
  if (matches.length === 0 && !durableHandoff) return undefined;
  const parent: ProductionRestartParentCandidate = {
    binding: {
      projectId: binding.projectId,
      workspaceId: binding.workspaceId,
      launcherWorktree: binding.launcherWorktree,
      storageMappingHash: binding.storageMappingHash,
      audience: "mcp",
    },
    oldProcess: discovered.identity,
    oldPort: matches[0]?.port ?? null,
    oldDataHome: discovered.dataHome,
    handoff: matches[0]?.handoff ?? durableHandoff!,
    timeouts: DEFAULT_TIMEOUTS,
  };
  validateParentCandidate(parent, worktree);
  if (parent.oldPort === null) await persistClaimedLegacyHandoff(worktree, binding, parent, discovered.sessionId);
  await bootstrapLegacyRecoveryOwner(worktree, {
    project: binding.project,
    projectId: binding.projectId,
    workspaceId: binding.workspaceId,
    launcherWorktree: binding.launcherWorktree,
    storageMappingHash: binding.storageMappingHash,
  }, {
    ...parent.oldProcess,
    port: parent.oldPort,
    dataHome: parent.oldDataHome,
  }, parent.handoff);
  return parent;
}

async function attestProductionParent(parent: ProductionRestartParentCandidate): Promise<boolean> {
  if (!identitiesMatch(inspectExpectedProcessIdentity(parent.oldProcess), parent.oldProcess)) return false;
  const argv = processCommandLine(parent.oldProcess.pid);
  const sessionId = argv ? sessionIdFromCommandLine(argv) : undefined;
  const liveHandoff = sessionId && parent.oldPort !== null
    ? await readLiveParentHandoff(parent.oldPort, sessionId, parent.binding.launcherWorktree, parent.oldProcess.pid)
    : undefined;
  const durable = parent.oldPort === null ? readManagedRecoveryEnrollment(parent.binding.launcherWorktree) : undefined;
  return argv !== undefined && basename(argv[0]!) === "opencode"
    && isProcessAncestor(parent.oldProcess.pid) && processWorkingDirectory(parent.oldProcess.pid) === parent.binding.launcherWorktree
    && parentDataHome(parent.oldProcess.pid) === parent.oldDataHome && sessionId !== undefined
    && (parent.oldPort === null
      ? durable !== undefined && identitiesMatch(durable.parent, parent.oldProcess)
        && durable.parent.port === null && durable.parent.dataHome === parent.oldDataHome
        && hash(JSON.stringify(durable.handoff)) === hash(JSON.stringify(parent.handoff))
      : listeningLoopbackPorts().includes(parent.oldPort)
        && liveHandoff !== undefined && hash(JSON.stringify(liveHandoff)) === hash(JSON.stringify(parent.handoff)));
}

export function restartHandoffMemoryEntry(handoff: RedactedRestartHandoff): Record<string, unknown> {
  const validated = parseRedactedRestartHandoff(handoff);
  const pathSegments = (path: string) => path.split("/").map((segment) => Buffer.from(segment, "utf8").toString("base64url"));
  return {
    status: validated.status,
    actions: validated.actions.map((action) => ({
      kind: action.kind,
      result: action.result,
      pathSegments: action.path === null ? null : pathSegments(action.path),
      targetHash: action.targetHash,
    })),
    checks: validated.checks.map((check) => ({ kind: check.name, result: check.result, targetHash: check.targetHash })),
    todos: validated.todos,
    currentTaskId: validated.taskHash === null ? null : `task-${validated.taskHash}`,
    changedPaths: validated.changedPaths.map(({ path, ...entry }) => ({ pathSegments: pathSegments(path), ...entry })),
    nextWork: validated.nextWork,
  };
}

function hasCapturedHandoff(
  path: string,
  expectedHandoff: RedactedRestartHandoff,
  expectedSha256: string,
  offset: number,
): boolean {
  let source: Buffer;
  try { source = readFileSync(path); } catch { return false; }
  if (source.length <= offset) return false;
  if (hash(JSON.stringify(expectedHandoff)) !== expectedSha256) return false;
  const expectedEntry = restartHandoffMemoryEntry(expectedHandoff);
  for (const line of source.subarray(offset).toString("utf8").split(/\r?\n/).filter(Boolean).reverse()) {
    let capture: unknown;
    try { capture = JSON.parse(line); } catch { continue; }
    if (!isRecord(capture) || !Array.isArray(capture.operationalEntries)) continue;
    for (const entry of [...capture.operationalEntries].reverse()) {
      if (!isRecord(entry)) continue;
      const projected = Object.fromEntries(Object.keys(expectedEntry).map((key) => [key, entry[key]]));
      if (JSON.stringify(projected) === JSON.stringify(expectedEntry)) return true;
    }
  }
  return false;
}

function sessionIds(value: unknown): Set<string> | undefined {
  const sessions = messageList(value);
  if (!sessions) return undefined;
  const ids = sessions.map((entry) => isRecord(entry) ? entry.id : undefined);
  return ids.every((id) => typeof id === "string" && SAFE_SESSION_ID.test(id)) ? new Set(ids as string[]) : undefined;
}

function hasScoutCapabilities(value: unknown): boolean {
  const scout = messageList(value)?.find((entry) => isRecord(entry) && entry.name === "ingenium-scout");
  if (!isRecord(scout)) return false;
  const permissions = scout.permission;
  if (!Array.isArray(permissions)) return false;
  const required = ["ingenium_docs_search", "ingenium_docs_get_page", "ingenium_coordination_memory_read"];
  return required.every((permission) => permissions.some((rule: unknown) => isRecord(rule) && rule.permission === permission
    && rule.pattern === "*" && rule.action === "allow"));
}

function restartPublisherMutation(value: unknown): { revision: number; fence: number } {
  if (!isRecord(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || !Number.isSafeInteger(value.fence) || (value.fence as number) < 1) {
    throw new Error("Production restart handoff publication failed");
  }
  return { revision: value.revision as number, fence: value.fence as number };
}

function restartCaptureClaim(value: unknown): {
  revision: number;
  fence: number;
  acceptedEpoch: number;
  operationId: string;
} {
  const mutation = restartPublisherMutation(responseRecord(value)?.session);
  const result = responseRecord(value);
  if (!result || !Number.isSafeInteger(result.acceptedEpoch) || (result.acceptedEpoch as number) < 1
    || typeof result.operationId !== "string" || !UUID.test(result.operationId)) {
    throw new Error("Production restart capture claim failed");
  }
  return {
    ...mutation,
    acceptedEpoch: result.acceptedEpoch as number,
    operationId: result.operationId,
  };
}

function restartCaptureClaimProof(value: unknown): { revision: number; fence: number; acceptedEpoch: number } {
  const result = responseRecord(value);
  const mutation = restartPublisherMutation(result?.session);
  if (!result || !Number.isSafeInteger(result.acceptedEpoch) || (result.acceptedEpoch as number) < 1) {
    throw new Error("Production restart capture claim verification failed");
  }
  return { ...mutation, acceptedEpoch: result.acceptedEpoch as number };
}

function optionalPrivateFileSha256(path: string): string | null {
  try {
    return hash(readPrivateProductionRestartFile(path, MAX_STATE_BYTES));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function persistClaimedLegacyHandoff(
  worktree: string,
  binding: ProductionRestartBinding,
  parent: ProductionRestartParentCandidate,
  parentSessionId: string,
  openClient: typeof openMcpToolClient = openMcpToolClient,
): Promise<void> {
  if (parent.oldPort !== null || !SAFE_SESSION_ID.test(parentSessionId)) {
    throw new Error("Production restart durable capture input is invalid");
  }
  if (!bindingsMatch(parent.binding, binding)) throw new Error("Production restart durable capture binding changed");
  const absolutePath = resolve(worktree, LEGACY_HANDOFF_PATH);
  const beforeSha256 = optionalPrivateFileSha256(absolutePath);
  const client = await openClient(worktree, { project: binding.project, credentialPurpose: "general" });
  const identity = {
    project: binding.project,
    worktree_id: `worktree-${hash(`${binding.workspaceId}\0${binding.storageMappingHash}`)}`,
    session_id: `session-${hash(randomBytes(32))}`,
    incarnation: Date.now(),
  };
  const ownershipToken = randomBytes(32).toString("base64url");
  let publisher: RestartHandoffPublisher | undefined;
  try {
    const registered = responseRecord(mcpToolData(await client.callTool("coordination_update", {
      ...identity,
      operation: "register",
      ownership_token: ownershipToken,
      ttl_ms: 60_000,
      idempotency_key: randomUUID(),
    })));
    const registration = restartPublisherMutation(registered?.session);
    publisher = { client, identity, ownershipToken, ...registration };
    const clientClaimKey = randomBytes(32).toString("base64url");
    const acquired = restartCaptureClaim(mcpToolData(await client.callTool("coordination_claim", {
      ...identity,
      expected_revision: registration.revision,
      fence: registration.fence,
      ownership_token: ownershipToken,
      client_claim_key: clientClaimKey,
      claims: [{
        claim: { kind: "path", path: LEGACY_HANDOFF_PATH },
        baseline_sha256: beforeSha256,
        current_sha256: beforeSha256,
        repository_sha256: null,
      }],
      operation: beforeSha256 === null ? "create" : "edit",
      idempotency_key: randomUUID(),
    })));
    const claim: RestartCaptureClaim = { ...publisher, ...acquired, clientClaimKey };
    publisher = claim;
    const retainedPath = persistLegacyRecoveryHandoff(worktree, {
      project: binding.project,
      projectId: binding.projectId,
      workspaceId: binding.workspaceId,
      launcherWorktree: binding.launcherWorktree,
      storageMappingHash: binding.storageMappingHash,
    }, {
      ...parent.oldProcess,
      port: null,
      dataHome: parent.oldDataHome,
    }, parent.handoff, {
      sessionIdSha256: hash(parentSessionId),
      incarnation: identity.incarnation,
      revision: acquired.revision,
      fence: acquired.fence,
      captureClaimEpoch: acquired.acceptedEpoch,
      captureClaimSha256: hash(`${clientClaimKey}\0${acquired.operationId}`),
    });
    const retained = readLegacyRecoveryHandoff(worktree);
    if (retainedPath !== absolutePath || !retained
      || hash(JSON.stringify(retained.handoff)) !== hash(JSON.stringify(parent.handoff))
      || retained.coordination.captureClaimEpoch !== acquired.acceptedEpoch
      || retained.coordination.captureClaimSha256 !== hash(`${clientClaimKey}\0${acquired.operationId}`)) {
      throw new Error("Production restart durable capture verification failed");
    }
    const verified = restartCaptureClaimProof(mcpToolData(await client.callTool("coordination_claim", {
      ...identity,
      expected_revision: acquired.revision,
      fence: acquired.fence,
      ownership_token: ownershipToken,
      client_claim_key: clientClaimKey,
      accepted_epoch: acquired.acceptedEpoch,
      action: "verify",
      idempotency_key: randomUUID(),
    })));
    if (verified.acceptedEpoch !== acquired.acceptedEpoch || verified.fence !== acquired.fence) {
      throw new Error("Production restart capture claim verification failed");
    }
    const afterSha256 = optionalPrivateFileSha256(absolutePath);
    if (!afterSha256) throw new Error("Production restart durable capture verification failed");
    const completed = restartCaptureClaimProof(mcpToolData(await client.callTool("coordination_claim", {
      ...identity,
      expected_revision: verified.revision,
      fence: verified.fence,
      ownership_token: ownershipToken,
      client_claim_key: clientClaimKey,
      accepted_epoch: acquired.acceptedEpoch,
      action: "complete",
      operation_id: acquired.operationId,
      operation: beforeSha256 === null ? "create" : "edit",
      footprint: [{
        path: LEGACY_HANDOFF_PATH,
        path_sha256: hash(LEGACY_HANDOFF_PATH),
        before_sha256: beforeSha256,
        after_sha256: afterSha256,
      }],
      idempotency_key: randomUUID(),
    })));
    if (completed.acceptedEpoch !== acquired.acceptedEpoch) {
      throw new Error("Production restart capture claim verification failed");
    }
    publisher = { ...publisher, revision: completed.revision, fence: completed.fence };
  } finally {
    if (publisher) await closeRestartHandoffPublisher(publisher, true);
    else await client.close().catch(() => undefined);
  }
}

export async function publishRestartHandoff(
  worktree: string,
  binding: ProductionRestartBinding,
  handoff: RedactedRestartHandoff,
  openClient: typeof openMcpToolClient = openMcpToolClient,
): Promise<RestartHandoffPublisher> {
  const client = await openClient(worktree, { project: binding.project, credentialPurpose: "general" });
  const identity = {
    project: binding.project,
    worktree_id: `worktree-${hash(`${binding.workspaceId}\0${binding.storageMappingHash}`)}`,
    session_id: `session-${hash(randomBytes(32))}`,
    incarnation: Date.now(),
  };
  const ownershipToken = randomBytes(32).toString("base64url");
  let registeredPublisher: RestartHandoffPublisher | undefined;
  let published = false;
  try {
    const registered = responseRecord(mcpToolData(await client.callTool("coordination_update", {
      ...identity,
      operation: "register",
      ownership_token: ownershipToken,
      ttl_ms: 60_000,
      idempotency_key: randomUUID(),
    })));
    const registeredSession = restartPublisherMutation(registered?.session);
    registeredPublisher = { client, identity, ownershipToken, ...registeredSession };
    const response = responseRecord(mcpToolData(await client.callTool("coordination_handoff", {
      ...identity,
      operation: "memory",
      ownership_token: ownershipToken,
      expected_revision: registeredSession.revision,
      fence: registeredSession.fence,
      idempotency_key: randomUUID(),
      memory_entry: {
        ...restartHandoffMemoryEntry(handoff),
      },
    })));
    const publishedSession = restartPublisherMutation(response?.session);
    published = true;
    return { client, identity, ownershipToken, ...publishedSession };
  } finally {
    if (!published) {
      if (registeredPublisher) await closeRestartHandoffPublisher(registeredPublisher, true);
      else await client.close().catch(() => undefined);
    }
  }
}

async function closeRestartHandoffPublisher(publisher: RestartHandoffPublisher, refresh = false): Promise<void> {
  let revision = publisher.revision;
  let fence = publisher.fence;
  if (refresh) {
    try {
      const status = responseRecord(mcpToolData(await publisher.client.callTool("coordination_status", {
        ...publisher.identity,
        ownership_token: publisher.ownershipToken,
      })));
      ({ revision, fence } = restartPublisherMutation(status?.session));
    } catch {}
  }
  await publisher.client.callTool("coordination_update", {
    ...publisher.identity,
    operation: "close",
    ownership_token: publisher.ownershipToken,
    expected_revision: revision,
    fence,
    idempotency_key: randomUUID(),
  }).catch(() => undefined);
  await publisher.client.close().catch(() => undefined);
}

function hasSuccessfulTerminalAssistant(
  value: unknown,
  initialMessageCount: number,
  expectedText: string,
  expectedAgent: string,
): boolean {
  return messageList(value)?.slice(initialMessageCount).some((message) => {
    if (!isRecord(message) || !isRecord(message.info) || message.info.role !== "assistant"
      || message.info.mode !== expectedAgent || message.info.finish !== "stop"
      || message.info.error !== undefined || !Array.isArray(message.parts)) return false;
    const text = message.parts.filter((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
      .map((part) => (part as Record<string, unknown>).text as string).join("").trim();
    return text === expectedText;
  }) === true;
}

async function terminate(identity: RestartProcessIdentity, role: "old" | "replacement", signal: AbortSignal): Promise<void> {
  if (!identitiesMatch(inspectExpectedProcessIdentity(identity), identity)) {
    throw new Error(`${role} process identity changed before signal`);
  }
  try {
    process.kill(identity.pid, "SIGTERM");
    if (procStat(identity.pid)?.state === "T") process.kill(identity.pid, "SIGCONT");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw error;
  }
  while (procStat(identity.pid)) await wait(50, signal);
}

async function quiesce(identity: RestartProcessIdentity, signal: AbortSignal): Promise<void> {
  if (!identitiesMatch(inspectExpectedProcessIdentity(identity), identity)) {
    throw new Error("Old process identity changed before quiescence");
  }
  let signaled = false;
  try {
    process.kill(identity.pid, "SIGSTOP");
    signaled = true;
    while (true) {
      signal.throwIfAborted();
      if (!identitiesMatch(inspectExpectedProcessIdentity(identity), identity)) {
        throw new Error("Old process identity changed during quiescence");
      }
      if (procStat(identity.pid)?.state === "T") return;
      await wait(25, signal);
    }
  } catch (error) {
    if (signaled && identitiesMatch(inspectExpectedProcessIdentity(identity), identity)) {
      try { process.kill(identity.pid, "SIGCONT"); } catch {}
    }
    throw error;
  }
}

async function resume(identity: RestartProcessIdentity, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!identitiesMatch(inspectExpectedProcessIdentity(identity), identity)) {
    throw new Error("Old process identity changed before resume");
  }
  process.kill(identity.pid, "SIGCONT");
}

function overflowAuthorization(now = Date.now()) {
  return {
    schemaVersion: 1 as const,
    authorizationId: COORDINATION_OUTBOX_OVERFLOW_AUTHORITY_SHA256,
    recordKey: PRODUCTION_RESTART_AUTHORIZED_OVERFLOW_KEY,
    mode: "abandon_identityless_overflow" as const,
    authority: "explicit_user_authorization" as const,
    scope: "exact_key_same_record_family" as const,
    reason: "nonrecoverable_identityless_overflow" as const,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + OVERFLOW_AUTHORIZATION_LIFETIME_MS).toISOString(),
  };
}

export function commitProductionRetirement(
  worktree: string,
  transactionSha256: string,
  commit: (subjectWorktree: string, subjectTransactionSha256: string) => void = commitManagedRecoveryReplacement,
): void {
  const outbox = new CoordinationOutbox(worktree);
  outbox.withRetirementFreeze(() => {
    if (outbox.unresolved().some((record) => record.ambiguous || record.kind === "overflow")) {
      throw new Error("Production restart coordination state changed before retirement");
    }
    commit(worktree, transactionSha256);
  });
}

function safeEnvironment(state: ProductionPreparedState, home: string): NodeJS.ProcessEnv {
  return {
    PATH: `${dirname(process.execPath)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    PWD: state.worktree,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    OPENCODE_SERVER_USERNAME: state.serverAuthentication.username,
    OPENCODE_SERVER_PASSWORD: state.serverAuthentication.password,
    INGENIUM_API_URL: state.binding.apiUrl,
    INGENIUM_PROJECT: state.binding.project,
    INGENIUM_PROJECT_ID: state.binding.projectId,
    INGENIUM_WORKSPACE_ID: state.binding.workspaceId,
    INGENIUM_STORAGE_MAPPING_HASH: state.binding.storageMappingHash,
    INGENIUM_WORKTREE: state.worktree,
    INGENIUM_MCP_AUDIENCE: "mcp",
    INGENIUM_MCP_CREDENTIAL_PURPOSE: "general",
    INGENIUM_COORDINATION_TRANSFORM_CAPTURE: "1",
    INGENIUM_COORDINATION_TRANSFORM_CAPTURE_FILE: state.captureFile,
    INGENIUM_COORDINATION_TRACE_FILE: state.traceFile,
    INGENIUM_RESTART_NONCE: state.nonce,
    INGENIUM_RECOVERY_OWNER_NONCE: process.env.INGENIUM_RECOVERY_OWNER_NONCE,
    INGENIUM_RECOVERY_OWNER_PID: process.env.INGENIUM_RECOVERY_OWNER_PID,
    INGENIUM_RECOVERY_OWNER_START_TICKS: process.env.INGENIUM_RECOVERY_OWNER_START_TICKS,
    INGENIUM_OPENCODE_PORT: String(state.port),
  };
}

function productionDependencies(state: ProductionPreparedState): ReplacementFirstRestartDependencies<ReplacementSession> {
  const baseUrl = `http://127.0.0.1:${state.port}`;
  const headers = { "content-type": "application/json" };
  const request = (url: string, init: RequestInit, signal: AbortSignal) =>
    openCodeJsonRequest(url, init, signal, state.serverAuthentication);
  return {
    revalidateBinding: async (expected, worktree, signal) => {
      signal.throwIfAborted();
      try {
        const binding = await resolveProductionBinding(worktree);
        return bindingsMatch(expected, binding)
          && hash(readPrivateProductionRestartFile(state.parentStateFile, MAX_STATE_BYTES)) === state.parentStateSha256;
      } catch {
        return false;
      }
    },
    revalidateProcessIdentity: async (identity, _role, signal) => {
      signal.throwIfAborted();
      return identitiesMatch(inspectExpectedProcessIdentity(identity), identity);
    },
    persistHandoff: async (handoff, handoffSha256, signal) => {
      signal.throwIfAborted();
      writePrivateFile(join(state.runDirectory, "handoff.json"), `${JSON.stringify(restartHandoffEvidence(handoff, handoffSha256))}\n`);
    },
    launchReplacement: async (input, signal) => {
      signal.throwIfAborted();
      await closeServer(state.reservation);
      const child = spawn(state.executable, ["serve", "--hostname", "127.0.0.1", "--port", String(state.port)], {
        cwd: state.worktree,
        detached: true,
        env: safeEnvironment(state, join(state.runDirectory, "home")),
        shell: false,
        stdio: ["ignore", state.logDescriptor, state.logDescriptor],
      });
      state.child = child;
      const pid = child.pid;
      if (!pid) throw new Error("Production replacement did not start");
      const started = procStat(pid);
      if (!started) throw new Error("Production replacement exited before provisional identity binding");
      input.bindProvisionalIdentity({
        pid,
        startTimeTicks: started.startTimeTicks,
        executableSha256: input.expectedIdentity.executableSha256,
        nonceSha256: input.expectedIdentity.nonceSha256,
      });
      while (true) {
        signal.throwIfAborted();
        const identity = inspectProcessIdentity(pid, hash(state.nonce), true);
        if (identity && identity.executableSha256 === state.expectedExecutableSha256) {
          child.unref();
          return identity;
        }
        if (child.exitCode !== null) throw new Error("Production replacement exited before identity attestation");
        await wait(50, signal);
      }
    },
    verifyReplacementHealth: async (_identity, _port, signal) => {
      let diagnostic = {
        schemaVersion: 1,
        stage: "health_request",
        unauthenticatedStatus: null as number | null,
        unauthenticatedRejected: false,
        authenticatedHealthStatus: null as number | null,
        authenticatedHealthReady: false,
        authenticatedAgentStatus: null as number | null,
        authenticatedAgentReady: false,
      };
      try {
        while (true) {
          signal.throwIfAborted();
          try {
            diagnostic = { ...diagnostic, stage: "health_request" };
            const probe = await probeReplacementHealthGate(baseUrl, state.expectedVersion, state.serverAuthentication, signal);
            diagnostic = { ...probe, stage: "health_response" };
            if (probe.unauthenticatedRejected && probe.authenticatedHealthReady && probe.authenticatedAgentReady) {
              writePrivateFile(state.healthEvidenceFile, `${JSON.stringify({ ...diagnostic, result: "passed" })}\n`);
              writePrivateFile(state.scoutEvidenceFile, `${JSON.stringify({
                schemaVersion: 1,
                agent: "ingenium-scout",
                capabilities: ["ingenium_docs_search", "ingenium_docs_get_page", "ingenium_coordination_memory_read"],
                runtimeVersion: state.expectedVersion,
              })}\n`);
              return;
            }
          } catch (error) {
            if (signal.aborted) throw error;
          }
          await wait(100, signal);
        }
      } catch (error) {
        writePrivateFile(state.healthEvidenceFile, `${JSON.stringify({
          ...diagnostic,
          result: signal.aborted ? "timed_out" : "request_failed",
        })}\n`);
        throw error;
      }
    },
    createReplacementSession: async (_identity, _port, transactionSha256, signal) => {
      const before = await request(`${baseUrl}/session`, {}, signal);
      const existingSessionIds = sessionIds(before.value);
      if (before.status !== 200 || !existingSessionIds) throw new Error("Replacement session list is invalid");
      const created = await request(`${baseUrl}/session`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Ingenium replacement-first restart acknowledgement" }),
      }, signal);
      const session = responseRecord(created.value);
      if (created.status !== 200 || typeof session?.id !== "string" || !SAFE_SESSION_ID.test(session.id)
        || existingSessionIds.has(session.id)) {
        throw new Error("Replacement session creation failed");
      }
      const messages = await request(`${baseUrl}/session/${encodeURIComponent(session.id)}/message`, {}, signal);
      const initial = messageList(messages.value);
      if (messages.status !== 200 || !initial) throw new Error("Replacement session messages are invalid");
      return {
        status: "created",
        transactionSha256,
        session: {
          id: session.id,
          initialMessageCount: initial.length,
          captureOffset: readPrivateProductionRestartFile(state.captureFile, MAX_STATE_BYTES).length,
          transactionSha256,
        },
      };
    },
    acknowledgeTypedMemory: async (_identity, session, handoffSha256, transactionSha256, signal) => {
      if (session.transactionSha256 !== transactionSha256) throw new Error("Replacement acknowledgement transaction changed");
      const expectedText = `READY ${transactionSha256}`;
      const prompted = await request(`${baseUrl}/session/${encodeURIComponent(session.id)}/prompt_async`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          agent: "ingenium-scout",
          parts: [{ type: "text", text: `Return only ${expectedText}. Do not use tools.` }],
        }),
      }, signal);
      if (![200, 202, 204].includes(prompted.status)) throw new Error("Replacement acknowledgement prompt failed");
      while (true) {
        signal.throwIfAborted();
        if (hasCapturedHandoff(state.captureFile, state.parent.handoff, handoffSha256, session.captureOffset)) {
          return { status: "acknowledged", handoffSha256, transactionSha256 };
        }
        await wait(100, signal);
      }
    },
    awaitTerminalIdleAcknowledgement: async (identity, session, handoffSha256, transactionSha256, signal) => {
      if (session.transactionSha256 !== transactionSha256) throw new Error("Replacement acknowledgement transaction changed");
      const expectedText = `READY ${transactionSha256}`;
      while (true) {
        signal.throwIfAborted();
        const messagesResponse = await request(`${baseUrl}/session/${encodeURIComponent(session.id)}/message`, {}, signal);
        const messages = messageList(messagesResponse.value);
        const terminal = hasSuccessfulTerminalAssistant(
          messagesResponse.value,
          session.initialMessageCount,
          expectedText,
          "ingenium-scout",
        );
        if (terminal) {
          const statusResponse = await request(`${baseUrl}/session/status`, {}, signal);
          const statuses = responseRecord(statusResponse.value);
          const current = statuses?.[session.id];
          if (statusResponse.status === 200 && statuses
            && (current === undefined || (isRecord(current) && (current.type === "idle" || current.status === "idle")))) {
            writePrivateFile(state.acknowledgementFile, `${JSON.stringify(typedMemoryAcknowledgementEvidence({
              handoff: state.parent.handoff,
              handoffSha256,
              captureFile: state.captureFile,
              captureOffset: session.captureOffset,
              sessionId: session.id,
              replacementIdentity: identity,
              transactionSha256,
            }))}\n`);
            return { status: "idle", handoffSha256, transactionSha256, assistantResult: "completed" };
          }
        }
        await wait(100, signal);
      }
    },
    prepareRecoveryOwner: async (identity, session, handoffSha256, transactionSha256, signal) => {
      await prepareManagedRecoveryReplacement(
        state.worktree,
        state.parent.oldProcess,
        identity,
        state.port,
        join(state.runDirectory, "home", ".local", "share"),
        session.id,
        handoffSha256,
        transactionSha256,
        signal,
      );
      return {
        status: "ready",
        transactionSha256,
        replacementIdentitySha256: restartIdentitySha256(identity),
      };
    },
    quiesceOldProcess: async (identity, signal) => {
      await quiesce(identity, signal);
    },
    resumeOldProcess: async (identity, signal) => {
      await resume(identity, signal);
    },
    prepareRetirement: async (_identity, signal) => {
      signal.throwIfAborted();
      const outbox = new CoordinationOutbox(state.worktree);
      const target = outbox.unresolved().find((record) => record.key === PRODUCTION_RESTART_AUTHORIZED_OVERFLOW_KEY);
      if (!target) return { rollback() {} };
      return outbox.prepareIdentitylessOverflowDisposition(overflowAuthorization());
    },
    commitRetirement: async (transactionSha256, signal) => {
      signal.throwIfAborted();
      commitProductionRetirement(state.worktree, transactionSha256);
      state.serverAuthenticationRetained = true;
    },
    reconcileRetirement: async (transactionSha256, signal) => {
      signal.throwIfAborted();
      const outcome = reconcileManagedRecoveryReplacement(state.worktree, transactionSha256);
      if (outcome !== "not_committed") state.serverAuthenticationRetained = true;
      return outcome;
    },
    abortRecoveryOwner: (transactionSha256) => {
      abortManagedRecoveryReplacement(state.worktree, transactionSha256);
    },
    retireOldProcess: async (identity, signal) => {
      await terminate(identity, "old", signal);
      removeRecoveryServerAuthentication(state.parent.oldDataHome);
    },
    stopReplacement: async (identity, signal) => {
      await terminate(identity, "replacement", signal);
      removeRecoveryServerAuthentication(
        join(state.runDirectory, "home", ".local", "share"),
        state.serverAuthentication,
      );
    },
    persistEvidence: (evidence) => appendProductionRestartEvidence(state.evidenceFile, {
      ...evidence,
      productionRestartScriptSha256: state.productionRestartScriptSha256,
    }),
  };
}

async function resolveProductionBinding(worktree: string): Promise<ProductionRestartBinding> {
  const purpose = coordinationCredentialPurpose();
  if (purpose === "general") hardenLegacyProductionCredentialPermissions(worktree);
  const local = resolveExtensionBinding(worktree, { purpose });
  if (local.audience !== "mcp") throw new Error("Production restart requires an MCP binding");
  const authentication = await preflightApiAuthentication(local.apiUrl, worktree, fetch, {
    credentialPurpose: purpose,
    timeoutMs: 5_000,
  });
  const attested = authentication.binding;
  if (!authentication.authenticated || !attested || attested.audience !== "mcp"
    || !UUID.test(attested.projectId) || !SHA256.test(attested.storageMappingHash)
    || attested.workspaceId !== local.workspaceId || attested.launcherWorktree !== local.launcherWorktree) {
    throw new Error("Production restart binding is unavailable");
  }
  return {
    apiUrl: local.apiUrl,
    project: local.project,
    projectId: attested.projectId,
    workspaceId: attested.workspaceId,
    launcherWorktree: attested.launcherWorktree,
    storageMappingHash: attested.storageMappingHash,
    audience: "mcp",
    credentialFile: local.credentialFile,
  };
}

async function prepareProductionReplacement(input: {
  worktree: string;
  binding: ProductionRestartBinding;
  parent: ProductionRestartParentCandidate;
}, productionRestartScriptSha256: string): Promise<PreparedProductionReplacement<ReplacementSession>> {
  const selectedExecutable = replacementExecutable(input.parent.oldProcess.pid);
  if (!selectedExecutable) throw new Error("Production OpenCode executable is unavailable");
  const { path: executable, sha256: expectedExecutableSha256 } = selectedExecutable;
  const expectedVersion = execFileSync(executable, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    env: { HOME: process.env.HOME, PATH: "/usr/local/bin:/usr/bin:/bin" },
  }).trim();
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(expectedVersion)) {
    throw new Error("Production OpenCode version is invalid");
  }
  const currentParent = inspectExpectedProcessIdentity(input.parent.oldProcess);
  if (!identitiesMatch(currentParent, input.parent.oldProcess)) throw new Error("Production restart parent identity changed");
  const root = createStateDirectory(input.worktree);
  const parentStateFile = join(root, `selected-candidate-${randomUUID()}.json`);
  writePrivateNewFile(parentStateFile, `${JSON.stringify({ schemaVersion: 1, parentCandidates: [input.parent] })}\n`);
  const parentStateSha256 = hash(readPrivateProductionRestartFile(parentStateFile, MAX_STATE_BYTES));
  const uid = processOwner();
  if (uid === undefined) throw new Error("Production restart requires process ownership support");
  const runtimeRoot = `/tmp/opencode-${uid}`;
  ensurePrivateDirectory(runtimeRoot);
  const runDirectory = join(runtimeRoot, `production-restart-${randomUUID()}`);
  ensurePrivateDirectory(runDirectory);
  const home = join(runDirectory, "home");
  const dataHome = join(home, ".local", "share");
  for (const directory of [
    home,
    join(home, ".config"),
    join(home, ".local"),
    join(home, ".local", "share"),
    join(home, ".local", "share", "opencode"),
    join(home, ".local", "state"),
    join(home, ".cache"),
  ]) ensurePrivateDirectory(directory);
  const authSource = readPrivateProductionRestartFile(currentAuthFile(input.parent.oldDataHome), MAX_AUTH_BYTES);
  const authDestination = join(dataHome, "opencode", "auth.json");
  writePrivateBuffer(authDestination, authSource);
  const captureFile = join(runDirectory, "coordination-capture.jsonl");
  writePrivateFile(captureFile, "\n");
  const traceFile = join(runDirectory, "coordination-trace.jsonl");
  writePrivateFile(traceFile, "\n");
  const evidenceFile = join(runDirectory, "phase-history.jsonl");
  writePrivateFile(evidenceFile, "\n");
  const acknowledgementFile = join(runDirectory, "typed-memory-acknowledgement.json");
  const healthEvidenceFile = join(runDirectory, "health-gate.json");
  const scoutEvidenceFile = join(runDirectory, "scout-capabilities.json");
  const logFile = join(runDirectory, "opencode.log");
  const logDescriptor = openSync(logFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const reservation = await reservePort();
  if (reservation.port === input.parent.oldPort) {
    await closeServer(reservation.server);
    closeSync(logDescriptor);
    throw new Error("Production replacement port is not distinct");
  }
  const serverAuthentication: RecoveryServerAuthentication = {
    username: REPLACEMENT_SERVER_USERNAME,
    password: randomBytes(32).toString("base64url"),
  };
  writePrivateNewFile(recoveryServerAuthenticationPath(dataHome), `${JSON.stringify(serverAuthentication)}\n`);
  const nonce = randomBytes(32).toString("base64url");
  const state: ProductionPreparedState = {
    acknowledgementFile,
    captureFile,
    evidenceFile,
    executable,
    expectedExecutableSha256,
    expectedVersion,
    healthEvidenceFile,
    logDescriptor,
    nonce,
    parentStateFile,
    parentStateSha256,
    port: reservation.port,
    reservation: reservation.server,
    runDirectory,
    scoutEvidenceFile,
    traceFile,
    worktree: input.worktree,
    binding: input.binding,
    parent: input.parent,
    productionRestartScriptSha256,
    serverAuthentication,
    serverAuthenticationRetained: false,
  };
  try {
    state.handoffPublisher = await publishRestartHandoff(input.worktree, input.binding, input.parent.handoff);
  } catch (error) {
    await closeServer(reservation.server);
    closeSync(logDescriptor);
    removeRecoveryServerAuthentication(dataHome, serverAuthentication);
    throw error;
  }
  return {
    replacement: {
      port: reservation.port,
      dataHome,
      expectedIdentity: { executableSha256: expectedExecutableSha256, nonceSha256: hash(nonce) },
    },
    dependencies: productionDependencies(state),
    release: async () => {
      if (state.handoffPublisher) await closeRestartHandoffPublisher(state.handoffPublisher);
      await closeServer(reservation.server);
      closeSync(logDescriptor);
      if (!state.serverAuthenticationRetained) {
        removeRecoveryServerAuthentication(dataHome, serverAuthentication);
      }
    },
  };
}

export function productionRestartDependencies(
  productionRestartScriptSha256: string,
): ProductionRestartAdapterDependencies<ReplacementSession> {
  if (!SHA256.test(productionRestartScriptSha256)) throw new Error("Production restart script hash is invalid");
  return {
    canonicalWorktree: () => {
      const worktree = productionRestartCanonicalWorktree();
      if (new CoordinationOutbox(worktree).unresolved().some((record) =>
        (record.ambiguous || record.kind === "overflow")
        && (record.key !== PRODUCTION_RESTART_AUTHORIZED_OVERFLOW_KEY || record.kind !== "overflow"
          || !record.ambiguous || !/^0+$/.test(record.sessionHash) || record.mutation !== null))) {
        throw new Error("Production restart coordination state is ambiguous; ESCALATE_USER without exact epoch evidence");
      }
      return worktree;
    },
    resolveBinding: resolveProductionBinding,
    readParentCandidates: (worktree) => {
      const managed = readManagedRecoveryEnrollment(worktree);
      return managed ? [{
        binding: { ...managed.binding, audience: "mcp" },
        oldProcess: managed.parent,
        oldPort: managed.parent.port,
        oldDataHome: managed.parent.dataHome,
        handoff: managed.handoff,
        timeouts: DEFAULT_TIMEOUTS,
      }] : readProtectedProductionRestartState(worktree);
    },
    retainCandidateRejection: appendProductionRestartCandidateRejection,
    enrollParentCandidate: enrollRunningProductionParent,
    attestParentProcess: attestProductionParent,
    prepareReplacement: (input) => prepareProductionReplacement(input, productionRestartScriptSha256),
  };
}

export function productionRestartCanonicalWorktree(source: NodeJS.ProcessEnv = process.env): string {
  const declared = source[RECOVERY_CANONICAL_WORKTREE];
  const bound = source.INGENIUM_WORKTREE;
  if (!declared || !bound || !isAbsolute(declared) || !isAbsolute(bound)
    || resolve(declared) !== declared || resolve(bound) !== bound) {
    throw new Error("Production restart requires an attested canonical worktree");
  }
  const canonical = realpathSync(declared);
  if (canonical !== declared || realpathSync(bound) !== canonical) {
    throw new Error("Production restart canonical worktree binding changed");
  }
  return canonical;
}

export function verifyProductionRestartScript(
  expectedSha256: string | undefined,
  scriptPath = fileURLToPath(import.meta.url),
): string {
  if (!expectedSha256 || !SHA256.test(expectedSha256)) {
    throw new Error("Production restart requires the verified recovery bootstrap");
  }
  const actualSha256 = hash(readFileSync(realpathSync(scriptPath)));
  if (actualSha256 !== expectedSha256) throw new Error("Production restart script hash changed after bootstrap");
  return actualSha256;
}

export async function runProductionRestartCli(
  dependencies?: ProductionRestartAdapterDependencies<ReplacementSession>,
  scriptPath = fileURLToPath(import.meta.url),
  argv: readonly string[] = process.argv,
): Promise<void> {
  if (argv.length !== 2) throw new Error("Production restart requires the verified recovery bootstrap");
  const expectedSha256 = process.env[RECOVERY_BOOTSTRAP_GUARD];
  delete process.env[RECOVERY_BOOTSTRAP_GUARD];
  const verifiedSha256 = verifyProductionRestartScript(expectedSha256, scriptPath);
  const admittedContext = parseAdmittedRecoveryContext(process.env);
  delete process.env[ADMITTED_RECOVERY_CONTEXT];
  const result = await runProductionRestartAdapter(
    dependencies ?? productionRestartDependencies(verifiedSha256),
    admittedContext,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  await runProductionRestartCli();
}

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CoordinationOutbox } from "./coordination-outbox.js";
import type { ApiAuthenticationBinding } from "./api-auth.js";
import type { ExtensionBinding } from "./extension-binding.js";
import { isValidExtensionProjectName } from "./project-name.js";
import {
  parseRedactedRestartHandoff,
  type RedactedRestartHandoff,
  type RestartProcessIdentity,
} from "./replacement-first-restart.js";

const MAX_STATE_BYTES = 64 * 1024;
const MAX_EVENT_BYTES = 4 * 1024;
const HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,256}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const OWNER_NONCE_ENV = "INGENIUM_RECOVERY_OWNER_NONCE";
const OWNER_PID_ENV = "INGENIUM_RECOVERY_OWNER_PID";
const OWNER_START_ENV = "INGENIUM_RECOVERY_OWNER_START_TICKS";
const PORT_ENV = "INGENIUM_OPENCODE_PORT";

export interface ManagedRecoveryBinding {
  project: string;
  projectId: string;
  workspaceId: string;
  launcherWorktree: string;
  storageMappingHash: string;
}

export type ManagedRecoveryJournalInput = RedactedRestartHandoff;

export interface RecoveryServerAuthentication {
  username: string;
  password: string;
}

export interface ManagedRecoveryEnrollment {
  binding: ManagedRecoveryBinding;
  parent: RestartProcessIdentity & { port: number | null; dataHome: string };
  handoff: RedactedRestartHandoff;
}

export interface LegacyRecoveryCoordination {
  sessionIdSha256: string;
  incarnation: number;
  revision: number;
  fence: number;
  captureClaimEpoch: number;
  captureClaimSha256: string;
}

type RecoveryOwnerIdentity = RestartProcessIdentity;

interface EnrolledParent extends RestartProcessIdentity {
  worktree: string;
  project: string;
  projectId: string;
  workspaceId: string;
  storageMappingHash: string;
  port: number | null;
  dataHome: string;
}

interface EncryptedSession {
  iv: string;
  tag: string;
  value: string;
}

interface PreparedReplacement {
  identity: RestartProcessIdentity;
  port: number;
  dataHome: string;
  transactionSha256: string;
  identitySha256: string;
  session: EncryptedSession;
  ownerReady: boolean;
}

interface RecoveryState {
  schemaVersion: 1;
  owner: RecoveryOwnerIdentity;
  fence: number;
  generation: number;
  phase: "owner_ready" | "enrolled" | "replacement_prepared" | "replacement_committed";
  activeParent: EnrolledParent | null;
  replacement: PreparedReplacement | null;
  updatedAt: string;
}

interface RecoveryJournal extends ManagedRecoveryJournalInput {
  schemaVersion: 1;
  fence: number;
  generation: number;
  phase: RecoveryState["phase"] | "failed";
  transactionSha256: string | null;
  replacementIdentitySha256: string | null;
  boundIdentitySha256: string | null;
  updatedAt: string;
}

interface LegacyOwnerBootstrap {
  schemaVersion: 1;
  worktree: string;
  binding: ManagedRecoveryBinding;
  parent: RestartProcessIdentity & { port: number | null; dataHome: string };
  handoff: RedactedRestartHandoff;
}

export interface LegacyRecoveryHandoff extends ManagedRecoveryEnrollment {
  schemaVersion: 1;
  coordination: LegacyRecoveryCoordination;
}

type RecoveryEventName = "attach_started" | "attach_healthy" | "adoption" | "rollback" | "fence_transition";

interface RecoveryEventDetails {
  attachPid?: number;
  priorFence?: number;
  reason?: "enrollment_timeout" | "precommit_abort" | "replacement_identity_unavailable";
  replacement?: RestartProcessIdentity;
  sessionId?: string;
  transactionSha256?: string;
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function ownerUid(): number | undefined {
  return typeof process.geteuid === "function" ? process.geteuid()
    : typeof process.getuid === "function" ? process.getuid() : undefined;
}

function processStat(pid: number): { parentPid: number; startTimeTicks: number } | undefined {
  try {
    const source = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = source.lastIndexOf(")");
    const fields = source.slice(closeParen + 1).trim().split(/\s+/);
    const parentPid = Number(fields[1]);
    const startTimeTicks = Number(fields[19]);
    return closeParen > 0 && Number.isSafeInteger(parentPid) && parentPid >= 0
      && Number.isSafeInteger(startTimeTicks) && startTimeTicks > 0
      ? { parentPid, startTimeTicks }
      : undefined;
  } catch {
    return undefined;
  }
}

function processIdentity(pid: number, nonceSha256: string, fresh = false): RestartProcessIdentity | undefined {
  const before = processStat(pid);
  if (!before || !HASH.test(nonceSha256)) return undefined;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(`/proc/${pid}/exe`, constants.O_RDONLY);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || (opened.mode & 0o111) === 0) return undefined;
    const executableSha256 = hash(readFileSync(descriptor));
    const afterDescriptor = fstatSync(descriptor);
    const after = processStat(pid);
    if (!after || before.parentPid !== after.parentPid || before.startTimeTicks !== after.startTimeTicks
      || opened.dev !== afterDescriptor.dev || opened.ino !== afterDescriptor.ino || opened.size !== afterDescriptor.size
      || opened.mtimeMs !== afterDescriptor.mtimeMs || opened.ctimeMs !== afterDescriptor.ctimeMs) return undefined;
    const identity = {
      pid,
      startTimeTicks: before.startTimeTicks,
      executableSha256,
      nonceSha256,
    };
    return identity;
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function identitiesMatch(left: RestartProcessIdentity | null | undefined, right: RestartProcessIdentity): boolean {
  return left?.pid === right.pid && left.startTimeTicks === right.startTimeTicks
    && left.executableSha256 === right.executableSha256 && left.nonceSha256 === right.nonceSha256;
}

function identitySha256(identity: RestartProcessIdentity): string {
  return hash(JSON.stringify({
    pid: identity.pid,
    startTimeTicks: identity.startTimeTicks,
    executableSha256: identity.executableSha256,
    nonceSha256: identity.nonceSha256,
  }));
}

function processEnvironmentValue(pid: number, name: string): string | undefined {
  try {
    return readFileSync(`/proc/${pid}/environ`, "utf8").split("\0")
      .find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
  } catch {
    return undefined;
  }
}

function processHasNonce(identity: RestartProcessIdentity): boolean {
  const nonce = processEnvironmentValue(identity.pid, "INGENIUM_RESTART_NONCE");
  return Boolean(nonce) && hash(nonce!) === identity.nonceSha256
    && identitiesMatch(processIdentity(identity.pid, identity.nonceSha256), identity);
}

function processLifetimeMatches(identity: RestartProcessIdentity): boolean {
  return processStat(identity.pid)?.startTimeTicks === identity.startTimeTicks;
}

function processInstanceMatches(identity: RestartProcessIdentity): boolean {
  if (!processLifetimeMatches(identity)) return false;
  const nonce = processEnvironmentValue(identity.pid, "INGENIUM_RESTART_NONCE");
  return identity.nonceSha256 === "0".repeat(64)
    ? nonce === undefined
    : Boolean(nonce) && hash(nonce!) === identity.nonceSha256;
}

function processMatchesAttestedIdentity(identity: RestartProcessIdentity, fresh = false): boolean {
  const nonce = processEnvironmentValue(identity.pid, "INGENIUM_RESTART_NONCE");
  return identitiesMatch(processIdentity(identity.pid, identity.nonceSha256, fresh), identity)
    && (identity.nonceSha256 === "0".repeat(64) ? nonce === undefined : Boolean(nonce) && hash(nonce!) === identity.nonceSha256);
}

function exactPrivateFile(path: string): boolean {
  try {
    const stat = lstatSync(path);
    const uid = ownerUid();
    return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o777) === 0o600
      && (uid === undefined || stat.uid === uid);
  } catch {
    return false;
  }
}

function ensurePrivateDirectory(path: string, parent: string): void {
  mkdirSync(path, { mode: 0o700 });
  const parentStat = lstatSync(parent);
  const stat = lstatSync(path);
  const uid = ownerUid();
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || realpathSync(parent) !== resolve(parent)
    || !stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== resolve(path)
    || dirname(path) !== resolve(parent) || (stat.mode & 0o777) !== 0o700
    || (uid !== undefined && (parentStat.uid !== uid || stat.uid !== uid))) {
    throw new Error("TUI recovery state is unavailable");
  }
}

function recoveryDirectory(worktree: string): string {
  const root = realpathSync(resolve(worktree));
  const protectedRoot = dirname(new CoordinationOutbox(root).directory);
  const directory = join(protectedRoot, "tui-recovery");
  try {
    ensurePrivateDirectory(directory, protectedRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const stat = lstatSync(directory);
    const uid = ownerUid();
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory
      || (stat.mode & 0o777) !== 0o700 || (uid !== undefined && stat.uid !== uid)) throw error;
  }
  return directory;
}

function appendRecoveryEvent(
  worktree: string,
  state: RecoveryState,
  event: RecoveryEventName,
  details: RecoveryEventDetails = {},
): void {
  const replacement = details.replacement ?? state.replacement?.identity;
  const record = {
    schemaVersion: 1,
    event,
    occurredAt: new Date().toISOString(),
    fence: state.fence,
    priorFence: details.priorFence ?? null,
    generation: state.generation,
    ownerPid: state.owner.pid,
    ownerIdentitySha256: identitySha256(state.owner),
    activeParentPid: state.activeParent?.pid ?? null,
    activeParentIdentitySha256: state.activeParent ? identitySha256(state.activeParent) : null,
    replacementPid: replacement?.pid ?? null,
    replacementIdentitySha256: replacement ? identitySha256(replacement) : null,
    attachPid: details.attachPid ?? null,
    transactionSha256: details.transactionSha256 ?? state.replacement?.transactionSha256 ?? null,
    successorSessionSha256: details.sessionId ? hash(details.sessionId) : null,
    reason: details.reason ?? null,
  };
  const serialized = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_EVENT_BYTES) throw new Error("TUI recovery event is too large");
  const directory = recoveryDirectory(worktree);
  const path = join(directory, "events.jsonl");
  const descriptor = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = fstatSync(descriptor);
    const uid = ownerUid();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || (uid !== undefined && stat.uid !== uid)) {
      throw new Error("TUI recovery event history is unavailable");
    }
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const parent = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(parent); } finally { closeSync(parent); }
}

function atomicWrite(path: string, value: unknown): void {
  const serialized = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) throw new Error("TUI recovery state is too large");
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    const directory = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch {}
  }
}

function readJson(path: string): unknown {
  if (!exactPrivateFile(path)) throw new Error("TUI recovery state is unavailable");
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > MAX_STATE_BYTES
      || (stat.mode & 0o777) !== 0o600 || (ownerUid() !== undefined && stat.uid !== ownerUid())) {
      throw new Error("TUI recovery state is unavailable");
    }
    return JSON.parse(readFileSync(descriptor, "utf8"));
  } finally {
    closeSync(descriptor);
  }
}

export function recoveryServerAuthenticationPath(dataHome: string): string {
  return join(realpathSync(resolve(dataHome)), ".ingenium-recovery-server-auth.json");
}

export function readRecoveryServerAuthentication(dataHome: string): RecoveryServerAuthentication {
  const value = readJson(recoveryServerAuthenticationPath(dataHome));
  if (!hasExactKeys(value, ["username", "password"])
    || value.username !== "opencode"
    || typeof value.password !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(value.password)) {
    throw new Error("Recovery server authentication is unavailable");
  }
  return { username: value.username, password: value.password };
}

function removeRecoveryServerAuthentication(dataHome: string): void {
  readRecoveryServerAuthentication(dataHome);
  unlinkSync(recoveryServerAuthenticationPath(dataHome));
}

function withRecoveryMutation<T>(worktree: string, operation: () => T): T {
  const lock = join(recoveryDirectory(worktree), "mutation.lock");
  const identity = processIdentity(process.pid, hash("tui-recovery-mutation"));
  if (!identity) throw new Error("TUI recovery mutation identity is unavailable");
  const deadline = Date.now() + 1_000;
  let descriptor: number | undefined;
  while (descriptor === undefined) {
    try {
      descriptor = openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let prior: RestartProcessIdentity;
      try {
        prior = parseIdentity(readJson(lock));
      } catch {
        if (Date.now() >= deadline) throw new Error("TUI recovery mutation is busy");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        continue;
      }
      if (!processLifetimeMatches(prior)) {
        unlinkSync(lock);
        continue;
      }
      if (Date.now() >= deadline) throw new Error("TUI recovery mutation is busy");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    writeFileSync(descriptor, `${JSON.stringify(identity)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    return operation();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    const held = parseIdentity(readJson(lock));
    if (!identitiesMatch(held, identity)) throw new Error("TUI recovery mutation ownership changed");
    unlinkSync(lock);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function parseIdentity(value: unknown): RestartProcessIdentity {
  if (!isRecord(value) || !Number.isSafeInteger(value.pid) || (value.pid as number) < 2
    || !Number.isSafeInteger(value.startTimeTicks) || (value.startTimeTicks as number) < 1
    || typeof value.executableSha256 !== "string" || !HASH.test(value.executableSha256)
    || typeof value.nonceSha256 !== "string" || !HASH.test(value.nonceSha256)) {
    throw new Error("TUI recovery identity is invalid");
  }
  return value as unknown as RestartProcessIdentity;
}

function parseState(value: unknown): RecoveryState {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.fence)
    || (value.fence as number) < 1 || !Number.isSafeInteger(value.generation) || (value.generation as number) < 1
    || !["owner_ready", "enrolled", "replacement_prepared", "replacement_committed"].includes(String(value.phase))
    || typeof value.updatedAt !== "string") throw new Error("TUI recovery state is invalid");
  const owner = parseIdentity(value.owner);
  const activeParent = value.activeParent === null ? null : value.activeParent as EnrolledParent;
  const replacement = value.replacement === null ? null : value.replacement as PreparedReplacement;
  if (activeParent !== null) {
    parseIdentity(activeParent);
    if (typeof activeParent.worktree !== "string" || resolve(activeParent.worktree) !== activeParent.worktree
      || !isValidExtensionProjectName(activeParent.project)
      || typeof activeParent.projectId !== "string" || !UUID.test(activeParent.projectId)
      || typeof activeParent.workspaceId !== "string" || !SAFE_ID.test(activeParent.workspaceId)
      || typeof activeParent.storageMappingHash !== "string" || !HASH.test(activeParent.storageMappingHash)
      || (activeParent.port !== null
        && (!Number.isSafeInteger(activeParent.port) || activeParent.port < 1024 || activeParent.port > 65535))
      || typeof activeParent.dataHome !== "string" || resolve(activeParent.dataHome) !== activeParent.dataHome) {
      throw new Error("TUI recovery parent is invalid");
    }
  }
  if (replacement !== null) {
    parseIdentity(replacement.identity);
    if (!Number.isSafeInteger(replacement.port) || replacement.port < 1024 || replacement.port > 65535
      || typeof replacement.dataHome !== "string" || resolve(replacement.dataHome) !== replacement.dataHome
      || typeof replacement.transactionSha256 !== "string" || !HASH.test(replacement.transactionSha256)
      || typeof replacement.identitySha256 !== "string" || !HASH.test(replacement.identitySha256)
      || replacement.identitySha256 !== identitySha256(replacement.identity)
      || typeof replacement.ownerReady !== "boolean" || !isRecord(replacement.session)
      || typeof replacement.session.iv !== "string" || replacement.session.iv.length !== 16 || !BASE64URL.test(replacement.session.iv)
      || typeof replacement.session.tag !== "string" || replacement.session.tag.length !== 22 || !BASE64URL.test(replacement.session.tag)
      || typeof replacement.session.value !== "string" || replacement.session.value.length > 342
      || !BASE64URL.test(replacement.session.value)) {
      throw new Error("TUI recovery replacement is invalid");
    }
  }
  if ((value.phase === "owner_ready" && (activeParent !== null || replacement !== null))
    || (value.phase === "enrolled" && (activeParent === null || replacement !== null))
    || ((value.phase === "replacement_prepared" || value.phase === "replacement_committed")
      && (activeParent === null || replacement === null))
    || (value.phase === "replacement_committed" && replacement?.ownerReady !== true)) {
    throw new Error("TUI recovery phase is invalid");
  }
  return { ...value, owner, activeParent, replacement } as RecoveryState;
}

function statePath(worktree: string): string {
  return join(recoveryDirectory(worktree), "state.json");
}

function readState(worktree: string): RecoveryState {
  const canonicalWorktree = realpathSync(resolve(worktree));
  const state = parseState(readJson(statePath(canonicalWorktree)));
  if (state.activeParent && state.activeParent.worktree !== canonicalWorktree) {
    throw new Error("TUI recovery worktree changed");
  }
  return state;
}

export function recordManagedRecoveryAttachEvent(
  worktree: string,
  event: "attach_started" | "attach_healthy",
  attachPid: number,
  sessionId: string,
  transactionSha256: string,
  replacement: RestartProcessIdentity,
): void {
  if (!Number.isSafeInteger(attachPid) || attachPid < 2 || !SAFE_SESSION_ID.test(sessionId)
    || !HASH.test(transactionSha256)) throw new Error("TUI recovery attach event is invalid");
  withRecoveryMutation(worktree, () => {
    const state = readState(worktree);
    if (state.phase !== "replacement_committed" || state.replacement?.transactionSha256 !== transactionSha256
      || !identitiesMatch(state.replacement.identity, replacement)) throw new Error("TUI recovery attach state changed");
    appendRecoveryEvent(worktree, state, event, { attachPid, sessionId, transactionSha256, replacement });
  });
}

function liveOwner(state: RecoveryState): boolean {
  return processLifetimeMatches(state.owner);
}

function currentDataHome(): string | undefined {
  const home = process.env.HOME;
  const candidate = process.env.XDG_DATA_HOME ?? (home ? join(home, ".local", "share") : undefined);
  if (!candidate || resolve(candidate) !== candidate) return undefined;
  try { return realpathSync(candidate); } catch { return undefined; }
}

function journalCoherence(state: RecoveryState): Pick<RecoveryJournal,
"fence" | "generation" | "phase" | "transactionSha256" | "replacementIdentitySha256" | "boundIdentitySha256" | "updatedAt"> {
  return {
    fence: state.fence,
    generation: state.generation,
    phase: state.phase,
    transactionSha256: state.replacement?.transactionSha256 ?? null,
    replacementIdentitySha256: state.replacement?.identitySha256 ?? null,
    boundIdentitySha256: state.activeParent ? identitySha256(state.activeParent) : null,
    updatedAt: new Date().toISOString(),
  };
}

function writeJournal(worktree: string, state: RecoveryState, input: ManagedRecoveryJournalInput | RecoveryJournal): void {
  atomicWrite(join(recoveryDirectory(worktree), "journal.json"), {
    schemaVersion: 1,
    ...input,
    ...journalCoherence(state),
  } satisfies RecoveryJournal);
}

export function readManagedRecoveryEnrollment(worktree: string): ManagedRecoveryEnrollment | undefined {
  try {
    const state = readState(worktree);
    const parent = state.activeParent;
    const journal = readJson(join(recoveryDirectory(worktree), "journal.json")) as RecoveryJournal;
    if (!liveOwner(state) || state.phase !== "enrolled" || !parent || !processMatchesAttestedIdentity(parent)
      || !isRecord(journal) || journal.schemaVersion !== 1
      || !["active", "working", "idle", "completed", "error"].includes(journal.status)
      || !isRecord(journal.todos) || !isRecord(journal.nextWork)
      || journal.fence !== state.fence || journal.generation !== state.generation || journal.phase !== state.phase
      || journal.transactionSha256 !== null || journal.replacementIdentitySha256 !== null
      || journal.boundIdentitySha256 !== identitySha256(parent)) return undefined;
    const handoff = parseRedactedRestartHandoff({
      status: journal.status,
      taskHash: journal.taskHash,
      actions: journal.actions,
      changedPaths: journal.changedPaths,
      checks: journal.checks,
      todos: journal.todos,
      nextWork: journal.nextWork,
    });
    return {
      binding: {
        project: parent.project,
        projectId: parent.projectId,
        workspaceId: parent.workspaceId,
        launcherWorktree: parent.worktree,
        storageMappingHash: parent.storageMappingHash,
      },
      parent: {
        pid: parent.pid,
        startTimeTicks: parent.startTimeTicks,
        executableSha256: parent.executableSha256,
        nonceSha256: parent.nonceSha256,
        port: parent.port,
        dataHome: parent.dataHome,
      },
      handoff,
    };
  } catch {
    return undefined;
  }
}

function managedBinding(binding: ExtensionBinding, attested: ApiAuthenticationBinding): ManagedRecoveryBinding {
  if (attested.audience !== "mcp" || !UUID.test(attested.projectId) || !HASH.test(attested.storageMappingHash)
    || binding.projectId !== undefined && binding.projectId !== attested.projectId
    || attested.workspaceId !== binding.workspaceId || attested.launcherWorktree !== binding.launcherWorktree) {
    throw new Error("TUI recovery binding is invalid");
  }
  return {
    project: binding.project,
    projectId: attested.projectId,
    workspaceId: attested.workspaceId,
    launcherWorktree: attested.launcherWorktree,
    storageMappingHash: attested.storageMappingHash,
  };
}

function ownerFromEnvironment(): { nonce: string; identity: RecoveryOwnerIdentity } | undefined {
  const nonce = process.env[OWNER_NONCE_ENV];
  const pid = Number(process.env[OWNER_PID_ENV]);
  const startTimeTicks = Number(process.env[OWNER_START_ENV]);
  if (!nonce || !/^[A-Za-z0-9_-]{43,128}$/.test(nonce) || !Number.isSafeInteger(pid) || pid < 2
    || !Number.isSafeInteger(startTimeTicks) || startTimeTicks < 1) return undefined;
  const identity = processIdentity(pid, hash(nonce));
  return identity && identity.startTimeTicks === startTimeTicks ? { nonce, identity } : undefined;
}

export function enrollManagedRecoveryParent(
  binding: ExtensionBinding,
  attested: ApiAuthenticationBinding,
  handoff: RedactedRestartHandoff,
): boolean {
  const owner = ownerFromEnvironment();
  const nonce = process.env.INGENIUM_RESTART_NONCE;
  const rawPort = process.env[PORT_ENV];
  const port = Number(rawPort);
  const dataHome = currentDataHome();
  const exactBinding = managedBinding(binding, attested);
  if (!owner || !nonce || !/^[A-Za-z0-9_-]{43,128}$/.test(nonce)
    || !Number.isSafeInteger(port) || port < 1024 || port > 65535 || !dataHome) return false;
  const identity = processIdentity(process.pid, hash(nonce));
  if (!identity) return false;
  const directChild = processStat(process.pid)?.parentPid === owner.identity.pid;
  try {
    return withRecoveryMutation(exactBinding.launcherWorktree, () => {
      const state = readState(exactBinding.launcherWorktree);
      if (!liveOwner(state) || !identitiesMatch(state.owner, owner.identity)) return false;
      if (state.activeParent && processInstanceMatches(state.activeParent)) {
        if (!identitiesMatch(state.activeParent, identity)) {
          if (directChild) throw new Error("TUI recovery parent fence is occupied");
          return false;
        }
        if (state.activeParent.project !== exactBinding.project || state.activeParent.projectId !== exactBinding.projectId
          || state.activeParent.workspaceId !== exactBinding.workspaceId
          || state.activeParent.storageMappingHash !== exactBinding.storageMappingHash
          || state.activeParent.worktree !== exactBinding.launcherWorktree
          || state.activeParent.port !== port || state.activeParent.dataHome !== dataHome) {
          throw new Error("TUI recovery parent binding changed");
        }
        return true;
      }
      if (!directChild) return false;
      const next: RecoveryState = {
        schemaVersion: 1,
        owner: owner.identity,
        fence: state.fence + 1,
        generation: state.generation + 1,
        phase: "enrolled",
        activeParent: { ...identity, ...exactBinding, worktree: exactBinding.launcherWorktree, port, dataHome },
        replacement: null,
        updatedAt: new Date().toISOString(),
      };
      atomicWrite(statePath(exactBinding.launcherWorktree), next);
      writeJournal(exactBinding.launcherWorktree, next, handoff);
      appendRecoveryEvent(exactBinding.launcherWorktree, next, "fence_transition", { priorFence: state.fence });
      return true;
    });
  } catch (error) {
    if (error instanceof Error && ["TUI recovery parent fence is occupied", "TUI recovery parent binding changed"].includes(error.message)) {
      throw error;
    }
    return false;
  }
}

export function persistLegacyRecoveryHandoff(
  worktree: string,
  binding: ManagedRecoveryBinding,
  parent: RestartProcessIdentity & { port: null; dataHome: string },
  handoff: RedactedRestartHandoff,
  coordination: LegacyRecoveryCoordination,
): string {
  const canonicalWorktree = realpathSync(resolve(worktree));
  const validatedHandoff = parseRedactedRestartHandoff(handoff);
  if (binding.launcherWorktree !== canonicalWorktree || !isValidExtensionProjectName(binding.project)
    || !UUID.test(binding.projectId) || !SAFE_ID.test(binding.workspaceId) || !HASH.test(binding.storageMappingHash)
    || resolve(parent.dataHome) !== parent.dataHome || !processMatchesAttestedIdentity(parseIdentity(parent), true)
    || !HASH.test(coordination.sessionIdSha256) || !Number.isSafeInteger(coordination.incarnation)
    || coordination.incarnation < 1 || !Number.isSafeInteger(coordination.revision) || coordination.revision < 0
    || !Number.isSafeInteger(coordination.fence) || coordination.fence < 1
    || !Number.isSafeInteger(coordination.captureClaimEpoch) || coordination.captureClaimEpoch < 1
    || !HASH.test(coordination.captureClaimSha256)) {
    throw new Error("Legacy recovery handoff is invalid");
  }
  const path = join(recoveryDirectory(canonicalWorktree), "legacy-handoff.json");
  atomicWrite(path, {
    schemaVersion: 1,
    binding,
    parent,
    handoff: validatedHandoff,
    coordination,
  } satisfies LegacyRecoveryHandoff);
  return path;
}

export function readLegacyRecoveryHandoff(worktree: string): LegacyRecoveryHandoff | undefined {
  try {
    const canonicalWorktree = realpathSync(resolve(worktree));
    const value = readJson(join(recoveryDirectory(canonicalWorktree), "legacy-handoff.json"));
    if (!hasExactKeys(value, ["schemaVersion", "binding", "parent", "handoff", "coordination"])
      || value.schemaVersion !== 1
      || !hasExactKeys(value.binding, ["project", "projectId", "workspaceId", "launcherWorktree", "storageMappingHash"])
      || !hasExactKeys(value.parent, ["pid", "startTimeTicks", "executableSha256", "nonceSha256", "port", "dataHome"])
      || !hasExactKeys(value.coordination, [
        "sessionIdSha256", "incarnation", "revision", "fence", "captureClaimEpoch", "captureClaimSha256",
      ])) return undefined;
    const parent = parseIdentity(value.parent);
    const coordination = value.coordination;
    if (value.binding.launcherWorktree !== canonicalWorktree || !isValidExtensionProjectName(value.binding.project)
      || typeof value.binding.projectId !== "string" || !UUID.test(value.binding.projectId)
      || typeof value.binding.workspaceId !== "string" || !SAFE_ID.test(value.binding.workspaceId)
      || typeof value.binding.storageMappingHash !== "string" || !HASH.test(value.binding.storageMappingHash)
      || value.parent.port !== null || typeof value.parent.dataHome !== "string"
      || resolve(value.parent.dataHome) !== value.parent.dataHome
      || typeof coordination.sessionIdSha256 !== "string" || !HASH.test(coordination.sessionIdSha256)
      || !Number.isSafeInteger(coordination.incarnation) || (coordination.incarnation as number) < 1
      || !Number.isSafeInteger(coordination.revision) || (coordination.revision as number) < 0
      || !Number.isSafeInteger(coordination.fence) || (coordination.fence as number) < 1
      || !Number.isSafeInteger(coordination.captureClaimEpoch) || (coordination.captureClaimEpoch as number) < 1
      || typeof coordination.captureClaimSha256 !== "string" || !HASH.test(coordination.captureClaimSha256)
      || !processMatchesAttestedIdentity(parent, true)) return undefined;
    return {
      schemaVersion: 1,
      binding: {
        project: value.binding.project,
        projectId: value.binding.projectId,
        workspaceId: value.binding.workspaceId,
        launcherWorktree: canonicalWorktree,
        storageMappingHash: value.binding.storageMappingHash,
      },
      parent: { ...parent, port: null, dataHome: value.parent.dataHome },
      handoff: parseRedactedRestartHandoff(value.handoff),
      coordination: coordination as unknown as LegacyRecoveryCoordination,
    };
  } catch {
    return undefined;
  }
}

export function persistManagedRecoveryJournal(worktree: string, input: ManagedRecoveryJournalInput): boolean {
  try {
    return withRecoveryMutation(worktree, () => {
      const state = readState(worktree);
      if (!liveOwner(state) || !state.activeParent || state.activeParent.pid !== process.pid
        || !processInstanceMatches(state.activeParent)) return false;
      writeJournal(worktree, state, input);
      return true;
    });
  } catch {
    return false;
  }
}

function encryptSession(sessionId: string, ownerNonce: string): EncryptedSession {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(ownerNonce).digest(), iv);
  const value = Buffer.concat([cipher.update(sessionId, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), value: value.toString("base64url") };
}

function decryptSession(session: EncryptedSession, ownerNonce: string): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256").update(ownerNonce).digest(),
    Buffer.from(session.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(session.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(session.value, "base64url")), decipher.final()]).toString("utf8");
}

export async function prepareManagedRecoveryReplacement(
  worktree: string,
  oldParent: RestartProcessIdentity,
  replacement: RestartProcessIdentity,
  port: number,
  dataHome: string,
  sessionId: string,
  handoffSha256: string,
  transactionSha256: string,
  signal: AbortSignal,
): Promise<void> {
  const owner = ownerFromEnvironment();
  if (!owner || !HASH.test(handoffSha256) || !HASH.test(transactionSha256)) throw new Error("TUI recovery owner is unavailable");
  withRecoveryMutation(worktree, () => {
    const state = readState(worktree);
    if (!liveOwner(state) || !identitiesMatch(state.owner, owner.identity) || !state.activeParent
      || !identitiesMatch(state.activeParent, oldParent)
      || state.phase !== "enrolled") {
      throw new Error("TUI recovery enrollment changed");
    }
    const preparedJournal = readJson(join(recoveryDirectory(worktree), "journal.json")) as RecoveryJournal;
    const durableHandoff = {
      status: preparedJournal.status,
      taskHash: preparedJournal.taskHash,
      actions: preparedJournal.actions,
      changedPaths: preparedJournal.changedPaths,
      checks: preparedJournal.checks,
      todos: preparedJournal.todos,
      nextWork: preparedJournal.nextWork,
    };
    if (hash(JSON.stringify(durableHandoff)) !== handoffSha256) throw new Error("TUI recovery handoff changed");
    const replacementSha256 = identitySha256(replacement);
    if (!processHasNonce(replacement)) throw new Error("TUI recovery replacement identity changed");
    const prepared: RecoveryState = {
      ...state,
      generation: state.generation + 1,
      phase: "replacement_prepared",
      replacement: {
        identity: replacement,
        port,
        dataHome,
        transactionSha256,
        identitySha256: replacementSha256,
        session: encryptSession(sessionId, owner.nonce),
        ownerReady: false,
      },
      updatedAt: new Date().toISOString(),
    };
    atomicWrite(statePath(worktree), prepared);
    writeJournal(worktree, prepared, preparedJournal);
  });
  while (true) {
    signal.throwIfAborted();
    const current = readState(worktree);
    if (!identitiesMatch(current.owner, owner.identity) || current.replacement?.transactionSha256 !== transactionSha256) {
      throw new Error("TUI recovery owner changed");
    }
    if (current.replacement.ownerReady) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
}

export function commitManagedRecoveryReplacement(worktree: string, transactionSha256: string): void {
  const owner = ownerFromEnvironment();
  withRecoveryMutation(worktree, () => {
    const state = readState(worktree);
    const replacement = state.replacement;
    if (!owner || !replacement || !state.activeParent || state.phase !== "replacement_prepared" || !replacement.ownerReady
      || replacement.transactionSha256 !== transactionSha256 || !identitiesMatch(state.owner, owner.identity)
      || replacement.identitySha256 !== identitySha256(replacement.identity)
      || !processHasNonce(replacement.identity)) throw new Error("TUI recovery replacement is not ready");
    const activeParent: EnrolledParent = {
      ...replacement.identity,
      worktree: state.activeParent.worktree,
      project: state.activeParent.project,
      projectId: state.activeParent.projectId,
      workspaceId: state.activeParent.workspaceId,
      storageMappingHash: state.activeParent.storageMappingHash,
      port: replacement.port,
      dataHome: replacement.dataHome,
    };
    const committed: RecoveryState = {
      ...state,
      fence: state.fence + 1,
      generation: state.generation + 1,
      phase: "replacement_committed",
      activeParent,
      updatedAt: new Date().toISOString(),
    };
    const journal = readJson(join(recoveryDirectory(worktree), "journal.json")) as RecoveryJournal;
    atomicWrite(statePath(worktree), committed);
    writeJournal(worktree, committed, journal);
    appendRecoveryEvent(worktree, committed, "fence_transition", { priorFence: state.fence });
  });
}

export function abortManagedRecoveryReplacement(worktree: string, transactionSha256: string): void {
  const owner = ownerFromEnvironment();
  withRecoveryMutation(worktree, () => {
    const state = readState(worktree);
    if (!owner || !identitiesMatch(state.owner, owner.identity) || state.phase !== "replacement_prepared"
      || !state.replacement || state.replacement.transactionSha256 !== transactionSha256) return;
    const journal = readJson(join(recoveryDirectory(worktree), "journal.json")) as RecoveryJournal;
    const aborted: RecoveryState = {
      ...state,
      generation: state.generation + 1,
      phase: "enrolled",
      replacement: null,
      updatedAt: new Date().toISOString(),
    };
    atomicWrite(statePath(worktree), aborted);
    writeJournal(worktree, aborted, journal);
    appendRecoveryEvent(worktree, aborted, "rollback", {
      reason: "precommit_abort",
      replacement: state.replacement.identity,
      transactionSha256: state.replacement.transactionSha256,
    });
  });
}

function initializeOwner(worktree: string, nonce: string): RecoveryState {
  if (process.platform !== "linux") throw new Error("TUI recovery requires Linux process attestation");
  const directory = recoveryDirectory(worktree);
  const lock = join(directory, "owner.lock");
  const identity = processIdentity(process.pid, hash(nonce));
  if (!identity) throw new Error("TUI recovery owner identity is unavailable");
  try {
    const prior = parseIdentity(readJson(lock));
    if (identitiesMatch(processIdentity(prior.pid, prior.nonceSha256), prior)) {
      throw new Error("TUI recovery already has a live owner");
    }
    unlinkSync(lock);
  } catch (error) {
    if (exactPrivateFile(lock) || (error as Error).message === "TUI recovery already has a live owner") throw error;
  }
  const descriptor = openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(identity)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const state: RecoveryState = {
    schemaVersion: 1,
    owner: identity,
    fence: 1,
    generation: 1,
    phase: "owner_ready",
    activeParent: null,
    replacement: null,
    updatedAt: new Date().toISOString(),
  };
  atomicWrite(statePath(worktree), state);
  appendRecoveryEvent(worktree, state, "fence_transition", { priorFence: 0 });
  return state;
}

async function reservePort(): Promise<{ port: number; server: Server }> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string" || address.port < 1024) throw new Error("TUI recovery port is unavailable");
  return { port: address.port, server };
}

function closeServer(server: Server): Promise<void> {
  return server.listening ? new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()))
    : Promise.resolve();
}

function childExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolvePromise({ code, signal }));
  });
}

function markOwnerReady(worktree: string, nonce: string): RecoveryState | undefined {
  return withRecoveryMutation(worktree, () => {
    const state = readState(worktree);
    if (state.phase !== "replacement_prepared" || !state.replacement || state.replacement.ownerReady) return state;
    const owner = processIdentity(process.pid, hash(nonce));
    if (!owner || !identitiesMatch(state.owner, owner)) return undefined;
    if (!processHasNonce(state.replacement.identity)) return state;
    if (!SAFE_SESSION_ID.test(decryptSession(state.replacement.session, nonce))) return undefined;
    const ready: RecoveryState = {
      ...state,
      replacement: { ...state.replacement, ownerReady: true },
      updatedAt: new Date().toISOString(),
    };
    atomicWrite(statePath(worktree), ready);
    return ready;
  });
}

function rollbackDeadPreparedReplacement(worktree: string, nonce: string, transactionSha256: string): boolean {
  const owner = processIdentity(process.pid, hash(nonce));
  if (!owner) return false;
  return withRecoveryMutation(worktree, () => {
    const state = readState(worktree);
    if (state.phase !== "replacement_prepared" || state.replacement?.transactionSha256 !== transactionSha256
      || !identitiesMatch(state.owner, owner) || processMatchesAttestedIdentity(state.replacement.identity)) return false;
    const journal = readJson(join(recoveryDirectory(worktree), "journal.json")) as RecoveryJournal;
    const rolledBack: RecoveryState = {
      ...state,
      generation: state.generation + 1,
      phase: "enrolled",
      replacement: null,
      updatedAt: new Date().toISOString(),
    };
    atomicWrite(statePath(worktree), rolledBack);
    writeJournal(worktree, rolledBack, journal);
    appendRecoveryEvent(worktree, rolledBack, "rollback", {
      reason: "replacement_identity_unavailable",
      replacement: state.replacement.identity,
      transactionSha256: state.replacement.transactionSha256,
    });
    return true;
  });
}

type OwnerWaitOutcome = RecoveryState
  | { exit: Awaited<ReturnType<typeof childExit>> }
  | { parentExited: true }
  | { replacementRolledBack: true };

async function waitForCommitOrExit(
  worktree: string,
  nonce: string,
  child?: ChildProcess,
  enrolledParent?: RestartProcessIdentity,
): Promise<OwnerWaitOutcome> {
  const exit = child ? childExit(child).then((result) => ({ exit: result })) : undefined;
  while (true) {
    const state = markOwnerReady(worktree, nonce);
    if (state?.phase === "replacement_prepared" && state.replacement
      && !processMatchesAttestedIdentity(state.replacement.identity)
      && rollbackDeadPreparedReplacement(worktree, nonce, state.replacement.transactionSha256)) {
      return { replacementRolledBack: true };
    }
    if (state?.phase === "replacement_committed" && state.replacement
      && processMatchesAttestedIdentity(state.replacement.identity)) return state;
    if (enrolledParent && !processMatchesAttestedIdentity(enrolledParent)) return { parentExited: true };
    if (exit) {
      const result = await Promise.race([exit, new Promise<undefined>((resolvePromise) => setTimeout(resolvePromise, 100))]);
      if (result) return result;
    } else {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  }
}

function explicitSession(argv: readonly string[]): string | undefined {
  const sessions: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === "-s" || value === "--session") {
      if (index + 1 < argv.length) sessions.push(argv[++index]!);
    } else if (value.startsWith("--session=")) sessions.push(value.slice("--session=".length));
  }
  if (sessions.length > 1 || sessions.some((session) => !SAFE_SESSION_ID.test(session))) {
    throw new Error("OpenCode recovery session is invalid");
  }
  return sessions[0];
}

function bindSession(argv: readonly string[], sessionId: string): string[] {
  const retained: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === "-c" || value === "--continue" || value.startsWith("--session=")) continue;
    if (value === "-s" || value === "--session") {
      index += 1;
      continue;
    }
    retained.push(value);
  }
  return [...retained, "--session", sessionId];
}

function signalExact(identity: RestartProcessIdentity, signal: NodeJS.Signals = "SIGTERM"): boolean {
  if (!processMatchesAttestedIdentity(identity, true)) return false;
  try { process.kill(identity.pid, signal); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  return true;
}

function recoveryOwnerMatches(identity: RestartProcessIdentity): boolean {
  const nonce = processEnvironmentValue(identity.pid, OWNER_NONCE_ENV);
  return Boolean(nonce) && hash(nonce!) === identity.nonceSha256
    && identitiesMatch(processIdentity(identity.pid, identity.nonceSha256, true), identity);
}

export async function stopTimedOutLegacyRecoveryOwner(
  worktree: string,
  identity: RestartProcessIdentity,
): Promise<void> {
  withRecoveryMutation(worktree, () => {
    const state = readState(worktree);
    if (!identitiesMatch(state.owner, identity)) throw new Error("Legacy recovery owner identity changed before cleanup");
    appendRecoveryEvent(worktree, state, "rollback", { reason: "enrollment_timeout" });
  });
  if (!recoveryOwnerMatches(identity)) {
    if (processLifetimeMatches(identity)) throw new Error("Legacy recovery owner identity changed before cleanup");
    return;
  }
  try { process.kill(identity.pid, "SIGTERM"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  const terminateDeadline = Date.now() + 500;
  while (Date.now() < terminateDeadline && processLifetimeMatches(identity)) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  if (processLifetimeMatches(identity)) {
    if (!recoveryOwnerMatches(identity)) throw new Error("Legacy recovery owner identity changed before cleanup");
    try { process.kill(identity.pid, "SIGKILL"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  const killDeadline = Date.now() + 500;
  while (Date.now() < killDeadline && processLifetimeMatches(identity)) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  if (processLifetimeMatches(identity)) throw new Error("Legacy recovery owner did not stop after enrollment timeout");
}

async function retireCommittedParent(identity: RestartProcessIdentity): Promise<void> {
  const graceDeadline = Date.now() + 500;
  while (Date.now() < graceDeadline && processInstanceMatches(identity)) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  if (processInstanceMatches(identity) && !signalExact(identity)) {
    throw new Error("TUI recovery parent identity changed before retirement");
  }
  while (processInstanceMatches(identity)) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
}

function settleCommittedState(worktree: string, ownerNonce: string, transactionSha256: string): void {
  const owner = processIdentity(process.pid, hash(ownerNonce));
  withRecoveryMutation(worktree, () => {
    const state = readState(worktree);
    if (state.phase !== "replacement_committed" || state.replacement?.transactionSha256 !== transactionSha256
      || !owner || !identitiesMatch(state.owner, owner)) {
      throw new Error("TUI recovery commit changed before adoption");
    }
    const journal = readJson(join(recoveryDirectory(worktree), "journal.json")) as RecoveryJournal;
    const priorParent = state.activeParent!;
    const replacement = state.replacement;
    const adopted: RecoveryState = {
      ...state,
      generation: state.generation + 1,
      phase: "enrolled",
      activeParent: {
        ...replacement.identity,
        project: priorParent.project,
        projectId: priorParent.projectId,
        workspaceId: priorParent.workspaceId,
        worktree: priorParent.worktree,
        storageMappingHash: priorParent.storageMappingHash,
        port: replacement.port,
        dataHome: replacement.dataHome,
      },
      replacement: null,
      updatedAt: new Date().toISOString(),
    };
    atomicWrite(statePath(worktree), adopted);
    writeJournal(worktree, adopted, journal);
    appendRecoveryEvent(worktree, adopted, "adoption", {
      replacement: replacement.identity,
      transactionSha256: replacement.transactionSha256,
    });
  });
}

function opencodeExecutable(): string {
  const executable = realpathSync(process.env.INGENIUM_OPENCODE_EXECUTABLE ?? "/usr/local/bin/opencode");
  if (basename(executable) !== "opencode") throw new Error("OpenCode executable is invalid");
  return executable;
}

async function spawnManagedTui(
  worktree: string,
  ownerNonce: string,
  owner: RecoveryOwnerIdentity,
  executable: string,
  argv: string[],
): Promise<ChildProcess> {
  if (argv.some((value) => value === "--port" || value.startsWith("--port="))) throw new Error("ingenium-opencode owns the recovery port");
  const reservation = await reservePort();
  const nonce = randomBytes(32).toString("base64url");
  await closeServer(reservation.server);
  return spawn(executable, [...argv, "--port", String(reservation.port)], {
    cwd: worktree,
    shell: false,
    stdio: "inherit",
    env: {
      ...process.env,
      PWD: worktree,
      INGENIUM_WORKTREE: worktree,
      INGENIUM_RESTART_NONCE: nonce,
      [OWNER_NONCE_ENV]: ownerNonce,
      [OWNER_PID_ENV]: String(owner.pid),
      [OWNER_START_ENV]: String(owner.startTimeTicks),
      [PORT_ENV]: String(reservation.port),
    },
  });
}

export async function runManagedTui(argv = process.argv.slice(2)): Promise<number> {
  const worktree = realpathSync(resolve(process.env.INGENIUM_WORKTREE ?? process.cwd()));
  const ownerNonce = randomBytes(32).toString("base64url");
  const state = initializeOwner(worktree, ownerNonce);
  const executable = opencodeExecutable();
  let continuationSession = explicitSession(argv);
  let frontend = await spawnManagedTui(worktree, ownerNonce, state.owner, executable, argv);
  let backendIdentity: RestartProcessIdentity | undefined;
  let backendDataHome: string | undefined;
  while (true) {
    const outcome = await waitForCommitOrExit(worktree, ownerNonce, frontend);
    if ("replacementRolledBack" in outcome || "parentExited" in outcome) continue;
    if ("exit" in outcome) {
      if (outcome.exit.code === 0) {
        if (backendIdentity) {
          await retireCommittedParent(backendIdentity);
          removeRecoveryServerAuthentication(backendDataHome!);
        }
        return 0;
      }
      if (backendIdentity) {
        await retireCommittedParent(backendIdentity);
        removeRecoveryServerAuthentication(backendDataHome!);
      }
      if (!continuationSession) return outcome.exit.code ?? 1;
      frontend = await spawnManagedTui(worktree, ownerNonce, state.owner, executable, bindSession(argv, continuationSession));
      backendIdentity = undefined;
      backendDataHome = undefined;
      continue;
    }
    const replacement = outcome.replacement!;
    const childNonce = frontend.pid ? processEnvironmentValue(frontend.pid, "INGENIUM_RESTART_NONCE") : undefined;
    const childIdentity = frontend.pid && childNonce ? processIdentity(frontend.pid, hash(childNonce)) : undefined;
    const retiring = backendIdentity ?? childIdentity;
    if (!retiring) throw new Error("TUI recovery lost the retiring parent identity");
    await retireCommittedParent(retiring);
    if (backendIdentity) removeRecoveryServerAuthentication(backendDataHome!);
    await childExit(frontend).catch(() => undefined);
    const sessionId = decryptSession(replacement.session, ownerNonce);
    const authentication = readRecoveryServerAuthentication(replacement.dataHome);
    frontend = spawn(executable, ["attach", `http://127.0.0.1:${replacement.port}`, "--session", sessionId], {
      cwd: worktree,
      shell: false,
      stdio: "inherit",
      env: {
        ...process.env,
        OPENCODE_SERVER_USERNAME: authentication.username,
        OPENCODE_SERVER_PASSWORD: authentication.password,
      },
    });
    if (!frontend.pid || !processStat(frontend.pid)) throw new Error("TUI recovery attach did not start");
    recordManagedRecoveryAttachEvent(
      worktree, "attach_started", frontend.pid, sessionId, replacement.transactionSha256, replacement.identity,
    );
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    if (!processStat(frontend.pid)) throw new Error("TUI recovery attach exited before health confirmation");
    recordManagedRecoveryAttachEvent(
      worktree, "attach_healthy", frontend.pid, sessionId, replacement.transactionSha256, replacement.identity,
    );
    continuationSession = sessionId;
    backendIdentity = replacement.identity;
    backendDataHome = replacement.dataHome;
    settleCommittedState(worktree, ownerNonce, replacement.transactionSha256);
  }
}

export function parseLegacyRecoveryOwnerPayload(encoded: string): LegacyOwnerBootstrap {
  if (!/^[A-Za-z0-9_-]{2,16384}$/.test(encoded)) throw new Error("Legacy recovery owner payload is invalid");
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.toString("base64url") !== encoded) throw new Error("Legacy recovery owner payload is invalid");
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("Legacy recovery owner payload is invalid"); }
  if (!hasExactKeys(value, ["schemaVersion", "worktree", "binding", "parent", "handoff"])
    || value.schemaVersion !== 1
    || !hasExactKeys(value.binding, ["project", "projectId", "workspaceId", "launcherWorktree", "storageMappingHash"])
    || !hasExactKeys(value.parent, ["pid", "startTimeTicks", "executableSha256", "nonceSha256", "port", "dataHome"])) {
    throw new Error("Legacy recovery owner payload is invalid");
  }
  const worktree = typeof value.worktree === "string" ? realpathSync(resolve(value.worktree)) : undefined;
  const parent = parseIdentity(value.parent);
  if (!worktree || value.worktree !== worktree || value.binding.launcherWorktree !== worktree
    || !isValidExtensionProjectName(value.binding.project)
    || typeof value.binding.projectId !== "string" || !UUID.test(value.binding.projectId)
    || typeof value.binding.workspaceId !== "string" || !SAFE_ID.test(value.binding.workspaceId)
    || typeof value.binding.storageMappingHash !== "string" || !HASH.test(value.binding.storageMappingHash)
    || (value.parent.port !== null && (!Number.isSafeInteger(value.parent.port)
      || (value.parent.port as number) < 1024 || (value.parent.port as number) > 65535))
    || typeof value.parent.dataHome !== "string" || resolve(value.parent.dataHome) !== value.parent.dataHome) {
    throw new Error("Legacy recovery owner payload is invalid");
  }
  return {
    schemaVersion: 1,
    worktree,
    binding: {
      project: value.binding.project,
      projectId: value.binding.projectId,
      workspaceId: value.binding.workspaceId,
      launcherWorktree: worktree,
      storageMappingHash: value.binding.storageMappingHash,
    },
    parent: { ...parent, port: value.parent.port as number | null, dataHome: value.parent.dataHome },
    handoff: parseRedactedRestartHandoff(value.handoff),
  };
}

export async function runDetachedRecoveryOwner(encoded: string): Promise<void> {
  const input = parseLegacyRecoveryOwnerPayload(encoded);
  const nonce = process.env[OWNER_NONCE_ENV];
  if (!nonce) throw new Error("Legacy recovery owner nonce is unavailable");
  const state = initializeOwner(input.worktree, nonce);
  const enrolled: EnrolledParent = {
    ...input.parent,
    ...input.binding,
    worktree: input.worktree,
  };
  if (!processMatchesAttestedIdentity(enrolled)) {
    throw new Error("Legacy parent identity changed");
  }
  const enrolledState: RecoveryState = {
    ...state,
    fence: state.fence + 1,
    generation: state.generation + 1,
    phase: "enrolled",
    activeParent: enrolled,
    updatedAt: new Date().toISOString(),
  };
  withRecoveryMutation(input.worktree, () => {
    atomicWrite(statePath(input.worktree), enrolledState);
    writeJournal(input.worktree, enrolledState, input.handoff);
    appendRecoveryEvent(input.worktree, enrolledState, "fence_transition", { priorFence: state.fence });
  });
  let retiring: RestartProcessIdentity = input.parent;
  while (true) {
    const committed = await waitForCommitOrExit(input.worktree, nonce, undefined, retiring);
    if ("exit" in committed || "parentExited" in committed) return;
    if ("replacementRolledBack" in committed) continue;
    const replacement = committed.replacement!;
    await retireCommittedParent(retiring);
    retiring = replacement.identity;
    settleCommittedState(input.worktree, nonce, replacement.transactionSha256);
  }
}

export async function bootstrapLegacyRecoveryOwner(
  worktree: string,
  binding: ManagedRecoveryBinding,
  parent: RestartProcessIdentity & { port: number | null; dataHome: string },
  handoff: RedactedRestartHandoff,
): Promise<void> {
  const nonce = randomBytes(32).toString("base64url");
  const payload: LegacyOwnerBootstrap = { schemaVersion: 1, worktree, binding, parent, handoff };
  const script = fileURLToPath(new URL("./scripts/recovery-owner.js", import.meta.url));
  const child = spawn(process.execPath, [script, Buffer.from(JSON.stringify(payload)).toString("base64url")], {
    cwd: worktree,
    detached: true,
    shell: false,
    stdio: "ignore",
    env: {
      PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
      HOME: process.env.HOME,
      [OWNER_NONCE_ENV]: nonce,
    },
  });
  if (!child.pid) throw new Error("Legacy recovery owner did not start");
  const ownerIdentity = processIdentity(child.pid, hash(nonce), true);
  if (!ownerIdentity) throw new Error("Legacy recovery owner identity is unavailable");
  child.unref();
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const state = readState(worktree);
      if (state.owner.pid === child.pid && liveOwner(state) && state.phase === "enrolled"
        && state.activeParent && identitiesMatch(state.activeParent, parent)) {
        process.env[OWNER_NONCE_ENV] = nonce;
        process.env[OWNER_PID_ENV] = String(state.owner.pid);
        process.env[OWNER_START_ENV] = String(state.owner.startTimeTicks);
        return;
      }
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  await stopTimedOutLegacyRecoveryOwner(worktree, ownerIdentity);
  throw new Error("Legacy recovery owner enrollment timed out");
}

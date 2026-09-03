#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
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
  readlinkSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  preflightApiAuthentication,
} from "../api-auth.js";
import {
  coordinationCredentialPurpose,
  resolveExtensionBinding,
} from "../extension-binding.js";
import { mcpToolData, openMcpToolClient, type McpToolClient } from "../mcp-client.js";
import {
  decodeReplacementFirstRestartRequest,
  runReplacementFirstRestart,
  type RedactedRestartHandoff,
  type ReplacementFirstRestartDependencies,
  type ReplacementFirstRestartRequest,
  type ReplacementFirstRestartResult,
  type RestartProcessIdentity,
} from "../replacement-first-restart.js";
import {
  abortManagedRecoveryReplacement,
  bootstrapLegacyRecoveryOwner,
  commitManagedRecoveryReplacement,
  prepareManagedRecoveryReplacement,
  readManagedRecoveryEnrollment,
} from "../tui-recovery.js";

const MAX_STATE_BYTES = 64 * 1024;
const MAX_AUTH_BYTES = 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,256}$/;
const UNNONCED_PARENT_SHA256 = "0".repeat(64);
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

export interface ProductionRestartParentCandidate {
  binding: ReplacementFirstRestartRequest["binding"];
  oldProcess: RestartProcessIdentity;
  oldPort: number;
  oldDataHome: string;
  handoff: RedactedRestartHandoff;
  timeouts: ReplacementFirstRestartRequest["timeouts"];
}

export interface PreparedProductionReplacement<Session> {
  replacement: ReplacementFirstRestartRequest["replacement"];
  dependencies: ReplacementFirstRestartDependencies<Session>;
  release(): Promise<void> | void;
}

export interface ProductionRestartAdapterDependencies<Session> {
  canonicalWorktree(): string;
  resolveBinding(worktree: string): Promise<ProductionRestartBinding>;
  readParentCandidates(worktree: string): Promise<ProductionRestartParentCandidate[]> | ProductionRestartParentCandidate[];
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

interface RestartHandoffPublisher {
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

interface ProductionPreparedState {
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
  parentStateSha256: string;
  port: number;
  reservation: Server;
  runDirectory: string;
  scoutEvidenceFile: string;
  traceFile: string;
  worktree: string;
  binding: ProductionRestartBinding;
  parent: ProductionRestartParentCandidate;
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

function exactMode(mode: number, expected: number): boolean {
  return (mode & 0o777) === expected;
}

function processOwner(): number | undefined {
  return process.platform === "win32" || typeof process.getuid !== "function" ? undefined : process.getuid();
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

function readPrivateFile(path: string, maximumBytes: number): Buffer {
  const before = lstatSync(path);
  const uid = processOwner();
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1
    || before.size > maximumBytes || !exactMode(before.mode, 0o600) || (uid !== undefined && before.uid !== uid)) {
    throw new Error("Production restart state is unavailable");
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1
      || opened.size !== before.size || !exactMode(opened.mode, 0o600) || (uid !== undefined && opened.uid !== uid)) {
      throw new Error("Production restart state is unavailable");
    }
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
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
  try {
    descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, value, "utf8");
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const directory = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(directory); } finally { closeSync(directory); }
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

export function readProtectedProductionRestartState(worktree: string): ProductionRestartParentCandidate[] {
  let serialized: string;
  try {
    serialized = readPrivateFile(join(stateDirectory(worktree), "state.json"), MAX_STATE_BYTES).toString("utf8");
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
  const candidates = parsed.parentCandidates.map(stateCandidate);
  if (candidates.some((candidate) => candidate === undefined)) throw new Error("Production restart state is unavailable");
  return candidates as ProductionRestartParentCandidate[];
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
  candidate: ProductionRestartParentCandidate,
  worktree: string,
): ProductionRestartParentCandidate {
  const replacementPort = candidate.oldPort === 65535 ? 65534 : candidate.oldPort + 1;
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
): Promise<ReplacementFirstRestartResult> {
  const worktree = dependencies.canonicalWorktree();
  const binding = await dependencies.resolveBinding(worktree);
  let candidates = await dependencies.readParentCandidates(worktree);
  if (candidates.length === 0 && dependencies.enrollParentCandidate) {
    const enrolled = await dependencies.enrollParentCandidate(worktree, binding);
    if (enrolled) candidates = [enrolled];
  }
  if (candidates.length !== 1) throw new Error("Production restart parent identity is absent or ambiguous");
  const parent = validateParentCandidate(candidates[0]!, worktree);
  if (!bindingsMatch(parent.binding, binding)) throw new Error("Production restart parent binding changed");
  if (!await dependencies.attestParentProcess(parent)) {
    throw new Error("Production restart parent launcher nonce is invalid");
  }
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

function procStat(pid: number): { parentPid: number; startTimeTicks: number } | undefined {
  try {
    const source = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = source.lastIndexOf(")");
    if (closeParen < 1) return undefined;
    const fields = source.slice(closeParen + 1).trim().split(/\s+/);
    const parentPid = Number(fields[1]);
    const startTimeTicks = Number(fields[19]);
    return Number.isSafeInteger(parentPid) && parentPid >= 0 && Number.isSafeInteger(startTimeTicks) && startTimeTicks > 0
      ? { parentPid, startTimeTicks }
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
  const stat = procStat(pid);
  if (!stat) return undefined;
  try {
    const executable = realpathSync(readlinkSync(`/proc/${pid}/exe`));
    const executableSha256 = hash(readFileSync(executable));
    if (requireProcessNonce) {
      const nonce = processEnvironment(pid)?.INGENIUM_RESTART_NONCE;
      if (!nonce || hash(nonce) !== nonceSha256) return undefined;
    }
    return { pid, startTimeTicks: stat.startTimeTicks, executableSha256, nonceSha256 };
  } catch {
    return undefined;
  }
}

function inspectExpectedProcessIdentity(identity: RestartProcessIdentity): RestartProcessIdentity | undefined {
  if (identity.nonceSha256 === UNNONCED_PARENT_SHA256) {
    if (processEnvironment(identity.pid)?.INGENIUM_RESTART_NONCE) return undefined;
    return inspectProcessIdentity(identity.pid, UNNONCED_PARENT_SHA256, false);
  }
  return inspectProcessIdentity(identity.pid, identity.nonceSha256, true);
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

async function jsonRequest(url: string, init: RequestInit, signal: AbortSignal): Promise<{ status: number; value: unknown }> {
  const response = await fetch(url, { ...init, signal });
  return { status: response.status, value: await response.json().catch(() => null) };
}

function processExecutable(pid: number): string | undefined {
  try {
    return realpathSync(readlinkSync(`/proc/${pid}/exe`));
  } catch {
    return undefined;
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
    const executable = processExecutable(pid);
    const argv = processCommandLine(pid);
    const sessionId = argv ? sessionIdFromCommandLine(argv) : undefined;
    if (executable && basename(executable) === "opencode" && sessionId && processWorkingDirectory(pid) === worktree) {
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

function redactedHandoffFromSession(messages: unknown, status: unknown, sessionId: string): RedactedRestartHandoff | undefined {
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
  return {
    status: operationalStatus,
    taskHash: null,
    todos: { total: todos.length, ...counts, state: handoffTodoState(counts) },
    nextWork: { kind: open ? "continue_task" : "none", referenceHash: null },
  };
}

async function readLiveParentHandoff(
  port: number,
  sessionId: string,
  worktree: string,
): Promise<RedactedRestartHandoff | undefined> {
  const signal = AbortSignal.timeout(5_000);
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const [health, session, messages, status] = await Promise.all([
      jsonRequest(`${baseUrl}/global/health`, {}, signal),
      jsonRequest(`${baseUrl}/session/${encodeURIComponent(sessionId)}`, {}, signal),
      jsonRequest(`${baseUrl}/session/${encodeURIComponent(sessionId)}/message`, {}, signal),
      jsonRequest(`${baseUrl}/session/status`, {}, signal),
    ]);
    const healthValue = responseRecord(health.value);
    const sessionValue = responseRecord(session.value);
    if (health.status !== 200 || healthValue?.healthy !== true || typeof healthValue.version !== "string"
      || session.status !== 200 || sessionValue?.id !== sessionId || sessionValue.directory !== worktree
      || messages.status !== 200 || status.status !== 200) return undefined;
    return redactedHandoffFromSession(messages.value, status.value, sessionId);
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
    const handoff = await readLiveParentHandoff(port, discovered.sessionId, worktree);
    if (handoff) matches.push({ port, handoff });
  }
  if (matches.length !== 1) return undefined;
  const parent: ProductionRestartParentCandidate = {
    binding: {
      projectId: binding.projectId,
      workspaceId: binding.workspaceId,
      launcherWorktree: binding.launcherWorktree,
      storageMappingHash: binding.storageMappingHash,
      audience: "mcp",
    },
    oldProcess: discovered.identity,
    oldPort: matches[0]!.port,
    oldDataHome: discovered.dataHome,
    handoff: matches[0]!.handoff,
    timeouts: DEFAULT_TIMEOUTS,
  };
  validateParentCandidate(parent, worktree);
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
  const root = createStateDirectory(worktree);
  writePrivateNewFile(join(root, "state.json"), `${JSON.stringify({ schemaVersion: 1, parentCandidates: [parent] })}\n`);
  return readProtectedProductionRestartState(worktree)[0];
}

async function attestProductionParent(parent: ProductionRestartParentCandidate): Promise<boolean> {
  if (!identitiesMatch(inspectExpectedProcessIdentity(parent.oldProcess), parent.oldProcess)) return false;
  if (parent.oldProcess.nonceSha256 !== UNNONCED_PARENT_SHA256) return true;
  const argv = processCommandLine(parent.oldProcess.pid);
  const sessionId = argv ? sessionIdFromCommandLine(argv) : undefined;
  return isProcessAncestor(parent.oldProcess.pid) && processWorkingDirectory(parent.oldProcess.pid) === parent.binding.launcherWorktree
    && parentDataHome(parent.oldProcess.pid) === parent.oldDataHome && sessionId !== undefined
    && listeningLoopbackPorts().includes(parent.oldPort)
    && await readLiveParentHandoff(parent.oldPort, sessionId, parent.binding.launcherWorktree) !== undefined;
}

function hasCapturedHandoff(path: string, expectedSha256: string, offset: number): boolean {
  let source: Buffer;
  try { source = readFileSync(path); } catch { return false; }
  if (source.length <= offset) return false;
  for (const line of source.subarray(offset).toString("utf8").split(/\r?\n/).filter(Boolean).reverse()) {
    let capture: unknown;
    try { capture = JSON.parse(line); } catch { continue; }
    if (!isRecord(capture) || typeof capture.memory !== "string") continue;
    const payloadStart = capture.memory.indexOf("\n", capture.memory.indexOf("\n") + 1);
    if (payloadStart < 0) continue;
    let payload: unknown;
    try { payload = JSON.parse(capture.memory.slice(payloadStart + 1)); } catch { continue; }
    if (!isRecord(payload) || !Array.isArray(payload.memoryEntries)) continue;
    for (const entry of [...payload.memoryEntries].reverse()) {
      if (!isRecord(entry) || !isRecord(entry.todoCounts) || !isRecord(entry.nextWork)) continue;
      const currentTaskId = entry.currentTaskId;
      const taskHash = typeof currentTaskId === "string" && /^task-[0-9a-f]{64}$/.test(currentTaskId)
        ? currentTaskId.slice(5)
        : currentTaskId === null ? null : undefined;
      if (taskHash === undefined) continue;
      const handoff = {
        status: entry.status,
        taskHash,
        todos: {
          total: entry.todoCounts.total,
          pending: entry.todoCounts.pending,
          inProgress: entry.todoCounts.inProgress,
          completed: entry.todoCounts.completed,
          cancelled: entry.todoCounts.cancelled,
          state: entry.todoState,
        },
        nextWork: { kind: entry.nextWork.kind, referenceHash: entry.nextWork.referenceHash },
      };
      if (hash(JSON.stringify(handoff)) === expectedSha256) return true;
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

async function publishRestartHandoff(
  worktree: string,
  binding: ProductionRestartBinding,
  handoff: RedactedRestartHandoff,
): Promise<RestartHandoffPublisher> {
  const client = await openMcpToolClient(worktree, { project: binding.project, credentialPurpose: "general" });
  const identity = {
    project: binding.project,
    worktree_id: `worktree-${hash(`${binding.workspaceId}\0${binding.storageMappingHash}`)}`,
    session_id: `session-${hash(randomBytes(32))}`,
    incarnation: Date.now(),
  };
  const ownershipToken = randomBytes(32).toString("base64url");
  try {
    const registered = responseRecord(mcpToolData(await client.callTool("coordination_update", {
      ...identity,
      operation: "register",
      ownership_token: ownershipToken,
      ttl_ms: 60_000,
      idempotency_key: randomUUID(),
    })));
    const registeredSession = restartPublisherMutation(registered?.session);
    const published = responseRecord(mcpToolData(await client.callTool("coordination_handoff", {
      ...identity,
      operation: "memory",
      ownership_token: ownershipToken,
      expected_revision: registeredSession.revision,
      fence: registeredSession.fence,
      idempotency_key: randomUUID(),
      memory_entry: {
        status: handoff.status,
        actions: [],
        checks: [],
        todos: handoff.todos,
        currentTaskId: handoff.taskHash === null ? null : `task-${handoff.taskHash}`,
        changedPaths: [],
        nextWork: handoff.nextWork,
      },
    })));
    const publishedSession = restartPublisherMutation(published?.session);
    return { client, identity, ownershipToken, ...publishedSession };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

async function closeRestartHandoffPublisher(publisher: RestartHandoffPublisher): Promise<void> {
  await publisher.client.callTool("coordination_update", {
    ...publisher.identity,
    operation: "close",
    ownership_token: publisher.ownershipToken,
    expected_revision: publisher.revision,
    fence: publisher.fence,
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
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw error;
  }
  while (procStat(identity.pid)) await wait(50, signal);
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
    OPENCODE_SERVER_PASSWORD: "",
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
  return {
    revalidateBinding: async (expected, worktree, signal) => {
      signal.throwIfAborted();
      try {
        const binding = await resolveProductionBinding(worktree);
        return bindingsMatch(expected, binding) && hash(readPrivateFile(join(stateDirectory(worktree), "state.json"), MAX_STATE_BYTES)) === state.parentStateSha256;
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
      writePrivateFile(join(state.runDirectory, "handoff.json"), `${JSON.stringify({ schemaVersion: 1, handoffSha256, handoff })}\n`);
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
        healthStatus: null as number | null,
        healthReady: false,
        agentStatus: null as number | null,
        scoutCapabilities: false,
      };
      try {
        while (true) {
          signal.throwIfAborted();
          try {
            diagnostic = { ...diagnostic, stage: "health_request" };
            // OpenCode can accept a request before startup completes, so each probe must be shorter than the phase budget.
            const response = await jsonRequest(
              `${baseUrl}/global/health`,
              {},
              AbortSignal.any([signal, AbortSignal.timeout(1_000)]),
            );
            const value = responseRecord(response.value);
            const healthReady = response.status === 200 && value?.healthy === true && value.version === state.expectedVersion;
            diagnostic = { ...diagnostic, stage: "health_response", healthStatus: response.status, healthReady };
            if (healthReady) {
              diagnostic = { ...diagnostic, stage: "agent_request" };
              const agents = await jsonRequest(
                `${baseUrl}/agent`,
                {},
                AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
              );
              const scoutCapabilities = agents.status === 200 && hasScoutCapabilities(agents.value);
              diagnostic = { ...diagnostic, stage: "agent_response", agentStatus: agents.status, scoutCapabilities };
              if (scoutCapabilities) {
                writePrivateFile(state.healthEvidenceFile, `${JSON.stringify({ ...diagnostic, result: "passed" })}\n`);
                writePrivateFile(state.scoutEvidenceFile, `${JSON.stringify({
                  schemaVersion: 1,
                  agent: "ingenium-scout",
                  capabilities: ["ingenium_docs_search", "ingenium_docs_get_page", "ingenium_coordination_memory_read"],
                  runtimeVersion: state.expectedVersion,
                })}\n`);
                return;
              }
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
      const before = await jsonRequest(`${baseUrl}/session`, {}, signal);
      const existingSessionIds = sessionIds(before.value);
      if (before.status !== 200 || !existingSessionIds) throw new Error("Replacement session list is invalid");
      const created = await jsonRequest(`${baseUrl}/session`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Ingenium replacement-first restart acknowledgement" }),
      }, signal);
      const session = responseRecord(created.value);
      if (created.status !== 200 || typeof session?.id !== "string" || !SAFE_SESSION_ID.test(session.id)
        || existingSessionIds.has(session.id)) {
        throw new Error("Replacement session creation failed");
      }
      const messages = await jsonRequest(`${baseUrl}/session/${encodeURIComponent(session.id)}/message`, {}, signal);
      const initial = messageList(messages.value);
      if (messages.status !== 200 || !initial) throw new Error("Replacement session messages are invalid");
      return {
        status: "created",
        transactionSha256,
        session: {
          id: session.id,
          initialMessageCount: initial.length,
          captureOffset: readPrivateFile(state.captureFile, MAX_STATE_BYTES).length,
          transactionSha256,
        },
      };
    },
    acknowledgeTypedMemory: async (_identity, session, handoffSha256, transactionSha256, signal) => {
      if (session.transactionSha256 !== transactionSha256) throw new Error("Replacement acknowledgement transaction changed");
      const expectedText = `READY ${transactionSha256}`;
      const prompted = await jsonRequest(`${baseUrl}/session/${encodeURIComponent(session.id)}/prompt_async`, {
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
        if (hasCapturedHandoff(state.captureFile, handoffSha256, session.captureOffset)) {
          return { status: "acknowledged", handoffSha256, transactionSha256 };
        }
        await wait(100, signal);
      }
    },
    awaitTerminalIdleAcknowledgement: async (_identity, session, handoffSha256, transactionSha256, signal) => {
      if (session.transactionSha256 !== transactionSha256) throw new Error("Replacement acknowledgement transaction changed");
      const expectedText = `READY ${transactionSha256}`;
      while (true) {
        signal.throwIfAborted();
        const messagesResponse = await jsonRequest(`${baseUrl}/session/${encodeURIComponent(session.id)}/message`, {}, signal);
        const messages = messageList(messagesResponse.value);
        const terminal = hasSuccessfulTerminalAssistant(
          messagesResponse.value,
          session.initialMessageCount,
          expectedText,
          "ingenium-scout",
        );
        if (terminal) {
          const statusResponse = await jsonRequest(`${baseUrl}/session/status`, {}, signal);
          const statuses = responseRecord(statusResponse.value);
          const current = statuses?.[session.id];
          if (statusResponse.status === 200 && statuses
            && (current === undefined || (isRecord(current) && (current.type === "idle" || current.status === "idle")))) {
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
        join(state.runDirectory, "home"),
        session.id,
        handoffSha256,
        transactionSha256,
        signal,
      );
      return {
        status: "ready",
        transactionSha256,
        replacementIdentitySha256: hash(JSON.stringify(identity)),
      };
    },
    commitRecoveryOwner: async (transactionSha256, signal) => {
      signal.throwIfAborted();
      commitManagedRecoveryReplacement(state.worktree, transactionSha256);
    },
    abortRecoveryOwner: (transactionSha256) => {
      abortManagedRecoveryReplacement(state.worktree, transactionSha256);
    },
    retireOldProcess: (identity, signal) => terminate(identity, "old", signal),
    stopReplacement: (identity, signal) => terminate(identity, "replacement", signal),
    persistEvidence: (evidence) => writePrivateFile(state.evidenceFile, `${JSON.stringify(evidence)}\n`),
  };
}

async function resolveProductionBinding(worktree: string): Promise<ProductionRestartBinding> {
  const purpose = coordinationCredentialPurpose();
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
}): Promise<PreparedProductionReplacement<ReplacementSession>> {
  const executable = processExecutable(input.parent.oldProcess.pid);
  if (!executable || basename(executable) !== "opencode") throw new Error("Production OpenCode executable is unavailable");
  const expectedExecutableSha256 = hash(readFileSync(executable));
  if (expectedExecutableSha256 !== input.parent.oldProcess.executableSha256) {
    throw new Error("Production OpenCode executable changed");
  }
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
  writePrivateFile(join(root, "state.json"), `${JSON.stringify({ schemaVersion: 1, parentCandidates: [input.parent] })}\n`);
  const parentStateSha256 = hash(readPrivateFile(join(root, "state.json"), MAX_STATE_BYTES));
  const runtimeRoot = "/tmp/opencode";
  assertOwnedDirectory(runtimeRoot);
  const runDirectory = join(runtimeRoot, `production-restart-${randomUUID()}`);
  ensurePrivateDirectory(runDirectory);
  const home = join(runDirectory, "home");
  for (const directory of [
    home,
    join(home, ".config"),
    join(home, ".local"),
    join(home, ".local", "share"),
    join(home, ".local", "share", "opencode"),
    join(home, ".local", "state"),
    join(home, ".cache"),
  ]) ensurePrivateDirectory(directory);
  const authSource = readPrivateFile(currentAuthFile(input.parent.oldDataHome), MAX_AUTH_BYTES);
  const authDestination = join(home, ".local", "share", "opencode", "auth.json");
  writePrivateBuffer(authDestination, authSource);
  const captureFile = join(runDirectory, "coordination-capture.jsonl");
  writePrivateFile(captureFile, "\n");
  const traceFile = join(runDirectory, "coordination-trace.jsonl");
  writePrivateFile(traceFile, "\n");
  const evidenceFile = join(runDirectory, "evidence.json");
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
  const nonce = randomBytes(32).toString("base64url");
  const state: ProductionPreparedState = {
    captureFile,
    evidenceFile,
    executable,
    expectedExecutableSha256,
    expectedVersion,
    healthEvidenceFile,
    logDescriptor,
    nonce,
    parentStateSha256,
    port: reservation.port,
    reservation: reservation.server,
    runDirectory,
    scoutEvidenceFile,
    traceFile,
    worktree: input.worktree,
    binding: input.binding,
    parent: input.parent,
  };
  try {
    state.handoffPublisher = await publishRestartHandoff(input.worktree, input.binding, input.parent.handoff);
  } catch (error) {
    await closeServer(reservation.server);
    closeSync(logDescriptor);
    throw error;
  }
  return {
    replacement: {
      port: reservation.port,
      dataHome: home,
      expectedIdentity: { executableSha256: expectedExecutableSha256, nonceSha256: hash(nonce) },
    },
    dependencies: productionDependencies(state),
    release: async () => {
      if (state.handoffPublisher) await closeRestartHandoffPublisher(state.handoffPublisher);
      await closeServer(reservation.server);
      closeSync(logDescriptor);
    },
  };
}

export function productionRestartDependencies(): ProductionRestartAdapterDependencies<ReplacementSession> {
  return {
    canonicalWorktree: () => realpathSync(resolve(process.cwd())),
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
    enrollParentCandidate: enrollRunningProductionParent,
    attestParentProcess: attestProductionParent,
    prepareReplacement: prepareProductionReplacement,
  };
}

export async function runProductionRestartCli(): Promise<void> {
  if (process.argv.length !== 2) throw new Error("Production restart accepts no arguments");
  const result = await runProductionRestartAdapter(productionRestartDependencies());
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  await runProductionRestartCli();
}

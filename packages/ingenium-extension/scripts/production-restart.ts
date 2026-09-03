#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
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
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  preflightApiAuthentication,
} from "../api-auth.js";
import {
  coordinationCredentialPurpose,
  resolveExtensionBinding,
} from "../extension-binding.js";
import {
  decodeReplacementFirstRestartRequest,
  runReplacementFirstRestart,
  type RedactedRestartHandoff,
  type ReplacementFirstRestartDependencies,
  type ReplacementFirstRestartRequest,
  type ReplacementFirstRestartResult,
  type RestartProcessIdentity,
} from "../replacement-first-restart.js";

const OPENCODE = "/usr/local/bin/opencode";
const OPENCODE_VERSION = "1.18.9";
const MAX_STATE_BYTES = 64 * 1024;
const MAX_AUTH_BYTES = 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,256}$/;

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
  readParentCandidates(worktree: string): ProductionRestartParentCandidate[];
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

interface ProductionPreparedState {
  child?: ChildProcess;
  captureFile: string;
  evidenceFile: string;
  expectedExecutableSha256: string;
  logDescriptor: number;
  nonce: string;
  parentStateSha256: string;
  port: number;
  reservation: Server;
  runDirectory: string;
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

function stateCandidate(value: unknown): ProductionRestartParentCandidate | undefined {
  if (!hasExactKeys(value, ["binding", "oldProcess", "oldPort", "oldDataHome", "handoff", "timeouts"])
    || !hasExactKeys(value.binding, ["projectId", "workspaceId", "launcherWorktree", "storageMappingHash", "audience"])
    || !hasExactKeys(value.oldProcess, ["pid", "startTimeTicks", "executableSha256", "nonceSha256"])) return undefined;
  return value as unknown as ProductionRestartParentCandidate;
}

export function readProtectedProductionRestartState(worktree: string): ProductionRestartParentCandidate[] {
  const serialized = readPrivateFile(join(stateDirectory(worktree), "state.json"), MAX_STATE_BYTES).toString("utf8");
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
  const candidates = dependencies.readParentCandidates(worktree);
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

function procStat(pid: number): { startTimeTicks: number } | undefined {
  try {
    const source = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = source.lastIndexOf(")");
    if (closeParen < 1) return undefined;
    const fields = source.slice(closeParen + 1).trim().split(/\s+/);
    const startTimeTicks = Number(fields[19]);
    return Number.isSafeInteger(startTimeTicks) && startTimeTicks > 0 ? { startTimeTicks } : undefined;
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

function identitiesMatch(left: RestartProcessIdentity | undefined, right: RestartProcessIdentity): boolean {
  return left !== undefined && left.pid === right.pid && left.startTimeTicks === right.startTimeTicks
    && left.executableSha256 === right.executableSha256 && left.nonceSha256 === right.nonceSha256;
}

function currentAuthFile(): string {
  const dataHome = process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? homedir(), ".local", "share");
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

function messageList(value: unknown): unknown[] | undefined {
  const data = isRecord(value) && Object.hasOwn(value, "data") ? value.data : value;
  return Array.isArray(data) ? data : undefined;
}

function responseRecord(value: unknown): Record<string, unknown> | undefined {
  const data = isRecord(value) && Object.hasOwn(value, "data") ? value.data : value;
  return isRecord(data) ? data : undefined;
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

function hasSuccessfulTerminalAssistant(value: unknown, initialMessageCount: number, expectedText: string): boolean {
  return messageList(value)?.slice(initialMessageCount).some((message) => {
    if (!isRecord(message) || !isRecord(message.info) || message.info.role !== "assistant"
      || message.info.finish !== "stop" || message.info.error !== undefined || !Array.isArray(message.parts)) return false;
    const text = message.parts.filter((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
      .map((part) => (part as Record<string, unknown>).text as string).join("").trim();
    return text === expectedText;
  }) === true;
}

async function terminate(identity: RestartProcessIdentity, role: "old" | "replacement", signal: AbortSignal): Promise<void> {
  if (!identitiesMatch(inspectProcessIdentity(identity.pid, identity.nonceSha256, true), identity)) {
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
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
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
    INGENIUM_MCP_CREDENTIAL_FILE: state.binding.credentialFile,
    INGENIUM_COORDINATION_TRANSFORM_CAPTURE: "1",
    INGENIUM_COORDINATION_TRANSFORM_CAPTURE_FILE: state.captureFile,
    INGENIUM_RESTART_NONCE: state.nonce,
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
      return identitiesMatch(inspectProcessIdentity(identity.pid, identity.nonceSha256, true), identity);
    },
    persistHandoff: async (handoff, handoffSha256, signal) => {
      signal.throwIfAborted();
      writePrivateFile(join(state.runDirectory, "handoff.json"), `${JSON.stringify({ schemaVersion: 1, handoffSha256, handoff })}\n`);
    },
    launchReplacement: async (input, signal) => {
      signal.throwIfAborted();
      await closeServer(state.reservation);
      const child = spawn(OPENCODE, ["serve", "--hostname", "127.0.0.1", "--port", String(state.port)], {
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
      while (true) {
        signal.throwIfAborted();
        try {
          const response = await jsonRequest(`${baseUrl}/global/health`, {}, signal);
          const value = responseRecord(response.value);
          if (response.status === 200 && value?.healthy === true && value.version === OPENCODE_VERSION) return;
        } catch (error) {
          if (signal.aborted) throw error;
        }
        await wait(100, signal);
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
        body: JSON.stringify({ parts: [{ type: "text", text: `Return only ${expectedText}. Do not use tools.` }] }),
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
        const terminal = hasSuccessfulTerminalAssistant(messagesResponse.value, session.initialMessageCount, expectedText);
        if (terminal) {
          const statusResponse = await jsonRequest(`${baseUrl}/session/status`, {}, signal);
          const statuses = responseRecord(statusResponse.value);
          const current = statuses?.[session.id];
          if (statusResponse.status === 200 && isRecord(current) && (current.type === "idle" || current.status === "idle")) {
            return { status: "idle", handoffSha256, transactionSha256, assistantResult: "completed" };
          }
        }
        await wait(100, signal);
      }
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
  const executable = realpathSync(OPENCODE);
  if (executable !== OPENCODE) throw new Error("Production OpenCode executable is not canonical");
  const expectedExecutableSha256 = hash(readFileSync(executable));
  const currentParent = inspectProcessIdentity(input.parent.oldProcess.pid, input.parent.oldProcess.nonceSha256, true);
  if (!identitiesMatch(currentParent, input.parent.oldProcess)) throw new Error("Production restart parent identity changed");
  const root = stateDirectory(input.worktree);
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
  const authSource = readPrivateFile(currentAuthFile(), MAX_AUTH_BYTES);
  const authDestination = join(home, ".local", "share", "opencode", "auth.json");
  writePrivateBuffer(authDestination, authSource);
  const captureFile = join(runDirectory, "coordination-capture.jsonl");
  writePrivateFile(captureFile, "\n");
  const evidenceFile = join(runDirectory, "evidence.json");
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
    expectedExecutableSha256,
    logDescriptor,
    nonce,
    parentStateSha256,
    port: reservation.port,
    reservation: reservation.server,
    runDirectory,
    worktree: input.worktree,
    binding: input.binding,
    parent: input.parent,
  };
  return {
    replacement: {
      port: reservation.port,
      dataHome: home,
      expectedIdentity: { executableSha256: expectedExecutableSha256, nonceSha256: hash(nonce) },
    },
    dependencies: productionDependencies(state),
    release: async () => {
      await closeServer(reservation.server);
      closeSync(logDescriptor);
    },
  };
}

export function productionRestartDependencies(): ProductionRestartAdapterDependencies<ReplacementSession> {
  return {
    canonicalWorktree: () => realpathSync(resolve(process.cwd())),
    resolveBinding: resolveProductionBinding,
    readParentCandidates: readProtectedProductionRestartState,
    attestParentProcess: (parent) => identitiesMatch(
      inspectProcessIdentity(parent.oldProcess.pid, parent.oldProcess.nonceSha256, true),
      parent.oldProcess,
    ),
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

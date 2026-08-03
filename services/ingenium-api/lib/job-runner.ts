import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmdirSync,
  statfsSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { jobEventDeliveries, jobs, logger, vault } from "ingenium-core";

let activeRunCount = 0;

/**
 * Conservative concurrency limit: only 2 simultaneous opencode CLI invocations.
 *
 * Each opencode process loads an LLM model context and may consume significant
 * memory (especially with agentic tool loops). A cap of 2 prevents resource
 * starvation in the single-container deployment while still allowing parallel
 * execution for staggered cron jobs.
 */
const MAX_CONCURRENT_RUNS = 2;

/** Grace period between cooperative termination and forced process-group kill. */
export const JOB_TERMINATION_GRACE_MS = 5_000;

/**
 * A stopped process group can take a moment to disappear from procfs. Keep its
 * ownership evidence while it does, but do not keep the API alive only to poll
 * for it.
 */
export const JOB_GROUP_RECOVERY_INTERVAL_MS = 1_000;

/** In-memory map of runId → ChildProcess for cancellation and status tracking. */
const runningProcesses = new Map<string, ChildProcess>();
const runProjects = new Map<string, string>();
const eventRunContexts = new Map<string, EventExecutionContext>();
const forceKillTimers = new Map<string, ReturnType<typeof setTimeout>>();
const closePromises = new Map<string, Promise<void>>();
const terminationCompletions = new Map<string, Promise<void>>();
const resolveEscalations = new Map<string, () => void>();
const groupRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const vaultSecretRuns = new Map<string, VaultSecretRunFiles>();
const recoveredVaultRuns = new Map<string, jobs.VaultSecretRunRecovery>();
let vaultRecoveryInFlight: Promise<void> | null = null;
const vaultRedactionRuns = new Set<string>();
const teardownAttempts = new Map<string, Promise<void>>();

// `detached: true` starts a POSIX child as the leader of a new process group.
// Windows does not expose the same portable process-group signal semantics.
const supportsOwnedProcessGroups = process.platform !== "win32";
const RUN_NONCE_ENV = "INGENIUM_JOB_RUN_NONCE";
const JOB_CHILD_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
export const VAULT_JOB_SECRET_ROOT = "/dev/shm/ingenium-job-secrets";
const VAULT_OPENCODE_CONFIG_SOURCE = "/home/appuser/.config/opencode/opencode.jsonc";
const VAULT_OPENCODE_AUTH_SOURCE = "/home/appuser/.local/share/opencode/auth.json";
const VAULT_RUNTIME_DIRECTORIES = ["home", "config", "data", "cache", "state", "tmp"] as const;
const VAULT_RUNTIME_DIRECTORY_SET = new Set<string>(VAULT_RUNTIME_DIRECTORIES);
const VAULT_CONFIG_MAX_BYTES = 1024 * 1024;
const VAULT_AUTH_MAX_BYTES = 1024 * 1024;
const VAULT_SECRET_MAX_BYTES = 1024 * 1024;
const TMPFS_MAGIC = 0x01021994;
const VAULT_OUTPUT_REDACTION = "Vault job output redacted.";
const VAULT_UNAVAILABLE_CODE = "vault_secrets_unavailable";
const VAULT_UNAVAILABLE_MESSAGE = "Vault secrets are unavailable.";
const RUN_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Deliberately do not inherit the API process environment. It carries boundary
 * credentials and provider secrets that an agent process must never receive.
 */
export function buildJobProcessEnvironment(
  projectId: string,
  runNonce: string,
  vaultSecretFiles?: Readonly<Record<string, string>>,
  vaultRuntime?: VaultOpenCodeRuntime,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || JOB_CHILD_PATH,
    HOME: vaultRuntime?.home ?? "/home/appuser",
    USER: process.env.USER || "appuser",
    SHELL: process.env.SHELL || "/bin/sh",
    TERM: process.env.TERM || "dumb",
    LANG: process.env.LANG || "C.UTF-8",
    ...(process.env.LC_ALL ? { LC_ALL: process.env.LC_ALL } : {}),
    ...(process.env.LC_CTYPE ? { LC_CTYPE: process.env.LC_CTYPE } : {}),
    XDG_CONFIG_HOME: vaultRuntime?.config ?? (process.env.XDG_CONFIG_HOME || "/home/appuser/.config"),
    XDG_DATA_HOME: vaultRuntime?.data ?? (process.env.XDG_DATA_HOME || "/home/appuser/.local/share"),
    XDG_CACHE_HOME: vaultRuntime?.cache ?? (process.env.XDG_CACHE_HOME || "/home/appuser/.cache"),
    ...(vaultRuntime ? { XDG_STATE_HOME: vaultRuntime.state, TMPDIR: vaultRuntime.tmp } : {}),
    INGENIUM_JOB_PROJECT_ID: projectId,
    [RUN_NONCE_ENV]: runNonce,
  };
  if (vaultSecretFiles) environment.INGENIUM_VAULT_SECRET_FILES = JSON.stringify(vaultSecretFiles);
  return environment;
}

function safeJobLogText(value: unknown, maxBytes = 256): string {
  return jobEventDeliveries.sanitizeJobEventText(typeof value === "string" ? value : "unknown", maxBytes);
}

/** Immutable identity data captured from procfs for an owned process. */
export interface JobProcessIdentity {
  processId: number;
  processGroupId: number;
  sessionId: number;
  startTime: string;
  executable: string;
  runNonce?: string;
  /** Present for procfs-derived identities; never persisted with run metadata. */
  ownerId?: number;
}

export interface JobProcessGroup {
  processGroupId: number;
  members: readonly JobProcessIdentity[];
}

/**
 * Procfs is deliberately abstracted so lifecycle safety can be tested without
 * sending a signal to a real process. `null` means the caller cannot make a
 * complete ownership decision and must not signal the process group.
 */
export interface JobProcessInspector {
  inspectProcess(processId: number): JobProcessIdentity | null;
  inspectGroup(processGroupId: number): JobProcessGroup | null;
}

interface JobRunnerRuntime {
  processInspector: JobProcessInspector;
  findProcessesByNonceHash: (nonceHash: string) => JobProcessIdentity[] | null;
  createRunNonce: () => string;
  signalProcessGroup: (processGroupId: number, signal: NodeJS.Signals) => void;
  vaultSecretRoot: string;
  openCodeConfigPath: string;
  openCodeAuthPath: string;
}

interface EventExecutionContext {
  deliveryId: string;
  attemptNumber: number;
  leaseToken: string;
  leaseRevision: number;
}

interface ProcessTrackingEvent {
  event: string;
  detail: string;
  at: number;
}

interface OwnedDetachedRun {
  runId: string;
  runNonceHash: string;
  processGroupId: number;
  leader: JobProcessIdentity | null;
  initialGroupMembers: JobProcessIdentity[];
  lastObservedGroupMembers: JobProcessIdentity[];
  knownMembers: Map<number, JobProcessIdentity>;
  events: ProcessTrackingEvent[];
}

interface VaultSecretRunFiles {
  projectId: string;
  root: string;
  runDir: string;
  itemIds: string[];
  resolution: vault.VaultJobSecretsResolution;
  runtime: VaultOpenCodeRuntime;
}

interface VaultOpenCodeRuntime {
  home: string;
  config: string;
  data: string;
  cache: string;
  state: string;
  tmp: string;
}

class VaultSecretStorageError extends Error {
  constructor() {
    super("VAULT_SECRET_STORAGE_UNAVAILABLE");
    this.name = "VaultSecretStorageError";
  }
}

/** Read-only diagnostic shape exposed only for colocated deterministic tests. */
export interface OwnedDetachedRunDiagnostic {
  runId: string;
  runNonceHash: string;
  processGroupId: number;
  leader: JobProcessIdentity | null;
  initialGroupMembers: JobProcessIdentity[];
  lastObservedGroupMembers: JobProcessIdentity[];
  events: ProcessTrackingEvent[];
}

const ownedDetachedRuns = new Map<string, OwnedDetachedRun>();

function cloneIdentity(identity: JobProcessIdentity): JobProcessIdentity {
  return { ...identity };
}

function parseProcStat(processId: number, raw: string): Omit<JobProcessIdentity, "executable" | "runNonce"> | null {
  const openParen = raw.indexOf("(");
  const closeParen = raw.lastIndexOf(")");
  if (openParen <= 0 || closeParen <= openParen) return null;

  const parsedProcessId = Number(raw.slice(0, openParen).trim());
  const fields = raw.slice(closeParen + 1).trim().split(/\s+/);
  // The first field here is stat field 3 (state). pgrp/session/starttime are
  // stat fields 5/6/22, at indexes 2/3/19 respectively.
  const processGroupId = Number(fields[2]);
  const sessionId = Number(fields[3]);
  const startTime = fields[19];
  if (
    parsedProcessId !== processId
    || !Number.isSafeInteger(processGroupId)
    || processGroupId <= 0
    || !Number.isSafeInteger(sessionId)
    || sessionId <= 0
    || !startTime
  ) {
    return null;
  }

  return { processId, processGroupId, sessionId, startTime };
}

function readRunNonce(environment: string): string | undefined {
  const prefix = `${RUN_NONCE_ENV}=`;
  return environment.split("\0").find((entry) => entry.startsWith(prefix))?.slice(prefix.length) || undefined;
}

interface ParsedProcStatFields {
  processId: number;
  processGroupId: number;
  sessionId: number;
  startTime: string | undefined;
}

function parseProcStatFields(processId: number, raw: string): ParsedProcStatFields | null {
  const openParen = raw.indexOf("(");
  const closeParen = raw.lastIndexOf(")");
  if (openParen <= 0 || closeParen <= openParen) return null;

  const parsedProcessId = Number(raw.slice(0, openParen).trim());
  const fields = raw.slice(closeParen + 1).trim().split(/\s+/);
  const processGroupId = Number(fields[2]);
  const sessionId = Number(fields[3]);
  if (
    parsedProcessId !== processId
    || !Number.isSafeInteger(processGroupId)
    || !Number.isSafeInteger(sessionId)
  ) {
    return null;
  }
  return { processId, processGroupId, sessionId, startTime: fields[19] };
}

function isProcfsRace(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { code?: unknown }).code === "ENOENT" || (error as { code?: unknown }).code === "ESRCH");
}

export interface ProcfsAccessForTesting {
  listProcessIds(): readonly number[];
  lstatProcess(processId: number): { uid: number };
  readProcessStat(processId: number): string;
  readProcessExecutable(processId: number): string;
  readProcessEnvironment(processId: number): string;
}

const linuxProcfsAccess: ProcfsAccessForTesting = {
  listProcessIds: () => readdirSync("/proc", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name)),
  lstatProcess: (processId) => lstatSync(`/proc/${processId}`),
  readProcessStat: (processId) => readFileSync(`/proc/${processId}/stat`, "utf-8"),
  readProcessExecutable: (processId) => readlinkSync(`/proc/${processId}/exe`),
  readProcessEnvironment: (processId) => readFileSync(`/proc/${processId}/environ`, "utf-8"),
};

function inspectLinuxStatFromProcfs(
  procfs: ProcfsAccessForTesting,
  processId: number,
): Omit<JobProcessIdentity, "executable" | "runNonce" | "ownerId"> | null {
  try {
    return parseProcStat(processId, procfs.readProcessStat(processId));
  } catch {
    return null;
  }
}

function inspectLinuxProcessFromStat(
  procfs: ProcfsAccessForTesting,
  stat: Omit<JobProcessIdentity, "executable" | "runNonce" | "ownerId">,
  ownerId: number,
): JobProcessIdentity | null {
  try {
    const executable = procfs.readProcessExecutable(stat.processId);
    const runNonce = readRunNonce(procfs.readProcessEnvironment(stat.processId));
    if (!executable) return null;
    return { ...stat, executable, runNonce, ownerId };
  } catch {
    return null;
  }
}

/**
 * Return procfs identity data. A missing nonce is retained as an explicit
 * untrusted identity so group validation can reject that member; unreadable
 * stat, executable, or environment data remains unavailable.
 */
function inspectLinuxProcess(processId: number): JobProcessIdentity | null {
  if (process.platform !== "linux" || !Number.isSafeInteger(processId) || processId <= 0) return null;

  try {
    const ownerId = linuxProcfsAccess.lstatProcess(processId).uid;
    const stat = inspectLinuxStatFromProcfs(linuxProcfsAccess, processId);
    return stat ? inspectLinuxProcessFromStat(linuxProcfsAccess, stat, ownerId) : null;
  } catch {
    return null;
  }
}

/** Find only same-UID processes carrying an exact hash-matched run nonce. */
function findLinuxProcessesByNonceHash(nonceHash: string): JobProcessIdentity[] | null {
  if (process.platform !== "linux" || !/^[0-9a-f]{64}$/.test(nonceHash)) return null;
  let owner: number;
  try {
    owner = processOwnerId();
  } catch {
    return null;
  }
  try {
    const matches: JobProcessIdentity[] = [];
    for (const entry of readdirSync("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const processId = Number(entry.name);
      let metadata: ReturnType<typeof lstatSync>;
      try {
        metadata = lstatSync(`/proc/${processId}`);
      } catch {
        continue;
      }
      if (metadata.uid !== owner) continue;
      const identity = inspectLinuxProcess(processId);
      if (identity && identity.ownerId === owner && hashNonce(identity.runNonce) === nonceHash) matches.push(identity);
    }
    return matches;
  } catch {
    return null;
  }
}

function inspectLinuxGroup(
  processGroupId: number,
  runnerOwnerId: number,
  procfs: ProcfsAccessForTesting,
): JobProcessGroup | null {
  if (!Number.isSafeInteger(processGroupId) || processGroupId <= 0) return null;

  let processIds: readonly number[];
  try {
    processIds = procfs.listProcessIds();
  } catch {
    return null;
  }

  const members: JobProcessIdentity[] = [];
  let groupSessionId: number | undefined;
  for (const processId of processIds) {
    if (!Number.isSafeInteger(processId) || processId <= 0) continue;

    // Ownership is checked before any procfs content read. This lets unrelated
    // root/kernel entries be ignored without treating their unreadability as an
    // ambiguity in the runner-owned detached group.
    let metadata: { uid: number };
    try {
      metadata = procfs.lstatProcess(processId);
    } catch (error) {
      if (isProcfsRace(error)) continue;
      return null;
    }
    if (metadata.uid !== runnerOwnerId) continue;

    let rawStat: string;
    try {
      rawStat = procfs.readProcessStat(processId);
    } catch (error) {
      // A known leader that becomes unreadable is ambiguous, as is any
      // same-UID process whose group membership cannot be established.
      if (isProcfsRace(error)) continue;
      return null;
    }
    const parsed = parseProcStatFields(processId, rawStat);
    if (!parsed) return null;
    // Kernel entries with PGID zero cannot belong to a real detached group.
    if (parsed.processGroupId === 0) continue;
    if (parsed.processGroupId !== processGroupId) continue;

    const stat = parseProcStat(processId, rawStat);
    if (!stat) return null;
    if (groupSessionId === undefined) groupSessionId = stat.sessionId;
    else if (groupSessionId !== stat.sessionId) return null;

    const identity = inspectLinuxProcessFromStat(procfs, stat, metadata.uid);
    if (!identity) return null;
    members.push(identity);
  }
  return { processGroupId, members };
}

/** Test-only procfs seam for ownership/race semantics without live process signals. */
export function inspectLinuxProcessGroupForTesting(
  processGroupId: number,
  runnerOwnerId: number,
  procfs: ProcfsAccessForTesting,
): JobProcessGroup | null {
  return inspectLinuxGroup(processGroupId, runnerOwnerId, procfs);
}

const linuxProcessInspector: JobProcessInspector = {
  inspectProcess: inspectLinuxProcess,
  inspectGroup(processGroupId): JobProcessGroup | null {
    if (process.platform !== "linux") return null;
    try {
      return inspectLinuxGroup(processGroupId, processOwnerId(), linuxProcfsAccess);
    } catch {
      return null;
    }
  },
};

const defaultJobRunnerRuntime: JobRunnerRuntime = {
  processInspector: linuxProcessInspector,
  findProcessesByNonceHash: findLinuxProcessesByNonceHash,
  createRunNonce: randomUUID,
  signalProcessGroup(processGroupId, signal): void {
    process.kill(-processGroupId, signal);
  },
  vaultSecretRoot: VAULT_JOB_SECRET_ROOT,
  openCodeConfigPath: VAULT_OPENCODE_CONFIG_SOURCE,
  openCodeAuthPath: VAULT_OPENCODE_AUTH_SOURCE,
};

let jobRunnerRuntime = defaultJobRunnerRuntime;

/**
 * Test seam for a deterministic procfs view and signal sink. Production code
 * always uses the default runtime above.
 */
export function configureJobRunnerRuntimeForTesting(overrides: Partial<JobRunnerRuntime>): () => void {
  const previous = jobRunnerRuntime;
  jobRunnerRuntime = { ...jobRunnerRuntime, ...overrides };
  return () => {
    jobRunnerRuntime = previous;
  };
}

function processOwnerId(): number {
  const owner = process.getuid?.();
  if (typeof owner !== "number" || !Number.isSafeInteger(owner) || owner < 0) throw new VaultSecretStorageError();
  return owner;
}

function hasExactMode(stat: { mode: number }, mode: number): boolean {
  return (stat.mode & 0o777) === mode;
}

function assertVaultSecretRoot(): string {
  const root = jobRunnerRuntime.vaultSecretRoot;
  if (!isAbsolute(root) || root !== resolve(root)) throw new VaultSecretStorageError();
  const owner = processOwnerId();
  let rootStat: ReturnType<typeof lstatSync>;
  try {
    rootStat = lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== owner || !hasExactMode(rootStat, 0o700)) {
      throw new VaultSecretStorageError();
    }
    const fsType = Number(statfsSync(root).type);
    if (!Number.isSafeInteger(fsType) || fsType !== TMPFS_MAGIC) throw new VaultSecretStorageError();
    const noFollow = fsConstants.O_NOFOLLOW;
    const directory = fsConstants.O_DIRECTORY;
    if (typeof noFollow !== "number" || typeof directory !== "number") throw new VaultSecretStorageError();
    const descriptor = openSync(root, fsConstants.O_RDONLY | directory | noFollow);
    try {
      const opened = fstatSync(descriptor);
      if (!opened.isDirectory() || opened.uid !== owner || !hasExactMode(opened, 0o700)) throw new VaultSecretStorageError();
    } finally {
      closeSync(descriptor);
    }
    return root;
  } catch (error) {
    if (error instanceof VaultSecretStorageError) throw error;
    throw new VaultSecretStorageError();
  }
}

function strictRunDirectory(root: string, runId: string): string {
  if (!RUN_UUID_PATTERN.test(runId)) throw new VaultSecretStorageError();
  const rootPath = resolve(root);
  const runDir = resolve(rootPath, runId);
  if (!runDir.startsWith(`${rootPath}${sep}`) || runDir !== join(rootPath, runId)) throw new VaultSecretStorageError();
  return runDir;
}

function assertPrivateDirectory(path: string, owner: number): void {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== owner || !hasExactMode(metadata, 0o700)) {
    throw new VaultSecretStorageError();
  }
}

function createPrivateDirectory(path: string, owner: number): void {
  mkdirSync(path, { mode: 0o700 });
  chmodSync(path, 0o700);
  assertPrivateDirectory(path, owner);
}

function readPrivateRuntimeSource(path: string, maxBytes: number): Buffer {
  const owner = processOwnerId();
  let descriptor: number | undefined;
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== owner
      || !hasExactMode(metadata, 0o600) || metadata.nlink !== 1 || metadata.size < 1 || metadata.size > maxBytes) {
      throw new VaultSecretStorageError();
    }
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.uid !== owner || !hasExactMode(opened, 0o600)
      || opened.nlink !== 1 || opened.size < 1 || opened.size > maxBytes) throw new VaultSecretStorageError();
    const content = readFileSync(descriptor);
    if (content.length < 1 || content.length > maxBytes) {
      content.fill(0);
      throw new VaultSecretStorageError();
    }
    return content;
  } catch (error) {
    if (error instanceof VaultSecretStorageError) throw error;
    throw new VaultSecretStorageError();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function stripJsoncComments(input: string): string {
  let output = "";
  let quote = "";
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const current = input[index]!;
    const next = input[index + 1];
    if (quote) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (current === '"') {
      quote = current;
      output += current;
      continue;
    }
    if (current === "/" && next === "/") {
      index += 1;
      while (index + 1 < input.length && input[index + 1] !== "\n" && input[index + 1] !== "\r") index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      index += 1;
      while (index + 1 < input.length && !(input[index] === "*" && input[index + 1] === "/")) index += 1;
      if (index + 1 >= input.length) throw new VaultSecretStorageError();
      index += 1;
      continue;
    }
    output += current;
  }
  if (quote) throw new VaultSecretStorageError();
  return output;
}

function removeJsoncTrailingCommas(input: string): string {
  let output = "";
  let quote = "";
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const current = input[index]!;
    if (quote) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (current === '"') {
      quote = current;
      output += current;
      continue;
    }
    if (current === ",") {
      let next = index + 1;
      while (next < input.length && /\s/.test(input[next]!)) next += 1;
      if (input[next] === "}" || input[next] === "]") continue;
    }
    output += current;
  }
  if (quote) throw new VaultSecretStorageError();
  return output;
}

/** Keep provider/model/agent settings while dropping plugins and MCP persistence paths. */
function isolateOpenCodeConfig(source: Buffer): Buffer {
  try {
    const parsed = JSON.parse(removeJsoncTrailingCommas(stripJsoncComments(source.toString("utf8"))));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new VaultSecretStorageError();
    const config = parsed as Record<string, unknown>;
    const isolated: Record<string, unknown> = {};
    for (const key of ["$schema", "provider", "model", "agent", "permission"]) {
      if (Object.hasOwn(config, key)) isolated[key] = config[key];
    }
    return Buffer.from(`${JSON.stringify(isolated)}\n`, "utf8");
  } catch (error) {
    if (error instanceof VaultSecretStorageError) throw error;
    throw new VaultSecretStorageError();
  } finally {
    source.fill(0);
  }
}

function writePrivateRuntimeFile(path: string, value: Buffer): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      path,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    let offset = 0;
    while (offset < value.length) {
      const written = writeSync(descriptor, value, offset, value.length - offset);
      if (written <= 0) throw new VaultSecretStorageError();
      offset += written;
    }
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    value.fill(0);
  }
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || !hasExactMode(metadata, 0o600) || metadata.nlink !== 1) {
    throw new VaultSecretStorageError();
  }
}

function createVaultOpenCodeRuntime(runDir: string, owner: number): VaultOpenCodeRuntime {
  const runtime: VaultOpenCodeRuntime = {
    home: join(runDir, "home"),
    config: join(runDir, "config"),
    data: join(runDir, "data"),
    cache: join(runDir, "cache"),
    state: join(runDir, "state"),
    tmp: join(runDir, "tmp"),
  };
  const configSource = readPrivateRuntimeSource(jobRunnerRuntime.openCodeConfigPath, VAULT_CONFIG_MAX_BYTES);
  let isolatedConfig: Buffer | undefined;
  let authSource: Buffer | undefined;
  try {
    isolatedConfig = isolateOpenCodeConfig(configSource);
    authSource = readPrivateRuntimeSource(jobRunnerRuntime.openCodeAuthPath, VAULT_AUTH_MAX_BYTES);
    for (const directory of VAULT_RUNTIME_DIRECTORIES) createPrivateDirectory(join(runDir, directory), owner);
    const configDirectory = join(runtime.config, "opencode");
    const dataDirectory = join(runtime.data, "opencode");
    createPrivateDirectory(configDirectory, owner);
    createPrivateDirectory(dataDirectory, owner);
    writePrivateRuntimeFile(join(configDirectory, "opencode.jsonc"), isolatedConfig);
    isolatedConfig = undefined;
    writePrivateRuntimeFile(join(dataDirectory, "auth.json"), authSource);
    authSource = undefined;
    return runtime;
  } finally {
    configSource.fill(0);
    isolatedConfig?.fill(0);
    authSource?.fill(0);
  }
}

function validateVaultOpenCodeSources(): void {
  const configSource = readPrivateRuntimeSource(jobRunnerRuntime.openCodeConfigPath, VAULT_CONFIG_MAX_BYTES);
  let isolated: Buffer | undefined;
  let authSource: Buffer | undefined;
  try {
    isolated = isolateOpenCodeConfig(configSource);
    authSource = readPrivateRuntimeSource(jobRunnerRuntime.openCodeAuthPath, VAULT_AUTH_MAX_BYTES);
  } finally {
    configSource.fill(0);
    isolated?.fill(0);
    authSource?.fill(0);
  }
}

type VaultRunDirectoryState = "absent" | "complete" | "safe_partial" | "unsafe";

interface InspectedVaultSecretDirectory {
  state: VaultRunDirectoryState;
  itemIds: string[];
}

function vaultRunChild(runDir: string, name: string): string {
  const path = join(runDir, name);
  if (resolve(path) !== path || !path.startsWith(`${runDir}${sep}`)) throw new VaultSecretStorageError();
  return path;
}

function isExpectedPrivateDirectory(path: string, owner: number): boolean {
  try {
    const metadata = lstatSync(path);
    return metadata.isDirectory()
      && !metadata.isSymbolicLink()
      && metadata.uid === owner
      && hasExactMode(metadata, 0o700)
      && Number.isSafeInteger(metadata.nlink)
      && metadata.nlink >= 2;
  } catch {
    return false;
  }
}

function isExpectedPrivateFile(path: string, owner: number, minBytes: number, maxBytes: number): boolean {
  try {
    const metadata = lstatSync(path);
    return metadata.isFile()
      && !metadata.isSymbolicLink()
      && metadata.uid === owner
      && hasExactMode(metadata, 0o600)
      && metadata.nlink === 1
      && Number.isSafeInteger(metadata.size)
      && metadata.size >= minBytes
      && metadata.size <= maxBytes;
  } catch {
    return false;
  }
}

/** Validate only the known pre-spawn XDG subtree; missing materialization is safe. */
function inspectVaultRuntimeDirectory(runDir: string, name: string, owner: number): boolean | null {
  const directory = vaultRunChild(runDir, name);
  if (!isExpectedPrivateDirectory(directory, owner)) return null;
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return null;
  }
  if (entries.length !== new Set(entries).size) return null;

  if (name !== "config" && name !== "data") return entries.length === 0;
  if (entries.some((entry) => entry !== "opencode")) return null;
  if (entries.length === 0) return false;

  const opencodeDirectory = vaultRunChild(directory, "opencode");
  if (!isExpectedPrivateDirectory(opencodeDirectory, owner)) return null;
  let nestedEntries: string[];
  try {
    nestedEntries = readdirSync(opencodeDirectory);
  } catch {
    return null;
  }
  if (nestedEntries.some((entry) => entry !== (name === "config" ? "opencode.jsonc" : "auth.json"))) return null;
  if (nestedEntries.length === 0) return false;
  const fileName = name === "config" ? "opencode.jsonc" : "auth.json";
  const maxBytes = name === "config" ? VAULT_CONFIG_MAX_BYTES : VAULT_AUTH_MAX_BYTES;
  return isExpectedPrivateFile(vaultRunChild(opencodeDirectory, fileName), owner, 1, maxBytes);
}

function inspectVaultSecretDirectory(
  root: string,
  runId: string,
  allowedItemIds: ReadonlySet<string>,
): InspectedVaultSecretDirectory {
  const owner = processOwnerId();
  let runDir: string;
  try {
    runDir = strictRunDirectory(root, runId);
    const directory = lstatSync(runDir);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== owner
      || !hasExactMode(directory, 0o700) || !Number.isSafeInteger(directory.nlink) || directory.nlink < 2) {
      return { state: "unsafe", itemIds: [] };
    }
    const entries = readdirSync(runDir, { withFileTypes: true });
    const itemIds: string[] = [];
    let complete = true;
    for (const entry of entries) {
      if (VAULT_RUNTIME_DIRECTORY_SET.has(entry.name)) {
        continue;
      }
      if (!RUN_UUID_PATTERN.test(entry.name) || !allowedItemIds.has(entry.name)) return { state: "unsafe", itemIds: [] };
      if (!isExpectedPrivateFile(vaultRunChild(runDir, entry.name), owner, 0, VAULT_SECRET_MAX_BYTES)) {
        return { state: "unsafe", itemIds: [] };
      }
      itemIds.push(entry.name);
    }
    if (itemIds.length !== allowedItemIds.size) complete = false;
    for (const directoryName of VAULT_RUNTIME_DIRECTORIES) {
      if (!entries.some((entry) => entry.name === directoryName)) {
        complete = false;
        continue;
      }
      const runtimeComplete = inspectVaultRuntimeDirectory(runDir, directoryName, owner);
      if (runtimeComplete === null) return { state: "unsafe", itemIds: [] };
      complete &&= runtimeComplete;
    }
    return { state: complete ? "complete" : "safe_partial", itemIds };
  } catch (error) {
    if (isProcfsRace(error)) return { state: "absent", itemIds: [] };
    return { state: "unsafe", itemIds: [] };
  }
}

function removeExpectedPrivateFile(path: string, owner: number, minBytes: number, maxBytes: number): boolean {
  try {
    lstatSync(path);
  } catch (error) {
    return isProcfsRace(error);
  }
  if (!isExpectedPrivateFile(path, owner, minBytes, maxBytes)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

function removeExpectedPrivateDirectory(path: string, owner: number): boolean {
  try {
    lstatSync(path);
  } catch (error) {
    return isProcfsRace(error);
  }
  if (!isExpectedPrivateDirectory(path, owner)) return false;
  try {
    rmdirSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Delete only a freshly revalidated exact safe directory, never an open-ended tree. */
function removeSafeVaultSecretDirectory(
  root: string,
  runId: string,
  itemIds: readonly string[],
  verifyBeforeDelete: () => boolean = () => true,
): boolean {
  const expected = new Set(itemIds);
  const inspected = inspectVaultSecretDirectory(root, runId, expected);
  if ((inspected.state !== "complete" && inspected.state !== "safe_partial")
    || inspected.itemIds.some((itemId) => !expected.has(itemId))) return false;
  // Fence the scan-to-delete window. The second inspection must still prove a
  // bounded, known-only tree immediately before removing any secret file.
  const confirmed = inspectVaultSecretDirectory(root, runId, expected);
  if ((confirmed.state !== "complete" && confirmed.state !== "safe_partial")
    || confirmed.itemIds.some((itemId) => !expected.has(itemId))) return false;
  if (!verifyBeforeDelete()) return false;
  try {
    const runDir = strictRunDirectory(root, runId);
    const owner = processOwnerId();
    for (const itemId of confirmed.itemIds) {
      if (!removeExpectedPrivateFile(vaultRunChild(runDir, itemId), owner, 0, VAULT_SECRET_MAX_BYTES)) return false;
    }
    for (const [directoryName, fileName, maxBytes] of [
      ["config", "opencode.jsonc", VAULT_CONFIG_MAX_BYTES],
      ["data", "auth.json", VAULT_AUTH_MAX_BYTES],
    ] as const) {
      const runtimeDirectory = vaultRunChild(runDir, directoryName);
      const opencodeDirectory = vaultRunChild(runtimeDirectory, "opencode");
      if (!removeExpectedPrivateFile(vaultRunChild(opencodeDirectory, fileName), owner, 1, maxBytes)) return false;
      if (!removeExpectedPrivateDirectory(opencodeDirectory, owner)) return false;
    }
    for (const directoryName of VAULT_RUNTIME_DIRECTORIES) {
      if (!removeExpectedPrivateDirectory(vaultRunChild(runDir, directoryName), owner)) return false;
    }
    return removeExpectedPrivateDirectory(runDir, owner);
  } catch {
    return false;
  }
}

function retainVaultSecretDirectory(): void {
  logger.warn("job-runner", "Vault secret directory retained because integrity checks failed");
}

function createVaultSecretRunFiles(
  projectId: string,
  runId: string,
  resolution: vault.VaultJobSecretsResolution,
): VaultSecretRunFiles {
  let root: string | undefined;
  let runDir: string | undefined;
  let owner: number | undefined;
  const itemIds: string[] = [];
  let createdDirectory = false;
  try {
    // Fail before creating tmpfs state when a persistent source is unavailable,
    // malformed, linked, oversized, or too broadly readable.
    validateVaultOpenCodeSources();
    root = assertVaultSecretRoot();
    runDir = strictRunDirectory(root, runId);
    owner = processOwnerId();
    mkdirSync(runDir, { mode: 0o700 });
    createdDirectory = true;
    chmodSync(runDir, 0o700);
    const runDirectory = lstatSync(runDir);
    if (!runDirectory.isDirectory() || runDirectory.isSymbolicLink() || runDirectory.uid !== owner || !hasExactMode(runDirectory, 0o700)) {
      throw new VaultSecretStorageError();
    }

    const runtime = createVaultOpenCodeRuntime(runDir, owner);

    for (const secret of resolution.secrets) {
      if (!RUN_UUID_PATTERN.test(secret.itemId) || itemIds.includes(secret.itemId)
        || secret.value.length > VAULT_SECRET_MAX_BYTES) throw new VaultSecretStorageError();
      const filePath = join(runDir, secret.itemId);
      if (resolve(filePath) !== filePath) throw new VaultSecretStorageError();
      const descriptor = openSync(
        filePath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        0o600,
      );
      itemIds.push(secret.itemId);
      try {
        let offset = 0;
        while (offset < secret.value.length) {
          const written = writeSync(descriptor, secret.value, offset, secret.value.length - offset);
          if (written <= 0) throw new VaultSecretStorageError();
          offset += written;
        }
        secret.value.fill(0);
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      const file = lstatSync(filePath);
      if (!file.isFile() || file.isSymbolicLink() || file.uid !== owner || !hasExactMode(file, 0o600) || file.nlink !== 1) {
        throw new VaultSecretStorageError();
      }
    }

    const directoryDescriptor = openSync(runDir, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
    const run = { projectId, root, runDir, itemIds, resolution, runtime };
    vaultSecretRuns.set(runId, run);
    return run;
  } catch {
    resolution.release();
    if (createdDirectory && root && removeSafeVaultSecretDirectory(root, runId, itemIds)) {
      jobs.markVaultJobRunCleaned(projectId, runId);
    } else {
      jobs.markVaultJobRunTeardownPending(projectId, runId);
      if (createdDirectory) retainVaultSecretDirectory();
    }
    throw new VaultSecretStorageError();
  }
}

function vaultSecretFileMap(run: VaultSecretRunFiles): Record<string, string> {
  const paths: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const itemId of run.itemIds) {
    const path = join(run.runDir, itemId);
    if (!RUN_UUID_PATTERN.test(itemId) || !isAbsolute(path) || resolve(path) !== path) throw new VaultSecretStorageError();
    paths[itemId] = path;
  }
  return paths;
}

function cleanupVaultSecretRun(runId: string): boolean {
  const run = vaultSecretRuns.get(runId);
  if (!run) return false;
  vaultSecretRuns.delete(runId);
  run.resolution.release();
  if (removeSafeVaultSecretDirectory(run.root, runId, run.itemIds)) {
    jobs.markVaultJobRunCleaned(run.projectId, runId);
    return true;
  }
  jobs.markVaultJobRunFailed(run.projectId, runId);
  retainVaultSecretDirectory();
  return false;
}

/** Return immutable tracking evidence for a run while teardown remains unverified. */
export function getOwnedDetachedRunDiagnosticForTesting(runId: string): OwnedDetachedRunDiagnostic | undefined {
  const tracked = ownedDetachedRuns.get(runId);
  if (!tracked) return undefined;
  return {
    runId: tracked.runId,
    runNonceHash: tracked.runNonceHash,
    processGroupId: tracked.processGroupId,
    leader: tracked.leader ? cloneIdentity(tracked.leader) : null,
    initialGroupMembers: tracked.initialGroupMembers.map(cloneIdentity),
    lastObservedGroupMembers: tracked.lastObservedGroupMembers.map(cloneIdentity),
    events: tracked.events.map((event) => ({ ...event })),
  };
}

/** Reset module state between deterministic unit tests. */
export function resetJobRunnerForTesting(): void {
  for (const timer of forceKillTimers.values()) clearTimeout(timer);
  for (const timer of groupRecoveryTimers.values()) clearTimeout(timer);
  for (const runId of vaultSecretRuns.keys()) cleanupVaultSecretRun(runId);
  activeRunCount = 0;
  runningProcesses.clear();
  runProjects.clear();
  eventRunContexts.clear();
  forceKillTimers.clear();
  closePromises.clear();
  terminationCompletions.clear();
  resolveEscalations.clear();
  groupRecoveryTimers.clear();
  teardownAttempts.clear();
  vaultRedactionRuns.clear();
  ownedDetachedRuns.clear();
  recoveredVaultRuns.clear();
  vaultRecoveryInFlight = null;
  jobRunnerRuntime = defaultJobRunnerRuntime;
}

function isProcessRunning(proc: ChildProcess): boolean {
  return proc.exitCode === null && proc.signalCode === null;
}

function recordTrackingEvent(tracked: OwnedDetachedRun, event: string, detail: string): void {
  tracked.events.push({ event, detail, at: Date.now() });
}

function clearGroupRecoveryTimer(runId: string): void {
  const timer = groupRecoveryTimers.get(runId);
  if (timer) clearTimeout(timer);
  groupRecoveryTimers.delete(runId);
}

function clearForceKillTimer(runId: string): void {
  const timer = forceKillTimers.get(runId);
  if (timer) clearTimeout(timer);
  forceKillTimers.delete(runId);
  const resolveEscalation = resolveEscalations.get(runId);
  resolveEscalations.delete(runId);
  resolveEscalation?.();
}

function matchesIdentity(actual: JobProcessIdentity, expected: JobProcessIdentity): boolean {
  return actual.processId === expected.processId
    && actual.processGroupId === expected.processGroupId
    && actual.sessionId === expected.sessionId
    && actual.startTime === expected.startTime
    && actual.executable === expected.executable
    && hashNonce(actual.runNonce) === hashNonce(expected.runNonce);
}

function hasExpectedNonce(member: JobProcessIdentity, tracked: OwnedDetachedRun): boolean {
  return member.processGroupId === tracked.processGroupId
    && member.sessionId === tracked.leader?.sessionId
    && member.ownerId === tracked.leader?.ownerId
    && hashNonce(member.runNonce) === tracked.runNonceHash;
}

type OwnedGroupVerification =
  | { status: "trusted"; members: JobProcessIdentity[] }
  | { status: "empty" }
  | { status: "unverified"; reason: string };

/**
 * Validate the PGID immediately before every group signal. A group remains
 * safe after the leader exits only if every visible member carries the run's
 * nonce and every previously observed PID still has the same start time and
 * executable. Unknown or recycled identities are never signalled.
 */
function revalidateOwnedGroup(tracked: OwnedDetachedRun): OwnedGroupVerification {
  if (!tracked.leader) {
    recordTrackingEvent(tracked, "group-unverified", "leader-identity-unavailable");
    return { status: "unverified", reason: "leader-identity-unavailable" };
  }

  const group = jobRunnerRuntime.processInspector.inspectGroup(tracked.processGroupId);
  if (!group || group.processGroupId !== tracked.processGroupId) {
    recordTrackingEvent(tracked, "group-unverified", "procfs-group-unavailable");
    return { status: "unverified", reason: "procfs-group-unavailable" };
  }

  const members = group.members.map(cloneIdentity);
  tracked.lastObservedGroupMembers = members;
  if (members.length === 0) return { status: "empty" };

  if (!members.every((member) => hasExpectedNonce(member, tracked))) {
    recordTrackingEvent(tracked, "group-unverified", "unexpected-group-member");
    return { status: "unverified", reason: "unexpected-group-member" };
  }

  for (const member of members) {
    const previouslyObserved = tracked.knownMembers.get(member.processId);
    if (previouslyObserved && !matchesIdentity(member, previouslyObserved)) {
      recordTrackingEvent(tracked, "group-unverified", "process-identity-reused");
      return { status: "unverified", reason: "process-identity-reused" };
    }
  }

  // The leader may have exited, but any surviving descendant inherited the
  // nonce. Only after all current members have passed validation do we record
  // new descendant identities for later reuse checks.
  for (const member of members) tracked.knownMembers.set(member.processId, cloneIdentity(member));
  return { status: "trusted", members };
}

function scheduleGroupRecovery(tracked: OwnedDetachedRun): void {
  if (groupRecoveryTimers.has(tracked.runId)) return;

  const timer = setTimeout(() => {
    groupRecoveryTimers.delete(tracked.runId);
    const current = ownedDetachedRuns.get(tracked.runId);
    if (!current) return;
    if (!verifyOwnedGroupTeardown(current)) scheduleGroupRecovery(current);
  }, JOB_GROUP_RECOVERY_INTERVAL_MS);
  // Diagnostic recovery must not keep a shutting-down API process alive.
  timer.unref?.();
  groupRecoveryTimers.set(tracked.runId, timer);
}

/**
 * Do not discard ownership data merely because the ChildProcess leader closed.
 * It is removed only after a complete procfs inspection sees the owned group
 * empty. Any ambiguous/recycled group remains as recovery evidence and is not
 * touched by this runner.
 */
function verifyOwnedGroupTeardown(tracked: OwnedDetachedRun): boolean {
  const verification = revalidateOwnedGroup(tracked);
  if (verification.status === "empty") {
    recordTrackingEvent(tracked, "teardown-verified", "owned-group-empty");
    clearGroupRecoveryTimer(tracked.runId);
    ownedDetachedRuns.delete(tracked.runId);
    finalizeVaultRunAfterVerifiedTeardown(tracked.runId);
    return true;
  }

  if (verification.status === "trusted") {
    recordTrackingEvent(tracked, "teardown-pending", "owned-descendants-remain");
  } else {
    recordTrackingEvent(tracked, "teardown-unverified", verification.reason);
  }
  return false;
}

function trackDetachedProcess(runId: string, processId: number, runNonce: string): void {
  const leader = jobRunnerRuntime.processInspector.inspectProcess(processId);
  const runNonceHash = hashNonce(runNonce);
  if (!runNonceHash) throw new VaultSecretStorageError();
  const tracked: OwnedDetachedRun = {
    runId,
    runNonceHash,
    processGroupId: processId,
    leader: null,
    initialGroupMembers: [],
    lastObservedGroupMembers: [],
    knownMembers: new Map(),
    events: [],
  };

  if (!leader || leader.processGroupId !== processId || hashNonce(leader.runNonce) !== runNonceHash) {
    recordTrackingEvent(tracked, "identity-unverified", "leader-identity-unavailable-or-mismatched");
    ownedDetachedRuns.set(runId, tracked);
    scheduleGroupRecovery(tracked);
    return;
  }

  tracked.leader = cloneIdentity(leader);
  tracked.knownMembers.set(leader.processId, cloneIdentity(leader));
  const group = jobRunnerRuntime.processInspector.inspectGroup(processId);
  if (!group || group.processGroupId !== processId) {
    recordTrackingEvent(tracked, "identity-unverified", "initial-group-unavailable");
  } else {
    tracked.initialGroupMembers = group.members.map(cloneIdentity);
    tracked.lastObservedGroupMembers = group.members.map(cloneIdentity);
    if (
      group.members.some((member) => matchesIdentity(member, leader))
      && group.members.every((member) => hasExpectedNonce(member, tracked))
    ) {
      for (const member of group.members) tracked.knownMembers.set(member.processId, cloneIdentity(member));
      recordTrackingEvent(tracked, "identity-captured", "leader-and-initial-group-validated");
    } else {
      recordTrackingEvent(tracked, "identity-unverified", "initial-group-membership-mismatched");
    }
  }

  ownedDetachedRuns.set(runId, tracked);
}

type NonceRecoverySelection =
  | { status: "absent" }
  | { status: "ambiguous" }
  | { status: "trusted"; leader: JobProcessIdentity };

/**
 * A nonce is inherited by descendants, so a crash-gap scan normally returns a
 * complete process group rather than one process. Accept only one owned
 * PGID/session with exactly one live group leader; later group inspection
 * validates every member immediately before signalling.
 */
function selectNonceRecoveryGroup(
  candidates: readonly JobProcessIdentity[],
  nonceHash: string,
): NonceRecoverySelection {
  if (candidates.length === 0) return { status: "absent" };

  let runnerOwnerId: number;
  try {
    runnerOwnerId = processOwnerId();
  } catch {
    return { status: "ambiguous" };
  }

  const groups = new Map<string, JobProcessIdentity[]>();
  const processIds = new Set<number>();
  for (const candidate of candidates) {
    if (
      candidate.ownerId !== runnerOwnerId
      || !Number.isSafeInteger(candidate.processId)
      || candidate.processId <= 0
      || !Number.isSafeInteger(candidate.processGroupId)
      || candidate.processGroupId <= 0
      || !Number.isSafeInteger(candidate.sessionId)
      || candidate.sessionId <= 0
      || !candidate.startTime
      || !candidate.executable
      || hashNonce(candidate.runNonce) !== nonceHash
      || processIds.has(candidate.processId)
    ) {
      return { status: "ambiguous" };
    }
    processIds.add(candidate.processId);
    const groupKey = `${candidate.processGroupId}:${candidate.sessionId}`;
    const group = groups.get(groupKey) ?? [];
    group.push(candidate);
    groups.set(groupKey, group);
  }
  if (groups.size !== 1) return { status: "ambiguous" };

  const group = groups.values().next().value;
  if (!group) return { status: "ambiguous" };
  const leaders = group.filter((candidate) => candidate.processId === candidate.processGroupId);
  const [leader] = leaders;
  if (leaders.length !== 1 || !leader) return { status: "ambiguous" };
  return { status: "trusted", leader: cloneIdentity(leader) };
}

/** Recover tracking only after nonce descendants resolve to one verified group leader. */
function trackRecoveredDetachedProcess(
  recovery: jobs.VaultSecretRunRecovery,
  leader: JobProcessIdentity,
): OwnedDetachedRun | undefined {
  if (hashNonce(leader.runNonce) !== recovery.processNonceHash) return undefined;
  const tracked: OwnedDetachedRun = {
    runId: recovery.runId,
    runNonceHash: recovery.processNonceHash,
    processGroupId: leader.processGroupId,
    leader: cloneIdentity(leader),
    initialGroupMembers: [],
    lastObservedGroupMembers: [],
    knownMembers: new Map([[leader.processId, cloneIdentity(leader)]]),
    events: [],
  };
  const verification = revalidateOwnedGroup(tracked);
  if (verification.status !== "trusted") return undefined;
  tracked.initialGroupMembers = verification.members.map(cloneIdentity);
  recordTrackingEvent(tracked, "identity-recovered", "nonce-hash-and-group-validated");
  ownedDetachedRuns.set(recovery.runId, tracked);
  return tracked;
}

function markVaultRunTeardownPending(runId: string): void {
  const live = vaultSecretRuns.get(runId);
  const recovery = live ? undefined : recoveredVaultRuns.get(runId);
  const projectId = live?.projectId ?? recovery?.projectId;
  if (projectId) jobs.markVaultJobRunTeardownPending(projectId, runId);
}

function finalizeVaultRunAfterVerifiedTeardown(runId: string): void {
  const live = vaultSecretRuns.get(runId);
  if (live) {
    cleanupVaultSecretRun(runId);
    return;
  }
  const recovery = recoveredVaultRuns.get(runId);
  if (!recovery) return;
  try {
    const root = assertVaultSecretRoot();
    if (removeSafeVaultSecretDirectory(root, runId, recovery.itemSnapshots.map((item) => item.itemId))) {
      jobs.markVaultJobRunCleaned(recovery.projectId, runId);
      recoveredVaultRuns.delete(runId);
      return;
    }
  } catch {
    // A tampered, unavailable, or absent root is retained for the next bounded retry.
  }
  jobs.markVaultJobRunFailed(recovery.projectId, runId);
  retainVaultSecretDirectory();
}

function cleanupVaultSecretRunAfterTeardown(runId: string): void {
  const tracked = ownedDetachedRuns.get(runId);
  if (tracked) {
    markVaultRunTeardownPending(runId);
    if (!verifyOwnedGroupTeardown(tracked)) scheduleGroupRecovery(tracked);
    return;
  }
  cleanupVaultSecretRun(runId);
}

function persistedIdentityMatches(
  recovery: jobs.VaultSecretRunRecovery,
  identity: JobProcessIdentity,
): boolean {
  const persisted = recovery.processIdentity;
  return !!persisted
    && identity.processId === persisted.processId
    && identity.processGroupId === persisted.processGroupId
    && identity.startTime === persisted.processStartTime
    && identity.executable === persisted.processExecutable
    && hashNonce(identity.runNonce) === recovery.processNonceHash;
}

function runDirectoryState(root: string, recovery: jobs.VaultSecretRunRecovery): VaultRunDirectoryState {
  return inspectVaultSecretDirectory(root, recovery.runId, new Set(recovery.itemSnapshots.map((item) => item.itemId))).state;
}

function markRunFailedIfActive(recovery: jobs.VaultSecretRunRecovery): void {
  const run = jobs.getJobRun(recovery.projectId, recovery.runId);
  if (run?.status === "running" || run?.status === "queued") {
    jobs.finishJobRun(recovery.projectId, recovery.runId, "failed", -1);
  }
}

function retainVaultRunRecovery(recovery: jobs.VaultSecretRunRecovery): void {
  if (recovery.state !== "failed") jobs.markVaultJobRunTeardownPending(recovery.projectId, recovery.runId);
  retainVaultSecretDirectory();
}

/** A spawned run needs both a dead leader PID and an empty, readable owned group. */
function hasVerifiedPersistedGroupAbsence(recovery: jobs.VaultSecretRunRecovery): boolean {
  const persisted = recovery.processIdentity;
  if (!persisted || process.platform !== "linux" || existsSync(`/proc/${persisted.processId}`)) return false;
  const group = jobRunnerRuntime.processInspector.inspectGroup(persisted.processGroupId);
  return !!group && group.processGroupId === persisted.processGroupId && group.members.length === 0;
}

/** Re-scan immediately before deletion so a crash-window process race retains files. */
function preparedRunRemainsAbsent(recovery: jobs.VaultSecretRunRecovery): boolean {
  try {
    const candidates = jobRunnerRuntime.findProcessesByNonceHash(recovery.processNonceHash);
    return !!candidates && selectNonceRecoveryGroup(candidates, recovery.processNonceHash).status === "absent";
  } catch {
    return false;
  }
}

function cleanupPreparedVaultDirectory(
  root: string,
  recovery: jobs.VaultSecretRunRecovery,
  directoryState: Exclude<VaultRunDirectoryState, "unsafe">,
): void {
  markRunFailedIfActive(recovery);
  if (directoryState === "absent") {
    jobs.markVaultJobRunCleaned(recovery.projectId, recovery.runId);
    return;
  }
  let processRescanCompleted = false;
  let processStillAbsent = false;
  if (removeSafeVaultSecretDirectory(
    root,
    recovery.runId,
    recovery.itemSnapshots.map((item) => item.itemId),
    () => {
      processRescanCompleted = true;
      processStillAbsent = preparedRunRemainsAbsent(recovery);
      return processStillAbsent;
    },
  )) {
    jobs.markVaultJobRunCleaned(recovery.projectId, recovery.runId);
    return;
  }
  if (processRescanCompleted && !processStillAbsent) {
    retainVaultRunRecovery(recovery);
    return;
  }
  jobs.markVaultJobRunFailed(recovery.projectId, recovery.runId);
  retainVaultSecretDirectory();
}

async function waitForOwnedGroupTeardown(tracked: OwnedDetachedRun, attempts = 5): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (verifyOwnedGroupTeardown(tracked)) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, JOB_GROUP_RECOVERY_INTERVAL_MS));
  }
  return false;
}

async function terminateRecoveredOwnedGroup(tracked: OwnedDetachedRun): Promise<void> {
  markVaultRunTeardownPending(tracked.runId);
  signalOwnedGroup(tracked.runId, "SIGTERM");
  if (await waitForOwnedGroupTeardown(tracked, 1)) return;
  await new Promise<void>((resolve) => setTimeout(resolve, JOB_TERMINATION_GRACE_MS));
  if (verifyOwnedGroupTeardown(tracked)) return;
  signalOwnedGroup(tracked.runId, "SIGKILL");
  if (!await waitForOwnedGroupTeardown(tracked)) {
    markVaultRunTeardownPending(tracked.runId);
    scheduleGroupRecovery(tracked);
  }
}

/** Startup/scheduler recovery uses only immutable run snapshots and nonce hashes. */
async function recoverVaultSecretRunDirectoriesImpl(): Promise<void> {
  let root: string;
  try {
    root = assertVaultSecretRoot();
  } catch {
    return;
  }
  let recoveries: jobs.VaultSecretRunRecovery[];
  try {
    recoveries = jobs.listVaultSecretRunsForRecovery();
  } catch {
    return;
  }
  const expectedRunIds = new Set(recoveries.map((recovery) => recovery.runId));
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !RUN_UUID_PATTERN.test(entry.name) || !expectedRunIds.has(entry.name)) retainVaultSecretDirectory();
    }
  } catch {
    return;
  }

  for (const recovery of recoveries) {
    const directoryState = runDirectoryState(root, recovery);
    if (directoryState === "unsafe") {
      retainVaultRunRecovery(recovery);
      continue;
    }
    let candidates: JobProcessIdentity[] | null;
    try {
      candidates = jobRunnerRuntime.findProcessesByNonceHash(recovery.processNonceHash);
    } catch {
      retainVaultRunRecovery(recovery);
      continue;
    }
    if (!candidates) {
      retainVaultRunRecovery(recovery);
      continue;
    }
    const selection = selectNonceRecoveryGroup(candidates, recovery.processNonceHash);
    if (selection.status === "ambiguous") {
      retainVaultRunRecovery(recovery);
      continue;
    }
    if (selection.status === "absent") {
      if (recovery.state === "prepared" && recovery.processIdentity === null) {
        cleanupPreparedVaultDirectory(root, recovery, directoryState);
      } else if (directoryState === "absent" && (
        (recovery.state === "failed" && recovery.processIdentity === null)
        || hasVerifiedPersistedGroupAbsence(recovery)
      )) {
        jobs.markVaultJobRunCleaned(recovery.projectId, recovery.runId);
      } else {
        retainVaultRunRecovery(recovery);
      }
      continue;
    }
    const leader = selection.leader;
    if (recovery.processIdentity && !persistedIdentityMatches(recovery, leader)) {
      retainVaultRunRecovery(recovery);
      continue;
    }
    const persisted = recovery.processIdentity ? recovery : jobs.recordVaultJobRunProcessIdentity(recovery.projectId, recovery.runId, {
      processId: leader.processId,
      processGroupId: leader.processGroupId,
      processStartTime: leader.startTime,
      processExecutable: leader.executable,
    });
    if (!persisted) {
      retainVaultRunRecovery(recovery);
      continue;
    }
    recoveredVaultRuns.set(recovery.runId, persisted);
    const tracked = trackRecoveredDetachedProcess(persisted, leader);
    if (!tracked) {
      retainVaultRunRecovery(recovery);
      continue;
    }
    await terminateRecoveredOwnedGroup(tracked);
  }
}

export function recoverVaultSecretRunDirectories(): Promise<void> {
  if (vaultRecoveryInFlight) return vaultRecoveryInFlight;
  const recovery = recoverVaultSecretRunDirectoriesImpl();
  vaultRecoveryInFlight = recovery;
  void recovery.then(() => {
    if (vaultRecoveryInFlight === recovery) vaultRecoveryInFlight = null;
  }, () => {
    if (vaultRecoveryInFlight === recovery) vaultRecoveryInFlight = null;
  });
  return recovery;
}

function noteLeaderClosed(runId: string): void {
  const tracked = ownedDetachedRuns.get(runId);
  if (!tracked) return;
  recordTrackingEvent(tracked, "leader-closed", "awaiting-owned-group-teardown");
  if (!verifyOwnedGroupTeardown(tracked)) scheduleGroupRecovery(tracked);
}

function signalOwnedGroup(runId: string, signal: NodeJS.Signals): void {
  const tracked = ownedDetachedRuns.get(runId);
  if (!tracked) return;

  const verification = revalidateOwnedGroup(tracked);
  if (verification.status !== "trusted") {
    recordTrackingEvent(
      tracked,
      "signal-suppressed",
      verification.status === "empty" ? "owned-group-empty" : verification.reason,
    );
    if (verification.status === "empty") finalizeVaultRunAfterVerifiedTeardown(runId);
    else {
      markVaultRunTeardownPending(runId);
      scheduleGroupRecovery(tracked);
    }
    return;
  }

  try {
    jobRunnerRuntime.signalProcessGroup(tracked.processGroupId, signal);
    recordTrackingEvent(tracked, "group-signalled", signal);
  } catch {
    // ESRCH and permission failures are not an invitation to fall back to a
    // numeric PID. That PID/PGID may already belong to another process.
    recordTrackingEvent(tracked, "group-signal-failed", signal);
    markVaultRunTeardownPending(runId);
    scheduleGroupRecovery(tracked);
  }
}

function signalOwnedProcess(runId: string, proc: ChildProcess, signal: NodeJS.Signals): void {
  if (supportsOwnedProcessGroups) {
    signalOwnedGroup(runId, signal);
    return;
  }

  if (!isProcessRunning(proc)) return;
  try {
    proc.kill(signal);
  } catch {
    // A child may close between the running check and the signal delivery.
  }
}

/**
 * Start cooperative termination exactly once and retain its escalation until
 * the leader closes and the forced group-signal attempt has completed. The
 * detached-group evidence itself remains available until procfs verifies that
 * every descendant is gone.
 */
function terminateProcess(runId: string, proc: ChildProcess): Promise<void> {
  const existing = terminationCompletions.get(runId);
  if (existing) return existing;

  let resolveEscalation: (() => void) | undefined;
  const escalation = new Promise<void>((resolve) => {
    resolveEscalation = resolve;
  });
  resolveEscalations.set(runId, resolveEscalation!);
  teardownAttempts.set(runId, escalation);
  void escalation.finally(() => {
    if (teardownAttempts.get(runId) === escalation) teardownAttempts.delete(runId);
  });

  const closed = closePromises.get(runId) ?? Promise.resolve();
  const completion = Promise.all([closed, escalation]).then(() => undefined);
  terminationCompletions.set(runId, completion);
  void completion.then(() => {
    if (terminationCompletions.get(runId) !== completion) return;
    terminationCompletions.delete(runId);
    const tracked = ownedDetachedRuns.get(runId);
    if (tracked && !verifyOwnedGroupTeardown(tracked)) scheduleGroupRecovery(tracked);
  });

  signalOwnedProcess(runId, proc, "SIGTERM");
  const timer = setTimeout(() => {
    forceKillTimers.delete(runId);
    void (async () => {
      const beforeKill = ownedDetachedRuns.get(runId);
      if (beforeKill && verifyOwnedGroupTeardown(beforeKill)) {
        // SIGTERM removed the whole owned group; a SIGKILL would be unnecessary.
      } else {
        signalOwnedProcess(runId, proc, "SIGKILL");
        const tracked = ownedDetachedRuns.get(runId);
        if (tracked && !(await waitForOwnedGroupTeardown(tracked))) {
          markVaultRunTeardownPending(runId);
          scheduleGroupRecovery(tracked);
        }
      }
      const resolve = resolveEscalations.get(runId);
      resolveEscalations.delete(runId);
      resolve?.();
    })();
  }, JOB_TERMINATION_GRACE_MS);
  forceKillTimers.set(runId, timer);
  return completion;
}

function completeJobSpawnFailure(
  projectId: string,
  eventContext: EventExecutionContext,
  runId: string,
  vaultEnabled: boolean,
): void {
  jobEventDeliveries.completeJobEventDelivery(projectId, {
    ...eventContext,
    runId,
    outcome: "failed",
    exitCode: -1,
    errorCode: vaultEnabled ? VAULT_UNAVAILABLE_CODE : "process_failure",
    errorMessage: vaultEnabled ? VAULT_UNAVAILABLE_MESSAGE : "Unable to start the OpenCode process.",
  });
}

/**
 * Execute a job run by spawning the opencode CLI.
 *
 * Feasibility gate: opencode v1.18.9 supports `opencode run "<prompt>" --agent <name>`
 * The message is a positional argument, not a flag. The `--auto` flag enables
 * non-interactive auto-approval of permissions.
 */
export async function executeJobRun(
  runId: string,
  job: { id: string; agent: string; prompt_template: string; timeout_minutes: number; project_id: string },
  _prompt: string,
  eventContext?: EventExecutionContext,
): Promise<void> {
  const prompt = job.prompt_template;

  if (activeRunCount >= MAX_CONCURRENT_RUNS) {
    logger.warn("job-runner", `Concurrency limit reached (${MAX_CONCURRENT_RUNS}). Run ${runId} will be queued.`);
    if (eventContext) {
      jobEventDeliveries.completeJobEventDelivery(job.project_id, {
        ...eventContext,
        runId,
        outcome: "failed",
        exitCode: -1,
        errorCode: "concurrency_limit",
        errorMessage: `Concurrency limit reached: ${MAX_CONCURRENT_RUNS} runs already active.`,
      });
    } else {
      jobs.finishJobRun(job.project_id, runId, "failed", -1);
    }
    jobs.appendRunLog(job.project_id, runId, "stderr", `Concurrency limit reached: ${MAX_CONCURRENT_RUNS} runs already active.`);
    return;
  }

  activeRunCount++;
  logger.info("job-runner", `Starting run ${runId} for job ${job.id} (agent: ${safeJobLogText(job.agent, 128)}, active: ${activeRunCount}/${MAX_CONCURRENT_RUNS})`);

  // Update run status to running (it should already be 'running' from startJobRun,
  // but we re-affirm in case of any race)
  const run = jobs.getJobRun(job.project_id, runId);
  if (!run) {
    logger.error("job-runner", `Run ${runId} not found in DB — aborting.`);
    activeRunCount--;
    return;
  }
  if (run.status !== "running") {
    activeRunCount--;
    return;
  }

  const timeoutMinutes = job.timeout_minutes > 0 ? job.timeout_minutes : 30;
  let vaultRunFiles: VaultSecretRunFiles | undefined;
  let vaultResolution: vault.VaultJobSecretsResolution | null = null;
  const runNonce = jobRunnerRuntime.createRunNonce();
  const runNonceHash = hashNonce(runNonce);
  try {
    // Authorization, freshness, version matching, decryption, and expiry are
    // resolved in core immediately before this process can be spawned.
    vaultResolution = vault.resolveJobVaultSecrets(job.project_id, job.id, runId);
    if (vaultResolution) {
      if (!supportsOwnedProcessGroups || !runNonceHash) throw new VaultSecretStorageError();
      const prepared = jobs.prepareVaultJobRun(job.project_id, {
        runId,
        jobId: job.id,
        deadlineAt: vaultResolution.deadlineAt,
        processNonceHash: runNonceHash,
        itemSnapshots: vaultResolution.secrets.map((secret) => ({
          itemId: secret.itemId,
          authorizedItemVersion: secret.authorizedItemVersion,
        })),
      });
      if (!prepared) throw new VaultSecretStorageError();
      // Resolution and persistence can race expiry. No filesystem state or child
      // is created once the effective deadline has elapsed.
      if (vaultResolution.deadlineAt <= Date.now()) {
        vaultResolution.release();
        jobs.markVaultJobRunFailed(job.project_id, runId);
        jobs.markVaultJobRunCleaned(job.project_id, runId);
        throw new VaultSecretStorageError();
      }
      vaultRunFiles = createVaultSecretRunFiles(job.project_id, runId, vaultResolution);
      // Recheck after sensitive files/configuration are materialized and before
      // spawn, then remove the exact run directory if expiry won the race.
      if (vaultResolution.deadlineAt <= Date.now()) {
        cleanupVaultSecretRun(runId);
        throw new VaultSecretStorageError();
      }
    }
  } catch {
    vaultResolution?.release();
    jobs.appendRunLog(job.project_id, runId, "stderr", VAULT_OUTPUT_REDACTION);
    if (eventContext) {
      jobEventDeliveries.completeJobEventDelivery(job.project_id, {
        ...eventContext,
        runId,
        outcome: "failed",
        exitCode: -1,
        errorCode: VAULT_UNAVAILABLE_CODE,
        errorMessage: VAULT_UNAVAILABLE_MESSAGE,
      });
    } else {
      jobs.finishJobRun(job.project_id, runId, "failed", -1);
    }
    activeRunCount = Math.max(0, activeRunCount - 1);
    return;
  }

  const deadlineAt = vaultResolution?.deadlineAt ?? Date.now() + timeoutMinutes * 60_000;
  const timeoutMs = Math.max(0, deadlineAt - Date.now());
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const args = vaultRunFiles
    ? ["run", prompt, "--agent", job.agent, "--auto", "--pure", "--dir", "/workspace"]
    : ["run", prompt, "--agent", job.agent, "--auto"];

  // Prompts are user-authored and can contain credentials. Do not log the CLI
  // arguments or rendered template, even at debug level.
  logger.info("job-runner", `Starting OpenCode process for run ${runId} (agent: ${safeJobLogText(job.agent, 128)})`);

  // Vault runs start from their tmpfs home and use the supported --dir option for
  // workspace access. --pure prevents project/global plugins from sending a
  // vault session to persistent OpenCode, API, or MCP state.
  let proc: ChildProcess;
  try {
    proc = spawn("opencode", args, {
      cwd: vaultRunFiles?.runtime.home ?? "/workspace",
      env: buildJobProcessEnvironment(
        job.project_id,
        runNonce,
        vaultRunFiles ? vaultSecretFileMap(vaultRunFiles) : undefined,
        vaultRunFiles?.runtime,
      ),
      stdio: ["ignore", "pipe", "pipe"],
      detached: supportsOwnedProcessGroups,
    });
  } catch {
    if (vaultRunFiles) cleanupVaultSecretRun(runId);
    if (vaultResolution) jobs.appendRunLog(job.project_id, runId, "stderr", VAULT_OUTPUT_REDACTION);
    if (eventContext) completeJobSpawnFailure(job.project_id, eventContext, runId, !!vaultResolution);
    else jobs.finishJobRun(job.project_id, runId, "failed", -1);
    activeRunCount = Math.max(0, activeRunCount - 1);
    return;
  }

  runningProcesses.set(runId, proc);
  runProjects.set(runId, job.project_id);
  if (eventContext) eventRunContexts.set(runId, eventContext);
  if (supportsOwnedProcessGroups && typeof proc.pid === "number" && proc.pid > 0) {
    trackDetachedProcess(runId, proc.pid, runNonce);
  }
  let resolveClose: (() => void) | undefined;
  closePromises.set(runId, new Promise<void>((resolve) => {
    resolveClose = resolve;
  }));
  let finalized = false;
  let activeSlotReleased = false;
  let eventHeartbeat: ReturnType<typeof setInterval> | null = null;
  const spawnedIdentity = supportsOwnedProcessGroups && typeof proc.pid === "number"
    ? jobRunnerRuntime.processInspector.inspectProcess(proc.pid)
    : null;
  const tracking = getOwnedDetachedRunDiagnosticForTesting(runId);
  const vaultIdentityPersisted = !vaultRunFiles || !!(
    spawnedIdentity
    && spawnedIdentity.processId === proc.pid
    && spawnedIdentity.processGroupId === proc.pid
    && hashNonce(spawnedIdentity.runNonce) === runNonceHash
    && tracking?.events.some((event) => event.event === "identity-captured")
    && jobs.recordVaultJobRunProcessIdentity(job.project_id, runId, {
      processId: spawnedIdentity.processId,
      processGroupId: spawnedIdentity.processGroupId,
      processStartTime: spawnedIdentity.startTime,
      processExecutable: spawnedIdentity.executable,
    })
  );
  if (!vaultIdentityPersisted) jobs.markVaultJobRunTeardownPending(job.project_id, runId);
  let provenanceFailure = !vaultIdentityPersisted;

  const completeEvent = (
    outcome: "success" | "failed" | "timeout" | "cancelled",
    exitCode: number | null,
    errorCode?: string,
    errorMessage?: string,
  ) => {
    if (!eventContext) return;
    jobEventDeliveries.completeJobEventDelivery(job.project_id, {
      ...eventContext,
      runId,
      outcome,
      exitCode,
      errorCode,
      errorMessage,
    });
  };

  let vaultRedactionWritten = false;
  const recordVaultRedaction = () => {
    if (!vaultResolution || vaultRedactionWritten || vaultRedactionRuns.has(runId)) return;
    vaultRedactionWritten = true;
    vaultRedactionRuns.add(runId);
    jobs.appendRunLog(job.project_id, runId, "stderr", VAULT_OUTPUT_REDACTION);
  };

  // Trusted event payloads are intentionally never interpolated into prompts.
  // Do not turn a downstream agent echo into a durable payload/prompt leak.
  const appendOutputLog = (stream: "stdout" | "stderr", line: string) => {
    if (vaultResolution) {
      recordVaultRedaction();
      return;
    }
    jobs.appendRunLog(
      job.project_id,
      runId,
      stream,
      eventContext ? "Event job output redacted from durable logs." : line,
    );
  };

  if (eventContext) {
    eventHeartbeat = setInterval(() => {
      const renewed = jobEventDeliveries.heartbeatJobEventDelivery(
        job.project_id,
        eventContext.deliveryId,
        eventContext.leaseToken,
        eventContext.leaseRevision,
      );
      if (!renewed) {
        logger.warn("job-runner", `Event lease heartbeat lost for run ${runId}`);
        void terminateProcess(runId, proc);
        cleanupVaultSecretRunAfterTeardown(runId);
      }
    }, Math.floor(jobEventDeliveries.JOB_EVENT_DELIVERY_LEASE_MS / 3));
    eventHeartbeat.unref?.();
  }

  if (eventContext) {
    const persisted = spawnedIdentity
      && spawnedIdentity.processId === proc.pid
      && spawnedIdentity.processGroupId === proc.pid
      && hashNonce(spawnedIdentity.runNonce) === runNonceHash
      && tracking?.events.some((event) => event.event === "identity-captured")
      && jobEventDeliveries.persistJobEventAttemptProcessIdentity(job.project_id, {
        ...eventContext,
        runId,
        processId: spawnedIdentity.processId,
        processGroupId: spawnedIdentity.processGroupId,
        processStartTime: spawnedIdentity.startTime,
        processExecutable: spawnedIdentity.executable,
        processNonce: runNonce,
      });
    if (!persisted) {
      provenanceFailure = true;
      completeEvent("failed", -1, "provenance_conflict", "Spawned process identity could not be verified.");
    }
  }

  const releaseActiveSlot = () => {
    if (activeSlotReleased) return;
    activeSlotReleased = true;
    activeRunCount = Math.max(0, activeRunCount - 1);
  };

  const finalize = (): boolean => {
    if (finalized) return false;
    finalized = true;
    runningProcesses.delete(runId);
    runProjects.delete(runId);
    eventRunContexts.delete(runId);
    if (eventHeartbeat) clearInterval(eventHeartbeat);

    // A terminating POSIX group can contain descendants after its leader has
    // closed. Keep its concurrency slot until the bounded SIGKILL attempt has
    // happened; ownership evidence remains afterwards if teardown is uncertain.
    const termination = terminationCompletions.get(runId);
    if (!termination) {
      clearForceKillTimer(runId);
      releaseActiveSlot();
    } else {
      void termination.then(releaseActiveSlot);
    }
    return true;
  };

  // Timeout handler — SIGTERM first with a 5s grace period, then SIGKILL.
  // This two-phase kill gives the opencode process time to flush logs and clean up
  // child processes (e.g., LLM subprocesses) before a hard kill.
  if (!provenanceFailure) timeoutHandle = setTimeout(() => {
    if (finalized) return;
    timedOut = true;
    logger.warn("job-runner", `Run ${runId} timed out after ${timeoutMs}ms — killing process.`);
    const termination = terminateProcess(runId, proc);
    if (vaultResolution) recordVaultRedaction();
    else jobs.appendRunLog(job.project_id, runId, "stderr", `Job timed out after ${timeoutMinutes} minutes.`);
    cleanupVaultSecretRunAfterTeardown(runId);
    if (eventContext) {
      void termination.then(() => {
        const ambiguous = ownedDetachedRuns.has(runId);
        completeEvent(
          "timeout",
          -1,
          vaultResolution ? VAULT_UNAVAILABLE_CODE : ambiguous ? "ambiguous_process_ownership" : "timeout",
          vaultResolution ? VAULT_UNAVAILABLE_MESSAGE : ambiguous
            ? "Timed-out process ownership could not be revalidated."
            : "Job timed out.",
        );
      });
    } else {
      jobs.finishJobRun(job.project_id, runId, "timeout", -1);
    }
  }, timeoutMs);

  let stdoutBuffer = "";
  proc.stdout?.on("data", (chunk: Buffer) => {
    if (vaultResolution) {
      recordVaultRedaction();
      return;
    }
    stdoutBuffer += chunk.toString("utf-8");
    const lines = stdoutBuffer.split("\n");
    // Keep the last incomplete line in the buffer (stream may end mid-line)
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) {
        appendOutputLog("stdout", line);
      }
    }
  });

  let stderrBuffer = "";
  proc.stderr?.on("data", (chunk: Buffer) => {
    if (vaultResolution) {
      recordVaultRedaction();
      return;
    }
    stderrBuffer += chunk.toString("utf-8");
    const lines = stderrBuffer.split("\n");
    stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) {
        appendOutputLog("stderr", line);
      }
    }
  });

  proc.on("close", (code) => {
    // Flush any remaining buffer content (last partial line from stream data)
    if (stdoutBuffer.length > 0) {
      appendOutputLog("stdout", stdoutBuffer);
    }
    if (stderrBuffer.length > 0) {
      appendOutputLog("stderr", stderrBuffer);
    }

    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (vaultResolution) recordVaultRedaction();

    const wasTerminated = terminationCompletions.has(runId);
    if (!timedOut && !wasTerminated && finalize()) {
      const exitCode = code ?? -1;
      const status = exitCode === 0 ? "success" : "failed";
      logger.info("job-runner", `Run ${runId} finished: status=${status}, exitCode=${exitCode}`);
      if (eventContext) {
        completeEvent(exitCode === 0 ? "success" : "failed", exitCode,
          exitCode === 0 ? undefined : "nonzero_exit",
          exitCode === 0 ? undefined : "Job process exited with a non-zero status.");
      } else {
        jobs.finishJobRun(job.project_id, runId, status, exitCode);
      }
    }

    noteLeaderClosed(runId);
    // A successful leader exit does not prove a detached descendant is gone.
    // Vault files remain until a verified teardown attempt has run.
    if (vaultResolution && ownedDetachedRuns.has(runId) && !terminationCompletions.has(runId)) {
      void terminateProcess(runId, proc);
    }
    finalize();
    cleanupVaultSecretRunAfterTeardown(runId);
    closePromises.delete(runId);
    resolveClose?.();
    vaultRedactionRuns.delete(runId);
    logger.info("job-runner", `Run ${runId} cleaned up (active: ${activeRunCount}/${MAX_CONCURRENT_RUNS})`);
  });

  proc.on("error", (err: Error) => {
    // A launched child can report an operational error while still emitting a
    // later close event. Keep it tracked so termination escalation remains live.
    if (proc.pid !== undefined) {
      logger.warn("job-runner", `Run ${runId} process error while awaiting close`, { name: safeJobLogText(err.name, 64) });
      return;
    }

    if (timeoutHandle) clearTimeout(timeoutHandle);

    logger.error("job-runner", `Run ${runId} failed to start`, { name: safeJobLogText(err.name, 64) });
    if (vaultResolution) recordVaultRedaction();
    if (eventContext) {
      if (vaultResolution) completeEvent("failed", -1, VAULT_UNAVAILABLE_CODE, VAULT_UNAVAILABLE_MESSAGE);
      else completeEvent("failed", -1, "process_failure", "Unable to start the OpenCode process.");
    }
    else jobs.finishJobRun(job.project_id, runId, "failed", -1);
    if (!vaultResolution) jobs.appendRunLog(job.project_id, runId, "stderr", "Unable to start the OpenCode process.");

    finalize();
    cleanupVaultSecretRun(runId);
    closePromises.delete(runId);
    resolveClose?.();
    vaultRedactionRuns.delete(runId);
  });

  if (provenanceFailure) {
    if (vaultResolution) recordVaultRedaction();
    void terminateProcess(runId, proc);
    cleanupVaultSecretRunAfterTeardown(runId);
  }
}

/**
 * Try to kill a running job run by its runId.
 * Returns true if the process was found and termination was initiated.
 */
export function killRunProcess(projectId: string, runId: string): boolean {
  if (runProjects.get(runId) !== projectId) return false;
  const proc = runningProcesses.get(runId);
  if (!proc || !isProcessRunning(proc)) return false;

  logger.info("job-runner", `Killing process for run ${runId}`);
  terminateProcess(runId, proc);
  cleanupVaultSecretRunAfterTeardown(runId);
  return true;
}

/**
 * Terminate every child process owned by the API before process shutdown.
 * Runs are marked cancelled so a restarted scheduler does not treat a dead
 * child as still active.
 */
export async function stopAllJobRuns(): Promise<void> {
  const pending = [...runningProcesses.entries()];
  if (pending.length === 0) return;

  const completions: Array<Promise<{ runId: string; projectId: string; eventContext?: EventExecutionContext }>> = [];
  for (const [runId, proc] of pending) {
    const projectId = runProjects.get(runId);
    if (!projectId) continue;
    const eventContext = eventRunContexts.get(runId);
    try {
      if (!eventContext) jobs.cancelJobRun(projectId, runId);
      if (vaultSecretRuns.has(runId) && !vaultRedactionRuns.has(runId)) {
        vaultRedactionRuns.add(runId);
        jobs.appendRunLog(projectId, runId, "stderr", VAULT_OUTPUT_REDACTION);
      }
      else jobs.appendRunLog(projectId, runId, "stderr", "Job cancelled because the API is shutting down.");
    } catch {
      logger.warn("job-runner", `Could not persist shutdown state for run ${runId}`);
    }
    const termination = terminateProcess(runId, proc);
    cleanupVaultSecretRunAfterTeardown(runId);
    completions.push(termination.then(() => ({ runId, projectId, eventContext })));
  }

  const settled = await Promise.allSettled(completions);
  for (const result of settled) {
    if (result.status !== "fulfilled" || !result.value.eventContext) continue;
    const { runId, projectId, eventContext } = result.value;
    const ambiguous = ownedDetachedRuns.has(runId);
    jobEventDeliveries.completeJobEventDelivery(projectId, {
      ...eventContext,
      runId,
      outcome: "cancelled",
      exitCode: -1,
      errorCode: ambiguous ? "ambiguous_process_ownership" : "api_shutdown",
      errorMessage: ambiguous
        ? "Shutdown could not verify event-process teardown."
        : "Job cancelled because the API is shutting down.",
    });
  }
}

function hashNonce(value: string | undefined): string | null {
  return value ? createHash("sha256").update(value, "utf8").digest("hex") : null;
}

async function waitForVerifiedGroupTeardown(processGroupId: number, attempts = 5): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const group = jobRunnerRuntime.processInspector.inspectGroup(processGroupId);
    if (group?.members.length === 0) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, JOB_GROUP_RECOVERY_INTERVAL_MS));
  }
  return false;
}

/**
 * Reconcile a lease left by a prior API process. No event is retried until the
 * durable procfs identity proves absence or a verified owned group is torn down.
 */
export async function recoverExpiredEventAttempt(lease: jobEventDeliveries.ExpiredJobEventLease): Promise<void> {
  const resolve = (resolution: "retry" | "dead_letter", errorCode: string, errorMessage: string) => {
    try {
      jobEventDeliveries.resolveExpiredJobEventLease(lease.projectId, {
        deliveryId: lease.deliveryId,
        leaseRevision: lease.leaseRevision,
        attemptNumber: lease.attemptNumber,
        runId: lease.runId,
        resolution,
        errorCode,
        errorMessage,
      });
    } finally {
      // Vault-run cleanup is driven by its immutable snapshot, never by mutable
      // event-delivery state or the current job reference set.
    }
  };
  const vaultRun = jobs.getVaultSecretRunRecovery(lease.runId);
  if (vaultRun) {
    await recoverVaultSecretRunDirectories();
    const recovered = jobs.getVaultSecretRunRecovery(lease.runId);
    if (recovered?.state === "cleaned") {
      resolve("retry", "process_absent", "Verified vault event process is absent after lease expiry.");
    } else {
      resolve("dead_letter", "ambiguous_process_ownership", "Vault event process cleanup could not be verified after lease expiry.");
    }
    return;
  }
  if (lease.processId === null || lease.processGroupId === null || !lease.processStartTime
    || !lease.processExecutable || !lease.processNonceHash) {
    resolve("dead_letter", "ambiguous_process_identity", "Lease expired without complete process identity evidence.");
    return;
  }
  const identity = jobRunnerRuntime.processInspector.inspectProcess(lease.processId);
  if (!identity) {
    if (process.platform === "linux" && !existsSync(`/proc/${lease.processId}`)) {
      resolve("retry", "process_absent", "Verified process is absent after lease expiry.");
    } else {
      resolve("dead_letter", "ambiguous_process_ownership", "Process identity could not be revalidated after lease expiry.");
    }
    return;
  }
  if (identity.processGroupId !== lease.processGroupId || identity.startTime !== lease.processStartTime
    || identity.executable !== lease.processExecutable || hashNonce(identity.runNonce) !== lease.processNonceHash) {
    resolve("dead_letter", "ambiguous_process_ownership", "A surviving process did not match the persisted event identity.");
    return;
  }
  const group = jobRunnerRuntime.processInspector.inspectGroup(lease.processGroupId);
  if (!group
    || !group.members.some((member) => matchesIdentity(member, identity))
    || group.members.some((member) => hashNonce(member.runNonce) !== lease.processNonceHash)) {
    resolve("dead_letter", "ambiguous_process_ownership", "A surviving process group could not be proven owned.");
    return;
  }
  try {
    jobRunnerRuntime.signalProcessGroup(lease.processGroupId, "SIGTERM");
  } catch {
    resolve("dead_letter", "ambiguous_process_ownership", "Owned process-group teardown could not be started.");
    return;
  }
  if (await waitForVerifiedGroupTeardown(lease.processGroupId)) {
    resolve("retry", "verified_crash", "Verified prior event process was terminated before retry.");
  } else {
    resolve("dead_letter", "ambiguous_process_ownership", "Owned process group remained after teardown grace period.");
  }
}

export { runningProcesses };

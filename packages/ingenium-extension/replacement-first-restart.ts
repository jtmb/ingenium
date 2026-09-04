import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, posix, relative, resolve } from "node:path";

const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_BINDING_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_HANDOFF_ACTIONS = 64;
const MAX_HANDOFF_CHECKS = 32;
const MAX_HANDOFF_PATHS = 32;
const MAX_HANDOFF_COUNT = 1_000_000;
const ACTION_KINDS = ["read", "search", "write", "edit", "execute"] as const;
const CHECK_NAMES = ["test", "typecheck", "lint", "build", "format", "security", "other"] as const;

export interface RestartProcessIdentity {
  pid: number;
  startTimeTicks: number;
  executableSha256: string;
  nonceSha256: string;
}

export interface ReplacementIdentityExpectation {
  executableSha256: string;
  nonceSha256: string;
}

export interface RedactedRestartHandoff {
  status: "active" | "working" | "idle" | "completed" | "error";
  taskHash: string | null;
  actions: Array<{
    kind: typeof ACTION_KINDS[number];
    result: "succeeded";
    path: string | null;
    targetHash: string | null;
  }>;
  changedPaths: Array<{
    path: string;
    operation: "write" | "edit";
    additions: number;
    deletions: number;
    changeRevision: number;
  }>;
  checks: Array<{
    name: typeof CHECK_NAMES[number];
    status: "completed" | "failed";
    result: "passed" | "failed";
    exitCode: number | null;
    targetHash: string;
  }>;
  todos: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    cancelled: number;
    state: "none" | "pending" | "in_progress" | "complete" | "cancelled" | "mixed";
  };
  nextWork: {
    kind: "none" | "continue_task" | "review_changes" | "run_checks" | "address_failure";
    referenceHash: string | null;
  };
}

export interface ReplacementFirstRestartRequest {
  schemaVersion: 1;
  worktree: string;
  binding: {
    projectId: string;
    workspaceId: string;
    launcherWorktree: string;
    storageMappingHash: string;
    audience: "mcp";
  };
  oldProcess: RestartProcessIdentity;
  oldPort: number;
  oldDataHome: string;
  replacement: {
    port: number;
    dataHome: string;
    expectedIdentity: ReplacementIdentityExpectation;
  };
  handoff: RedactedRestartHandoff;
  timeouts: {
    handoffMs: number;
    launchMs: number;
    identityMs: number;
    healthMs: number;
    sessionMs: number;
    memoryAckMs: number;
    terminalIdleMs: number;
    retirementMs: number;
  };
}

export type ReplacementFirstRestartPhase =
  | "handoff_published"
  | "replacement_started"
  | "replacement_healthy"
  | "session_created"
  | "typed_memory_acknowledged"
  | "terminal_idle_acknowledged"
  | "recovery_owner_ready"
  | "retirement_committed"
  | "old_parent_retired";

export interface ReplacementFirstRestartEvidence {
  phase: ReplacementFirstRestartPhase | "committed_recovery" | "failed";
  lastCompletedPhase: ReplacementFirstRestartPhase | null;
  handoffSha256: string;
  actionCount: number;
  changedPathCount: number;
  checkCount: number;
  replacementIdentitySha256: string | null;
  transactionSha256: string | null;
  retirementCommitted: boolean;
  oldParentRetired: boolean;
  replacementStopped: boolean;
  occurredAt: string;
}

export interface ReplacementFirstRestartResult {
  handoffSha256: string;
  replacementIdentitySha256: string;
  recoveryState?: "retirement_committed";
}

export interface ReplacementSessionCreation<Session> {
  status: "created";
  transactionSha256: string;
  session: Session;
}

export interface ReplacementFirstRestartDependencies<Session> {
  revalidateBinding(
    binding: ReplacementFirstRestartRequest["binding"],
    worktree: string,
    signal: AbortSignal,
  ): Promise<boolean>;
  revalidateProcessIdentity(
    identity: RestartProcessIdentity,
    role: "old" | "replacement",
    signal: AbortSignal,
  ): Promise<boolean>;
  persistHandoff(handoff: RedactedRestartHandoff, handoffSha256: string, signal: AbortSignal): Promise<void>;
  launchReplacement(input: {
    worktree: string;
    binding: ReplacementFirstRestartRequest["binding"];
    port: number;
    dataHome: string;
    expectedIdentity: ReplacementIdentityExpectation;
    bindProvisionalIdentity(identity: RestartProcessIdentity): void;
  }, signal: AbortSignal): Promise<RestartProcessIdentity>;
  verifyReplacementHealth(identity: RestartProcessIdentity, port: number, signal: AbortSignal): Promise<void>;
  createReplacementSession(
    identity: RestartProcessIdentity,
    port: number,
    transactionSha256: string,
    signal: AbortSignal,
  ): Promise<ReplacementSessionCreation<Session>>;
  acknowledgeTypedMemory(
    identity: RestartProcessIdentity,
    session: Session,
    handoffSha256: string,
    transactionSha256: string,
    signal: AbortSignal,
  ): Promise<{ status: "acknowledged"; handoffSha256: string; transactionSha256: string }>;
  awaitTerminalIdleAcknowledgement(
    identity: RestartProcessIdentity,
    session: Session,
    handoffSha256: string,
    transactionSha256: string,
    signal: AbortSignal,
  ): Promise<{
    status: "idle";
    handoffSha256: string;
    transactionSha256: string;
    assistantResult: "completed";
  }>;
  prepareRecoveryOwner?(
    identity: RestartProcessIdentity,
    session: Session,
    handoffSha256: string,
    transactionSha256: string,
    signal: AbortSignal,
  ): Promise<{ status: "ready"; transactionSha256: string; replacementIdentitySha256: string }>;
  commitRecoveryOwner?(transactionSha256: string, signal: AbortSignal): Promise<void>;
  abortRecoveryOwner?(transactionSha256: string): Promise<void> | void;
  retireOldProcess(identity: RestartProcessIdentity, signal: AbortSignal): Promise<void>;
  stopReplacement(identity: RestartProcessIdentity, signal: AbortSignal): Promise<void>;
  persistEvidence(evidence: ReplacementFirstRestartEvidence): void | Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function canonicalDirectory(value: unknown, name: string, mustExist: boolean): string {
  if (typeof value !== "string" || !isAbsolute(value) || resolve(value) !== value
    || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${name} must be a canonical absolute path`);
  let existing = value;
  while (true) {
    try {
      const stat = lstatSync(existing);
      if (stat.isSymbolicLink() || realpathSync(existing) !== existing) throw new Error(`${name} must not contain symlinks`);
      if (!stat.isDirectory()) throw new Error(`${name} must be a directory`);
      return value;
    } catch (error) {
      if (!isRecord(error) || error.code !== "ENOENT") throw error;
      if (mustExist || existing === dirname(existing)) throw new Error(`${name} does not exist`);
      existing = dirname(existing);
    }
  }
}

function directoriesOverlap(left: string, right: string): boolean {
  const leftToRight = relative(left, right);
  const rightToLeft = relative(right, left);
  return leftToRight === "" || (!leftToRight.startsWith("..") && !isAbsolute(leftToRight))
    || (!rightToLeft.startsWith("..") && !isAbsolute(rightToLeft));
}

function boundedInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} is invalid`);
  }
  return value as number;
}

function sha256(value: unknown, name: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function nullableSha256(value: unknown, name: string): string | null {
  return value === null ? null : sha256(value, name);
}

export function isSafeRestartHandoffPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 1024 || value !== value.trim()
    || value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:\//.test(value)
    || value.includes("\\") || posix.normalize(value) !== value || /[\u0000-\u001f\u007f]/.test(value)) return false;
  const segments = value.split("/");
  const protectedName = /(^|[-_.])(secret|secrets|token|tokens|password|passwd|credential|credentials|private|apikey|api[-_]?key|id_rsa|env)([-_.]|$)/i;
  return !segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || segment === ".git"
    || Buffer.byteLength(segment, "utf8") > 255 || segment.startsWith("@") || protectedName.test(segment))
    && value !== ".opencode/protected-runtime-index" && !value.startsWith(".opencode/protected-runtime-index/");
}

function handoffActions(value: unknown): RedactedRestartHandoff["actions"] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_HANDOFF_ACTIONS) throw new Error("handoff.actions is invalid");
  return value.map((entry) => {
    if (!hasExactKeys(entry, ["kind", "result", "path", "targetHash"])
      || !ACTION_KINDS.includes(entry.kind as typeof ACTION_KINDS[number]) || entry.result !== "succeeded"
      || (entry.path === null) === (entry.targetHash === null)
      || (entry.path !== null && !isSafeRestartHandoffPath(entry.path))
      || (entry.targetHash !== null && (typeof entry.targetHash !== "string" || !SHA256.test(entry.targetHash)))) {
      throw new Error("handoff.actions is invalid");
    }
    return {
      kind: entry.kind as RedactedRestartHandoff["actions"][number]["kind"],
      result: "succeeded" as const,
      path: entry.path as string | null,
      targetHash: entry.targetHash as string | null,
    };
  });
}

function handoffChangedPaths(value: unknown): RedactedRestartHandoff["changedPaths"] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_HANDOFF_PATHS) throw new Error("handoff.changedPaths is invalid");
  return value.map((entry) => {
    if (!hasExactKeys(entry, ["path", "operation", "additions", "deletions", "changeRevision"])
      || !isSafeRestartHandoffPath(entry.path) || !["write", "edit"].includes(entry.operation as string)) {
      throw new Error("handoff.changedPaths is invalid");
    }
    return {
      path: entry.path,
      operation: entry.operation as "write" | "edit",
      additions: boundedInteger(entry.additions, "handoff.changedPaths.additions", 0, MAX_HANDOFF_COUNT),
      deletions: boundedInteger(entry.deletions, "handoff.changedPaths.deletions", 0, MAX_HANDOFF_COUNT),
      changeRevision: boundedInteger(entry.changeRevision, "handoff.changedPaths.changeRevision", 1, Number.MAX_SAFE_INTEGER),
    };
  });
}

function handoffChecks(value: unknown): RedactedRestartHandoff["checks"] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_HANDOFF_CHECKS) throw new Error("handoff.checks is invalid");
  return value.map((entry) => {
    if (!hasExactKeys(entry, ["name", "status", "result", "exitCode", "targetHash"])
      || !CHECK_NAMES.includes(entry.name as typeof CHECK_NAMES[number])
      || !["completed", "failed"].includes(entry.status as string) || !["passed", "failed"].includes(entry.result as string)
      || (entry.status === "completed") !== (entry.result === "passed")
      || (entry.exitCode !== null && (!Number.isSafeInteger(entry.exitCode) || (entry.exitCode as number) < 0 || (entry.exitCode as number) > 255))
      || (entry.exitCode !== null && (entry.result === "passed") !== (entry.exitCode === 0))
      || typeof entry.targetHash !== "string" || !SHA256.test(entry.targetHash)) {
      throw new Error("handoff.checks is invalid");
    }
    return {
      name: entry.name as RedactedRestartHandoff["checks"][number]["name"],
      status: entry.status as "completed" | "failed",
      result: entry.result as "passed" | "failed",
      exitCode: entry.exitCode as number | null,
      targetHash: entry.targetHash,
    };
  });
}

function processIdentity(value: unknown, name: string): RestartProcessIdentity {
  if (!hasExactKeys(value, ["pid", "startTimeTicks", "executableSha256", "nonceSha256"])) {
    throw new Error(`${name} is invalid`);
  }
  return {
    pid: boundedInteger(value.pid, `${name}.pid`, 2, 2 ** 31 - 1),
    startTimeTicks: boundedInteger(value.startTimeTicks, `${name}.startTimeTicks`, 1, Number.MAX_SAFE_INTEGER),
    executableSha256: sha256(value.executableSha256, `${name}.executableSha256`),
    nonceSha256: sha256(value.nonceSha256, `${name}.nonceSha256`),
  };
}

function expectedIdentity(value: unknown): ReplacementIdentityExpectation {
  if (!hasExactKeys(value, ["executableSha256", "nonceSha256"])) throw new Error("replacement.expectedIdentity is invalid");
  return {
    executableSha256: sha256(value.executableSha256, "replacement.expectedIdentity.executableSha256"),
    nonceSha256: sha256(value.nonceSha256, "replacement.expectedIdentity.nonceSha256"),
  };
}

function todoState(todos: RedactedRestartHandoff["todos"]): RedactedRestartHandoff["todos"]["state"] {
  const populated = [todos.pending, todos.inProgress, todos.completed, todos.cancelled].filter((count) => count > 0).length;
  if (populated === 0) return "none";
  if (populated > 1) return "mixed";
  if (todos.pending > 0) return "pending";
  if (todos.inProgress > 0) return "in_progress";
  if (todos.completed > 0) return "complete";
  return "cancelled";
}

export function parseRedactedRestartHandoff(value: unknown): RedactedRestartHandoff {
  if (!hasExactKeys(value, ["status", "taskHash", "actions", "changedPaths", "checks", "todos", "nextWork"])
    || !["active", "working", "idle", "completed", "error"].includes(value.status as string)
    || !hasExactKeys(value.todos, ["total", "pending", "inProgress", "completed", "cancelled", "state"])
    || !hasExactKeys(value.nextWork, ["kind", "referenceHash"])) throw new Error("handoff is invalid");
  const todos = {
    total: boundedInteger(value.todos.total, "handoff.todos.total", 0, 1_000_000),
    pending: boundedInteger(value.todos.pending, "handoff.todos.pending", 0, 1_000_000),
    inProgress: boundedInteger(value.todos.inProgress, "handoff.todos.inProgress", 0, 1_000_000),
    completed: boundedInteger(value.todos.completed, "handoff.todos.completed", 0, 1_000_000),
    cancelled: boundedInteger(value.todos.cancelled, "handoff.todos.cancelled", 0, 1_000_000),
    state: value.todos.state as RedactedRestartHandoff["todos"]["state"],
  };
  if (todos.total !== todos.pending + todos.inProgress + todos.completed + todos.cancelled
    || todos.state !== todoState(todos)) throw new Error("handoff.todos is invalid");
  const nextWorkKind = value.nextWork.kind;
  if (!["none", "continue_task", "review_changes", "run_checks", "address_failure"].includes(nextWorkKind as string)) {
    throw new Error("handoff.nextWork is invalid");
  }
  return {
    status: value.status as RedactedRestartHandoff["status"],
    taskHash: nullableSha256(value.taskHash, "handoff.taskHash"),
    actions: handoffActions(value.actions),
    changedPaths: handoffChangedPaths(value.changedPaths),
    checks: handoffChecks(value.checks),
    todos,
    nextWork: {
      kind: nextWorkKind as RedactedRestartHandoff["nextWork"]["kind"],
      referenceHash: nullableSha256(value.nextWork.referenceHash, "handoff.nextWork.referenceHash"),
    },
  };
}

function timeouts(value: unknown): ReplacementFirstRestartRequest["timeouts"] {
  const keys = ["handoffMs", "launchMs", "identityMs", "healthMs", "sessionMs", "memoryAckMs", "terminalIdleMs", "retirementMs"] as const;
  if (!hasExactKeys(value, keys)) throw new Error("timeouts are invalid");
  return Object.fromEntries(keys.map((key) => [key, boundedInteger(value[key], `timeouts.${key}`, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)])) as unknown as ReplacementFirstRestartRequest["timeouts"];
}

export function decodeReplacementFirstRestartRequest(
  encoded: string,
  expectedWorktree = process.cwd(),
): ReplacementFirstRestartRequest {
  if (!/^[A-Za-z0-9_-]{2,8192}$/.test(encoded)) throw new Error("Replacement-first restart payload is invalid");
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.toString("base64url") !== encoded) throw new Error("Replacement-first restart payload is invalid");
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("Replacement-first restart payload is invalid"); }
  if (!hasExactKeys(parsed, ["schemaVersion", "worktree", "binding", "oldProcess", "oldPort", "oldDataHome", "replacement", "handoff", "timeouts"])
    || parsed.schemaVersion !== 1
    || !hasExactKeys(parsed.binding, ["projectId", "workspaceId", "launcherWorktree", "storageMappingHash", "audience"])
    || !hasExactKeys(parsed.replacement, ["port", "dataHome", "expectedIdentity"])) {
    throw new Error("Replacement-first restart payload is invalid");
  }

  const worktree = canonicalDirectory(parsed.worktree, "worktree", true);
  if (worktree !== canonicalDirectory(expectedWorktree, "expectedWorktree", true)
    || parsed.binding.launcherWorktree !== worktree
    || typeof parsed.binding.projectId !== "string" || !UUID.test(parsed.binding.projectId)
    || parsed.binding.audience !== "mcp"
    || typeof parsed.binding.workspaceId !== "string" || !SAFE_BINDING_ID.test(parsed.binding.workspaceId)) {
    throw new Error("Replacement-first restart binding is invalid");
  }
  const oldProcess = processIdentity(parsed.oldProcess, "oldProcess");
  const replacementIdentity = expectedIdentity(parsed.replacement.expectedIdentity);
  if (replacementIdentity.nonceSha256 === oldProcess.nonceSha256) throw new Error("Replacement identity must be distinct");
  const oldPort = boundedInteger(parsed.oldPort, "oldPort", 1024, 65535);
  const replacementPort = boundedInteger(parsed.replacement.port, "replacement.port", 1024, 65535);
  const oldDataHome = canonicalDirectory(parsed.oldDataHome, "oldDataHome", true);
  const replacementDataHome = canonicalDirectory(parsed.replacement.dataHome, "replacement.dataHome", false);
  if (oldPort === replacementPort || directoriesOverlap(oldDataHome, replacementDataHome)) {
    throw new Error("Replacement port and data home must be distinct");
  }

  return {
    schemaVersion: 1,
    worktree,
    binding: {
      projectId: parsed.binding.projectId,
      workspaceId: parsed.binding.workspaceId,
      launcherWorktree: worktree,
      storageMappingHash: sha256(parsed.binding.storageMappingHash, "binding.storageMappingHash"),
      audience: "mcp",
    },
    oldProcess,
    oldPort,
    oldDataHome,
    replacement: {
      port: replacementPort,
      dataHome: replacementDataHome,
      expectedIdentity: replacementIdentity,
    },
    handoff: parseRedactedRestartHandoff(parsed.handoff),
    timeouts: timeouts(parsed.timeouts),
  };
}

function identitySha256(identity: RestartProcessIdentity): string {
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

function handoffSha256(handoff: RedactedRestartHandoff): string {
  return createHash("sha256").update(JSON.stringify(handoff)).digest("hex");
}

function matchesExpectedIdentity(identity: RestartProcessIdentity, expected: ReplacementIdentityExpectation): boolean {
  return identity.executableSha256 === expected.executableSha256 && identity.nonceSha256 === expected.nonceSha256;
}

async function bounded<T>(name: string, timeoutMs: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${name} timed out`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runReplacementFirstRestart<Session>(
  request: ReplacementFirstRestartRequest,
  dependencies: ReplacementFirstRestartDependencies<Session>,
): Promise<ReplacementFirstRestartResult> {
  const handoffDigest = handoffSha256(request.handoff);
  let lastCompletedPhase: ReplacementFirstRestartPhase | null = null;
  let replacement: RestartProcessIdentity | undefined;
  let transactionDigest: string | undefined;
  let oldParentRetired = false;
  let replacementStopped = false;
  let retirementCommitted = false;
  const persist = async (phase: ReplacementFirstRestartPhase, committed = retirementCommitted): Promise<void> => {
    await dependencies.persistEvidence({
      phase,
      lastCompletedPhase: phase,
      handoffSha256: handoffDigest,
      actionCount: request.handoff.actions.length,
      changedPathCount: request.handoff.changedPaths.length,
      checkCount: request.handoff.checks.length,
      replacementIdentitySha256: replacement ? identitySha256(replacement) : null,
      transactionSha256: transactionDigest ?? null,
      retirementCommitted: committed,
      oldParentRetired,
      replacementStopped,
      occurredAt: new Date().toISOString(),
    });
    lastCompletedPhase = phase;
  };

  try {
    const bindingIsCurrent = await bounded("restart binding", request.timeouts.identityMs, (signal) =>
      dependencies.revalidateBinding(request.binding, request.worktree, signal));
    if (!bindingIsCurrent) throw new Error("Restart binding changed");
    const oldIsCurrent = await bounded("old process identity", request.timeouts.identityMs, (signal) =>
      dependencies.revalidateProcessIdentity(request.oldProcess, "old", signal));
    if (!oldIsCurrent) throw new Error("Old process identity changed");
    await bounded("handoff persistence", request.timeouts.handoffMs, (signal) =>
      dependencies.persistHandoff(request.handoff, handoffDigest, signal));
    await persist("handoff_published");

    const launched = await bounded("replacement launch", request.timeouts.launchMs, (signal) =>
      dependencies.launchReplacement({
        worktree: request.worktree,
        binding: request.binding,
        port: request.replacement.port,
        dataHome: request.replacement.dataHome,
        expectedIdentity: request.replacement.expectedIdentity,
        bindProvisionalIdentity: (identity) => {
          if (replacement) throw new Error("Replacement process identity was already bound");
          replacement = processIdentity(identity, "replacementProcess");
          if (replacement.pid === request.oldProcess.pid || !matchesExpectedIdentity(replacement, request.replacement.expectedIdentity)) {
            throw new Error("Replacement process identity is invalid");
          }
        },
      }, signal));
    const candidate = processIdentity(launched, "replacementProcess");
    if (!replacement) replacement = candidate;
    if (candidate.pid === request.oldProcess.pid || !matchesExpectedIdentity(candidate, request.replacement.expectedIdentity)
      || identitySha256(candidate) !== identitySha256(replacement)) {
      throw new Error("Replacement process identity is invalid");
    }
    const transaction = createHash("sha256").update(handoffDigest).update("\0").update(identitySha256(replacement)).digest("hex");
    transactionDigest = transaction;
    const replacementIsCurrent = await bounded("replacement process identity", request.timeouts.identityMs, (signal) =>
      dependencies.revalidateProcessIdentity(replacement!, "replacement", signal));
    if (!replacementIsCurrent) throw new Error("Replacement process identity changed");
    await persist("replacement_started");

    await bounded("replacement health", request.timeouts.healthMs, (signal) =>
      dependencies.verifyReplacementHealth(replacement!, request.replacement.port, signal));
    await persist("replacement_healthy");
    const creation = await bounded("replacement session", request.timeouts.sessionMs, (signal) =>
      dependencies.createReplacementSession(replacement!, request.replacement.port, transaction, signal));
    if (!isRecord(creation) || creation.status !== "created" || creation.transactionSha256 !== transaction
      || !Object.hasOwn(creation, "session")) throw new Error("Replacement session creation is invalid");
    const session = creation.session as Session;
    await persist("session_created");

    const memoryAcknowledgement = await bounded("typed memory acknowledgement", request.timeouts.memoryAckMs, (signal) =>
      dependencies.acknowledgeTypedMemory(replacement!, session, handoffDigest, transaction, signal));
    if (memoryAcknowledgement.status !== "acknowledged" || memoryAcknowledgement.handoffSha256 !== handoffDigest
      || memoryAcknowledgement.transactionSha256 !== transaction) {
      throw new Error("Typed memory acknowledgement is invalid");
    }
    await persist("typed_memory_acknowledged");
    const idleAcknowledgement = await bounded("terminal idle acknowledgement", request.timeouts.terminalIdleMs, (signal) =>
      dependencies.awaitTerminalIdleAcknowledgement(replacement!, session, handoffDigest, transaction, signal));
    if (idleAcknowledgement.status !== "idle" || idleAcknowledgement.handoffSha256 !== handoffDigest
      || idleAcknowledgement.transactionSha256 !== transaction || idleAcknowledgement.assistantResult !== "completed") {
      throw new Error("Terminal idle acknowledgement is invalid");
    }
    await persist("terminal_idle_acknowledged");

    if (dependencies.prepareRecoveryOwner) {
      const owner = await bounded("recovery owner", request.timeouts.identityMs, (signal) =>
        dependencies.prepareRecoveryOwner!(replacement!, session, handoffDigest, transaction, signal));
      if (owner.status !== "ready" || owner.transactionSha256 !== transaction
        || owner.replacementIdentitySha256 !== identitySha256(replacement)) {
        throw new Error("Recovery owner acknowledgement is invalid");
      }
      await persist("recovery_owner_ready");
    }

    const bindingStillCurrent = await bounded("restart binding", request.timeouts.identityMs, (signal) =>
      dependencies.revalidateBinding(request.binding, request.worktree, signal));
    const oldStillCurrent = await bounded("old process identity", request.timeouts.identityMs, (signal) =>
      dependencies.revalidateProcessIdentity(request.oldProcess, "old", signal));
    const replacementStillCurrent = await bounded("replacement process identity", request.timeouts.identityMs, (signal) =>
      dependencies.revalidateProcessIdentity(replacement!, "replacement", signal));
    if (!bindingStillCurrent || !oldStillCurrent || !replacementStillCurrent) {
      throw new Error("Binding or process identity changed before retirement");
    }
    if (dependencies.commitRecoveryOwner) {
      await bounded("recovery owner commit", request.timeouts.identityMs, (signal) =>
        dependencies.commitRecoveryOwner!(transaction, signal));
    }
    retirementCommitted = true;
    await persist("retirement_committed", true);
    await bounded("old process retirement", request.timeouts.retirementMs, (signal) =>
      dependencies.retireOldProcess(request.oldProcess, signal));
    oldParentRetired = true;
    await persist("old_parent_retired");
    return { handoffSha256: handoffDigest, replacementIdentitySha256: identitySha256(replacement) };
  } catch (error) {
    if (retirementCommitted && replacement) {
      try {
        await dependencies.persistEvidence({
          phase: "committed_recovery",
          lastCompletedPhase,
          handoffSha256: handoffDigest,
          actionCount: request.handoff.actions.length,
          changedPathCount: request.handoff.changedPaths.length,
          checkCount: request.handoff.checks.length,
          replacementIdentitySha256: identitySha256(replacement),
          transactionSha256: transactionDigest ?? null,
          retirementCommitted: true,
          oldParentRetired,
          replacementStopped: false,
          occurredAt: new Date().toISOString(),
        });
      } catch {}
      return {
        handoffSha256: handoffDigest,
        replacementIdentitySha256: identitySha256(replacement),
        recoveryState: "retirement_committed",
      };
    }
    if (!retirementCommitted && replacement) {
      try { await dependencies.abortRecoveryOwner?.(createHash("sha256").update(handoffDigest).update("\0").update(identitySha256(replacement)).digest("hex")); } catch {}
      try {
        const replacementIsCurrent = await bounded("replacement cleanup identity", request.timeouts.identityMs, (signal) =>
          dependencies.revalidateProcessIdentity(replacement!, "replacement", signal));
        if (replacementIsCurrent) {
          await bounded("replacement cleanup", request.timeouts.retirementMs, (signal) =>
            dependencies.stopReplacement(replacement!, signal));
          replacementStopped = true;
        }
      } catch {}
    }
    try {
      await dependencies.persistEvidence({
        phase: "failed",
        lastCompletedPhase,
        handoffSha256: handoffDigest,
        actionCount: request.handoff.actions.length,
        changedPathCount: request.handoff.changedPaths.length,
        checkCount: request.handoff.checks.length,
        replacementIdentitySha256: replacement ? identitySha256(replacement) : null,
        transactionSha256: transactionDigest ?? null,
        retirementCommitted,
        oldParentRetired,
        replacementStopped,
        occurredAt: new Date().toISOString(),
      });
    } catch {}
    throw error;
  }
}

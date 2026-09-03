import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_BINDING_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

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
  | "retirement_committed"
  | "old_parent_retired";

export interface ReplacementFirstRestartEvidence {
  phase: ReplacementFirstRestartPhase | "committed_recovery" | "failed";
  lastCompletedPhase: ReplacementFirstRestartPhase | null;
  handoffSha256: string;
  replacementIdentitySha256: string | null;
  retirementCommitted: boolean;
  oldParentRetired: boolean;
  replacementStopped: boolean;
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

function redactedHandoff(value: unknown): RedactedRestartHandoff {
  if (!hasExactKeys(value, ["status", "taskHash", "todos", "nextWork"])
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
    handoff: redactedHandoff(parsed.handoff),
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
  let oldParentRetired = false;
  let replacementStopped = false;
  let terminalIdleAcknowledged = false;
  let retirementCommitted = false;
  const persist = async (phase: ReplacementFirstRestartPhase, committed = retirementCommitted): Promise<void> => {
    await dependencies.persistEvidence({
      phase,
      lastCompletedPhase: phase,
      handoffSha256: handoffDigest,
      replacementIdentitySha256: replacement ? identitySha256(replacement) : null,
      retirementCommitted: committed,
      oldParentRetired,
      replacementStopped,
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
    const replacementIsCurrent = await bounded("replacement process identity", request.timeouts.identityMs, (signal) =>
      dependencies.revalidateProcessIdentity(replacement!, "replacement", signal));
    if (!replacementIsCurrent) throw new Error("Replacement process identity changed");
    await persist("replacement_started");

    await bounded("replacement health", request.timeouts.healthMs, (signal) =>
      dependencies.verifyReplacementHealth(replacement!, request.replacement.port, signal));
    await persist("replacement_healthy");
    const transactionDigest = createHash("sha256").update(handoffDigest).update("\0").update(identitySha256(replacement)).digest("hex");
    const creation = await bounded("replacement session", request.timeouts.sessionMs, (signal) =>
      dependencies.createReplacementSession(replacement!, request.replacement.port, transactionDigest, signal));
    if (!isRecord(creation) || creation.status !== "created" || creation.transactionSha256 !== transactionDigest
      || !Object.hasOwn(creation, "session")) throw new Error("Replacement session creation is invalid");
    const session = creation.session as Session;
    await persist("session_created");

    const memoryAcknowledgement = await bounded("typed memory acknowledgement", request.timeouts.memoryAckMs, (signal) =>
      dependencies.acknowledgeTypedMemory(replacement!, session, handoffDigest, transactionDigest, signal));
    if (memoryAcknowledgement.status !== "acknowledged" || memoryAcknowledgement.handoffSha256 !== handoffDigest
      || memoryAcknowledgement.transactionSha256 !== transactionDigest) {
      throw new Error("Typed memory acknowledgement is invalid");
    }
    await persist("typed_memory_acknowledged");
    const idleAcknowledgement = await bounded("terminal idle acknowledgement", request.timeouts.terminalIdleMs, (signal) =>
      dependencies.awaitTerminalIdleAcknowledgement(replacement!, session, handoffDigest, transactionDigest, signal));
    if (idleAcknowledgement.status !== "idle" || idleAcknowledgement.handoffSha256 !== handoffDigest
      || idleAcknowledgement.transactionSha256 !== transactionDigest || idleAcknowledgement.assistantResult !== "completed") {
      throw new Error("Terminal idle acknowledgement is invalid");
    }
    terminalIdleAcknowledged = true;
    await persist("terminal_idle_acknowledged");

    const bindingStillCurrent = await bounded("restart binding", request.timeouts.identityMs, (signal) =>
      dependencies.revalidateBinding(request.binding, request.worktree, signal));
    const oldStillCurrent = await bounded("old process identity", request.timeouts.identityMs, (signal) =>
      dependencies.revalidateProcessIdentity(request.oldProcess, "old", signal));
    const replacementStillCurrent = await bounded("replacement process identity", request.timeouts.identityMs, (signal) =>
      dependencies.revalidateProcessIdentity(replacement!, "replacement", signal));
    if (!bindingStillCurrent || !oldStillCurrent || !replacementStillCurrent) {
      throw new Error("Binding or process identity changed before retirement");
    }
    await persist("retirement_committed", true);
    retirementCommitted = true;
    await bounded("old process retirement", request.timeouts.retirementMs, (signal) =>
      dependencies.retireOldProcess(request.oldProcess, signal));
    oldParentRetired = true;
    await persist("old_parent_retired");
    return { handoffSha256: handoffDigest, replacementIdentitySha256: identitySha256(replacement) };
  } catch (error) {
    if (oldParentRetired && replacement) {
      try {
        await dependencies.persistEvidence({
          phase: "committed_recovery",
          lastCompletedPhase,
          handoffSha256: handoffDigest,
          replacementIdentitySha256: identitySha256(replacement),
          retirementCommitted: true,
          oldParentRetired: true,
          replacementStopped: false,
        });
      } catch {}
      return {
        handoffSha256: handoffDigest,
        replacementIdentitySha256: identitySha256(replacement),
        recoveryState: "retirement_committed",
      };
    }
    if (!terminalIdleAcknowledged && replacement) {
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
        replacementIdentitySha256: replacement ? identitySha256(replacement) : null,
        retirementCommitted,
        oldParentRetired,
        replacementStopped,
      });
    } catch {}
    throw error;
  }
}

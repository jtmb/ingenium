import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { jobs, logger } from "ingenium-core";

// ============================================================================
// Concurrency cap
// ============================================================================

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
const forceKillTimers = new Map<string, ReturnType<typeof setTimeout>>();
const closePromises = new Map<string, Promise<void>>();
const terminationCompletions = new Map<string, Promise<void>>();
const resolveEscalations = new Map<string, () => void>();
const groupRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();

// `detached: true` starts a POSIX child as the leader of a new process group.
// Windows does not expose the same portable process-group signal semantics.
const supportsOwnedProcessGroups = process.platform !== "win32";
const RUN_NONCE_ENV = "INGENIUM_JOB_RUN_NONCE";

/** Immutable identity data captured from procfs for an owned process. */
export interface JobProcessIdentity {
  processId: number;
  processGroupId: number;
  sessionId: number;
  startTime: string;
  executable: string;
  runNonce?: string;
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
  createRunNonce: () => string;
  signalProcessGroup: (processGroupId: number, signal: NodeJS.Signals) => void;
}

interface ProcessTrackingEvent {
  event: string;
  detail: string;
  at: number;
}

interface OwnedDetachedRun {
  runId: string;
  runNonce: string;
  processGroupId: number;
  leader: JobProcessIdentity | null;
  initialGroupMembers: JobProcessIdentity[];
  lastObservedGroupMembers: JobProcessIdentity[];
  knownMembers: Map<number, JobProcessIdentity>;
  events: ProcessTrackingEvent[];
}

/** Read-only diagnostic shape exposed only for colocated deterministic tests. */
export interface OwnedDetachedRunDiagnostic {
  runId: string;
  runNonce: string;
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

function inspectLinuxStat(processId: number): Omit<JobProcessIdentity, "executable" | "runNonce"> | null {
  try {
    return parseProcStat(processId, readFileSync(`/proc/${processId}/stat`, "utf-8"));
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
    const stat = inspectLinuxStat(processId);
    const executable = readlinkSync(`/proc/${processId}/exe`);
    const runNonce = readRunNonce(readFileSync(`/proc/${processId}/environ`, "utf-8"));
    if (!stat || !executable) return null;
    return { ...stat, executable, runNonce };
  } catch {
    return null;
  }
}

const linuxProcessInspector: JobProcessInspector = {
  inspectProcess: inspectLinuxProcess,
  inspectGroup(processGroupId): JobProcessGroup | null {
    if (process.platform !== "linux" || !Number.isSafeInteger(processGroupId) || processGroupId <= 0) return null;

    try {
      const members: JobProcessIdentity[] = [];
      for (const entry of readdirSync("/proc", { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
        const processId = Number(entry.name);
        const stat = inspectLinuxStat(processId);
        // A process can disappear between readdir and its procfs reads. Do not
        // guess that the remaining entries are complete; retry on the next
        // verification instead of potentially signalling an unknown member.
        if (!stat) return null;
        if (stat.processGroupId !== processGroupId) continue;

        // Only inspect environ/exe for a member of the candidate group. Other
        // users' unrelated processes need not be readable for us to make a
        // complete ownership decision about this detached group.
        const identity = inspectLinuxProcess(processId);
        if (!identity) return null;
        members.push(identity);
      }
      return { processGroupId, members };
    } catch {
      return null;
    }
  },
};

const defaultJobRunnerRuntime: JobRunnerRuntime = {
  processInspector: linuxProcessInspector,
  createRunNonce: randomUUID,
  signalProcessGroup(processGroupId, signal): void {
    process.kill(-processGroupId, signal);
  },
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

/** Return immutable tracking evidence for a run while teardown remains unverified. */
export function getOwnedDetachedRunDiagnosticForTesting(runId: string): OwnedDetachedRunDiagnostic | undefined {
  const tracked = ownedDetachedRuns.get(runId);
  if (!tracked) return undefined;
  return {
    runId: tracked.runId,
    runNonce: tracked.runNonce,
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
  activeRunCount = 0;
  runningProcesses.clear();
  forceKillTimers.clear();
  closePromises.clear();
  terminationCompletions.clear();
  resolveEscalations.clear();
  groupRecoveryTimers.clear();
  ownedDetachedRuns.clear();
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
    && actual.runNonce === expected.runNonce;
}

function hasExpectedNonce(member: JobProcessIdentity, tracked: OwnedDetachedRun): boolean {
  return member.processGroupId === tracked.processGroupId && member.runNonce === tracked.runNonce;
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
  const tracked: OwnedDetachedRun = {
    runId,
    runNonce,
    processGroupId: processId,
    leader: null,
    initialGroupMembers: [],
    lastObservedGroupMembers: [],
    knownMembers: new Map(),
    events: [],
  };

  if (!leader || leader.processGroupId !== processId || leader.runNonce !== runNonce) {
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

function noteLeaderClosed(runId: string): void {
  const tracked = ownedDetachedRuns.get(runId);
  if (!tracked) return;
  recordTrackingEvent(tracked, "leader-closed", "awaiting-owned-group-teardown");
  if (!verifyOwnedGroupTeardown(tracked)) scheduleGroupRecovery(tracked);
}

function signalOwnedProcess(runId: string, proc: ChildProcess, signal: NodeJS.Signals): void {
  if (supportsOwnedProcessGroups) {
    const tracked = ownedDetachedRuns.get(runId);
    if (!tracked) return;

    const verification = revalidateOwnedGroup(tracked);
    if (verification.status !== "trusted") {
      recordTrackingEvent(
        tracked,
        "signal-suppressed",
        verification.status === "empty" ? "owned-group-empty" : verification.reason,
      );
      if (verification.status !== "empty") scheduleGroupRecovery(tracked);
      return;
    }

    try {
      jobRunnerRuntime.signalProcessGroup(tracked.processGroupId, signal);
      recordTrackingEvent(tracked, "group-signalled", signal);
    } catch {
      // ESRCH and permission failures are not an invitation to fall back to a
      // numeric PID. That PID/PGID may already belong to another process.
      recordTrackingEvent(tracked, "group-signal-failed", signal);
      scheduleGroupRecovery(tracked);
    }
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
    signalOwnedProcess(runId, proc, "SIGKILL");
    const tracked = ownedDetachedRuns.get(runId);
    if (tracked && !verifyOwnedGroupTeardown(tracked)) scheduleGroupRecovery(tracked);
    const resolve = resolveEscalations.get(runId);
    resolveEscalations.delete(runId);
    resolve?.();
  }, JOB_TERMINATION_GRACE_MS);
  forceKillTimers.set(runId, timer);
  return completion;
}

/**
 * Execute a job run by spawning the opencode CLI.
 *
 * Feasibility gate: opencode v1.17.18 supports `opencode run "<prompt>" --agent <name>`
 * The message is a positional argument, not a flag. The `--auto` flag enables
 * non-interactive auto-approval of permissions.
 */
export async function executeJobRun(
  runId: string,
  job: { id: string; agent: string; prompt_template: string; timeout_minutes: number; project_id: string },
  _prompt: string,
): Promise<void> {
  // Interpolate any tokens in the prompt template (simple: just use as-is for now)
  const prompt = job.prompt_template;

  // Check concurrency
  if (activeRunCount >= MAX_CONCURRENT_RUNS) {
    logger.warn("job-runner", `Concurrency limit reached (${MAX_CONCURRENT_RUNS}). Run ${runId} will be queued.`);
    jobs.finishJobRun(runId, "failed", -1);
    jobs.appendRunLog(runId, "stderr", `Concurrency limit reached: ${MAX_CONCURRENT_RUNS} runs already active.`);
    return;
  }

  activeRunCount++;
  logger.info("job-runner", `Starting run ${runId} for job ${job.id} (agent: ${job.agent}, active: ${activeRunCount}/${MAX_CONCURRENT_RUNS})`);

  // Update run status to running (it should already be 'running' from startJobRun,
  // but we re-affirm in case of any race)
  const run = jobs.getJobRun(runId);
  if (!run) {
    logger.error("job-runner", `Run ${runId} not found in DB — aborting.`);
    activeRunCount--;
    return;
  }
  if (run.status !== "running") {
    jobs.finishJobRun(runId, "running" as any, null);
  }

  // Default 30-minute timeout prevents runaway agents from consuming resources indefinitely.
  // The timeout is generous — typical agent runs finish in 2-10 minutes — because the
  // opencode CLI may include LLM inference time, tool calls, and user-facing confirmations.
  const timeoutMinutes = job.timeout_minutes > 0 ? job.timeout_minutes : 30;
  const timeoutMs = timeoutMinutes * 60 * 1000;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  // Build opencode command args.
  // opencode run "<prompt>" --agent <agent_name> --auto
  const args = ["run", prompt, "--agent", job.agent, "--auto"];
  const runNonce = jobRunnerRuntime.createRunNonce();

  // Prompts are user-authored and can contain credentials. Do not log the CLI
  // arguments or rendered template, even at debug level.
  logger.info("job-runner", `Starting OpenCode process for run ${runId} (agent: ${job.agent})`);

  // cwd: "/workspace" matches the Docker bind mount so the agent sees the host's repos.
  // HOME is set explicitly because the Docker container's appuser may not inherit the
  // expected home directory through the spawn() environment merge.
  const proc = spawn("opencode", args, {
    cwd: "/workspace",
    env: { ...process.env, HOME: "/home/appuser", [RUN_NONCE_ENV]: runNonce },
    stdio: ["ignore", "pipe", "pipe"],
    detached: supportsOwnedProcessGroups,
  });

  runningProcesses.set(runId, proc);
  if (supportsOwnedProcessGroups && typeof proc.pid === "number" && proc.pid > 0) {
    trackDetachedProcess(runId, proc.pid, runNonce);
  }
  let resolveClose: (() => void) | undefined;
  closePromises.set(runId, new Promise<void>((resolve) => {
    resolveClose = resolve;
  }));
  let finalized = false;
  let activeSlotReleased = false;

  const releaseActiveSlot = () => {
    if (activeSlotReleased) return;
    activeSlotReleased = true;
    activeRunCount = Math.max(0, activeRunCount - 1);
  };

  const finalize = (): boolean => {
    if (finalized) return false;
    finalized = true;
    runningProcesses.delete(runId);

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
  timeoutHandle = setTimeout(() => {
    if (finalized) return;
    timedOut = true;
    logger.warn("job-runner", `Run ${runId} timed out after ${timeoutMs}ms — killing process.`);
    terminateProcess(runId, proc);
    jobs.finishJobRun(runId, "timeout", -1);
    jobs.appendRunLog(runId, "stderr", `Job timed out after ${timeoutMinutes} minutes.`);
  }, timeoutMs);

  // Collect stdout — split by newlines
  let stdoutBuffer = "";
  proc.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf-8");
    const lines = stdoutBuffer.split("\n");
    // Keep the last incomplete line in the buffer (stream may end mid-line)
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) {
        jobs.appendRunLog(runId, "stdout", line);
      }
    }
  });

  // Collect stderr — split by newlines
  let stderrBuffer = "";
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderrBuffer += chunk.toString("utf-8");
    const lines = stderrBuffer.split("\n");
    stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) {
        jobs.appendRunLog(runId, "stderr", line);
      }
    }
  });

  proc.on("close", (code) => {
    // Flush any remaining buffer content (last partial line from stream data)
    if (stdoutBuffer.length > 0) {
      jobs.appendRunLog(runId, "stdout", stdoutBuffer);
    }
    if (stderrBuffer.length > 0) {
      jobs.appendRunLog(runId, "stderr", stderrBuffer);
    }

    if (timeoutHandle) clearTimeout(timeoutHandle);

    const wasTerminated = terminationCompletions.has(runId);
    if (!timedOut && !wasTerminated && finalize()) {
      const exitCode = code ?? -1;
      const status = exitCode === 0 ? "success" : "failed";
      logger.info("job-runner", `Run ${runId} finished: status=${status}, exitCode=${exitCode}`);
      jobs.finishJobRun(runId, status, exitCode);
    }

    finalize();
    closePromises.delete(runId);
    resolveClose?.();
    noteLeaderClosed(runId);
    logger.info("job-runner", `Run ${runId} cleaned up (active: ${activeRunCount}/${MAX_CONCURRENT_RUNS})`);
  });

  proc.on("error", (err: Error) => {
    // A launched child can report an operational error while still emitting a
    // later close event. Keep it tracked so termination escalation remains live.
    if (proc.pid !== undefined) {
      logger.warn("job-runner", `Run ${runId} process error while awaiting close`, { name: err.name });
      return;
    }

    if (timeoutHandle) clearTimeout(timeoutHandle);

    logger.error("job-runner", `Run ${runId} failed to start`, { name: err.name });
    jobs.finishJobRun(runId, "failed", -1);
    jobs.appendRunLog(runId, "stderr", "Unable to start the OpenCode process.");

    finalize();
    closePromises.delete(runId);
    resolveClose?.();
  });
}

/**
 * Try to kill a running job run by its runId.
 * Returns true if the process was found and termination was initiated.
 */
export function killRunProcess(runId: string): boolean {
  const proc = runningProcesses.get(runId);
  if (!proc || !isProcessRunning(proc)) return false;

  logger.info("job-runner", `Killing process for run ${runId}`);
  terminateProcess(runId, proc);
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

  const completions: Promise<void>[] = [];
  for (const [runId, proc] of pending) {
    try {
      jobs.cancelJobRun(runId);
      jobs.appendRunLog(runId, "stderr", "Job cancelled because the API is shutting down.");
    } catch {
      logger.warn("job-runner", `Could not persist shutdown state for run ${runId}`);
    }
    completions.push(terminateProcess(runId, proc));
  }

  await Promise.allSettled(completions);
}

export { runningProcesses };

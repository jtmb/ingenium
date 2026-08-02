import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { JobProcessIdentity, JobProcessInspector } from "../lib/job-runner.js";

const childHarness = vi.hoisted(() => ({
  next: null as ChildProcess | null,
}));

const core = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  jobs: {
    appendRunLog: vi.fn(),
    cancelJobRun: vi.fn(),
    finishJobRun: vi.fn(),
    getJobRun: vi.fn(() => ({ status: "running" })),
  },
  jobEventDeliveries: {
    JOB_EVENT_DELIVERY_LEASE_MS: 30_000,
    completeJobEventDelivery: vi.fn(),
    heartbeatJobEventDelivery: vi.fn(() => true),
    persistJobEventAttemptProcessIdentity: vi.fn(() => true),
    resolveExpiredJobEventLease: vi.fn(),
    sanitizeJobEventText: vi.fn((value: string) => value.replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, "$1 [REDACTED]")),
  },
}));

vi.mock("ingenium-core", () => core);

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    if (!childHarness.next) throw new Error("test did not provide a fake child process");
    return childHarness.next;
  }),
}));

import {
  configureJobRunnerRuntimeForTesting,
  buildJobProcessEnvironment,
  executeJobRun,
  getOwnedDetachedRunDiagnosticForTesting,
  JOB_TERMINATION_GRACE_MS,
  killRunProcess,
  recoverExpiredEventAttempt,
  resetJobRunnerForTesting,
  runningProcesses,
  stopAllJobRuns,
} from "../lib/job-runner.js";

const job = {
  id: "job-id",
  agent: "test-agent",
  prompt_template: "prompt omitted from assertions",
  project_id: "project-id",
  timeout_minutes: 1,
};

type MutableChild = ChildProcess & EventEmitter & {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: ReturnType<typeof vi.fn>;
};

function fakeChild(processId = 101): MutableChild {
  const child = new EventEmitter() as unknown as MutableChild;
  Object.assign(child, {
    pid: processId,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(() => true),
  });
  return child;
}

function closeChild(child: MutableChild, code: number | null = null, signal: NodeJS.Signals | null = "SIGTERM"): void {
  child.exitCode = code;
  child.signalCode = signal;
  child.emit("close", code, signal);
}

function identity(
  processId: number,
  startTime: string,
  runNonce = "run-nonce",
  executable = "/usr/bin/opencode",
): JobProcessIdentity {
  return {
    processId,
    processGroupId: 101,
    sessionId: 101,
    startTime,
    executable,
    runNonce,
  };
}

function processHarness(initialMembers: JobProcessIdentity[]) {
  const members = new Map(initialMembers.map((member) => [member.processId, { ...member }]));
  const inspector: JobProcessInspector = {
    inspectProcess: vi.fn((processId: number) => {
      const member = members.get(processId);
      return member ? { ...member } : null;
    }),
    inspectGroup: vi.fn((processGroupId: number) => ({
      processGroupId,
      members: [...members.values()]
        .filter((member) => member.processGroupId === processGroupId)
        .map((member) => ({ ...member })),
    })),
  };
  return { members, inspector };
}

async function startRun(runId: string, child: MutableChild): Promise<void> {
  childHarness.next = child;
  await executeJobRun(runId, job, job.prompt_template);
}

let restoreRuntime: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  resetJobRunnerForTesting();
  childHarness.next = null;
  core.jobs.getJobRun.mockReturnValue({ status: "running" });
});

afterEach(async () => {
  if (runningProcesses.size > 0) {
    const stopping = stopAllJobRuns();
    await vi.advanceTimersByTimeAsync(JOB_TERMINATION_GRACE_MS);
    await stopping;
  }
  restoreRuntime?.();
  restoreRuntime = undefined;
  resetJobRunnerForTesting();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("job-runner process lifecycle", () => {
  it("records verified event-process identity without retaining the plaintext nonce and treats nonzero exits as transient delivery failures", async () => {
    const runId = "event-run";
    const child = fakeChild();
    const proc = processHarness([identity(101, "leader-start")]);
    restoreRuntime = configureJobRunnerRuntimeForTesting({
      processInspector: proc.inspector,
      createRunNonce: () => "run-nonce",
    });

    childHarness.next = child;
    await executeJobRun(runId, job, job.prompt_template, {
      deliveryId: "delivery-id", attemptNumber: 1, leaseToken: "a".repeat(32), leaseRevision: 1,
    });
    expect(core.jobEventDeliveries.persistJobEventAttemptProcessIdentity).toHaveBeenCalledWith("project-id", expect.objectContaining({
      processId: 101,
      processNonce: "run-nonce",
    }));
    (child.stdout as EventEmitter).emit("data", Buffer.from("prompt=payload-should-not-persist\n"));
    closeChild(child, 7, null);
    expect(core.jobs.appendRunLog).toHaveBeenCalledWith(
      "project-id", runId, "stdout", "Event job output redacted from durable logs.",
    );
    expect(core.jobEventDeliveries.completeJobEventDelivery).toHaveBeenCalledWith("project-id", expect.objectContaining({
      outcome: "failed",
      errorCode: "nonzero_exit",
      errorMessage: expect.not.stringContaining(job.prompt_template),
    }));
  });

  it("dead-letters missing spawn evidence and retries only a fully persisted identity proven absent", async () => {
    const crashedBeforePersist = {
      projectId: "project-id", deliveryId: "delivery-crash-before-persist", leaseRevision: 1, attemptNumber: 1, runId: "run-crash-before-persist",
      processId: null, processGroupId: null, processStartTime: null, processExecutable: null, processNonceHash: null,
    };
    await recoverExpiredEventAttempt(crashedBeforePersist);
    expect(core.jobEventDeliveries.resolveExpiredJobEventLease).toHaveBeenLastCalledWith("project-id", expect.objectContaining({
      resolution: "dead_letter", errorCode: "ambiguous_process_identity",
    }));

    await recoverExpiredEventAttempt({
      projectId: "project-id", deliveryId: "delivery-incomplete", leaseRevision: 1, attemptNumber: 1, runId: "run-incomplete",
      processId: 99999999, processGroupId: null, processStartTime: null, processExecutable: null, processNonceHash: null,
    });
    expect(core.jobEventDeliveries.resolveExpiredJobEventLease).toHaveBeenLastCalledWith("project-id", expect.objectContaining({
      resolution: "dead_letter", errorCode: "ambiguous_process_identity",
    }));

    restoreRuntime = configureJobRunnerRuntimeForTesting({
      processInspector: { inspectProcess: () => null, inspectGroup: () => null },
    });
    await recoverExpiredEventAttempt({
      projectId: "project-id", deliveryId: "delivery-proven-absent", leaseRevision: 1, attemptNumber: 1, runId: "run-proven-absent",
      processId: 99999999, processGroupId: 99999999, processStartTime: "start", processExecutable: "/usr/bin/opencode",
      processNonceHash: "a".repeat(64),
    });
    expect(core.jobEventDeliveries.resolveExpiredJobEventLease).toHaveBeenLastCalledWith("project-id", expect.objectContaining({
      resolution: "retry", errorCode: "process_absent",
    }));

    const proc = processHarness([identity(101, "unexpected-start", "other-nonce")]);
    restoreRuntime = configureJobRunnerRuntimeForTesting({ processInspector: proc.inspector });
    await recoverExpiredEventAttempt({
      projectId: "project-id", deliveryId: "delivery-ambiguous", leaseRevision: 2, attemptNumber: 2, runId: "run-ambiguous",
      processId: 101, processGroupId: 101, processStartTime: "expected-start", processExecutable: "/usr/bin/opencode",
      processNonceHash: "a".repeat(64),
    });
    expect(core.jobEventDeliveries.resolveExpiredJobEventLease).toHaveBeenLastCalledWith("project-id", expect.objectContaining({
      resolution: "dead_letter", errorCode: "ambiguous_process_ownership",
    }));
  });

  it("terminates and revalidates a verified live process group before retrying", async () => {
    const proc = processHarness([identity(101, "expected-start", "run-nonce")]);
    const signalProcessGroup = vi.fn((_groupId: number, signal: NodeJS.Signals) => {
      if (signal === "SIGTERM") proc.members.clear();
    });
    restoreRuntime = configureJobRunnerRuntimeForTesting({ processInspector: proc.inspector, signalProcessGroup });

    await recoverExpiredEventAttempt({
      projectId: "project-id", deliveryId: "delivery-live", leaseRevision: 1, attemptNumber: 1, runId: "run-live",
      processId: 101, processGroupId: 101, processStartTime: "expected-start", processExecutable: "/usr/bin/opencode",
      processNonceHash: createHash("sha256").update("run-nonce", "utf8").digest("hex"),
    });

    expect(signalProcessGroup).toHaveBeenCalledWith(101, "SIGTERM");
    expect(core.jobEventDeliveries.resolveExpiredJobEventLease).toHaveBeenLastCalledWith("project-id", expect.objectContaining({
      resolution: "retry", errorCode: "verified_crash",
    }));
  });

  it("starts the CLI with only the allowlisted runtime environment", async () => {
    vi.stubEnv("INGENIUM_API_TOKEN", "api-secret");
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "server-secret");
    vi.stubEnv("OPENAI_API_KEY", "provider-secret");
    vi.stubEnv("COOKIE", "cookie-secret");
    const child = fakeChild();
    const proc = processHarness([identity(101, "leader-start")]);
    restoreRuntime = configureJobRunnerRuntimeForTesting({ processInspector: proc.inspector, createRunNonce: () => "run-nonce" });

    childHarness.next = child;
    await executeJobRun("allowlisted-env", { ...job, agent: "Bearer agent-secret" }, job.prompt_template);
    const spawnOptions = vi.mocked(spawn).mock.calls.at(-1)?.[2];
    expect(spawnOptions?.env).toMatchObject({
      PATH: expect.any(String), HOME: "/home/appuser", USER: expect.any(String), SHELL: expect.any(String),
      TERM: expect.any(String), LANG: expect.any(String), XDG_CONFIG_HOME: expect.any(String),
      XDG_DATA_HOME: expect.any(String), XDG_CACHE_HOME: expect.any(String), INGENIUM_JOB_PROJECT_ID: "project-id",
    });
    for (const name of ["INGENIUM_API_TOKEN", "OPENCODE_SERVER_PASSWORD", "OPENAI_API_KEY", "COOKIE"]) {
      expect(spawnOptions?.env).not.toHaveProperty(name);
    }
    expect(buildJobProcessEnvironment("project-id", "run-nonce")).not.toHaveProperty("INGENIUM_API_TOKEN");
    expect(core.logger.info.mock.calls.flat().join(" ")).not.toContain("agent-secret");
    closeChild(child, 0, null);
  });

  it("revalidates a nonce-marked descendant after leader exit and retains evidence until SIGKILL teardown is verified", async () => {
    const runId = "descendant-run";
    const child = fakeChild();
    const proc = processHarness([identity(101, "leader-start")]);
    const groupSignals: NodeJS.Signals[] = [];
    restoreRuntime = configureJobRunnerRuntimeForTesting({
      processInspector: proc.inspector,
      createRunNonce: () => "run-nonce",
      signalProcessGroup: (_processGroupId, signal) => {
        groupSignals.push(signal);
        if (signal === "SIGKILL") proc.members.clear();
      },
    });

    await startRun(runId, child);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(groupSignals).toEqual(["SIGTERM"]);
    expect(getOwnedDetachedRunDiagnosticForTesting(runId)).toMatchObject({
      runNonce: "run-nonce",
      processGroupId: 101,
      leader: identity(101, "leader-start"),
      initialGroupMembers: [identity(101, "leader-start")],
    });

    // The leader can exit while a well-identified descendant remains in the
    // group. Its inherited nonce and a new immutable identity make SIGKILL safe.
    proc.members.delete(101);
    proc.members.set(102, identity(102, "descendant-start"));
    closeChild(child);

    expect(runningProcesses.has(runId)).toBe(false);
    expect(getOwnedDetachedRunDiagnosticForTesting(runId)?.lastObservedGroupMembers).toEqual([
      identity(102, "descendant-start"),
    ]);

    await vi.advanceTimersByTimeAsync(JOB_TERMINATION_GRACE_MS);

    expect(groupSignals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(child.kill).not.toHaveBeenCalled();
    expect(getOwnedDetachedRunDiagnosticForTesting(runId)).toBeUndefined();
  });

  it("suppresses SIGTERM and SIGKILL when a reused PID/PGID no longer matches the owned leader", async () => {
    const runId = "reused-group-run";
    const child = fakeChild();
    const proc = processHarness([identity(101, "owned-start")]);
    const signalProcessGroup = vi.fn();
    restoreRuntime = configureJobRunnerRuntimeForTesting({
      processInspector: proc.inspector,
      createRunNonce: () => "run-nonce",
      signalProcessGroup,
    });

    await startRun(runId, child);

    // Simulate the old leader/group disappearing and the same numeric PGID
    // becoming an unrelated live group. It must never receive either signal.
    proc.members.set(101, identity(101, "reused-start", "other-run-nonce", "/usr/bin/unrelated"));
    expect(killRunProcess("project-id", runId)).toBe(true);
    closeChild(child);

    await vi.advanceTimersByTimeAsync(JOB_TERMINATION_GRACE_MS);

    expect(signalProcessGroup).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
    expect(getOwnedDetachedRunDiagnosticForTesting(runId)?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "signal-suppressed" }),
      expect.objectContaining({ event: "teardown-unverified" }),
    ]));
  });

  it("suppresses escalation when a known descendant PID has a different start time or executable", async () => {
    const runId = "reused-descendant-run";
    const child = fakeChild();
    const proc = processHarness([identity(101, "leader-start")]);
    const signalProcessGroup = vi.fn();
    restoreRuntime = configureJobRunnerRuntimeForTesting({
      processInspector: proc.inspector,
      createRunNonce: () => "run-nonce",
      signalProcessGroup,
    });

    await startRun(runId, child);
    // Establish a descendant identity that must remain immutable through the
    // eventual SIGKILL revalidation.
    proc.members.set(102, identity(102, "first-descendant-start"));
    expect(killRunProcess("project-id", runId)).toBe(true);
    expect(signalProcessGroup).toHaveBeenCalledWith(101, "SIGTERM");

    proc.members.delete(101);
    proc.members.set(102, identity(102, "reused-descendant-start", "run-nonce", "/usr/bin/unrelated"));
    closeChild(child);
    await vi.advanceTimersByTimeAsync(JOB_TERMINATION_GRACE_MS);

    expect(signalProcessGroup).toHaveBeenCalledTimes(1);
    expect(getOwnedDetachedRunDiagnosticForTesting(runId)?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "group-unverified", detail: "process-identity-reused" }),
      expect.objectContaining({ event: "signal-suppressed", detail: "process-identity-reused" }),
    ]));
  });

  it("awaits shutdown cancellation through the bounded escalation attempt", async () => {
    const runId = "shutdown-run";
    const child = fakeChild();
    const proc = processHarness([identity(101, "leader-start")]);
    restoreRuntime = configureJobRunnerRuntimeForTesting({
      processInspector: proc.inspector,
      createRunNonce: () => "run-nonce",
      signalProcessGroup: (_processGroupId, signal) => {
        if (signal === "SIGKILL") proc.members.clear();
      },
    });

    await startRun(runId, child);
    const stopping = stopAllJobRuns();
    await Promise.resolve();

    expect(core.jobs.cancelJobRun).toHaveBeenCalledWith("project-id", runId);
    expect(runningProcesses.get(runId)).toBe(child);

    closeChild(child);
    await vi.advanceTimersByTimeAsync(JOB_TERMINATION_GRACE_MS);
    await stopping;

    expect(runningProcesses.has(runId)).toBe(false);
    expect(getOwnedDetachedRunDiagnosticForTesting(runId)).toBeUndefined();
  });
});

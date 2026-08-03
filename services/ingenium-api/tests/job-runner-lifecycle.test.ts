import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import type { JobProcessIdentity, JobProcessInspector, ProcfsAccessForTesting } from "../lib/job-runner.js";

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
    getVaultSecretRunRecovery: vi.fn(),
    listVaultSecretRunsForRecovery: vi.fn(() => []),
    prepareVaultJobRun: vi.fn((_projectId: string, input: {
      runId: string; jobId: string; deadlineAt: number; processNonceHash: string;
      itemSnapshots: Array<{ itemId: string; authorizedItemVersion: number }>;
    }) => ({
      ...input,
      projectId: "project-id",
      state: "prepared",
      revision: 0,
      processIdentity: null,
    })),
    recordVaultJobRunProcessIdentity: vi.fn((_projectId: string, runId: string, identity: {
      processId: number; processGroupId: number; processStartTime: string; processExecutable: string;
    }) => ({
      runId,
      projectId: "project-id",
      jobId: "job-id",
      state: "spawned",
      deadlineAt: Date.now() + 60_000,
      revision: 1,
      processNonceHash: "a".repeat(64),
      itemSnapshots: [],
      processIdentity: identity,
    })),
    markVaultJobRunTeardownPending: vi.fn(),
    markVaultJobRunCleaned: vi.fn(),
    markVaultJobRunFailed: vi.fn(),
  },
  vault: {
    resolveJobVaultSecrets: vi.fn(() => null),
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
  recoverVaultSecretRunDirectories,
  inspectLinuxProcessGroupForTesting,
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
  processGroupId = 101,
  sessionId = processGroupId,
  ownerId = process.getuid?.() ?? 1000,
): JobProcessIdentity {
  return {
    processId,
    processGroupId,
    sessionId,
    startTime,
    executable,
    runNonce,
    ownerId,
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

function procStat(processId: number, processGroupId: number, sessionId: number, startTime = "start"): string {
  const fields = Array.from({ length: 20 }, () => "0");
  fields[0] = "S";
  fields[2] = String(processGroupId);
  fields[3] = String(sessionId);
  fields[19] = startTime;
  return `${processId} (synthetic) ${fields.join(" ")}`;
}

function procfsFixture(entries: Array<{
  processId: number;
  ownerId: number;
  stat?: string;
  statError?: string;
  executable?: string;
  environment?: string;
}>): { access: ProcfsAccessForTesting; reads: number[] } {
  const byProcessId = new Map(entries.map((entry) => [entry.processId, entry]));
  const reads: number[] = [];
  const entryFor = (processId: number) => {
    const entry = byProcessId.get(processId);
    if (!entry) throw Object.assign(new Error("gone"), { code: "ENOENT" });
    return entry;
  };
  const readStat = (processId: number): string => {
    reads.push(processId);
    const entry = entryFor(processId);
    if (entry.statError) throw Object.assign(new Error(entry.statError), { code: entry.statError });
    return entry.stat ?? "malformed";
  };
  return {
    reads,
    access: {
      listProcessIds: () => entries.map((entry) => entry.processId),
      lstatProcess: (processId) => ({ uid: entryFor(processId).ownerId }),
      readProcessStat: readStat,
      readProcessExecutable: (processId) => entryFor(processId).executable ?? "/usr/bin/opencode",
      readProcessEnvironment: (processId) => entryFor(processId).environment ?? "INGENIUM_JOB_RUN_NONCE=run-nonce\0",
    },
  };
}

async function startRun(runId: string, child: MutableChild): Promise<void> {
  childHarness.next = child;
  await executeJobRun(runId, job, job.prompt_template);
}

let restoreRuntime: (() => void) | undefined;
let restoreRuntimeSources: (() => void) | undefined;
let runtimeSourcesDirectory = "";

beforeEach(() => {
  vi.useFakeTimers();
  resetJobRunnerForTesting();
  childHarness.next = null;
  core.jobs.getJobRun.mockReturnValue({ status: "running" });
  core.vault.resolveJobVaultSecrets.mockReturnValue(null);
  runtimeSourcesDirectory = mkdtempSync("/dev/shm/ingenium-opencode-runtime-");
  chmodSync(runtimeSourcesDirectory, 0o700);
  const config = join(runtimeSourcesDirectory, "opencode.jsonc");
  const auth = join(runtimeSourcesDirectory, "auth.json");
  writeFileSync(config, '{"provider":{},"plugin":["must-not-run"]}\n', { mode: 0o600 });
  writeFileSync(auth, "{}\n", { mode: 0o600 });
  chmodSync(config, 0o600);
  chmodSync(auth, 0o600);
  restoreRuntimeSources = configureJobRunnerRuntimeForTesting({ openCodeConfigPath: config, openCodeAuthPath: auth });
});

afterEach(async () => {
  if (runningProcesses.size > 0) {
    const stopping = stopAllJobRuns();
    await vi.advanceTimersByTimeAsync(JOB_TERMINATION_GRACE_MS);
    await stopping;
  }
  restoreRuntime?.();
  restoreRuntime = undefined;
  restoreRuntimeSources?.();
  restoreRuntimeSources = undefined;
  if (runtimeSourcesDirectory) rmSync(runtimeSourcesDirectory, { recursive: true, force: true });
  runtimeSourcesDirectory = "";
  resetJobRunnerForTesting();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const vaultItemId = "22222222-2222-4222-8222-222222222222";

function vaultResolution(secret: string, deadlineAt = Date.now() + 60_000) {
  const value = Buffer.from(secret, "utf8");
  const release = vi.fn(() => value.fill(0));
  return {
    secrets: [{ itemId: vaultItemId, authorizedItemVersion: 1, value, release }],
    deadlineAt,
    release,
  };
}

function vaultRoot(): string {
  const root = mkdtempSync("/dev/shm/ingenium-job-secrets-");
  chmodSync(root, 0o700);
  return root;
}

function createRecoveredVaultRunDirectory(root: string, runId: string): string {
  const runDir = join(root, runId);
  mkdirSync(runDir, { mode: 0o700 });
  chmodSync(runDir, 0o700);
  return runDir;
}

function writeRecoveredVaultFile(path: string, value: string): void {
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function materializeRecoveredRuntime(runDir: string): void {
  for (const name of ["home", "config", "data", "cache", "state", "tmp"]) {
    mkdirSync(join(runDir, name), { mode: 0o700 });
    chmodSync(join(runDir, name), 0o700);
  }
  mkdirSync(join(runDir, "config", "opencode"), { mode: 0o700 });
  mkdirSync(join(runDir, "data", "opencode"), { mode: 0o700 });
  writeRecoveredVaultFile(join(runDir, "config", "opencode", "opencode.jsonc"), "{}\n");
  writeRecoveredVaultFile(join(runDir, "data", "opencode", "auth.json"), "{}\n");
}

function recoveredVaultRunDirectory(root: string, runId: string): void {
  const runDir = createRecoveredVaultRunDirectory(root, runId);
  writeRecoveredVaultFile(join(runDir, vaultItemId), "recovery-canary");
  materializeRecoveredRuntime(runDir);
}

function partialRecoveredVaultRunDirectory(
  root: string,
  runId: string,
  step: "directory" | "secret" | "xdg" | "config" | "auth",
): string {
  const runDir = createRecoveredVaultRunDirectory(root, runId);
  if (step === "secret") writeRecoveredVaultFile(join(runDir, vaultItemId), "crash-window-canary");
  if (step === "xdg") {
    mkdirSync(join(runDir, "home"), { mode: 0o700 });
    chmodSync(join(runDir, "home"), 0o700);
  }
  if (step === "config") {
    mkdirSync(join(runDir, "config"), { mode: 0o700 });
    mkdirSync(join(runDir, "config", "opencode"), { mode: 0o700 });
    writeRecoveredVaultFile(join(runDir, "config", "opencode", "opencode.jsonc"), "{}\n");
  }
  if (step === "auth") {
    mkdirSync(join(runDir, "data"), { mode: 0o700 });
    mkdirSync(join(runDir, "data", "opencode"), { mode: 0o700 });
    writeRecoveredVaultFile(join(runDir, "data", "opencode", "auth.json"), "{}\n");
  }
  return runDir;
}

function vaultRecovery(
  runId: string,
  state: "prepared" | "spawned" | "teardown_pending" | "failed" = "prepared",
  processIdentity: { processId: number; processGroupId: number; processStartTime: string; processExecutable: string } | null = null,
) {
  return {
    runId,
    projectId: "project-id",
    jobId: "job-id",
    state,
    deadlineAt: Date.now() + 60_000,
    revision: 0,
    processNonceHash: createHash("sha256").update("run-nonce", "utf8").digest("hex"),
    itemSnapshots: [{ itemId: vaultItemId, authorizedItemVersion: 1 }],
    processIdentity,
  };
}

describe("job-runner process lifecycle", () => {
  it("ignores unrelated procfs entries but retains same-UID target ambiguity", () => {
    const runnerOwnerId = process.getuid?.() ?? 1000;
    const unrelated = procfsFixture([
      // Root-owned malformed entries are never read past lstat ownership.
      { processId: 20, ownerId: runnerOwnerId + 1, stat: "malformed" },
      // A same-UID kernel-style PGID-zero entry cannot belong to the group.
      { processId: 21, ownerId: runnerOwnerId, stat: procStat(21, 0, 0) },
      // Its valid PGID proves this malformed same-UID entry is unrelated.
      { processId: 22, ownerId: runnerOwnerId, stat: procStat(22, 999, 999, "") },
      // Procfs disappearance between enumeration and read is benign.
      { processId: 23, ownerId: runnerOwnerId, statError: "ENOENT" },
    ]);
    expect(inspectLinuxProcessGroupForTesting(101, runnerOwnerId, unrelated.access)).toEqual({
      processGroupId: 101,
      members: [],
    });
    expect(unrelated.reads).not.toContain(20);

    const unreadableTarget = procfsFixture([
      { processId: 102, ownerId: runnerOwnerId, statError: "EACCES" },
    ]);
    expect(inspectLinuxProcessGroupForTesting(101, runnerOwnerId, unreadableTarget.access)).toBeNull();

    const unreadableLeader = procfsFixture([
      { processId: 101, ownerId: runnerOwnerId, statError: "EACCES" },
    ]);
    expect(inspectLinuxProcessGroupForTesting(101, runnerOwnerId, unreadableLeader.access)).toBeNull();

    const malformedTarget = procfsFixture([
      { processId: 102, ownerId: runnerOwnerId, stat: procStat(102, 101, 0) },
    ]);
    expect(inspectLinuxProcessGroupForTesting(101, runnerOwnerId, malformedTarget.access)).toBeNull();
  });

  it("records verified event-process identity without retaining the plaintext nonce and treats nonzero exits as transient delivery failures", async () => {
    const runId = "event-run";
    const child = fakeChild();
    const proc = processHarness([
      identity(101, "leader-start"),
      identity(102, "descendant-start"),
    ]);
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

  it("does not spawn a child while a referenced vault is sealed", async () => {
    core.vault.resolveJobVaultSecrets.mockImplementation(() => {
      throw new Error("VAULT_SECRETS_UNAVAILABLE");
    });

    await executeJobRun("sealed-vault-run", job, job.prompt_template);

    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    expect(core.jobs.finishJobRun).toHaveBeenCalledWith("project-id", "sealed-vault-run", "failed", -1);
    expect(core.jobs.appendRunLog).toHaveBeenCalledWith("project-id", "sealed-vault-run", "stderr", "Vault job output redacted.");
  });

  it("writes a vault Buffer to an exact tmpfs file, exposes only an ID-to-path map, and redacts arbitrary output", async () => {
    const root = vaultRoot();
    const runId = "33333333-3333-4333-8333-333333333333";
    const canary = "vault-runner-canary-never-durable";
    const child = fakeChild();
    const proc = processHarness([identity(101, "leader-start")]);
    const resolved = vaultResolution(canary);
    restoreRuntime = configureJobRunnerRuntimeForTesting({
      processInspector: proc.inspector,
      createRunNonce: () => "run-nonce",
      vaultSecretRoot: root,
    });
    core.vault.resolveJobVaultSecrets.mockReturnValue(resolved);

    try {
      childHarness.next = child;
      await executeJobRun(runId, job, job.prompt_template);
      const spawnCall = vi.mocked(spawn).mock.calls.at(-1)!;
      const environment = spawnCall[2]!.env!;
      expect(spawnCall[1]).toEqual(expect.arrayContaining(["--pure", "--dir", "/workspace"]));
      expect(spawnCall[2]?.cwd).toBe(join(root, runId, "home"));
      const fileMap = JSON.parse(environment.INGENIUM_VAULT_SECRET_FILES!) as Record<string, string>;
      const filePath = fileMap[vaultItemId]!;
      expect(Object.keys(fileMap)).toEqual([vaultItemId]);
      expect(filePath).toBe(join(root, runId, vaultItemId));
      expect(readFileSync(filePath, "utf8")).toBe(canary);
      expect(environment).toMatchObject({
        HOME: join(root, runId, "home"),
        XDG_CONFIG_HOME: join(root, runId, "config"),
        XDG_DATA_HOME: join(root, runId, "data"),
        XDG_CACHE_HOME: join(root, runId, "cache"),
        XDG_STATE_HOME: join(root, runId, "state"),
        TMPDIR: join(root, runId, "tmp"),
      });
      const ephemeralConfig = readFileSync(join(root, runId, "config", "opencode", "opencode.jsonc"), "utf8");
      const ephemeralAuth = readFileSync(join(root, runId, "data", "opencode", "auth.json"), "utf8");
      expect(ephemeralConfig).not.toContain("must-not-run");
      expect(ephemeralConfig).not.toContain("mcp");
      expect(ephemeralAuth).toBe("{}\n");
      expect(readFileSync(join(runtimeSourcesDirectory, "opencode.jsonc"), "utf8")).not.toContain(canary);
      expect(readFileSync(join(runtimeSourcesDirectory, "auth.json"), "utf8")).not.toContain(canary);
      expect(resolved.secrets[0].value.every((byte: number) => byte === 0)).toBe(true);
      expect(JSON.stringify(spawnCall)).not.toContain(canary);
      expect(Object.values(environment).join(" ")).not.toContain(canary);

      (child.stdout as EventEmitter).emit("data", Buffer.from(`${canary}\narbitrary stdout\n`));
      (child.stderr as EventEmitter).emit("data", Buffer.from(`${canary}\narbitrary stderr\n`));
      proc.members.clear();
      closeChild(child, 0, null);

      const durable = JSON.stringify({ jobs: core.jobs, deliveries: core.jobEventDeliveries, logs: core.jobs.appendRunLog.mock.calls });
      expect(durable).not.toContain(canary);
      expect(core.jobs.appendRunLog.mock.calls.filter((call: unknown[]) => call.includes("Vault job output redacted."))).toHaveLength(1);
      expect(existsSync(join(root, runId))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed before spawn for an unsafe root and leaves no plaintext Buffer", async () => {
    const root = mkdtempSync(join("/tmp", "ingenium-job-secrets-"));
    chmodSync(root, 0o755);
    const resolved = vaultResolution("root-failure-canary");
    restoreRuntime = configureJobRunnerRuntimeForTesting({ vaultSecretRoot: root });
    core.vault.resolveJobVaultSecrets.mockReturnValue(resolved);
    try {
      await executeJobRun("44444444-4444-4444-8444-444444444444", job, job.prompt_template);
      expect(vi.mocked(spawn)).not.toHaveBeenCalled();
      expect(core.jobs.finishJobRun).toHaveBeenCalledWith("project-id", "44444444-4444-4444-8444-444444444444", "failed", -1);
      expect(resolved.secrets[0].value.every((byte: number) => byte === 0)).toBe(true);
      expect(core.jobs.appendRunLog).toHaveBeenCalledWith("project-id", "44444444-4444-4444-8444-444444444444", "stderr", "Vault job output redacted.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed before spawn when the isolated provider config or auth source is unavailable", async () => {
    const root = vaultRoot();
    const resolved = vaultResolution("missing-auth-canary");
    restoreRuntime = configureJobRunnerRuntimeForTesting({
      vaultSecretRoot: root,
      openCodeAuthPath: join(runtimeSourcesDirectory, "missing-auth.json"),
    });
    core.vault.resolveJobVaultSecrets.mockReturnValue(resolved);
    try {
      await executeJobRun("45444444-4444-4444-8444-444444444444", job, job.prompt_template);
      expect(vi.mocked(spawn)).not.toHaveBeenCalled();
      expect(resolved.secrets[0].value.every((byte: number) => byte === 0)).toBe(true);
      expect(core.jobs.appendRunLog).toHaveBeenCalledWith(
        "project-id", "45444444-4444-4444-8444-444444444444", "stderr", "Vault job output redacted.",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists the snapshot but never spawns after expiry wins before file creation", async () => {
    const root = vaultRoot();
    const runId = "46444444-4444-4444-8444-444444444444";
    const resolved = vaultResolution("expired-before-spawn-canary", Date.now());
    restoreRuntime = configureJobRunnerRuntimeForTesting({ vaultSecretRoot: root });
    core.vault.resolveJobVaultSecrets.mockReturnValue(resolved);
    try {
      await executeJobRun(runId, job, job.prompt_template);
      expect(vi.mocked(spawn)).not.toHaveBeenCalled();
      expect(core.jobs.prepareVaultJobRun).toHaveBeenCalledWith("project-id", expect.objectContaining({ runId, jobId: "job-id" }));
      expect(core.jobs.markVaultJobRunFailed).toHaveBeenCalledWith("project-id", runId);
      expect(core.jobs.markVaultJobRunCleaned).toHaveBeenCalledWith("project-id", runId);
      expect(existsSync(join(root, runId))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cleans vault files after spawn failure, deadline timeout, and explicit cancellation", async () => {
    const root = vaultRoot();
    const proc = processHarness([identity(101, "leader-start")]);
    restoreRuntime = configureJobRunnerRuntimeForTesting({
      processInspector: proc.inspector,
      createRunNonce: () => "run-nonce",
      vaultSecretRoot: root,
      signalProcessGroup: (_groupId, signal) => {
        if (signal === "SIGKILL") proc.members.clear();
      },
    });
    try {
      const failedRunId = "55555555-5555-4555-8555-555555555555";
      const failedChild = fakeChild();
      failedChild.pid = undefined;
      childHarness.next = failedChild;
      core.vault.resolveJobVaultSecrets.mockReturnValueOnce(vaultResolution("spawn-failure-canary"));
      await executeJobRun(failedRunId, job, job.prompt_template);
      failedChild.emit("error", new Error("spawn failed"));
      expect(existsSync(join(root, failedRunId))).toBe(false);

      const timeoutRunId = "66666666-6666-4666-8666-666666666666";
      const timeoutChild = fakeChild();
      childHarness.next = timeoutChild;
      core.vault.resolveJobVaultSecrets.mockReturnValueOnce(vaultResolution("deadline-canary", Date.now() + 10));
      await executeJobRun(timeoutRunId, job, job.prompt_template);
      await vi.advanceTimersByTimeAsync(10 + JOB_TERMINATION_GRACE_MS);
      expect(existsSync(join(root, timeoutRunId))).toBe(false);
      closeChild(timeoutChild);

      proc.members.set(101, identity(101, "leader-start"));
      const cancelledRunId = "77777777-7777-4777-8777-777777777777";
      const cancelledChild = fakeChild();
      childHarness.next = cancelledChild;
      core.vault.resolveJobVaultSecrets.mockReturnValueOnce(vaultResolution("cancel-canary"));
      await executeJobRun(cancelledRunId, job, job.prompt_template);
      expect(killRunProcess("project-id", cancelledRunId)).toBe(true);
      await vi.advanceTimersByTimeAsync(JOB_TERMINATION_GRACE_MS);
      expect(existsSync(join(root, cancelledRunId))).toBe(false);
      closeChild(cancelledChild);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains pre-existing, unknown, and symlink-tampered vault directories instead of following or deleting them", async () => {
    const root = vaultRoot();
    const knownRunId = "88888888-8888-4888-8888-888888888888";
    const unknownDir = join(root, "not-a-run");
    const tamperedDir = join(root, knownRunId);
    try {
      mkdirSync(unknownDir, { mode: 0o700 });
      mkdirSync(tamperedDir, { mode: 0o700 });
      chmodSync(tamperedDir, 0o700);
      symlinkSync("/tmp", join(tamperedDir, vaultItemId));
      restoreRuntime = configureJobRunnerRuntimeForTesting({ vaultSecretRoot: root });
      core.jobs.getVaultSecretRunRecovery.mockReturnValue({
        runId: knownRunId,
        projectId: "project-id",
        status: "failed",
        itemIds: [vaultItemId],
        processIdentity: null,
      });

      recoverVaultSecretRunDirectories();

      expect(existsSync(unknownDir)).toBe(true);
      expect(existsSync(join(tamperedDir, vaultItemId))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cleans each safe pre-spawn materialization prefix after restart without retaining its canary", async () => {
    const root = vaultRoot();
    const steps = ["directory", "secret", "xdg", "config", "auth"] as const;
    restoreRuntime = configureJobRunnerRuntimeForTesting({
      vaultSecretRoot: root,
      findProcessesByNonceHash: () => [],
    });
    try {
      for (const [index, step] of steps.entries()) {
        const runId = `8d000000-0000-4000-8000-00000000000${index}`;
        partialRecoveredVaultRunDirectory(root, runId, step);
        core.jobs.listVaultSecretRunsForRecovery.mockReturnValue([vaultRecovery(runId)]);

        await recoverVaultSecretRunDirectories();

        expect(existsSync(join(root, runId)), step).toBe(false);
        expect(core.jobs.markVaultJobRunCleaned).toHaveBeenCalledWith("project-id", runId);
        expect(JSON.stringify(core.jobs.appendRunLog.mock.calls), step).not.toContain("crash-window-canary");
        core.jobs.markVaultJobRunCleaned.mockClear();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains unsafe prepared crash windows with unknown files, symlinks, or wrong modes", async () => {
    const root = vaultRoot();
    const variants = ["unknown", "symlink", "mode"] as const;
    restoreRuntime = configureJobRunnerRuntimeForTesting({
      vaultSecretRoot: root,
      findProcessesByNonceHash: () => [],
    });
    try {
      for (const [index, variant] of variants.entries()) {
        const runId = `8e000000-0000-4000-8000-00000000000${index}`;
        const runDir = partialRecoveredVaultRunDirectory(root, runId, "secret");
        const secretPath = join(runDir, vaultItemId);
        if (variant === "unknown") writeRecoveredVaultFile(join(runDir, "unexpected"), "unexpected");
        if (variant === "symlink") {
          rmSync(secretPath);
          symlinkSync("/tmp", secretPath);
        }
        if (variant === "mode") chmodSync(secretPath, 0o644);
        core.jobs.listVaultSecretRunsForRecovery.mockReturnValue([vaultRecovery(runId)]);

        await recoverVaultSecretRunDirectories();

        expect(existsSync(runDir), variant).toBe(true);
        expect(core.jobs.markVaultJobRunTeardownPending).toHaveBeenCalledWith("project-id", runId);
        core.jobs.markVaultJobRunTeardownPending.mockClear();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fences prepared cleanup when a nonce-matched process appears after the first scan", async () => {
    const root = vaultRoot();
    const runId = "8f000000-0000-4000-8000-000000000001";
    let scans = 0;
    partialRecoveredVaultRunDirectory(root, runId, "secret");
    core.jobs.listVaultSecretRunsForRecovery.mockReturnValue([vaultRecovery(runId)]);
    restoreRuntime = configureJobRunnerRuntimeForTesting({
      vaultSecretRoot: root,
      findProcessesByNonceHash: () => (scans++ === 0 ? [] : [identity(101, "late-process")]),
    });
    try {
      await recoverVaultSecretRunDirectories();

      expect(scans).toBe(2);
      expect(existsSync(join(root, runId))).toBe(true);
      expect(core.jobs.markVaultJobRunTeardownPending).toHaveBeenCalledWith("project-id", runId);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not clean present spawned or teardown directories from a nonce-only absence", async () => {
    const root = vaultRoot();
    const processIdentity = {
      processId: 99999999,
      processGroupId: 99999999,
      processStartTime: "persisted-start",
      processExecutable: "/usr/bin/opencode",
    };
    restoreRuntime = configureJobRunnerRuntimeForTesting({
      vaultSecretRoot: root,
      findProcessesByNonceHash: () => [],
    });
    try {
      for (const [index, state] of (["spawned", "teardown_pending"] as const).entries()) {
        const runId = `81000000-0000-4000-8000-00000000000${index}`;
        partialRecoveredVaultRunDirectory(root, runId, "directory");
        core.jobs.listVaultSecretRunsForRecovery.mockReturnValue([vaultRecovery(runId, state, processIdentity)]);

        await recoverVaultSecretRunDirectories();

        expect(existsSync(join(root, runId)), state).toBe(true);
        expect(core.jobs.markVaultJobRunCleaned, state).not.toHaveBeenCalled();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks an absent prepared directory cleaned only after its nonce scan is absent", async () => {
    const root = vaultRoot();
    const runId = "82000000-0000-4000-8000-000000000000";
    core.jobs.listVaultSecretRunsForRecovery.mockReturnValue([vaultRecovery(runId)]);
    restoreRuntime = configureJobRunnerRuntimeForTesting({
      vaultSecretRoot: root,
      findProcessesByNonceHash: () => [],
    });
    try {
      await recoverVaultSecretRunDirectories();
      expect(core.jobs.markVaultJobRunCleaned).toHaveBeenCalledWith("project-id", runId);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reproduces the crash-gap canary: leader and descendant recover despite unrelated procfs entries, then clean after group absence", async () => {
    const root = vaultRoot();
    const runId = "89888888-8888-4888-8888-888888888888";
    const nonceHash = createHash("sha256").update("run-nonce", "utf8").digest("hex");
    const recovery = {
      runId,
      projectId: "project-id",
      jobId: "job-id",
      state: "prepared" as const,
      deadlineAt: Date.now() + 60_000,
      revision: 0,
      processNonceHash: nonceHash,
      itemSnapshots: [{ itemId: vaultItemId, authorizedItemVersion: 1 }],
      processIdentity: null,
    };
    const runnerOwnerId = process.getuid?.() ?? 1000;
    const procEntries = [
      { processId: 20, ownerId: runnerOwnerId + 1, stat: "malformed" },
      { processId: 21, ownerId: runnerOwnerId, stat: procStat(21, 0, 0) },
      { processId: 22, ownerId: runnerOwnerId, stat: procStat(22, 999, 999) },
      { processId: 101, ownerId: runnerOwnerId, stat: procStat(101, 101, 101, "leader-start") },
      { processId: 102, ownerId: runnerOwnerId, stat: procStat(102, 101, 101, "descendant-start") },
    ];
    const procfs = procfsFixture(procEntries);
    const processInspector: JobProcessInspector = {
      inspectProcess: (processId) => processId === 101 ? identity(101, "leader-start") : null,
      inspectGroup: (processGroupId) => inspectLinuxProcessGroupForTesting(processGroupId, runnerOwnerId, procfs.access),
    };
    const signalProcessGroup = vi.fn(() => {
      for (let index = procEntries.length - 1; index >= 0; index -= 1) {
        if (procEntries[index].processId === 101 || procEntries[index].processId === 102) procEntries.splice(index, 1);
      }
    });
    recoveredVaultRunDirectory(root, runId);
    core.jobs.listVaultSecretRunsForRecovery.mockReturnValue([recovery]);
    core.jobs.recordVaultJobRunProcessIdentity.mockReturnValue({
      ...recovery,
      state: "spawned",
      revision: 1,
      processIdentity: { processId: 101, processGroupId: 101, processStartTime: "leader-start", processExecutable: "/usr/bin/opencode" },
    });
    restoreRuntime = configureJobRunnerRuntimeForTesting({
      vaultSecretRoot: root,
      processInspector,
      // The nonce scan returns the owned leader plus its descendant. The
      // synthetic procfs view also contains unrelated root/kernel entries.
      findProcessesByNonceHash: () => [identity(101, "leader-start"), identity(102, "descendant-start")],
      signalProcessGroup,
    });
    try {
      await recoverVaultSecretRunDirectories();
      expect(core.jobs.recordVaultJobRunProcessIdentity).toHaveBeenCalledWith("project-id", runId, expect.objectContaining({ processId: 101 }));
      expect(signalProcessGroup).toHaveBeenCalledWith(101, "SIGTERM");
      expect(core.jobs.markVaultJobRunCleaned).toHaveBeenCalledWith("project-id", runId);
      expect(existsSync(join(root, runId))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains multiple nonce-matched groups without signalling or deleting a vault directory", async () => {
    const root = vaultRoot();
    const runId = "89999999-9999-4999-8999-999999999999";
    const recovery = {
      runId,
      projectId: "project-id",
      jobId: "job-id",
      state: "prepared" as const,
      deadlineAt: Date.now() + 60_000,
      revision: 0,
      processNonceHash: createHash("sha256").update("run-nonce", "utf8").digest("hex"),
      itemSnapshots: [{ itemId: vaultItemId, authorizedItemVersion: 1 }],
      processIdentity: null,
    };
    const signalProcessGroup = vi.fn();
    recoveredVaultRunDirectory(root, runId);
    core.jobs.listVaultSecretRunsForRecovery.mockReturnValue([recovery]);
    restoreRuntime = configureJobRunnerRuntimeForTesting({
      vaultSecretRoot: root,
      findProcessesByNonceHash: () => [
        identity(101, "first"),
        identity(202, "second", "run-nonce", "/usr/bin/opencode", 202, 202),
      ],
      signalProcessGroup,
    });
    try {
      await recoverVaultSecretRunDirectories();
      expect(signalProcessGroup).not.toHaveBeenCalled();
      expect(core.jobs.markVaultJobRunTeardownPending).toHaveBeenCalledWith("project-id", runId);
      expect(existsSync(join(root, runId))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains nonce recovery candidates with no leader or mismatched session, UID, or persisted executable", async () => {
    const root = vaultRoot();
    const runnerOwnerId = process.getuid?.() ?? 1000;
    const nonceHash = createHash("sha256").update("run-nonce", "utf8").digest("hex");
    let candidates: JobProcessIdentity[] = [];
    const signalProcessGroup = vi.fn();
    restoreRuntime = configureJobRunnerRuntimeForTesting({
      vaultSecretRoot: root,
      findProcessesByNonceHash: () => candidates,
      signalProcessGroup,
    });
    const cases: Array<{ name: string; candidates: JobProcessIdentity[]; processIdentity?: object }> = [
      {
        name: "no leader",
        candidates: [identity(102, "descendant", "run-nonce", "/usr/bin/opencode", 101, 101)],
      },
      {
        name: "session mismatch",
        candidates: [
          identity(101, "leader"),
          identity(102, "descendant", "run-nonce", "/usr/bin/opencode", 101, 202),
        ],
      },
      {
        name: "UID mismatch",
        candidates: [
          identity(101, "leader"),
          identity(102, "descendant", "run-nonce", "/usr/bin/opencode", 101, 101, runnerOwnerId + 1),
        ],
      },
      {
        name: "persisted executable mismatch",
        candidates: [identity(101, "leader", "run-nonce", "/usr/bin/unrelated")],
        processIdentity: {
          processId: 101,
          processGroupId: 101,
          processStartTime: "leader",
          processExecutable: "/usr/bin/opencode",
        },
      },
    ];
    try {
      for (const [index, candidateCase] of cases.entries()) {
        const runId = `8${index}000000-0000-4000-8000-000000000000`;
        const recovery = {
          runId,
          projectId: "project-id",
          jobId: "job-id",
          state: "prepared" as const,
          deadlineAt: Date.now() + 60_000,
          revision: 0,
          processNonceHash: nonceHash,
          itemSnapshots: [{ itemId: vaultItemId, authorizedItemVersion: 1 }],
          processIdentity: candidateCase.processIdentity ?? null,
        };
        candidates = candidateCase.candidates;
        recoveredVaultRunDirectory(root, runId);
        core.jobs.listVaultSecretRunsForRecovery.mockReturnValue([recovery]);

        await recoverVaultSecretRunDirectories();

        expect(signalProcessGroup, candidateCase.name).not.toHaveBeenCalled();
        expect(core.jobs.markVaultJobRunTeardownPending).toHaveBeenCalledWith("project-id", runId);
        expect(existsSync(join(root, runId)), candidateCase.name).toBe(true);
        signalProcessGroup.mockClear();
        core.jobs.markVaultJobRunTeardownPending.mockClear();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains vault files after a failed group signal and removes them only during a later verified recovery", async () => {
    const root = vaultRoot();
    const runId = "8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const child = fakeChild();
    const proc = processHarness([
      identity(101, "leader-start"),
      identity(102, "descendant-start"),
    ]);
    let rejectSignals = true;
    restoreRuntime = configureJobRunnerRuntimeForTesting({
      vaultSecretRoot: root,
      processInspector: proc.inspector,
      createRunNonce: () => "run-nonce",
      findProcessesByNonceHash: () => [identity(101, "leader-start"), identity(102, "descendant-start")],
      signalProcessGroup: () => {
        if (rejectSignals) throw new Error("signal unavailable");
        proc.members.clear();
      },
    });
    core.vault.resolveJobVaultSecrets.mockReturnValue(vaultResolution("retain-then-recover-canary"));
    childHarness.next = child;
    try {
      await executeJobRun(runId, job, job.prompt_template);
      expect(killRunProcess("project-id", runId)).toBe(true);
      closeChild(child);
      await vi.advanceTimersByTimeAsync(JOB_TERMINATION_GRACE_MS + (5 * 1_000));
      expect(existsSync(join(root, runId))).toBe(true);
      expect(core.jobs.markVaultJobRunTeardownPending).toHaveBeenCalledWith("project-id", runId);

      rejectSignals = false;
      const recovery = {
        runId,
        projectId: "project-id",
        jobId: "job-id",
        state: "teardown_pending" as const,
        deadlineAt: Date.now() + 60_000,
        revision: 2,
        processNonceHash: createHash("sha256").update("run-nonce", "utf8").digest("hex"),
        itemSnapshots: [{ itemId: vaultItemId, authorizedItemVersion: 1 }],
        processIdentity: { processId: 101, processGroupId: 101, processStartTime: "leader-start", processExecutable: "/usr/bin/opencode" },
      };
      core.jobs.listVaultSecretRunsForRecovery.mockReturnValue([recovery]);
      await recoverVaultSecretRunDirectories();
      expect(existsSync(join(root, runId))).toBe(false);
      expect(core.jobs.markVaultJobRunCleaned).toHaveBeenCalledWith("project-id", runId);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
      runNonceHash: createHash("sha256").update("run-nonce", "utf8").digest("hex"),
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

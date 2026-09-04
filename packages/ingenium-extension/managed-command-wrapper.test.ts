import { createHash } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import {
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  decodeManagedArgv,
  decodeManagedBuildArgv,
  decodeManagedRepositoryArgv,
  isManagedDeploymentArgv,
  managedBuildEnvironment,
  managedBuildExecution,
  managedCommand,
  managedRecoveryBootstrapPath,
  MANAGED_RECOVERY_BOOTSTRAP_TIMEOUT_MS,
  managedGitEnvironment,
  managedReplacementFirstRestart,
  managedRecoveryEnvironment,
  managedRepositoryArgv,
  runManagedCommandCli,
  terminateTimedOutManagedProcess,
  validateManagedBuildArgv,
  validateManagedRepositoryArgv,
  type ManagedProcessGroupIdentity,
} from "./scripts/managed-command-wrapper.js";
import type {
  RedactedRestartHandoff,
  ReplacementFirstRestartDependencies,
  ReplacementFirstRestartEvidence,
  ReplacementFirstRestartRequest,
  RestartProcessIdentity,
} from "./replacement-first-restart.js";
import { CoordinationOutbox } from "./coordination-outbox.js";
import {
  commitManagedRecoveryReplacement,
  parseLegacyRecoveryOwnerPayload,
  prepareManagedRecoveryReplacement,
  readManagedRecoveryEnrollment,
  readRecoveryServerAuthentication,
  recordManagedRecoveryAttachEvent,
  recoveryServerAuthenticationPath,
  stopTimedOutLegacyRecoveryOwner,
} from "./tui-recovery.js";
import {
  appendProductionRestartEvidence,
  hardenLegacyProductionCredentialPermissions,
  openCodeJsonRequest,
  parseListeningLoopbackPorts,
  probeReplacementHealthGate,
  productionRestartCanonicalWorktree,
  restartHandoffEvidence,
  restartHandoffMemoryEntry,
  runProductionRestartCli,
  runProductionRestartAdapter,
  typedMemoryAcknowledgementEvidence,
  type ProductionRestartAdapterDependencies,
  type ProductionRestartBinding,
  type ProductionRestartParentCandidate,
} from "./scripts/production-restart.js";
import {
  RECOVERY_BOOTSTRAP_CHECK_TIMEOUT_MS,
  RECOVERY_BOOTSTRAP_CHECKS,
  RECOVERY_BOOTSTRAP_MAX_RUNTIME_MS,
  RECOVERY_BOOTSTRAP_RESTART_TIMEOUT_MS,
  RecoveryBootstrapTimeoutError,
  recoveryBootstrapCheckEnvironment,
  recoveryBootstrapCanonicalWorktree,
  recoveryBootstrapRestartEnvironment,
  runRecoveryBootstrap,
  verifyRecoveryBootstrapInvocation,
} from "./scripts/recovery-bootstrap.js";

const hash = (value: string) => Buffer.from(value.repeat(64).slice(0, 64)).toString("hex").slice(0, 64);
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const recoverySource = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "tui-recovery.ts")).href;
const tsxLoader = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "../../node_modules/tsx/dist/loader.mjs")).href;
const repositoryRoot = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "../.."));
const recoveryBootstrapSource = join(dirname(fileURLToPath(import.meta.url)), "scripts", "recovery-bootstrap.ts");
const recoveryBootstrapShim = join(dirname(fileURLToPath(import.meta.url)), "scripts", "recovery-bootstrap.js");
const productionRestartSource = join(dirname(fileURLToPath(import.meta.url)), "scripts", "production-restart.ts");

function trustedFailureReason(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { reason?: string }).reason;
  }
  throw new Error("Expected trusted-file validation to fail");
}

function recoveryBootstrapEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    INGENIUM_WORKTREE: repositoryRoot,
    INGENIUM_RECOVERY_CANONICAL_WORKTREE: repositoryRoot,
    INGENIUM_RECOVERY_GENERATED_BOOTSTRAP_SHA256: sha256(readFileSync(recoveryBootstrapSource)),
    ...overrides,
  };
}

function recoveryProcessIdentity(pid: number, nonceSha256: string): RestartProcessIdentity {
  const source = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = source.slice(source.lastIndexOf(")") + 1).trim().split(/\s+/);
  const executable = realpathSync(readlinkSync(`/proc/${pid}/exe`));
  return {
    pid,
    startTimeTicks: Number(fields[19]),
    executableSha256: sha256(readFileSync(executable)),
    nonceSha256,
  };
}

function recoveryIdentitySha256(identity: RestartProcessIdentity): string {
  return sha256(JSON.stringify({
    pid: identity.pid,
    startTimeTicks: identity.startTimeTicks,
    executableSha256: identity.executableSha256,
    nonceSha256: identity.nonceSha256,
  }));
}

function writePrivateJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function recoveryPaths(worktree: string): { state: string; journal: string; events: string } {
  const directory = join(dirname(new CoordinationOutbox(worktree).directory), "tui-recovery");
  mkdirSync(directory, { mode: 0o700 });
  return {
    state: join(directory, "state.json"),
    journal: join(directory, "journal.json"),
    events: join(directory, "events.jsonl"),
  };
}

function recoveryHandoff(): RedactedRestartHandoff {
  return {
    status: "working",
    taskHash: sha256("recovery-task"),
    actions: [{ kind: "edit", result: "succeeded", path: "src/recovery.ts", targetHash: null }],
    changedPaths: [{ path: "src/recovery.ts", operation: "edit", additions: 2, deletions: 1, changeRevision: 1 }],
    checks: [{
      name: "test", status: "completed", result: "passed", exitCode: 0, targetHash: sha256("recovery-check"),
    }],
    todos: { total: 3, pending: 1, inProgress: 1, completed: 1, cancelled: 0, state: "mixed" },
    nextWork: { kind: "continue_task", referenceHash: sha256("recovery-next-work") },
  };
}

function startRecoveryProcess(worktree: string, nonce?: string): ChildProcess {
  return spawn(process.execPath, ["--input-type=module", "--eval", "setTimeout(() => process.exit(0), 10000)"], {
    cwd: worktree,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      ...(nonce ? { INGENIUM_RESTART_NONCE: nonce } : {}),
    },
    stdio: "ignore",
  });
}

function recoveryPayload(worktree: string, parent: RestartProcessIdentity & { port: number; dataHome: string }): Record<string, unknown> {
  return {
    schemaVersion: 1,
    worktree,
    binding: {
      project: "tui-recovery-test",
      projectId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "recovery-workspace",
      launcherWorktree: worktree,
      storageMappingHash: sha256("recovery-storage"),
    },
    parent,
    handoff: recoveryHandoff(),
  };
}

function startRecoveryOwner(worktree: string, nonce: string, payload: unknown, resultPath: string): ChildProcess {
  const script = `
    import { writeFileSync } from "node:fs";
    import { runDetachedRecoveryOwner } from ${JSON.stringify(recoverySource)};
    try {
      await runDetachedRecoveryOwner(${JSON.stringify(Buffer.from(JSON.stringify(payload)).toString("base64url"))});
      writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ completed: true }) + "\\n", { mode: 0o600 });
    } catch (error) {
      writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + "\\n", { mode: 0o600 });
    }
  `;
  return spawn(process.execPath, ["--import", tsxLoader, "--input-type=module", "--eval", script], {
    cwd: worktree,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", INGENIUM_RECOVERY_OWNER_NONCE: nonce },
    stdio: "ignore",
  });
}

async function waitForRecoveryState(path: string, predicate: (value: Record<string, any>) => boolean): Promise<Record<string, any>> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (existsSync(path)) {
      const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
      if (predicate(value)) return value;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error("Recovery state did not reach the expected phase");
}

async function stopRecoveryProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise())),
    new Promise<void>((resolvePromise) => setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      resolvePromise();
    }, 1_000)),
  ]);
}

function replacementRequest(worktree: string): ReplacementFirstRestartRequest {
  const oldDataHome = join(worktree, "old-data");
  mkdirSync(oldDataHome);
  return {
    schemaVersion: 1,
    worktree,
    binding: {
      projectId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "workspace-production",
      launcherWorktree: worktree,
      storageMappingHash: hash("a"),
      audience: "mcp",
    },
    oldProcess: {
      pid: 1001,
      startTimeTicks: 2001,
      executableSha256: hash("b"),
      nonceSha256: hash("c"),
    },
    oldPort: 4100,
    oldDataHome,
    replacement: {
      port: 5100,
      dataHome: join(worktree, "replacement-data"),
      expectedIdentity: { executableSha256: hash("b"), nonceSha256: hash("d") },
    },
    handoff: {
      status: "working",
      taskHash: hash("e"),
      actions: [{ kind: "edit", result: "succeeded", path: "src/restart.ts", targetHash: null }],
      changedPaths: [{ path: "src/restart.ts", operation: "edit", additions: 1, deletions: 0, changeRevision: 1 }],
      checks: [{ name: "typecheck", status: "completed", result: "passed", exitCode: 0, targetHash: hash("g") }],
      todos: { total: 2, pending: 1, inProgress: 1, completed: 0, cancelled: 0, state: "mixed" },
      nextWork: { kind: "continue_task", referenceHash: hash("f") },
    },
    timeouts: {
      handoffMs: 1_000,
      launchMs: 1_000,
      identityMs: 1_000,
      healthMs: 1_000,
      sessionMs: 1_000,
      memoryAckMs: 1_000,
      terminalIdleMs: 1_000,
      retirementMs: 1_000,
    },
  };
}

function encodedRestart(request: ReplacementFirstRestartRequest | Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(request)).toString("base64url");
}

describe("managed command wrappers", () => {
  it("autonomous-recovery rejects payload extras and incoherent enrollment metadata", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-autonomous-recovery-coherence-"));
    const nonce = "p".repeat(43);
    const parent = startRecoveryProcess(worktree, nonce);
    try {
      if (parent.pid === undefined) throw new Error("Recovery parent did not start");
      const dataHome = join(worktree, "data-home");
      mkdirSync(dataHome, { mode: 0o700 });
      const parentIdentity = { ...recoveryProcessIdentity(parent.pid, sha256(nonce)), port: 42001, dataHome };
      const payload = recoveryPayload(worktree, parentIdentity);
      const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      expect(parseLegacyRecoveryOwnerPayload(encoded(payload))).toEqual(payload);
      for (const invalid of [
        { ...payload, sessionId: "raw-session" },
        { ...payload, token: "raw-token" },
        { ...payload, command: ["opencode"] },
        { ...payload, changedPaths: ["secret/path"] },
        { ...payload, handoff: { ...(payload.handoff as object), todoItems: [{ content: "raw todo" }] } },
        { ...payload, handoff: { ...(payload.handoff as object), nextWork: { kind: "continue_task", referenceHash: sha256("next"), command: "run" } } },
        { ...payload, handoff: { ...(payload.handoff as object), changedPaths: [{ path: "../outside", operation: "edit", additions: 1, deletions: 0, changeRevision: 1 }] } },
        { ...payload, handoff: { ...(payload.handoff as object), changedPaths: [{ path: ".opencode/protected-runtime-index/state", operation: "edit", additions: 1, deletions: 0, changeRevision: 1 }] } },
        { ...payload, handoff: { ...(payload.handoff as object), actions: [{ kind: "execute", result: "succeeded", path: null, targetHash: "raw command" }] } },
        { ...payload, handoff: { ...(payload.handoff as object), checks: [{ name: "test", status: "completed", result: "failed", exitCode: 1, targetHash: sha256("invalid-check") }] } },
        { ...payload, handoff: { ...(payload.handoff as object), actions: [] } },
        { ...payload, handoff: { ...(payload.handoff as object), changedPaths: [] } },
        { ...payload, handoff: { ...(payload.handoff as object), checks: [] } },
      ]) expect(() => parseLegacyRecoveryOwnerPayload(encoded(invalid))).toThrow();

      const paths = recoveryPaths(worktree);
      const ownerNonce = "o".repeat(43);
      const activeParent = {
        ...parentIdentity,
        worktree,
        project: "tui-recovery-test",
        projectId: "00000000-0000-4000-8000-000000000001",
        workspaceId: "recovery-workspace",
        storageMappingHash: sha256("recovery-storage"),
      };
      const state = {
        schemaVersion: 1,
        owner: recoveryProcessIdentity(process.pid, sha256(ownerNonce)),
        fence: 2,
        generation: 2,
        phase: "enrolled",
        activeParent,
        replacement: null,
        updatedAt: new Date().toISOString(),
      };
      const handoff = recoveryHandoff();
      const journal = {
        schemaVersion: 1,
        ...handoff,
        fence: 2,
        generation: 2,
        phase: "enrolled",
        transactionSha256: null,
        replacementIdentitySha256: null,
        boundIdentitySha256: recoveryIdentitySha256(activeParent),
        updatedAt: new Date().toISOString(),
      };
      writePrivateJson(paths.state, state);
      writePrivateJson(paths.journal, journal);
      expect(readManagedRecoveryEnrollment(worktree)?.handoff).toEqual(handoff);
      for (const mutation of [
        { fence: 3 },
        { phase: "replacement_prepared" },
        { generation: 3 },
        { transactionSha256: sha256("stale-transaction") },
        { replacementIdentitySha256: sha256("stale-replacement") },
        { boundIdentitySha256: sha256("stale-parent") },
      ]) {
        writePrivateJson(paths.journal, { ...journal, ...mutation });
        expect(readManagedRecoveryEnrollment(worktree)).toBeUndefined();
      }
    } finally {
      await stopRecoveryProcess(parent);
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("autonomous-recovery exits promptly when its exact enrolled legacy parent dies", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-autonomous-recovery-parent-exit-"));
    const legacy = startRecoveryProcess(worktree);
    let owner: ChildProcess | undefined;
    try {
      if (legacy.pid === undefined) throw new Error("Legacy parent did not start");
      const dataHome = join(worktree, "data-home");
      mkdirSync(dataHome, { mode: 0o700 });
      const payload = recoveryPayload(worktree, {
        ...recoveryProcessIdentity(legacy.pid, "0".repeat(64)),
        port: 42001,
        dataHome,
      });
      const paths = recoveryPaths(worktree);
      const resultPath = join(worktree, "owner-result.json");
      owner = startRecoveryOwner(worktree, "o".repeat(43), payload, resultPath);
      if (owner.pid === undefined) throw new Error("Recovery owner did not start");
      await waitForRecoveryState(paths.state, (state) => state.phase === "enrolled" && state.owner?.pid === owner!.pid);
      await stopRecoveryProcess(legacy);
      const result = await waitForRecoveryState(resultPath, (value) => value.completed === true);
      expect(result).toEqual({ completed: true });
    } finally {
      if (owner) await stopRecoveryProcess(owner);
      await stopRecoveryProcess(legacy);
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("autonomous-recovery rolls back a dead candidate and adopts its relaunched successor", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-autonomous-recovery-relaunch-"));
    const legacy = startRecoveryProcess(worktree);
    let owner: ChildProcess | undefined;
    let failedReplacement: ChildProcess | undefined;
    let successor: ChildProcess | undefined;
    const priorOwnerNonce = process.env.INGENIUM_RECOVERY_OWNER_NONCE;
    const priorOwnerPid = process.env.INGENIUM_RECOVERY_OWNER_PID;
    const priorOwnerStart = process.env.INGENIUM_RECOVERY_OWNER_START_TICKS;
    try {
      if (legacy.pid === undefined) throw new Error("Legacy parent did not start");
      const dataHome = join(worktree, "data-home");
      mkdirSync(dataHome, { mode: 0o700 });
      const legacyIdentity = recoveryProcessIdentity(legacy.pid, "0".repeat(64));
      const payload = recoveryPayload(worktree, { ...legacyIdentity, port: 42001, dataHome });
      const paths = recoveryPaths(worktree);
      owner = startRecoveryOwner(worktree, "o".repeat(43), payload, join(worktree, "owner-result.json"));
      if (owner.pid === undefined) throw new Error("Recovery owner did not start");
      const enrolled = await waitForRecoveryState(paths.state, (state) => state.phase === "enrolled" && state.owner?.pid === owner!.pid);
      process.env.INGENIUM_RECOVERY_OWNER_NONCE = "o".repeat(43);
      process.env.INGENIUM_RECOVERY_OWNER_PID = String(owner.pid);
      process.env.INGENIUM_RECOVERY_OWNER_START_TICKS = String(enrolled.owner.startTimeTicks);

      owner.kill("SIGSTOP");
      const failedNonce = "f".repeat(43);
      failedReplacement = startRecoveryProcess(worktree, failedNonce);
      if (failedReplacement.pid === undefined) throw new Error("Prepared replacement did not start");
      const firstTransaction = sha256("failed-prepared-replacement");
      const firstPrepare = prepareManagedRecoveryReplacement(
        worktree,
        legacyIdentity,
        recoveryProcessIdentity(failedReplacement.pid, sha256(failedNonce)),
        43001,
        dataHome,
        "successor-session",
        sha256(JSON.stringify(recoveryHandoff())),
        firstTransaction,
        new AbortController().signal,
      );
      await waitForRecoveryState(paths.state, (state) => state.phase === "replacement_prepared");
      await stopRecoveryProcess(failedReplacement);
      owner.kill("SIGCONT");
      await expect(firstPrepare).rejects.toThrow("TUI recovery owner changed");
      await waitForRecoveryState(paths.state, (state) => state.phase === "enrolled" && state.replacement === null);

      const successorNonce = "s".repeat(43);
      successor = startRecoveryProcess(worktree, successorNonce);
      if (successor.pid === undefined) throw new Error("Successor did not start");
      const successorIdentity = recoveryProcessIdentity(successor.pid, sha256(successorNonce));
      const transaction = sha256("relaunch-transaction");
      await prepareManagedRecoveryReplacement(
        worktree,
        legacyIdentity,
        successorIdentity,
        43002,
        dataHome,
        "successor-session",
        sha256(JSON.stringify(recoveryHandoff())),
        transaction,
        new AbortController().signal,
      );
      commitManagedRecoveryReplacement(worktree, transaction);
      const adopted = await waitForRecoveryState(
        paths.state,
        (state) => state.phase === "enrolled" && state.activeParent?.pid === successor!.pid,
      );
      expect(adopted.replacement).toBeNull();
      expect(readFileSync(paths.state, "utf8")).not.toContain("successor-session");
      expect(readFileSync(paths.journal, "utf8")).not.toContain("successor-session");
      expect(() => process.kill(legacy.pid!, 0)).toThrow();
      expect(readManagedRecoveryEnrollment(worktree)?.handoff).toEqual(recoveryHandoff());
      const events = readFileSync(paths.events, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(events.filter((event) => event.event === "fence_transition").map((event) => [event.priorFence, event.fence]))
        .toEqual(expect.arrayContaining([[0, 1], [1, 2], [2, 3]]));
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: "rollback",
          reason: "replacement_identity_unavailable",
          replacementPid: failedReplacement.pid,
          transactionSha256: firstTransaction,
        }),
        expect.objectContaining({
          event: "adoption",
          replacementPid: successor.pid,
          replacementIdentitySha256: recoveryIdentitySha256(successorIdentity),
          transactionSha256: transaction,
        }),
      ]));
      expect(JSON.stringify(events)).not.toContain("successor-session");
    } finally {
      if (priorOwnerNonce === undefined) delete process.env.INGENIUM_RECOVERY_OWNER_NONCE;
      else process.env.INGENIUM_RECOVERY_OWNER_NONCE = priorOwnerNonce;
      if (priorOwnerPid === undefined) delete process.env.INGENIUM_RECOVERY_OWNER_PID;
      else process.env.INGENIUM_RECOVERY_OWNER_PID = priorOwnerPid;
      if (priorOwnerStart === undefined) delete process.env.INGENIUM_RECOVERY_OWNER_START_TICKS;
      else process.env.INGENIUM_RECOVERY_OWNER_START_TICKS = priorOwnerStart;
      if (owner?.pid) owner.kill("SIGCONT");
      if (owner) await stopRecoveryProcess(owner);
      if (failedReplacement) await stopRecoveryProcess(failedReplacement);
      if (successor) await stopRecoveryProcess(successor);
      await stopRecoveryProcess(legacy);
      rmSync(worktree, { recursive: true, force: true });
    }
  }, 15_000);

  it("autonomous-recovery records bounded protected attach-started and attach-healthy events without session or secret data", () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-recovery-attach-events-"));
    try {
      const paths = recoveryPaths(worktree);
      const replacement = {
        pid: process.pid + 1,
        startTimeTicks: 2301,
        executableSha256: sha256("attach-executable"),
        nonceSha256: sha256("attach-nonce"),
      };
      const transactionSha256 = sha256("attach-transaction");
      const activeParent = {
        ...replacement,
        worktree,
        project: "tui-recovery-test",
        projectId: "00000000-0000-4000-8000-000000000001",
        workspaceId: "recovery-workspace",
        storageMappingHash: sha256("recovery-storage"),
        port: 43001,
        dataHome: worktree,
      };
      writePrivateJson(paths.state, {
        schemaVersion: 1,
        owner: recoveryProcessIdentity(process.pid, sha256("owner")),
        fence: 3,
        generation: 4,
        phase: "replacement_committed",
        activeParent,
        replacement: {
          identity: replacement,
          port: 43001,
          dataHome: worktree,
          transactionSha256,
          identitySha256: recoveryIdentitySha256(replacement),
          session: { iv: "a".repeat(16), tag: "b".repeat(22), value: "c" },
          ownerReady: true,
        },
        updatedAt: new Date().toISOString(),
      });
      recordManagedRecoveryAttachEvent(worktree, "attach_started", process.pid, "successor-session", transactionSha256, replacement);
      recordManagedRecoveryAttachEvent(worktree, "attach_healthy", process.pid, "successor-session", transactionSha256, replacement);
      const events = readFileSync(paths.events, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(events.map((event) => event.event)).toEqual(["attach_started", "attach_healthy"]);
      expect(events).toEqual(expect.arrayContaining([expect.objectContaining({
        attachPid: process.pid,
        successorSessionSha256: sha256("successor-session"),
        replacementIdentitySha256: recoveryIdentitySha256(replacement),
        transactionSha256,
        occurredAt: expect.any(String),
      })]));
      expect(JSON.stringify(events)).not.toContain("successor-session");
      expect(() => recordManagedRecoveryAttachEvent(
        worktree, "attach_started", 1, "successor-session", transactionSha256, replacement,
      )).toThrow("attach event is invalid");
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("discovers listening loopback servers without depending on transient client sockets", () => {
    const table = [
      "sl local_address rem_address st",
      "0: 0100007F:EAD5 00000000:0000 0A",
      "1: 0100007F:EAD5 0100007F:1234 01",
      "2: 00000000:1001 00000000:0000 0A",
      "3: 00000000000000000000000001000000:1002 00000000000000000000000000000000:0000 0A",
    ].join("\n");

    expect(parseListeningLoopbackPorts(table)).toEqual([60117, 4098]);
  });

  it("credential_permission_bootstrap hardens only the configured descriptor and rejects metadata races", () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-production-credential-permissions-"));
    const opencode = join(worktree, ".opencode");
    const credential = join(opencode, ".ingenium-mcp-credential");
    const priorPurpose = process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE;
    const priorCredential = process.env.INGENIUM_MCP_CREDENTIAL_FILE;
    const priorInline = process.env.INGENIUM_MCP_CREDENTIAL;
    try {
      mkdirSync(opencode, { mode: 0o700 });
      process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE = "general";
      process.env.INGENIUM_MCP_CREDENTIAL_FILE = ".opencode/.ingenium-mcp-credential";
      delete process.env.INGENIUM_MCP_CREDENTIAL;
      const sentinel = "legacy-credential-content\n";
      writeFileSync(credential, sentinel, { mode: 0o644 });
      chmodSync(credential, 0o644);
      const before = lstatSync(credential);

      hardenLegacyProductionCredentialPermissions(worktree);

      const hardened = lstatSync(credential);
      expect(hardened.mode & 0o777).toBe(0o600);
      expect({ dev: hardened.dev, ino: hardened.ino, uid: hardened.uid, nlink: hardened.nlink, size: hardened.size, mtimeMs: hardened.mtimeMs })
        .toEqual({ dev: before.dev, ino: before.ino, uid: before.uid, nlink: before.nlink, size: before.size, mtimeMs: before.mtimeMs });
      expect(readFileSync(credential, "utf8")).toBe(sentinel);

      chmodSync(credential, 0o644);
      linkSync(credential, `${credential}.link`);
      expect(() => hardenLegacyProductionCredentialPermissions(worktree)).toThrow("credential permission bootstrap failed");
      expect(lstatSync(credential).mode & 0o777).toBe(0o644);
      rmSync(`${credential}.link`);

      const target = `${credential}.target`;
      renameSync(credential, target);
      symlinkSync(target, credential);
      expect(() => hardenLegacyProductionCredentialPermissions(worktree)).toThrow("credential permission bootstrap failed");
      expect(readFileSync(target, "utf8")).toBe(sentinel);
      rmSync(credential);
      renameSync(target, credential);

      const replacement = `${credential}.replacement`;
      writeFileSync(replacement, "replacement-must-not-be-chmodded\n", { mode: 0o644 });
      chmodSync(credential, 0o644);
      chmodSync(replacement, 0o644);
      let swapped = false;
      expect(() => hardenLegacyProductionCredentialPermissions(worktree, {
        closeSync,
        fchmodSync,
        fstatSync,
        lstatSync,
        openSync(path, flags, mode) {
          if (!swapped && path === credential) {
            swapped = true;
            renameSync(credential, `${credential}.old`);
            renameSync(replacement, credential);
          }
          return openSync(path, flags, mode);
        },
      })).toThrow("credential permission bootstrap failed");
      expect(lstatSync(credential).mode & 0o777).toBe(0o644);
      expect(lstatSync(`${credential}.old`).mode & 0o777).toBe(0o644);
      rmSync(`${credential}.old`);

      const ownerMismatch = lstatSync(credential);
      Object.defineProperty(ownerMismatch, "uid", { value: ownerMismatch.uid + 1 });
      expect(() => hardenLegacyProductionCredentialPermissions(worktree, {
        closeSync,
        fchmodSync,
        fstatSync,
        openSync,
        lstatSync: () => ownerMismatch,
      })).toThrow("credential permission bootstrap failed");
      expect(lstatSync(credential).mode & 0o777).toBe(0o644);
    } finally {
      if (priorPurpose === undefined) delete process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE;
      else process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE = priorPurpose;
      if (priorCredential === undefined) delete process.env.INGENIUM_MCP_CREDENTIAL_FILE;
      else process.env.INGENIUM_MCP_CREDENTIAL_FILE = priorCredential;
      if (priorInline === undefined) delete process.env.INGENIUM_MCP_CREDENTIAL;
      else process.env.INGENIUM_MCP_CREDENTIAL = priorInline;
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("decodes bounded argv without a shell and rejects unsupported commands", () => {
    const encoded = Buffer.from(JSON.stringify(["add", "src/file.ts"])).toString("base64url");
    const message = "chore(checkpoint): preserve runtime and coordination hardening work";
    expect(decodeManagedArgv(encoded)).toEqual(["add", "src/file.ts"]);
    expect(decodeManagedArgv(Buffer.from(JSON.stringify(["commit", message])).toString("base64url")))
      .toEqual(["commit", message]);
    expect(decodeManagedRepositoryArgv(encoded)).toEqual(["add", "src/file.ts"]);
    expect(decodeManagedBuildArgv(Buffer.from(JSON.stringify(["run", "typecheck"])).toString("base64url")))
      .toEqual(["run", "typecheck"]);
    expect(decodeManagedBuildArgv(Buffer.from(JSON.stringify([
      "run", "test", "--workspace=packages/ingenium-extension", "--", "session-coordinator.test.ts", "-t", "identity",
    ])).toString("base64url"))).toEqual([
      "run", "test", "--workspace=packages/ingenium-extension", "--", "session-coordinator.test.ts", "-t", "identity",
    ]);
    expect(() => decodeManagedArgv(Buffer.from(JSON.stringify(["add", "src/file.ts;rm"])).toString("base64url")))
      .toThrow("Invalid managed command payload");
    expect(decodeManagedRepositoryArgv(Buffer.from(JSON.stringify(["status"])).toString("base64url")))
      .toEqual(["status"]);
    expect(() => decodeManagedBuildArgv(Buffer.from(JSON.stringify(["run", "test", "--watch"])).toString("base64url")))
      .toThrow("Build wrapper rejected the command");
    expect(() => managedCommand("repository", ["checkout"])).toThrow("Repository wrapper rejected the command");
    expect(() => managedCommand("build", ["exec", "arbitrary"])).toThrow("Build wrapper rejected the command");
  });

  it("admits only literal path operations and rejects executable Git forms", () => {
    expect(managedRepositoryArgv(["status"])).toEqual([
      "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "status", "--short",
    ]);
    expect(managedRepositoryArgv(["staged-paths"])).toEqual([
      "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
      "diff", "--cached", "--name-only", "--no-ext-diff",
    ]);
    expect(managedRepositoryArgv(["recent-log"])).toEqual([
      "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
      "log", "--format=%h %s", "--max-count=10", "--no-decorate",
    ]);
    expect(managedRepositoryArgv(["head"])).toEqual([
      "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "rev-parse", "HEAD",
    ]);
    expect(managedRepositoryArgv(["diff", "src/file.ts"])).toEqual([
      "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
      "diff", "--no-ext-diff", "--", "src/file.ts",
    ]);
    expect(managedRepositoryArgv(["staged-diff", "src/file.ts"])).toEqual([
      "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
      "diff", "--cached", "--no-ext-diff", "--", "src/file.ts",
    ]);
    expect(managedRepositoryArgv(["add", "src/file.ts"])).toEqual([
      "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "add", "--", "src/file.ts",
    ]);
    expect(managedRepositoryArgv(["mv", "src/old.ts", "src/new.ts"])).toEqual([
      "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "mv", "--", "src/old.ts", "src/new.ts",
    ]);
    expect(managedRepositoryArgv(["commit", "chore(checkpoint): preserve runtime and coordination hardening work"])).toEqual([
      "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
      "-c", "commit.gpgSign=false", "-c", "credential.helper=",
      "-c", "user.name=Ingenium Managed Command", "-c", "user.email=managed-command@ingenium.invalid",
      "commit", "--no-verify", "--no-gpg-sign", "--cleanup=verbatim", "-m",
      "chore(checkpoint): preserve runtime and coordination hardening work",
    ]);
    for (const argv of [
      ["add", "--all"],
      ["status", "extra"],
      ["staged-paths", "extra"],
      ["recent-log", "extra"],
      ["head", "extra"],
      ["diff"],
      ["staged-diff"],
      ["add", "../outside"],
      ["add", ".git/config"],
      ["add", "src/file with spaces.ts"],
      ["add", "src/file.ts;touch-marker"],
      ["add", "src/control\u007f.ts"],
      ["checkout", "main"],
      ["commit"],
      ["commit", ""],
      ["commit", " leading"],
      ["commit", "trailing "],
      ["commit", "line\nbreak"],
      ["commit", "control\u0000character"],
      ["commit", "-option-like"],
      ["commit", "x".repeat(101)],
      ["commit", "-m", "message"],
      ["commit", "message", "extra"],
      ["merge", "--strategy=evil", "main"],
      ["rebase", "--exec=payload", "main"],
      ["reset", "--hard"],
      ["tag", "--local-user=attacker", "v1"],
    ]) {
      expect(() => validateManagedRepositoryArgv(argv)).toThrow("Repository wrapper rejected the command");
      expect(() => managedRepositoryArgv(argv)).toThrow("Repository wrapper rejected the command");
    }

    for (const argv of [
      [],
      ["run"],
      ["run", "test", "--watch"],
      ["run", "pretest"],
      ["exec", "build"],
      ["build", "--workspace=outside"],
      ["run", "test", "--workspace=packages/ingenium-extension", "--", "other.test.ts", "-t", "identity"],
      ["run", "test", "--workspace=packages/ingenium-extension", "--", "session-coordinator.test.ts", "-t", "has spaces"],
      ["run", "typecheck", "--workspace=services/ingenium-api"],
      ["test\nmalicious"],
    ]) expect(() => validateManagedBuildArgv(argv)).toThrow("Build wrapper rejected the command");

    for (const argv of [
      ["build"],
      ["typecheck"],
      ["test"],
      ["lint"],
      ["run", "build"],
      ["run", "typecheck"],
      ["run", "test"],
      ["run", "lint"],
    ]) expect(validateManagedBuildArgv(argv)).toEqual(argv);
  });

  it("maps only fixed deployment operations to shell-free process argv", () => {
    expect(managedBuildExecution(["deployment", "mcp-status"]))
      .toEqual({ command: "/usr/local/bin/opencode", argv: ["mcp", "list"] });
    expect(managedBuildExecution(["deployment", "compose-ps"]))
      .toEqual({ command: "/usr/bin/docker", argv: ["compose", "--profile", "compatibility", "-p", "ingenium", "ps"] });
    expect(managedBuildExecution(["deployment", "compose-build"]))
      .toEqual({ command: "/usr/bin/docker", argv: ["compose", "--profile", "compatibility", "-p", "ingenium", "build"] });
    expect(managedBuildExecution(["deployment", "compose-up"]))
      .toEqual({ command: "/usr/bin/docker", argv: ["compose", "--profile", "compatibility", "-p", "ingenium", "up", "--build", "-d"] });
    expect(managedBuildExecution(["deployment", "compose-restart"]))
      .toEqual({ command: "/usr/bin/docker", argv: ["compose", "--profile", "compatibility", "-p", "ingenium", "restart", "ingenium"] });
    expect(managedBuildExecution(["deployment", "health"]))
      .toEqual({ command: "/usr/bin/curl", argv: ["--fail", "--show-error", "http://127.0.0.1:4097/api/v1/health"] });
    expect(managedBuildExecution(["deployment", "production-restart"]))
      .toEqual({
        command: process.execPath,
        argv: [recoveryBootstrapShim],
      });
    expect(managedBuildExecution(["run", "typecheck"]))
      .toEqual({ command: `${dirname(process.execPath)}/npm`, argv: ["run", "typecheck"] });
    expect(managedBuildExecution(["agent-validation"]))
      .toEqual({ command: "/usr/bin/bash", argv: ["tests/test-agent-validation.sh", "--role-matrix"] });

    for (const argv of [
      ["deployment"],
      ["deployment", "compose-down"],
      ["deployment", "compose-up", "--remove-orphans"],
      ["deployment", "health", "https://attacker.invalid"],
      ["deployment", "production-restart", "payload"],
      ["deployment", "mcp-status;touch-marker"],
    ]) {
      expect(isManagedDeploymentArgv(argv)).toBe(false);
      expect(() => managedBuildExecution(argv)).toThrow("Build wrapper rejected the command");
    }
  });

  it("fixed deployment source and simulated built wrappers resolve the outer shim instead of the generated inner bootstrap", () => {
    const extensionRoot = dirname(fileURLToPath(import.meta.url));
    const sourceWrapper = pathToFileURL(join(extensionRoot, "scripts", "managed-command-wrapper.ts"));
    const builtWrapper = pathToFileURL(join(extensionRoot, "dist", "scripts", "managed-command-wrapper.js"));
    const innerBootstrap = join(extensionRoot, "dist", "scripts", "recovery-bootstrap.js");

    expect(managedRecoveryBootstrapPath(sourceWrapper)).toBe(recoveryBootstrapShim);
    expect(managedRecoveryBootstrapPath(builtWrapper)).toBe(recoveryBootstrapShim);
    expect(managedBuildExecution(["deployment", "production-restart"], sourceWrapper).argv)
      .toEqual([recoveryBootstrapShim]);
    expect(managedBuildExecution(["deployment", "production-restart"], builtWrapper).argv)
      .toEqual([recoveryBootstrapShim]);
    expect(managedRecoveryBootstrapPath(builtWrapper)).not.toBe(innerBootstrap);
  });

  it("runs the fixed recovery checkpoint in order and launches production restart only after every check passes", () => {
    const calls: Array<{ command: string; argv: readonly string[]; options: Record<string, unknown> }> = [];
    const runner = vi.fn((command: string, argv: readonly string[], options: Record<string, unknown>) => {
      calls.push({ command, argv, options });
      return { error: undefined, signal: null, status: 0 };
    });

    const retainEvidence = vi.fn();
    expect(runRecoveryBootstrap(
      ["node", recoveryBootstrapSource],
      runner as any,
      retainEvidence,
      recoveryBootstrapEnvironment(),
      { productionRestart: productionRestartSource },
    )).toBe(0);
    expect(calls.slice(0, -1).map(({ command, argv }) => [command, argv])).toEqual(RECOVERY_BOOTSTRAP_CHECKS);
    expect(calls.at(-1)).toMatchObject({
      command: process.execPath,
      argv: [productionRestartSource],
      options: { shell: false, stdio: "inherit" },
    });
    const productionRestartScriptSha256 = sha256(readFileSync(calls.at(-1)!.argv[0]!));
    expect((calls.at(-1)!.options.env as NodeJS.ProcessEnv).INGENIUM_RECOVERY_BOOTSTRAP_VERIFIED)
      .toBe(productionRestartScriptSha256);
    expect(calls.every(({ options }) => options.cwd === repositoryRoot)).toBe(true);
    expect(calls.slice(0, -1).every(({ options }) => options.timeout === RECOVERY_BOOTSTRAP_CHECK_TIMEOUT_MS)).toBe(true);
    expect(calls.at(-1)!.options.timeout).toBe(RECOVERY_BOOTSTRAP_RESTART_TIMEOUT_MS);
    expect(retainEvidence).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      checks: RECOVERY_BOOTSTRAP_CHECKS.map((_, index) => ({
        index: index + 1, result: "passed", timeoutMs: RECOVERY_BOOTSTRAP_CHECK_TIMEOUT_MS,
      })),
      productionRestart: { result: "passed", timeoutMs: RECOVERY_BOOTSTRAP_RESTART_TIMEOUT_MS },
      productionRestartScriptSha256,
    });
  });

  it("stops the recovery checkpoint on the first failed check without launching or inheriting unsafe environment", () => {
    const calls: Array<{ command: string; argv: readonly string[] }> = [];
    const runner = vi.fn((command: string, argv: readonly string[]) => {
      calls.push({ command, argv });
      return { error: undefined, signal: null, status: calls.length === 2 ? 7 : 0 };
    });
    const hostile = {
      HOME: "/tmp/recovery-home",
      NODE_OPTIONS: "--require=/tmp/attacker.js",
      OPENCODE_SERVER_PASSWORD: "must-not-pass",
      INGENIUM_MCP_CREDENTIAL: "must-not-pass",
      INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-mcp-credential",
      INGENIUM_RECOVERY_OWNER_NONCE: "owner-nonce",
    };

    expect(runRecoveryBootstrap(
      ["node", recoveryBootstrapSource],
      runner as any,
      undefined,
      recoveryBootstrapEnvironment(),
      { productionRestart: productionRestartSource },
    )).toBe(7);
    expect(calls).toEqual(RECOVERY_BOOTSTRAP_CHECKS.slice(0, 2).map(([command, argv]) => ({ command, argv })));
    expect(recoveryBootstrapCheckEnvironment(hostile)).toEqual({
      HOME: "/tmp/recovery-home",
      NPM_CONFIG_GLOBALCONFIG: "/dev/null",
      NPM_CONFIG_SCRIPT_SHELL: "/bin/sh",
      NPM_CONFIG_USERCONFIG: "/dev/null",
      PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    });
    const scriptSha256 = sha256("production-restart");
    expect(recoveryBootstrapRestartEnvironment(scriptSha256, hostile)).toMatchObject({
      HOME: "/tmp/recovery-home",
      INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-mcp-credential",
      INGENIUM_RECOVERY_OWNER_NONCE: "owner-nonce",
      INGENIUM_RECOVERY_BOOTSTRAP_VERIFIED: scriptSha256,
    });
    expect(JSON.stringify(recoveryBootstrapRestartEnvironment(scriptSha256, hostile))).not.toContain("must-not-pass");
    expect(() => runRecoveryBootstrap(["node", recoveryBootstrapSource, "argument"], runner as any))
      .toThrow("Recovery bootstrap accepts no arguments");
  });

  it("reports the first recovery checkpoint timeout and never launches production restart", () => {
    const calls: string[] = [];
    const timeout = Object.assign(new Error("spawnSync timed out"), { code: "ETIMEDOUT" });
    const runner = vi.fn((command: string) => {
      calls.push(command);
      return { error: calls.length === 2 ? timeout : undefined, signal: calls.length === 2 ? "SIGTERM" : null, status: calls.length === 2 ? null : 0 };
    });

    let failure: unknown;
    try {
      runRecoveryBootstrap(
        ["node", recoveryBootstrapSource],
        runner as any,
        undefined,
        recoveryBootstrapEnvironment(),
        { productionRestart: productionRestartSource },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(RecoveryBootstrapTimeoutError);
    expect(failure).toMatchObject({
      name: "RecoveryBootstrapTimeoutError",
      code: "RECOVERY_BOOTSTRAP_TIMEOUT",
      stage: "check",
      checkIndex: 2,
      message: "Recovery bootstrap check 2 timed out",
    });
    expect(calls).toEqual(RECOVERY_BOOTSTRAP_CHECKS.slice(0, 2).map(([command]) => command));
    expect(calls).not.toContain(process.execPath);
  });

  it("recovery checkpoint inner hash guard cannot be bypassed before execution", () => {
    const bytes = readFileSync(recoveryBootstrapSource);
    expect(verifyRecoveryBootstrapInvocation(recoveryBootstrapSource, sha256(bytes))).toBe(sha256(bytes));
    expect(recoveryBootstrapCanonicalWorktree(recoveryBootstrapEnvironment())).toBe(repositoryRoot);
    expect(productionRestartCanonicalWorktree(recoveryBootstrapEnvironment())).toBe(repositoryRoot);

    const runner = vi.fn(() => ({ error: undefined, signal: null, status: 0 }));
    expect(() => runRecoveryBootstrap(
      ["node", recoveryBootstrapSource],
      runner as any,
      undefined,
      recoveryBootstrapEnvironment({ INGENIUM_RECOVERY_GENERATED_BOOTSTRAP_SHA256: sha256("changed") }),
      { productionRestart: productionRestartSource },
    )).toThrow("generated content changed before execution");
    expect(runner).not.toHaveBeenCalled();

    const other = mkdtempSync(join(tmpdir(), "ingenium-canonical-worktree-mismatch-"));
    try {
      expect(() => recoveryBootstrapCanonicalWorktree(recoveryBootstrapEnvironment({ INGENIUM_WORKTREE: other })))
        .toThrow("canonical worktree binding changed");
      expect(() => productionRestartCanonicalWorktree(recoveryBootstrapEnvironment({ INGENIUM_WORKTREE: other })))
        .toThrow("canonical worktree binding changed");
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("source recovery shim accepts mode 0644 and reports the first bounded trust failure reason", async () => {
    const importModule = Function("url", "return import(url)") as (url: string) => Promise<any>;
    const shim = await importModule(`${pathToFileURL(recoveryBootstrapShim).href}?test=${Date.now()}`);
    const directory = mkdtempSync(join(tmpdir(), "ingenium-source-recovery-trust-"));
    try {
      const trusted = join(directory, "trusted.js");
      writeFileSync(trusted, "export {};\n", { mode: 0o644 });
      chmodSync(trusted, 0o644);
      expect(shim.readTrustedRegularFile(trusted, "fixture").sha256).toBe(sha256("export {};\n"));
      expect(shim.TRUSTED_REGULAR_FILE_FAILURE_REASONS).toEqual([
        "regular_file", "symlink", "link_count", "identity", "owner", "writable", "realpath", "executable", "mode",
      ]);

      expect(trustedFailureReason(() => shim.readTrustedRegularFile(directory, "fixture"))).toBe("regular_file");
      symlinkSync(trusted, join(directory, "symlink.js"));
      expect(trustedFailureReason(() => shim.readTrustedRegularFile(join(directory, "symlink.js"), "fixture"))).toBe("symlink");

      linkSync(trusted, join(directory, "hardlink.js"));
      chmodSync(trusted, 0o622);
      expect(trustedFailureReason(() => shim.readTrustedRegularFile(trusted, "fixture", {
        expectedOwner: lstatSync(trusted).uid + 1,
      }))).toBe("link_count");
      rmSync(join(directory, "hardlink.js"));
      expect(trustedFailureReason(() => shim.readTrustedRegularFile(trusted, "fixture", {
        expectedOwner: lstatSync(trusted).uid + 1,
      }))).toBe("owner");
      expect(trustedFailureReason(() => shim.readTrustedRegularFile(trusted, "fixture"))).toBe("writable");
      chmodSync(trusted, 0o644);

      const canonicalDirectory = join(directory, "canonical");
      mkdirSync(canonicalDirectory);
      const canonicalFile = join(canonicalDirectory, "trusted.js");
      writeFileSync(canonicalFile, "export {};\n", { mode: 0o644 });
      symlinkSync(canonicalDirectory, join(directory, "directory-alias"));
      expect(trustedFailureReason(() => shim.readTrustedRegularFile(
        join(directory, "directory-alias", "trusted.js"), "fixture",
      ))).toBe("realpath");

      expect(trustedFailureReason(() => shim.readTrustedRegularFile(trusted, "fixture", { executable: true })))
        .toBe("executable");
      chmodSync(trusted, 0o700);
      expect(trustedFailureReason(() => shim.readTrustedRegularFile(trusted, "fixture", { expectedMode: 0o555 })))
        .toBe("mode");
      chmodSync(trusted, 0o600);

      expect(trustedFailureReason(() => shim.readTrustedRegularFile(trusted, "fixture", { afterOpen: (path: string) => {
        renameSync(path, `${path}.opened`);
        writeFileSync(path, "swapped\n", { mode: 0o600 });
      } }))).toBe("identity");

      const checkpoint = join(directory, "checkpoint");
      mkdirSync(join(checkpoint, "packages/ingenium-extension/scripts"), { recursive: true });
      mkdirSync(join(checkpoint, ".opencode/agents/execution"), { recursive: true });
      mkdirSync(join(checkpoint, ".opencode/agents/primary"), { recursive: true });
      mkdirSync(join(checkpoint, "tests"), { recursive: true });
      const source = join(checkpoint, "packages/ingenium-extension/scripts/recovery-bootstrap.js");
      writeFileSync(source, "export {};\n");
      writeFileSync(join(checkpoint, "opencode.json"), "{}\n");
      writeFileSync(join(checkpoint, ".opencode/agents/execution/ingenium-recovery-engineer.md"), "---\n---\n");
      writeFileSync(join(checkpoint, ".opencode/agents/primary/ingenium-orchestrator.md"), "---\n---\n");
      writeFileSync(join(checkpoint, "tests/test-agent-validation.sh"), "#!/bin/sh\n");
      execFileSync("/usr/bin/git", ["-C", checkpoint, "init", "--quiet"]);
      execFileSync("/usr/bin/git", ["-C", checkpoint, "add", "."]);
      execFileSync("/usr/bin/git", ["-C", checkpoint, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "checkpoint"]);
      const sourceBytes = readFileSync(source);
      expect(shim.verifyScopedCheckpoint(realpathSync(checkpoint), realpathSync(source), sourceBytes))
        .toMatch(/^[0-9a-f]{40,64}$/);
      writeFileSync(source, "export const changed = true;\n");
      expect(() => shim.verifyScopedCheckpoint(realpathSync(checkpoint), realpathSync(source), readFileSync(source)))
        .toThrow("does not match reviewed Git HEAD");
      execFileSync("/usr/bin/git", ["-C", checkpoint, "checkout", "--", "packages/ingenium-extension/scripts/recovery-bootstrap.js"]);
      writeFileSync(join(checkpoint, "opencode.json"), "{\"dirty\":true}\n");
      expect(() => shim.verifyScopedCheckpoint(realpathSync(checkpoint), realpathSync(source), sourceBytes))
        .toThrow("scoped checkpoint has tracked drift");
      execFileSync("/usr/bin/git", ["-C", checkpoint, "checkout", "--", "opencode.json"]);
      writeFileSync(join(checkpoint, "packages/ingenium-extension/untracked.ts"), "export {};\n");
      expect(() => shim.verifyScopedCheckpoint(realpathSync(checkpoint), realpathSync(source), sourceBytes))
        .toThrow("scoped checkpoint has untracked drift");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("source recovery shim reports bounded directory trust failures in first-failure order", async () => {
    const importModule = Function("url", "return import(url)") as (url: string) => Promise<any>;
    const shim = await importModule(`${pathToFileURL(recoveryBootstrapShim).href}?test=${Date.now()}`);
    const directory = mkdtempSync(join(tmpdir(), "ingenium-source-recovery-directory-trust-"));
    try {
      const ownerControlled = join(directory, "owner-controlled");
      mkdirSync(ownerControlled, { mode: 0o755 });
      chmodSync(ownerControlled, 0o755);
      expect(shim.canonicalOwnedDirectory(ownerControlled, "fixture")).toBe(realpathSync(ownerControlled));

      expect(shim.CANONICAL_OWNED_DIRECTORY_FAILURE_REASONS)
        .toEqual(["directory", "canonical", "owner", "writable"]);
      const regularFile = join(directory, "regular-file");
      writeFileSync(regularFile, "not a directory", { mode: 0o777 });
      chmodSync(regularFile, 0o777);
      expect(trustedFailureReason(() => shim.canonicalOwnedDirectory(regularFile, "fixture"))).toBe("directory");
      expect(() => shim.canonicalOwnedDirectory(regularFile, regularFile)).toThrow(/^directory$/);

      const directoryLink = join(directory, "directory-link");
      symlinkSync(ownerControlled, directoryLink);
      expect(trustedFailureReason(() => shim.canonicalOwnedDirectory(directoryLink, "fixture"))).toBe("canonical");

      chmodSync(ownerControlled, 0o775);
      expect(trustedFailureReason(() => shim.canonicalOwnedDirectory(
        ownerControlled,
        "fixture",
        lstatSync(ownerControlled).uid + 1,
      ))).toBe("owner");
      expect(trustedFailureReason(() => shim.canonicalOwnedDirectory(ownerControlled, "fixture"))).toBe("writable");
      chmodSync(ownerControlled, 0o777);
      expect(trustedFailureReason(() => shim.canonicalOwnedDirectory(ownerControlled, "fixture"))).toBe("writable");
      expect(() => shim.canonicalOwnedDirectory(ownerControlled, "fixture"))
        .toThrow(/^writable$/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("installed current managed wrapper resolves production restart to the source shim", async () => {
    const importModule = Function("url", "return import(url)") as (url: string) => Promise<any>;
    const installed = join(dirname(fileURLToPath(import.meta.url)), "dist", "scripts", "managed-command-wrapper.js");
    const wrapper = await importModule(`${pathToFileURL(installed).href}?test=${Date.now()}`);
    expect(wrapper.managedBuildExecution(["deployment", "production-restart"])).toEqual({
      command: process.execPath,
      argv: [recoveryBootstrapShim],
    });
  });

  it("autonomous-recovery times out the outer recovery bootstrap without reaching production mutation", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-recovery-timeout-"));
    const timeout = Object.assign(new Error("outer timeout"), { code: "ETIMEDOUT" });
    const runner = vi.fn((_command: string, _argv: readonly string[], _options: Record<string, unknown>) => ({
      error: timeout, signal: "SIGTERM", status: null, pid: 4242,
    }));
    const terminateTimedOut = vi.fn();
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      writeFileSync(join(directory, "source.ts"), "export {};\n");
      let failure: unknown;
      try {
        managedCommand("build", ["deployment", "production-restart"], directory, {
          runner: runner as any,
          terminateTimedOut,
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: "ETIMEDOUT" });
      expect(runner).toHaveBeenCalledTimes(1);
      expect(runner.mock.calls[0]![2]).toMatchObject({
        timeout: MANAGED_RECOVERY_BOOTSTRAP_TIMEOUT_MS,
        killSignal: "SIGTERM",
        detached: process.platform !== "win32",
      });
      expect(MANAGED_RECOVERY_BOOTSTRAP_TIMEOUT_MS).toBeGreaterThan(RECOVERY_BOOTSTRAP_MAX_RUNTIME_MS);
      expect(terminateTimedOut).toHaveBeenCalledWith(4242, process.platform !== "win32", {
        nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        executableSha256: sha256(readFileSync(realpathSync(process.execPath))),
      });
      expect(existsSync(join(directory, "production-mutation"))).toBe(false);

      const kill = vi.fn();
      const identity = {
        pid: 4242,
        processGroupId: 4242,
        startTimeTicks: 100,
        executableSha256: sha256(readFileSync(realpathSync(process.execPath))),
      };
      const group: ManagedProcessGroupIdentity = { leader: identity, members: new Map([[identity.pid, identity]]) };
      terminateTimedOutManagedProcess(4242, true, { nonce: "n".repeat(43), executableSha256: identity.executableSha256 }, {
        inspect: () => group,
        kill: kill as any,
      });
      expect(kill).toHaveBeenCalledWith(-4242, "SIGTERM");
      expect(kill).toHaveBeenCalledWith(-4242, "SIGKILL");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("autonomous-recovery never signals a reused PID or changed process group", () => {
    const executableSha256 = sha256(readFileSync(realpathSync(process.execPath)));
    const original = {
      pid: 4242,
      processGroupId: 4242,
      startTimeTicks: 100,
      executableSha256,
    };
    const reused = { ...original, startTimeTicks: 101 };
    const inspect = vi.fn()
      .mockReturnValueOnce({ leader: original, members: new Map([[original.pid, original]]) })
      .mockReturnValue({ leader: reused, members: new Map([[reused.pid, reused]]) });
    const kill = vi.fn();
    expect(() => terminateTimedOutManagedProcess(4242, true, { nonce: "n".repeat(43), executableSha256 }, {
      inspect,
      kill: kill as any,
    })).toThrow("leader identity changed before signal");
    expect(kill).not.toHaveBeenCalled();

    const member = { ...original, pid: 4243 };
    const replacementMember = { ...member, startTimeTicks: 201 };
    const memberInspect = vi.fn()
      .mockReturnValueOnce({ leader: original, members: new Map([[original.pid, original], [member.pid, member]]) })
      .mockReturnValue({ leader: original, members: new Map([[original.pid, original], [member.pid, replacementMember]]) });
    expect(() => terminateTimedOutManagedProcess(4242, true, { nonce: "n".repeat(43), executableSha256 }, {
      inspect: memberInspect,
      kill: kill as any,
    })).toThrow("member identity changed before signal");
    expect(kill).not.toHaveBeenCalled();
  });

  it("autonomous-recovery stops an exact legacy recovery owner and retains its enrollment-timeout reason", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-legacy-owner-timeout-"));
    const nonce = "o".repeat(43);
    const owner = spawn(process.execPath, ["--input-type=module", "--eval", "setTimeout(() => {}, 10000)"], {
      cwd: worktree,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", INGENIUM_RECOVERY_OWNER_NONCE: nonce },
      stdio: "ignore",
    });
    try {
      if (!owner.pid) throw new Error("Legacy recovery owner did not start");
      const identity = recoveryProcessIdentity(owner.pid, sha256(nonce));
      const paths = recoveryPaths(worktree);
      writePrivateJson(paths.state, {
        schemaVersion: 1,
        owner: identity,
        fence: 1,
        generation: 1,
        phase: "owner_ready",
        activeParent: null,
        replacement: null,
        updatedAt: new Date().toISOString(),
      });

      await stopTimedOutLegacyRecoveryOwner(worktree, identity);

      expect(() => process.kill(owner.pid!, 0)).toThrow();
      expect(readFileSync(paths.events, "utf8").trim().split("\n").map((line) => JSON.parse(line)))
        .toContainEqual(expect.objectContaining({ event: "rollback", reason: "enrollment_timeout" }));
    } finally {
      await stopRecoveryProcess(owner);
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("recovery checkpoint rejects a changed production restart script before adapter mutation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-production-script-hash-"));
    const script = join(directory, "production-restart.js");
    const previousGuard = process.env.INGENIUM_RECOVERY_BOOTSTRAP_VERIFIED;
    const canonicalWorktree = vi.fn(() => directory);
    try {
      writeFileSync(script, "export {};\n");
      process.env.INGENIUM_RECOVERY_BOOTSTRAP_VERIFIED = sha256("different script");
      await expect(runProductionRestartCli({ canonicalWorktree } as any, script, ["node", script]))
        .rejects.toThrow("script hash changed after bootstrap");
      expect(canonicalWorktree).not.toHaveBeenCalled();
    } finally {
      if (previousGuard === undefined) delete process.env.INGENIUM_RECOVERY_BOOTSTRAP_VERIFIED;
      else process.env.INGENIUM_RECOVERY_BOOTSTRAP_VERIFIED = previousGuard;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires Basic authentication for OpenCode recovery requests", async () => {
    const authentication = { username: "recovery-user", password: "p".repeat(43) };
    const expected = `Basic ${Buffer.from(`${authentication.username}:${authentication.password}`).toString("base64")}`;
    const server = createHttpServer((request, response) => {
      const authorized = request.headers.authorization === expected;
      response.writeHead(authorized ? 200 : 401, { "content-type": "application/json" });
      response.end(JSON.stringify(authorized ? { healthy: true } : { error: "unauthorized" }));
    });
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind");
      const url = `http://127.0.0.1:${address.port}/global/health`;
      expect((await fetch(url)).status).toBe(401);
      await expect(openCodeJsonRequest(url, {}, AbortSignal.timeout(1_000), authentication))
        .resolves.toEqual({ status: 200, value: { healthy: true } });
    } finally {
      await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
    }
  });

  it("records Basic authentication rejection, health, and agent success without the secret", async () => {
    const authentication = { username: "opencode", password: "p".repeat(43) };
    const expected = `Basic ${Buffer.from(`${authentication.username}:${authentication.password}`).toString("base64")}`;
    const permissions = ["ingenium_docs_search", "ingenium_docs_get_page", "ingenium_coordination_memory_read"]
      .map((permission) => ({ permission, pattern: "*", action: "allow" }));
    const server = createHttpServer((request, response) => {
      if (request.headers.authorization !== expected) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(request.url === "/agent"
        ? [{ name: "ingenium-scout", permission: permissions }]
        : { healthy: true, version: "1.18.9" }));
    });
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind");
      const evidence = await probeReplacementHealthGate(
        `http://127.0.0.1:${address.port}`,
        "1.18.9",
        authentication,
        AbortSignal.timeout(2_000),
      );
      expect(evidence).toEqual({
        schemaVersion: 1,
        unauthenticatedStatus: 401,
        unauthenticatedRejected: true,
        authenticatedHealthStatus: 200,
        authenticatedHealthReady: true,
        authenticatedAgentStatus: 200,
        authenticatedAgentReady: true,
      });
      expect(JSON.stringify(evidence)).not.toContain(authentication.password);
    } finally {
      await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
    }
  });

  it("refuses Basic authentication health requests when the unauthenticated endpoint is accepted", async () => {
    let authenticatedRequests = 0;
    const server = createHttpServer((request, response) => {
      if (request.headers.authorization) authenticatedRequests += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ healthy: true, version: "1.18.9" }));
    });
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind");
      await expect(probeReplacementHealthGate(
        `http://127.0.0.1:${address.port}`,
        "1.18.9",
        { username: "opencode", password: "p".repeat(43) },
        AbortSignal.timeout(2_000),
      )).resolves.toMatchObject({
        unauthenticatedStatus: 200,
        unauthenticatedRejected: false,
        authenticatedHealthStatus: null,
        authenticatedAgentStatus: null,
      });
      expect(authenticatedRequests).toBe(0);
    } finally {
      await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
    }
  });

  it("accepts a recovery server secret only from its verified owner-private file", () => {
    const dataHome = mkdtempSync(join(tmpdir(), "ingenium-recovery-server-auth-"));
    try {
      chmodSync(dataHome, 0o700);
      const authentication = { username: "opencode", password: "s".repeat(43) };
      const path = recoveryServerAuthenticationPath(dataHome);
      writeFileSync(path, `${JSON.stringify(authentication)}\n`, { mode: 0o600 });
      expect(readRecoveryServerAuthentication(dataHome)).toEqual(authentication);
      writeFileSync(path, `${JSON.stringify({ ...authentication, username: "other" })}\n`);
      expect(() => readRecoveryServerAuthentication(dataHome)).toThrow("Recovery server authentication is unavailable");
      chmodSync(path, 0o644);
      expect(() => readRecoveryServerAuthentication(dataHome)).toThrow("TUI recovery state is unavailable");
    } finally {
      rmSync(dataHome, { recursive: true, force: true });
    }
  });

  it("projects the exact captured handoff arrays into typed coordination memory", () => {
    const handoff = recoveryHandoff();
    expect(restartHandoffMemoryEntry(handoff)).toEqual({
      status: handoff.status,
      actions: [{ kind: "edit", result: "succeeded", pathSegments: ["c3Jj", "cmVjb3ZlcnkudHM"], targetHash: null }],
      checks: [{ kind: "test", result: "passed", targetHash: sha256("recovery-check") }],
      todos: handoff.todos,
      currentTaskId: `task-${handoff.taskHash}`,
      changedPaths: [{
        pathSegments: ["c3Jj", "cmVjb3ZlcnkudHM"], operation: "edit", additions: 2, deletions: 1, changeRevision: 1,
      }],
      nextWork: handoff.nextWork,
    });
  });

  it("records exact bounded handoff and typed coordination acknowledgement evidence", () => {
    const handoff = recoveryHandoff();
    const handoffSha256 = sha256(JSON.stringify(handoff));
    const replacementIdentity = {
      pid: 2001,
      startTimeTicks: 3001,
      executableSha256: sha256("replacement-executable"),
      nonceSha256: sha256("replacement-nonce"),
    };
    expect(restartHandoffEvidence(handoff, handoffSha256)).toEqual({
      schemaVersion: 1,
      handoffSha256,
      actionCount: 1,
      changedPathCount: 1,
      checkCount: 1,
      handoff,
    });
    expect(typedMemoryAcknowledgementEvidence({
      handoff,
      handoffSha256,
      captureFile: "/tmp/opencode/recovery/capture.jsonl",
      captureOffset: 128,
      sessionId: "successor-session",
      replacementIdentity,
      transactionSha256: sha256("transaction"),
    })).toEqual({
      schemaVersion: 1,
      handoffSha256,
      actionCount: 1,
      changedPathCount: 1,
      checkCount: 1,
      captureFile: "/tmp/opencode/recovery/capture.jsonl",
      captureOffset: 128,
      successorSessionSha256: sha256("successor-session"),
      replacementIdentitySha256: recoveryIdentitySha256(replacementIdentity),
      transactionSha256: sha256("transaction"),
      assistantResult: "completed",
      terminalStatus: "idle",
    });
    expect(() => restartHandoffEvidence(handoff, sha256("wrong-handoff"))).toThrow("handoff hash changed");
    for (const invalid of [
      { ...handoff, actions: Array(65).fill(handoff.actions[0]) },
      { ...handoff, changedPaths: Array(33).fill(handoff.changedPaths[0]) },
      { ...handoff, checks: Array(33).fill(handoff.checks[0]) },
    ]) expect(() => restartHandoffEvidence(invalid, sha256(JSON.stringify(invalid)))).toThrow();
  });

  it("derives the fixed production restart request and preserves replacement-first ordering", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-production-restart-adapter-"));
    try {
      const request = replacementRequest(worktree);
      const binding: ProductionRestartBinding = {
        ...request.binding,
        apiUrl: "http://127.0.0.1:4097/api/v1",
        project: "production-project",
        credentialFile: join(worktree, ".opencode", ".ingenium-mcp-credential"),
      };
      const parent: ProductionRestartParentCandidate = {
        binding: request.binding,
        oldProcess: request.oldProcess,
        oldPort: request.oldPort,
        oldDataHome: request.oldDataHome,
        handoff: request.handoff,
        timeouts: request.timeouts,
      };
      const replacement: RestartProcessIdentity = {
        pid: 1002,
        startTimeTicks: 2002,
        ...request.replacement.expectedIdentity,
      };
      const calls: string[] = [];
      const dependencies: ProductionRestartAdapterDependencies<string> = {
        canonicalWorktree: () => { calls.push("worktree"); return worktree; },
        resolveBinding: async () => { calls.push("resolve-binding"); return binding; },
        readParentCandidates: () => { calls.push("read-parent"); return []; },
        enrollParentCandidate: async () => { calls.push("enroll-parent"); return parent; },
        attestParentProcess: () => { calls.push("attest-parent"); return true; },
        prepareReplacement: async () => {
          calls.push("prepare");
          return {
            replacement: request.replacement,
            dependencies: {
              revalidateBinding: async () => { calls.push("binding"); return true; },
              revalidateProcessIdentity: async (_identity, role) => { calls.push(`identity:${role}`); return true; },
              persistHandoff: async () => { calls.push("publish"); },
              launchReplacement: async (input) => { calls.push("launch"); input.bindProvisionalIdentity(replacement); return replacement; },
              verifyReplacementHealth: async () => { calls.push("health"); },
              createReplacementSession: async (_identity, _port, transactionSha256) => {
                calls.push("session");
                return { status: "created", transactionSha256, session: "fresh-session" };
              },
              acknowledgeTypedMemory: async (_identity, _session, handoffSha256, transactionSha256) => {
                calls.push("memory-ack");
                return { status: "acknowledged", handoffSha256, transactionSha256 };
              },
              awaitTerminalIdleAcknowledgement: async (_identity, _session, handoffSha256, transactionSha256) => {
                calls.push("terminal-idle");
                return { status: "idle", handoffSha256, transactionSha256, assistantResult: "completed" };
              },
              retireOldProcess: async () => { calls.push("retire-old"); },
              stopReplacement: async () => { calls.push("stop-replacement"); },
              persistEvidence: (entry) => { calls.push(`persist:${entry.phase}`); },
            },
            release: () => { calls.push("release"); },
          };
        },
      };

      await expect(runProductionRestartAdapter(dependencies)).resolves.toEqual({
        handoffSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        replacementIdentitySha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(calls).toEqual([
        "worktree", "resolve-binding", "read-parent", "enroll-parent", "attest-parent", "prepare", "binding", "identity:old", "publish",
        "persist:handoff_published", "launch", "identity:replacement", "persist:replacement_started", "health",
        "persist:replacement_healthy", "session", "persist:session_created", "memory-ack",
        "persist:typed_memory_acknowledged", "terminal-idle", "persist:terminal_idle_acknowledged", "binding",
        "identity:old", "identity:replacement", "persist:retirement_committed", "retire-old", "persist:old_parent_retired", "release",
      ]);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("rejects absent, ambiguous, or unattested production restart parents before launch", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-production-restart-adapter-failure-"));
    try {
      const request = replacementRequest(worktree);
      request.oldProcess.pid = process.pid;
      const binding: ProductionRestartBinding = {
        ...request.binding,
        apiUrl: "http://127.0.0.1:4097/api/v1",
        project: "production-project",
        credentialFile: join(worktree, ".opencode", ".ingenium-mcp-credential"),
      };
      const parent: ProductionRestartParentCandidate = {
        binding: request.binding,
        oldProcess: request.oldProcess,
        oldPort: request.oldPort,
        oldDataHome: request.oldDataHome,
        handoff: request.handoff,
        timeouts: request.timeouts,
      };
      const replacement: RestartProcessIdentity = {
        pid: process.pid + 1,
        startTimeTicks: 2102,
        ...request.replacement.expectedIdentity,
      };
      let retired = false;
      let stopped: RestartProcessIdentity | undefined;
      let released = false;
      let prepared = 0;
      const base = (parentCandidates: ProductionRestartParentCandidate[]): ProductionRestartAdapterDependencies<object> => ({
        canonicalWorktree: () => worktree,
        resolveBinding: async () => binding,
        readParentCandidates: () => parentCandidates,
        attestParentProcess: (candidate) => candidate.oldProcess.nonceSha256 !== hash("sentinel"),
        prepareReplacement: async () => {
          prepared += 1;
          return {
            replacement: request.replacement,
            dependencies: {
              revalidateBinding: async () => true,
              revalidateProcessIdentity: async () => true,
              persistHandoff: async () => {},
              launchReplacement: async (input) => { input.bindProvisionalIdentity(replacement); return replacement; },
              verifyReplacementHealth: async () => {},
              createReplacementSession: async (_identity, _port, transactionSha256) => ({
                status: "created", transactionSha256, session: {},
              }),
              acknowledgeTypedMemory: async () => { throw new Error("typed memory acknowledgement failed"); },
              awaitTerminalIdleAcknowledgement: async (_identity, _session, handoffSha256, transactionSha256) => ({
                status: "idle", handoffSha256, transactionSha256, assistantResult: "completed",
              }),
              retireOldProcess: async () => { retired = true; },
              stopReplacement: async (identity) => { stopped = identity; },
              persistEvidence: async () => {},
            },
            release: () => { released = true; },
          };
        },
      });

      await expect(runProductionRestartAdapter(base([])))
        .rejects.toThrow("parent identity is absent or ambiguous");
      await expect(runProductionRestartAdapter(base([parent, parent])))
        .rejects.toThrow("parent identity is absent or ambiguous");
      const forged = { ...parent, oldProcess: { ...parent.oldProcess, nonceSha256: hash("sentinel") } };
      await expect(runProductionRestartAdapter(base([forged])))
        .rejects.toThrow("parent launcher nonce is invalid");
      expect(prepared).toBe(0);
      await expect(runProductionRestartAdapter(base([parent])))
        .rejects.toThrow("typed memory acknowledgement failed");
      expect(retired).toBe(false);
      expect(stopped).toEqual(replacement);
      expect(released).toBe(true);
      expect(() => process.kill(process.pid, 0)).not.toThrow();
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("autonomous-recovery keeps one verified successor session through acknowledgement and retirement", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-replacement-first-"));
    try {
      const request = replacementRequest(worktree);
      const replacement: RestartProcessIdentity = {
        pid: 1002,
        startTimeTicks: 2002,
        executableSha256: request.replacement.expectedIdentity.executableSha256,
        nonceSha256: request.replacement.expectedIdentity.nonceSha256,
      };
      const calls: string[] = [];
      const evidence: ReplacementFirstRestartEvidence[] = [];
      const phaseHistory = join(worktree, "phase-history.jsonl");
      writeFileSync(phaseHistory, "\n", { mode: 0o600 });
      const dependencies: ReplacementFirstRestartDependencies<string> = {
        revalidateBinding: async () => { calls.push("binding"); return true; },
        revalidateProcessIdentity: async (_identity, role) => { calls.push(`identity:${role}`); return true; },
        persistHandoff: async () => { calls.push("publish"); },
        launchReplacement: async (input) => { calls.push("launch"); input.bindProvisionalIdentity(replacement); return replacement; },
        verifyReplacementHealth: async () => { calls.push("health"); },
        createReplacementSession: async (_identity, _port, transactionSha256) => {
          calls.push("session");
          return { status: "created", transactionSha256, session: "raw-session-id" };
        },
        acknowledgeTypedMemory: async (_identity, session, handoffSha256, transactionSha256) => {
          expect(session).toBe("raw-session-id");
          calls.push("memory-ack");
          return { status: "acknowledged", handoffSha256, transactionSha256 };
        },
        awaitTerminalIdleAcknowledgement: async (_identity, session, handoffSha256, transactionSha256) => {
          expect(session).toBe("raw-session-id");
          calls.push("terminal-idle");
          return { status: "idle", handoffSha256, transactionSha256, assistantResult: "completed" };
        },
        prepareRecoveryOwner: async (identity, _session, _handoffSha256, transactionSha256) => {
          calls.push("owner-ready");
          return { status: "ready", transactionSha256, replacementIdentitySha256: recoveryIdentitySha256(identity) };
        },
        commitRecoveryOwner: async () => { calls.push("owner-commit"); },
        retireOldProcess: async () => { calls.push("retire-old"); },
        stopReplacement: async () => { calls.push("stop-replacement"); },
        persistEvidence: (entry) => {
          calls.push(`persist:${entry.phase}`);
          evidence.push(entry);
          appendProductionRestartEvidence(phaseHistory, entry);
        },
      };

      const result = await managedReplacementFirstRestart([encodedRestart(request)], dependencies, worktree);

      expect(calls).toEqual([
        "binding", "identity:old", "publish", "persist:handoff_published", "launch", "identity:replacement",
        "persist:replacement_started", "health", "persist:replacement_healthy", "session", "persist:session_created",
        "memory-ack", "persist:typed_memory_acknowledged", "terminal-idle", "persist:terminal_idle_acknowledged",
        "owner-ready", "persist:recovery_owner_ready", "binding", "identity:old", "identity:replacement", "owner-commit",
        "persist:retirement_committed", "retire-old", "persist:old_parent_retired",
      ]);
      expect(evidence.at(-1)).toMatchObject({ phase: "old_parent_retired", oldParentRetired: true, replacementStopped: false });
      expect(result).toEqual({
        handoffSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        replacementIdentitySha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(JSON.stringify(evidence)).not.toContain("raw-session-id");
      expect(JSON.stringify(evidence)).not.toContain('"pid"');
      const retained = readFileSync(phaseHistory, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(retained.map((entry) => entry.phase)).toEqual(evidence.map((entry) => entry.phase));
      expect(retained.every((entry) => entry.handoffSha256 === result.handoffSha256
        && entry.actionCount === 1 && entry.changedPathCount === 1 && entry.checkCount === 1
        && typeof entry.occurredAt === "string")).toBe(true);
      expect(retained.filter((entry) => entry.phase !== "handoff_published").every((entry) =>
        /^[0-9a-f]{64}$/.test(entry.replacementIdentitySha256) && /^[0-9a-f]{64}$/.test(entry.transactionSha256))).toBe(true);

      await expect(managedReplacementFirstRestart([JSON.stringify(request)], dependencies, worktree))
        .rejects.toThrow("Replacement-first restart payload is invalid");
      await expect(managedReplacementFirstRestart([encodedRestart({ ...request, rawSessionId: "secret-session" })], dependencies, worktree))
        .rejects.toThrow("Replacement-first restart payload is invalid");
      await expect(managedReplacementFirstRestart([encodedRestart({ ...request, worktree: `${worktree}/.` })], dependencies, worktree))
        .rejects.toThrow("worktree must be a canonical absolute path");
      await expect(managedReplacementFirstRestart([encodedRestart({
        ...request,
        replacement: { ...request.replacement, port: request.oldPort },
      })], dependencies, worktree)).rejects.toThrow("port and data home must be distinct");
      await expect(managedReplacementFirstRestart([encodedRestart({
        ...request,
        replacement: { ...request.replacement, dataHome: join(request.oldDataHome, "nested") },
      })], dependencies, worktree)).rejects.toThrow("port and data home must be distinct");
      await expect(managedReplacementFirstRestart([encodedRestart(request), encodedRestart(request)], dependencies, worktree))
        .rejects.toThrow("requires one encoded payload");
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("keeps the old process active and stops only the re-attested replacement on restart pre-idle-ack failure", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-replacement-first-failure-"));
    try {
      const request = replacementRequest(worktree);
      const replacement: RestartProcessIdentity = {
        pid: 1102,
        startTimeTicks: 2102,
        executableSha256: request.replacement.expectedIdentity.executableSha256,
        nonceSha256: request.replacement.expectedIdentity.nonceSha256,
      };
      const calls: string[] = [];
      const evidence: ReplacementFirstRestartEvidence[] = [];
      const dependencies: ReplacementFirstRestartDependencies<object> = {
        revalidateBinding: async () => { calls.push("binding"); return true; },
        revalidateProcessIdentity: async (_identity, role) => { calls.push(`identity:${role}`); return true; },
        persistHandoff: async () => { calls.push("publish"); },
        launchReplacement: async (input) => { calls.push("launch"); input.bindProvisionalIdentity(replacement); return replacement; },
        verifyReplacementHealth: async () => { calls.push("health"); },
        createReplacementSession: async (_identity, _port, transactionSha256) => {
          calls.push("session");
          return { status: "created", transactionSha256, session: {} };
        },
        acknowledgeTypedMemory: async (_identity, _session, handoffSha256, transactionSha256) => {
          calls.push("memory-ack");
          return { status: "acknowledged", handoffSha256, transactionSha256 };
        },
        awaitTerminalIdleAcknowledgement: async () => { calls.push("terminal-idle"); throw new Error("idle acknowledgement failed"); },
        retireOldProcess: async () => { calls.push("retire-old"); },
        stopReplacement: async (identity) => {
          expect(identity).toEqual(replacement);
          calls.push("stop-replacement");
        },
        persistEvidence: (entry) => { calls.push(`persist:${entry.phase}`); evidence.push(entry); },
      };

      await expect(managedReplacementFirstRestart([encodedRestart(request)], dependencies, worktree))
        .rejects.toThrow("idle acknowledgement failed");

      expect(calls).toEqual([
        "binding", "identity:old", "publish", "persist:handoff_published", "launch", "identity:replacement",
        "persist:replacement_started", "health", "persist:replacement_healthy", "session", "persist:session_created",
        "memory-ack", "persist:typed_memory_acknowledged", "terminal-idle", "identity:replacement",
        "stop-replacement", "persist:failed",
      ]);
      expect(calls).not.toContain("retire-old");
      expect(evidence.at(-1)).toMatchObject({
        phase: "failed",
        lastCompletedPhase: "typed_memory_acknowledged",
        oldParentRetired: false,
        replacementStopped: true,
      });
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("stops the provisionally bound replacement when restart launch attestation times out", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-replacement-launch-timeout-"));
    vi.useFakeTimers();
    try {
      const request = replacementRequest(worktree);
      const replacement: RestartProcessIdentity = {
        pid: 1202,
        startTimeTicks: 2202,
        ...request.replacement.expectedIdentity,
      };
      let stopped: RestartProcessIdentity | undefined;
      const dependencies: ReplacementFirstRestartDependencies<object> = {
        revalidateBinding: async () => true,
        revalidateProcessIdentity: async () => true,
        persistHandoff: async () => {},
        launchReplacement: async (input) => {
          input.bindProvisionalIdentity(replacement);
          return await new Promise<RestartProcessIdentity>(() => {});
        },
        verifyReplacementHealth: async () => {},
        createReplacementSession: async (_identity, _port, transactionSha256) => ({
          status: "created", transactionSha256, session: {},
        }),
        acknowledgeTypedMemory: async (_identity, _session, handoffSha256, transactionSha256) => ({
          status: "acknowledged", handoffSha256, transactionSha256,
        }),
        awaitTerminalIdleAcknowledgement: async (_identity, _session, handoffSha256, transactionSha256) => ({
          status: "idle", handoffSha256, transactionSha256, assistantResult: "completed",
        }),
        retireOldProcess: async () => {},
        stopReplacement: async (identity) => { stopped = identity; },
        persistEvidence: async () => {},
      };

      const assertion = expect(managedReplacementFirstRestart([encodedRestart(request)], dependencies, worktree))
        .rejects.toThrow("replacement launch timed out");
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(request.timeouts.launchMs + 1);
      await assertion;
      expect(stopped).toEqual(replacement);
    } finally {
      vi.useRealTimers();
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("rejects malformed or reused restart sessions, stale acknowledgements, and failed assistants before retirement", async () => {
    for (const variant of ["malformed", "reused", "stale-ack", "failed-assistant"] as const) {
      const worktree = mkdtempSync(join(tmpdir(), `ingenium-replacement-session-${variant}-`));
      try {
        const request = replacementRequest(worktree);
        const replacement: RestartProcessIdentity = {
          pid: 1302,
          startTimeTicks: 2302,
          ...request.replacement.expectedIdentity,
        };
        let retired = false;
        let stopped = false;
        const dependencies: ReplacementFirstRestartDependencies<object> = {
          revalidateBinding: async () => true,
          revalidateProcessIdentity: async () => true,
          persistHandoff: async () => {},
          launchReplacement: async (input) => { input.bindProvisionalIdentity(replacement); return replacement; },
          verifyReplacementHealth: async () => {},
          createReplacementSession: async (_identity, _port, transactionSha256) => {
            if (variant === "malformed") return {} as any;
            if (variant === "reused") return { status: "reused", transactionSha256, session: {} } as any;
            return { status: "created", transactionSha256, session: {} };
          },
          acknowledgeTypedMemory: async (_identity, _session, handoffSha256, transactionSha256) => ({
            status: "acknowledged",
            handoffSha256,
            transactionSha256: variant === "stale-ack" ? hash("stale") : transactionSha256,
          }),
          awaitTerminalIdleAcknowledgement: async (_identity, _session, handoffSha256, transactionSha256) => ({
            status: "idle",
            handoffSha256,
            transactionSha256,
            assistantResult: variant === "failed-assistant" ? "error" : "completed",
          } as any),
          retireOldProcess: async () => { retired = true; },
          stopReplacement: async () => { stopped = true; },
          persistEvidence: async () => {},
        };
        const expected = variant === "malformed" || variant === "reused"
          ? "Replacement session creation is invalid"
          : variant === "stale-ack" ? "Typed memory acknowledgement is invalid" : "Terminal idle acknowledgement is invalid";

        await expect(managedReplacementFirstRestart([encodedRestart(request)], dependencies, worktree)).rejects.toThrow(expected);
        expect(retired).toBe(false);
        expect(stopped).toBe(true);
      } finally {
        rmSync(worktree, { recursive: true, force: true });
      }
    }
  });

  it("returns committed restart recovery when evidence persistence fails after the old process exits", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-replacement-committed-recovery-"));
    try {
      const request = replacementRequest(worktree);
      const replacement: RestartProcessIdentity = {
        pid: 1402,
        startTimeTicks: 2402,
        ...request.replacement.expectedIdentity,
      };
      const evidence: ReplacementFirstRestartEvidence[] = [];
      let retired = false;
      let stopped = false;
      const dependencies: ReplacementFirstRestartDependencies<object> = {
        revalidateBinding: async () => true,
        revalidateProcessIdentity: async () => true,
        persistHandoff: async () => {},
        launchReplacement: async (input) => { input.bindProvisionalIdentity(replacement); return replacement; },
        verifyReplacementHealth: async () => {},
        createReplacementSession: async (_identity, _port, transactionSha256) => ({
          status: "created", transactionSha256, session: {},
        }),
        acknowledgeTypedMemory: async (_identity, _session, handoffSha256, transactionSha256) => ({
          status: "acknowledged", handoffSha256, transactionSha256,
        }),
        awaitTerminalIdleAcknowledgement: async (_identity, _session, handoffSha256, transactionSha256) => ({
          status: "idle", handoffSha256, transactionSha256, assistantResult: "completed",
        }),
        retireOldProcess: async () => { retired = true; },
        stopReplacement: async () => { stopped = true; },
        persistEvidence: async (entry) => {
          evidence.push(entry);
          if (entry.phase === "old_parent_retired") throw new Error("evidence unavailable");
        },
      };

      await expect(managedReplacementFirstRestart([encodedRestart(request)], dependencies, worktree)).resolves.toEqual({
        handoffSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        replacementIdentitySha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        recoveryState: "retirement_committed",
      });
      expect(retired).toBe(true);
      expect(stopped).toBe(false);
      expect(evidence.find((entry) => entry.phase === "retirement_committed")).toMatchObject({
        retirementCommitted: true,
        oldParentRetired: false,
      });
      expect(evidence.at(-1)).toMatchObject({
        phase: "committed_recovery",
        lastCompletedPhase: "retirement_committed",
        retirementCommitted: true,
        oldParentRetired: true,
      });
      expect(evidence.some((entry) => entry.phase === "failed")).toBe(false);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("removes executable and Compose overrides from managed build children", () => {
    const environment = managedBuildEnvironment({
      PATH: "/tmp/fake-bin",
      COMPOSE_FILE: "/tmp/attacker.yml",
      DOCKER_HOST: "tcp://attacker.invalid",
      NODE_OPTIONS: "--require=/tmp/attacker.js",
      npm_config_script_shell: "/tmp/attacker-shell",
      SAFE_VALUE: "retained",
    });
    expect(environment).toEqual({ PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`, SAFE_VALUE: "retained" });
  });

  it("passes only attested recovery bindings to the production restart shim", () => {
    const environment = managedRecoveryEnvironment({
      HOME: "/tmp/recovery-home",
      INGENIUM_WORKTREE: repositoryRoot,
      INGENIUM_WORKSPACE_ID: "workspace",
      LD_PRELOAD: "/tmp/attacker.so",
      NODE_OPTIONS: "--require=/tmp/attacker.js",
      OPENCODE_SERVER_PASSWORD: "must-not-pass",
      SAFE_VALUE: "must-not-pass",
    });
    expect(environment).toEqual({
      HOME: "/tmp/recovery-home",
      INGENIUM_WORKSPACE_ID: "workspace",
      INGENIUM_WORKTREE: repositoryRoot,
      PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    });
  });

  it("removes Git execution environment overrides", () => {
    expect(managedGitEnvironment({
      PATH: "/tmp/attacker",
      GIT_EXEC_PATH: "/tmp/helpers",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: "/tmp/hooks",
      GIT_EDITOR: "/tmp/editor",
      SSH_ASKPASS: "/tmp/askpass",
      SAFE_VALUE: "retained",
    })).toMatchObject({
      PATH: "/usr/local/bin:/usr/bin:/bin",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_EDITOR: "true",
      GIT_SEQUENCE_EDITOR: "true",
      GIT_PAGER: "cat",
      GIT_TERMINAL_PROMPT: "0",
      GIT_LITERAL_PATHSPECS: "1",
      SAFE_VALUE: "retained",
    });
    const serialized = JSON.stringify(managedGitEnvironment({ GIT_EXEC_PATH: "/tmp/helpers", SSH_ASKPASS: "/tmp/askpass" }));
    expect(serialized).not.toContain("/tmp/helpers");
    expect(serialized).not.toContain("/tmp/askpass");
  });

  it("rejects repository-local hooks and helper configuration before Git mutation", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-git-"));
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      for (const [key, value] of [
        ["core.hooksPath", "/tmp/hooks"],
        ["filter.inject.process", "/tmp/filter"],
        ["merge.inject.driver", "/tmp/merge-driver"],
      ] as const) {
        execFileSync("/usr/bin/git", ["-C", directory, "config", key, value]);
        expect(() => managedCommand("repository", ["add", "safe.txt"], directory))
          .toThrow("Repository wrapper rejected executable Git configuration");
        execFileSync("/usr/bin/git", ["-C", directory, "config", "--unset", key]);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("stages a literal path without executing a hook or exposing its inherited sentinel", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-git-"));
    const previousSentinel = process.env.MANAGED_HOOK_SENTINEL;
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      const marker = join(directory, "hook-ran");
      const exposure = join(directory, "hook-sentinel");
      const hook = join(directory, ".git", "hooks", "post-index-change");
      const sentinel = "post-index-change-private-sentinel";
      process.env.MANAGED_HOOK_SENTINEL = sentinel;
      writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\nprintf '%s' "$MANAGED_HOOK_SENTINEL" > '${exposure}'\n`);
      chmodSync(hook, 0o700);
      writeFileSync(join(directory, "safe.txt"), "safe\n");

      expect(managedCommand("repository", ["add", "safe.txt"], directory)).toBe(0);
      expect(execFileSync("/usr/bin/git", ["-C", directory, "diff", "--cached", "--name-only"], { encoding: "utf8" }))
        .toBe("safe.txt\n");
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(exposure)).toBe(false);
    } finally {
      if (previousSentinel === undefined) delete process.env.MANAGED_HOOK_SENTINEL;
      else process.env.MANAGED_HOOK_SENTINEL = previousSentinel;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("commits with the exact message without executing a hook or exposing its inherited sentinel", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-git-"));
    const previousSentinel = process.env.MANAGED_HOOK_SENTINEL;
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      const marker = join(directory, "hook-ran");
      const exposure = join(directory, "hook-sentinel");
      const hook = join(directory, ".git", "hooks", "pre-commit");
      const sentinel = "pre-commit-private-sentinel";
      process.env.MANAGED_HOOK_SENTINEL = sentinel;
      writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\nprintf '%s' "$MANAGED_HOOK_SENTINEL" > '${exposure}'\n`);
      chmodSync(hook, 0o700);
      writeFileSync(join(directory, "safe.txt"), "safe\n");
      const message = "chore(checkpoint): preserve runtime and coordination hardening work";

      expect(managedCommand("repository", ["add", "safe.txt"], directory)).toBe(0);
      expect(managedCommand("repository", ["commit", message], directory)).toBe(0);
      expect(execFileSync("/usr/bin/git", ["-C", directory, "log", "-1", "--format=%s"], { encoding: "utf8" }))
        .toBe(`${message}\n`);
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(exposure)).toBe(false);
    } finally {
      if (previousSentinel === undefined) delete process.env.MANAGED_HOOK_SENTINEL;
      else process.env.MANAGED_HOOK_SENTINEL = previousSentinel;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves the native index lock and propagates Git's nonzero status", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-git-"));
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      writeFileSync(join(directory, "safe.txt"), "safe\n");
      const lock = join(directory, ".git", "index.lock");
      writeFileSync(lock, "competing writer\n");

      expect(managedCommand("repository", ["add", "safe.txt"], directory)).toBe(128);
      expect(existsSync(lock)).toBe(true);
      expect(execFileSync("/usr/bin/git", ["-C", directory, "diff", "--cached", "--name-only"], { encoding: "utf8" }))
        .toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("allows exactly one managed commit when an executable hook would change the ref", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-git-"));
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      execFileSync("/usr/bin/git", ["-C", directory, "config", "user.name", "Managed Wrapper Test"]);
      execFileSync("/usr/bin/git", ["-C", directory, "config", "user.email", "managed-wrapper@example.invalid"]);
      const competingStatus = join(directory, "competing-status");
      const hook = join(directory, ".git", "hooks", "pre-commit");
      writeFileSync(hook, `#!/bin/sh\nchmod -x "$0"\n/usr/bin/git commit -m 'competing commit'\nprintf '%s' "$?" > '${competingStatus}'\nexit 0\n`);
      chmodSync(hook, 0o700);
      writeFileSync(join(directory, "safe.txt"), "safe\n");
      const message = "chore: native lock wins";

      expect(managedCommand("repository", ["add", "safe.txt"], directory)).toBe(0);
      expect(managedCommand("repository", ["commit", message], directory)).toBe(0);
      expect(existsSync(competingStatus)).toBe(false);
      expect(execFileSync("/usr/bin/git", ["-C", directory, "rev-list", "--count", "HEAD"], { encoding: "utf8" }))
        .toBe("1\n");
      expect(execFileSync("/usr/bin/git", ["-C", directory, "log", "-1", "--format=%s"], { encoding: "utf8" }))
        .toBe(`${message}\n`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails safely when the index is empty", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-git-"));
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      execFileSync("/usr/bin/git", ["-C", directory, "config", "user.name", "Managed Wrapper Test"]);
      execFileSync("/usr/bin/git", ["-C", directory, "config", "user.email", "managed-wrapper@example.invalid"]);

      expect(managedCommand("repository", ["commit", "chore: empty index"], directory)).toBe(1);
      expect(() => execFileSync("/usr/bin/git", ["-C", directory, "rev-parse", "--verify", "HEAD"]))
        .toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("allows ignored build output without changing the source fingerprint", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-build-"));
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      writeFileSync(join(directory, ".gitignore"), "dist/\n");
      writeFileSync(join(directory, "source.ts"), "export const value = 1;\n");
      writeFileSync(join(directory, "package.json"), JSON.stringify({
        scripts: {
          typecheck: "node -e \"require('node:fs').mkdirSync('dist'); require('node:fs').writeFileSync('dist/output.js', 'built')\"",
        },
      }));

      expect(managedCommand("build", ["run", "typecheck"], directory)).toBe(0);
      expect(readFileSync(join(directory, "source.ts"), "utf8")).toBe("export const value = 1;\n");
      expect(readFileSync(join(directory, "dist", "output.js"), "utf8")).toBe("built");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a build that changes repository source", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-build-"));
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      writeFileSync(join(directory, "source.ts"), "export const value = 1;\n");
      writeFileSync(join(directory, "package.json"), JSON.stringify({
        scripts: {
          build: "node -e \"require('node:fs').writeFileSync('source.ts', 'export const value = 2;\\n')\"",
        },
      }));

      expect(() => managedCommand("build", ["run", "build"], directory))
        .toThrow("Build wrapper produced source changes");
      expect(readFileSync(join(directory, "source.ts"), "utf8")).toBe("export const value = 2;\n");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("propagates a real nonzero build result", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-build-"));
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      writeFileSync(join(directory, "package.json"), JSON.stringify({
        scripts: { lint: "node -e \"process.exit(7)\"" },
      }));

      expect(managedCommand("build", ["run", "lint"], directory)).toBe(7);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("routes each package bin through an explicit wrapper kind", () => {
    const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
      bin: Record<string, string>;
      scripts: { build: string };
    };
    expect(manifest.bin).toMatchObject({
      "ingenium-repository": "./dist/scripts/repository-command.js",
      "ingenium-build": "./dist/scripts/build-command.js",
    });
    expect(manifest.bin["ingenium-repository"]).not.toBe(manifest.bin["ingenium-build"]);
    expect(manifest.scripts.build).toContain("test -f dist/scripts/recovery-bootstrap.js");
    expect(manifest.scripts.build).toContain("test -f dist/scripts/production-restart.js");
    expect(manifest.scripts.build).toMatch(/chmod 0555 [^&]+dist\/scripts\/recovery-bootstrap\.js/);
    expect(manifest.scripts.build).toMatch(/chmod 0555 [^&]+dist\/scripts\/production-restart\.js/);

    expect(() => runManagedCommandCli("repository", ["node", "repository-command", Buffer.from(JSON.stringify(["status"])).toString("base64url")]))
      .toThrow("Repository wrapper rejected the command");
    expect(() => runManagedCommandCli("build", ["node", "build-command", Buffer.from(JSON.stringify(["exec", "arbitrary"])).toString("base64url")]))
      .toThrow("Build wrapper rejected the command");
    expect(() => runManagedCommandCli("build", ["node", "build-command", "deployment", "compose-up"]))
      .toThrow("Managed wrapper requires one encoded argv payload");
  });
});

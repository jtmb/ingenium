import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  decodeManagedArgv,
  decodeManagedBuildArgv,
  decodeManagedRepositoryArgv,
  isManagedDeploymentArgv,
  managedBuildEnvironment,
  managedBuildExecution,
  managedCommand,
  managedGitEnvironment,
  managedReplacementFirstRestart,
  managedRepositoryArgv,
  runManagedCommandCli,
  validateManagedBuildArgv,
  validateManagedRepositoryArgv,
} from "./scripts/managed-command-wrapper.js";
import type {
  ReplacementFirstRestartDependencies,
  ReplacementFirstRestartEvidence,
  ReplacementFirstRestartRequest,
  RestartProcessIdentity,
} from "./replacement-first-restart.js";
import {
  runProductionRestartAdapter,
  type ProductionRestartAdapterDependencies,
  type ProductionRestartBinding,
  type ProductionRestartParentCandidate,
} from "./scripts/production-restart.js";

const hash = (value: string) => Buffer.from(value.repeat(64).slice(0, 64)).toString("hex").slice(0, 64);

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
    expect(() => decodeManagedRepositoryArgv(Buffer.from(JSON.stringify(["status"])).toString("base64url")))
      .toThrow("Repository wrapper rejected the command");
    expect(() => decodeManagedBuildArgv(Buffer.from(JSON.stringify(["run", "test", "--watch"])).toString("base64url")))
      .toThrow("Build wrapper rejected the command");
    expect(() => managedCommand("repository", ["status"])).toThrow("Repository wrapper rejected the command");
    expect(() => managedCommand("build", ["exec", "arbitrary"])).toThrow("Build wrapper rejected the command");
  });

  it("admits only literal path operations and rejects executable Git forms", () => {
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
        argv: [join(dirname(fileURLToPath(import.meta.url)), "scripts", "production-restart.js")],
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
        readParentCandidates: () => { calls.push("read-parent"); return [parent]; },
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
        "worktree", "resolve-binding", "read-parent", "attest-parent", "prepare", "binding", "identity:old", "publish",
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

  it("orders replacement-first restart success through terminal idle before retiring the revalidated old process", async () => {
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
        persistEvidence: (entry) => { calls.push(`persist:${entry.phase}`); evidence.push(entry); },
      };

      const result = await managedReplacementFirstRestart([encodedRestart(request)], dependencies, worktree);

      expect(calls).toEqual([
        "binding", "identity:old", "publish", "persist:handoff_published", "launch", "identity:replacement",
        "persist:replacement_started", "health", "persist:replacement_healthy", "session", "persist:session_created",
        "memory-ack", "persist:typed_memory_acknowledged", "terminal-idle", "persist:terminal_idle_acknowledged",
        "binding", "identity:old", "identity:replacement", "persist:retirement_committed", "retire-old", "persist:old_parent_retired",
      ]);
      expect(evidence.at(-1)).toMatchObject({ phase: "old_parent_retired", oldParentRetired: true, replacementStopped: false });
      expect(result).toEqual({
        handoffSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        replacementIdentitySha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(JSON.stringify(evidence)).not.toContain("raw-session-id");
      expect(JSON.stringify(evidence)).not.toContain('"pid"');

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
    };
    expect(manifest.bin).toMatchObject({
      "ingenium-repository": "./dist/scripts/repository-command.js",
      "ingenium-build": "./dist/scripts/build-command.js",
    });
    expect(manifest.bin["ingenium-repository"]).not.toBe(manifest.bin["ingenium-build"]);

    expect(() => runManagedCommandCli("repository", ["node", "repository-command", Buffer.from(JSON.stringify(["status"])).toString("base64url")]))
      .toThrow("Repository wrapper rejected the command");
    expect(() => runManagedCommandCli("build", ["node", "build-command", Buffer.from(JSON.stringify(["exec", "arbitrary"])).toString("base64url")]))
      .toThrow("Build wrapper rejected the command");
  });
});

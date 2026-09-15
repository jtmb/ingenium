import { createHash } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The source-only build entrypoint runs directly in Node without declarations.
import { buildDistributions } from "./scripts/build-distributions.mjs";
// @ts-expect-error The existing build-time parity checker is a JavaScript module.
import { getMcpTransportParityPaths } from "./scripts/verify-mcp-transport-parity.mjs";
// @ts-expect-error The source-only artifact builder runs directly in Node without declarations.
import { buildRootArtifact } from "./scripts/build-root-artifact.mjs";
import {
  decodeManagedArgv,
  decodeManagedBuildArgv,
  decodeManagedRepositoryArgv,
  isExecutableGitConfiguration,
  isManagedDeploymentArgv,
  managedBuildEnvironment,
  managedBuildExecution,
  managedCommand,
  managedRecoveryBootstrapPath,
  managedRecoveryWorktree,
  MANAGED_RECOVERY_BOOTSTRAP_TIMEOUT_MS,
  openVerifiedRecoveryBootstrap,
  managedGitEnvironment,
  managedReplacementFirstRestart,
  managedRecoveryEnvironment,
  normalizeManagedRecoveryBootstrapMode,
  managedRepositoryArgv,
  runManagedRecoveryBootstrap,
  runManagedCommandCli,
  runRepositoryRetirement,
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
import type { McpToolClient } from "./mcp-client.js";
import {
  commitManagedRecoveryReplacement,
  parseLegacyRecoveryOwnerPayload,
  prepareManagedRecoveryReplacement,
  readLegacyRecoveryHandoff,
  readManagedRecoveryEnrollment,
  readRecoveryServerAuthentication,
  reconcileManagedRecoveryReplacement,
  recordManagedRecoveryAttachEvent,
  recoveryServerAuthenticationPath,
  stopTimedOutLegacyRecoveryOwner,
} from "./tui-recovery.js";
import {
  appendProductionRestartCandidateRejection,
  appendProductionRestartEvidence,
  commitProductionRetirement,
  hardenLegacyProductionCredentialPermissions,
  inspectExpectedProcessIdentity,
  openCodeJsonRequest,
  parseListeningLoopbackPorts,
  parseAdmittedRecoveryContext,
  parseProductionSessionExport,
  persistClaimedLegacyHandoff,
  publishRestartHandoff,
  probeReplacementHealthGate,
  productionRestartCanonicalWorktree,
  productionRestartDependencies,
  PRODUCTION_RESTART_AUTHORIZED_OVERFLOW_KEY,
  readPrivateProductionRestartFile,
  redactedHandoffFromExport,
  restartHandoffEvidence,
  restartHandoffMemoryEntry,
  runProductionRestartCli,
  runProductionRestartAdapter,
  typedMemoryAcknowledgementEvidence,
  type ProductionRestartAdapterDependencies,
  type AdmittedRecoveryContext,
  type ProductionRestartBinding,
  type ProductionRestartParentCandidate,
} from "./scripts/production-restart.js";
const {
  RECOVERY_BOOTSTRAP_CHECK_TIMEOUT_MS,
  RECOVERY_BOOTSTRAP_CHECKS,
  RECOVERY_BOOTSTRAP_MAX_RUNTIME_MS,
  RECOVERY_BOOTSTRAP_RESTART_TIMEOUT_MS,
  RecoveryBootstrapTimeoutError,
  recoveryBootstrapCheckEnvironment,
  recoveryBootstrapCanonicalWorktree,
  recoveryBootstrapRestartEnvironment,
  normalizeGeneratedRecoveryExecutable,
  runRecoveryBootstrap,
  verifyRecoveryBootstrapInvocation,
} = await vi.importActual<Record<string, any>>("./scripts/recovery-bootstrap.ts");

const hash = (value: string) => Buffer.from(value.repeat(64).slice(0, 64)).toString("hex").slice(0, 64);
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const canonicalTestJson = (value: unknown): string => JSON.stringify(value, (_key, entry) =>
  entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]))
    : entry);
const mcpResult = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const recoverySource = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "tui-recovery.ts")).href;
const coordinationOutboxSource = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "coordination-outbox.ts")).href;
const tsxLoader = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "../../node_modules/tsx/dist/loader.mjs")).href;
const repositoryRoot = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "../.."));
const recoveryBootstrapSource = join(dirname(fileURLToPath(import.meta.url)), "scripts", "recovery-bootstrap.ts");
const recoveryBootstrapShim = join(dirname(fileURLToPath(import.meta.url)), "scripts", "recovery-bootstrap.js");
const productionRestartSource = join(dirname(fileURLToPath(import.meta.url)), "scripts", "production-restart.ts");
const importModule = (url: string): Promise<any> => import(/* @vite-ignore */ url);

describe("repository_retirement", () => {
  const encoded = (argv: string[]) => Buffer.from(JSON.stringify(argv)).toString("base64url");
  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-retirement-test-"));
    const root = join(directory, "repository");
    const temporaryDirectory = join(directory, "temporary");
    const candidates = [
      { source: join(root, ".opencode/protected-runtime-index"), archive: join(temporaryDirectory, "ingenium-retired-protected-runtime-index"), id: "protected-runtime-index", head: "1cd90d4998e4f8fffa4ab11941f2b4821b336847" },
      { source: join(temporaryDirectory, "ingenium-deploy-6991061"), archive: join(temporaryDirectory, "ingenium-retired-deploy-6991061"), id: "ingenium-deploy-6991061", head: "6991061533e0830b4dccb6a9987eece6448e6e10" },
    ];
    for (const candidate of candidates) {
      const registration = join(root, ".git/worktrees", candidate.id);
      mkdirSync(registration, { recursive: true });
      mkdirSync(candidate.source, { recursive: true, mode: 0o700 });
      writeFileSync(join(registration, "HEAD"), `${candidate.head}\n`);
      writeFileSync(join(registration, "commondir"), "../..\n");
      writeFileSync(join(registration, "gitdir"), `${candidate.source}/.git\n`);
      writeFileSync(join(candidate.source, ".git"), `gitdir: ${registration}\n`);
      writeFileSync(join(candidate.source, "obsolete-source.ts"), "retained source");
    }
    const data = join(candidates[0]!.source, "coordination-outbox");
    mkdirSync(data);
    writeFileSync(join(data, "record.json"), '{"operational":"retained"}');
    let failMove = 0;
    let failAfterMove = 0;
    let missingObject = false;
    let moves = 0;
    const runner = vi.fn((_command: string, args: readonly string[]) => {
      if (args[6] === "rev-parse") return { status: missingObject ? 1 : 0, stdout: args[8]!.split("^")[0], stderr: "" };
      expect(args.slice(6, 9)).toEqual(["worktree", "move", "--"]);
      if (++moves === failMove) return { status: 1, stdout: "", stderr: "injected later move failure" };
      const [from, to] = args.slice(-2) as [string, string];
      expect(from.startsWith(directory + "/") && to.startsWith(directory + "/")).toBe(true);
      const registration = readFileSync(join(from, ".git"), "utf8").trim().slice("gitdir: ".length);
      renameSync(from, to);
      writeFileSync(join(registration, "gitdir"), `${to}/.git\n`);
      if (moves === failAfterMove) return { status: 1, stdout: "", stderr: "injected failure after relocation" };
      return { status: 0, stdout: "", stderr: "" };
    });
    return {
      root, candidates, runner,
      failOnMove: (number: number) => { failMove = number; },
      failAfterMove: (number: number) => { failAfterMove = number; },
      missingObject: () => { missingObject = true; },
      run: (operation: string) => runRepositoryRetirement([operation], root, { temporaryDirectory, runner: runner as any }),
      cleanup: () => rmSync(directory, { recursive: true, force: true }),
    };
  }

  it("admits only exact zero-argument retirement payloads through the CLI", () => {
    expect(encoded(["retirement-status"])).toBe("WyJyZXRpcmVtZW50LXN0YXR1cyJd");
    const runCommand = vi.fn(() => 0);
    for (const operation of ["retirement-status", "archive", "restore-archive"]) {
      expect(decodeManagedRepositoryArgv(encoded([operation]))).toEqual([operation]);
      runManagedCommandCli("repository", ["node", "wrapper", encoded([operation])], { runCommand });
      expect(runCommand).toHaveBeenLastCalledWith("repository", [operation]);
      expect(() => decodeManagedRepositoryArgv(encoded([operation, "extra"]))).toThrow();
      expect(() => managedRepositoryArgv([operation])).toThrow("fixed repository transaction");
    }
    for (const args of [["worktree", "move", "/tmp/arbitrary", "/tmp/archive"], ["archive", ".opencode/protected-runtime-index"], ["restore-archive", "--force"]]) {
      expect(() => decodeManagedRepositoryArgv(encoded(args))).toThrow();
    }
  });

  it("archives and explicitly restores in reverse order, preserving record hashes and source bytes", () => {
    const f = fixture();
    try {
      const original = f.run("retirement-status");
      expect(original.map((entry) => entry.state)).toEqual(["original", "original"]);
      expect(f.runner).not.toHaveBeenCalled();
      const archived = f.run("archive");
      expect(archived.map((entry) => entry.state)).toEqual(["archived", "archived"]);
      expect(archived.map((entry) => entry.records)).toEqual(original.map((entry) => entry.records));
      expect(readFileSync(join(f.candidates[0]!.source, "coordination-outbox/record.json"), "utf8")).toContain("retained");
      expect(readFileSync(join(f.candidates[0]!.archive, "obsolete-source.ts"), "utf8")).toBe("retained source");
      expect(f.run("retirement-status")).toEqual(archived);
      expect(f.run("restore-archive")).toEqual(original);
      expect(f.runner.mock.calls.filter((call) => call[1][6] === "worktree").map((call) => call[1].slice(-2))).toEqual([
        [f.candidates[0]!.source, f.candidates[0]!.archive], [f.candidates[1]!.source, f.candidates[1]!.archive],
        [f.candidates[1]!.archive, f.candidates[1]!.source], [f.candidates[0]!.archive, f.candidates[0]!.source],
      ]);
    } finally { f.cleanup(); }
  });

  it.each(["wrong-head", "missing-head", "wrong-link", "missing-link", "locked", "record-lock", "symlink"])("fails closed before any move for %s", (failure) => {
    const f = fixture();
    try {
      const registration = join(f.root, ".git/worktrees", f.candidates[1]!.id);
      if (failure === "wrong-head") writeFileSync(join(registration, "HEAD"), "0".repeat(40));
      if (failure === "missing-head") unlinkSync(join(registration, "HEAD"));
      if (failure === "wrong-link") writeFileSync(join(registration, "gitdir"), "/tmp/wrong/.git");
      if (failure === "missing-link") unlinkSync(join(f.candidates[1]!.source, ".git"));
      if (failure === "locked") writeFileSync(join(registration, "locked"), "locked");
      if (failure === "record-lock") writeFileSync(join(f.candidates[0]!.source, "coordination-outbox-mutation.lock"), "locked");
      if (failure === "symlink") {
        unlinkSync(join(registration, "HEAD"));
        symlinkSync(join(f.root, ".git/worktrees", f.candidates[0]!.id, "HEAD"), join(registration, "HEAD"));
      }
      expect(() => f.run("archive")).toThrow();
      expect(f.runner).not.toHaveBeenCalled();
      expect(existsSync(f.candidates[0]!.archive)).toBe(false);
    } finally { f.cleanup(); }
  });

  it("rolls back a later archive move failure and reports partial states without mutation", () => {
    const f = fixture();
    try {
      const original = f.run("retirement-status");
      f.failOnMove(2);
      expect(() => f.run("archive")).toThrow("moves restored");
      expect(f.run("retirement-status")).toEqual(original);
      expect(f.runner.mock.calls.at(-1)![1].slice(-2)).toEqual([f.candidates[0]!.archive, f.candidates[0]!.source]);
      mkdirSync(f.candidates[1]!.archive);
      expect(f.run("retirement-status").map((entry) => entry.state)).toEqual(["original", "partial"]);
      const calls = f.runner.mock.calls.length;
      expect(() => f.run("archive")).toThrow();
      expect(() => f.run("restore-archive")).toThrow();
      expect(f.runner).toHaveBeenCalledTimes(calls);
    } finally { f.cleanup(); }
  });

  it("rolls back a later restore move failure with the same verification", () => {
    const f = fixture();
    try {
      const archived = f.run("archive");
      f.failOnMove(4);
      expect(() => f.run("restore-archive")).toThrow("moves restored");
      expect(f.run("retirement-status")).toEqual(archived);
      writeFileSync(join(f.root, ".git/worktrees", f.candidates[0]!.id, "HEAD"), "0".repeat(40));
      const calls = f.runner.mock.calls.length;
      expect(() => f.run("restore-archive")).toThrow();
      expect(f.runner).toHaveBeenCalledTimes(calls);
    } finally { f.cleanup(); }
  });

  it("rejects missing commit objects and recovers a move that reports failure after relocation", () => {
    const f = fixture();
    try {
      const original = f.run("retirement-status");
      f.failAfterMove(2);
      expect(() => f.run("archive")).toThrow("moves restored");
      expect(f.run("retirement-status")).toEqual(original);
      expect(f.runner.mock.calls.filter((call) => call[1][6] === "worktree").slice(-2).map((call) => call[1].slice(-2)))
        .toEqual([[f.candidates[1]!.archive, f.candidates[1]!.source], [f.candidates[0]!.archive, f.candidates[0]!.source]]);
      f.missingObject();
      const calls = f.runner.mock.calls.filter((call) => call[1][6] === "worktree").length;
      expect(() => f.run("archive")).toThrow();
      expect(f.runner.mock.calls.filter((call) => call[1][6] === "worktree")).toHaveLength(calls);
    } finally { f.cleanup(); }
  });

  it("reports bounded hashes and lock state without emitting record contents or malformed HEAD text", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.root, ".git/worktrees", f.candidates[0]!.id, "HEAD"), "not-a-head-private-text");
      writeFileSync(join(f.root, ".git/ingenium-retirement.lock"), "private-lock-owner");
      const status = f.run("retirement-status");
      expect(status[0]).toMatchObject({ state: "partial", head: null, locked: true, records: { valid: true, count: 2 } });
      expect(status[0]!.records.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(status)).not.toMatch(/operational|retained|private/);
      expect(() => f.run("archive")).toThrow();
      expect(readFileSync(join(f.root, ".git/ingenium-retirement.lock"), "utf8")).toBe("private-lock-owner");
      expect(f.runner).not.toHaveBeenCalled();
    } finally { f.cleanup(); }
  });
});

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

function twoPassRecoveryPreflight(worktree: string): Record<string, unknown> {
  const parentNonce = "n".repeat(43);
  return {
    schemaVersion: 1,
    action: "production-restart",
    admissible: true,
    failures: [],
    source: { status: "validated", sha256: sha256("outer-bootstrap") },
    ancestry: { status: "exact", members: [] },
    parent: {
      pid: 4242,
      startTimeTicks: 100,
      executableSha256: sha256(readFileSync(realpathSync(process.execPath))),
      cwd: worktree,
      cmdlineSha256: sha256("opencode-session"),
      sessionId: "session-exact",
      dataHome: join(worktree, "data-home"),
      port: 4098,
      nonceSha256: sha256(parentNonce),
    },
    nonceEnrollment: { classification: "enrolled" },
    binding: {
      project: "ingenium",
      projectId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "workspace-exact",
      storageMappingHash: sha256("storage"),
      worktree,
    },
    git: { status: "validated", head: "a".repeat(40), dirtyPaths: ["scoped-change.ts"], sourceMatchesHead: true },
    recovery: {
      status: "validated",
      state: { phase: "enrolled", fence: 2, generation: 2, activeParent: true, replacement: false, sha256: sha256("state") },
      handoff: {
        status: "working",
        taskHash: sha256("task"),
        actionCount: 1,
        changedPathCount: 1,
        checkCount: 1,
        todos: { total: 1, pending: 0, inProgress: 1, completed: 0, cancelled: 0, state: "in_progress" },
        nextWork: { kind: "continue_task", referenceHash: sha256("task") },
        sha256: sha256("handoff"),
      },
    },
    outbox: { status: "validated", count: 0, ambiguousCount: 0, sha256: sha256(""), quarantine: null },
    disposition: { status: "missing", count: 0, ambiguousCount: 0, sha256: null },
    freeze: { status: "clear", sha256: null },
    deployed: {
      ociRevision: { status: "attested", revision: "b".repeat(40) },
      apiHealth: { status: "healthy", httpStatus: 200 },
    },
  };
}

function twoPassRecoveryAdmission(preflight: Record<string, any>, digest: string, _now: number): Record<string, unknown> {
  return {
    incarnation: 1,
    admission: {
      schema: "ingenium.recovery-admission",
      version: 1,
      action: "production-restart",
      preflightDigest: digest,
      head: preflight.git.head,
      parent: {
        pid: preflight.parent.pid,
        start: String(preflight.parent.startTimeTicks),
        executable: realpathSync(process.execPath),
        nonce: "n".repeat(43),
        session: preflight.parent.sessionId,
      },
      project: preflight.binding.project,
      projectId: preflight.binding.projectId,
      worktreeId: `worktree-${sha256(`${preflight.binding.workspaceId}\0${preflight.binding.storageMappingHash}`)}`,
      workspace: preflight.binding.workspaceId,
      storage: preflight.binding.storageMappingHash,
      worktree: preflight.binding.worktree,
      issuedAt: new Date(_now - 1_000).toISOString(),
      expiresAt: new Date(_now + 60_000).toISOString(),
      revision: 7,
      fence: 2,
    },
    consumeToken: "t".repeat(43),
  };
}

function fakeRecoverySourceHandle(preflight: Record<string, any>) {
  const source = Object.freeze({
    head: preflight.git.head,
    bytes: Buffer.from("outer-bootstrap"),
    path: recoveryBootstrapShim,
    sha256: preflight.source.sha256,
  });
  return { source, revalidate: vi.fn(() => source), close: vi.fn() };
}

function expectedAdmittedRecoveryContext(preflight: Record<string, any>, digest: string) {
  return Object.freeze({
    schemaVersion: 1,
    action: "production-restart",
    preflightDigest: digest,
    head: preflight.git.head,
    parent: Object.freeze({
      pid: preflight.parent.pid,
      startTimeTicks: preflight.parent.startTimeTicks,
      executableSha256: preflight.parent.executableSha256,
      nonceSha256: preflight.parent.nonceSha256,
      sessionId: preflight.parent.sessionId,
    }),
    binding: Object.freeze({ ...preflight.binding }),
    outboxQuarantine: preflight.outbox?.quarantine ?? null,
  });
}

function recoveryAdmissionReceipt(admission: Record<string, any>, overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    schema: "ingenium.recovery-admission-receipt",
    version: 1,
    action: "production-restart",
    admissionDigest: sha256(canonicalTestJson(admission.admission)),
    consumedAt: "2026-09-05T12:00:01.000Z",
    ...overrides,
  };
}

function admittedRecoveryContext(
  preflight: Record<string, any>,
  digest: string,
  receipt = recoveryAdmissionReceipt(twoPassRecoveryAdmission(preflight, digest, Date.parse("2026-09-05T12:00:00.000Z"))),
): AdmittedRecoveryContext {
  return Object.freeze({
    ...expectedAdmittedRecoveryContext(preflight, digest),
    receipt: Object.freeze(receipt),
  }) as AdmittedRecoveryContext;
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
    replay: { sessionIdSha256: sha256("recovery-session"), todos: [
      { id: "TODO-1", content: "Verify recovery", status: "pending", priority: "high" },
      { id: "TODO-2", content: "Implement recovery", status: "in_progress", priority: "high" },
      { id: "TODO-3", content: "Inspect recovery", status: "completed", priority: "medium" },
    ] },
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

function recoveryPayload(worktree: string, parent: RestartProcessIdentity & { port: number | null; dataHome: string }): Record<string, unknown> {
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
      replay: { sessionIdSha256: sha256("ses_admitted_parent"), todos: [
        { id: "TODO-1", content: "Verify restart", status: "pending", priority: "high" },
        { id: "TODO-2", content: "Implement restart", status: "in_progress", priority: "high" },
      ] },
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

function writeIdentitylessOverflow(outbox: CoordinationOutbox, key: string, count = 1): Buffer {
  const seed = outbox.put({
    exactKey: `overflow-seed-${key}`,
    kind: "claim",
    sessionHash: sha256("legacy-session"),
    failure: "unavailable",
  });
  unlinkSync(join(outbox.directory, `${seed.key}.json`));
  const serialized = Buffer.from(`${JSON.stringify({
    ...seed,
    key,
    operationId: sha256(`operation\0${key}`),
    kind: "overflow",
    sessionHash: "0".repeat(64),
    ambiguous: true,
    count,
    mutation: null,
  })}\n`);
  writeFileSync(join(outbox.directory, `${key}.json`), serialized, { mode: 0o600 });
  return serialized;
}

describe("isolated_root_build", () => {
  const outputs = [
    "packages/ingenium-core/dist/lib/index.js", "packages/ingenium-email/dist/index.js",
    "packages/ingenium-extension/dist/scripts/mcp-server.js", "services/ingenium-api/dist/scripts/api-server.js",
    "services/ingenium-server/dist/scripts/mcp-server.js", "services/ingenium-dashboard/.next/BUILD_ID",
  ];
  function fixture(fail = false) {
    const root = mkdtempSync(join(tmpdir(), "ingenium-root-artifact-"));
    const workspaces = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")).workspaces as string[];
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true, mode: 0o700 });
      writeFileSync(join(root, path), text);
    };
    const lock: Record<string, any> = { "": { workspaces } };
    write("package.json", JSON.stringify({ private: true, workspaces }));
    for (const [index, workspace] of workspaces.entries()) {
      const name = index === 2 ? "@ingenium/extension" : workspace.split("/")[1]!;
      const output = outputs[index]!.slice(workspace.length + 1);
      const manifest = { name, version: "1.0.0", type: "module", main: output, scripts: { build: "node fixture-build.mjs" } };
      write(`${workspace}/package.json`, JSON.stringify(manifest));
      lock[workspace] = { version: manifest.version };
      lock[`node_modules/${name}`] = { resolved: workspace, link: true };
      mkdirSync(dirname(join(root, "node_modules", name)), { recursive: true, mode: 0o700 });
      symlinkSync(join(root, workspace), join(root, "node_modules", name));
      write(outputs[index]!, "canonical-output");
      write(`${workspace}/fixture-build.mjs`, `
        import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
        import { dirname, resolve } from 'node:path';
        import { createRequire } from 'node:module';
        const output = ${JSON.stringify(output)};
        ${index > 0 ? `const core = createRequire(import.meta.url).resolve('ingenium-core');
        if (realpathSync(core) !== resolve('../../packages/ingenium-core/dist/lib/index.js')) throw new Error('foreign workspace resolution');` : ""}
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, 'candidate-output');
        ${fail && index === 3 ? "process.exit(7);" : ""}
      `);
    }
    write("node_modules/fixture-dependency/package.json", JSON.stringify({ name: "fixture-dependency", version: "1.0.0" }));
    write("node_modules/fixture-dependency/index.js", "module.exports = 'installed';");
    lock["node_modules/fixture-dependency"] = { version: "1.0.0" };
    write("package-lock.json", JSON.stringify({ lockfileVersion: 3, packages: lock }));
    write(".env", "secret-sentinel");
    write(".git/refs/stash", "obsolete-source");
    write(".opencode/protected-runtime-index/coordination-outbox/record.json", "runtime-sentinel");
    write("packages/ingenium-core/.env.local", "nested-secret-sentinel");
    write("packages/ingenium-core/dirty-source.ts", "export const current = 'dirty-source';");
    write("services/ingenium-dashboard/src/app/secrets/page.tsx", "export default function Secrets() { return null; }");
    const assertCanonical = () => {
      for (const output of outputs) expect(readFileSync(join(root, output), "utf8")).toBe("canonical-output");
      expect(readFileSync(join(root, ".opencode/protected-runtime-index/coordination-outbox/record.json"), "utf8")).toBe("runtime-sentinel");
      expect(readFileSync(join(root, "node_modules/fixture-dependency/index.js"), "utf8")).toContain("installed");
    };
    return { root, write, assertCanonical };
  }

  it("builds all six candidate workspaces with candidate dependency resolution and unchanged canonical outputs", () => {
    const f = fixture();
    try {
      const result = buildRootArtifact({ repositoryRoot: f.root });
      f.assertCanonical();
      for (const output of outputs) expect(readFileSync(join(result.candidate, output), "utf8")).toBe("candidate-output");
      for (const excluded of [".git", ".env", ".opencode/protected-runtime-index", "packages/ingenium-core/.env.local", "build"]) {
        expect(existsSync(join(result.candidate, excluded))).toBe(false);
      }
      expect(readFileSync(join(result.candidate, "packages/ingenium-core/dirty-source.ts"), "utf8")).toContain("dirty-source");
      expect(readFileSync(join(result.candidate, "services/ingenium-dashboard/src/app/secrets/page.tsx"), "utf8")).toContain("Secrets");
      expect(lstatSync(join(result.candidate, "node_modules/fixture-dependency/index.js")).ino)
        .not.toBe(lstatSync(join(f.root, "node_modules/fixture-dependency/index.js")).ino);
      const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
      expect(manifest.status).toBe("complete");
      expect(Object.keys(manifest.outputs)).toEqual(outputs);
      expect(JSON.stringify(manifest)).not.toContain("secret-sentinel");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("retains a failed candidate without changing any canonical output", () => {
    const f = fixture(true);
    try {
      expect(() => buildRootArtifact({ repositoryRoot: f.root })).toThrow("Isolated workspace build failed");
      f.assertCanonical();
      const run = readdirSync(join(f.root, "build"))[0]!;
      expect(JSON.parse(readFileSync(join(f.root, "build", run, "manifest.json"), "utf8")).status).toBe("failed");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it.each(["missing", "mismatched"])("dependency_preparation installs only in the candidate for a %s host dependency", (condition) => {
    const f = fixture();
    try {
      if (condition === "missing") unlinkSync(join(f.root, "node_modules/fixture-dependency/package.json"));
      else f.write("node_modules/fixture-dependency/package.json", JSON.stringify({ version: "2.0.0" }));
      const installer = vi.fn((command: string, args: string[], options: any) => {
        expect(command).toBe(join(dirname(process.execPath), "npm"));
        expect(args).toEqual(["ci", "--prefer-offline", "--no-audit", "--no-fund", "--include=dev"]);
        expect(options.cwd).not.toBe(f.root);
        expect(options.env.HOME).toBe(join(options.cwd, ".home"));
        expect(options.env.npm_config_cache).toBe(join(options.cwd, ".cache/npm"));
        expect(options.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).toBe("1");
        expect(readFileSync(join(options.cwd, "packages/ingenium-core/dirty-source.ts"), "utf8")).toContain("dirty-source");
        const lock = JSON.parse(readFileSync(join(options.cwd, "package-lock.json"), "utf8"));
        for (const workspace of lock.packages[""].workspaces) {
          const name = JSON.parse(readFileSync(join(options.cwd, workspace, "package.json"), "utf8")).name;
          mkdirSync(dirname(join(options.cwd, "node_modules", name)), { recursive: true });
          symlinkSync(join(options.cwd, workspace), join(options.cwd, "node_modules", name));
        }
        mkdirSync(join(options.cwd, "node_modules/fixture-dependency"), { recursive: true });
        writeFileSync(join(options.cwd, "node_modules/fixture-dependency/package.json"), JSON.stringify({ version: "1.0.0" }));
        f.assertCanonical();
        return { status: 0 };
      });
      const result = buildRootArtifact({ repositoryRoot: f.root, installer });
      expect(installer).toHaveBeenCalledOnce();
      expect(readFileSync(join(result.candidate, "package-lock.json"))).toEqual(readFileSync(join(f.root, "package-lock.json")));
      expect(JSON.parse(readFileSync(result.manifestPath, "utf8")).dependencyPreparation).toBe("npm-ci");
      if (condition === "missing") expect(existsSync(join(f.root, "node_modules/fixture-dependency/package.json"))).toBe(false);
      else expect(JSON.parse(readFileSync(join(f.root, "node_modules/fixture-dependency/package.json"), "utf8")).version).toBe("2.0.0");
      f.assertCanonical();
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("dependency_preparation retains an installation failure without starting the build", () => {
    const f = fixture();
    try {
      unlinkSync(join(f.root, "node_modules/fixture-dependency/package.json"));
      const runner = vi.fn();
      expect(() => buildRootArtifact({ repositoryRoot: f.root, installer: () => ({ status: 1 }), runner })).toThrow("Candidate dependency installation failed");
      expect(runner).not.toHaveBeenCalled();
      f.assertCanonical();
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("dependency_preparation uses only the existing public registry lock and no workspace install hooks", () => {
    const lock = JSON.parse(readFileSync(join(repositoryRoot, "package-lock.json"), "utf8"));
    for (const entry of Object.values(lock.packages) as any[]) {
      if (entry.link || !entry.resolved) continue;
      const url = new URL(entry.resolved);
      expect(url.origin).toBe("https://registry.npmjs.org");
      expect(url.username + url.password + url.search + url.hash).toBe("");
    }
    for (const workspace of ["", ...lock.packages[""].workspaces]) {
      const manifest = JSON.parse(readFileSync(join(repositoryRoot, workspace, "package.json"), "utf8"));
      for (const hook of ["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare"]) {
        expect(manifest.scripts?.[hook]).toBeUndefined();
      }
    }
  });

  it("rejects an external dependency symlink without following or mutating it", () => {
    const f = fixture();
    const outside = mkdtempSync(join(tmpdir(), "ingenium-root-artifact-outside-"));
    try {
      writeFileSync(join(outside, "sentinel"), "untouched");
      symlinkSync(outside, join(f.root, "node_modules/foreign"));
      expect(() => buildRootArtifact({ repositoryRoot: f.root })).toThrow("Dependency link escapes");
      f.assertCanonical();
      expect(readFileSync(join(outside, "sentinel"), "utf8")).toBe("untouched");
    } finally {
      rmSync(f.root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("leaves canonical outputs intact when an owned artifact-builder child is terminated", async () => {
    const f = fixture();
    const moduleUrl = new URL("./scripts/build-root-artifact.mjs", import.meta.url).href;
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { buildRootArtifact } from ${JSON.stringify(moduleUrl)};
      buildRootArtifact({ repositoryRoot: ${JSON.stringify(f.root)}, runner: () => {
        process.send({ ready: true });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
        return { status: 1 };
      }});
    `], { cwd: f.root, env: { PATH: dirname(process.execPath) }, stdio: ["ignore", "ignore", "inherit", "ipc"] });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Artifact child readiness timed out")), 3000);
        child.once("message", () => { clearTimeout(timer); resolve(); });
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("exit", () => { clearTimeout(timer); reject(new Error("Artifact child exited before readiness")); });
      });
      child.kill("SIGKILL");
      await exited;
      f.assertCanonical();
      const run = readdirSync(join(f.root, "build"))[0]!;
      expect(JSON.parse(readFileSync(join(f.root, "build", run, "manifest.json"), "utf8")).status).toBe("building");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});

describe("staged_distribution_build", () => {
  it("creates owner-only candidates before compilation for subsequent workspace builds", () => {
    const f = fixture();
    try {
      const compile = (root: string, packageRoot: string, output: string) => {
        expect(lstatSync(output).mode & 0o777).toBe(0o700);
        f.compile(root, packageRoot, output);
      };
      const result = buildDistributions({ repositoryRoot: f.root, compile, parity: () => {} });
      for (const stage of result.stages) expect(lstatSync(stage.active).mode & 0o777).toBe(0o700);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("packaged_logger_runtime_dependency is declared without relying on workspace hoisting", () => {
    const extension = JSON.parse(readFileSync(join(repositoryRoot, "packages/ingenium-extension/package.json"), "utf8"));
    const server = JSON.parse(readFileSync(join(repositoryRoot, "services/ingenium-server/package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(join(repositoryRoot, "package-lock.json"), "utf8"));
    const installed = JSON.parse(readFileSync(join(repositoryRoot, "node_modules/pino/package.json"), "utf8"));

    expect(readFileSync(join(repositoryRoot, "services/ingenium-server/lib/logger.ts"), "utf8")).toContain('import pino from "pino"');
    expect(server.dependencies.pino).toBe("^9.0.0");
    expect(extension.dependencies.pino).toBe(server.dependencies.pino);
    expect(lock.packages["packages/ingenium-extension"].dependencies.pino).toBe(extension.dependencies.pino);
    expect(lock.packages["node_modules/pino"].version).toBe(installed.version);
    expect(lock.packages["node_modules/pino"].version).toMatch(/^9\./);
    expect(lock.packages["node_modules/pino"].dev).not.toBe(true);
  });

  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "ingenium-staged-distribution-"));
    const server = join(root, "services/ingenium-server");
    const extension = join(root, "packages/ingenium-extension");
    for (const directory of [server, extension]) {
      mkdirSync(join(directory, "dist"), { recursive: true, mode: 0o700 });
      writeFileSync(join(directory, "dist/previous.txt"), directory);
    }
    const assertPrevious = () => {
      for (const directory of [server, extension]) expect(readFileSync(join(directory, "dist/previous.txt"), "utf8")).toBe(directory);
    };
    const compile = (_root: string, packageRoot: string, output: string) => {
      assertPrevious();
      const paths = packageRoot === server ? ["config/index.js", "lib/client.js", "scripts/mcp-server.js"] : [
        "index.js", "index.d.ts",
        ...["mcp-server", "init-project", "managed-command-wrapper", "recovery-bootstrap", "repository-command",
          "build-command", "coordination-reset", "production-restart", "opencode", "recovery-owner"].map((name) => `scripts/${name}.js`),
        ...["auto-observer", "observer", "resource-sync", "session-coordinator"].map((name) => `plugins/${name}.js`),
      ];
      for (const path of paths) {
        mkdirSync(dirname(join(output, path)), { recursive: true });
        writeFileSync(join(output, path), `export {}; // ${packageRoot}`);
      }
    };
    return { root, server, extension, compile, assertPrevious };
  }

  it("validates the staged pair before adopting and retains both previous distributions", () => {
    const f = fixture();
    try {
      const parity = vi.fn((root: string, candidate: string) => {
        f.assertPrevious();
        expect(getMcpTransportParityPaths(root, candidate).packagedTransport).toBe(join(candidate, "scripts/mcp-transport.js"));
        expect(readFileSync(join(candidate, "scripts/mcp-transport.js"), "utf8")).toContain(f.server);
      });
      const result = buildDistributions({ repositoryRoot: f.root, compile: f.compile, parity });
      expect(parity).toHaveBeenCalledOnce();
      expect(JSON.parse(readFileSync(result.journal, "utf8")).phase).toBe("adopted");
      for (const stage of result.stages) {
        expect(readFileSync(join(stage.previous, "previous.txt"), "utf8")).toBe(stage.packageRoot);
        expect(existsSync(join(stage.active, "previous.txt"))).toBe(false);
        expect(stage.candidateManifest["scripts/mcp-server.js"].sha256).toMatch(/^[a-f0-9]{64}$/);
      }
      expect(lstatSync(join(f.extension, "dist/scripts/build-command.js")).mode & 0o777).toBe(0o555);
      for (const script of ["recovery-bootstrap", "production-restart"]) {
        expect(lstatSync(join(f.extension, `dist/scripts/${script}.js`)).mode & 0o777).toBe(0o555);
      }
      expect(existsSync(join(f.extension, "build/distribution-build.lock"))).toBe(false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it.each(["compile", "artifacts", "parity"])("preserves both active distributions when %s fails", (failure) => {
    const f = fixture();
    try {
      const compile = (root: string, packageRoot: string, output: string) => {
        if (packageRoot === f.extension && failure === "compile") throw new Error("compile failure");
        f.compile(root, packageRoot, output);
        if (packageRoot === f.extension && failure === "artifacts") unlinkSync(join(output, "scripts/build-command.js"));
      };
      expect(() => buildDistributions({ repositoryRoot: f.root, compile, parity: () => { throw new Error("parity failure"); } })).toThrow();
      f.assertPrevious();
      expect(existsSync(join(f.extension, "build/distribution-build.lock"))).toBe(false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("rolls back both distributions if the second candidate cannot be adopted", () => {
    const f = fixture();
    try {
      const rename = (from: string, to: string) => {
        if (from.endsWith("/candidate") && to === join(f.extension, "dist")) throw new Error("adoption failure");
        renameSync(from, to);
      };
      expect(() => buildDistributions({ repositoryRoot: f.root, compile: f.compile, parity: () => {}, rename })).toThrow("adoption failure");
      f.assertPrevious();
      expect(existsSync(join(f.extension, "build/distribution-build.lock"))).toBe(false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("refuses an existing build lock without compiling or replacing outputs", () => {
    const f = fixture();
    try {
      mkdirSync(join(f.extension, "build/distribution-build.lock"), { recursive: true, mode: 0o700 });
      const compile = vi.fn();
      expect(() => buildDistributions({ repositoryRoot: f.root, compile })).toThrow();
      expect(compile).not.toHaveBeenCalled();
      f.assertPrevious();
      expect(existsSync(join(f.extension, "build/distribution-build.lock"))).toBe(true);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("supports server-only packaging without changing the extension distribution", () => {
    const f = fixture();
    try {
      const parity = vi.fn();
      const result = buildDistributions({ repositoryRoot: f.root, serverOnly: true, compile: f.compile, parity });
      expect(result.stages).toHaveLength(1);
      expect(parity).not.toHaveBeenCalled();
      expect(readFileSync(join(f.extension, "dist/previous.txt"), "utf8")).toBe(f.extension);
      expect(existsSync(join(f.server, "dist/scripts/mcp-server.js"))).toBe(true);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});

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
      ]) expect(() => parseLegacyRecoveryOwnerPayload(encoded(invalid))).toThrow();

      const emptyHandoff = {
        replay: { sessionIdSha256: sha256("recovery-session"), todos: [] },
        status: "active",
        taskHash: null,
        actions: [],
        changedPaths: [],
        checks: [],
        todos: { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0, state: "none" },
        nextWork: { kind: "none", referenceHash: null },
      };
      expect(parseLegacyRecoveryOwnerPayload(encoded({ ...payload, handoff: emptyHandoff })).handoff).toEqual(emptyHandoff);

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
      expect(reconcileManagedRecoveryReplacement(worktree, transaction)).toBe("not_committed");
      commitManagedRecoveryReplacement(worktree, transaction);
      expect(reconcileManagedRecoveryReplacement(worktree, transaction)).toBe("committed");
      expect(reconcileManagedRecoveryReplacement(worktree, sha256("other-transaction"))).toBe("unknown");
      const adopted = await waitForRecoveryState(
        paths.state,
        (state) => state.phase === "enrolled" && state.activeParent?.pid === successor!.pid
          && !existsSync(join(dirname(paths.state), "mutation.lock"))
          && readManagedRecoveryEnrollment(worktree)?.parent.pid === successor!.pid,
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
    expect(decodeManagedBuildArgv(Buffer.from(JSON.stringify([
      "run", "test", "--workspace=packages/ingenium-extension", "--", "coordination-outbox.test.ts", "-t", "overflow",
    ])).toString("base64url"))).toEqual([
      "run", "test", "--workspace=packages/ingenium-extension", "--", "coordination-outbox.test.ts", "-t", "overflow",
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

  it.each(["session-id-tui.test.ts", "agent-validation.test.ts"])("admits focused extension test file %s", (file) => {
    const argv = ["run", "test", "--workspace=packages/ingenium-extension", "--", file, "-t", "focused"];
    expect(validateManagedBuildArgv(argv)).toEqual(argv);
  });

  it("rejects unknown focused extension test files", () => {
    expect(() => validateManagedBuildArgv([
      "run", "test", "--workspace=packages/ingenium-extension", "--", "other.test.ts", "-t", "focused",
    ])).toThrow("Build wrapper rejected the command");
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
    expect(managedBuildExecution(["deployment", "recovery-preflight"]))
      .toEqual({ command: process.execPath, argv: [recoveryBootstrapShim, "recovery-preflight"] });
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
    expect(managedRecoveryWorktree(sourceWrapper)).toBe(repositoryRoot);
    expect(managedRecoveryWorktree(builtWrapper)).toBe(repositoryRoot);
    expect(managedBuildExecution(["deployment", "production-restart"], sourceWrapper).argv)
      .toEqual([recoveryBootstrapShim]);
    expect(managedBuildExecution(["deployment", "production-restart"], builtWrapper).argv)
      .toEqual([recoveryBootstrapShim]);
    expect(managedRecoveryBootstrapPath(builtWrapper)).not.toBe(innerBootstrap);
  });

  it("routes exact recovery production restart to read-only shim discovery before managed normalization", () => {
    const sourceWrapper = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "scripts", "managed-command-wrapper.ts"));
    const runner = vi.fn((_command: string, _args: readonly string[], _options: {
      cwd: string;
      input: Buffer;
      stdio: readonly ["pipe", "inherit", "inherit"];
      shell: false;
      env: NodeJS.ProcessEnv;
    }) => ({ status: 0, signal: null, error: undefined }));
    const runRecoveryBootstrap = vi.fn(() => 0);
    const runCommand = vi.fn(() => { throw new Error("managed normalization reached"); });
    const priorExitCode = process.exitCode;
    const bytes = Buffer.from("reviewed recovery bootstrap");
    const descriptor = openSync("/dev/null", constants.O_RDONLY);
    const openBootstrap = vi.fn(() => ({
      descriptor,
      bytes,
      context: Object.freeze({
        schemaVersion: 1 as const,
        kind: "source-bootstrap" as const,
        sourcePath: recoveryBootstrapShim,
        repositoryRoot,
        head: "a".repeat(40),
        sourceSha256: sha256(bytes),
      }),
    }));
    try {
      expect(runManagedRecoveryBootstrap(sourceWrapper, { runner: runner as any, openBootstrap })).toBe(0);
      expect(runner).toHaveBeenCalledWith(process.execPath, ["--input-type=module"], expect.objectContaining({
        cwd: repositoryRoot,
        input: bytes,
        stdio: ["pipe", "inherit", "inherit"],
        shell: false,
      }));
      const runnerCall = runner.mock.calls[0];
      if (!runnerCall) throw new Error("recovery runner was not called");
      expect(runnerCall[2].env.INGENIUM_RECOVERY_ATTESTED_CONTEXT).toContain(sha256(bytes));
      expect(runnerCall[2]).not.toHaveProperty("timeout");

      runManagedCommandCli(
        "build",
        ["node", "build-command", "deployment", "production-restart"],
        { runRecoveryBootstrap, runCommand },
      );

      expect(runRecoveryBootstrap).toHaveBeenCalledOnce();
      expect(runCommand).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
      expect(() => runManagedCommandCli(
        "build",
        ["node", "build-command", "deployment", "production-restart", "extra"],
        { runRecoveryBootstrap, runCommand },
      )).toThrow("Managed wrapper requires one encoded argv payload");
      expect(runRecoveryBootstrap).toHaveBeenCalledOnce();
    } finally {
      process.exitCode = priorExitCode;
    }
  });

  it("admits only literal recovery preparation and dispatches attested stdin without a shell or inherited mode", () => {
    const runRecoveryBootstrap = vi.fn(() => 0);
    const runCommand = vi.fn(() => 0);
    const priorExitCode = process.exitCode;
    try {
      runManagedCommandCli("build", ["node", "build-command", "deployment", "recovery-prepare"], { runRecoveryBootstrap, runCommand });
      expect(runRecoveryBootstrap).toHaveBeenCalledWith(expect.any(String), { preparation: true });
      for (const args of [
        ["deployment", "recovery-prepare", "extra"], ["deployment", "recovery-prepare", "/tmp/payload"],
        ["deployment", "recovery-prepare;id"], ["deployment", "recovery-prepare\n"],
        ["deployment", "recovery-prepare", "--"], ["deployment", "--recovery-prepare"],
        [Buffer.from(JSON.stringify(["deployment", "recovery-prepare"])).toString("base64url")],
        ["node", recoveryBootstrapShim, "recovery-prepare"],
      ]) expect(() => runManagedCommandCli("build", ["node", "build-command", ...args], { runRecoveryBootstrap, runCommand })).toThrow();
      expect(runRecoveryBootstrap).toHaveBeenCalledOnce();
      expect(runCommand).not.toHaveBeenCalled();
      expect(() => decodeManagedBuildArgv(Buffer.from(JSON.stringify(["deployment", "recovery-prepare"])).toString("base64url"))).toThrow("exact literal");
      const descriptor = openSync("/dev/null", constants.O_RDONLY);
      const bytes = Buffer.from("reviewed preparation source");
      const runner = vi.fn(() => ({ status: 0, signal: null }));
      expect(runManagedRecoveryBootstrap(import.meta.url.replace("managed-command-wrapper.test.ts", "scripts/managed-command-wrapper.ts"), {
        preparation: true, runner: runner as any,
        openBootstrap: () => ({ descriptor, bytes, context: { schemaVersion: 1, kind: "source-bootstrap",
          sourcePath: recoveryBootstrapShim, repositoryRoot, head: "a".repeat(40), sourceSha256: sha256(bytes) } }),
      })).toBe(0);
      expect(runner).toHaveBeenCalledWith(process.execPath, ["--input-type=module"], expect.objectContaining({
        input: bytes, shell: false, env: expect.objectContaining({ INGENIUM_RECOVERY_PREPARATION: "1" }),
      }));
    } finally { process.exitCode = priorExitCode; }
  });

  it("admits only literal recovery preflight through attested stdin and rejects a standalone environment", () => {
    const runRecoveryBootstrap = vi.fn(() => 0);
    const runCommand = vi.fn(() => 0);
    const priorExitCode = process.exitCode;
    try {
      runManagedCommandCli("build", ["node", "build-command", "deployment", "recovery-preflight"], {
        runRecoveryBootstrap,
        runCommand,
      });
      expect(runRecoveryBootstrap).toHaveBeenCalledWith(expect.any(String), { preflight: true });
      for (const args of [
        ["deployment", "recovery-preflight", "extra"], ["deployment", "recovery-preflight", "/tmp/payload"],
        ["deployment", "recovery-preflight;id"], ["deployment", "recovery-preflight\n"],
        ["deployment", "recovery-preflight", "--"], ["deployment", "--recovery-preflight"],
        [Buffer.from(JSON.stringify(["deployment", "recovery-preflight"])).toString("base64url")],
        ["node", recoveryBootstrapShim, "recovery-preflight"],
      ]) expect(() => runManagedCommandCli("build", ["node", "build-command", ...args], {
        runRecoveryBootstrap,
        runCommand,
      })).toThrow();
      expect(runRecoveryBootstrap).toHaveBeenCalledOnce();
      expect(runCommand).not.toHaveBeenCalled();
      expect(() => decodeManagedBuildArgv(Buffer.from(JSON.stringify(["deployment", "recovery-preflight"])).toString("base64url")))
        .toThrow("exact literal");

      const descriptor = openSync("/dev/null", constants.O_RDONLY);
      const bytes = Buffer.from("reviewed preflight source");
      const runner = vi.fn((_command: string, _argv: readonly string[], _options: { env: NodeJS.ProcessEnv }) =>
        ({ status: 0, signal: null }));
      expect(runManagedRecoveryBootstrap(import.meta.url.replace("managed-command-wrapper.test.ts", "scripts/managed-command-wrapper.ts"), {
        preflight: true,
        runner: runner as any,
        openBootstrap: () => ({ descriptor, bytes, context: { schemaVersion: 1, kind: "source-bootstrap",
          sourcePath: recoveryBootstrapShim, repositoryRoot, head: "a".repeat(40), sourceSha256: sha256(bytes) } }),
      })).toBe(0);
      expect(runner).toHaveBeenCalledWith(process.execPath, ["--input-type=module"], expect.objectContaining({
        input: bytes,
        shell: false,
        env: expect.objectContaining({ INGENIUM_RECOVERY_PREFLIGHT: "1", INGENIUM_RECOVERY_ATTESTED_CONTEXT: expect.any(String) }),
      }));
      expect(runner.mock.calls[0]![2].env).not.toHaveProperty("INGENIUM_RECOVERY_PREPARATION");

      const rejectedDescriptor = openSync("/dev/null", constants.O_RDONLY);
      runner.mockReturnValueOnce({ status: 1, signal: null });
      expect(runManagedRecoveryBootstrap(import.meta.url.replace("managed-command-wrapper.test.ts", "scripts/managed-command-wrapper.ts"), {
        preflight: true,
        runner: runner as any,
        openBootstrap: () => ({ descriptor: rejectedDescriptor, bytes, context: { schemaVersion: 1, kind: "source-bootstrap",
          sourcePath: recoveryBootstrapShim, repositoryRoot, head: "a".repeat(40), sourceSha256: sha256(bytes) } }),
      })).toBe(1);

      runRecoveryBootstrap.mockReturnValueOnce(1);
      runManagedCommandCli("build", ["node", "build-command", "deployment", "recovery-preflight"], {
        runRecoveryBootstrap,
        runCommand,
      });
      expect(process.exitCode).toBe(1);

      const forged = JSON.stringify({ schemaVersion: 1, kind: "source-bootstrap", sourcePath: recoveryBootstrapShim,
        repositoryRoot, head: "a".repeat(40), sourceSha256: sha256(readFileSync(recoveryBootstrapShim)) });
      expect(() => execFileSync(process.execPath, [recoveryBootstrapShim], { env: {
        PATH: process.env.PATH,
        INGENIUM_RECOVERY_PREFLIGHT: "1",
        INGENIUM_RECOVERY_ATTESTED_CONTEXT: forged,
      } })).toThrow();
    } finally { process.exitCode = priorExitCode; }
  });

  it("attests exact Git bytes from a retained no-follow descriptor and rejects a pathname swap", () => {
    const root = mkdtempSync(join(tmpdir(), "ingenium-recovery-source-attestation-"));
    const scripts = join(root, "packages/ingenium-extension/scripts");
    const source = join(scripts, "recovery-bootstrap.js");
    const reviewed = Buffer.from("export const reviewed = true;\n");
    try {
      mkdirSync(scripts, { recursive: true });
      writeFileSync(source, reviewed, { mode: 0o644 });
      chmodSync(source, 0o644);
      execFileSync("/usr/bin/git", ["-C", root, "init", "--quiet"]);
      execFileSync("/usr/bin/git", ["-C", root, "add", "packages/ingenium-extension/scripts/recovery-bootstrap.js"]);
      execFileSync("/usr/bin/git", ["-C", root, "-c", "user.name=Ingenium Test", "-c", "user.email=test@invalid", "commit", "--quiet", "-m", "fixture"]);

      const verified = openVerifiedRecoveryBootstrap(source, root);
      try {
        expect(verified.bytes).toEqual(reviewed);
        expect(verified.context).toMatchObject({
          sourcePath: source,
          repositoryRoot: root,
          sourceSha256: sha256(reviewed),
        });
      } finally {
        closeSync(verified.descriptor);
      }

      chmodSync(source, 0o4644);
      expect(() => openVerifiedRecoveryBootstrap(source, root)).toThrow("not trusted");
      chmodSync(source, 0o644);

      expect(() => openVerifiedRecoveryBootstrap(source, root, () => {
        renameSync(source, `${source}.opened`);
        writeFileSync(source, reviewed, { mode: 0o644 });
        chmodSync(source, 0o644);
      })).toThrow("not trusted");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("two-pass recovery admission emits one exact canonical preflight and performs no first-pass mutation", async () => {
    const shim = await importModule(`${pathToFileURL(recoveryBootstrapShim).href}?test=${Date.now()}`);
    const preflight = twoPassRecoveryPreflight(repositoryRoot);
    const digest = sha256(canonicalTestJson(preflight));
    const writeOutput = vi.fn();
    const consumeAdmission = vi.fn();
    const executeAdmitted = vi.fn();

    const result = await shim.runRecoveryBootstrapShim(["node", recoveryBootstrapShim], {
      openSource: vi.fn(() => fakeRecoverySourceHandle(preflight)),
      collectPreflight: vi.fn(async () => preflight),
      admissionPath: join(repositoryRoot, "tests/artifacts/tui-recovery/production-restart-admission.json"),
      admissionExists: vi.fn(() => false),
      consumeAdmission,
      executeAdmitted,
      writeOutput,
    });

    expect(writeOutput).toHaveBeenCalledOnce();
    expect(writeOutput).toHaveBeenCalledWith(`${canonicalTestJson({ digest, preflight })}\n`);
    expect(result).toBe(0);
    expect(JSON.parse(writeOutput.mock.calls[0]![0])).toEqual({ digest, preflight });
    expect(writeOutput.mock.calls[0]![0]).not.toContain("restart-nonce");
    expect(writeOutput.mock.calls[0]![0]).not.toContain("password");
    expect(consumeAdmission).not.toHaveBeenCalled();
    expect(executeAdmitted).not.toHaveBeenCalled();

    const source = readFileSync(recoveryBootstrapShim, "utf8");
    expect(source).toContain("process.exitCode = await runRecoveryBootstrapShim(");
    const collector = source.slice(
      source.indexOf("export async function collectRecoveryPreflight"),
      source.indexOf("export function recoveryAdmissionPath"),
    );
    const firstPass = source.slice(
      source.indexOf("export async function runRecoveryBootstrapShim"),
      source.indexOf("(dependencies.consumeAdmission"),
    );
    for (const forbidden of [
      "mkdirSync(", "writeFileSync(", "fchmodSync(", "fsyncSync(", "runFixed(", "verifyScopedCheckpoint(",
      "normalizeTrustedRegularFileMode(", "hardenCanonicalRepositoryDirectories(", "privateNpmConfiguration(",
      "privateStagedBootstrap(", "process.kill(", "spawn(", "claim(", "restart(",
    ]) {
      expect(collector, forbidden).not.toContain(forbidden);
      expect(firstPass, forbidden).not.toContain(forbidden);
    }
  });

  it("two-pass recovery preflight fails closed without a corroborated binding", async () => {
    const shim = await importModule(`${pathToFileURL(recoveryBootstrapShim).href}?test=${Date.now()}`);
    const preflight = await shim.collectRecoveryPreflight({
      environment: {},
      sourcePath: recoveryBootstrapShim,
      verifiedSource: fakeRecoverySourceHandle(twoPassRecoveryPreflight(repositoryRoot)).source,
      request: vi.fn(),
    });
    const writeOutput = vi.fn();
    const executeAdmitted = vi.fn();

    const status = await shim.runRecoveryBootstrapShim(["node", recoveryBootstrapShim], {
      openSource: vi.fn(() => fakeRecoverySourceHandle(preflight)),
      collectPreflight: vi.fn(async () => preflight),
      admissionExists: vi.fn(() => false),
      executeAdmitted,
      writeOutput,
    });

    const emitted = JSON.parse(writeOutput.mock.calls[0]![0]);
    expect(status).toBe(1);
    expect(Buffer.byteLength(writeOutput.mock.calls[0]![0])).toBeLessThan(16 * 1024);
    expect(emitted.preflight).toMatchObject({
      admissible: false,
      source: {
        status: "validated",
        regularFile: true,
        ownerControlled: true,
        groupWorldWritable: false,
        mode: "0644",
        expectedMode: "0644",
      },
      binding: null,
      nonceEnrollment: { classification: "ambiguous" },
    });
    expect(emitted.preflight.failures).toEqual(expect.arrayContaining(["binding", "nonce_enrollment"]));
    expect(executeAdmitted).not.toHaveBeenCalled();
  });

  it("source-shim preflight rejects an unexpected mode without normalizing it", async () => {
    const shim = await importModule(`${pathToFileURL(recoveryBootstrapShim).href}?test=${Date.now()}`);
    const directory = mkdtempSync(join(tmpdir(), "ingenium-recovery-shim-mode-preflight-"));
    const source = join(directory, "recovery-bootstrap.js");
    try {
      copyFileSync(recoveryBootstrapShim, source);
      chmodSync(source, 0o674);

      const preflight = await shim.collectRecoveryPreflight({
        environment: {},
        sourcePath: source,
        request: vi.fn(),
      });
      const writeOutput = vi.fn();
      const executeAdmitted = vi.fn();

      const status = await shim.runRecoveryBootstrapShim(["node", recoveryBootstrapShim], {
        openSource: vi.fn(() => fakeRecoverySourceHandle(preflight)),
        collectPreflight: vi.fn(async () => preflight),
        executeAdmitted,
        writeOutput,
      });

      expect(preflight).toMatchObject({
        admissible: false,
        failures: expect.arrayContaining(["source", "git"]),
        source: {
          status: "invalid",
          expectedMode: "0644",
        },
      });
      expect(status).toBe(1);
      expect(writeOutput).toHaveBeenCalledOnce();
      expect(executeAdmitted).not.toHaveBeenCalled();
      expect(lstatSync(source).mode & 0o777).toBe(0o674);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("two-pass recovery digest excludes transient command descendants from parent ancestry", async () => {
    const shim = await importModule(`${pathToFileURL(recoveryBootstrapShim).href}?test=${Date.now()}`);
    const executableSha256 = sha256("opencode");
    const parent = { pid: 200, startTimeTicks: 20, executableSha256 };
    const stable = [
      { ...parent, parentPid: 100 },
      { pid: 100, parentPid: 1, startTimeTicks: 10, executableSha256: sha256("supervisor") },
    ];

    expect(shim.stableRecoveryAncestryMembers([
      { pid: 301, parentPid: 300, startTimeTicks: 31, executableSha256: sha256("second-invocation") },
      ...stable,
    ], parent)).toEqual(stable);
    expect(shim.stableRecoveryAncestryMembers([
      { pid: 401, parentPid: 400, startTimeTicks: 41, executableSha256: sha256("first-invocation") },
      ...stable,
    ], parent)).toEqual(stable);
  });

  it("two-pass recovery admission accepts only exact public binding plus an opaque consume token", async () => {
    const shim = await importModule(`${pathToFileURL(recoveryBootstrapShim).href}?test=${Date.now()}`);
    const directory = mkdtempSync(join(tmpdir(), "ingenium-two-pass-admission-reject-"));
    const worktree = realpathSync(directory);
    const path = join(directory, "admission.json");
    const target = join(directory, "target.json");
    const now = Date.parse("2026-09-05T12:00:00.000Z");
    const preflight = twoPassRecoveryPreflight(worktree);
    const digest = sha256(shim.canonicalJson(preflight));
    const writeAdmission = (value: unknown) => {
      writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
      chmodSync(path, 0o600);
    };
    try {
      const valid = twoPassRecoveryAdmission(preflight, digest, now);
      writeAdmission(valid);
      expect(shim.readRecoveryAdmission(path, preflight, digest, now)).toEqual(valid);
      expect(existsSync(path)).toBe(true);
      expect(lstatSync(path).mode & 0o777).toBe(0o600);
      rmSync(path);

      const expired = twoPassRecoveryAdmission(preflight, digest, now) as Record<string, any>;
      expired.admission.expiresAt = new Date(now - 1).toISOString();
      writeAdmission(expired);
      expect(() => shim.readRecoveryAdmission(path, preflight, digest, now)).toThrow("does not match");
      rmSync(path);

      const mismatched = twoPassRecoveryAdmission(preflight, digest, now) as Record<string, any>;
      mismatched.admission.head = "c".repeat(40);
      writeAdmission(mismatched);
      expect(() => shim.readRecoveryAdmission(path, preflight, digest, now)).toThrow("does not match");
      rmSync(path);

      writeAdmission({ ...twoPassRecoveryAdmission(preflight, digest, now), ownership_token: "secret" });
      expect(() => shim.readRecoveryAdmission(path, preflight, digest, now)).toThrow("does not match");
      rmSync(path);

      writeFileSync(target, `${JSON.stringify(twoPassRecoveryAdmission(preflight, digest, now))}\n`, { mode: 0o600 });
      symlinkSync(target, path);
      expect(() => shim.readRecoveryAdmission(path, preflight, digest, now)).toThrow("Recovery preflight file is unavailable");
      rmSync(path);

      writeFileSync(path, Buffer.alloc(16 * 1024 + 1, 0x61), { mode: 0o600 });
      expect(() => shim.readRecoveryAdmission(path, preflight, digest, now)).toThrow("Recovery preflight file is unavailable");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("server consumption is authenticated, token-secret, and fail-closed for replay expiry mismatch and API uncertainty", async () => {
    const shim = await importModule(`${pathToFileURL(recoveryBootstrapShim).href}?test=${Date.now()}`);
    const directory = mkdtempSync(join(tmpdir(), "ingenium-two-pass-admission-server-"));
    const worktree = realpathSync(directory);
    const credential = join(worktree, ".credential");
    const now = Date.parse("2026-09-05T12:00:00.000Z");
    const preflight = twoPassRecoveryPreflight(worktree);
    const digest = sha256(shim.canonicalJson(preflight));
    const admission = twoPassRecoveryAdmission(preflight, digest, now);
    const context = expectedAdmittedRecoveryContext(preflight, digest);
    const environment = {
      INGENIUM_API_URL: "http://127.0.0.1:4097/api/v1",
      INGENIUM_MCP_AUDIENCE: "mcp",
      INGENIUM_MCP_CREDENTIAL_FILE: credential,
      INGENIUM_PROJECT: "ingenium",
      INGENIUM_PROJECT_ID: "11111111-1111-4111-8111-111111111111",
      INGENIUM_WORKSPACE_ID: "workspace-exact",
      INGENIUM_STORAGE_MAPPING_HASH: sha256("storage"),
      INGENIUM_WORKTREE: worktree,
    };
    try {
      writeFileSync(credential, `${"k".repeat(48)}\n`, { mode: 0o600 });
      chmodSync(credential, 0o600);
      const receipt = recoveryAdmissionReceipt(admission as Record<string, any>);
      const request = vi.fn(async (_input: RequestInfo | URL, _options?: RequestInit) => ({
        status: 200,
        json: async () => ({ data: {
          session: { state: "closed", revision: 8 },
          receipt,
        } }),
      }));
      const consumed = await shim.consumeRecoveryAdmission(admission, context, { environment, request });
      expect(consumed.receipt).toEqual(receipt);
      expect(Object.isFrozen(consumed)).toBe(true);
      expect(Object.isFrozen(consumed.receipt)).toBe(true);
      const requestCall = request.mock.calls[0];
      if (!requestCall) throw new Error("recovery admission request was not made");
      const [, options] = requestCall;
      if (!options || typeof options.body !== "string") throw new Error("recovery admission request was malformed");
      expect(new Headers(options.headers).get("Authorization")).toBe(`Bearer ${"k".repeat(48)}`);
      expect(JSON.parse(options.body)).toEqual({
        worktree_id: (admission as any).admission.worktreeId,
        session_id: (admission as any).admission.parent.session,
        incarnation: 1,
        expected_revision: 7,
        fence: 2,
        consume_token: "t".repeat(43),
        admission: (admission as any).admission,
      });
      expect(options.body).not.toContain("ownership_token");

      const { id: _id, ...missingId } = receipt;
      const invalidReceipts = [
        ["digest mismatch", { ...receipt, admissionDigest: sha256("different admission") }],
        ["missing field", missingId],
        ["extra field", { ...receipt, extra: true }],
        ["wrong field type", { ...receipt, version: "1" }],
        ["wrong UUID", { ...receipt, id: "not-a-uuid" }],
        ["wrong schema", { ...receipt, schema: "ingenium.recovery-receipt" }],
        ["wrong version", { ...receipt, version: 2 }],
        ["wrong timestamp", { ...receipt, consumedAt: "2026-09-05 12:00:01Z" }],
        ["wrong action", { ...receipt, action: "restart" }],
        ["uppercase SHA-256", { ...receipt, admissionDigest: receipt.admissionDigest.toUpperCase() }],
      ] as const;
      for (const [_name, invalidReceipt] of invalidReceipts) {
        await expect(shim.consumeRecoveryAdmission(admission, context, {
          environment,
          request: vi.fn(async () => ({
            status: 200,
            json: async () => ({ data: {
              session: { state: "closed", revision: 8 },
              receipt: invalidReceipt,
            } }),
          })),
        })).rejects.toThrow("could not be consumed");
      }

      for (const error of [
        { code: "RECOVERY_ADMISSION_CONFLICT", message: "replayed" },
        { code: "RECOVERY_ADMISSION_CONFLICT", message: "expired" },
        { code: "SESSION_NOT_FOUND", message: "identity mismatch" },
      ]) {
        await expect(shim.consumeRecoveryAdmission(admission, context, {
          environment,
          request: vi.fn(async () => ({ status: 409, json: async () => ({ error }) })),
        })).rejects.toThrow("could not be consumed");
      }
      await expect(shim.consumeRecoveryAdmission(admission, context, {
        environment,
        request: vi.fn(async () => { throw new Error("unavailable"); }),
      })).rejects.toThrow("could not be consumed");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("consumes once after exact revalidation and propagates one immutable context without local fallback", async () => {
    const shim = await importModule(`${pathToFileURL(recoveryBootstrapShim).href}?test=${Date.now()}`);
    const preflight = twoPassRecoveryPreflight(repositoryRoot);
    const digest = sha256(shim.canonicalJson(preflight));
    const admission = twoPassRecoveryAdmission(preflight, digest, Date.now());
    const consumedContext = admittedRecoveryContext(
      preflight,
      digest,
      recoveryAdmissionReceipt(admission as Record<string, any>),
    );
    const sourceHandle = fakeRecoverySourceHandle(preflight);
    const calls: string[] = [];
    const consumeAdmission = vi.fn(async (_admission, context) => {
      calls.push("consume");
      expect(Object.isFrozen(context)).toBe(true);
      expect(Object.isFrozen(context.parent)).toBe(true);
      expect(Object.isFrozen(context.binding)).toBe(true);
      expect(context).not.toHaveProperty("consumeToken");
      return consumedContext;
    });
    const discardAdmission = vi.fn(() => {
      calls.push("discard");
    });
    const postConsumeCheck = vi.fn((context) => {
      calls.push("post-consume");
      expect(context.preflightDigest).toBe(digest);
      expect(context.receipt).toEqual(consumedContext.receipt);
    });
    const executeAdmitted = vi.fn(async (_argv, context) => {
      calls.push("execute");
      expect(context).toBe(consumedContext);
      expect(context).toBe(postConsumeCheck.mock.calls[0]![0]);
    });

    expect(await shim.runRecoveryBootstrapShim(["node", recoveryBootstrapShim], {
      openSource: vi.fn(() => sourceHandle),
      collectPreflight: vi.fn(async () => preflight),
      admissionPath: "/unread/local/artifact",
      admissionExists: vi.fn(() => true),
      readAdmission: vi.fn(() => admission),
      consumeAdmission,
      discardAdmission,
      postConsumeCheck,
      executeAdmitted,
    })).toBe(0);

    expect(calls).toEqual(["consume", "post-consume", "discard", "execute"]);
    expect(discardAdmission).toHaveBeenCalledWith("/unread/local/artifact");
    expect(sourceHandle.revalidate).toHaveBeenCalledTimes(2);
    expect(sourceHandle.close).toHaveBeenCalledOnce();

    const changedHeadSource = fakeRecoverySourceHandle(preflight);
    changedHeadSource.revalidate
      .mockReturnValueOnce(changedHeadSource.source)
      .mockImplementationOnce(() => { throw new Error("Recovery bootstrap source or Git HEAD changed before admission"); });
    const skippedConsume = vi.fn(async () => undefined);
    await expect(shim.runRecoveryBootstrapShim(["node", recoveryBootstrapShim], {
      openSource: vi.fn(() => changedHeadSource),
      collectPreflight: vi.fn(async () => preflight),
      admissionPath: "/unread/local/artifact",
      admissionExists: vi.fn(() => true),
      readAdmission: vi.fn(() => admission),
      consumeAdmission: skippedConsume,
      postConsumeCheck,
      executeAdmitted,
    })).rejects.toThrow("Git HEAD changed");
    expect(skippedConsume).not.toHaveBeenCalled();

    const postConsumeHead = fakeRecoverySourceHandle(preflight);
    postConsumeHead.revalidate
      .mockReturnValueOnce(postConsumeHead.source)
      .mockReturnValueOnce(postConsumeHead.source)
      .mockImplementationOnce(() => { throw new Error("changed"); });
    await expect(shim.runRecoveryBootstrapShim(["node", recoveryBootstrapShim], {
      openSource: vi.fn(() => postConsumeHead),
      collectPreflight: vi.fn(async () => preflight),
      admissionPath: "/unread/local/artifact",
      admissionExists: vi.fn(() => true),
      readAdmission: vi.fn(() => admission),
      consumeAdmission: vi.fn(async () => consumedContext),
      discardAdmission: vi.fn(),
      executeAdmitted,
    })).rejects.toThrow("Git HEAD changed after admission consumption");
    expect(executeAdmitted).toHaveBeenCalledOnce();

    await expect(shim.runRecoveryBootstrapShim(["node", recoveryBootstrapShim], {
      openSource: vi.fn(() => fakeRecoverySourceHandle(preflight)),
      collectPreflight: vi.fn(async () => preflight),
      admissionPath: "/unread/local/artifact",
      admissionExists: vi.fn(() => true),
      readAdmission: vi.fn(() => admission),
      consumeAdmission: vi.fn(async () => consumedContext),
      discardAdmission: vi.fn(),
      postConsumeCheck: vi.fn(() => { throw new Error("Recovery parent changed after admission consumption"); }),
      executeAdmitted,
    })).rejects.toThrow("parent changed");
    expect(executeAdmitted).toHaveBeenCalledOnce();
  });

  it("two-pass recovery treats only the exact legacy overflow disposition as resolved", async () => {
    const shim = await importModule(`${pathToFileURL(recoveryBootstrapShim).href}?test=${Date.now()}`);
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-two-pass-outbox-"));
    const protectedIndex = join(worktree, ".opencode", "protected-runtime-index");
    const outbox = join(protectedIndex, "coordination-outbox");
    const dispositions = join(protectedIndex, "coordination-outbox-dispositions");
    const key = "196a4bf40b3672e0245a6a39fabeddcefb155b56fe264dc3b29b355f6258b1e2";
    const operationId = "e3b31090e32ac32474f150958ecd2c2cedff8a92f3ddcad03b9a9acb108e68fc";
    const recordSha256 = "b00ae79c982e8e3948e1ee421ef09ac12e2a7b71e83f49ac4381b56a306e0a3c";
    const record = {
      version: 1,
      operationId,
      key,
      kind: "overflow",
      sessionHash: "0".repeat(64),
      createdAt: "2026-09-03T20:53:18.005Z",
      failure: "unavailable",
      revision: null,
      cursor: null,
      digest: "9a1a4af66380af9f8a77c3feff5d16cbbe22c7ad4385fad69a825da99560eb8b",
      ambiguous: true,
      count: 6852,
      mutation: null,
    };
    const disposition = {
      schemaVersion: 1,
      recordKey: key,
      recordSha256,
      operationId,
      decision: "abandoned",
      authority: "explicit_user_authorization",
      reason: "nonrecoverable_identityless_overflow",
      createdAt: "2026-09-05T03:07:55.899Z",
    };
    try {
      mkdirSync(outbox, { recursive: true, mode: 0o700 });
      mkdirSync(dispositions, { mode: 0o700 });
      const serialized = `${JSON.stringify(record)}\n`;
      expect(sha256(serialized)).toBe(recordSha256);
      writeFileSync(join(outbox, `${key}.json`), serialized, { mode: 0o600 });
      expect(shim.summarizeCoordinationOutboxState(protectedIndex).outbox.ambiguousCount).toBe(1);

      writeFileSync(join(dispositions, `${key}.json`), `${JSON.stringify(disposition)}\n`, { mode: 0o600 });
      expect(shim.summarizeCoordinationOutboxState(protectedIndex)).toMatchObject({
        outbox: { status: "validated", count: 1, ambiguousCount: 0 },
        disposition: { status: "validated", count: 1 },
      });
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("fixed deployment verifies the reviewed tracked bootstrap without mutating its mode", () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-recovery-bootstrap-mode-"));
    const source = join(worktree, "packages/ingenium-extension/scripts/recovery-bootstrap.js");
    try {
      mkdirSync(dirname(source), { recursive: true });
      writeFileSync(source, "export {};\n", { mode: 0o644 });
      execFileSync("/usr/bin/git", ["-C", worktree, "init", "--quiet"]);
      execFileSync("/usr/bin/git", ["-C", worktree, "add", "."]);
      execFileSync("/usr/bin/git", ["-C", worktree, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "checkpoint"]);

      chmodSync(source, 0o674);
      expect(() => normalizeManagedRecoveryBootstrapMode(source, worktree)).toThrow("Managed recovery bootstrap is not trusted");
      expect(lstatSync(source).mode & 0o777).toBe(0o674);

      writeFileSync(source, "export const changed = true;\n");
      chmodSync(source, 0o674);
      expect(() => normalizeManagedRecoveryBootstrapMode(source, worktree)).toThrow();
      expect(lstatSync(source).mode & 0o777).toBe(0o674);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("recovery checkpoint hardens final build output before writing evidence and launching production restart", () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-recovery-bootstrap-output-"));
    const distPath = join(worktree, "packages/ingenium-extension/dist");
    const scriptsPath = join(distPath, "scripts");
    const productionRestart = join(scriptsPath, "production-restart.js");
    const evidencePath = join(scriptsPath, "recovery-bootstrap-evidence.json");
    mkdirSync(scriptsPath, { recursive: true });
    writeFileSync(productionRestart, "export {}\n", { mode: 0o575 });
    chmodSync(productionRestart, 0o575);
    const calls: Array<{ command: string; argv: readonly string[]; options: Record<string, unknown> }> = [];
    const runner = vi.fn((command: string, argv: readonly string[], options: Record<string, unknown>) => {
      const env = options.env as NodeJS.ProcessEnv;
      expect(env.NPM_CONFIG_USERCONFIG).not.toBe(env.NPM_CONFIG_GLOBALCONFIG);
      for (const path of [env.NPM_CONFIG_USERCONFIG!, env.NPM_CONFIG_GLOBALCONFIG!]) {
        const stat = lstatSync(path);
        expect(stat.isFile()).toBe(true);
        expect(stat.isSymbolicLink()).toBe(false);
        expect(stat.uid).toBe(process.getuid!());
        expect(stat.mode & 0o777).toBe(0o400);
        expect(readFileSync(path)).toHaveLength(0);
      }
      expect(env.NPM_CONFIG_SCRIPT_SHELL).toBe("/bin/sh");
      calls.push({ command, argv, options });
      if (calls.length === RECOVERY_BOOTSTRAP_CHECKS.length) {
        chmodSync(distPath, 0o775);
        chmodSync(scriptsPath, 0o777);
      }
      if (command === process.execPath) {
        expect([distPath, scriptsPath].map((path) => lstatSync(path).mode & 0o777)).toEqual([0o755, 0o755]);
        expect(lstatSync(productionRestart).mode & 0o777).toBe(0o555);
        expect(JSON.parse(readFileSync(evidencePath, "utf8")).productionRestart.result).toBe("pending");
      }
      return { error: undefined, signal: null, status: 0 };
    });

    try {
      expect(runRecoveryBootstrap(
        ["node", recoveryBootstrapSource],
        runner as any,
        undefined,
        recoveryBootstrapEnvironment({
          INGENIUM_WORKTREE: worktree,
          INGENIUM_RECOVERY_CANONICAL_WORKTREE: worktree,
        }),
        { productionRestart, verifyStage: () => worktree },
      )).toBe(0);
      expect(calls.slice(0, -1).map(({ command, argv }) => [command, argv])).toEqual(RECOVERY_BOOTSTRAP_CHECKS);
      expect(calls.at(-1)).toMatchObject({
        command: process.execPath,
        argv: [productionRestart],
        options: { shell: false, stdio: "inherit" },
      });
      const productionRestartScriptSha256 = sha256(readFileSync(productionRestart));
      expect((calls.at(-1)!.options.env as NodeJS.ProcessEnv).INGENIUM_RECOVERY_BOOTSTRAP_VERIFIED)
        .toBe(productionRestartScriptSha256);
      expect(calls.every(({ options }) => options.cwd === worktree)).toBe(true);
      const npmConfigurationPaths = calls.map(({ options }) => {
        const env = options.env as NodeJS.ProcessEnv;
        return [env.NPM_CONFIG_USERCONFIG, env.NPM_CONFIG_GLOBALCONFIG];
      });
      expect(npmConfigurationPaths.every((paths) => JSON.stringify(paths) === JSON.stringify(npmConfigurationPaths[0]))).toBe(true);
      expect(npmConfigurationPaths[0]!.every((path) => !existsSync(path!))).toBe(true);
      expect(calls.slice(0, -1).every(({ options }) => options.timeout === RECOVERY_BOOTSTRAP_CHECK_TIMEOUT_MS)).toBe(true);
      expect(calls.at(-1)!.options.timeout).toBe(RECOVERY_BOOTSTRAP_RESTART_TIMEOUT_MS);
      expect([distPath, scriptsPath].map((path) => lstatSync(path).mode & 0o300)).toEqual([0o300, 0o300]);
      expect(lstatSync(evidencePath).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(evidencePath, "utf8"))).toEqual({
        schemaVersion: 1,
        checks: RECOVERY_BOOTSTRAP_CHECKS.map((_: readonly [string, readonly string[]], index: number) => ({
          index: index + 1, result: "passed", timeoutMs: RECOVERY_BOOTSTRAP_CHECK_TIMEOUT_MS,
        })),
        productionRestart: { result: "passed", timeoutMs: RECOVERY_BOOTSTRAP_RESTART_TIMEOUT_MS },
        productionRestartScriptSha256,
      });
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("recovery checkpoint rejects a final output identity swap before retaining evidence or launching restart", () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-recovery-bootstrap-swap-"));
    const distPath = join(worktree, "packages/ingenium-extension/dist");
    const scriptsPath = join(distPath, "scripts");
    const productionRestart = join(scriptsPath, "production-restart.js");
    const replacement = join(worktree, "replacement-dist");
    mkdirSync(scriptsPath, { recursive: true });
    mkdirSync(replacement);
    writeFileSync(productionRestart, "export {}\n");
    const calls: string[] = [];
    const runner = vi.fn((command: string) => {
      calls.push(command);
      return { error: undefined, signal: null, status: 0 };
    });
    const retainEvidence = vi.fn();

    try {
      expect(() => runRecoveryBootstrap(
        ["node", recoveryBootstrapSource],
        runner as any,
        retainEvidence,
        recoveryBootstrapEnvironment({
          INGENIUM_WORKTREE: worktree,
          INGENIUM_RECOVERY_CANONICAL_WORKTREE: worktree,
        }),
        {
          productionRestart,
          verifyStage: () => worktree,
          afterDirectoryOpen(path: string) {
            if (path !== distPath) return;
            renameSync(path, `${path}.opened`);
            renameSync(replacement, path);
          },
        },
      )).toThrow("generated directory hardening failed");
      expect(calls).toEqual(RECOVERY_BOOTSTRAP_CHECKS.map(([command]: readonly [string, readonly string[]]) => command));
      expect(calls).not.toContain(process.execPath);
      expect(retainEvidence).not.toHaveBeenCalled();
      expect(existsSync(join(`${distPath}.opened`, "scripts/recovery-bootstrap-evidence.json"))).toBe(false);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("stops the recovery checkpoint on the first failed check without launching or inheriting unsafe environment", () => {
    const calls: Array<{ command: string; argv: readonly string[]; options: Record<string, unknown> }> = [];
    const runner = vi.fn((command: string, argv: readonly string[], options: Record<string, unknown>) => {
      calls.push({ command, argv, options });
      return { error: undefined, signal: null, status: calls.length === 2 ? 7 : 0 };
    });
    const hostile = {
      HOME: "/tmp/recovery-home",
      NODE_OPTIONS: "--require=/tmp/attacker.js",
      OPENCODE_SERVER_PASSWORD: "must-not-pass",
      INGENIUM_MCP_CREDENTIAL: "must-not-pass",
      INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-mcp-credential",
      INGENIUM_RECOVERY_OWNER_NONCE: "owner-nonce",
      NPM_CONFIG_GLOBALCONFIG: "/tmp/attacker-global",
      NPM_CONFIG_USERCONFIG: "/tmp/attacker-user",
    };

    expect(runRecoveryBootstrap(
      ["node", recoveryBootstrapSource],
      runner as any,
      undefined,
      recoveryBootstrapEnvironment(),
      { productionRestart: productionRestartSource, verifyStage: () => repositoryRoot },
    )).toBe(7);
    expect(calls.map(({ command, argv }) => ({ command, argv })))
      .toEqual(RECOVERY_BOOTSTRAP_CHECKS.slice(0, 2).map(
        ([command, argv]: readonly [string, readonly string[]]) => ({ command, argv }),
      ));
    const failedEnvironment = calls[0]!.options.env as NodeJS.ProcessEnv;
    expect(failedEnvironment.NPM_CONFIG_USERCONFIG).not.toBe(failedEnvironment.NPM_CONFIG_GLOBALCONFIG);
    expect(existsSync(failedEnvironment.NPM_CONFIG_USERCONFIG!)).toBe(false);
    expect(existsSync(failedEnvironment.NPM_CONFIG_GLOBALCONFIG!)).toBe(false);
    const npmConfiguration = { globalConfig: "/tmp/private-global", userConfig: "/tmp/private-user" };
    expect(recoveryBootstrapCheckEnvironment(npmConfiguration, hostile)).toEqual({
      HOME: "/tmp/recovery-home",
      NPM_CONFIG_GLOBALCONFIG: "/tmp/private-global",
      NPM_CONFIG_SCRIPT_SHELL: "/bin/sh",
      NPM_CONFIG_USERCONFIG: "/tmp/private-user",
      PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    });
    const scriptSha256 = sha256("production-restart");
    expect(recoveryBootstrapRestartEnvironment(scriptSha256, npmConfiguration, hostile)).toMatchObject({
      HOME: "/tmp/recovery-home",
      INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-mcp-credential",
      INGENIUM_RECOVERY_OWNER_NONCE: "owner-nonce",
      NPM_CONFIG_GLOBALCONFIG: "/tmp/private-global",
      NPM_CONFIG_USERCONFIG: "/tmp/private-user",
      INGENIUM_RECOVERY_BOOTSTRAP_VERIFIED: scriptSha256,
    });
    expect(JSON.stringify(recoveryBootstrapRestartEnvironment(scriptSha256, npmConfiguration, hostile)))
      .not.toContain("must-not-pass");
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
        { productionRestart: productionRestartSource, verifyStage: () => repositoryRoot },
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
    expect(calls).toEqual(RECOVERY_BOOTSTRAP_CHECKS.slice(0, 2).map(
      ([command]: readonly [string, readonly string[]]) => command,
    ));
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
    const shim = await import(/* @vite-ignore */ `${pathToFileURL(recoveryBootstrapShim).href}?test=${Date.now()}`);
    const directory = mkdtempSync(join(tmpdir(), "ingenium-source-recovery-trust-"));
    const priorGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
    const priorGitConfigNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
    const priorGitConfigSystem = process.env.GIT_CONFIG_SYSTEM;
    try {
      const npmConfiguration = shim.privateNpmConfiguration();
      expect(npmConfiguration.userConfig).not.toBe(npmConfiguration.globalConfig);
      const npmDirectory = dirname(npmConfiguration.userConfig);
      for (const path of [npmConfiguration.userConfig, npmConfiguration.globalConfig]) {
        const stat = lstatSync(path);
        expect(stat.isFile()).toBe(true);
        expect(stat.isSymbolicLink()).toBe(false);
        expect(stat.uid).toBe(process.getuid!());
        expect(stat.mode & 0o777).toBe(0o400);
        expect(readFileSync(path)).toHaveLength(0);
      }
      npmConfiguration.cleanup();
      expect(existsSync(npmConfiguration.userConfig)).toBe(false);
      expect(existsSync(npmConfiguration.globalConfig)).toBe(false);
      expect(existsSync(npmDirectory)).toBe(false);

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

      execFileSync("/usr/bin/git", ["-C", checkpoint, "config", "extensions.worktreeConfig", "false"]);
      expect(shim.verifyScopedCheckpoint(realpathSync(checkpoint), realpathSync(source), sourceBytes))
        .toMatch(/^[0-9a-f]{40,64}$/);
      const validCheckpointConfig = readFileSync(join(checkpoint, ".git/config"), "utf8");
      execFileSync("/usr/bin/git", ["-C", checkpoint, "config", "extensions.worktreeConfig", "invalid"]);
      expect(() => shim.verifyScopedCheckpoint(realpathSync(checkpoint), realpathSync(source), sourceBytes))
        .toThrow("worktreeConfig probe failed");
      writeFileSync(join(checkpoint, ".git/config"), validCheckpointConfig);
      execFileSync("/usr/bin/git", ["-C", checkpoint, "config", "--unset", "extensions.worktreeConfig"]);

      for (const [key, value] of [
        ["core.hooksPath", "/tmp/hooks"],
        ["filter.inject.process", "/tmp/filter"],
        ["diff.external", "/tmp/diff"],
        ["alias.inject", "!/tmp/alias"],
      ] as const) {
        execFileSync("/usr/bin/git", ["-C", checkpoint, "config", key, value]);
        expect(() => shim.verifyScopedCheckpoint(realpathSync(checkpoint), realpathSync(source), sourceBytes))
          .toThrow("checkpoint rejected executable Git configuration");
        execFileSync("/usr/bin/git", ["-C", checkpoint, "config", "--unset", key]);
      }

      execFileSync("/usr/bin/git", ["-C", checkpoint, "config", "extensions.worktreeConfig", "true"]);
      execFileSync("/usr/bin/git", ["-C", checkpoint, "config", "--worktree", "core.hooksPath", "/tmp/hooks"]);
      expect(() => shim.verifyScopedCheckpoint(realpathSync(checkpoint), realpathSync(source), sourceBytes))
        .toThrow("checkpoint rejected executable Git configuration");
      execFileSync("/usr/bin/git", ["-C", checkpoint, "config", "--worktree", "--unset", "core.hooksPath"]);

      const ignoredGlobal = join(directory, "ignored-global.gitconfig");
      const ignoredSystem = join(directory, "ignored-system.gitconfig");
      writeFileSync(ignoredGlobal, "[core]\n\thooksPath = /tmp/global-hooks\n");
      writeFileSync(ignoredSystem, "[diff]\n\texternal = /tmp/system-diff\n");
      process.env.GIT_CONFIG_GLOBAL = ignoredGlobal;
      process.env.GIT_CONFIG_NOSYSTEM = "0";
      process.env.GIT_CONFIG_SYSTEM = ignoredSystem;
      expect(shim.verifyScopedCheckpoint(realpathSync(checkpoint), realpathSync(source), sourceBytes))
        .toMatch(/^[0-9a-f]{40,64}$/);

      const shimSource = readFileSync(recoveryBootstrapShim, "utf8");
      const operationalGit = shimSource.slice(shimSource.indexOf("function git("), shimSource.indexOf("function gitConfiguration("));
      const configurationGit = shimSource.slice(shimSource.indexOf("function gitConfigurationEnvironment("), shimSource.indexOf("export function isExecutableGitConfiguration("));
      expect(operationalGit).toContain('["-C", root, "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args]');
      expect(configurationGit).toContain('["-C", root, "config", "--null", "--local", "--list", "--includes"]');
      expect(configurationGit).toContain('["-C", root, "config", "--local", "--bool", "--get", "extensions.worktreeConfig"]');
      expect(configurationGit).toContain('["-C", root, "config", "--null", "--worktree", "--list", "--includes"]');
      expect(configurationGit).toContain("delete env.GIT_CONFIG_GLOBAL");
      expect(configurationGit).not.toContain("/dev/null");
      expect(configurationGit).not.toContain("core.fsmonitor=false");
      expect(configurationGit).not.toContain("core.hooksPath=/dev/null");

      for (const [entry, executable] of [
        ["core.hooksPath\n/tmp/hooks", true],
        ["diff.external\n/tmp/diff", true],
        ["alias.inject\n  !/tmp/alias", true],
        ["filter.inject.process\n/tmp/filter", true],
        ["merge.inject.driver\n/tmp/merge", true],
        ["alias.safe\nlog --oneline", false],
        ["user.name\nSafe User", false],
      ] as const) {
        expect(shim.isExecutableGitConfiguration(entry)).toBe(executable);
        expect(isExecutableGitConfiguration(entry)).toBe(executable);
      }

      chmodSync(dirname(source), 0o777);
      writeFileSync(source, "export const changed = true;\n");
      const npm = vi.fn();
      expect(() => {
        shim.canonicalOwnedDirectory(dirname(source), "Extension scripts directory", lstatSync(dirname(source)).uid, {
          hardenWritablePath: realpathSync(dirname(source)),
        });
        shim.verifyScopedCheckpoint(realpathSync(checkpoint), realpathSync(source), readFileSync(source));
        npm();
      }).toThrow("does not match reviewed Git HEAD");
      expect(lstatSync(dirname(source)).mode & 0o777).toBe(0o755);
      expect(npm).not.toHaveBeenCalled();
      execFileSync("/usr/bin/git", ["-C", checkpoint, "checkout", "--", "packages/ingenium-extension/scripts/recovery-bootstrap.js"]);
      writeFileSync(join(checkpoint, "opencode.json"), "{\"dirty\":true}\n");
      expect(() => shim.verifyScopedCheckpoint(realpathSync(checkpoint), realpathSync(source), sourceBytes))
        .toThrow("scoped checkpoint has tracked drift");
      execFileSync("/usr/bin/git", ["-C", checkpoint, "checkout", "--", "opencode.json"]);
      const untrackedExecutable = join(checkpoint, "packages/ingenium-extension/untracked.sh");
      writeFileSync(untrackedExecutable, "#!/bin/sh\n", { mode: 0o755 });
      chmodSync(untrackedExecutable, 0o755);
      expect(() => shim.verifyScopedCheckpoint(realpathSync(checkpoint), realpathSync(source), sourceBytes))
        .toThrow("scoped checkpoint has untracked drift");
    } finally {
      if (priorGitConfigGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = priorGitConfigGlobal;
      if (priorGitConfigNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
      else process.env.GIT_CONFIG_NOSYSTEM = priorGitConfigNoSystem;
      if (priorGitConfigSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
      else process.env.GIT_CONFIG_SYSTEM = priorGitConfigSystem;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("source recovery shim hardens all four canonical repository directories and emits bounded JSONL", async () => {
    const shim = await importModule(`${pathToFileURL(recoveryBootstrapShim).href}?test=${Date.now()}`);
    const directory = mkdtempSync(join(tmpdir(), "ingenium-source-recovery-directory-harden-"));
    try {
      const packagesRoot = join(directory, "packages");
      const packageRoot = join(packagesRoot, "ingenium-extension");
      const scriptsRoot = join(packageRoot, "scripts");
      mkdirSync(scriptsRoot, { recursive: true });
      const source = join(scriptsRoot, "recovery-bootstrap.js");
      writeFileSync(source, "export {};\n", { mode: 0o644 });
      const paths = [directory, packagesRoot, packageRoot, scriptsRoot];

      for (const [beforeMode, afterMode] of [[0o775, 0o755], [0o777, 0o755], [0o2775, 0o2755]] as const) {
        for (const path of paths) chmodSync(path, beforeMode);
        const audits: Array<Record<string, unknown>> = [];
        const descriptorOpen = vi.fn(openSync);
        const descriptorFchmod = vi.fn(fchmodSync);
        const descriptorFsync = vi.fn(fsyncSync);

        expect(shim.hardenCanonicalRepositoryDirectories(source, directory, lstatSync(directory).uid, {
          retainAudit: (records: Array<Record<string, unknown>>) => audits.push(...records),
          fileSystem: { openSync: descriptorOpen, fchmodSync: descriptorFchmod, fsyncSync: descriptorFsync },
        })).toEqual({ repoRoot: directory, packagesRoot, packageRoot, scriptsPath: scriptsRoot });

        expect(paths.map((path) => lstatSync(path).mode & 0o7777))
          .toEqual([afterMode, afterMode, afterMode, afterMode]);
        expect(descriptorOpen).toHaveBeenCalledTimes(4);
        for (const path of paths) {
          expect(descriptorOpen).toHaveBeenCalledWith(
            path,
            constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
          );
        }
        expect(descriptorFchmod).toHaveBeenCalledTimes(4);
        expect(descriptorFsync).toHaveBeenCalledTimes(4);
        expect(audits.map((audit) => audit.role)).toEqual(shim.CANONICAL_DIRECTORY_ROLES);
        expect(audits.map((audit) => audit.directoryPathSha256)).toEqual(paths.map((path) => sha256(path)));
        expect(audits).toEqual(paths.map((path, index) => ({
          role: shim.CANONICAL_DIRECTORY_ROLES[index],
          directoryPathSha256: sha256(path),
          beforeMode: beforeMode.toString(8).padStart(4, "0"),
          afterMode: afterMode.toString(8).padStart(4, "0"),
          result: "hardened",
          timestamp: expect.any(String),
        })));
        const records = shim.canonicalDirectoryAuditJsonl(audits).toString("utf8").trim().split("\n");
        expect(records).toHaveLength(4);
        expect(records.map((record: string) => JSON.parse(record))).toEqual(audits);
        expect(records.every((record: string) => Buffer.byteLength(record) < 512)).toBe(true);
        expect(JSON.stringify(audits)).not.toContain(directory);
        expect(Object.keys(audits[0]!).sort()).toEqual([
          "afterMode", "beforeMode", "directoryPathSha256", "result", "role", "timestamp",
        ]);
      }
      expect(shim.CANONICAL_DIRECTORY_AUDIT_PATH)
        .toBe(`/tmp/opencode-${process.getuid!()}/recovery-bootstrap-directory-audit.jsonl`);

      const outside = mkdtempSync(join(tmpdir(), "ingenium-source-recovery-outside-"));
      try {
        const outsideScripts = join(outside, "packages/ingenium-extension/scripts");
        mkdirSync(outsideScripts, { recursive: true });
        const outsideSource = join(outsideScripts, "recovery-bootstrap.js");
        writeFileSync(outsideSource, "export {};\n");
        const descriptorFchmod = vi.fn(fchmodSync);
        expect(() => shim.hardenCanonicalRepositoryDirectories(
          outsideSource,
          directory,
          lstatSync(outside).uid,
          { fileSystem: { fchmodSync: descriptorFchmod } },
        )).toThrow("outside the canonical extension package");
        expect(descriptorFchmod).not.toHaveBeenCalled();
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }

      const shimSource = readFileSync(recoveryBootstrapShim, "utf8");
      const runSource = shimSource.slice(shimSource.indexOf("async function runAdmittedRecoveryBootstrapShim"));
      expect(runSource).not.toContain("hardenCanonicalRepositoryDirectories(");
      expect(runSource).not.toContain("verifyScopedCheckpoint(");
      expect(runSource.indexOf("createPrivateRecoveryStage(")).toBeLessThan(runSource.indexOf("await runFixed("));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("source recovery shim hardens regenerated bootstrap directories and rejects identity failures", async () => {
    const shim = await import(/* @vite-ignore */ `${pathToFileURL(recoveryBootstrapShim).href}?test=${Date.now()}`);
    const directory = mkdtempSync(join(tmpdir(), "ingenium-generated-bootstrap-directories-"));
    const owner = lstatSync(directory).uid;
    const createGenerated = (name: string) => {
      const packageRoot = join(directory, name);
      const distPath = join(packageRoot, "dist");
      const scriptsPath = join(distPath, "scripts");
      mkdirSync(scriptsPath, { recursive: true });
      chmodSync(distPath, 0o775);
      chmodSync(scriptsPath, 0o777);
      return { packageRoot, distPath, scriptsPath };
    };
    try {
      const generated = createGenerated("valid");
      const generatedBootstrap = join(generated.scriptsPath, "recovery-bootstrap.js");
      const generatedRestart = join(generated.scriptsPath, "production-restart.js");
      for (const path of [generatedBootstrap, generatedRestart]) {
        writeFileSync(path, "export {};\n", { mode: 0o575 });
        chmodSync(path, 0o575);
      }
      const descriptorFchmod = vi.fn(fchmodSync);
      const descriptorFsync = vi.fn(fsyncSync);
      expect(shim.hardenGeneratedBootstrapDirectories(generated.packageRoot, owner, {
        fileSystem: { fchmodSync: descriptorFchmod, fsyncSync: descriptorFsync },
      })).toBe(generated.scriptsPath);
      expect([generated.distPath, generated.scriptsPath].map((path) => lstatSync(path).mode & 0o777))
        .toEqual([0o755, 0o755]);
      expect(descriptorFchmod).toHaveBeenCalledTimes(2);
      expect(descriptorFsync).toHaveBeenCalledTimes(2);
      expect(shim.normalizeTrustedRegularFileMode(
        generatedBootstrap, "Generated recovery bootstrap", 0o555, owner,
      )).toBe(generatedBootstrap);
      expect(normalizeGeneratedRecoveryExecutable(generatedRestart)).toBe(generatedRestart);
      expect([generatedBootstrap, generatedRestart].map((path) => lstatSync(path).mode & 0o777))
        .toEqual([0o555, 0o555]);

      const wrongOwner = createGenerated("wrong-owner");
      expect(trustedFailureReason(() => shim.hardenGeneratedBootstrapDirectories(wrongOwner.packageRoot, owner + 1)))
        .toBe("owner");

      const linked = createGenerated("linked");
      const linkTarget = join(directory, "link-target");
      mkdirSync(linkTarget);
      rmSync(linked.scriptsPath, { recursive: true });
      symlinkSync(linkTarget, linked.scriptsPath);
      expect(trustedFailureReason(() => shim.hardenGeneratedBootstrapDirectories(linked.packageRoot, owner)))
        .toBe("canonical");

      const nonDirectory = createGenerated("non-directory");
      rmSync(nonDirectory.scriptsPath, { recursive: true });
      writeFileSync(nonDirectory.scriptsPath, "not a directory\n");
      expect(trustedFailureReason(() => shim.hardenGeneratedBootstrapDirectories(nonDirectory.packageRoot, owner)))
        .toBe("directory");

      const swapped = createGenerated("swapped");
      const replacement = join(directory, "replacement-dist");
      mkdirSync(replacement, { mode: 0o775 });
      chmodSync(replacement, 0o775);
      expect(trustedFailureReason(() => shim.hardenGeneratedBootstrapDirectories(swapped.packageRoot, owner, {
        afterOpen(path: string) {
          if (path !== swapped.distPath) return;
          renameSync(path, `${path}.opened`);
          renameSync(replacement, path);
        },
      }))).toBe("canonical");
      expect(lstatSync(swapped.distPath).mode & 0o777).toBe(0o775);

      const shimSource = readFileSync(recoveryBootstrapShim, "utf8");
      const runSource = shimSource.slice(shimSource.indexOf("async function runAdmittedRecoveryBootstrapShim"));
      expect(runSource.indexOf("const build = await runFixed(")).toBeLessThan(
        runSource.indexOf("hardenGeneratedBootstrapDirectories(packageRoot, owner)"),
      );
      expect(runSource.indexOf("hardenGeneratedBootstrapDirectories(packageRoot, owner)")).toBeLessThan(
        runSource.indexOf('readTrustedRegularFile(resolve(generatedDirectory, "recovery-bootstrap.js")'),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("source recovery shim leaves trusted 0755 unchanged without descriptor mutation", async () => {
    const shim = await importModule(`${pathToFileURL(recoveryBootstrapShim).href}?test=${Date.now()}`);
    const directory = mkdtempSync(join(tmpdir(), "ingenium-source-recovery-directory-unchanged-"));
    try {
      const ownerControlled = join(directory, "owner-controlled");
      mkdirSync(ownerControlled, { mode: 0o755 });
      chmodSync(ownerControlled, 0o755);
      const descriptorFchmod = vi.fn(fchmodSync);
      const descriptorFsync = vi.fn(fsyncSync);
      const audits: Array<Record<string, unknown>> = [];

      expect(shim.canonicalOwnedDirectory(ownerControlled, "fixture", lstatSync(ownerControlled).uid, {
        auditRole: "scripts_root",
        hardenWritablePath: realpathSync(ownerControlled),
        retainAudit: (audit: Record<string, unknown>) => audits.push(audit),
        fileSystem: { fchmodSync: descriptorFchmod, fsyncSync: descriptorFsync },
      })).toBe(realpathSync(ownerControlled));

      expect(lstatSync(ownerControlled).mode & 0o777).toBe(0o755);
      expect(descriptorFchmod).not.toHaveBeenCalled();
      expect(descriptorFsync).not.toHaveBeenCalled();
      expect(audits).toEqual([{
        role: "scripts_root",
        directoryPathSha256: sha256(realpathSync(ownerControlled)),
        beforeMode: "0755",
        afterMode: "0755",
        result: "validated",
        timestamp: expect.any(String),
      }]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("source recovery shim rejects world-writable, wrong-owner, symlink, and non-directory paths", async () => {
    const shim = await importModule(`${pathToFileURL(recoveryBootstrapShim).href}?test=${Date.now()}`);
    const directory = mkdtempSync(join(tmpdir(), "ingenium-source-recovery-directory-reject-"));
    try {
      const ownerControlled = join(directory, "owner-controlled");
      mkdirSync(ownerControlled, { mode: 0o755 });
      chmodSync(ownerControlled, 0o755);

      expect(shim.CANONICAL_OWNED_DIRECTORY_FAILURE_REASONS)
        .toEqual(["directory", "canonical", "owner", "writable"]);
      const regularFile = join(directory, "regular-file");
      writeFileSync(regularFile, "not a directory", { mode: 0o777 });
      chmodSync(regularFile, 0o777);
      expect(trustedFailureReason(() => shim.canonicalOwnedDirectory(regularFile, "fixture"))).toBe("directory");
      expect(() => shim.canonicalOwnedDirectory(regularFile, regularFile)).toThrow(/^directory$/);

      const directoryLink = join(directory, "directory-link");
      symlinkSync(ownerControlled, directoryLink);
      expect(trustedFailureReason(() => shim.canonicalOwnedDirectory(
        directoryLink, "fixture", lstatSync(ownerControlled).uid, { hardenWritablePath: directoryLink },
      ))).toBe("canonical");

      chmodSync(ownerControlled, 0o775);
      expect(trustedFailureReason(() => shim.canonicalOwnedDirectory(
        ownerControlled,
        "fixture",
        lstatSync(ownerControlled).uid + 1,
        { hardenWritablePath: realpathSync(ownerControlled) },
      ))).toBe("owner");
      expect(trustedFailureReason(() => shim.canonicalOwnedDirectory(ownerControlled, "fixture"))).toBe("writable");
      chmodSync(ownerControlled, 0o777);
      const audits: Array<Record<string, unknown>> = [];
      expect(trustedFailureReason(() => shim.canonicalOwnedDirectory(
        ownerControlled,
        "fixture",
        lstatSync(ownerControlled).uid,
        { auditRole: "scripts_root", retainAudit: (audit: Record<string, unknown>) => audits.push(audit) },
      ))).toBe("writable");
      expect(lstatSync(ownerControlled).mode & 0o777).toBe(0o777);
      expect(audits).toEqual([{
        role: "scripts_root",
        directoryPathSha256: sha256(realpathSync(ownerControlled)),
        beforeMode: "0777",
        afterMode: "0777",
        result: "rejected",
        timestamp: expect.any(String),
      }]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("source recovery shim rejects inode swaps and failed descriptor hardening", async () => {
    const shim = await importModule(`${pathToFileURL(recoveryBootstrapShim).href}?test=${Date.now()}`);
    const directory = mkdtempSync(join(tmpdir(), "ingenium-source-recovery-directory-race-"));
    try {
      const ownerControlled = join(directory, "owner-controlled");
      const replacement = join(directory, "replacement");
      mkdirSync(ownerControlled, { mode: 0o775 });
      mkdirSync(replacement, { mode: 0o775 });
      chmodSync(ownerControlled, 0o775);
      chmodSync(replacement, 0o775);
      expect(trustedFailureReason(() => shim.canonicalOwnedDirectory(
        ownerControlled,
        "fixture",
        lstatSync(ownerControlled).uid,
        {
          hardenWritablePath: realpathSync(ownerControlled),
          afterOpen(path: string) {
            renameSync(path, `${path}.opened`);
            renameSync(replacement, path);
          },
        },
      ))).toBe("canonical");
      expect(lstatSync(ownerControlled).mode & 0o777).toBe(0o775);

      const symlinkSwap = join(directory, "symlink-swap");
      const symlinkTarget = join(directory, "symlink-target");
      mkdirSync(symlinkSwap, { mode: 0o775 });
      mkdirSync(symlinkTarget, { mode: 0o775 });
      chmodSync(symlinkSwap, 0o775);
      chmodSync(symlinkTarget, 0o775);
      expect(() => shim.canonicalOwnedDirectory(
        symlinkSwap,
        "fixture",
        lstatSync(symlinkSwap).uid,
        {
          hardenWritablePath: realpathSync(symlinkSwap),
          afterOpen(path: string) {
            renameSync(path, `${path}.opened`);
            symlinkSync(symlinkTarget, path);
          },
        },
      )).toThrow();
      expect(lstatSync(symlinkSwap).isSymbolicLink()).toBe(true);
      expect(lstatSync(symlinkTarget).mode & 0o777).toBe(0o775);

      const failed = join(directory, "failed");
      mkdirSync(failed, { mode: 0o775 });
      chmodSync(failed, 0o775);
      expect(trustedFailureReason(() => shim.canonicalOwnedDirectory(
        failed,
        "fixture",
        lstatSync(failed).uid,
        { hardenWritablePath: realpathSync(failed), fileSystem: { fchmodSync: vi.fn() } },
      ))).toBe("writable");
      expect(lstatSync(failed).mode & 0o777).toBe(0o775);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("installed current managed wrapper resolves production restart to the source shim", async () => {
    const installed = join(dirname(fileURLToPath(import.meta.url)), "dist", "scripts", "managed-command-wrapper.js");
    const wrapper = await importModule(`${pathToFileURL(installed).href}?test=${Date.now()}`);
    expect(wrapper.managedBuildExecution(["deployment", "production-restart"])).toEqual({
      command: process.execPath,
      argv: [recoveryBootstrapShim],
    });
    expect(wrapper.managedRecoveryWorktree()).toBe(repositoryRoot);
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
          openRecoveryBootstrap: () => ({
            descriptor: openSync("/dev/null", constants.O_RDONLY),
            bytes: Buffer.from("reviewed"),
            context: Object.freeze({
              schemaVersion: 1 as const,
              kind: "source-bootstrap" as const,
              sourcePath: recoveryBootstrapShim,
              repositoryRoot: directory,
              head: "a".repeat(40),
              sourceSha256: sha256("reviewed"),
            }),
          }),
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

  it("production restart parses one immutable admitted identity and binding without secret fields", () => {
    const preflight = twoPassRecoveryPreflight(repositoryRoot);
    const digest = sha256(canonicalTestJson(preflight));
    const expected = admittedRecoveryContext(preflight, digest);
    const parsed = parseAdmittedRecoveryContext({
      INGENIUM_ADMITTED_RECOVERY_CONTEXT: JSON.stringify(expected),
    });

    expect(parsed).toEqual(expected);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.parent)).toBe(true);
    expect(Object.isFrozen(parsed.binding)).toBe(true);
    expect(parsed.outboxQuarantine).toBeNull();
    expect(Object.isFrozen(parsed.receipt)).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain("ownership_token");
    expect(JSON.stringify(parsed)).not.toContain("consumeToken");
    expect(() => parseAdmittedRecoveryContext({
      INGENIUM_ADMITTED_RECOVERY_CONTEXT: JSON.stringify({ ...expected, ownership_token: "secret" }),
    })).toThrow("unavailable");
  });

  it("rejects admitted overflow quarantine drift before binding or parent discovery", async () => {
    const preflight = twoPassRecoveryPreflight(repositoryRoot) as Record<string, any>;
    preflight.outbox = { ...preflight.outbox, ambiguousCount: 1, quarantine: { schemaVersion: 1, status: "fenced",
      recordKey: PRODUCTION_RESTART_AUTHORIZED_OVERFLOW_KEY, recordSha256: sha256("record"), recordCount: 11_617 } };
    const digest = sha256(canonicalTestJson(preflight));
    const context = admittedRecoveryContext(preflight, digest);
    const resolveBinding = vi.fn();
    const readParentCandidates = vi.fn();

    expect(() => parseAdmittedRecoveryContext({ INGENIUM_ADMITTED_RECOVERY_CONTEXT: JSON.stringify({
      ...context, outboxQuarantine: { ...context.outboxQuarantine!, recordCount: 11_618 },
    }) })).toThrow("unavailable");
    await expect(runProductionRestartAdapter({
      canonicalWorktree: vi.fn(),
      revalidateOutboxQuarantine: vi.fn(() => false),
      resolveBinding,
      readParentCandidates,
      retainCandidateRejection: vi.fn(),
      attestParentProcess: vi.fn(),
      prepareReplacement: vi.fn(),
    }, context)).rejects.toThrow("quarantine changed after admission");
    expect(resolveBinding).not.toHaveBeenCalled();
    expect(readParentCandidates).not.toHaveBeenCalled();
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
    const owner = { actorId: `actor-${sha256("owner")}`, fence: 1 };
    expect(restartHandoffMemoryEntry(handoff, owner)).toEqual({
      manifest: { baseCommit: null, dirtyHashes: [], dependencyResults: [], exclusivePaths: [], profileRevision: null,
        toolRevision: null, ownerId: owner.actorId, fence: 1, unresolvedOperations: [], todoWrite: handoff.replay.todos,
        inputHash: sha256(JSON.stringify(handoff.replay)), finalized: false },
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
      originalSessionSha256: handoff.replay.sessionIdSha256,
      todoReplaySha256: sha256(JSON.stringify(handoff.replay.todos)),
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

  it("fixed deployment appends hashed stale-candidate quarantine evidence without rewriting retained state", () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-production-restart-candidate-evidence-"));
    const protectedRoot = join(worktree, ".opencode", "protected-runtime-index");
    const restartRoot = join(protectedRoot, "production-restart");
    try {
      mkdirSync(protectedRoot, { recursive: true, mode: 0o700 });
      chmodSync(protectedRoot, 0o700);
      mkdirSync(restartRoot, { mode: 0o700 });
      const candidate = {
        oldProcess: { pid: 1259022, startTimeTicks: 1, executableSha256: sha256("dead"), nonceSha256: "0".repeat(64) },
        handoff: { incomplete: true },
      };
      const retainedState = `${JSON.stringify({ schemaVersion: 1, parentCandidates: [candidate] })}\n`;
      writePrivateJson(join(restartRoot, "state.json"), JSON.parse(retainedState));

      appendProductionRestartCandidateRejection(worktree, candidate, "missing_nonce");
      appendProductionRestartCandidateRejection(worktree, candidate, "malformed");

      expect(readFileSync(join(restartRoot, "state.json"), "utf8")).toBe(retainedState);
      const evidence = readFileSync(join(restartRoot, "candidate-rejections.jsonl"), "utf8")
        .trim().split("\n").map((line) => JSON.parse(line));
      expect(evidence.map((entry) => entry.reason)).toEqual(["missing_nonce", "malformed"]);
      expect(evidence).toEqual(evidence.map((entry) => ({
        schemaVersion: 1,
        disposition: "quarantined",
        reason: entry.reason,
        candidateSha256: sha256(JSON.stringify(candidate)),
        identitySha256: sha256(JSON.stringify(candidate.oldProcess)),
        handoffSha256: sha256(JSON.stringify(candidate.handoff)),
        occurredAt: expect.any(String),
      })));
      expect(JSON.stringify(evidence)).not.toContain("1259022");
      expect(lstatSync(join(restartRoot, "candidate-rejections.jsonl")).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("fixed deployment attests a deleted live executable through its kernel handle", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-deleted-executable-"));
    const executable = join(directory, "opencode");
    let child: ChildProcess | undefined;
    try {
      copyFileSync(process.execPath, executable);
      chmodSync(executable, 0o755);
      child = spawn(executable, ["--input-type=module", "--eval", "setTimeout(() => process.exit(0), 10000)"], {
        stdio: "ignore",
      });
      if (child.pid === undefined) throw new Error("Deleted executable fixture did not start");
      const identity = recoveryProcessIdentity(child.pid, "0".repeat(64));
      rmSync(executable);
      expect(readlinkSync(`/proc/${child.pid}/exe`)).toContain("(deleted)");
      expect(inspectExpectedProcessIdentity(identity)).toEqual(identity);
      expect(inspectExpectedProcessIdentity({ ...identity, executableSha256: sha256("wrong") })).toBeUndefined();
    } finally {
      if (child) await stopRecoveryProcess(child);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("autonomous-recovery captures the legacy session under an external scoped claim", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-legacy-durable-handoff-"));
    const dataHome = join(worktree, "data-home");
    const priorNonce = process.env.INGENIUM_RESTART_NONCE;
    try {
      delete process.env.INGENIUM_RESTART_NONCE;
      mkdirSync(dataHome, { mode: 0o700 });
      mkdirSync(join(worktree, ".opencode", "protected-runtime-index"), { recursive: true, mode: 0o700 });
      chmodSync(join(worktree, ".opencode", "protected-runtime-index"), 0o700);
      const projectId = "00000000-0000-4000-8000-000000000001";
      const storageMappingHash = sha256("legacy-storage");
      const sessionId = "legacy-session";
      const handoff = {
        replay: { sessionIdSha256: sha256(sessionId), todos: [
          { id: "TODO-1", content: "Verify restart", status: "pending" as const, priority: "high" as const },
          { id: "TODO-2", content: "Implement restart", status: "in_progress" as const, priority: "high" as const },
        ] },
        status: "working" as const,
        taskHash: sha256("current-task"),
        actions: [{ kind: "read" as const, result: "succeeded" as const, path: "src/current.ts", targetHash: null }],
        changedPaths: [],
        checks: [],
        todos: { total: 2, pending: 1, inProgress: 1, completed: 0, cancelled: 0, state: "mixed" as const },
        nextWork: { kind: "continue_task" as const, referenceHash: sha256("current-task") },
      };
      expect(redactedHandoffFromExport({
        info: { id: sessionId, directory: worktree },
        messages: [{
          info: { id: "message-1", role: "assistant" },
          parts: [
            {
              type: "tool",
              tool: "todowrite",
              state: { status: "completed", input: { todos: [
                { id: "CAPTURE", content: "capture", status: "completed", priority: "high" },
                { id: "RESTART", content: "restart", status: "in_progress", priority: "high" },
              ] } },
            },
            {
              type: "tool",
              tool: "apply_patch",
              state: { status: "completed", input: { patchText: "*** Begin Patch\n*** Update File: src/current.ts\n*** End Patch" } },
            },
            {
              type: "tool",
              tool: "bash",
              state: { status: "completed", input: { command: "npm run typecheck" }, metadata: { exitCode: 0 } },
            },
            {
              type: "tool",
              tool: "bash",
              state: { status: "running", input: { command: "ingenium-build deployment production-restart" } },
            },
          ],
        }],
      }, sessionId, worktree)).toMatchObject({
        status: "working",
        changedPaths: [{ path: "src/current.ts", operation: "edit" }],
        checks: [{ name: "typecheck", status: "completed", result: "passed", exitCode: 0 }],
        todos: { total: 2, pending: 0, inProgress: 1, completed: 1, cancelled: 0, state: "mixed" },
        nextWork: { kind: "continue_task" },
      });
      expect(redactedHandoffFromExport({
        info: { id: sessionId, directory: worktree },
        messages: [],
      }, sessionId, worktree)).toBeUndefined();

      const request = replacementRequest(worktree);
      request.oldProcess = recoveryProcessIdentity(process.pid, "0".repeat(64));
      request.oldPort = null;
      request.oldDataHome = dataHome;
      request.handoff = handoff;
      request.binding.projectId = projectId;
      request.binding.workspaceId = "legacy-workspace";
      request.binding.storageMappingHash = storageMappingHash;
      const binding: ProductionRestartBinding = {
        ...request.binding,
        apiUrl: "http://127.0.0.1:4097/api/v1",
        project: "legacy-project",
        credentialFile: join(worktree, ".credential"),
      };
      binding.projectId = projectId;
      binding.workspaceId = "legacy-workspace";
      binding.storageMappingHash = storageMappingHash;
      const artifact = join(worktree, ".opencode", "protected-runtime-index", "tui-recovery", "legacy-handoff.json");
      const calls: string[] = [];
      const operationId = "00000000-0000-4000-8000-000000000010";
      const callTool = vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push(`${name}:${String(args.operation ?? args.action ?? "status")}:${existsSync(artifact)}`);
        if (name === "coordination_update" && args.operation === "register") {
          return mcpResult({ data: { session: { revision: 0, fence: 3 } } });
        }
        if (name === "coordination_claim" && args.action === undefined) {
          expect(args.claims).toEqual([{
            claim: { kind: "path", path: ".opencode/protected-runtime-index/tui-recovery/legacy-handoff.json" },
            baseline_sha256: null,
            current_sha256: null,
            repository_sha256: null,
          }]);
          return mcpResult({ data: { session: { revision: 1, fence: 3 }, acceptedEpoch: 5, operationId } });
        }
        if (name === "coordination_claim" && args.action === "verify") {
          return mcpResult({ data: { session: { revision: 1, fence: 3 }, acceptedEpoch: 5 } });
        }
        if (name === "coordination_claim" && args.action === "complete") {
          expect(args.footprint).toEqual([expect.objectContaining({
            path: ".opencode/protected-runtime-index/tui-recovery/legacy-handoff.json",
            before_sha256: null,
            after_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          })]);
          return mcpResult({ data: { session: { revision: 2, fence: 3 }, acceptedEpoch: 5 } });
        }
        if (name === "coordination_status") {
          return mcpResult({ data: { session: { revision: 2, fence: 3 } } });
        }
        if (name === "coordination_update" && args.operation === "close") return mcpResult({ data: {} });
        throw new Error(`Unexpected MCP call: ${name}`);
      });
      const close = vi.fn(async () => {});
      await persistClaimedLegacyHandoff(worktree, binding, {
        binding: request.binding,
        oldProcess: request.oldProcess,
        oldPort: null,
        oldDataHome: dataHome,
        handoff,
        timeouts: request.timeouts,
      }, sessionId, async () => ({ callTool, close }));

      const retained = readLegacyRecoveryHandoff(worktree);
      expect(retained).toMatchObject({
        binding: { project: "legacy-project", projectId, launcherWorktree: worktree, storageMappingHash },
        parent: { pid: process.pid, port: null, dataHome },
        handoff,
        coordination: {
          sessionIdSha256: sha256(sessionId),
          incarnation: expect.any(Number),
          revision: 1,
          fence: 3,
          captureClaimEpoch: 5,
          captureClaimSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      });
      expect(calls).toEqual([
        "coordination_update:register:false",
        "coordination_claim:create:false",
        "coordination_claim:verify:true",
        "coordination_claim:create:true",
        "coordination_status:status:true",
        "coordination_update:close:true",
      ]);
      expect(readFileSync(artifact, "utf8")).not.toMatch(/ownershipToken|clientClaimKey|raw-session/);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      if (priorNonce === undefined) delete process.env.INGENIUM_RESTART_NONCE;
      else process.env.INGENIUM_RESTART_NONCE = priorNonce;
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("autonomous-recovery accepts only one exact incumbent export object", () => {
    const sessionId = "legacy-session";
    const worktree = "/home/test/ingenium";
    const exported = { info: { id: sessionId, directory: worktree }, messages: [] };
    const document = JSON.stringify(exported);

    expect(parseProductionSessionExport(Buffer.from(`\n${document}\n`), sessionId, worktree)).toEqual(exported);
    for (const invalid of [
      `status\n${document}`,
      `${document}\nstatus`,
      `${document}\n${document}`,
      document.slice(0, -1),
      `\u001b[32m${document}`,
      `\uFEFF${document}`,
      JSON.stringify([exported]),
    ]) {
      expect(() => parseProductionSessionExport(Buffer.from(invalid), sessionId, worktree))
        .toThrow("Production session export framing is invalid");
    }
    expect(() => parseProductionSessionExport(Buffer.from(JSON.stringify({
      ...exported,
      info: { ...exported.info, id: "other-session" },
    })), sessionId, worktree)).toThrow("Production session export identity is invalid");
    expect(() => parseProductionSessionExport(Buffer.from(JSON.stringify({
      ...exported,
      info: { ...exported.info, directory: "/home/test/other" },
    })), sessionId, worktree)).toThrow("Production session export identity is invalid");
    expect(() => parseProductionSessionExport(Buffer.from([0x7b, 0xff, 0x7d]), sessionId, worktree))
      .toThrow("Production session export framing is invalid");
  });

  it("rejects a private capture that grows beyond its limit after the descriptor opens", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-production-capture-growth-"));
    const path = join(directory, "capture.json");
    try {
      writeFileSync(path, "small\n", { mode: 0o600 });
      expect(() => readPrivateProductionRestartFile(path, 16, {
        closeSync,
        fstatSync,
        lstatSync,
        openSync,
        readSync(descriptor, buffer, offset, length, position) {
          if (offset === 0) writeFileSync(path, "x".repeat(17), { mode: 0o600 });
          return readSync(descriptor, buffer, offset, length, position);
        },
      })).toThrow("Production restart state is unavailable");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fixed deployment reconciles dead and active unnonced candidates before replacement-first bootstrap", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-production-restart-adapter-"));
    try {
      const request = replacementRequest(worktree);
      request.oldPort = null;
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
      const dead = { ...parent, oldProcess: { ...parent.oldProcess, pid: 900001 } };
      const orphan = {
        ...parent,
        oldProcess: { ...parent.oldProcess, pid: process.pid, nonceSha256: "0".repeat(64) },
      };
      const calls: string[] = [];
      const retired: RestartProcessIdentity[] = [];
      const dependencies: ProductionRestartAdapterDependencies<string> = {
        canonicalWorktree: () => { calls.push("worktree"); return worktree; },
        resolveBinding: async () => { calls.push("resolve-binding"); return binding; },
        readParentCandidates: () => { calls.push("read-parent"); return [dead, orphan]; },
        retainCandidateRejection: (_worktree, candidate, reason) => {
          calls.push(`reject:${reason}:${(candidate as ProductionRestartParentCandidate).oldProcess.pid}`);
        },
        enrollParentCandidate: async () => { calls.push("enroll-parent"); return parent; },
        attestParentProcess: (candidate) => {
          calls.push(`attest-parent:${candidate.oldProcess.pid}`);
          return candidate.oldProcess.pid === parent.oldProcess.pid;
        },
        prepareReplacement: async (input) => {
          calls.push("prepare");
          expect(input.parent).toEqual(parent);
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
              prepareRecoveryOwner: async (identity, _session, _handoffSha256, transactionSha256) => {
                calls.push("owner-ready");
                return { status: "ready", transactionSha256, replacementIdentitySha256: recoveryIdentitySha256(identity) };
              },
              quiesceOldProcess: async () => { calls.push("quiesce-old"); },
              resumeOldProcess: async () => { calls.push("resume-old"); },
              prepareRetirement: async () => { calls.push("prepare-retirement"); return { rollback() {} }; },
              commitRetirement: async () => { calls.push("retirement-commit"); },
              retireOldProcess: async (identity) => { calls.push("retire-old"); retired.push(identity); },
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
      expect(retired).toEqual([parent.oldProcess]);
      expect(retired).not.toContainEqual(orphan.oldProcess);
      expect(calls).toEqual([
        "worktree", "resolve-binding", "read-parent", "attest-parent:900001", "reject:unattested:900001",
        `reject:missing_nonce:${process.pid}`, "enroll-parent", "attest-parent:1001", "prepare", "binding", "identity:old", "publish",
        "persist:handoff_published", "launch", "identity:replacement", "persist:replacement_started", "health",
        "persist:replacement_healthy", "session", "persist:session_created", "memory-ack",
        "persist:typed_memory_acknowledged", "terminal-idle", "persist:terminal_idle_acknowledged", "owner-ready",
        "persist:recovery_owner_ready", "binding", "identity:replacement", "quiesce-old", "identity:old",
        "persist:old_parent_quiesced", "prepare-retirement", "retirement-commit",
        "persist:retirement_committed", "retire-old", "persist:old_parent_retired", "release",
      ]);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it.each([
    ["handoff and status requests fail", "request", 0],
    ["handoff status is malformed", "malformed", 1],
  ] as const)("closes a registered restart publisher when %s", async (_title, failure, expectedRevision) => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-production-restart-publisher-"));
    try {
      const request = replacementRequest(worktree);
      const binding: ProductionRestartBinding = {
        ...request.binding,
        apiUrl: "http://127.0.0.1:4097/api/v1",
        project: "production-project",
        credentialFile: join(worktree, ".opencode", ".ingenium-mcp-credential"),
      };
      const callTool = vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name === "coordination_update" && args.operation === "register") {
          return mcpResult({ data: { session: { revision: 0, fence: 7 } } });
        }
        if (name === "coordination_handoff") {
          if (failure === "request") throw new Error("handoff failed");
          return mcpResult({ data: { session: { revision: "invalid", fence: 7 } } });
        }
        if (name === "coordination_status") {
          if (failure === "request") throw new Error("status failed");
          return mcpResult({ data: { session: { revision: 1, fence: 7 } } });
        }
        if (name === "coordination_update" && args.operation === "close") return mcpResult({ data: {} });
        throw new Error(`Unexpected MCP call: ${name}`);
      });
      const close = vi.fn(async () => {});
      const client = { callTool, close } satisfies McpToolClient;
      const openClient = vi.fn(async () => client);

      await expect(publishRestartHandoff(worktree, binding, request.handoff, openClient))
        .rejects.toThrow(failure === "request" ? "handoff failed" : "handoff publication failed");

      const register = callTool.mock.calls.find(([, args]) => args.operation === "register")![1];
      const closed = callTool.mock.calls.find(([, args]) => args.operation === "close")![1];
      expect(callTool.mock.calls.map(([name, args]) => `${name}:${String(args.operation ?? "status")}`)).toEqual([
        "coordination_update:register",
        "coordination_handoff:memory",
        "coordination_status:status",
        "coordination_update:close",
      ]);
      expect(closed).toMatchObject({
        worktree_id: register.worktree_id,
        session_id: register.session_id,
        incarnation: register.incarnation,
        ownership_token: register.ownership_token,
        expected_revision: expectedRevision,
        fence: 7,
      });
      expect(openClient).toHaveBeenCalledWith(worktree, { project: binding.project, credentialPurpose: "general" });
      expect(close).toHaveBeenCalledOnce();
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("fixed deployment rejects a saturated non-contracted overflow without resolving or mutating it", () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-production-restart-ambiguous-"));
    const priorCanonicalWorktree = process.env.INGENIUM_RECOVERY_CANONICAL_WORKTREE;
    const priorWorktree = process.env.INGENIUM_WORKTREE;
    try {
      process.env.INGENIUM_RECOVERY_CANONICAL_WORKTREE = worktree;
      process.env.INGENIUM_WORKTREE = worktree;
      const outbox = new CoordinationOutbox(worktree);
      for (let index = 0; index < 128; index += 1) {
        outbox.put({
          exactKey: `legacy-preflight-${index}`,
          kind: "claim",
          sessionHash: sha256("legacy-session"),
          failure: "unavailable",
        });
      }
      expect(outbox.list()).toContainEqual(expect.objectContaining({ kind: "overflow", ambiguous: true }));

      const restartRoot = join(worktree, ".opencode", "protected-runtime-index", "production-restart");
      mkdirSync(restartRoot, { mode: 0o700 });
      const retainedState = {
        schemaVersion: 1,
        parentCandidates: [{
          oldProcess: {
            pid: 1259022,
            startTimeTicks: 5096426,
            executableSha256: sha256("dead-parent"),
            nonceSha256: "0".repeat(64),
          },
          handoff: { incomplete: true },
        }],
      };
      writePrivateJson(join(restartRoot, "state.json"), retainedState);

      const production = productionRestartDependencies(sha256("production-restart-script"));

      expect(() => production.canonicalWorktree()).toThrow("coordination state is ambiguous");
      expect(JSON.parse(readFileSync(join(restartRoot, "state.json"), "utf8"))).toEqual(retainedState);
      expect(existsSync(outbox.dispositionDirectory)).toBe(false);
    } finally {
      if (priorCanonicalWorktree === undefined) delete process.env.INGENIUM_RECOVERY_CANONICAL_WORKTREE;
      else process.env.INGENIUM_RECOVERY_CANONICAL_WORKTREE = priorCanonicalWorktree;
      if (priorWorktree === undefined) delete process.env.INGENIUM_WORKTREE;
      else process.env.INGENIUM_WORKTREE = priorWorktree;
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("admits only the contracted exact-key overflow without disposing it before replacement readiness", () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-production-restart-abandoned-overflow-"));
    const priorCanonicalWorktree = process.env.INGENIUM_RECOVERY_CANONICAL_WORKTREE;
    const priorWorktree = process.env.INGENIUM_WORKTREE;
    try {
      process.env.INGENIUM_RECOVERY_CANONICAL_WORKTREE = worktree;
      process.env.INGENIUM_WORKTREE = worktree;
      const outbox = new CoordinationOutbox(worktree);
      const retained = writeIdentitylessOverflow(outbox, PRODUCTION_RESTART_AUTHORIZED_OVERFLOW_KEY, 11_617);
      const overflowPath = join(outbox.directory, `${PRODUCTION_RESTART_AUTHORIZED_OVERFLOW_KEY}.json`);

      const production = productionRestartDependencies(sha256("production-restart-script"));

      expect(production.canonicalWorktree()).toBe(worktree);
      expect(readFileSync(overflowPath)).toEqual(retained);
      expect(outbox.unresolved()).toContainEqual(expect.objectContaining({
        key: PRODUCTION_RESTART_AUTHORIZED_OVERFLOW_KEY,
        count: 11_617,
        ambiguous: true,
      }));
      expect(existsSync(outbox.dispositionDirectory)).toBe(false);
    } finally {
      if (priorCanonicalWorktree === undefined) delete process.env.INGENIUM_RECOVERY_CANONICAL_WORKTREE;
      else process.env.INGENIUM_RECOVERY_CANONICAL_WORKTREE = priorCanonicalWorktree;
      if (priorWorktree === undefined) delete process.env.INGENIUM_WORKTREE;
      else process.env.INGENIUM_WORKTREE = priorWorktree;
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("rejects every non-contracted overflow key before enrollment or signal", () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-production-restart-wrong-overflow-"));
    const priorCanonicalWorktree = process.env.INGENIUM_RECOVERY_CANONICAL_WORKTREE;
    const priorWorktree = process.env.INGENIUM_WORKTREE;
    try {
      process.env.INGENIUM_RECOVERY_CANONICAL_WORKTREE = worktree;
      process.env.INGENIUM_WORKTREE = worktree;
      const outbox = new CoordinationOutbox(worktree);
      writeIdentitylessOverflow(outbox, sha256("not-authorized"));

      const production = productionRestartDependencies(sha256("production-restart-script"));

      expect(() => production.canonicalWorktree()).toThrow("coordination state is ambiguous");
      expect(existsSync(outbox.dispositionDirectory)).toBe(false);
    } finally {
      if (priorCanonicalWorktree === undefined) delete process.env.INGENIUM_RECOVERY_CANONICAL_WORKTREE;
      else process.env.INGENIUM_RECOVERY_CANONICAL_WORKTREE = priorCanonicalWorktree;
      if (priorWorktree === undefined) delete process.env.INGENIUM_WORKTREE;
      else process.env.INGENIUM_WORKTREE = priorWorktree;
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("fixed deployment rejects absent, ambiguous, malformed, foreign, or unattested parents before launch", async () => {
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
      const rejections: Array<{ candidate: unknown; reason: string }> = [];
      const base = (parentCandidates: ProductionRestartParentCandidate[]): ProductionRestartAdapterDependencies<object> => ({
        canonicalWorktree: () => worktree,
        resolveBinding: async () => binding,
        readParentCandidates: () => parentCandidates,
        retainCandidateRejection: (_worktree, candidate, reason) => { rejections.push({ candidate, reason }); },
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
              quiesceOldProcess: async () => {},
              resumeOldProcess: async () => {},
              prepareRetirement: async () => ({ rollback() {} }),
              commitRetirement: async () => {},
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
        .rejects.toThrow("parent identity is absent or ambiguous");
      const malformed = {
        ...parent,
        handoff: { ...parent.handoff, checks: [{ ...parent.handoff.checks[0]!, command: "raw" }] },
      };
      const retainedMalformed = JSON.stringify(malformed);
      await expect(runProductionRestartAdapter(base([malformed])))
        .rejects.toThrow("parent identity is absent or ambiguous");
      const foreign = { ...parent, binding: { ...parent.binding, storageMappingHash: sha256("foreign") } };
      await expect(runProductionRestartAdapter(base([foreign])))
        .rejects.toThrow("parent identity is absent or ambiguous");
      expect(JSON.stringify(malformed)).toBe(retainedMalformed);
      expect(rejections).toEqual([
        { candidate: forged, reason: "unattested" },
        { candidate: malformed, reason: "malformed" },
        { candidate: foreign, reason: "binding_mismatch" },
      ]);
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
        quiesceOldProcess: async () => { calls.push("quiesce-old"); },
        resumeOldProcess: async () => { calls.push("resume-old"); },
        prepareRetirement: async () => { calls.push("prepare-retirement"); return { rollback() { calls.push("rollback-retirement"); } }; },
        commitRetirement: async () => { calls.push("retirement-commit"); },
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
        "owner-ready", "persist:recovery_owner_ready", "binding", "identity:replacement", "quiesce-old", "identity:old",
        "persist:old_parent_quiesced", "prepare-retirement", "retirement-commit",
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

  it("reconciles noncommit before cleanup and surfaces rollback and owner-abort failures", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-replacement-precommit-rollback-"));
    try {
      const request = replacementRequest(worktree);
      const replacement: RestartProcessIdentity = {
        pid: 1052,
        startTimeTicks: 2052,
        ...request.replacement.expectedIdentity,
      };
      const calls: string[] = [];
      const dependencies: ReplacementFirstRestartDependencies<object> = {
        revalidateBinding: async () => { calls.push("binding"); return true; },
        revalidateProcessIdentity: async (_identity, role) => { calls.push(`identity:${role}`); return true; },
        persistHandoff: async () => { calls.push("publish"); },
        launchReplacement: async (input) => { calls.push("launch"); input.bindProvisionalIdentity(replacement); return replacement; },
        verifyReplacementHealth: async () => { calls.push("health"); },
        createReplacementSession: async (_identity, _port, transactionSha256) => ({
          status: "created", transactionSha256, session: {},
        }),
        acknowledgeTypedMemory: async (_identity, _session, handoffSha256, transactionSha256) => ({
          status: "acknowledged", handoffSha256, transactionSha256,
        }),
        awaitTerminalIdleAcknowledgement: async (_identity, _session, handoffSha256, transactionSha256) => ({
          status: "idle", handoffSha256, transactionSha256, assistantResult: "completed",
        }),
        prepareRecoveryOwner: async (identity, _session, _handoffSha256, transactionSha256) => {
          calls.push("owner-ready");
          return { status: "ready", transactionSha256, replacementIdentitySha256: recoveryIdentitySha256(identity) };
        },
        quiesceOldProcess: async () => { calls.push("quiesce-old"); },
        resumeOldProcess: async () => { calls.push("resume-old"); },
        prepareRetirement: async () => {
          calls.push("prepare-retirement");
          return { rollback() { calls.push("rollback-retirement"); throw new Error("rollback failed"); } };
        },
        commitRetirement: async () => { calls.push("final-unresolved"); throw new Error("retirement check failed"); },
        reconcileRetirement: async () => { calls.push("reconcile-retirement"); return "not_committed"; },
        abortRecoveryOwner: async () => { calls.push("abort-owner"); throw new Error("owner abort failed"); },
        retireOldProcess: async () => { calls.push("retire-old"); },
        stopReplacement: async () => { calls.push("stop-replacement"); },
        persistEvidence: async (entry) => { calls.push(`persist:${entry.phase}`); },
      };

      let failure: unknown;
      try {
        await managedReplacementFirstRestart([encodedRestart(request)], dependencies, worktree);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors.map((entry) => (entry as Error).message))
        .toEqual(["retirement check failed", "rollback failed", "owner abort failed"]);

      expect(calls.indexOf("quiesce-old")).toBeGreaterThan(calls.indexOf("owner-ready"));
      expect(calls).toContain("rollback-retirement");
      expect(calls).toContain("resume-old");
      expect(calls.indexOf("rollback-retirement")).toBeLessThan(calls.indexOf("resume-old"));
      expect(calls.indexOf("resume-old")).toBeLessThan(calls.indexOf("stop-replacement"));
      expect(calls).not.toContain("retire-old");
      expect(calls.slice(calls.indexOf("prepare-retirement"), calls.indexOf("abort-owner") + 1)).toEqual([
        "prepare-retirement", "final-unresolved", "reconcile-retirement", "rollback-retirement", "abort-owner",
      ]);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it.each(["committed", "unknown"] as const)(
    "keeps the old parent fenced when a throwing retirement commit reconciles as %s",
    async (outcome) => {
      const worktree = mkdtempSync(join(tmpdir(), `ingenium-replacement-${outcome}-recovery-`));
      try {
        const request = replacementRequest(worktree);
        const replacement: RestartProcessIdentity = {
          pid: 1062,
          startTimeTicks: 2062,
          ...request.replacement.expectedIdentity,
        };
        const calls: string[] = [];
        const evidence: ReplacementFirstRestartEvidence[] = [];
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
          prepareRecoveryOwner: async (identity, _session, _handoffSha256, transactionSha256) => ({
            status: "ready", transactionSha256, replacementIdentitySha256: recoveryIdentitySha256(identity),
          }),
          quiesceOldProcess: async () => { calls.push("quiesce-old"); },
          resumeOldProcess: async () => { calls.push("resume-old"); },
          prepareRetirement: async () => ({ rollback() { calls.push("rollback-retirement"); } }),
          commitRetirement: async () => { calls.push("retirement-commit"); throw new Error("commit outcome lost"); },
          reconcileRetirement: async () => { calls.push("reconcile-retirement"); return outcome; },
          abortRecoveryOwner: async () => { calls.push("abort-owner"); },
          retireOldProcess: async () => { calls.push("retire-old"); },
          stopReplacement: async () => { calls.push("stop-replacement"); },
          persistEvidence: async (entry) => { evidence.push(entry); },
        };

        const restart = managedReplacementFirstRestart([encodedRestart(request)], dependencies, worktree);
        if (outcome === "committed") {
          await expect(restart).resolves.toMatchObject({ recoveryState: "retirement_committed" });
          expect(evidence.at(-1)).toMatchObject({ phase: "committed_recovery", retirementOutcome: "committed" });
        } else {
          await expect(restart).rejects.toThrow("commit outcome lost");
          expect(evidence.at(-1)).toMatchObject({ phase: "uncertain_recovery", retirementOutcome: "unknown" });
        }
        expect(calls).toEqual(["quiesce-old", "retirement-commit", "reconcile-retirement"]);
      } finally {
        rmSync(worktree, { recursive: true, force: true });
      }
    },
  );

  it("holds the final unresolved check and retirement commit against a concurrent outbox writer", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "ingenium-production-retirement-order-"));
    let writer: ChildProcess | undefined;
    try {
      const events: string[] = [];
      const started = join(worktree, "writer-started");
      const result = join(worktree, "writer-result.json");
      const exactKey = "concurrent-final-check";
      const quarantine = vi.spyOn(CoordinationOutbox.prototype, "assertFencedOverflowQuarantine").mockImplementation((expected) => {
        expect(expected).toBeNull();
        events.push("quarantine");
      });

      commitProductionRetirement(worktree, sha256("transaction"), () => {
        events.push("commit");
        const script = `
          import { writeFileSync } from "node:fs";
          import { CoordinationOutbox } from ${JSON.stringify(coordinationOutboxSource)};
          writeFileSync(${JSON.stringify(started)}, "started");
          try {
            new CoordinationOutbox(${JSON.stringify(worktree)}).put({
              exactKey: ${JSON.stringify(exactKey)}, kind: "snapshot", sessionHash: "a".repeat(64), failure: "unavailable",
            });
            writeFileSync(${JSON.stringify(result)}, JSON.stringify({ status: "written" }));
          } catch (error) {
            writeFileSync(${JSON.stringify(result)}, JSON.stringify({ status: "failed", message: String(error) }));
          }
        `;
        writer = spawn(process.execPath, ["--import", tsxLoader, "--input-type=module", "--eval", script], {
          cwd: worktree,
          stdio: "ignore",
        });
        const deadline = Date.now() + 2_000;
        while (!existsSync(started) && Date.now() < deadline) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
        expect(existsSync(started)).toBe(true);
        expect(new CoordinationOutbox(worktree).list()).not.toContainEqual(expect.objectContaining({ key: sha256(exactKey) }));
      });

      if (!writer) throw new Error("Concurrent writer did not start");
      if (writer.exitCode === null && writer.signalCode === null) {
        await new Promise<void>((resolvePromise, reject) => {
          writer!.once("error", reject);
          writer!.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`Concurrent writer exited ${code}`)));
        });
      }
      expect(writer.exitCode).toBe(0);

      expect(events).toEqual(["quarantine", "commit"]);
      expect(JSON.parse(readFileSync(result, "utf8"))).toEqual({ status: "written" });
      expect(new CoordinationOutbox(worktree).list()).toContainEqual(expect.objectContaining({ key: sha256(exactKey) }));
      quarantine.mockRestore();
    } finally {
      if (writer) await stopRecoveryProcess(writer);
      vi.restoreAllMocks();
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
        quiesceOldProcess: async () => { calls.push("quiesce-old"); },
        resumeOldProcess: async () => { calls.push("resume-old"); },
        prepareRetirement: async () => ({ rollback() { calls.push("rollback-retirement"); } }),
        commitRetirement: async () => { calls.push("retirement-commit"); },
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
        quiesceOldProcess: async () => {},
        resumeOldProcess: async () => {},
        prepareRetirement: async () => ({ rollback() {} }),
        commitRetirement: async () => {},
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
          quiesceOldProcess: async () => {},
          resumeOldProcess: async () => {},
          prepareRetirement: async () => ({ rollback() {} }),
          commitRetirement: async () => {},
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
        quiesceOldProcess: async () => {},
        resumeOldProcess: async () => {},
        prepareRetirement: async () => ({ rollback() {} }),
        commitRetirement: async () => {},
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

  it("imagerevision", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-image-revision-"));
    const missingHead = mkdtempSync(join(tmpdir(), "ingenium-image-revision-missing-"));
    const priorRevision = process.env.IMAGE_REVISION;
    const priorOperatorValue = process.env.INGENIUM_TEST_OPERATOR_VALUE;
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      writeFileSync(join(directory, "source.ts"), "export {};\n");
      execFileSync("/usr/bin/git", ["-C", directory, "add", "source.ts"]);
      execFileSync("/usr/bin/git", ["-C", directory, "-c", "user.name=Ingenium Test", "-c", "user.email=test@invalid", "commit", "--quiet", "-m", "fixture"]);
      const head = execFileSync("/usr/bin/git", ["-C", directory, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      process.env.IMAGE_REVISION = "a".repeat(40);
      process.env.INGENIUM_TEST_OPERATOR_VALUE = "retained";

      for (const operation of ["compose-build", "compose-up", "compose-restart"]) {
        const runner = vi.fn((_command: string, _argv: readonly string[], options: { env: NodeJS.ProcessEnv }) => ({
          error: undefined, signal: null, status: 0, env: options.env,
        }));
        expect(managedCommand("build", ["deployment", operation], directory, { runner: runner as any })).toBe(0);
        expect(runner.mock.calls[0]![2].env).toMatchObject({
          IMAGE_REVISION: head,
          INGENIUM_TEST_OPERATOR_VALUE: "retained",
        });
      }

      const sha256Head = "b".repeat(64);
      const sha256Runner = vi.fn((_command: string, _argv: readonly string[], options: { env: NodeJS.ProcessEnv }) => ({
        error: undefined, signal: null, status: 0, env: options.env,
      }));
      expect(managedCommand("build", ["deployment", "compose-build"], directory, {
        runner: sha256Runner as any,
        readImageRevision: () => sha256Head,
      })).toBe(0);
      expect(sha256Runner.mock.calls[0]![2].env.IMAGE_REVISION).toBe(sha256Head);

      const malformedRunner = vi.fn();
      expect(() => managedCommand("build", ["deployment", "compose-build"], directory, {
        runner: malformedRunner,
        readImageRevision: () => "A".repeat(40),
      })).toThrow("Managed build Git HEAD is invalid");
      expect(malformedRunner).not.toHaveBeenCalled();

      execFileSync("/usr/bin/git", ["-C", missingHead, "init", "--quiet"]);
      const missingRunner = vi.fn();
      expect(() => managedCommand("build", ["deployment", "compose-build"], missingHead, { runner: missingRunner }))
        .toThrow();
      expect(missingRunner).not.toHaveBeenCalled();
    } finally {
      if (priorRevision === undefined) delete process.env.IMAGE_REVISION;
      else process.env.IMAGE_REVISION = priorRevision;
      if (priorOperatorValue === undefined) delete process.env.INGENIUM_TEST_OPERATOR_VALUE;
      else process.env.INGENIUM_TEST_OPERATOR_VALUE = priorOperatorValue;
      rmSync(directory, { recursive: true, force: true });
      rmSync(missingHead, { recursive: true, force: true });
    }
  });

  it("binds the canonical worktree and passes only attested recovery bindings to the production restart shim", () => {
    const environment = managedRecoveryEnvironment({
      HOME: "/tmp/recovery-home",
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
    expect(managedRecoveryEnvironment({ INGENIUM_WORKTREE: "/tmp/caller-controlled" }).INGENIUM_WORKTREE)
      .toBe(repositoryRoot);
    expect(managedBuildEnvironment({ INGENIUM_WORKTREE: "/tmp/unrelated-build" }).INGENIUM_WORKTREE)
      .toBe("/tmp/unrelated-build");
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

  it("rejects executable local and worktree Git configuration but ignores global configuration", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-managed-git-"));
    const previousHome = process.env.HOME;
    try {
      execFileSync("/usr/bin/git", ["-C", directory, "init", "--quiet"]);
      writeFileSync(join(directory, "safe.txt"), "safe\n");
      expect(managedCommand("repository", ["add", "safe.txt"], directory)).toBe(0);
      execFileSync("/usr/bin/git", ["-C", directory, "config", "extensions.worktreeConfig", "false"]);
      expect(managedCommand("repository", ["add", "safe.txt"], directory)).toBe(0);
      const validRepositoryConfig = readFileSync(join(directory, ".git/config"), "utf8");
      execFileSync("/usr/bin/git", ["-C", directory, "config", "extensions.worktreeConfig", "invalid"]);
      expect(() => managedCommand("repository", ["add", "safe.txt"], directory))
        .toThrow("worktreeConfig probe failed");
      writeFileSync(join(directory, ".git/config"), validRepositoryConfig);
      execFileSync("/usr/bin/git", ["-C", directory, "config", "--unset", "extensions.worktreeConfig"]);
      for (const [key, value] of [
        ["core.hooksPath", "/tmp/hooks"],
        ["filter.inject.process", "/tmp/filter"],
        ["merge.inject.driver", "/tmp/merge-driver"],
        ["diff.external", "/tmp/diff"],
        ["alias.inject", "!/tmp/alias"],
      ] as const) {
        execFileSync("/usr/bin/git", ["-C", directory, "config", key, value]);
        expect(() => managedCommand("repository", ["add", "safe.txt"], directory))
          .toThrow("Repository wrapper rejected executable Git configuration");
        execFileSync("/usr/bin/git", ["-C", directory, "config", "--unset", key]);
      }

      execFileSync("/usr/bin/git", ["-C", directory, "config", "extensions.worktreeConfig", "true"]);
      for (const [key, value] of [
        ["core.hooksPath", "/tmp/worktree-hooks"],
        ["diff.external", "/tmp/worktree-diff"],
        ["alias.inject", "!/tmp/worktree-alias"],
      ] as const) {
        execFileSync("/usr/bin/git", ["-C", directory, "config", "--worktree", key, value]);
        expect(() => managedCommand("repository", ["add", "safe.txt"], directory))
          .toThrow("Repository wrapper rejected executable Git configuration");
        execFileSync("/usr/bin/git", ["-C", directory, "config", "--worktree", "--unset", key]);
      }

      const home = join(directory, "home");
      mkdirSync(home);
      writeFileSync(join(home, ".gitconfig"), "[core]\n\thooksPath = /tmp/global-hooks\n[diff]\n\texternal = /tmp/global-diff\n");
      process.env.HOME = home;
      expect(managedCommand("repository", ["add", "safe.txt"], directory)).toBe(0);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
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
    expect(manifest.scripts.build).toBe("node scripts/build-distributions.mjs");

    const runCommand = vi.fn(() => 0);
    const priorExitCode = process.exitCode;
    try {
      runManagedCommandCli("repository", ["node", "repository-command", Buffer.from(JSON.stringify(["status"])).toString("base64url")], { runCommand });
      expect(runCommand).toHaveBeenCalledWith("repository", ["status"]);
      expect(process.exitCode).toBe(0);
    } finally {
      process.exitCode = priorExitCode;
    }
    expect(() => runManagedCommandCli("build", ["node", "build-command", Buffer.from(JSON.stringify(["exec", "arbitrary"])).toString("base64url")]))
      .toThrow("Build wrapper rejected the command");
    expect(() => runManagedCommandCli("build", ["node", "build-command", "deployment", "compose-up"]))
      .toThrow("Managed wrapper requires one encoded argv payload");
  });
});

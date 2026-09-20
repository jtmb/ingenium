import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
const { canonicalJson, captureCurrentRecoveryPreAdmission, promoteLegacyRecoveryPreAdmission,
  readCurrentParentSummary, collectRecoveryPreflight } = await import(
  /* @vite-ignore */ new URL("./scripts/recovery-bootstrap.js", import.meta.url).href
);
import {
  currentRecoverySource, publishCurrentParentRecovery, readCurrentParentRecoveryCandidate,
  type CurrentRecoverySession, type ManagedRecoveryBinding,
} from "./tui-recovery.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
let root: string;
let binding: ManagedRecoveryBinding;
let input: Parameters<typeof publishCurrentParentRecovery>[0];

function rewrite(path: string, mutate: (record: any) => void): void {
  const record = JSON.parse(readFileSync(path, "utf8"));
  mutate(record);
  const { enrollmentSha256: _, ...payload } = record;
  record.enrollmentSha256 = digest(JSON.stringify(payload));
  writeFileSync(path, JSON.stringify(record), { mode: 0o600 });
}

beforeEach(() => {
  root = mkdtempSync("/tmp/opencode/current-recovery-");
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git(["init"]);
  writeFileSync(join(root, ".gitignore"), ".opencode/\n");
  git(["add", ".gitignore"]);
  git(["-c", "user.name=Recovery Test", "-c", "user.email=recovery@example.invalid", "commit", "-m", "fixture"]);
  binding = { project: "ingenium", projectId: randomUUID(), workspaceId: "shared-memory-ingenium",
    launcherWorktree: root, storageMappingHash: digest("mapping") };
  const session: CurrentRecoverySession = {
    role: "ingenium-orchestrator",
    sessionId: "ses_exact", coordinationSessionId: `session-${digest("ses_exact")}`,
    worktreeId: `worktree-${digest(`${binding.workspaceId}\0${binding.storageMappingHash}`)}`, incarnation: 2, revision: 4, fence: 3,
    epoch: 7, claimReferenceSha256: digest("claim"),
    handoff: { replay: { sessionIdSha256: digest("ses_exact"), todos: [{ id: "TODO-STABLE-1", content: "Continue recovery", status: "in_progress", priority: "high" }] }, status: "working", taskHash: digest("task"),
      actions: [{ kind: "edit", result: "succeeded", path: "src/component.ts", targetHash: null }],
      changedPaths: [{ path: "src/component.ts", operation: "edit", additions: 1, deletions: 0, changeRevision: 1 }],
      checks: [{ name: "test", status: "completed", result: "passed", exitCode: 0, targetHash: digest("check") }],
      todos: { total: 1, pending: 0, inProgress: 1, completed: 0, cancelled: 0, state: "in_progress" },
      nextWork: { kind: "continue_task", referenceHash: digest("task") } },
    todos: [{ id: "TODO-STABLE-1", status: "in_progress" }],
  };
  input = { binding, runtimeId: randomUUID(), nonce: randomBytes(32).toString("base64url"),
    controlPlane: "http://127.0.0.1:4098", source: currentRecoverySource(root), sessions: [session] };
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("current parent recovery discovery", () => {
  it("corroborates only the independently bound parent and never admits restart from the record alone", async () => {
    const path = publishCurrentParentRecovery(input);
    const record = readCurrentParentRecoveryCandidate(binding);
    const parent = { ...record.parent, sessionId: "ses_exact", port: 4098 };
    const exactBinding = { ...binding, worktree: root };
    const summary = readCurrentParentSummary(root, parent, exactBinding, input.source.head);
    expect(summary).toEqual({ status: "validated", role: "ingenium-orchestrator", project: "ingenium", enrollmentSha256: record.enrollmentSha256 });
    expect(readCurrentParentSummary(root, null, exactBinding, input.source.head).status).toBe("invalid");
    expect(readCurrentParentSummary(root, { ...parent, sessionId: "ses_foreign" }, exactBinding, input.source.head).status).toBe("invalid");
    expect(readCurrentParentSummary(root, parent, exactBinding, input.source.head, Date.now(), {
      status: "idle", taskHash: null, checkCount: 0, todos: { total: 0 }, nextWork: { kind: "none", referenceHash: null },
    }).status).toBe("invalid");
    const preflight = await collectRecoveryPreflight({ environment: { INGENIUM_WORKTREE: root } });
    expect(preflight.admissible).toBe(false);
    expect(preflight.failures).toContain("parent_identity");
    rewrite(path, (value) => { value.sessions[0].role = ""; });
    expect(readCurrentParentSummary(root, parent, exactBinding, input.source.head).status).toBe("invalid");
    publishCurrentParentRecovery(input);
    publishCurrentParentRecovery({ ...input, runtimeId: randomUUID() });
    expect(readCurrentParentSummary(root, parent, exactBinding, input.source.head).status).toBe("invalid");
  });
  it("atomically publishes an owner-private content-free binding discoverable by an independent reader", () => {
    const path = publishCurrentParentRecovery(input);
    const firstInode = lstatSync(path).ino;
    input.sessions[0]!.revision = 5;
    publishCurrentParentRecovery(input);
    expect(lstatSync(path).ino).not.toBe(firstInode);
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
    expect(lstatSync(path).uid).toBe(process.getuid!());
    expect(readdirSync(join(root, ".opencode/protected-runtime-index/tui-recovery"))).toEqual([`current-parent-${input.runtimeId}.json`]);
    const record = readCurrentParentRecoveryCandidate(binding);
    expect(record).toMatchObject({ binding, runtimeId: input.runtimeId, sourceHead: input.source.head,
      parent: { pid: process.pid, nonceSha256: digest(input.nonce) }, controlPlane: input.controlPlane,
      sessions: [{ sessionId: "ses_exact", incarnation: 2, revision: 5, fence: 3, epoch: 7,
        handoff: { todos: [{ idSha256: digest("TODO-STABLE-1"), status: "in_progress" }],
          checks: [{ result: "passed", exitCode: 0 }], nextWork: { kind: "continue_task" } } }] });
    const serialized = readFileSync(path, "utf8");
    for (const forbidden of [input.nonce, "src/component.ts", "TODO-STABLE-1", "transcript", "prompt", "reasoning", "password", "ownershipToken"])
      expect(serialized).not.toContain(forbidden);
    const moduleUrl = new URL("./tui-recovery.ts", import.meta.url).href;
    const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      `import { readCurrentParentRecoveryCandidate } from ${JSON.stringify(moduleUrl)};
       console.log(JSON.stringify(readCurrentParentRecoveryCandidate(${JSON.stringify(binding)})));`],
    { cwd: process.cwd(), encoding: "utf8" });
    expect(JSON.parse(output)).toEqual(record);
  });

  it("captures a fresh-nonce managed parent from canonical current-parent evidence", async () => {
    publishCurrentParentRecovery(input);
    const record = readCurrentParentRecoveryCandidate(binding);
    const parent = { ...record.parent, cwd: root, cmdlineSha256: digest("argv"), sessionId: null, port: 4098,
      dataHome: join(root, "data-home"), environment: { INGENIUM_RESTART_NONCE: input.nonce,
        OPENCODE_SERVER_PASSWORD: "p".repeat(43) } };
    const todos = [{ id: "TODO-STABLE-1", content: "private replay content", status: "in_progress", priority: "high" }];
    const payloads: Record<string, unknown> = {
      "/global/health": { healthy: true, version: "1.0.0" },
      "/session/ses_exact": { id: "ses_exact", directory: root, currentTaskId: "task" },
      "/session/ses_exact/message": [{ info: { role: "assistant", agent: "ingenium-orchestrator" }, parts: [
        { type: "text", text: "private transcript" },
        { type: "tool", tool: "todowrite", state: { status: "completed", input: { todos } } },
        { type: "tool", tool: "shell", state: { status: "completed", input: { command: "npm test" }, metadata: { exitCode: 0 } } },
      ] }],
      "/session/status": { ses_exact: { type: "busy" } },
    };
    const request = async (url: string) => new Response(JSON.stringify(payloads[new URL(url).pathname]), { status: 200 });
    const inspectParent = () => ({ ...parent, commandName: "opencode", nonce: input.nonce, ports: [4098] });
    const source = { status: "validated", head: input.source.head, sourceMatchesHead: true, dirtyPaths: [] };
    const exactBinding = { project: binding.project, projectId: binding.projectId, workspaceId: binding.workspaceId,
      storageMappingHash: binding.storageMappingHash, worktree: root };

    const capture = await captureCurrentRecoveryPreAdmission(parent, exactBinding, source, request, inspectParent);

    expect(capture).toMatchObject({ snapshot: { kind: "current-pre-admission", nonceProvenance: "process_environment",
      parent: record.parent, sessionId: "ses_exact", sourceHead: input.source.head,
      operational: { role: "ingenium-orchestrator", todos: [{ idSha256: digest("TODO-STABLE-1"), status: "in_progress" }] } } });
    expect(parent.sessionId).toBeNull();
    const serialized = JSON.stringify(capture);
    for (const forbidden of [input.nonce, "p".repeat(43), "private transcript", "private replay content"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("promotes only fresh bound legacy pre-admission evidence into currentParent", () => {
    const legacyBinding = { project: binding.project, projectId: binding.projectId, workspaceId: binding.workspaceId,
      storageMappingHash: binding.storageMappingHash, worktree: root };
    const snapshot = { schemaVersion: 1, kind: "legacy-pre-admission", nonceProvenance: "absent_process_environment",
      sessionId: "ses_exact", binding: legacyBinding, sourceHead: input.source.head,
      operational: { role: "ingenium-orchestrator", status: "working" } };
    const capture = { snapshot, sha256: digest(canonicalJson(snapshot)), summary: { status: "working" } };
    expect(promoteLegacyRecoveryPreAdmission(capture, legacyBinding)).toEqual({ status: "validated",
      role: "ingenium-orchestrator", project: "ingenium", enrollmentSha256: capture.sha256,
      session: { incarnation: 1, revision: 0, fence: 1 } });
    expect(promoteLegacyRecoveryPreAdmission({ ...capture, sha256: digest("stale") }, legacyBinding)).toBeNull();
    expect(promoteLegacyRecoveryPreAdmission(capture, { ...legacyBinding, workspaceId: "foreign" })).toBeNull();
  });

  it.each([
    ["missing role", (r: any) => { delete r.sessions[0].role; }],
    ["empty role", (r: any) => { r.sessions[0].role = ""; }],
    ["unbounded role", (r: any) => { r.sessions[0].role = "a".repeat(129); }],
    ["content in role", (r: any) => { r.sessions[0].role = "private role text"; }],
    ["PID", (r: any) => { r.parent.pid = 2147483647; }],
    ["start", (r: any) => { r.parent.startTimeTicks += 1; }],
    ["executable", (r: any) => { r.parent.executableSha256 = digest("foreign executable"); }],
    ["expired", (r: any) => { r.expiresAt = Date.now() - 1; }],
    ["nonce", (r: any) => { delete r.parent.nonceSha256; }],
    ["zero nonce", (r: any) => { r.parent.nonceSha256 = "0".repeat(64); }],
    ["handoff", (r: any) => { delete r.sessions[0].handoff; }],
    ["source", (r: any) => { r.sourceHead = "0".repeat(40); }],
    ["dirty startup", (r: any) => { r.sourceClean = false; }],
    ["foreign project", (r: any) => { r.binding.project = "foreign"; }],
    ["foreign project ID", (r: any) => { r.binding.projectId = randomUUID(); }],
    ["foreign workspace", (r: any) => { r.binding.workspaceId = "foreign"; }],
    ["foreign launcher worktree", (r: any) => { r.binding.launcherWorktree = "/tmp/opencode"; }],
    ["foreign mapping", (r: any) => { r.binding.storageMappingHash = digest("foreign"); }],
    ["foreign runtime", (r: any) => { r.runtimeId = randomUUID(); }],
    ["foreign session", (r: any) => { r.sessions[0].sessionId = "ses_foreign"; }],
    ["foreign worktree identity", (r: any) => { r.sessions[0].worktreeId = `worktree-${digest("foreign")}`; }],
    ["missing incarnation", (r: any) => { delete r.sessions[0].incarnation; }],
    ["invalid incarnation", (r: any) => { r.sessions[0].incarnation = 0; }],
    ["missing task reference", (r: any) => { delete r.sessions[0].handoff.taskHash; }],
    ["missing Todo references", (r: any) => { delete r.sessions[0].handoff.todos; }],
    ["missing status", (r: any) => { delete r.sessions[0].handoff.status; }],
    ["missing nextWork", (r: any) => { delete r.sessions[0].handoff.nextWork; }],
    ["secret field", (r: any) => { r.sessions[0].handoff.password = "secret"; }],
    ["reasoning body", (r: any) => { r.sessions[0].handoff.nextWork.reasoning = "private reasoning"; }],
    ["transcript field", (r: any) => { r.transcript = []; }],
  ])("rejects %s", (_name, mutate) => {
    const path = publishCurrentParentRecovery(input);
    rewrite(path, mutate);
    expect(() => readCurrentParentRecoveryCandidate(binding)).toThrow();
  });

  it("rejects changed enrollment, unsafe files, dirty source, and ambiguous live parents/sessions", () => {
    const path = publishCurrentParentRecovery(input);
    const original = readFileSync(path, "utf8");
    writeFileSync(path, original.replace("ses_exact", "ses_other"));
    expect(() => readCurrentParentRecoveryCandidate(binding)).toThrow();
    publishCurrentParentRecovery(input);
    chmodSync(path, 0o644);
    expect(() => readCurrentParentRecoveryCandidate(binding)).toThrow();
    publishCurrentParentRecovery(input);
    writeFileSync(join(root, "dirty.ts"), "dirty");
    expect(() => readCurrentParentRecoveryCandidate(binding)).toThrow("Dirty recovery source");
    rmSync(join(root, "dirty.ts"));
    const second = publishCurrentParentRecovery({ ...input, runtimeId: randomUUID() });
    expect(() => readCurrentParentRecoveryCandidate(binding)).toThrow("Ambiguous recovery parents");
    rmSync(second);
    publishCurrentParentRecovery({ ...input, sessions: [...input.sessions,
      { ...input.sessions[0]!, sessionId: "ses_second", coordinationSessionId: `session-${digest("ses_second")}`,
        handoff: { ...input.sessions[0]!.handoff, replay: { ...input.sessions[0]!.handoff.replay, sessionIdSha256: digest("ses_second") } } }] });
    expect(() => readCurrentParentRecoveryCandidate(binding)).toThrow("Ambiguous recovery sessions");
    publishCurrentParentRecovery({ ...input, sessions: [] });
    expect(() => readCurrentParentRecoveryCandidate(binding)).toThrow("No live recovery candidate");
  });

  it("does not initialize or normalize files during read-only discovery", () => {
    expect(() => readCurrentParentRecoveryCandidate(binding)).toThrow();
    expect(existsSync(join(root, ".opencode"))).toBe(false);
    publishCurrentParentRecovery(input);
    const directory = join(root, ".opencode/protected-runtime-index/tui-recovery");
    chmodSync(directory, 0o755);
    expect(() => readCurrentParentRecoveryCandidate(binding)).toThrow("Recovery index is not private");
    expect(lstatSync(directory).mode & 0o777).toBe(0o755);
  });

  it("rejects source HEAD changes and symlink/hardlink records", () => {
    const path = publishCurrentParentRecovery(input);
    const linked = join(root, ".opencode/linked-record.json");
    linkSync(path, linked);
    expect(() => readCurrentParentRecoveryCandidate(binding)).toThrow();
    rmSync(path);
    symlinkSync(linked, path);
    expect(() => readCurrentParentRecoveryCandidate(binding)).toThrow();
    rmSync(path);
    rmSync(linked);
    publishCurrentParentRecovery(input);
    execFileSync("git", ["-c", "user.name=Recovery Test", "-c", "user.email=recovery@example.invalid",
      "commit", "--allow-empty", "-m", "next source"], { cwd: root, stdio: "pipe" });
    expect(() => readCurrentParentRecoveryCandidate(binding)).toThrow("Unmatched recovery source");
  });
});

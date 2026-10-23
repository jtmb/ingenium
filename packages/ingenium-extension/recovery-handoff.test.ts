import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRedactedRestartHandoff, runReplacementFirstRestart, stableRestartTodos, type RedactedRestartHandoff } from "./replacement-first-restart.js";
import { productionDependencies, redactedHandoffFromExport } from "./scripts/production-restart.js";
import { verifyRecoveryMcpBinding, verifyRecoveryMcpCanary } from "./tui-recovery.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const roots: string[] = [];
const temporary = () => { const root = mkdtempSync("/tmp/opencode/recovery-handoff-"); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const handoff = (): RedactedRestartHandoff => ({
  replay: { sessionIdSha256: hash("original-work-session"), todos: [
    { id: "RECOVERY-42", content: "Verify the original recovery task", status: "in_progress", priority: "high" },
  ] },
  status: "working", taskHash: hash("original task"), actions: [], changedPaths: [], checks: [],
  todos: { total: 1, pending: 0, inProgress: 1, completed: 0, cancelled: 0, state: "in_progress" },
  nextWork: { kind: "continue_task", referenceHash: hash("original task") },
});
const binding = (root: string) => ({ project: "ingenium", projectId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "workspace-ingenium", storageMappingHash: hash("mapping"), launcherWorktree: root });
const toolResult = (data: unknown) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });

describe.each(["bash", "shell"])("T65 F2 %s recovery outcomes", (tool) => {
  it.each([
    ["zero exit", { metadata: { exit: 0 } }, 0],
    ["nonzero exit", { metadata: { exit: 1 } }, 1],
    ["zero exitCode", { metadata: { exitCode: 0 } }, 0],
    ["nonzero exitCode", { metadata: { exitCode: 2 } }, 2],
    ["zero exit_code", { metadata: { exit_code: 0 } }, 0],
    ["nonzero exit_code", { metadata: { exit_code: 127 } }, 127],
    ["zero code", { metadata: { code: 0 } }, 0],
    ["nonzero code", { metadata: { code: 255 } }, 255],
    ["top-level exit", { exitCode: 0, metadata: {} }, 0],
    ["agreeing aliases", { code: 1, metadata: { exit: 1, exitCode: 1, exit_code: 1, code: 1 } }, 1],
    ["error with nonzero exit", { status: "error", metadata: { exit: 1 } }, 1],
    ["running with zero exit", { status: "running", metadata: { exit: 0 } }, null],
    ["pending with zero exit", { status: "pending", metadata: { exit: 0 } }, null],
  ] as const)("normalizes %s without inventing successful actions or checks", (_label, state, exitCode) => {
    const root = temporary();
    const input = { command: "npm run test" };
    const projected = redactedHandoffFromExport({ info: { id: "original", directory: root }, messages: [{ parts: [
      { type: "tool", tool, state: { status: "completed", input, ...state } },
      { type: "tool", tool: "bash", state: { status: "running", input: { command: "ingenium-build deployment production-restart" } } },
    ] }] }, "original", root);
    const sourceTargetHash = hash(`${tool}\0${JSON.stringify(input)}`);
    const check = { name: "test", status: exitCode === 0 ? "completed" : "failed",
      result: exitCode === 0 ? "passed" : "failed", exitCode };
    const targetHash = hash(JSON.stringify({ ...check, sourceTargetHash }));
    expect(projected?.checks).toEqual(exitCode === null ? [] : [{ ...check, targetHash }]);
    expect(projected?.actions).toEqual(exitCode === 0
      ? [{ kind: "execute", result: "succeeded", path: null, targetHash: sourceTargetHash }] : []);
    expect(projected?.nextWork).toEqual(exitCode === null ? { kind: "none", referenceHash: null }
      : { kind: exitCode === 0 ? "run_checks" : "address_failure", referenceHash: targetHash });
    expect(parseRedactedRestartHandoff(projected)).toEqual(projected);
  });
});

describe("typed recovery replay", () => {
  it("B2 preserves unknown and contradictory recovery outcomes", () => {
    const root = temporary();
    const input = { command: "npm run test -- private-command-canary" };
    const output = "private-output-canary";
    for (const tool of ["bash", "shell"]) {
      for (const state of [{}, { metadata: {} }, { metadata: { exit: null } }, { metadata: { exit: "0" } },
        { metadata: { exit: 0.5 } }, { metadata: { exit: -1 } }, { metadata: { exit: 256 } },
        { exitCode: 0, metadata: [] }, { metadata: { exit: 0, exitCode: 1 } },
        { metadata: { exitCode: 1, exit_code: 2 } }, { exitCode: 1, metadata: { exitCode: 0 } },
        { metadata: { exitCode: 0, code: null } }, { status: "error", metadata: { exit: 0 } }, { status: "error" }]) {
        const projected = redactedHandoffFromExport({ info: { id: "original", directory: root }, messages: [{ parts: [
          { type: "tool", tool, state: { status: "completed", input, output, ...state } },
          { type: "tool", tool: "bash", state: { status: "running", input: { command: "ingenium-build deployment production-restart" } } },
        ] }] }, "original", root)!;
        const referenceHash = hash(JSON.stringify({ kind: "unresolved_operation", result: "unknown",
          sourceTargetHash: hash(`${tool}\0${JSON.stringify(input)}`), previousHash: null }));
        expect(projected.nextWork).toEqual({ kind: "review_changes", referenceHash });
        expect(projected.actions).toEqual([]);
        expect(projected.checks).toEqual([]);
        expect(projected.replay.todos).toEqual([]);
        const serialized = JSON.stringify(projected);
        expect(serialized).not.toContain(input.command);
        expect(serialized).not.toContain(output);
        expect(parseRedactedRestartHandoff(JSON.parse(serialized))).toEqual(projected);
        expect(() => parseRedactedRestartHandoff({ ...projected, checks: [{ name: "test", status: "unknown",
          result: "unknown", exitCode: null, targetHash: referenceHash }] })).toThrow("handoff.checks is invalid");
      }
    }
  });

  it("keeps check status/result/exit validation strict", () => {
    const original = handoff();
    const check = { name: "test", status: "completed", result: "passed", exitCode: 0, targetHash: hash("test") };
    for (const change of [{ exitCode: 1 }, { status: "failed" }, { result: "failed" },
      { status: "failed", result: "failed" }, { status: "unknown", result: "unknown", exitCode: null }]) {
      expect(() => parseRedactedRestartHandoff({ ...original, checks: [{ ...check, ...change }] })).toThrow("handoff.checks is invalid");
    }
  });

  it("B2 keeps unknown work actionable alongside known check results", () => {
    const root = temporary();
    const exported = { info: { id: "original", directory: root, currentTaskId: "task" }, messages: [{ parts: [
      { type: "tool", tool: "todowrite", state: { status: "completed", input: { todos: handoff().replay.todos } } },
      { type: "tool", tool: "bash", state: { status: "completed", input: { command: "npm run typecheck" } } },
      { type: "tool", tool: "bash", state: { status: "completed", input: { command: "npm run test" }, metadata: { exit: 1 } } },
      { type: "tool", tool: "shell", state: { status: "completed", input: { command: "npm run lint" }, metadata: { exit: 2 } } },
      { type: "tool", tool: "bash", state: { status: "completed", input: { command: "npm run build" }, metadata: { exit: 0 } } },
      { type: "tool", tool: "bash", state: { status: "running", input: { command: "ingenium-build deployment production-restart" } } },
    ] }] };
    const projected = redactedHandoffFromExport(exported, "original", root)!;
    expect(projected?.checks.map(({ name, result }) => ({ name, result }))).toEqual([
      { name: "test", result: "failed" }, { name: "lint", result: "failed" }, { name: "build", result: "passed" },
    ]);
    const referenceHash = hash(JSON.stringify({ kind: "unresolved_operation", result: "unknown",
      sourceTargetHash: hash(`bash\0${JSON.stringify({ command: "npm run typecheck" })}`), previousHash: null }));
    expect(projected.nextWork).toEqual({ kind: "review_changes", referenceHash });
    expect(projected?.replay.todos).toEqual(handoff().replay.todos);
    exported.messages[0]!.parts.splice(1, 1);
    const knownOnly = redactedHandoffFromExport(exported, "original", root)!;
    expect(knownOnly.checks).toEqual(projected.checks);
    expect(knownOnly.actions).toEqual(projected.actions);
    expect(knownOnly.nextWork).toEqual({ kind: "address_failure", referenceHash: knownOnly.checks[1]!.targetHash });
  });

  it("reuses lifecycle Todo IDs from completed original-session history and ignores uncertain Todo writes", () => {
    const todos = handoff().replay.todos;
    const inputWithoutId = todos.map(({ id: _id, ...todo }) => todo);
    expect(stableRestartTodos(inputWithoutId, todos)).toEqual(todos);
    expect(stableRestartTodos(inputWithoutId)[0]!.id).toBe(`todo-${hash(`todo\0${JSON.stringify(todos[0]!.content)}`)}`);
    const root = temporary();
    const exported = redactedHandoffFromExport({ info: { id: "original", directory: root }, messages: [{ parts: [
      { type: "tool", tool: "todowrite", state: { status: "completed", input: { todos } } },
      { type: "tool", tool: "todowrite", state: { status: "completed", input: { todos: inputWithoutId } } },
      { type: "tool", tool: "todowrite", state: { status: "running", input: { todos: [] } } },
      { type: "tool", tool: "bash", state: { status: "running", input: { command: "ingenium-build deployment production-restart" } } },
    ] }] }, "original", root);
    expect(exported?.replay).toEqual({ sessionIdSha256: hash("original"), todos });
  });
  it("retains stable Todo identity/content and rejects count-only, duplicate, oversized, or secret-bearing handoffs", () => {
    expect(parseRedactedRestartHandoff(handoff())).toEqual(handoff());
    const original = handoff();
    for (const invalid of [
      { ...original, replay: undefined },
      { ...original, replay: { ...original.replay, todos: [] } },
      { ...original, replay: { ...original.replay, todos: Array(65).fill(original.replay.todos[0]) } },
      ...["", "x".repeat(2049), "Bearer secret-value", "password=secret-value"].map((content) => ({
        ...original, replay: { ...original.replay, todos: [{ ...original.replay.todos[0], content }] },
      })),
      { ...original, replay: { ...original.replay, todos: [{ ...original.replay.todos[0], transcript: "untrusted" }] } },
    ]) expect(() => parseRedactedRestartHandoff(invalid)).toThrow();
  });

});

describe("successor MCP canary", () => {
  it("blocks the production retirement path when the successor has no initialized MCP canary", async () => {
    const root = temporary();
    const bound = binding(root);
    const old = { pid: 1234, startTimeTicks: 100, executableSha256: hash("executable"), nonceSha256: hash("old") };
    const successor = { ...old, pid: 1235, nonceSha256: hash("successor") };
    const production = productionDependencies({ runDirectory: root, worktree: root, binding: bound, port: 5001 } as any);
    const quiesce = vi.fn();
    const retire = vi.fn();
    const request = {
      schemaVersion: 1, worktree: root, binding: { ...bound, audience: "mcp" }, oldProcess: old, oldPort: 5000, oldDataHome: root,
      replacement: { port: 5001, dataHome: join(root, "replacement"), expectedIdentity: successor }, handoff: handoff(),
       timeouts: Object.fromEntries(["handoffMs", "launchMs", "identityMs", "healthMs", "sessionMs", "terminalIdleMs", "retirementMs"].map((key) => [key, 1000])),
    } as any;
    await expect(runReplacementFirstRestart(request, {
      ...production, revalidateBinding: async () => true, revalidateProcessIdentity: async () => true,
      persistHandoff: async () => {}, launchReplacement: async () => successor, verifyReplacementHealth: async () => {},
      createReplacementSession: async (_identity, _port, transactionSha256) => ({ status: "created", transactionSha256,
         session: { id: "successor", initialMessageCount: 0, transactionSha256 } }),
      awaitTerminalIdleAcknowledgement: async (_identity, _session, handoffSha256, transactionSha256) => ({ status: "idle", handoffSha256, transactionSha256, assistantResult: "completed" }),
      abortRecoveryOwner: () => {}, stopReplacement: async () => {}, persistEvidence: async () => {},
      quiesceOldProcess: quiesce, retireOldProcess: retire,
    })).rejects.toThrow();
    expect(quiesce).not.toHaveBeenCalled();
    expect(retire).not.toHaveBeenCalled();
  });
  it("requires tools/list and exact project identity after initialization", async () => {
    const bound = binding(temporary());
    const calls: string[] = [];
    const client = {
      listTools: vi.fn(async () => { calls.push("tools/list"); return { tools: [{ name: "project_detail" }] }; }),
      callTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push(name); expect(args).toEqual({ name: "ingenium" });
        return toolResult({ project: { id: bound.projectId, name: bound.project } });
      }), close: async () => {},
    };
    await verifyRecoveryMcpBinding(client, bound);
    expect(calls).toEqual(["tools/list", "project_detail"]);
    client.callTool.mockResolvedValue(toolResult({ project: { id: randomUUID(), name: "ingenium" } }));
    await expect(verifyRecoveryMcpBinding(client, bound)).rejects.toThrow("project binding changed");
    client.listTools.mockResolvedValue({ tools: [] });
    await expect(verifyRecoveryMcpBinding(client, bound)).rejects.toThrow("tools/list failed");
  });

  it("rejects missing, stale, foreign-process, foreign-binding, incomplete and non-private canaries", () => {
    const root = temporary();
    const bound = binding(root);
    const parent = { pid: 1234, startTimeTicks: 9876, executableSha256: hash("executable"), nonceSha256: hash("nonce") };
    const path = join(root, ".ingenium-recovery-mcp-canary.json");
    const valid = { schemaVersion: 1, parent, binding: bound, port: 5001,
      initialized: true, toolsListed: true, projectVerified: true, expiresAt: Date.now() + 60_000 };
    const verify = () => verifyRecoveryMcpCanary(root, bound, parent, 5001);
    expect(verify).toThrow();
    writeFileSync(path, JSON.stringify(valid), { mode: 0o600 });
    expect(verify).not.toThrow();
    for (const change of [{ parent: { ...parent, pid: 5678 } }, { binding: { ...bound, workspaceId: "foreign" } },
      { initialized: false }, { toolsListed: false }, { projectVerified: false }, { port: 5002 }, { expiresAt: Date.now() - 1 }]) {
      writeFileSync(path, JSON.stringify({ ...valid, ...change }));
      expect(verify).toThrow();
    }
    writeFileSync(path, JSON.stringify(valid));
    chmodSync(path, 0o644);
    expect(verify).toThrow();
  });
});

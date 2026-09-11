import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRedactedRestartHandoff, runReplacementFirstRestart, stableRestartTodos, type RedactedRestartHandoff } from "./replacement-first-restart.js";
import { hasCapturedHandoff, productionDependencies, publishRestartHandoff, redactedHandoffFromExport, restartHandoffMemoryEntry } from "./scripts/production-restart.js";
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

describe("typed recovery replay", () => {
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

  it("requires server-accepted original work replay in the exact successor, not matching counts or another session", () => {
    const original = handoff();
    const owner = { actorId: `actor-${hash("publisher")}`, fence: 3 };
    const accepted = { ...restartHandoffMemoryEntry(original, owner), actorId: owner.actorId, entryId: randomUUID(), sourceRevision: 2 };
    const path = join(temporary(), "capture.jsonl");
    const record = (entry: unknown, session = "successor") => writeFileSync(path, JSON.stringify({
      sessionIdSha256: hash(session), operationalEntries: [entry],
    }) + "\n", { mode: 0o600 });
    const captured = () => hasCapturedHandoff(path, original, hash(JSON.stringify(original)), 0, accepted, "successor");
    record(accepted);
    expect(captured()).toBe(true);
    record(accepted, "other-successor");
    expect(captured()).toBe(false);
    record({ ...accepted, entryId: randomUUID() });
    expect(captured()).toBe(false);
    for (const change of [{ content: "Different task" }, { id: "OTHER-ID" }, { status: "completed" }]) {
      const changed = structuredClone(accepted) as any;
      Object.assign(changed.manifest.todoWrite[0], change);
      record(changed);
      expect(captured()).toBe(false);
    }
    record({ ...accepted, manifest: undefined });
    expect(captured()).toBe(false);
  });

  it("requires an exact accepted typed memory response without replaying an uncertain publication", async () => {
    const root = temporary();
    const original = handoff();
    const callTool = vi.fn(async (name: string, args: Record<string, any>) => {
      if (name === "coordination_handoff") return toolResult({ data: {
        session: { revision: 1, fence: 3 }, memory: { entry: { ...args.memory_entry,
          actorId: args.memory_entry.manifest.ownerId, entryId: randomUUID(), sourceRevision: 1 } },
      } });
      return toolResult({ data: { session: { revision: 0, fence: 3 } } });
    });
    const client = { callTool, close: vi.fn(async () => {}) };
    const bound = { ...binding(root), apiUrl: "http://127.0.0.1:4097/api/v1", audience: "mcp" as const, credentialFile: join(root, "credential") };
    const publisher = await publishRestartHandoff(root, bound, original, async () => client);
    expect((publisher.acceptedMemory?.manifest as any).todoWrite).toEqual(original.replay.todos);
    callTool.mockImplementation(async (name) => {
      if (name === "coordination_handoff") throw new Error("uncertain publication");
      return toolResult({ data: { session: { revision: 1, fence: 3 } } });
    });
    callTool.mockClear();
    await expect(publishRestartHandoff(root, bound, original, async () => client)).rejects.toThrow("uncertain publication");
    expect(callTool.mock.calls.filter(([name]) => name === "coordination_handoff")).toHaveLength(1);
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
      timeouts: Object.fromEntries(["handoffMs", "launchMs", "identityMs", "healthMs", "sessionMs", "memoryAckMs", "terminalIdleMs", "retirementMs"].map((key) => [key, 1000])),
    } as any;
    await expect(runReplacementFirstRestart(request, {
      ...production, revalidateBinding: async () => true, revalidateProcessIdentity: async () => true,
      persistHandoff: async () => {}, launchReplacement: async () => successor, verifyReplacementHealth: async () => {},
      createReplacementSession: async (_identity, _port, transactionSha256) => ({ status: "created", transactionSha256,
        session: { id: "successor", initialMessageCount: 0, captureOffset: 0, transactionSha256 } }),
      acknowledgeTypedMemory: async (_identity, _session, handoffSha256, transactionSha256) => ({ status: "acknowledged", handoffSha256, transactionSha256 }),
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

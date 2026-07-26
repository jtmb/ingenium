import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncAgents, writeAgentToDisk } from "./resource-sync.js";

let worktree = "";

afterEach(() => {
  vi.unstubAllGlobals();
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  worktree = "";
});

describe("agent resource sync", () => {
  it("does not serialize API model metadata into markdown frontmatter", () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    writeAgentToDisk(worktree, {
      name: "sync-agent",
      content: "# Synced agent",
      description: "sync test",
      category: "execution",
      mode: "subagent",
      model: "deepseek/centralized-only",
    });

    const content = readFileSync(join(worktree, ".opencode", "agents", "execution", "sync-agent.md"), "utf8");
    expect(content).not.toMatch(/^model:/m);
  });

  it("rejects traversal names, invalid categories, and symlinked agent directories", () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    const outside = mkdtempSync(join(tmpdir(), "ingenium-agent-outside-"));
    try {
      expect(writeAgentToDisk(worktree, { name: "../escape", content: "# no" })).toBe(false);
      expect(writeAgentToDisk(worktree, { name: "safe", category: "../escape", content: "# no" })).toBe(false);

      mkdirSync(join(worktree, ".opencode", "agents"), { recursive: true });
      symlinkSync(outside, join(worktree, ".opencode", "agents", "execution"));
      expect(writeAgentToDisk(worktree, { name: "safe", category: "execution", content: "# no" })).toBe(false);
      expect(existsSync(join(outside, "safe.md"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("removes stale disk files for disabled API agents instead of resurrecting them", async () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    expect(writeAgentToDisk(worktree, { name: "disabled-agent", category: "execution", content: "# stale" })).toBe(true);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ name: "disabled-agent", content: "# API", category: "execution", enabled: false }] }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncAgents(worktree, "project", { version: 1, project: "project", lastFullSync: "", resources: { skills: {}, agents: {}, plugins: {}, commands: {}, config: {} } }, { isInitialSync: true });

    expect(result.removed).toBe(1);
    expect(existsSync(join(worktree, ".opencode", "agents", "execution", "disabled-agent.md"))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("imports a disk-only agent as disabled", async () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    expect(writeAgentToDisk(worktree, { name: "orphan-agent", category: "chat", content: "# local" })).toBe(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await syncAgents(worktree, "project", { version: 1, project: "project", lastFullSync: "", resources: { skills: {}, agents: {}, plugins: {}, commands: {}, config: {} } }, { isInitialSync: true });

    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).enabled).toBe(false);
  });

  it("adds the protected fallback bearer token to resource-sync requests", async () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    const opencodeDir = join(worktree, ".opencode");
    mkdirSync(opencodeDir);
    const tokenPath = join(opencodeDir, ".ingenium-api-token");
    writeFileSync(tokenPath, "test-resource-sync-token\n", { mode: 0o600 });
    chmodSync(tokenPath, 0o600);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    await syncAgents(worktree, "project", { version: 1, project: "project", lastFullSync: "", resources: { skills: {}, agents: {}, plugins: {}, commands: {}, config: {} } }, { isInitialSync: false });

    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get("Authorization")).toBe("Bearer test-resource-sync-token");
  });
});
